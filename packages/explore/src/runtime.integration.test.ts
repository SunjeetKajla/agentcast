import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it.skipIf(process.env.AGENTCAST_BROWSER_TESTS !== "1")(
  "inspects a real page through tsx, the same compiler used by the worker",
  async () => {
    const script = `
    import { createServer } from 'node:http';
    import { mkdtemp, rm } from 'node:fs/promises';
    import { tmpdir } from 'node:os';
    import { join } from 'node:path';
    import { localBrowserAdapter } from ${JSON.stringify(new URL("./local.ts", import.meta.url).href)};
    const dir = await mkdtemp(join(tmpdir(), 'agentcast-tsx-inspection-'));
    const server = createServer((req, res) => { res.setHeader('content-type', 'text/html'); res.end('<header><svg aria-label="Product logo" width="120" height="40"><rect width="120" height="40" fill="purple"/></svg></header><h1>Worker runtime fixture</h1><p>A public product with working page inspection.</p>'); });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const url = 'http://127.0.0.1:' + server.address().port + '/';
    try {
      const browser = localBrowserAdapter({gpu:'cpu'});
      const options = {dir, authorizedUrl:url, signal:AbortSignal.timeout(20000)};
      const inspected = await browser.inspect(url, options);
      const read = await browser.readPage(url, options);
      console.log(JSON.stringify({heading:inspected.facts.heading, logo:inspected.logo?.from, read:read.text.includes('working page inspection')}));
    } finally {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
      await rm(dir, {recursive:true,force:true});
    }
  `;
    const { stdout } = await promisify(execFile)(
      process.execPath,
      ["--import", "tsx", "--input-type=module", "-e", script],
      {
        cwd: fileURLToPath(new URL("../../../", import.meta.url)),
        timeout: 30_000,
      },
    );
    expect(JSON.parse(stdout.trim())).toEqual({
      heading: "Worker runtime fixture",
      logo: "inline-svg",
      read: true,
    });
  },
  35_000,
);
