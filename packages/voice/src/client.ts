/** ElevenLabs text to speech with timings, and speech to text for checks (elevenlabs.io/docs). Worker-only: the key stays here. */

export const ELEVENLABS_API = "https://api.elevenlabs.io";

export type Alignment = {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
};

export type VoiceSettings = {
  stability?: number;
  similarity_boost?: number;
  style?: number;
  speed?: number;
  use_speaker_boost?: boolean;
};

export type SpeakRequest = {
  voiceId: string;
  text: string;
  /** Default eleven_multilingual_v2 (Hindi + English, timings supported). */
  modelId?: string;
  /** ISO 639-1. Not accepted by multilingual_v2, which detects the language itself. */
  languageCode?: string;
  /** Neighbouring lines, so separately generated clips sound continuous. */
  previousText?: string;
  nextText?: string;
  seed?: number;
  voiceSettings?: VoiceSettings;
};

export type Speech = {
  audio: Buffer;
  /** Per character of the text as sent. */
  alignment: Alignment;
  requestId?: string;
  ms: number;
};

export type Transcript = {
  text: string;
  languageCode?: string;
  words: Array<{ text: string; start: number; end: number; type?: string }>;
};

export class VoiceError extends Error {
  override name = "VoiceError";
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
  }
  get retryable() {
    return this.status === 429 || this.status >= 500;
  }
}

export type ElevenLabsOptions = { apiKey?: string; baseUrl?: string };

export class ElevenLabs {
  private readonly key: string;
  private readonly base: string;

  constructor(opts: ElevenLabsOptions = {}) {
    const key = opts.apiKey ?? process.env.ELEVENLABS_API_KEY;
    if (!key)
      throw new VoiceError(
        "ELEVENLABS_API_KEY is not set. Add it to .env.",
        401,
        "missing_api_key",
      );
    this.key = key;
    this.base = opts.baseUrl ?? ELEVENLABS_API;
  }

  /** One clip with character timings (`/with-timestamps`). Retries once on rate limits and server errors. */
  async speak(r: SpeakRequest, signal?: AbortSignal): Promise<Speech> {
    const body = {
      text: r.text,
      model_id: r.modelId ?? "eleven_multilingual_v2",
      ...(r.languageCode ? { language_code: r.languageCode } : {}),
      ...(r.previousText ? { previous_text: r.previousText } : {}),
      ...(r.nextText ? { next_text: r.nextText } : {}),
      ...(r.seed !== undefined ? { seed: r.seed } : {}),
      ...(r.voiceSettings ? { voice_settings: r.voiceSettings } : {}),
    };
    for (let attempt = 1; ; attempt++) {
      const t0 = performance.now();
      const res = await fetch(
        `${this.base}/v1/text-to-speech/${encodeURIComponent(r.voiceId)}/with-timestamps?output_format=mp3_44100_128`,
        {
          method: "POST",
          headers: {
            "xi-api-key": this.key,
            "content-type": "application/json",
          },
          body: JSON.stringify(body),
          signal: AbortSignal.any([
            AbortSignal.timeout(90_000),
            ...(signal ? [signal] : []),
          ]),
        },
      );
      if (res.ok) {
        const json = (await res.json()) as {
          audio_base64: string;
          alignment: Alignment | null;
        };
        if (!json.alignment)
          throw new VoiceError(
            "The voice came back without timings.",
            502,
            "no_alignment",
          );
        return {
          audio: Buffer.from(json.audio_base64, "base64"),
          alignment: json.alignment,
          requestId: res.headers.get("request-id") ?? undefined,
          ms: Math.round(performance.now() - t0),
        };
      }
      const err = await toError(res, this.key);
      if (attempt >= 2 || !err.retryable) throw err;
      await new Promise<void>((resolve, reject) => {
        signal?.throwIfAborted();
        const abort = () => {
          clearTimeout(timer);
          reject(signal?.reason);
        };
        const timer = setTimeout(() => {
          signal?.removeEventListener("abort", abort);
          resolve();
        }, 1500);
        signal?.addEventListener("abort", abort, { once: true });
      });
    }
  }

  /** Speech to text (Scribe), used to check a clip says what it should. */
  async transcribe(
    audio: Buffer,
    o: { languageCode?: string; modelId?: string } = {},
    signal?: AbortSignal,
  ): Promise<Transcript> {
    const form = new FormData();
    form.set("model_id", o.modelId ?? "scribe_v2");
    if (o.languageCode) form.set("language_code", o.languageCode);
    form.set("timestamps_granularity", "word");
    form.set(
      "file",
      new Blob([new Uint8Array(audio)], { type: "audio/mpeg" }),
      "clip.mp3",
    );
    const res = await fetch(`${this.base}/v1/speech-to-text`, {
      method: "POST",
      headers: { "xi-api-key": this.key },
      body: form,
      signal: AbortSignal.any([
        AbortSignal.timeout(90_000),
        ...(signal ? [signal] : []),
      ]),
    });
    if (!res.ok) throw await toError(res, this.key);
    const json = (await res.json()) as {
      text: string;
      language_code?: string;
      words?: Transcript["words"];
    };
    return {
      text: json.text,
      languageCode: json.language_code,
      words: (json.words ?? []).filter((w) => w.type !== "spacing"),
    };
  }

  /** Plan and character usage (free; also validates the key). */
  async subscription(
    signal?: AbortSignal,
  ): Promise<{ tier: string; used: number; limit: number }> {
    const j = await this.get<{
      tier: string;
      character_count: number;
      character_limit: number;
    }>("/v1/user/subscription", signal);
    return { tier: j.tier, used: j.character_count, limit: j.character_limit };
  }

  /** A voice's name and category. Free plans can only use `premade` (and the account's own) voices through the API (spike S5). */
  async voice(
    voiceId: string,
    signal?: AbortSignal,
  ): Promise<{ name: string; category: string }> {
    const j = await this.get<{ name: string; category: string }>(
      `/v1/voices/${encodeURIComponent(voiceId)}`,
      signal,
    );
    return { name: j.name, category: j.category };
  }

  private async get<T>(path: string, signal?: AbortSignal): Promise<T> {
    const res = await fetch(`${this.base}${path}`, {
      headers: { "xi-api-key": this.key },
      signal: AbortSignal.any([
        AbortSignal.timeout(15_000),
        ...(signal ? [signal] : []),
      ]),
    });
    if (!res.ok) throw await toError(res, this.key);
    return (await res.json()) as T;
  }
}

async function toError(res: Response, key: string): Promise<VoiceError> {
  const text = await res.text().catch(() => "");
  let code: string | undefined;
  let message = text.slice(0, 300) || res.statusText;
  try {
    const body = JSON.parse(text) as {
      detail?: { status?: string; code?: string; message?: string } | string;
    };
    if (typeof body.detail === "object" && body.detail) {
      code = body.detail.code ?? body.detail.status;
      message = body.detail.message ?? message;
    } else if (typeof body.detail === "string") message = body.detail;
  } catch {}
  message = message.replaceAll(key, "[redacted]");
  return new VoiceError(
    `ElevenLabs ${res.status}${code ? ` ${code}` : ""}: ${message}`,
    res.status,
    code,
  );
}
