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
  local: { compile: "qwen3.8:27b-mlx", cpu: "qwen3.5:4b" },
};
export const DEFAULT_MODEL = process.env.KURON_MODEL || PRESETS.claude.cpu;
export const isClaude = m => /^claude-/.test(m || "");

export async function chat(opts) {
  return isClaude(opts.model) ? claudeChat(opts) : ollamaChat(opts);
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
