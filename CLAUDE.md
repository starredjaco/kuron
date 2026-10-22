# kuron — notes for Claude Code

kuron lets an LLM behave as a whole system through hands (tools). Read `docs/DESIGN.md` first.

- The line: code only provides generic hands and a minimal face. No business judgement, no word lists, no guessing of
  meaning, no per-idea exceptions in code. When something does not fit, a hand returns an error to the LLM and the LLM
  corrects itself; a wrong prototype is fixed by telling the LLM how to behave (requests), never by patching code.
- `lib/world.js` world store · `lib/hands.js` hands + shape check · `lib/agent.js` one LLM turn (Claude via MCP, Ollama
  tool calling) · `lib/mcp.js` MCP stdio server · `lib/server.js` host, events, checks, reverse · `ui/` minimal face.
- `node bin/kuron.js dev <folder>` serves the dev UI on http://127.0.0.1:4870/ (presentation: `/present`).
- `node bin/kuron.js hands --url http://127.0.0.1:4870` exposes the hands to any MCP client (e.g. Codex).
