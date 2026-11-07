import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { snapshot } from "./workspace.ts";

let root: string | undefined;
afterEach(() => (root ? rm(root, { recursive: true, force: true }) : undefined));

it("leaves out hidden files and every path .agentignore names", async () => {
  root = await mkdtemp(join(tmpdir(), "agentcast-snapshot-"));
  for (const [path, text] of [
    ["DIRECTOR.md", "# brief"],
    ["edl.json", "{}"],
    ["composition/compositions/b2.html", "<template></template>"],
    ["composition/assets/gsap.min.js", "/* vendored */"],
    ["composition/input.json", "{}"],
    [".secret", "no"],
  ] as const) {
    await mkdir(join(root, path, ".."), { recursive: true });
    await writeFile(join(root, path), text);
  }
  await writeFile(join(root, ".agentignore"), "# vendored\ncomposition/assets/\ncomposition/input.json\n");
  const { files } = await snapshot(root);
  expect(files.map((f) => f.path).sort()).toEqual(["DIRECTOR.md", "composition/compositions/b2.html", "edl.json"]);
});
