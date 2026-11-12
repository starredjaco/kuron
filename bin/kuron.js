#!/usr/bin/env node
// kuron — an LLM behaves as the system, through hands. No code is written for any idea.
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, basename, resolve, join } from "node:path";
import { execFileSync } from "node:child_process";
import { PRESETS, missingFor } from "../lib/llm.js";
import { serve } from "../lib/server.js";
import { serveMcp } from "../lib/mcp.js";
import { handsFor } from "../lib/hands.js";
import { callHand } from "../lib/agent.js";

const args = process.argv.slice(2);
const cmd = args.shift();
const flag = (n, d) => { let i = args.indexOf("--" + n); if (i < 0 && n.length === 1) i = args.indexOf("-" + n); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v };

// `kuron hands`: the hands as an MCP server over stdio, bound to a running kuron host (used by claude -p, Codex, any MCP client)
if (cmd === "hands") {
  const url = flag("url", process.env.KURON_URL || "http://127.0.0.1:4870"), role = flag("role", "event"), turn = flag("turn", process.env.KURON_TURN || "external:" + role);
  serveMcp({ tools: handsFor(role), call: (name, a) => callHand(url, turn, name, a) });
} else main().catch(e => { console.error(e.message); process.exit(1) });

async function main() {
  const cfgFile = resolve("kuron.json"), cfg = existsSync(cfgFile) ? JSON.parse(readFileSync(cfgFile, "utf8")) : {};
  const port = +flag("port", cfg.port || 4870), out = flag("o", null);
  const hasClaude = (() => { try { execFileSync(process.env.KURON_CLAUDE || "claude", ["--version"], { stdio: "ignore" }); return true } catch { return false } })();
  const preset = flag("preset", process.env.KURON_PRESET || cfg.preset || (hasClaude ? "claude" : process.env.ANTHROPIC_API_KEY ? "anthropic" : "local"));
  if (!PRESETS[preset]) { console.error("unknown preset: " + preset + " (claude | anthropic | local)"); process.exit(1) }
  const named = ["--preset", "--compile-model", "--cpu-model"].some(f => process.argv.includes(f));   // named here: these win over the models chosen in the dev UI
  const compileModel = flag("compile-model", process.env.KURON_COMPILE_MODEL || cfg.compileModel || PRESETS[preset].compile);
  const cpuModel = flag("cpu-model", process.env.KURON_MODEL || cfg.cpuModel || PRESETS[preset].cpu);
  const HELP = `kuron — an LLM behaves as the system through hands; no code is written for any idea

  kuron try                                       copy the examples into ./kuron-examples and open them
  kuron dev [idea.kuron | folder] [--port 4870]   open the dev UI (switch between every idea in the folder)
  kuron new "one line" [-o name.kuron]            write the idea and let the setup agent build the system
  kuron check [idea.kuron]                        run the system's checks
  kuron hands --url <host> [--role event]         the hands as an MCP server (for Codex or any MCP client)

  --preset claude|anthropic|local
                          claude: Claude Code (logged in) · anthropic: Anthropic API (ANTHROPIC_API_KEY) · local: Ollama
  --compile-model <name>  model for setup, requests and plans
  --cpu-model <name>      model for button presses and timers
                          names: claude-… (Claude Code) · codex:<model> (Codex CLI) · anthropic:<model> · openai:<model> · gemini:<model>
                          openrouter:<model> · groq:<model> · lmstudio:<model> · anything else is an Ollama model
                          e.g. --compile-model openai:<model> --cpu-model openai:<small model>   (OPENAI_API_KEY)
                          In the dev UI the models can be changed while it runs (the model names in the top bar).`;
  if (!cmd || cmd === "help" || cmd === "--help") { console.log(HELP); return }
  // `dev` and `try` open even when a model cannot run yet: the dev UI says what is missing and lets you choose another
  const missing = (await Promise.all([compileModel, cpuModel].map(missingFor))).filter(Boolean);
  if (missing.length && cmd !== "dev" && cmd !== "try") { console.error([...new Set(missing)].join("\n")); process.exit(2) }
  if (missing.length) console.error("note: " + [...new Set(missing)].join("; ") + " — choose another model in the dev UI");

  const pick = () => {
    const f = args.find(a => a.endsWith(".kuron")); if (f) return resolve(f);
    const list = readdirSync(".", { withFileTypes: true }).filter(e => e.isFile() && e.name.endsWith(".kuron")).map(e => e.name);
    if (list.length === 1) return resolve(list[0]); console.error(list.length ? "several .kuron here; name one" : "no .kuron here"); process.exit(1);
  };
  // `kuron try`: the examples, copied next to you so the systems kuron sets up are yours to keep
  if (cmd === "try") {
    const from = join(dirname(fileURLToPath(import.meta.url)), "..", "examples"), to = resolve("kuron-examples");
    mkdirSync(to, { recursive: true });
    for (const f of readdirSync(from, { withFileTypes: true }).filter(e => e.isFile() && e.name.endsWith(".kuron")).map(e => e.name)) if (!existsSync(join(to, f))) copyFileSync(join(from, f), join(to, f));
    const { url } = await serve({ file: existsSync(join(to, "clinic.kuron")) ? join(to, "clinic.kuron") : null, dir: to, port, compileModel, cpuModel, remember: !named });
    console.log(`kuron: ${url}  (examples in ${to}; setup: ${compileModel}, events: ${cpuModel})\nEach example sets itself up the first time you open it (about a minute).`);
    return;
  }
  if (cmd === "dev") {
    const f = args.find(a => a.endsWith(".kuron")), d = args.find(a => !a.endsWith(".kuron") && existsSync(a));
    const dir = f ? dirname(resolve(f)) : resolve(d || ".");
    const { url } = await serve({ file: f ? resolve(f) : null, dir, port, compileModel, cpuModel, remember: !named });
    console.log(`kuron dev: ${url}  (setup: ${compileModel}, events: ${cpuModel})\npresentation: ${url}present`);
    return;
  }
  if (cmd === "new") {
    const idea = args.filter(a => !a.endsWith(".kuron")).join(" ").trim(); if (!idea) { console.error('kuron new "what you want"'); process.exit(1) }
    const f = resolve(out || "idea.kuron"); if (existsSync(f)) { console.error(f + " already exists"); process.exit(1) }
    writeFileSync(f, idea + "\n");
    const t0 = Date.now(), { server, host } = await serve({ file: f, dir: dirname(f), port: 0, compileModel, cpuModel });
    const P = await host.setupDone(); server.close();
    const d = P.world.data;
    if (P.error) { console.error(P.error.message); process.exit(1) }
    console.log(`${d.name}: ready in ${((Date.now() - t0) / 1000).toFixed(0)}s — ${d.screens.length} screens, ${Object.keys(d.collections).length} collections, ${d.checks.length} checks`);
    process.exit(0);
  }
  if (cmd === "check") {
    const f = pick(), { server, host } = await serve({ file: f, dir: dirname(f), port: 0, compileModel, cpuModel });
    const P = await host.setupDone();
    if (P.error) { console.error("setup failed: " + P.error.message); process.exit(1) }
    if (!P.world.data.checks.length) { console.error("this system has no checks to run"); process.exit(1) }
    const res = await host.runChecks(); server.close();
    for (const c of res) { console.log((c.ok ? "✓ " : "✗ ") + c.name + (c.error ? "  — " + c.error : "")); for (const e of c.expect) console.log("    " + (e.pass ? "ok  " : "NG  ") + e.text + "\n        " + e.reason) }
    process.exit(res.every(c => c.ok) ? 0 : 1);
  }
  console.log(HELP);
}
