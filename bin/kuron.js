#!/usr/bin/env node
// kuron — the Kuron language toolchain. The local LLM compiles and runs; Claude Code writes upstream.
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from "node:fs";
import { join, dirname, basename, extname, resolve } from "node:path";
import { compile } from "../lib/compile.js";
import { VM } from "../lib/vm.js";
import { models, PRESETS, isClaude } from "../lib/llm.js";
import { execFileSync } from "node:child_process";
import { serve } from "../lib/server.js";
import { writeProgram, writePlan } from "../lib/upstream.js";
import { buildSpec, loadTraces, examplesJsonl } from "../lib/reverse.js";

const args = process.argv.slice(2);
const cmd = args.shift();
const flag = (n, d) => { let i = args.indexOf("--" + n); if (i < 0 && n.length === 1) i = args.indexOf("-" + n); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v };
const cfgFile = join(process.cwd(), "kuron.json");
const cfg = existsSync(cfgFile) ? JSON.parse(readFileSync(cfgFile, "utf8")) : {};
const port = +flag("port", cfg.port || 4870);
const out = flag("o", null);
const lang = flag("lang", null);
const hasClaude = (() => { try { execFileSync(process.env.KURON_CLAUDE || "claude", ["--version"], { stdio: "ignore" }); return true } catch { return false } })();
const preset = flag("preset", process.env.KURON_PRESET || cfg.preset || (hasClaude ? "claude" : "local"));
if (!PRESETS[preset]) { console.error("unknown preset: " + preset + " (claude | local)"); process.exit(1) }
let compileModel = flag("compile-model", process.env.KURON_COMPILE_MODEL || cfg.compileModel || PRESETS[preset].compile);
let cpuModel = flag("cpu-model", process.env.KURON_MODEL || cfg.cpuModel || PRESETS[preset].cpu);

async function pickModels() {
  const local = [compileModel, cpuModel].filter(m => !isClaude(m));
  if ([compileModel, cpuModel].some(isClaude) && !hasClaude) { console.error("`claude` (Claude Code) が見つかりません / Claude Code is not installed. Use --preset local."); process.exit(2) }
  if (!local.length) return;
  const have = await models();
  if (!have) { console.error("ローカル LLM (Ollama) に繋がりません / Cannot reach the local LLM at http://localhost:11434"); process.exit(2) }
  for (const m of local) if (!have.includes(m)) { console.error(`model ${m} is not in Ollama (have: ${have.join(", ")})`); process.exit(2) }
}
const findFile = () => {
  const f = args.find(a => a.endsWith(".kuron"));
  if (f) return resolve(f);
  const local = readdirSync(process.cwd(), { withFileTypes: true }).filter(e => e.isFile() && e.name.endsWith(".kuron")).map(e => e.name);
  if (local.length === 1) return resolve(local[0]);
  console.error(local.length ? "複数の .kuron があります。どれかを指定してください。" : ".kuron ファイルを指定してください。"); process.exit(1);
};
const workDir = f => join(dirname(f), ".kuron", basename(f, extname(f)));

const HELP = `kuron — LLM を CPU とする言語「空論語」/ Kuron, a language whose CPU is an LLM

  kuron new "一言" [-o app.kuron] [--lang ja|en|zh|ko]   上流 (Claude Code) がプログラムを書く / upstream writes a program
  kuron dev [app.kuron | folder] [--port 4870]          開発画面で動かす（フォルダ内を切り替え可）/ run in the dev UI
  kuron compile [app.kuron]                             ローカル LLM でコンパイル / compile with the local LLM
  kuron check [app.kuron]                               検証を LLM-CPU で実行 / run the checks on the LLM-CPU
  kuron reverse [app.kuron]                             仕様・実行例・計画を書き出す / write spec, golden examples and plan

  --preset claude|local   役割分担 / role preset (default: claude)
                            claude: compiler claude-sonnet-5-5, CPU claude-haiku-5-5 (through Claude Code)
                            local:  compiler qwen3.8:27b-mlx, CPU qwen3.5:4b (Ollama)
  --compile-model <name>  コンパイラのモデル / compiler model ("claude-…" = Claude Code, else Ollama)
  --cpu-model <name>      CPU のモデル / CPU model
  upstream (writing and revising programs, plans) always runs in Claude Code.`;

