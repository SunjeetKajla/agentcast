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

Each task owns an isolated Chrome process/profile and harness home/runtime. Its stdio MCP proxy talks to a private token-authenticated loopback endpoint in the worker. Browser state stays in the worker. Public progress PNGs and validated v2 action traces go under `explore/frames/<task>/` and `explore/traces/<task>.json`; authenticated runs do not publish live PNGs. Traces preserve actual semantic names, nearby headings, canonical select values, verified outcomes and executor timings. The same target resolver is used for exploration, fresh rehearsal and filming.

Exploration uses verified GPU Chrome, preferring dGPU → iGPU → CPU. `AGENTCAST_BROWSER_GPU=auto|dgpu|igpu|cpu` sets the preference. Each launch probes WebGL and CDP compositing before restoring sessions; `explore/runtime/<task>.json` records the actual renderer, acceleration status and fallback attempts. Hardware unavailability is reported explicitly. The page environment matches the recorder, including production `tsx` callback initialization.

The model gets `observe`, `navigate`, `act`, `act_sequence` and `submit`. Harness supplies observations and observed-link navigation; trusted worker Playwright actions use semantic locators and outcome checks. `waitFor` can await a specific URL, visible text, element, value or state change. Short sequences allow up to three type/press/scroll/wait actions and omit intermediate screenshots, reducing model round trips; every sub-action is still checked and traced. A failure or early navigation stops the sequence. `observe` can use `screenshot:false` for text-only checks. An executed action with an unverified outcome remains in the trace and prevents a completed report.

Confirmed actions/navigation remain in the trace even if the next observation fails; old screenshots are never reused as after-frames. Post-dispatch timeouts are recorded as uncertain/unverified instead of claiming nothing happened. Actual keyboard focus, link destinations and native form submissions are checked for both key activation and submit-button clicks.

Discovery inventories safe root navigation and supplements scouts in unvisited sections. Defaults: six candidate flows, 12 sections and three scouts; set `AGENTCAST_EXPLORE_MAX_FLOWS` (max 12), `AGENTCAST_EXPLORE_MAX_SECTIONS` (max 24) and `AGENTCAST_EXPLORE_MAX_SCOUTS` (max four). Film selection remains at most four flows. Validated `explore/coverage.json` distinguishes discovered links, deterministic inspection, trace-confirmed visits/actions, replayed flows, barriers, tours and unvisited areas; it never claims an exhaustive crawl.

Recording reports failure kinds and retry eligibility in `record/desktop/diagnostics.json`. Deterministic locator/action/outcome failures stop after one take unless healing is enabled. Capture failures retain bounded retakes. Numeric lifecycle evidence explains navigation/loading gaps outside motion without relaxing the strict motion-stall checks.

Set `AGENTCAST_EXPLORE_VIDEO=1` on the worker to retain full public exploration sessions as WebM files under `explore/videos/<task>/`. Provision Playwright's FFmpeg capture binary before enabling this option; request handlers never download it. These videos show the actual scout, focused runs and repairs, including loading and model thinking time; they are separate from clean replay takes under `record/desktop/takes/`. Recording stays off when a task restores signed-in state. Browser context cleanup finalizes the videos on success or failure.

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
