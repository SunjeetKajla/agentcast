"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ApiError, createJob } from "@/lib/api";
import { DEFAULT_CHOICES, parseComposer, toJobConfig, type ComposerChoices } from "@/lib/compose";

// The landing page is one composer spread over several sections: the hero's link box, the big link
// line in "Try a link", and the switches all edit the same choices, and any of them can start the job.

type Composer = {
  choices: ComposerChoices;
  set: (patch: Partial<ComposerChoices>) => void;
  /** The link in "Try a link" (the hero's box hands its link over here too). */
  link: string;
  setLink: (v: string) => void;
  prompt: string;
  setPrompt: (v: string) => void;
  /** What the video should focus on (JobConfig.focusPrompt), optional. */
  focus: string;
  setFocus: (v: string) => void;
  /** Starts a job from text holding a link (and optionally words about the video), then opens it. */
  start: (text: string, extraPrompt?: string) => Promise<void>;
  busy: boolean;
  error?: string;
};

const Ctx = createContext<Composer | null>(null);

export function ComposerProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [choices, setChoices] = useState<ComposerChoices>({ ...DEFAULT_CHOICES });
  const [link, setLink] = useState("");
  const [prompt, setPrompt] = useState("");
  const [focus, setFocus] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const set = useCallback((patch: Partial<ComposerChoices>) => setChoices((c) => ({ ...c, ...patch })), []);

  const start = useCallback(
    async (text: string, extraPrompt = "") => {
      const { url, prompt: words } = parseComposer(text);
      if (!url) {
        setError("Paste your product’s link, like linear.app or https://your-product.com.");
        return;
      }
      setBusy(true);
      setError(undefined);
      try {
        const job = await createJob(toJobConfig(url, [words, extraPrompt].filter(Boolean).join(". "), choices, focus));
        router.push(`/jobs/${job.id}`);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Couldn’t start the job. Try again.");
        setBusy(false);
      }
    },
    [choices, focus, router],
  );

  const value = useMemo(
    () => ({ choices, set, link, setLink, prompt, setPrompt, focus, setFocus, start, busy, error }),
    [choices, set, link, prompt, focus, start, busy, error],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useComposer(): Composer {
  const c = useContext(Ctx);
  if (!c) throw new Error("useComposer outside ComposerProvider");
  return c;
}

export const LANG_NAME = { en: "English", hi: "Hindi" } as const;
export const SIZE = { "16x9": "16:9", "9x16": "9:16" } as const;

/** Every video the choices make, in the worker's order (aspect, then language). */
export function outputsOf(c: ComposerChoices) {
  return c.aspects.flatMap((a) => c.langs.map((l) => ({ id: `${a}-${l}`, size: SIZE[a], lang: LANG_NAME[l], dims: a === "16x9" ? "1920 × 1080" : "1080 × 1920" })));
}

/** "16:9 in English and 9:16 in English" */
export function sayOutputs(c: ComposerChoices): string {
  const list = outputsOf(c).map((o) => `${o.size} in ${o.lang}`);
  return list.length > 1 ? `${list.slice(0, -1).join(", ")} and ${list.at(-1)}` : (list[0] ?? "");
}
