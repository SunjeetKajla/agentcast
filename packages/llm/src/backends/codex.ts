import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { z } from "zod";
import { command, detectCli } from "../cli.ts";
import { codexEnv } from "../env.ts";
import { LlmError, classify } from "../errors.ts";
import { DEFAULT_AGENT_TIMEOUT, DEFAULT_JSON_TIMEOUT, askValidated, withTaskDir } from "../json.ts";
import { jsonSchemaOf, restore, strictSchema } from "../schema.ts";
import { run } from "../spawn.ts";
import type { AgentResult, AgentTask, JsonTask, LlmBackend, OnEvent } from "../types.ts";
import { renderSnapshot, snapshot } from "../workspace.ts";

// Codex CLI (`codex exec`) on the person's own `codex login` (PRD §9.9). Needs 0.163+.
// Every call is locked down: the person's config, rules and AGENTS.md files are ignored, the shell and every
// other tool that reaches outside (web search, plugins, apps, MCP, browser, computer use, sub-agents) is off,
// and approvals are "never". JSON tasks run read-only; agent tasks may only write inside their workspace,
// edit with apply_patch, and get the workspace's files from us because they can't read them with a shell.

const bin = () => process.env.AGENTCAST_CODEX_BIN || "codex";
const LABEL = "Codex";
const MIN: [number, number, number] = [0, 163, 0];

const OFF = [
  "shell_tool",
  "unified_exec",
  "shell_snapshot",
  "plugins",
  "remote_plugin",
  "apps",
  "hooks",
  "multi_agent",
  "browser_use",
  "browser_use_external",
  "computer_use",
  "image_generation",
  "skill_search",
  "tool_suggest",
  "memories",
];

const LOCKDOWN = [
  "--skip-git-repo-check",
  "--ignore-user-config",
  "--ignore-rules",
  ...OFF.flatMap((f) => ["--disable", f]),
  "-c", 'web_search="disabled"',
  "-c", "project_doc_max_bytes=0",
  "-c", "sandbox_workspace_write.network_access=false",
];

const AGENT_RULES =
  "You can't run commands, and you can't read files yourself. The workspace's text files are below, one JSON " +
  "record ({path, content}) per line inside <workspace_files>; images in it are attached. Make your changes with " +
  "apply_patch, using paths relative to the workspace, and only inside it.";

/** Claude-style model aliases mean nothing to Codex; it uses its own default then. */
const codexModel = (model: string | undefined) => (model && !/^(opus|sonnet|haiku)$/.test(model) ? model : undefined);

type Events = { sessionId?: string; lastMessage?: string; errors: string[] };

function parseEvent(line: string, state: Events, onEvent?: OnEvent): void {
  let e: any;
  try {
    e = JSON.parse(line);
  } catch {
    return;
  }
  if (e.type === "thread.started" && e.thread_id) state.sessionId = e.thread_id;
  if (e.type === "item.completed" && e.item) {
    const item = e.item;
    if (item.type === "agent_message" && item.text) {
      state.lastMessage = item.text;
      onEvent?.({ kind: "text", text: String(item.text).trim().slice(0, 500) });
    }
    if (item.type === "file_change") {
      const paths = (item.changes ?? []).map((c: { path?: string }) => c.path).filter(Boolean);
      onEvent?.({ kind: "tool_use", text: `Edit ${paths.join(", ")}`.trim() });
    }
  }
  if (e.type === "turn.failed") state.errors.push(e.error?.message ?? "turn failed");
  if (e.type === "error") state.errors.push(e.message ?? "error");
}

export const codex: LlmBackend = {
  name: "codex",

  detect: () => detectCli({ bin: bin(), env: codexEnv(), label: LABEL, min: MIN }),

  json<S extends z.ZodType>(task: JsonTask<S>, model: string | undefined, onEvent?: OnEvent) {
    return withTaskDir(async (dir) => {
      const original = jsonSchemaOf(task.schema);
      const schemaFile = join(dir, "schema.json");
      const answerFile = join(dir, "answer.json");
      await writeFile(schemaFile, JSON.stringify(strictSchema(original)));
      const m = codexModel(model);
      const args = [
        "-a", "never",
        "exec",
        "--json",
        "--ephemeral",
        "--sandbox", "read-only",
        ...LOCKDOWN,
        "--output-schema", schemaFile,
        "-o", answerFile,
        "-C", dir,
        ...(m ? ["-m", m] : []),
        ...(task.images ?? []).map((i) => `--image=${i}`),
        "-",
      ];
      const result = await askValidated(task, async (prompt) => {
        const state: Events = { errors: [] };
        await writeFile(answerFile, "");
        const r = await run({
          ...command(bin(), args),
          cwd: dir,
          env: codexEnv(),
          input: prompt,
          timeoutMs: task.timeoutMs ?? DEFAULT_JSON_TIMEOUT,
          signal: task.signal,
          label: LABEL,
          onLine: (line) => parseEvent(line, state),
        });
        const text = (await readFile(answerFile, "utf8")).trim();
        if (r.code !== 0 || state.errors.length || !text) throw classify(LABEL, `${state.errors.join("\n")}\n${r.stderr}`);
        try {
          return restore(original, JSON.parse(text));
        } catch {
          throw new LlmError("llm.invalid", `${LABEL}'s answer isn't JSON`, text.slice(0, 800));
        }
      });
      onEvent?.({ kind: "done", text: "Answer checked" });
      return result;
    });
  },

  async agent(task: AgentTask, model: string | undefined, onEvent?: OnEvent): Promise<AgentResult> {
    const snap = await snapshot(task.cwd);
    const m = codexModel(model);
    const images = [...snap.images, ...(task.images ?? [])].map((i) => `--image=${i}`);
    const args = [
      "-a", "never",
      "exec",
      "--json",
      "--sandbox", "workspace-write",
      "-c", 'sandbox_mode="workspace-write"',
      ...LOCKDOWN,
      "-C", task.cwd,
      ...(m ? ["-m", m] : []),
      ...(task.resume ? ["resume", task.resume] : []),
      ...images,
      "-",
    ];
    const state: Events = { sessionId: task.resume, errors: [] };
    const r = await run({
      ...command(bin(), args),
      cwd: task.cwd,
      env: codexEnv(),
      input: `${task.prompt}\n\n${AGENT_RULES}\n\n${renderSnapshot(snap)}`,
      timeoutMs: task.timeoutMs ?? DEFAULT_AGENT_TIMEOUT,
      signal: task.signal,
      label: LABEL,
      onLine: (line) => parseEvent(line, state, onEvent),
    });
    if (r.code !== 0 || state.errors.length || !state.sessionId) {
      const err = classify(LABEL, `${state.errors.join("\n")}\n${r.stderr}`);
      onEvent?.({ kind: "error", text: err.message });
      throw err;
    }
    onEvent?.({ kind: "done", text: state.lastMessage?.slice(0, 500) ?? "" });
    return { sessionId: state.sessionId, text: state.lastMessage ?? "" };
  },
};