(async () => {
  if (!cmd || cmd === "help" || cmd === "--help") { console.log(HELP); return }
  if (cmd === "new") {
    const idea = args.filter(a => !a.endsWith(".kuron")).join(" ").trim();
    if (!idea) { console.error('kuron new "作りたいもの"'); process.exit(1) }
    const f = resolve(out || "app.kuron");
    if (existsSync(f)) { console.error(f + " はもうあります / already exists"); process.exit(1) }
    process.stderr.write("upstream (Claude Code) is writing the program…\n");
    const t0 = Date.now(); const text = await writeProgram(idea, { lang, cwd: dirname(f) });
    writeFileSync(f, text); console.error(`wrote ${f} in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    console.log(text); return;
  }
  await pickModels();
  if (cmd === "dev") {
    // kuron dev [file.kuron | folder]: the dev UI can switch between every program in the folder
    const f = args.find(a => a.endsWith(".kuron")), d = args.find(a => !a.endsWith(".kuron") && existsSync(a));
    const dir = f ? dirname(resolve(f)) : resolve(d || process.cwd());
    if (!f && !readdirSync(dir, { withFileTypes: true }).some(e => e.isFile() && e.name.endsWith(".kuron"))) { console.error(dir + " に .kuron がありません。kuron new \"一言\" で作れます。"); process.exit(1) }
    const { url } = await serve({ file: f ? resolve(f) : null, dir, port, compileModel, cpuModel });
    console.log(`kuron dev: ${url}  (compile: ${compileModel}, cpu: ${cpuModel})\n発表モード / presentation: ${url}present`);
    return;
  }
  const file = findFile();
  const text = readFileSync(file, "utf8");
  const t0 = Date.now();
  const r = await compile(text, { model: compileModel, cacheDir: workDir(file), onProgress: p => process.stderr.write(p.stage + " ") });
  if (!r.ok) { console.error("\n", JSON.stringify(r.errors)); process.exit(1) }
  r.ir.model = cpuModel;
  mkdirSync(workDir(file), { recursive: true });
  writeFileSync(join(workDir(file), "ir.json"), JSON.stringify(r.ir, null, 1));
  console.error(`\ncompiled in ${((Date.now() - t0) / 1000).toFixed(1)}s (${r.stats.calls} LLM calls, ${r.stats.hits} cached)` + (r.ir.warnings.length ? "\nwarnings: " + JSON.stringify(r.ir.warnings) : ""));
  if (cmd === "compile") return;
  if (cmd === "check") {
    const vm = new VM(r.ir, { dir: workDir(file) });
    const res = await vm.check({ onProgress: p => process.stderr.write("· " + p.check + "\n") });
    for (const c of res) {
      console.log((c.ok ? "✓ " : "✗ ") + c.name + (c.error ? "  — " + c.error : ""));
      for (const e of c.expect) console.log("    " + (e.pass ? "ok  " : "NG  ") + e.text + "\n        " + e.reason);
    }
    process.exit(res.every(c => c.ok) ? 0 : 1);
  }
  if (cmd === "reverse") {
    const rd = join(dirname(file), "reverse", basename(file, extname(file))); mkdirSync(rd, { recursive: true });
    const traces = loadTraces(join(workDir(file), "traces.jsonl"));
    const spec = buildSpec(r.ir, { source: text, traces });
    writeFileSync(join(rd, "SPEC.md"), spec); writeFileSync(join(rd, "examples.jsonl"), examplesJsonl(traces));
    console.error("wrote SPEC.md and examples.jsonl; upstream (Claude Code) is writing PLAN.md…");
    writeFileSync(join(rd, "PLAN.md"), await writePlan(spec, { lang: r.ir.lang, cwd: dirname(file) }));
    console.log(rd); return;
  }
  console.log(HELP);
})().catch(e => { console.error(e.message); process.exit(1) });
