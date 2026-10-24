import { AbsoluteFill, Freeze, OffthreadVideo, useCurrentFrame, useVideoConfig } from "remotion";
import type { MotionTokens, ShotSegment } from "@agentcast/shared";
import { cameraAt, project, zoomOf, type Crop, type Size } from "../camera.ts";
import { calloutSeconds, eased, overlay, readSeconds } from "../motion.ts";
import { cursorAt, type Part, type VideoInput } from "../plan.ts";
import { clockOf } from "../retime.ts";
import { Backdrop, readable } from "./cards.tsx";

const textIn = (text: Record<string, string>, lang: string) => text[lang] ?? text.en ?? Object.values(text)[0] ?? "";

/**
 * One shot: the recording through the virtual camera, with the drawn cursor and callouts riding on
 * it. In 16:9 the footage sits in a browser window on the brand's backdrop and opens to the full
 * frame as the camera zooms in, so a close-up fills the screen. Past the end of its footage (while
 * the narration finishes) the last frame holds.
 */
export function Shot({ input, part }: { input: VideoInput; part: Extract<Part, { kind: "segment" }> }) {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const { edl, lang, footage } = input;
  const { motion, palette, look } = edl.style;
  const shot = edl.segments[part.index] as ShotSegment;
  const src: Size = { w: footage.timeline.viewport.w, h: footage.timeline.viewport.h };
  const o = frame / fps;
  // The source second on screen, through the speed ramps; past the footage the last frame holds.
  const clock = clockOf(shot);
  const t = clock.toSource(Math.min(o, Math.max(0, part.frames - part.hold - 1) / fps));
  const aspect = width / height;
  const crop = cameraAt(shot.camera, t, src, aspect, motion);

  const windowed = edl.style.frame !== "none" && input.aspect === "16x9";
  const tilt = edl.style.frame === "tilt" && windowed;
  // Fully open by a 1.25× zoom, so the window is only part-open while the camera moves.
  const open = windowed ? eased(motion, (zoomOf(crop, src, aspect) - 1.02) / 0.23) : 1;
  const closed = Math.max(0, 1 - open);
  const scale = (tilt ? 0.8 : 0.86) + (tilt ? 0.2 : 0.14) * Math.min(1, open);
  // Tilted: the window turns toward the viewer as it arrives from depth, drifts while wide, and
  // flattens as it opens to full frame.
  const arrive = tilt
    ? Math.min(1, eased(motion, (o - part.enter.frames / fps / 2) / (motion.durations.slow * 1.6)))
    : 1;
  const drift = Math.sin((part.from + frame) / fps / 4);
  const transform = tilt
    ? `perspective(${width * 1.5}px) rotateY(${closed * (-12 + 2.5 * drift) - (1 - arrive) * 10}deg) rotateX(${closed * (5 + drift)}deg) translateZ(${-(1 - arrive) * width * 0.1}px)`
    : undefined;
  const bar = look.chrome === "browser" ? height * 0.045 * closed : 0;
  const radius = look.chrome === "none" ? 0 : look.radius * (height / 1080) * closed;
  const inner: Size = { w: width * scale, h: height * scale };

  return (
    <AbsoluteFill>
      {windowed && closed > 0 && <Backdrop input={input} />}
      <div
        style={{
          position: "absolute",
          left: (width - inner.w) / 2,
          top: (height - inner.h - bar) / 2,
          width: inner.w,
          height: inner.h + bar,
          borderRadius: radius,
          overflow: "hidden",
          background: palette.surface ?? palette.bg,
          transform,
          boxShadow:
            closed > 0
              ? `0 ${height * 0.03 * closed}px ${height * 0.08 * closed}px rgba(0,0,0,${0.45 * closed})`
              : undefined,
        }}
      >
        {bar > 0.5 && (
          <WindowBar
            height={bar}
            url={urlAt(footage.timeline.events, t)}
            fg={palette.fg}
            bg={palette.surface ?? palette.bg}
          />
        )}
        <div style={{ position: "absolute", left: 0, top: bar, width: inner.w, height: inner.h, overflow: "hidden" }}>
          <div
            style={{
              position: "absolute",
              width: src.w,
              height: src.h,
              transformOrigin: "0 0",
              transform: `scale(${inner.w / crop.w}) translate(${-crop.x}px, ${-crop.y}px)`,
            }}
          >
            {/* Each output frame shows the source frame at t; past the footage, the last one stays. */}
            <Freeze frame={Math.round(t * fps)}>
              <OffthreadVideo src={footage.src} muted style={{ width: src.w, height: src.h }} />
            </Freeze>
          </div>
          {(shot.callouts ?? []).map((c, i) => (
            <Callout
              key={i}
              text={textIn(c.text, lang)}
              anchor={c.anchor}
              spotlight={c.spotlight}
              start={clock.toOutput(c.t)}
              now={o}
              crop={crop}
              out={inner}
              motion={motion}
              accent={palette.accent}
            />
          ))}
          {shot.cursor === "auto" && <Cursor events={footage.timeline.events} t={t} crop={crop} out={inner} />}
        </div>
      </div>
      {(shot.lowerThirds ?? []).map((l, i) => (
        <LowerThird
          key={i}
          text={textIn(l.text, lang)}
          start={clock.toOutput(l.t)}
          now={o}
          motion={motion}
          palette={palette}
          tall={input.aspect === "9x16"}
        />
      ))}
      {shot.title && (
        <ShotTitle
          text={textIn(shot.title.text, lang)}
          seconds={shot.title.seconds}
          now={o}
          motion={motion}
          palette={palette}
          tall={input.aspect === "9x16"}
        />
      )}
    </AbsoluteFill>
  );
}

