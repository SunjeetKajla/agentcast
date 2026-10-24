#!/usr/bin/env node
// A stand-in for `codex` in tests, so they spend no quota. Events mirror `codex exec --json` (0.164):
// thread.started, item.completed (agent_message, file_change), turn.completed / turn.failed.
// Same controls as fake-claude.mjs (FAKE_LOG, FAKE_STATE, FAKE_MODES, FAKE_ANSWER, FAKE_EDIT).
// The log also records the --output-schema file, since the runner deletes it afterwards.
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
if (args.includes("--version")) {
  console.log(`codex-cli ${process.env.FAKE_VERSION ?? "0.164.0"}`);
  process.exit(0);
}

const stdin = readFileSync(0, "utf8");
const state = process.env.FAKE_STATE;
const call = state && existsSync(state) ? Number(readFileSync(state, "utf8")) + 1 : 0;
if (state) writeFileSync(state, String(call));
const modes = (process.env.FAKE_MODES ?? "ok").split(",");
const mode = modes[Math.min(call, modes.length - 1)];
const flag = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const schemaFile = flag("--output-schema");
if (process.env.FAKE_LOG) {
  const schema = schemaFile ? JSON.parse(readFileSync(schemaFile, "utf8")) : undefined;
  appendFileSync(process.env.FAKE_LOG, JSON.stringify({ args, cwd: process.cwd(), stdin, env: Object.keys(process.env), schema }) + "\n");
}

const out = (o) => console.log(JSON.stringify(o));
const resume = args.includes("resume") ? args[args.indexOf("resume") + 1] : undefined;
const threadId = resume ?? "fake-codex-thread";

out({ type: "thread.started", thread_id: threadId });
out({ type: "turn.started" });
if (mode === "hang") setInterval(() => {}, 1000);
else if (mode === "crash") {
  process.stderr.write("something broke\n");
  process.exit(2);
} else if (mode === "auth" || mode === "limit") {
  const message = mode === "auth" ? "401 Unauthorized: run `codex login`" : "429 Too Many Requests: usage limit reached";
  out({ type: "error", message });
  out({ type: "turn.failed", error: { message } });
  process.exit(1);
} else if (schemaFile) {
  const answer = mode === "invalid" ? JSON.stringify({ wrong: true }) : (process.env.FAKE_ANSWER ?? "{}");
  writeFileSync(flag("-o"), answer);
  out({ type: "item.completed", item: { id: "item_0", type: "agent_message", text: answer } });
  out({ type: "turn.completed", usage: { input_tokens: 10, output_tokens: 5 } });
} else {
  const edit = process.env.FAKE_EDIT ? JSON.parse(process.env.FAKE_EDIT) : undefined;
  if (edit) {
    writeFileSync(join(process.cwd(), edit.path), edit.content);
    out({ type: "item.completed", item: { id: "item_0", type: "file_change", changes: [{ path: edit.path, kind: "update" }], status: "completed" } });
  }
  out({ type: "item.completed", item: { id: "item_1", type: "agent_message", text: "Done." } });
  out({ type: "turn.completed", usage: { input_tokens: 10, output_tokens: 5 } });
}
