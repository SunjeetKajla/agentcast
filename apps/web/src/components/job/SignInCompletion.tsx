"use client";

import { useState } from "react";
import { finishSignIn } from "@/lib/api";

export default function SignInCompletion({ jobId, attempt }: { jobId: string; attempt: number }) {
  const [status, setStatus] = useState<"ready" | "sending" | "sent">("ready");
  const [error, setError] = useState<string>();

  return (
    <div className="signin">
      <p>
        Sign in through the Chrome window on the worker’s machine. When your product’s dashboard is showing, press the
        button or close that window. Your password stays in Chrome.
      </p>
      <button
        type="button"
        className="ab ab-f"
        disabled={status !== "ready"}
        onClick={async () => {
          setError(undefined);
          setStatus("sending");
          try {
            await finishSignIn(jobId, attempt);
            setStatus("sent");
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : "Couldn’t confirm the sign-in. Try again.");
            setStatus("ready");
          }
        }}
      >
        {status === "ready" ? "I’m signed in" : status === "sending" ? "Confirming…" : "Saving the session…"}
      </button>
      {status === "sent" && (
        <p role="status">Saving your session and sharing it with the agents. Chrome can take up to 30 seconds to save its cookies.</p>
      )}
      {error && <p role="alert" className="field-err">{error}</p>}
    </div>
  );
}
