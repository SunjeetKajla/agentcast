import type { CSSProperties, ReactNode } from "react";
import { AbsoluteFill, Freeze, Img, OffthreadVideo, useCurrentFrame, useVideoConfig } from "remotion";
import type { Segment } from "@agentcast/shared";
import { eased } from "../motion.ts";
import type { VideoInput } from "../plan.ts";

// The cards and scenes between shots, in the layouts the brand's look chose (PRD §9.7.3).

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
const luminance = (hex: string) => {
  const [r, g, b] = rgb(hex).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};
const mixHex = (a: string, b: string, k: number) =>
  "#" +
  rgb(a)
    .map((c, i) =>
      Math.round((c + (rgb(b)[i]! - c) * k) * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("");

/** `color`, moved toward white or black until it reads on `on` (contrast 3:1). */
export function readable(color: string, on: string): string {
  const toward = luminance(on) < 0.4 ? "#ffffff" : "#000000";
  for (let k = 0; k <= 1; k += 0.1) {
    const c = mixHex(color, toward, k);
    if (contrast(c, on) >= 3) return c;
  }
  return toward;
}

const inLang = (text: Record<string, string>, lang: string) => text[lang] ?? text.en ?? Object.values(text)[0] ?? "";

/**
 * Behind cards and windows, as the look says: `glow` (two slow glows in the accent colours), `solid`
 * (the plain brand colour with a soft vignette), `mesh` (a drifting mesh of the brand's colours), or
 * `hero` (the landing page's first screen, blurred and dimmed; a glow if there's no screenshot).
 */
export function Backdrop({ input }: { input: VideoInput }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { palette, look } = input.edl.style;
  const { bg, accent, accent2, surface } = palette;
  const drift = Math.sin(frame / fps / 3) * 6;
  const kind = look.backdrop === "hero" && !input.brand.hero ? "glow" : look.backdrop;
  if (kind === "hero")
    return (
      <AbsoluteFill style={{ background: bg, overflow: "hidden" }}>
        <Img
          src={input.brand.hero!}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            filter: "blur(36px) saturate(1.1)",
            transform: `scale(${1.15 + drift * 0.004})`,
          }}
        />
        <AbsoluteFill
          style={{ background: `color-mix(in srgb, ${bg} ${look.theme === "dark" ? 72 : 64}%, transparent)` }}
        />
      </AbsoluteFill>
    );
  if (kind === "solid")
    return (
      <AbsoluteFill
        style={{
          background: `radial-gradient(120% 90% at 50% 40%, ${bg} 55%, ${mixHex(bg, look.theme === "dark" ? "#000000" : "#cccccc", 0.35)})`,
        }}
      />
    );
  if (kind === "mesh")
    return (
      <AbsoluteFill
        style={{
          background: `radial-gradient(45% 55% at ${18 + drift}% ${22 - drift}%, color-mix(in srgb, ${accent} 55%, transparent), transparent 70%),
            radial-gradient(50% 60% at ${82 - drift}% ${30 + drift}%, color-mix(in srgb, ${accent2 ?? accent} 45%, transparent), transparent 70%),
            radial-gradient(60% 55% at ${55 + drift}% ${92 - drift}%, color-mix(in srgb, ${surface ?? accent} 60%, transparent), transparent 70%), ${bg}`,
        }}
      />
    );
  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(60% 70% at ${25 + drift}% 20%, color-mix(in srgb, ${accent} 28%, transparent), transparent 70%),
          radial-gradient(55% 60% at ${80 - drift}% 85%, color-mix(in srgb, ${accent2 ?? accent} 20%, transparent), transparent 70%), ${bg}`,
      }}
    />
  );
}

/** `rise(delay)`: the style for something that rises in over the slow duration, `delay` seconds in. */
function useRise(input: VideoInput) {
  const frame = useCurrentFrame();
  const { fps, height } = useVideoConfig();
  const { motion } = input.edl.style;
  return (delay: number) => {
    const p = eased(motion, (frame / fps - delay) / motion.durations.slow);
    return { opacity: Math.min(1, Math.max(0, p)), transform: `translateY(${(1 - p) * height * 0.03}px)` };
  };
}

/** Content on the backdrop, centred or set from the left (editorial layouts). */
function Layout({ input, align, children }: { input: VideoInput; align: "center" | "left"; children: ReactNode }) {
  const { height } = useVideoConfig();
  return (
    <AbsoluteFill>
      <Backdrop input={input} />
      <AbsoluteFill
        style={{
          alignItems: align === "center" ? "center" : "flex-start",
          justifyContent: "center",
          textAlign: align,
          padding: height * (align === "center" ? 0.1 : 0.12),
          gap: height * 0.032,
        }}
      >
        {children}
      </AbsoluteFill>
    </AbsoluteFill>
  );
}

function Logo({ input, size, style }: { input: VideoInput; size: number; style?: CSSProperties }) {
  const logo = input.brand.logo;
  if (!logo) return null;
  return (
    <div
      style={{
        ...style,
        padding: logo.plate ? size * 0.18 : 0,
        borderRadius: size * 0.2,
        background: logo.plate ? "#f4f3ee" : undefined,
      }}
    >
      <Img src={logo.src} style={{ height: size, width: (size * logo.width) / logo.height, objectFit: "contain" }} />
    </div>
  );
}

/** A thin accent bar that grows in. */
function Rule({ input, delay }: { input: VideoInput; delay: number }) {
  const frame = useCurrentFrame();
  const { fps, height } = useVideoConfig();
  const { motion, palette } = input.edl.style;
  const p = Math.max(0, Math.min(1, eased(motion, (frame / fps - delay) / motion.durations.slow)));
  return <div style={{ width: height * 0.12 * p, height: Math.max(3, height * 0.005), background: palette.accent }} />;
}

/** The landing page's first screen as a tilted card (split layouts). */
function HeroCard({ input, delay }: { input: VideoInput; delay: number }) {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const { motion, look } = input.edl.style;
  const p = Math.max(0, Math.min(1, eased(motion, (frame / fps - delay) / (motion.durations.slow * 1.5))));
  const drift = Math.sin(frame / fps / 4);
  return (
    <div
      style={{
        position: "absolute",
        right: -width * 0.04,
        top: "50%",
        width: width * 0.5,
        aspectRatio: "16 / 10",
        borderRadius: look.radius * (height / 1080),
        overflow: "hidden",
        opacity: p,
        transform: `translateY(-50%) perspective(${width}px) rotateY(${-16 + 2 * drift - (1 - p) * 12}deg) rotateX(${4 + drift}deg) translateX(${(1 - p) * width * 0.08}px)`,
        boxShadow: "0 40px 90px rgba(0,0,0,.45)",
      }}
    >
      <Img
        src={input.brand.hero!}
        style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "top" }}
      />
    </div>
  );
}

type TitleProps = { input: VideoInput; head: string; line?: string; pill?: string };

/** The title card and outro share a layout: centred, editorial (left), a giant wordmark, or split beside the hero. */
function TitleLayout({ input, head, line, pill }: TitleProps) {
  const rise = useRise(input);
  const { width, height } = useVideoConfig();
  const tall = input.aspect === "9x16";
  const { palette, look } = input.edl.style;
  const layout = look.title === "split" && (!input.brand.hero || tall) ? "editorial" : look.title;
  const muted = { color: readable(palette.fg, palette.bg), opacity: 0.82 };
  const pillStyle: CSSProperties = {
    padding: `${height * 0.012}px ${height * 0.03}px`,
    borderRadius: height,
    background: palette.accent,
    color: readable(palette.bg, palette.accent),
    fontSize: height * (tall ? 0.024 : 0.03),
    fontWeight: 650,
  };
  if (layout === "wordmark") {
    // As large as the name fits across the frame.
    const size = Math.min(height * (tall ? 0.12 : 0.26), (width * 0.9) / Math.max(4, head.length * 0.56));
    return (
      <Layout input={input} align="center">
        <Logo input={input} size={height * 0.06} style={rise(0)} />
        <div
          style={{
            ...rise(0.1),
            fontFamily: "var(--display)",
            fontSize: size,
            fontWeight: 800,
            letterSpacing: "-0.04em",
            lineHeight: 0.92,
          }}
        >
          {head}
        </div>
        {line && <div style={{ ...rise(0.3), ...muted, fontSize: height * (tall ? 0.024 : 0.032) }}>{line}</div>}
        {pill && <div style={{ ...rise(0.35), ...pillStyle }}>{pill}</div>}
      </Layout>
    );
  }
  const left = layout === "editorial" || layout === "split";
  return (
    <AbsoluteFill>
      <Layout input={input} align={left ? "left" : "center"}>
        <Logo input={input} size={height * (tall ? 0.05 : 0.075)} style={rise(0)} />
        <div
          style={{
            ...rise(0.12),
            maxWidth: layout === "split" ? "46%" : "85%",
            fontFamily: "var(--display)",
            fontSize: height * (tall ? 0.06 : layout === "split" ? 0.085 : 0.1),
            fontWeight: 760,
            letterSpacing: "-0.025em",
            lineHeight: 1.02,
          }}
        >
          {head}
        </div>
        {left && <Rule input={input} delay={0.25} />}
        {line && (
          <div
            style={{
              ...rise(0.3),
              ...muted,
              maxWidth: layout === "split" ? "44%" : "80%",
              fontSize: height * (tall ? 0.026 : 0.034),
              lineHeight: 1.3,
            }}
          >
            {line}
          </div>
        )}
        {pill && <div style={{ ...rise(0.35), ...pillStyle }}>{pill}</div>}
      </Layout>
      {layout === "split" && <HeroCard input={input} delay={0.2} />}
    </AbsoluteFill>
  );
}

/** The brand's logo, its name and the script's title line. */
export function TitleCard({ input }: { input: VideoInput }) {
  return <TitleLayout input={input} head={input.brand.name} line={input.copy.title ?? input.brand.tagline} />;
}

/** The call to action and where to find the product. */
export function Outro({ input }: { input: VideoInput }) {
  return <TitleLayout input={input} head={input.copy.cta ?? `Try ${input.brand.name}`} pill={input.brand.site} />;
}

/**
 * A headline between shots (trailers), as the look says: `center`; `editorial` (left, numbered, with
 * an accent rule); `panel` (on a full-bleed accent panel that sweeps in); `outline` (outlined type
 * that fills with colour). A kicker sits above it in the accent colour.
 */
export function Statement({ input, segment }: { input: VideoInput; segment: Extract<Segment, { kind: "statement" }> }) {
  const rise = useRise(input);
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const tall = input.aspect === "9x16";
  const { palette, look, motion } = input.edl.style;
  const text = inLang(segment.text, input.lang);
  const size = height * (tall ? 0.05 : 0.085);
  const kicker = segment.kicker && (
    <div
      style={{
        ...rise(0),
        color: readable(palette.accent, look.statement === "panel" ? palette.accent : palette.bg),
        fontSize: height * 0.028,
        fontWeight: 700,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
      }}
    >
      {inLang(segment.kicker, input.lang)}
    </div>
  );
  const type: CSSProperties = {
    fontFamily: "var(--display)",
    fontSize: size,
    fontWeight: 780,
    letterSpacing: "-0.025em",
    lineHeight: 1.04,
    maxWidth: "88%",
  };

  if (look.statement === "panel") {
    const p = Math.max(0, Math.min(1, eased(motion, frame / fps / (motion.durations.standard * motion.cameraScale))));
    const ink = readable(palette.bg, palette.accent);
    return (
      <AbsoluteFill style={{ background: palette.bg }}>
        <AbsoluteFill style={{ background: palette.accent, clipPath: `inset(0 ${(1 - p) * 100}% 0 0)` }} />
        <AbsoluteFill
          style={{
            alignItems: "center",
            justifyContent: "center",
            textAlign: "center",
            padding: height * 0.1,
            gap: height * 0.03,
            color: ink,
          }}
        >
          {segment.kicker && (
            <div
              style={{
                ...rise(0.1),
                fontSize: height * 0.028,
                fontWeight: 700,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                opacity: 0.8,
              }}
            >
              {inLang(segment.kicker, input.lang)}
            </div>
          )}
          <div style={{ ...rise(0.15), ...type }}>{text}</div>
        </AbsoluteFill>
      </AbsoluteFill>
    );
  }
  if (look.statement === "outline") {
    const fill = Math.max(0, Math.min(1, eased(motion, (frame / fps - 0.35) / (motion.durations.slow * 1.5))));
    return (
      <Layout input={input} align="center">
        {kicker}
        <div
          style={{
            ...rise(0.08),
            ...type,
            fontSize: size * 1.1,
            WebkitTextStroke: `${Math.max(1.5, height * 0.0022)}px ${palette.fg}`,
            color: "transparent",
            backgroundImage: `linear-gradient(90deg, ${palette.fg} ${fill * 100}%, transparent ${fill * 100}%)`,
            WebkitBackgroundClip: "text",
            backgroundClip: "text",
          }}
        >
          {text}
        </div>
      </Layout>
    );
  }
  if (look.statement === "editorial") {
    const number = input.edl.segments.filter((s) => s.kind === "statement").findIndex((s) => s.id === segment.id) + 1;
    return (
      <Layout input={input} align="left">
        <div
          style={{
            ...rise(0),
            fontFamily: "var(--display)",
            fontSize: height * 0.04,
            fontWeight: 600,
            color: readable(palette.accent, palette.bg),
          }}
        >
          {String(number).padStart(2, "0")}
        </div>
        {kicker}
        <div style={{ ...rise(0.08), ...type, maxWidth: width * 0.7 }}>{text}</div>
        <Rule input={input} delay={0.3} />
      </Layout>
    );
  }
  return (
    <Layout input={input} align="center">
      {kicker}
      <div style={{ ...rise(0.08), ...type }}>{text}</div>
    </Layout>
  );
}

/** A number that counts up, with its label. */
export function Stat({ input, segment }: { input: VideoInput; segment: Extract<Segment, { kind: "stat" }> }) {
  const rise = useRise(input);
  const frame = useCurrentFrame();
  const { fps, height } = useVideoConfig();
  const { motion, palette } = input.edl.style;
  const value = segment.value * eased(motion, frame / fps / (motion.durations.slow * motion.cameraScale));
  return (
    <Layout input={input} align="center">
      <div
        style={{
          fontFamily: "var(--display)",
          fontSize: height * 0.16,
          fontWeight: 800,
          color: readable(palette.accent, palette.bg),
          letterSpacing: "-0.03em",
        }}
      >
        {segment.prefix}
        {value.toFixed(segment.decimals ?? 0)}
        {segment.suffix}
      </div>
      <div style={{ ...rise(0.2), fontSize: height * 0.04, fontWeight: 600 }}>{inLang(segment.label, input.lang)}</div>
    </Layout>
  );
}

/**
 * The closing montage: up to four payoff moments side by side in tilted windows that fan in one after
 * another and drift, with an optional line under them.
 */
export function Montage({ input, segment }: { input: VideoInput; segment: Extract<Segment, { kind: "montage" }> }) {
  const rise = useRise(input);
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const { viewport } = input.footage.timeline;
  const { motion, look } = input.edl.style;
  const clips = segment.clips.slice(0, 4);
  const tall = input.aspect === "9x16";
  const tileW = tall ? width * 0.78 : Math.min(width * 0.36, (width * 0.9) / clips.length);
  const tileH = (tileW * viewport.h) / viewport.w;
  const overlap = tall ? 0 : -tileW * 0.08;
  return (
    <Layout input={input} align="center">
      <div
        style={{
          display: "flex",
          flexDirection: tall ? "column" : "row",
          gap: tall ? height * 0.02 : 0,
          perspective: width * 1.6,
        }}
      >
        {clips.map((clip, i) => {
          const t = Math.min(clip.out, clip.in + frame / fps);
          const p = Math.max(
            0,
            Math.min(1, eased(motion, (frame / fps - i * 0.12) / (motion.durations.standard * motion.cameraScale))),
          );
          const drift = Math.sin((frame / fps + i) / 3);
          const centre = (clips.length - 1) / 2;
          const angle = tall ? 0 : (i - centre) * -9 + drift * 1.5;
          return (
            <div
              key={i}
              style={{
                width: tileW,
                height: tileH,
                marginLeft: i ? overlap : 0,
                borderRadius: look.radius * (height / 1080),
                overflow: "hidden",
                opacity: p,
                zIndex: clips.length - Math.abs(Math.round(i - centre)),
                transform: `rotateY(${angle}deg) rotateX(${tall ? 0 : 5}deg) translateY(${(1 - p) * height * 0.08}px) scale(${0.92 + 0.08 * p})`,
                boxShadow: "0 24px 60px rgba(0,0,0,.4)",
              }}
            >
              <div
                style={{
                  width: viewport.w,
                  height: viewport.h,
                  transformOrigin: "0 0",
                  transform: `scale(${tileW / viewport.w})`,
                }}
              >
                <Freeze frame={Math.round(t * fps)}>
                  <OffthreadVideo src={input.footage.src} muted style={{ width: viewport.w, height: viewport.h }} />
                </Freeze>
              </div>
            </div>
          );
        })}
      </div>
      {segment.text && (
        <div style={{ ...rise(0.4), fontFamily: "var(--display)", fontSize: height * 0.05, fontWeight: 720 }}>
          {inLang(segment.text, input.lang)}
        </div>
      )}
    </Layout>
  );
}
