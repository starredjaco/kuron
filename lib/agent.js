// One turn of an LLM with hands. The LLM is the system; it acts only through the hands.
//  - claude-…  : Claude Code (`claude -p`) with the hands as an MCP server
//  - codex:…   : the Codex CLI (`codex exec`) with the hands as an MCP server
//  - anthropic:… / openai:… / gemini:… / openrouter:… / groq:… / lmstudio:… : that API's tool calling with the same hands
//  - otherwise : Ollama tool calling with the same hands
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runClaude, runCodex, provider, apiRequest, imageBlockAnthropic, HOST } from "./llm.js";
import { handsFor } from "./hands.js";

const BIN = join(dirname(fileURLToPath(import.meta.url)), "..", "bin", "kuron.js");

const COMMON = `You are not writing software. You ARE the system: everything it does happens because you do it, through the hands (tools) you have. Never write code. Write everything a person sees in the system's language.`;

export const ROLE_PROMPTS = {
  setup: `${COMMON}
Make the idea exist as a system a person can use by hand right now — even if it would normally take weeks to build. First decide what this is to the person using it — a tool for work, a game, a story, a board, a map, an instrument, a companion, something else — and what they should see and touch. Do not fall back on forms and lists: they suit records and queues of work. When the idea is played, explored or watched, the face is a picture you draw: the board, scene, cards or map itself (draw + a drawing part), with the things a person touches carrying intents, text that follows values, and motion where it gives life. Then, using only the hands:
1. write_brief: the system's name, language and brief — what kind of thing it is, its roles, rules, and what you will do for each intent (including judgements ordinary code could not make, and how you redraw the picture as things happen).
2. apply: create the collections it needs with realistic test data (a believable situation to try right away).
3. define_screen: a screen for each device or role the idea needs, in the form you decided; only what is needed to use the core. A drawn face is a drawing part (draw it before you finish), with ordinary parts around it only where they help. Buttons carry intents in plain words; lists name their collection and, when the order matters, give it (with word values in display order). Use real-world parts (camera, mic, sounds, output, speak, drawing) when the idea touches the real world.
4. set_timer when time passing matters; play_sounds when a test situation needs them.
5. add_check: 2–4 scenarios of a person using it and what must then be true.
6. set_reality: how this would behave if built today with existing technology — for every intent, which parts would be ordinary code, a model, an outside service or not possible yet, how often it would go wrong, how late it would answer and how it typically fails; plus sound delay and leakage if sound is involved.
If a hand reports a problem, correct your call. Finish with one sentence saying what you made.`,
  event: `${COMMON}
Something just happened in the system (below). Act as the system would: read only what you need (query), make every change in one apply, redraw (draw) a picture you drew when what it shows has changed, and add speak / notify / play_sounds / shape_sound / draw / define_screen only if the behaviour calls for it. Judge, predict and generate concretely and realistically. Never invent facts the world contradicts; if something needed is missing, say so in your reply. Use at most 4 hands. Reply with one short sentence for the person, or nothing.`,
  request: `${COMMON}
A person tried the system and asked for a change (below). Make the change through the hands — rewrite the brief, redefine screens, adjust data, timers or checks. Keep everything else as it is. Reply with one sentence saying what changed.`,
};

export const ROLE_MODELS = { setup: "compile", request: "compile", event: "cpu" };

function contextText(world, extra) {
  const o = world.overview();
  return `SYSTEM: ${o.name || "(not set up yet)"}\nBRIEF:\n${o.brief || "(none yet)"}\n\nWORLD NOW:\n${JSON.stringify({ values: o.values, collections: o.collections, screens: o.screens, timers: o.timers, ...(extra.startsWith("REQUEST") ? { checks: o.checks, screenDefinitions: world.data.screens } : {}) })}\n\n${extra}`;
}

export async function runTurn({ role, model, world, hostUrl, turnId, message, reality = null, images = [] }) {
  let system = ROLE_PROMPTS[role];
  if (role === "event" && reality) system += `\nTHIS RUN SIMULATES THE EXISTING-TECHNOLOGY VERSION, not the ideal one. Find the estimate for this event's intent below and behave as that implementation would: parts built with ordinary code are exact; parts that need a model go wrong about as often and in the way it says; services answer as described; parts that are not possible yet do not work (say so instead of doing them). If no entry fits, use the general note.\nGENERAL: ${reality.cpuNote}\nPER INTENT: ${JSON.stringify(reality.intents || [])}`;
  const prompt = role === "setup" ? `IDEA:\n${message}` : contextText(world, message);
  const hands = handsFor(role);
  const t0 = Date.now();
  const p = provider(model);
  if (p.kind === "claude-code") {
    const mcp = { mcpServers: { kuron: { command: process.execPath, args: [BIN, "hands", "--url", hostUrl, "--turn", turnId, "--role", role] } } };
    const args = ["-p", "--model", model, "--mcp-config", JSON.stringify(mcp), "--strict-mcp-config", "--tools", "",
      "--allowedTools", hands.map(h => "mcp__kuron__" + h.name).join(","), "--no-session-persistence", "--output-format", "json",
      "--effort", role === "event" ? "low" : "medium", "--system-prompt", system];
    const { out, err, code } = await runClaude(args, prompt, { timeoutMs: role === "event" ? 180000 : 900000 });
    let res = null;
    for (const line of out.split("\n").reverse()) { const l = line.trim(); if (!l.startsWith("{")) continue; try { const d = JSON.parse(l); if (d.type === "result") { res = d; break } } catch { } }
    if (!res) throw new Error("claude: " + (err || out || "exit " + code).slice(-300));
    if (res.is_error) throw new Error("claude: " + String(res.result).slice(0, 300));
    return { text: String(res.result || "").trim(), ms: Date.now() - t0, cost: res.total_cost_usd, turns: res.num_turns };
  }
  if (p.kind === "codex") {
    // The same hands, served to Codex over MCP and bound to this turn; only that server's tools are approved.
    const config = [`mcp_servers.kuron.command=${JSON.stringify(process.execPath)}`, `mcp_servers.kuron.args=${JSON.stringify([BIN, "hands", "--url", hostUrl, "--turn", turnId, "--role", role])}`, 'mcp_servers.kuron.default_tools_approval_mode="approve"'];
    const text = await runCodex(p, `${system}\nYour hands are the tools of the MCP server named kuron. Use only those tools; never run commands or touch files.\n\n${prompt}`,
      { timeoutMs: role === "event" ? 180000 : 900000, effort: role === "event" ? "low" : "medium", config, images });
    return { text, ms: Date.now() - t0 };
  }
  const turn = { system, prompt, hands, hostUrl, turnId, images, t0, rounds: role === "event" ? 8 : 24 };
  if (p.kind === "anthropic") return anthropicTurn(p, turn);
  if (p.kind === "openai") return openaiTurn(p, turn);
  return ollamaTurn({ model, ...turn });
}

