import { copyFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative } from "node:path";
import type { z } from "zod";
import { command, detectCli } from "../cli.ts";
import { claudeEnv } from "../env.ts";
import { LlmError, classify } from "../errors.ts";
import { DEFAULT_AGENT_TIMEOUT, DEFAULT_JSON_TIMEOUT, askValidated, withTaskDir } from "../json.ts";
import { jsonSchemaOf } from "../schema.ts";
import { run } from "../spawn.ts";
import type { AgentResult, AgentTask, JsonTask, LlmBackend, OnEvent } from "../types.ts";

// Claude Code, headless (`claude -p`) on the person's own login (PRD §9.9).
// Every call: --restricted (no Bash/WebFetch unless named, user/project settings ignored, file tools
// confined to the working dirs) and --strict-mcp-config (none of the person's MCP servers). Never --bare:
// it forces API-key auth and breaks subscription logins.

const LOCKED = ["-p", "--restricted", "--strict-mcp-config"];
const FILE_TOOLS = ["Read", "Write", "Edit", "Glob", "Grep"];
const bin = () => process.env.AGENTCAST_CLAUDE_BIN || "claude";
const LABEL = "Claude Code";

type ResultMessage = { type: "result"; is_error?: boolean; result?: string; session_id?: string; structured_output?: unknown };

export const claudeCode: LlmBackend = {
  name: "claude-code",

  detect: () => detectCli({ bin: bin(), env: claudeEnv(), label: LABEL }),

  json<S extends z.ZodType>(task: JsonTask<S>, model: string | undefined, onEvent?: OnEvent) {
    return withTaskDir(async (dir) => {
      // Restricted mode only reads inside the working dir, so screenshots are copied in.
      const images: string[] = [];
      for (const [i, image] of (task.images ?? []).entries()) {
        const name = `image-${i + 1}-${basename(image)}`;
        await copyFile(image, join(dir, name));
        images.push(name);
      }
      const schema = JSON.stringify(jsonSchemaOf(task.schema));
      const args = [
        ...LOCKED,
        "--tools", images.length ? "Read" : "",
        "--permission-mode", "dontAsk",
        "--output-format", "json",
        "--no-session-persistence",
        "--json-schema", schema,
        ...(model ? ["--model", model] : []),
      ];
      const result = await askValidated(task, async (prompt) => {
        const input = images.length ? `${prompt}\n\nLook at these image files in the working directory: ${images.join(", ")}` : prompt;
        const r = await run({
          ...command(bin(), args),
          cwd: dir,
          env: claudeEnv(),
          input,
          timeoutMs: task.timeoutMs ?? DEFAULT_JSON_TIMEOUT,
          signal: task.signal,
          label: LABEL,
        });
        let message: ResultMessage | undefined;
        try {
          message = JSON.parse(r.stdout) as ResultMessage;
        } catch {}
        if (!message || r.code !== 0 || message.is_error) throw classify(LABEL, `${message?.result ?? ""}\n${r.stderr}\n${r.stdout}`);
        if (message.structured_output === undefined) throw new LlmError("llm.invalid", `${LABEL} returned no structured output`, message.result);
        return message.structured_output;
      });
      onEvent?.({ kind: "done", text: "Answer checked" });
      return result;
    });
  },

  async agent(task: AgentTask, model: string | undefined, onEvent?: OnEvent): Promise<AgentResult> {
    const commands = task.allowCommands ?? [];
    const outside = [...new Set((task.images ?? []).map(dirname).filter((d) => relative(task.cwd, d).startsWith("..")))];
    const args = [
      ...LOCKED,
      "--tools", [...FILE_TOOLS, ...(commands.length ? ["Bash"] : [])].join(","),
      ...(commands.length ? ["--allowedTools", ...commands.map((c) => `Bash(${c}:*)`)] : []),
      ...outside.flatMap((d) => ["--add-dir", d]),
      "--permission-mode", "acceptEdits",
      "--output-format", "stream-json",
      "--verbose",
      ...(model ? ["--model", model] : []),
      ...(task.resume ? ["--resume", task.resume] : []),
    ];
    const prompt = task.images?.length ? `${task.prompt}\n\nLook at these images: ${task.images.join(", ")}` : task.prompt;
    let sessionId = task.resume ?? "";
    let final: ResultMessage | undefined;
    const short = (p: unknown) => (typeof p === "string" ? (isAbsolute(p) ? relative(task.cwd, p) : p) : "");

    const r = await run({
      ...command(bin(), args),
      cwd: task.cwd,
      env: claudeEnv(),
      input: prompt,
      timeoutMs: task.timeoutMs ?? DEFAULT_AGENT_TIMEOUT,
      signal: task.signal,
      label: LABEL,
      onLine(line) {
        let e: any;
        try {
          e = JSON.parse(line);
        } catch {
          return;
        }
        if (e.session_id) sessionId = e.session_id;
        if (e.type === "assistant") {
          for (const c of e.message?.content ?? []) {
            if (c.type === "text" && c.text?.trim()) onEvent?.({ kind: "text", text: c.text.trim().slice(0, 500) });
            if (c.type === "tool_use") {
              const target = short(c.input?.file_path) || c.input?.pattern || c.input?.command || "";
              onEvent?.({ kind: "tool_use", text: `${c.name} ${target}`.trim() });
            }
          }
        }
        if (e.type === "result") final = e;
      },
    });
    if (!final || r.code !== 0 || final.is_error) {
      const err = classify(LABEL, `${final?.result ?? ""}\n${r.stderr}`);
      onEvent?.({ kind: "error", text: err.message });
      throw err;
    }
    onEvent?.({ kind: "done", text: final.result?.slice(0, 500) ?? "" });
    return { sessionId, text: final.result ?? "" };
  },
};
