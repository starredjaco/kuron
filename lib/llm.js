// Model backends for the Kuron compiler and CPU.
//  - "claude-…" models run through Claude Code (`claude -p`) with structured output (--json-schema).
//  - any other name is a local model served by Ollama.
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { writeFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";

export const HOST = process.env.KURON_OLLAMA || "http://localhost:11434";
export const NUM_CTX = +(process.env.KURON_NUM_CTX || 16384);
export const PRESETS = {
  claude: { compile: "claude-sonnet-5-5", cpu: "claude-haiku-5-5" },
  anthropic: { compile: "anthropic:claude-sonnet-5-5", cpu: "anthropic:claude-haiku-5-5" },
  local: { compile: "qwen3.8:27b-mlx", cpu: "qwen3.5:4b" },
};
export const DEFAULT_MODEL = process.env.KURON_MODEL || PRESETS.claude.cpu;
export const isClaude = m => /^claude-/.test(m || "");

// Where a model runs, from its name:
//   claude-…              Claude Code (`claude -p`), logged in
//   anthropic:<model>     Anthropic API (ANTHROPIC_API_KEY)
//   openai:<model>        OpenAI-compatible API (OPENAI_API_KEY; KURON_OPENAI_BASE_URL for any other compatible server)
//   gemini: / openrouter: / groq: / lmstudio:<model>   the same OpenAI-compatible protocol at that provider
//   anything else         a local model served by Ollama
export const API_PROVIDERS = {
  openai: { base: process.env.KURON_OPENAI_BASE_URL || "https://api.openai.com/v1", key: "OPENAI_API_KEY" },
  gemini: { base: "https://generativelanguage.googleapis.com/v1beta/openai", key: "GEMINI_API_KEY" },
  openrouter: { base: "https://openrouter.ai/api/v1", key: "OPENROUTER_API_KEY" },
  groq: { base: "https://api.groq.com/openai/v1", key: "GROQ_API_KEY" },
  lmstudio: { base: process.env.KURON_LMSTUDIO_URL || "http://localhost:1234/v1", key: null },
};
export function provider(model) {
  const m = String(model || "");
  if (isClaude(m)) return { kind: "claude-code", model: m };
  const i = m.indexOf(":"), name = i > 0 ? m.slice(0, i) : "";
  if (name === "anthropic") return { kind: "anthropic", model: m.slice(i + 1), key: process.env.ANTHROPIC_API_KEY, keyName: "ANTHROPIC_API_KEY",
    base: (process.env.KURON_ANTHROPIC_BASE_URL || "https://api.anthropic.com").replace(/\/$/, "") };
  if (API_PROVIDERS[name]) { const p = API_PROVIDERS[name]; return { kind: "openai", name, model: m.slice(i + 1), base: p.base.replace(/\/$/, ""), key: p.key ? process.env[p.key] : "", keyName: p.key } }
  return { kind: "ollama", model: m };
}

export async function chat(opts) {
  const p = provider(opts.model);
  if (p.kind === "claude-code") return claudeChat(opts);
  if (p.kind === "ollama") return ollamaChat(opts);
  return apiChat(p, opts);
}

/* ---------- hosted APIs (Anthropic, OpenAI-compatible) ---------- */
// One request to a hosted model. `messages` use the provider's own format; returns the raw JSON reply.
export async function apiRequest(p, body, { timeoutMs = 300000 } = {}) {
  if (p.keyName && !p.key) throw new Error(`${p.keyName} is not set (needed for ${p.kind === "anthropic" ? "anthropic" : p.name}:${p.model})`);
  const url = p.kind === "anthropic" ? p.base + "/v1/messages" : p.base + "/chat/completions";
  const headers = p.kind === "anthropic" ? { "content-type": "application/json", "x-api-key": p.key, "anthropic-version": "2023-06-01" }
    : { "content-type": "application/json", ...(p.key ? { authorization: "Bearer " + p.key } : {}) };
  for (let attempt = 0; ; attempt++) {
    const ac = new AbortController(), timer = setTimeout(() => ac.abort(), timeoutMs);
    let r, j;
    try { r = await fetch(url, { method: "POST", headers, body: JSON.stringify({ model: p.model, ...body }), signal: ac.signal }); j = await r.json().catch(() => ({})) }
    catch (e) { if (attempt < 3) { await new Promise(x => setTimeout(x, 1500 * 2 ** attempt)); continue } throw new Error(e.name === "AbortError" ? "the model timed out" : "cannot reach " + url) }
    finally { clearTimeout(timer) }
    // rate limits, overload and server errors are transient: back off and try again
    if ((r.status === 429 || r.status >= 500) && attempt < 3) { await new Promise(x => setTimeout(x, 1500 * 2 ** attempt)); continue }
    if (!r.ok) throw new Error(`${p.kind === "anthropic" ? "anthropic" : p.name}: ${r.status} ${JSON.stringify(j.error || j).slice(0, 300)}`);
    return j;
  }
}
// The tolerant JSON reading used when a provider is simply asked for JSON: the whole reply, a fenced block, or {…}.
export function readJson(text) {
  const s = String(text || "").trim();
  for (const c of [s, (/```(?:json)?\s*([\s\S]*?)```/.exec(s) || [])[1], s.slice(s.indexOf("{"), s.lastIndexOf("}") + 1)]) { if (!c) continue; try { return JSON.parse(c) } catch { } }
  return null;
}
async function apiChat(p, { system, user, schema, images = [], timeoutMs = 300000 }) {
  const ask = schema ? `${user}\n\nReply with only one JSON value matching this JSON Schema, no other text:\n${JSON.stringify(schema)}` : user;
  const t0 = Date.now();
  for (let attempt = 0; attempt < 2; attempt++) {
    let text;
    if (p.kind === "anthropic") {
      const content = [...images.map(imageBlockAnthropic).filter(Boolean), { type: "text", text: ask }];
      const j = await apiRequest(p, { max_tokens: 8192, ...(system ? { system } : {}), messages: [{ role: "user", content }] }, { timeoutMs });
      text = (j.content || []).filter(b => b.type === "text").map(b => b.text).join("");
    } else {
      const content = images.length ? [{ type: "text", text: ask }, ...images.map(d => ({ type: "image_url", image_url: { url: String(d) } }))] : ask;
      const j = await apiRequest(p, { messages: [...(system ? [{ role: "system", content: system }] : []), { role: "user", content }] }, { timeoutMs });
      text = j.choices?.[0]?.message?.content || "";
    }
    if (!schema) return { value: text, ms: Date.now() - t0 };
    const v = readJson(text); if (v != null) return { value: v, ms: Date.now() - t0 };
  }
  throw new Error("the model did not return the requested JSON");
}
export function imageBlockAnthropic(d) {
  const m = /^data:(image\/[a-z]+);base64,(.+)$/.exec(String(d)); if (!m) return null;
  return { type: "image", source: { type: "base64", media_type: m[1] === "image/jpg" ? "image/jpeg" : m[1], data: m[2] } };
}

/* ---------- local (Ollama) ---------- */
async function ollamaChat({ model, system, user, schema, temperature = 0.2, timeoutMs = 300000, think = false, images = [] }) {
  const body = {
    model, stream: false, think, options: { temperature, num_ctx: NUM_CTX },
    messages: [...(system ? [{ role: "system", content: system }] : []), { role: "user", content: user, ...(images.length ? { images: images.map(i => String(i).replace(/^data:[^,]+,/, "")) } : {}) }],
  };
  if (schema) body.format = schema;
  for (let attempt = 0; attempt < 2; attempt++) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    let j;
    try {
      const r = await fetch(HOST + "/api/chat", { method: "POST", body: JSON.stringify(body), signal: ac.signal });
      j = await r.json();
    } catch (e) {
      throw new Error(e.name === "AbortError" ? "local LLM timed out" : "cannot reach the local LLM at " + HOST);
    } finally { clearTimeout(timer) }
    if (j.error && /think/i.test(j.error) && "think" in body) { delete body.think; attempt--; continue }
    if (j.error) throw new Error("local LLM: " + j.error);
    const text = j.message?.content ?? "";
    if (!schema) return { value: text, ms: Math.round((j.total_duration || 0) / 1e6) };
    try { return { value: JSON.parse(text), ms: Math.round((j.total_duration || 0) / 1e6) } }
    catch { if (attempt === 1) throw new Error("local LLM did not return JSON") }
  }
}

