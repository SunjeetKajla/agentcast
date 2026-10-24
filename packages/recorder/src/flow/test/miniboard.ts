// Adapted from the reference AgentCast recorder's MiniBoard fixture.
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * A tiny project-board app for recorder tests: "New project" opens a template dialog with a
 * labelled name field; "Create" routes to /projects/42 and shows the project's heading.
 * `?broken=1` makes Create open an "Upgrade to Pro" dialog instead (an outcome-check failure).
 */
const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>MiniBoard</title>
<style>
  body { font: 16px system-ui, sans-serif; margin: 0; background: #f6f7f9; }
  header { display: flex; justify-content: space-between; align-items: center; padding: 20px 28px; background: #fff; }
  main { padding: 28px; } button { font: inherit; padding: 10px 16px; border-radius: 8px; border: 1px solid #ccd; background: #fff; cursor: pointer; }
  .primary { background: #2f62e6; color: #fff; border-color: #2f62e6; }
  [role=dialog] { position: fixed; inset: 0; display: grid; place-items: center; background: rgba(20,26,40,.35); }
  .card { background: #fff; border-radius: 12px; padding: 22px; width: 460px; display: grid; gap: 14px; }
  .tpl { display: flex; gap: 10px; } .tpl button[aria-pressed=true] { outline: 2px solid #2f62e6; }
  input { font: inherit; padding: 10px; border: 1px solid #ccd; border-radius: 8px; }
</style></head><body>
<header><h1 id="title">Projects</h1><button class="primary" id="new">New project</button></header>
<main id="main"><p>Two projects so far.</p><button>Archive</button></main>
<script>
  const broken = new URLSearchParams(location.search).has('broken');
  if (new URLSearchParams(location.search).has('delayed')) {
    document.getElementById('new').style.display = 'none';
    setTimeout(() => { document.getElementById('new').style.display = ''; }, 2400);
  }
  const main = document.getElementById('main');
  document.getElementById('new').onclick = () => {
    const d = document.createElement('div');
    d.setAttribute('role', 'dialog'); d.setAttribute('aria-label', 'Choose a template');
    d.innerHTML = '<div class="card"><h2>Choose a template</h2><div class="tpl">' +
      '<button aria-pressed="false">Marketing launch</button><button aria-pressed="false">Product roadmap</button></div>' +
      '<label>Project name <input id="name" placeholder="e.g. Q4 Launch"></label>' +
      '<div><button class="primary" id="create">Create</button></div></div>';
    document.body.appendChild(d);
    d.querySelectorAll('.tpl button').forEach((b) => b.onclick = () => { d.querySelectorAll('.tpl button').forEach((x) => x.setAttribute('aria-pressed', 'false')); b.setAttribute('aria-pressed', 'true'); });
    d.querySelector('#create').onclick = () => setTimeout(() => {
      if (broken) { d.innerHTML = '<div class="card"><h2>Upgrade to Pro</h2><p>Projects need a paid plan.</p></div>'; d.setAttribute('aria-label', 'Upgrade to Pro'); return; }
      const name = d.querySelector('#name').value || 'Untitled';
      d.remove();
      history.pushState({}, '', '/projects/42');
      document.getElementById('title').textContent = 'Projects';
      main.innerHTML = '<h2>' + name.replace(/</g, '&lt;') + '</h2><p>Created from a template.</p>';
    }, 250);
  };
</script></body></html>`;

export async function startMiniBoard(): Promise<{
  url: string;
  close(): Promise<void>;
}> {
  const server: Server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(PAGE);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/`,
    close: () => new Promise((r) => server.close(() => r())),
  };
}

/** The flow an explorer would report for MiniBoard (shared Flow schema). */
export function miniBoardFlow(url: string) {
  return {
    id: "create-project",
    title: "Create a project from a template",
    whyItMatters: "Shows instant setup",
    startUrl: url,
    requiresAuth: false,
    rank: 0,
    selected: true,
    needsApproval: false,
    steps: [
      {
        id: "s1",
        action: "click" as const,
        target: { text: "New project", role: "button" },
      },
      {
        id: "s2",
        action: "click" as const,
        target: { text: "Marketing launch" },
      },
      {
        id: "s3",
        action: "type" as const,
        target: { label: "Project name" },
        value: "Q4 Launch",
      },
      {
        id: "s4",
        action: "click" as const,
        target: { text: "Create", role: "button" },
        expect: [{ type: "url" as const, pattern: "/projects/*" }],
      },
    ],
  };
}
