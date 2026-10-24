// The child process's environment: everything the CLI needs to find its own login, and no secrets
// of ours (AGENTS.md rule 5). An API key left in the environment could also make a CLI bill that key
// instead of the person's subscription (PRD §9.9).

const SECRET = /(_API_KEY|_SECRET|_SECRET_KEY|_TOKEN|_PASSWORD)$/;
const ALWAYS_DROP = new Set(["AGENTCAST_SECRET", "TINYFISH_API_KEY", "ELEVENLABS_API_KEY"]);

export function childEnv(keep: string[] = []): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (value === undefined || ALWAYS_DROP.has(name)) continue;
    if (SECRET.test(name) && !keep.includes(name)) continue;
    env[name] = value;
  }
  return env;
}

/** ANTHROPIC_API_KEY reaches Claude Code only when AGENTCAST_CLAUDE_USE_API_KEY=1. */
export const claudeEnv = () =>
  childEnv(process.env.AGENTCAST_CLAUDE_USE_API_KEY === "1" ? ["ANTHROPIC_API_KEY"] : []);

/** OPENAI_API_KEY / CODEX_API_KEY reach Codex only when AGENTCAST_CODEX_USE_API_KEY=1. */
export const codexEnv = () =>
  childEnv(process.env.AGENTCAST_CODEX_USE_API_KEY === "1" ? ["OPENAI_API_KEY", "CODEX_API_KEY"] : []);
