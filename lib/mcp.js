// A minimal MCP server over stdio (JSON-RPC 2.0, one message per line). It knows nothing about kuron's
// hands: it lists the tools it is given and forwards each call to `call(name, args)`.
import { createInterface } from "node:readline";

export function serveMcp({ name = "kuron", version = "0.1.0", tools, call }) {
  const out = msg => process.stdout.write(JSON.stringify(msg) + "\n");
  const rl = createInterface({ input: process.stdin });
  rl.on("line", async line => {
    let msg; try { msg = JSON.parse(line) } catch { return }
    const { id, method, params } = msg;
    if (id === undefined) return; // notifications
    try {
      if (method === "initialize") return out({ jsonrpc: "2.0", id, result: { protocolVersion: params?.protocolVersion || "2025-06-18", capabilities: { tools: {} }, serverInfo: { name, version } } });
      if (method === "tools/list") return out({ jsonrpc: "2.0", id, result: { tools: tools.map(t => ({ name: t.name, description: t.description, inputSchema: t.input })) } });
      if (method === "tools/call") {
        const r = await call(params.name, params.arguments || {});
        return out({ jsonrpc: "2.0", id, result: { content: r.content, isError: !!r.isError } });
      }
      if (method === "ping") return out({ jsonrpc: "2.0", id, result: {} });
      out({ jsonrpc: "2.0", id, error: { code: -32601, message: "unknown method " + method } });
    } catch (e) { out({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: "error: " + e.message }], isError: true } }) }
  });
}
