# Local exploration implementation

`understand` reads visible product content using the local browser adapter. `discover` and `flow-runs` use `@agentcast/browser`, with model calls exclusively through the existing `packages/llm` runner and the user's selected CLI login. Fixture stages remain explicit (`AGENTCAST_STAGE_MODE=stub`); provider failures never become fixture successes.

The worker scouts the real entrance, proposes up to three candidates, executes focused flows in isolated Chrome sessions (two concurrent), and independently rehearses every report with the recorder adapter. One repair is available for a completed report that fails normalization or local rehearsal. Interrupted browser actions are never automatically replayed. Guided-tour fallback, scoring, flow edits and user-added flows retain their existing behavior.

Sign-in-once opens ordinary local Chrome. Completion is stage/attempt-scoped and seals only the authorized site's state with AES-256-GCM. Exploration, independent rehearsal and recording restore this state locally. No remote profile upload or credential store is used. New jobs support public or sign-in-once authentication; legacy jobs without a local session need a fresh sign-in-once job.

Task checkpoints are v2 and contain an input hash, local attempt ID, status, optional CLI session ID, validated result and safe error. Actual browser evidence is a v1 trace; shared flows are v2 with `agentRunId`. Existing minimal schema readers accept older artifact shapes. There is no remote-task resumption workflow.

See `packages/browser/README.md` for setup, tool boundaries, limitations and live checks. `spikes/RESULTS.md` records actual verification. The existing local page-evaluation adapter still handles the tsx compiler's `__name` helper and client navigation races. Credential targets are blocked and local rehearsal remains authoritative.