/** The page's address at `t`, without the scheme. */
function urlAt(events: { t: number; url: string }[], t: number) {
  let url = "";
  for (const e of events) if (e.t <= t && e.url) url = e.url;
  try {
    const u = new URL(url);
    return u.host + (u.pathname === "/" ? "" : u.pathname);
  } catch {
    return "";
  }
}

function WindowBar({ height, url, fg, bg }: { height: number; url: string; fg: string; bg: string }) {
  const dot = height * 0.22;
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        bottom: "auto",
        height,
        display: "flex",
        alignItems: "center",
        gap: dot * 0.7,
        paddingLeft: height * 0.45,
        background: bg,
        borderBottom: `1px solid color-mix(in srgb, ${fg} 10%, transparent)`,
      }}
    >
      {[0, 1, 2].map((i) => (
        <span key={i} style={{ width: dot, height: dot, borderRadius: dot, background: fg, opacity: 0.22 }} />
      ))}
      <span
        style={{
          marginLeft: height * 0.4,
          padding: `${height * 0.08}px ${height * 0.5}px`,
          borderRadius: height,
          background: `color-mix(in srgb, ${fg} 8%, transparent)`,
          color: fg,
          opacity: 0.75,
          fontSize: height * 0.36,
          whiteSpace: "nowrap",
        }}
      >
        {url}
      </span>
    </div>
  );
}

/** The drawn pointer: an arrow that rests where it last moved, with a ripple after each click. */
function Cursor({
  events,
  t,
  crop,
  out,
}: {
  events: VideoInput["footage"]["timeline"]["events"];
  t: number;
  crop: Crop;
  out: Size;
}) {
  const state = cursorAt(events, t);
  if (!state.visible) return null;
  const [x, y] = project([state.x, state.y], crop, out);
  const size = out.h * 0.032;
  return (
    <>
      {state.clicked !== undefined && (
        <div
          style={{
            position: "absolute",
            left: x,
            top: y,
            width: size * 2.4,
            height: size * 2.4,
            marginLeft: -size * 1.2,
            marginTop: -size * 1.2,
            borderRadius: "50%",
            border: `${size * 0.12}px solid rgba(255,255,255,.9)`,
            transform: `scale(${0.4 + state.clicked * 2})`,
            opacity: 1 - state.clicked / 0.45,
          }}
        />
      )}
      <svg
        viewBox="0 0 24 24"
        width={size}
        height={size}
        style={{
          position: "absolute",
          left: x - size * 0.18,
          top: y - size * 0.1,
          filter: "drop-shadow(0 2px 3px rgba(0,0,0,.4))",
        }}
      >
        <path
          d="M4 2l15 11.5-6.6 1 3.8 7.3-2.9 1.5-3.8-7.4L4 20.5z"
          fill="#fff"
          stroke="#111"
          strokeWidth={1.4}
          strokeLinejoin="round"
        />
      </svg>
    </>
  );
}

