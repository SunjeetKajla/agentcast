#!/usr/bin/env node
// A stand-in for `claude` in tests, so they spend no quota. Output mirrors Claude Code 2.1.310.
// FAKE_LOG: append one JSON line per call (args, cwd, stdin, env names). FAKE_STATE: call counter file.
// FAKE_MODES: comma list, one per call (last repeats): ok | invalid | auth | limit | hang | crash.
// FAKE_ANSWER: the JSON answer. FAKE_EDIT: {"path","content"} an agent call writes into its cwd.
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
if (args.includes("--version")) {
  console.log(`${process.env.FAKE_VERSION ?? "2.1.310"} (Claude Code)`);
  process.exit(0);
}

const stdin = readFileSync(0, "utf8");
const state = process.env.FAKE_STATE;
const call = state && existsSync(state) ? Number(readFileSync(state, "utf8")) + 1 : 0;
if (state) writeFileSync(state, String(call));
const modes = (process.env.FAKE_MODES ?? "ok").split(",");
const mode = modes[Math.min(call, modes.length - 1)];
if (process.env.FAKE_LOG) {
  appendFileSync(process.env.FAKE_LOG, JSON.stringify({ args, cwd: process.cwd(), stdin, env: Object.keys(process.env) }) + "\n");
}

const out = (o) => console.log(JSON.stringify(o));
const flag = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const sessionId = flag("--resume") ?? "fake-claude-session";

if (mode === "hang") setInterval(() => {}, 1000);
else if (mode === "crash") {
  process.stderr.write("something broke\n");
  process.exit(2);
} else if (mode === "auth" || mode === "limit") {
  const result = mode === "auth" ? "Not logged in · Please run /login" : "Claude AI usage limit reached|1792900000";
  out({ type: "result", subtype: "error", is_error: true, result, session_id: sessionId });
  process.exit(1);
} else if (flag("--output-format") === "json") {
  const answer = mode === "invalid" ? { wrong: true } : JSON.parse(process.env.FAKE_ANSWER ?? "{}");
  out({ type: "result", subtype: "success", is_error: false, result: "", session_id: sessionId, structured_output: answer });
} else {
  out({ type: "system", subtype: "init", session_id: sessionId, tools: (flag("--tools") ?? "").split(","), apiKeySource: "none" });
  const edit = process.env.FAKE_EDIT ? JSON.parse(process.env.FAKE_EDIT) : undefined;
  if (edit) {
    const file = join(process.cwd(), edit.path);
    out({ type: "assistant", message: { content: [{ type: "tool_use", name: "Edit", input: { file_path: file } }] }, session_id: sessionId });
    writeFileSync(file, edit.content);
    out({ type: "user", message: { content: [{ type: "tool_result", content: "ok" }] }, session_id: sessionId });
  }
  out({ type: "assistant", message: { content: [{ type: "text", text: "Done." }] }, session_id: sessionId });
  out({ type: "result", subtype: "success", is_error: false, result: "Done.", session_id: sessionId });
}
