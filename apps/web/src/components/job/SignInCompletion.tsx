"use client";

import { useState } from "react";
import { finishSignIn } from "@/lib/api";

export default function SignInCompletion({ jobId, attempt }: { jobId: string; attempt: number }) {
  const [status, setStatus] = useState<"ready" | "sending" | "sent">("ready");
  const [error, setError] = useState<string>();

  return (
    <div className="mt-4 space-y-3 text-sm">
      <p className="max-w-prose text-white/80">
        Sign in through the Chrome window on the worker&apos;s machine. When your product dashboard
        is visible, press the button below or close that window. Your password stays in Chrome.
      </p>
      <button
        type="button"
        disabled={status !== "ready"}
        onClick={async () => {
          setError(undefined);
          setStatus("sending");
          try {
            await finishSignIn(jobId, attempt);
            setStatus("sent");
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : "Could not confirm sign-in. Try again.");
            setStatus("ready");
          }
        }}
        className="min-h-11 rounded-full bg-white px-5 py-2 font-semibold text-black transition-colors hover:bg-white/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white disabled:opacity-50"
      >
        {status === "ready" ? "I'm signed in" : status === "sending" ? "Confirming…" : "Saving session…"}
      </button>
      {status === "sent" && (
        <p role="status" className="text-white/70">
          Saving your session and sharing it with the exploration agents. Chrome may take up to
          30 seconds to save its cookies.
        </p>
      )}
      {error && <p role="alert" className="text-red-300">{error}</p>}
    </div>
  );
}