/** A ring around an element with a label beside it; a spotlight dims everything else. */
function Callout(p: {
  text: string;
  anchor: [number, number, number, number];
  spotlight?: boolean;
  start: number;
  now: number;
  crop: Crop;
  out: Size;
  motion: MotionTokens;
  accent: string;
}) {
  const look = overlay(p.motion, p.now, p.start, p.start + calloutSeconds(p.text), p.out.h * 0.012);
  if (!look) return null;
  const [x0, y0] = project([p.anchor[0], p.anchor[1]], p.crop, p.out);
  const [x1, y1] = project([p.anchor[0] + p.anchor[2], p.anchor[1] + p.anchor[3]], p.crop, p.out);
  // Never point at something the camera isn't showing.
  const [cx, cy] = [(x0 + x1) / 2, (y0 + y1) / 2];
  if (cx < 0 || cx > p.out.w || cy < 0 || cy > p.out.h) return null;
  const pad = p.out.h * 0.01;
  const size = p.out.h * 0.03;
  const below = y1 + size * 2.2 < p.out.h;
  const accent = readable(p.accent, "#101214");
  return (
    <div style={{ position: "absolute", inset: 0, opacity: look.opacity }}>
      <div
        style={{
          position: "absolute",
          left: x0 - pad,
          top: y0 - pad,
          width: x1 - x0 + pad * 2,
          height: y1 - y0 + pad * 2,
          borderRadius: pad,
          border: `${Math.max(2, pad * 0.35)}px solid ${p.accent}`,
          boxShadow: p.spotlight ? "0 0 0 9999px rgba(0,0,0,.45)" : `0 0 ${pad * 2}px ${p.accent}`,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: Math.min(Math.max(pad, x0), p.out.w - pad - size * 12),
          top: below ? y1 + pad * 2 : y0 - pad * 2 - size * 1.6,
          transform: look.transform,
          padding: `${size * 0.25}px ${size * 0.5}px`,
          borderRadius: size * 0.3,
          background: "#101214",
          color: "#f4f3ee",
          fontSize: size * 0.8,
          fontWeight: 620,
          whiteSpace: "nowrap",
          borderLeft: `${size * 0.14}px solid ${accent}`,
        }}
      >
        {p.text}
      </div>
    </div>
  );
}

type Palette = VideoInput["edl"]["style"]["palette"];

/** The beat's headline over the start of its shot, at the top left. */
function ShotTitle({
  text,
  seconds,
  now,
  motion,
  palette,
  tall,
}: {
  text: string;
  seconds: number;
  now: number;
  motion: MotionTokens;
  palette: Palette;
  tall: boolean;
}) {
  const { height } = useVideoConfig();
  const size = height * (tall ? 0.034 : 0.05);
  const look = overlay(motion, now, 0.15, 0.15 + seconds, size * 0.6);
  if (!look) return null;
  return (
    <div
      style={{
        position: "absolute",
        left: height * 0.06,
        top: height * (tall ? 0.08 : 0.06),
        right: height * 0.06,
        ...look,
      }}
    >
      <span
        style={{
          display: "inline-block",
          padding: `${size * 0.22}px ${size * 0.45}px`,
          borderRadius: size * 0.25,
          background: palette.bg,
          color: palette.fg,
          fontFamily: "var(--display)",
          fontSize: size,
          fontWeight: 700,
          letterSpacing: "-0.01em",
          boxShadow: "0 8px 30px rgba(0,0,0,.3)",
        }}
      >
        {text}
      </span>
    </div>
  );
}

/** A name-and-fact bar at the lower left. */
function LowerThird({
  text,
  start,
  now,
  motion,
  palette,
  tall,
}: {
  text: string;
  start: number;
  now: number;
  motion: MotionTokens;
  palette: Palette;
  tall: boolean;
}) {
  const { height } = useVideoConfig();
  const size = height * (tall ? 0.024 : 0.032);
  const look = overlay(motion, now, start, start + readSeconds(text, 2), size * 0.6);
  if (!look) return null;
  return (
    <div style={{ position: "absolute", left: height * 0.06, bottom: height * (tall ? 0.3 : 0.2), ...look }}>
      <span
        style={{
          display: "inline-block",
          padding: `${size * 0.35}px ${size * 0.6}px`,
          borderRadius: size * 0.25,
          background: palette.bg,
          color: palette.fg,
          fontSize: size,
          fontWeight: 600,
          borderLeft: `${size * 0.18}px solid ${palette.accent}`,
        }}
      >
        {text}
      </span>
    </div>
  );
}
