link in. video out.

## Setup

1. Node 22+, pnpm, ffmpeg and Google Chrome.
2. `pnpm install`
3. `cp .env.example .env` and fill in `TINYFISH_API_KEY` and `ELEVENLABS_API_KEY`.
4. A coding agent, installed and logged in. **No LLM API key is needed**: AgentCast drives your own CLI login.
   - **Claude Code** (default): install it and run `claude` once to log in.
   - **Codex**: `npm i -g @openai/codex` (0.163+), then `codex login`.

   `AGENTCAST_LLM=auto` (the default) uses Claude Code if it's installed, else Codex. Set `AGENTCAST_LLM=codex` or `claude-code` to choose.
5. `pnpm dev:worker`

See `AGENTS.md` for commands and `PRD.md` for how it works.
