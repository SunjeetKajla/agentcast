# Local browser exploration

AgentCast's logged-in Codex or Claude Code CLI drives Browser Harness through a task-owned MCP server. Python only executes fixed trusted helpers; models cannot submit Python, JavaScript, CDP or shell commands.

Setup (Python 3.12, `uv`, Google Chrome and Node 22+):

```bash
pnpm install
pnpm --filter @agentcast/browser setup
pnpm agentcast doctor
```

The Python dependency is pinned to Browser Harness 0.1.13 in `python/uv.lock`. Setup is explicit; worker requests never install dependencies. `AGENTCAST_BROWSER_PYTHON` can select an already-provisioned Python 3.12 environment with this exact harness version. `CHROME_PATH` can select a native Chrome executable. No Browser Use cloud or model API key is needed.

Set `AGENTCAST_LLM=codex` to select your logged-in Codex CLI. `auto` still prefers installed Claude Code; installation detection does not prove login. Restart the worker after changing `.env`. Browser tasks use the smart tier and the existing model overrides.

Each task owns an isolated Chrome process/profile and harness home/runtime. Its stdio MCP proxy talks to a private token-authenticated loopback endpoint in the worker. Browser state stays in the worker. Public progress PNGs and validated action traces go under `explore/frames/<task>/` and `explore/traces/<task>.json`; authenticated runs do not publish live PNGs. Traces supply the actual flow steps, then the existing Playwright rehearsal independently checks them.

Observe returns visible text, semantic target IDs and a screenshot when no visible credential form exists. The first implementation supports ordinary DOM controls in the main document; iframe and closed-shadow-root controls may need a future observation adapter. Unsupported controls fail rather than becoming invented actions. Actions remain bounded to authorized sites; CAPTCHA and external sign-in barriers require local manual sign-in. There is no cloud fallback.

Checks, using a local HTTP fixture and no provider quota:

```bash
AGENTCAST_TEST_BROWSER=1 pnpm exec vitest run packages/browser/src/browser.integration.test.ts
```

Optional real login smoke test (uses your selected CLI quota):

```bash
AGENTCAST_TEST_LLM=codex pnpm exec vitest run packages/browser/src/browser.integration.test.ts
AGENTCAST_TEST_LLM=claude-code pnpm exec vitest run packages/browser/src/browser.integration.test.ts
```

Full optional discovery → focused execution → independent rehearsal check (Codex quota):

```bash
AGENTCAST_TEST_PIPELINE=1 pnpm exec vitest run packages/explore/src/browser-pipeline.integration.test.ts
```

To run that full integration with Claude Code instead:

```bash
AGENTCAST_TEST_PIPELINE=1 AGENTCAST_TEST_PIPELINE_BACKEND=claude-code pnpm exec vitest run packages/explore/src/browser-pipeline.integration.test.ts
```

Browser-only public-site timing benchmark (scout plus every discovered workflow, capped at six per backend; two focused tasks at a time):

```bash
node --import tsx spikes/browser-harness-benchmark.ts --url https://linear.app/ --backend both --max-flows 6
```

The benchmark writes its report and validated traces into a temporary directory printed at startup. It measures MCP response latency, first-frame startup and end-to-end task time separately. It does not create a worker job, rehearse, record, narrate or render. Different scouts can identify different workflows, so one run is not a matched-workload speed ranking.
