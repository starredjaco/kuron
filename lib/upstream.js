// Upstream: Claude Code (`claude -p`) interprets human instructions and writes or revises Kuron programs,
// and turns a verified prototype into an implementation plan. The local LLM never does this part.
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { langName } from "./source.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const spec = () => readFileSync(join(ROOT, "docs", "LANGUAGE.md"), "utf8");

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

const fence = t => {
  const m = /```[a-zA-Z]*\n([\s\S]*?)```/.exec(t);
  return (m ? m[1] : t).trim() + "\n";
};

export async function writeProgram(idea, { lang, cwd } = {}) {
  const out = await claude(`You are the upstream author for Kuron. Read the language definition, then write one complete Kuron program for the idea below.
Write it in ${lang ? langName(lang) : "the same language as the idea"}. The person wants to try the idea for real in about a minute, so write the smallest program that lets them use its core value by hand:
1–2 screens, 2–4 actions, a State section that names every field and its properties, inputs named on the screens, action steps that say plainly what to do (including the parts ordinary code could not do), and 2–3 concrete checks. Leave out settings, logins and anything that is not the core.
No code is ever written: when the idea touches the real world, put the general components on the screens in plain words (camera picture judged every few seconds by an action, microphone, test sounds from a list, earphone output with band gains and an on/off switch, speaking a text, a drawing) and let actions do every judgement. Include an action that creates a test situation (e.g. writes the test sounds or draws a test scene) so it can be tried immediately.
Do not use any tools. Reply with the program only.

=== LANGUAGE ===
${spec()}

=== IDEA ===
${idea}`, { cwd, model: WRITE_MODEL, effort: "low" });
  return fence(out);
}

export async function reviseProgram(text, request, { context = null, cwd } = {}) {
  const out = await claude(`You are the upstream author for Kuron. A person tried the running prototype and asked for a change.
Revise the program so the change is made, keep everything else as it is, keep the program's language, and keep or extend the checks so the change is verified.
Do not use any tools. Reply with the complete revised program only.

=== LANGUAGE ===
${spec()}

=== CURRENT PROGRAM ===
${text}

=== WHERE THEY WERE ===
${context ? JSON.stringify(context) : "(not given)"}

=== REQUEST ===
${request}`, { cwd });
  return fence(out);
}

export async function writePlan(specMd, { lang, cwd } = {}) {
  return (await claude(`You are the upstream planner for Kuron. Below is the specification of a prototype that already runs on an LLM-CPU, including real examples of what each action did.
Write PLAN.md in ${langName(lang || "ja")} for turning it into a real implementation:
1. Summary: what the system is and what the prototype proved.
2. For every action step: classify it as ordinary code / needs a model (say which kind) / needs an outside service or data / keep on an LLM; give the reason.
3. Architecture and data model for the real system (tables or types from the state schema).
4. Schedule: ordered work items with an estimate in hours, the riskiest first.
5. Prompts: for each work item, the exact prompt to give an implementation agent (Claude Code), as a fenced block, referencing the spec and the golden examples.
6. Acceptance: turn the checks and the examples into the tests the real implementation must pass.
Do not use any tools. Reply with the Markdown only.

${specMd}`, { cwd })).trim() + "\n";
}