const toolText = res => res.content.map(c => c.type === "text" ? c.text : "[image]").join("\n");

// OpenAI-compatible tool calling (OpenAI, Gemini, OpenRouter, Groq, LM Studio, any compatible server).
async function openaiTurn(p, { system, prompt, hands, hostUrl, turnId, images, t0, rounds }) {
  const tools = hands.map(h => ({ type: "function", function: { name: h.name, description: h.description, parameters: h.input } }));
  const first = images.length ? [{ type: "text", text: prompt }, ...images.map(d => ({ type: "image_url", image_url: { url: d } }))] : prompt;
  const messages = [{ role: "system", content: system }, { role: "user", content: first }];
  for (let i = 0; i < rounds; i++) {
    const j = await apiRequest(p, { messages, tools });
    const m = j.choices?.[0]?.message || {}; messages.push({ role: "assistant", content: m.tool_calls ? (m.content || null) : (m.content ?? ""), ...(m.tool_calls ? { tool_calls: m.tool_calls } : {}) });
    if (!m.tool_calls || !m.tool_calls.length) return { text: String(m.content || "").trim(), ms: Date.now() - t0, turns: i + 1 };
    for (const tc of m.tool_calls) {
      let args = {}; try { args = typeof tc.function.arguments === "string" ? JSON.parse(tc.function.arguments || "{}") : tc.function.arguments || {} } catch { }
      const res = await callHand(hostUrl, turnId, tc.function.name, args);
      messages.push({ role: "tool", tool_call_id: tc.id, content: toolText(res) });
    }
  }
  return { text: "", ms: Date.now() - t0, turns: rounds };
}

// Anthropic Messages API tool use.
async function anthropicTurn(p, { system, prompt, hands, hostUrl, turnId, images, t0, rounds }) {
  const tools = hands.map(h => ({ name: h.name, description: h.description, input_schema: h.input }));
  const messages = [{ role: "user", content: [...images.map(imageBlockAnthropic).filter(Boolean), { type: "text", text: prompt }] }];
  for (let i = 0; i < rounds; i++) {
    const j = await apiRequest(p, { max_tokens: 8192, system, messages, tools });
    const blocks = j.content || []; messages.push({ role: "assistant", content: blocks });
    const uses = blocks.filter(b => b.type === "tool_use");
    if (!uses.length) return { text: blocks.filter(b => b.type === "text").map(b => b.text).join("").trim(), ms: Date.now() - t0, turns: i + 1 };
    const results = [];
    for (const u of uses) { const res = await callHand(hostUrl, turnId, u.name, u.input || {}); results.push({ type: "tool_result", tool_use_id: u.id, content: toolText(res), ...(res.isError ? { is_error: true } : {}) }) }
    messages.push({ role: "user", content: results });
  }
  return { text: "", ms: Date.now() - t0, turns: rounds };
}

async function ollamaTurn({ model, system, prompt, hands, hostUrl, turnId, images, t0, rounds = 12 }) {
  const tools = hands.map(h => ({ type: "function", function: { name: h.name, description: h.description, parameters: h.input } }));
  const messages = [{ role: "system", content: system }, { role: "user", content: prompt, ...(images.length ? { images: images.map(i => i.replace(/^data:[^,]+,/, "")) } : {}) }];
  for (let i = 0; i < rounds; i++) {
    const r = await fetch(HOST + "/api/chat", { method: "POST", body: JSON.stringify({ model, messages, tools, stream: false, think: false, options: { temperature: 0.2, num_ctx: 32768 } }) });
    const j = await r.json(); if (j.error) throw new Error("local LLM: " + j.error);
    const m = j.message; messages.push(m);
    if (!m.tool_calls || !m.tool_calls.length) return { text: (m.content || "").trim(), ms: Date.now() - t0, turns: i + 1 };
    for (const tc of m.tool_calls) {
      const res = await callHand(hostUrl, turnId, tc.function.name, tc.function.arguments || {});
      messages.push({ role: "tool", content: toolText(res) });
    }
  }
  return { text: "", ms: Date.now() - t0, turns: rounds };
}

export async function callHand(hostUrl, turn, name, args) {
  const r = await fetch(hostUrl + "/api/hand", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ turn, name, args }) });
  return r.json();
}
