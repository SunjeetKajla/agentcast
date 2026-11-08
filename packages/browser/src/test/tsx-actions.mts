import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchExplorationChrome } from "../chrome.ts";
import { performBrowserAction } from "../actions.ts";

const root = await mkdtemp(join(tmpdir(), "agentcast-tsx-actions-"));
let context:
  Awaited<ReturnType<typeof launchExplorationChrome>>["context"] | undefined;
try {
  ({ context } = await launchExplorationChrome(root, { gpu: "cpu" }));
  const page = context.pages()[0]!;
  await page.setContent(
    "<h1>Waiting</h1><button onclick=\"document.querySelector('h1').textContent='Ready'\">Preview</button>",
  );
  const result = await performBrowserAction(
    page,
    {
      action: "click",
      waitFor: [{ type: "text", text: "Ready", match: "exact" }],
    },
    {
      id: "o1-0",
      role: "button",
      text: "Preview",
      label: "",
      placeholder: "",
    },
    AbortSignal.timeout(10_000),
  );
  if ((await page.getByRole("heading").textContent()) !== "Ready")
    throw new Error("Action did not execute");
  if (!result.expect.length) throw new Error("Missing verified outcomes");
  await page.setContent(
    '<h1>Waiting</h1><form role="search" onsubmit="event.preventDefault();document.querySelector(\'h1\').textContent=\'Search ready\'"><input type="search" aria-label="Search products"></form>',
  );
  await page.getByRole("searchbox").fill("watch");
  await performBrowserAction(
    page,
    { action: "press", value: "Enter" },
    undefined,
    AbortSignal.timeout(10_000),
  );
  if ((await page.getByRole("heading").textContent()) !== "Search ready")
    throw new Error("Keyboard action did not execute");
  process.stdout.write("tsx action verified\n");
} finally {
  await context?.close();
  await rm(root, { recursive: true, force: true });
}
