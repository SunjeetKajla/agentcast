import type { CSSProperties, ReactNode } from "react";
import { AbsoluteFill, Audio, Sequence, useCurrentFrame, useVideoConfig } from "remotion";
import type { MotionTokens } from "@agentcast/shared";
import { overlay, settled } from "../motion.ts";
import { sfxCues } from "../audio.ts";
import { planParts, type Caption, type Part, type VideoInput } from "../plan.ts";
import { Backdrop, Montage, Outro, Stat, Statement, TitleCard } from "./cards.tsx";
import { fontStack, useFonts } from "./fonts.ts";
import { Shot } from "./Shot.tsx";

/**
 * The whole video: the title card, each segment, the outro, overlapping at their transitions; the
 * voice lines and sound effects under them; captions on top. Type is the brand's own fonts.
 */
export function Video(input: VideoInput) {
  const { edl } = input;
  const { parts, clips, frames } = planParts(edl, input.narration);
  const { palette, fonts, motion } = edl.style;
  useFonts([fonts.display, fonts.text, ...(input.lang === "hi" ? ["Noto Sans Devanagari"] : [])]);
  const sfx = input.audio?.sfx ?? {};
  const cues = sfxCues(edl, parts, input.footage.timeline, frames).filter((cue) => sfx[cue.kind]);
  const vars = { "--display": fontStack(fonts.display), "--text": fontStack(fonts.text) } as CSSProperties;
  return (
    <AbsoluteFill style={{ ...vars, background: palette.bg, color: palette.fg, fontFamily: "var(--text)" }}>
      {parts.map((part) => (
        <Sequence key={part.id} from={part.from} durationInFrames={part.frames} premountFor={30}>
          <Transitioned part={part} motion={motion}>
            <PartView input={input} part={part} />
          </Transitioned>
        </Sequence>
      ))}
      {clips.map((clip) => (
        <Sequence key={`voice-${clip.from}`} from={clip.from} durationInFrames={clip.frames + 1} layout="none">
          <Audio src={clip.src} />
        </Sequence>
      ))}
      {cues.map((cue, i) => (
        <Sequence key={`sfx-${i}`} from={cue.frame} durationInFrames={Math.round(1.5 * edl.fps)} layout="none">
          <Audio src={sfx[cue.kind]!} volume={cue.gain} />
        </Sequence>
      ))}
      <Captions
        captions={input.captions}
        style={edl.style.captionStyle}
        accent={palette.accent}
        tall={input.aspect === "9x16"}
        motion={motion}
      />
    </AbsoluteFill>
  );
}

function PartView({ input, part }: { input: VideoInput; part: Part }) {
  if (part.kind !== "segment") return part.kind === "intro" ? <TitleCard input={input} /> : <Outro input={input} />;
  const segment = input.edl.segments[part.index]!;
  if (segment.kind === "shot") return <Shot input={input} part={part} />;
  if (segment.kind === "statement") return <Statement input={input} segment={segment} />;
  if (segment.kind === "stat") return <Stat input={input} segment={segment} />;
  // Director-written scenes are HyperFrames files; the legacy renderer shows the backdrop.
  if (segment.kind === "scene") return <Backdrop input={input} />;
  return <Montage input={input} segment={segment} />;
}

/**
 * How a part arrives and leaves, on the signature curve without overshoot. The later part draws on
 * top and does the work: `fade` fades in over the one before, `slide` pushes in from the right while
 * the one before drifts left, `zoom-through` grows the one before toward the viewer as it fades.
 */
function Transitioned({ part, motion, children }: { part: Part; motion: MotionTokens; children: ReactNode }) {
  const frame = useCurrentFrame();
  let opacity = 1;
  let transform: string | undefined;
  if (part.enter.frames && frame < part.enter.frames) {
    const p = settled(motion, frame / part.enter.frames);
    if (part.enter.kind === "fade") opacity = p;
    if (part.enter.kind === "slide") transform = `translateX(${(1 - p) * 100}%)`;
    if (part.enter.kind === "zoom-through") {
      opacity = p;
      transform = `scale(${0.92 + 0.08 * p})`;
    }
  }
  const leaving = part.frames - part.exit.frames;
  if (part.exit.frames && frame >= leaving) {
    const q = settled(motion, (frame - leaving) / part.exit.frames);
    if (part.exit.kind === "slide") transform = `translateX(${-q * 30}%)`;
    if (part.exit.kind === "zoom-through") {
      opacity = 1 - q;
      transform = `scale(${1 + 0.25 * q})`;
    }
  }
  return <AbsoluteFill style={{ opacity, transform, overflow: "hidden" }}>{children}</AbsoluteFill>;
}

/**
 * Captions at the bottom, in a dark box whatever the brand's theme. `karaoke`: words not yet spoken
 * are dimmed and the word being spoken takes the accent colour. `block`: the line, plain. `minimal`
 * (trailers): smaller text on a translucent pill, so the picture leads.
 */
function Captions(props: {
  captions: Caption[];
  style: "karaoke" | "block" | "minimal";
  accent: string;
  tall: boolean;
  motion: MotionTokens;
}) {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const t = frame / fps;
  const line = props.captions.find((c) => c.start <= t && t < c.end);
  if (!line) return null;
  const minimal = props.style === "minimal";
  const size = height * (props.tall ? (minimal ? 0.026 : 0.031) : minimal ? 0.033 : 0.041);
  const look = overlay(props.motion, t, line.start, line.end, size * 0.5);
  const box: CSSProperties = {
    maxWidth: width * (minimal ? 0.72 : 0.84),
    padding: `${size * 0.32}px ${size * 0.65}px`,
    borderRadius: minimal ? size : size * 0.35,
    background: minimal ? "rgba(8,10,12,.55)" : "rgba(10,12,14,.84)",
    color: "#f4f3ee",
    fontSize: size,
    fontWeight: minimal ? 560 : 620,
    lineHeight: 1.25,
    textAlign: "center",
  };
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: height * (props.tall ? 0.18 : 0.06),
        display: "flex",
        justifyContent: "center",
        ...look,
      }}
    >
      <span style={box}>
        {props.style === "karaoke" && line.words?.length
          ? line.words.map((w, i) => {
              const speaking = t >= w.start && t < (line.words![i + 1]?.start ?? w.end);
              return (
                <span key={i} style={{ opacity: t >= w.start ? 1 : 0.5, color: speaking ? props.accent : undefined }}>
                  {i ? " " : ""}
                  {w.text}
                </span>
              );
            })
          : line.text}
      </span>
    </div>
  );
}