export async function models() {
  try { const r = await fetch(HOST + "/api/tags"); const j = await r.json(); return j.models.map(m => m.name) }
  catch { return null }
}

/* ---------- Claude (through Claude Code) ---------- */
// Structured output only accepts property keys matching ^[a-zA-Z0-9_.-]{1,64}$, so names written in
// Japanese, Chinese, Korean… are swapped for k0, k1… on the way out (the real name goes into the
// description) and swapped back on the way in.
const SAFE = /^[a-zA-Z0-9_.-]{1,64}$/;
export function encodeSchema(schema) {
  let n = 0;
  const enc = s => {
    if (!s || typeof s !== "object") return { s, dec: v => v };
    if (s.type === "object" && s.properties) {
      const map = {}, props = {}, decs = {};
      for (const [k, v] of Object.entries(s.properties)) {
        const key = SAFE.test(k) ? k : "k" + (n++);
        const sub = enc(v);
        map[key] = k; decs[key] = sub.dec;
        props[key] = key === k ? sub.s : { ...sub.s, description: (sub.s.description ? sub.s.description + " — " : "") + "field name: " + k };
      }
      const out = { ...s, properties: props, additionalProperties: false };
      if (s.required) out.required = s.required.map(k => Object.keys(map).find(x => map[x] === k)).filter(Boolean);
      return { s: out, dec: v => v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).map(([k, x]) => [map[k] ?? k, (decs[k] || (y => y))(x)])) : v };
    }
    if (s.type === "array" && s.items) { const sub = enc(s.items); return { s: { ...s, items: sub.s }, dec: v => Array.isArray(v) ? v.map(sub.dec) : v } }
    return { s, dec: v => v };
  };
  const r = enc(schema);
  return { schema: r.s, decode: r.dec };
}

