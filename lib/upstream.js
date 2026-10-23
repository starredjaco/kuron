// Planning: Claude Code (`claude -p`) turns a tried prototype (brief, screens, what the system did) into an implementation plan.
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { langName } from "./lang.js";
import { chat, isClaude } from "./llm.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// Model per upstream job: writing a first version must be fast (the goal is "usable in about a minute"),
// revising and planning can afford the default model. Override with KURON_UPSTREAM_MODEL / KURON_WRITE_MODEL.
const WRITE_MODEL = process.env.KURON_WRITE_MODEL || "claude-sonnet-5-5";
const UPSTREAM_MODEL = process.env.KURON_UPSTREAM_MODEL || null;

export function claude(prompt, { cwd = process.cwd(), timeoutMs = 8 * 60 * 1000, onData = () => { }, model = UPSTREAM_MODEL, effort = null } = {}) {
  return new Promise((resolve, reject) => {
    const bin = process.env.KURON_CLAUDE || "claude";
    const args = ["-p", "--output-format", "text", "--tools", "", "--no-session-persistence"];
    if (model) args.push("--model", model);
    if (effort) args.push("--effort", effort);
    const p = spawn(bin, args, { cwd, env: process.env });
    let out = "", err = "";
    const t = setTimeout(() => { p.kill("SIGTERM"); reject(new Error("upstream_timeout")) }, timeoutMs);
    p.stdout.on("data", d => { out += d; onData(out) });
    p.stderr.on("data", d => { err += d });
    p.on("error", e => { clearTimeout(t); reject(new Error("upstream_missing: " + e.message)) });
    p.on("close", code => { clearTimeout(t); code === 0 ? resolve(out) : reject(new Error("upstream_failed: " + (err || out).slice(-400))) });
    p.stdin.end(prompt);
  });
}

export async function writePlan(specMd, { lang, cwd, model = null } = {}) {
  const ask = `You are the upstream planner for Kuron. Below is the specification of a prototype that already runs on an LLM-CPU, including real examples of what each action did.
Write PLAN.md in ${langName(lang || "ja")} for turning it into a real implementation:
1. Summary: what the system is and what the prototype proved.
2. For every action step: classify it as ordinary code / needs a model (say which kind) / needs an outside service or data / keep on an LLM; give the reason.
3. Architecture and data model for the real system (tables or types from the state schema).
4. Schedule: ordered work items with an estimate in hours, the riskiest first.
5. Prompts: for each work item, the exact prompt to give an implementation agent (Claude Code), as a fenced block, referencing the spec and the golden examples.
6. Acceptance: turn the checks and the examples into the tests the real implementation must pass.
Do not use any tools. Reply with the Markdown only.

${specMd}`;
  // Claude Code by default; any other model writes the plan through its own API
  const text = !model || isClaude(model) ? await claude(ask, { cwd }) : (await chat({ model, user: ask, timeoutMs: 600000 })).value;
  return String(text).trim() + "\n";
}
