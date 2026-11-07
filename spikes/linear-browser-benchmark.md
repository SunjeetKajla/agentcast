# Linear public Browser Harness benchmark — 2026-11-07

Target: https://linear.app/

Models: Codex CLI default; Claude Code smart tier `opus` alias. Both use existing logged-in CLI sessions.

Public website and demos only. No sign-in, account creation, workspace changes, rehearsal, recording, narration or rendering. Each browser task uses a fresh dedicated Chrome session. Two focused tasks run at a time; backends run sequentially.

## Comparison

| Measurement | Codex | Claude Code |
| --- | ---: | ---: |
| Discovery | 122.56 s | 138.05 s |
| All six focused attempts (two at a time) | 181.79 s | 102.03 s |
| Total wall time | **304.35 s (5m 04s)** | **240.08 s (4m 00s)** |
| Flows reported complete | **4/6** | **6/6** |
| Successful observation latency, median / p95 | 63 / 150 ms | 60 / 157 ms |
| Successful click latency, median / p95 | 354 / 526 ms | 341 / 439 ms |
| Successful navigation latency, median / p95 | 1064 / 2045 ms | 963 / 1155 ms |

These are different six-flow inventories, not a matched-workload or statistically repeated comparison. Completion means the browser agent submitted a completed report with an actual action trace; no independent rehearsal was run. The integration search in Claude's run returned a changelog entry rather than the requested integration card; that observed limitation is retained below. The code-diff demo was only attempted in Codex's inventory. Real workspace operations remained behind sign-in.

## Initial failure and fix

The first attempt failed before either model started because the observation code assumed `document.body` existed immediately after navigation (Codex 5.24 s, Claude 6.52 s; no workflows explored). The bridge now waits at most 15 seconds for a readable HTTP(S) document body and retries transient navigation-context replacement. A delayed-body local Chrome regression test and private-session/cancellation test passed before this clean benchmark run. Initial failed attempts are excluded from the comparison above.

## Codex

Discovery: 122.56 s. Focused exploration: 181.79 s. Total wall time: 304.35 s. Identified 6 public workflows; completed 4.

| Task | Result | Total | Startup through first frame | Agent start → first tool | Executed steps |
| --- | --- | ---: | ---: | ---: | ---: |
| Public workflow scout | Completed | 122.55 s | 1.76 s | 7.22 s | 20 |
| Compare plans and billing prices | Completed | 54.80 s | 1.44 s | 9.65 s | 8 |
| Discover integrations by category and search | Incomplete | 34.27 s | 1.10 s | 7.73 s | 3 |
| Search public product documentation | Completed | 42.99 s | 1.40 s | 9.49 s | 5 |
| Explore public feature tours and specifications | Completed | 77.71 s | 1.79 s | 9.57 s | 10 |
| Inspect the public code-diff demo | Incomplete | 68.94 s | 1.68 s | 9.78 s | 5 |
| Browse release updates and public media | Completed | 49.27 s | 1.49 s | 6.91 s | 5 |

| Tool | Successful/attempted | Median | p95 | Failed calls |
| --- | ---: | ---: | ---: | ---: |
| observe | 22/22 | 0.063 s | 0.150 s | 0 |
| act.click | 20/23 | 0.354 s | 0.526 s | 3 |
| navigate | 13/14 | 1.064 s | 2.045 s | 1 |
| act.type | 3/3 | 0.444 s | 0.450 s | 0 |
| act.press | 3/4 | 0.426 s | 0.427 s | 1 |
| submit | 7/7 | 0.001 s | 0.004 s | 0 |
| act.scroll | 10/11 | 0.302 s | 0.372 s | 1 |
| act.select | 0/1 | — | — | 1 |

- **Discover integrations by category and search:** incomplete; 3 executed steps; The public directory displays integration categories, but the requested discovery flow could not be completed. The Agents category could not be opened: the first click returned a stale-target error, and a retry after observing left the directory and URL unchanged. Stopped after two failed attempts; search and integration details were not reached. Normalization: the agent did not finish the flow; blocked: The Agents category could not be opened: the first click returned a stale-target error, and a retry after observing left the directory and URL unchanged. Stopped after two failed attempts; search and integration details were not reached.; fewer than 2 steps
- **Compare plans and billing prices:** completed; 8 executed steps; The public comparison shows Free at $0 and Enterprise at Custom pricing, while toggling Billed yearly changes Basic from $10 to $12 and Business from $16 to $18 per user/month, with feature differences visible through Security and Support.
- **Search public product documentation:** completed; 5 executed steps; Signed-out visitors can search for cycles and open public guidance explaining cycle configuration and usage.
- **Explore public feature tours and specifications:** completed; 10 executed steps; Linear provides a signed-out planning tour with illustrated project features and a homepage Projects Tech specs dialog that closes with Escape.
- **Inspect the public code-diff demo:** incomplete; 5 executed steps; The signed-out public page displays a before-and-after code diff and a Theme menu with eight themes. The browser tool could not select the displayed Dracula theme: select returned “Option unavailable”, and the keyboard fallback returned “Unsupported key”. Stopped after these repeated control failures; theme selection and Space edit mode were not completed. Normalization: the agent did not finish the flow; blocked: The browser tool could not select the displayed Dracula theme: select returned “Option unavailable”, and the keyboard fallback returned “Unsupported key”. Stopped after these repeated control failures; theme selection and Space edit mode were not completed.
- **Browse release updates and public media:** completed; 5 executed steps; The public changelog exposes release details and linked release pages, and its demo video plays while signed out.