const MAX_PARALLEL = +(process.env.KURON_CLAUDE_PARALLEL || 10);
let running = 0; const waiting = [];
const slot = () => new Promise(r => { if (running < MAX_PARALLEL) { running++; r() } else waiting.push(r) });
const release = () => { const next = waiting.shift(); if (next) next(); else running-- };

export function runClaude(args, input, { timeoutMs = 300000, cwd = tmpdir() } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.env.KURON_CLAUDE || "claude", args, { cwd, env: process.env });
    let out = "", err = "";
    const t = setTimeout(() => { p.kill("SIGTERM"); reject(new Error("claude timed out")) }, timeoutMs);
    p.stdout.on("data", d => out += d); p.stderr.on("data", d => err += d);
    p.on("error", e => { clearTimeout(t); reject(new Error("claude command not found: " + e.message)) });
    p.on("close", code => { clearTimeout(t); resolve({ code, out, err }) });
    p.stdin.end(input);
  });
}

// Images (data URLs) are written to a temporary folder that Claude may read, and nothing else.
function imageFiles(images) {
  if (!images || !images.length) return null;
  const dir = mkdtempSync(join(tmpdir(), "kuron-img-"));
  const files = images.slice(0, 4).map((d, i) => {
    const m = /^data:image\/(png|jpeg|jpg|webp|gif);base64,(.+)$/.exec(String(d));
    if (!m) return null;
    const f = join(dir, `image-${i}.${m[1] === "jpeg" ? "jpg" : m[1]}`);
    writeFileSync(f, Buffer.from(m[2], "base64")); return f;
  }).filter(Boolean);
  return files.length ? { dir, files } : null;
}

async function claudeChat({ model, system, user, schema, effort, timeoutMs = 300000, images = [] }) {
  const enc = schema ? encodeSchema(schema) : null;
  const img = imageFiles(images);
  if (img) user = `Look at ${img.files.length > 1 ? "these images" : "this image"} first with the Read tool: ${img.files.join(", ")}\n\n` + user;
  const args = ["-p", "--model", model, "--tools", img ? "Read" : "", ...(img ? ["--allowedTools", "Read", "--add-dir", img.dir] : []), "--no-session-persistence", "--output-format", "json",
    "--effort", effort || process.env.KURON_CLAUDE_EFFORT || "low", "--system-prompt", system || "Answer the request."];
  if (enc) args.push("--json-schema", JSON.stringify(enc.schema));
  await slot();
  const ATTEMPTS = 4;
  const pause = i => new Promise(r => setTimeout(r, 1500 * 2 ** i));
  try {
    for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
      const last = attempt === ATTEMPTS - 1;
      const t0 = Date.now();
      const { code, out, err } = await runClaude(args, user, { timeoutMs });
      let res = null;
      for (const line of out.split("\n").reverse()) { const l = line.trim(); if (!l.startsWith("{")) continue; try { const d = JSON.parse(l); if (d.type === "result") { res = d; break } } catch { } }
      if (!res) { if (last) throw new Error("claude: " + (err || out || "exit " + code).slice(-300)); await pause(attempt); continue }
      if (res.is_error) {
        if (/not logged in/i.test(res.result || "")) throw new Error("claude is not logged in (run `claude` once and /login)");
        // network, overload and server errors are transient: back off and try again
        if (last) throw new Error("claude: " + String(res.result).slice(0, 300));
        await pause(attempt); continue;
      }
      const ms = Date.now() - t0;
      if (!enc) return { value: res.result, ms, cost: res.total_cost_usd };
      let v = res.structured_output;
      if (v == null) try { v = JSON.parse(res.result) } catch { }
      if (v != null) return { value: enc.decode(v), ms, cost: res.total_cost_usd };
      if (last) throw new Error("claude did not return the requested JSON");
    }
  } finally { release() }
}
