// One turn of an LLM with hands. The LLM is the system; it acts only through the hands.
//  - claude-…  : Claude Code (`claude -p`) with the hands as an MCP server
//  - otherwise : Ollama tool calling with the same hands
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runClaude, isClaude, HOST } from "./llm.js";
import { handsFor } from "./hands.js";

const BIN = join(dirname(fileURLToPath(import.meta.url)), "..", "bin", "kuron.js");

const COMMON = `You are not writing software. You ARE the system: everything it does happens because you do it, through the hands (tools) you have. Never write code. Write everything a person sees in the system's language.`;

export const ROLE_PROMPTS = {
  setup: `${COMMON}
Make the idea exist as a system a person can use by hand right now — even if it would normally take weeks to build. Using only the hands:
1. write_brief: the system's name, language and brief — its roles, rules, and what you will do for each intent (including judgements ordinary code could not make).
2. apply: create the collections it needs with realistic test data (a believable situation to try right away).
3. define_screen: a minimal screen for each device or role the idea needs. Only what is needed to use the core. Buttons carry intents in plain words; lists name their collection and, when the order matters, give it (with word values in display order). Use real-world parts (camera, mic, sounds, output, speak, drawing) when the idea touches the real world.
4. set_timer when time passing matters; play_sounds / draw when a test situation needs them.
5. add_check: 2–4 scenarios of a person using it and what must then be true.
6. set_reality: how this would behave if built today with existing technology — for every intent, which parts would be ordinary code, a model, an outside service or not possible yet, how often it would go wrong, how late it would answer and how it typically fails; plus sound delay and leakage if sound is involved.
If a hand reports a problem, correct your call. Finish with one sentence saying what you made.`,
  event: `${COMMON}
Something just happened in the system (below). Act as the system would: read only what you need (query), make every change in one apply, and add speak / notify / play_sounds / shape_sound / draw / define_screen only if the behaviour calls for it. Judge, predict and generate concretely and realistically. Never invent facts the world contradicts; if something needed is missing, say so in your reply. Use at most 4 hands. Reply with one short sentence for the person, or nothing.`,
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
  if (isClaude(model)) {
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
  return ollamaTurn({ model, system, prompt, hands, hostUrl, turnId, images, t0 });
}

async function ollamaTurn({ model, system, prompt, hands, hostUrl, turnId, images, t0 }) {
  const tools = hands.map(h => ({ type: "function", function: { name: h.name, description: h.description, parameters: h.input } }));
  const messages = [{ role: "system", content: system }, { role: "user", content: prompt, ...(images.length ? { images: images.map(i => i.replace(/^data:[^,]+,/, "")) } : {}) }];
  for (let i = 0; i < 12; i++) {
    const r = await fetch(HOST + "/api/chat", { method: "POST", body: JSON.stringify({ model, messages, tools, stream: false, think: false, options: { temperature: 0.2, num_ctx: 32768 } }) });
    const j = await r.json(); if (j.error) throw new Error("local LLM: " + j.error);
    const m = j.message; messages.push(m);
    if (!m.tool_calls || !m.tool_calls.length) return { text: (m.content || "").trim(), ms: Date.now() - t0, turns: i + 1 };
    for (const tc of m.tool_calls) {
      const res = await callHand(hostUrl, turnId, tc.function.name, tc.function.arguments || {});
      messages.push({ role: "tool", content: res.content.map(c => c.type === "text" ? c.text : "[image]").join("\n") });
    }
  }
  return { text: "", ms: Date.now() - t0, turns: 12 };
}

export async function callHand(hostUrl, turn, name, args) {
  const r = await fetch(hostUrl + "/api/hand", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ turn, name, args }) });
  return r.json();
}
