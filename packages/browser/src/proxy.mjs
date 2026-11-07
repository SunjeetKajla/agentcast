// Task-local stdio MCP proxy. Browser state and enforcement remain in the worker.
import { createInterface } from "node:readline";
const endpoint = process.env.AGENTCAST_BROWSER_ENDPOINT;
const token = process.env.AGENTCAST_BROWSER_TOKEN;
const send = (id, result, error) =>
  process.stdout.write(
    JSON.stringify({
      jsonrpc: "2.0",
      id,
      ...(error ? { error } : { result }),
    }) + "\n",
  );
for await (const line of createInterface({ input: process.stdin })) {
  let req;
  try {
    req = JSON.parse(line);
    if (req.id === undefined) continue;
    if (req.method === "initialize") {
      send(req.id, {
        protocolVersion: req.params?.protocolVersion ?? "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "agentcast-browser", version: "1.0.0" },
      });
      continue;
    }
    if (req.method === "ping") {
      send(req.id, {});
      continue;
    }
    if (!["tools/list", "tools/call"].includes(req.method)) {
      send(req.id, undefined, { code: -32601, message: "Unknown method" });
      continue;
    }
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ method: req.method, params: req.params }),
    });
    if (!response.ok) throw new Error("Browser task unavailable");
    send(req.id, await response.json());
  } catch {
    if (req?.id !== undefined)
      send(req.id, undefined, {
        code: -32603,
        message: "Browser bridge failed",
      });
  }
}