## Claude Code

Discovery: 138.05 s. Focused exploration: 102.03 s. Total wall time: 240.08 s. Identified 6 public workflows; completed 6.

| Task | Result | Total | Startup through first frame | Agent start → first tool | Executed steps |
| --- | --- | ---: | ---: | ---: | ---: |
| Public workflow scout | Completed | 138.04 s | 1.72 s | 2.40 s | 21 |
| Compare plans and switch the billing period | Completed | 31.51 s | 1.39 s | 2.07 s | 4 |
| Search the documentation and open an article | Completed | 28.15 s | 1.40 s | 2.08 s | 5 |
| Browse the integrations directory to a detail page | Completed | 26.05 s | 1.16 s | 2.58 s | 5 |
| Find an integration with the directory search overlay | Completed | 41.77 s | 1.14 s | 2.41 s | 6 |
| Public feature tour: open Tech specs drawers from the homepage | Completed | 30.85 s | 1.35 s | 2.16 s | 4 |
| Review recent releases in the changelog and developer docs | Completed | 28.74 s | 1.84 s | 2.14 s | 4 |

| Tool | Successful/attempted | Median | p95 | Failed calls |
| --- | ---: | ---: | ---: | ---: |
| observe | 9/9 | 0.060 s | 0.157 s | 0 |
| act.click | 20/22 | 0.341 s | 0.439 s | 2 |
| navigate | 11/12 | 0.963 s | 1.155 s | 1 |
| act.type | 4/4 | 0.412 s | 0.480 s | 0 |
| act.wait | 5/5 | 3.280 s | 3.301 s | 0 |
| submit | 7/7 | 0.001 s | 0.002 s | 0 |
| act.scroll | 2/3 | 0.302 s | 0.364 s | 1 |

- **Search the documentation and open an article:** completed; 5 executed steps; Linear's public docs search returns grouped results across Docs, Developer docs and Integrations, and leads without an account to a full Cycles help article with an on-page outline.
- **Compare plans and switch the billing period:** completed; 4 executed steps; The billing switch updates both paid plans at once, from $10 to $12 for Basic and $16 to $18 for Business, and the public comparison table shows what each plan includes, such as Insights on Business and Enterprise only.
- **Browse the integrations directory to a detail page:** completed; 5 executed steps; Without signing in, a buyer can browse a categorised integrations catalogue and read the GitHub integration's setup requirements, status automations, category and docs link.
- **Find an integration with the directory search overlay:** completed; 6 executed steps; The overlay's default list surfaces integrations not shown in the visible category cards, and typing filters it, but searching 'sentry' returned only a 2020 changelog post rather than the directory's Sentry or Sentry Agent listings.
- **Public feature tour: open Tech specs drawers from the homepage:** completed; 4 executed steps; The homepage's Features list opens static Tech specs slide-over panels that summarise each feature, including Customer Requests' supported intake options and Triage's intelligence, responsibility and rules; this is a public marketing tour, not product use, and no issue or workspace action took place.
- **Review recent releases in the changelog and developer docs:** completed; 4 executed steps; Linear publishes a dated release history with detailed API notes, and its public developer docs lead to the GraphQL API, Authentication, Agents and TypeScript SDK.

## Measurement notes

Latency statistics use successful calls only; failed/rejected calls are counted separately. Durations in the original task tables retain hundredth-second precision; latency percentiles above use millisecond-rounded samples from the timing log. A click includes the bridge’s fixed 250 ms settle delay.

Tool latency is wall time from the timing proxy forwarding an MCP tool call until the full response is received, including screenshot bytes and any trace/frame writes. It excludes model thinking between calls. Startup through first frame includes Chrome/harness setup, initial page navigation and first screenshot. Totals include model/CLI time and browser cleanup. p95 is an empirical nearest-rank estimate from one run, not a stable service SLA. Different scouts may discover different workflows; totals are not a matched-workload speed ranking. No workflow was rehearsed or filmed. Total benchmark wall time: 544.43 s.

Reproduce using the browser-only [benchmark script](browser-harness-benchmark.ts). The full set of validated public action traces, frame PNGs, per-backend inventories and timing log remain in `/tmp/agentcast-public-benchmark-Aig9sh` and `/tmp/agentcast-linear-benchmark-rerun.log` for local review; they are not committed.
