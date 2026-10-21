// Development server: compiles the program on every save, runs it on the LLM-CPU, and connects
// the browser UI to upstream (Claude Code) for revisions and reverse-engineering plans.
import { createServer } from "node:http";
import { readFileSync, writeFileSync, existsSync, mkdirSync, watch, readdirSync } from "node:fs";
import { join, dirname, extname, basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { compile } from "./compile.js";
import { VM } from "./vm.js";
import { models, chat } from "./llm.js";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { langName } from "./source.js";
import { reviseProgram, writePlan, writeProgram } from "./upstream.js";
import { parseSource } from "./source.js";
import { buildSpec, loadTraces, examplesJsonl } from "./reverse.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml" };

// One server serves every .kuron program in a folder; one of them is open at a time.
export async function serve({ file = null, dir = null, port = 4870, compileModel, cpuModel }) {
  dir = resolve(dir || dirname(file));
  const clients = new Set();
  const send = ev => { const d = "data: " + JSON.stringify(ev) + "\n\n"; for (const c of clients) c.write(d) };
  const programs = () => readdirSync(dir, { withFileTypes: true }).filter(e => e.isFile() && e.name.endsWith(".kuron")).map(e => e.name).sort().map(n => {
    let title = n; try { title = parseSource(readFileSync(join(dir, n), "utf8")).name } catch { }
    return { file: n, title };
  });
  // upstream (Claude Code) work is shared by every program
  file = file && resolve(file);
  const U = { busy: false, kind: null, error: null };
  let S, work, reqFile, watcher = null, gen = 0, pending = false, timers = [], realityOn = false;
  const stateFile = () => join(work, "state.json");
  const saveState = () => { const s = S.vm && S.vm.get(S.sid); if (s) writeFileSync(stateFile(), JSON.stringify({ sid: s.id, savedAt: new Date().toISOString(), state: s.state }, null, 1)) };
  // "Every N seconds" actions run on the open session for as long as the server runs
  function schedule() {
    timers.forEach(clearInterval); timers = [];
    if (!S.ir) return;
    const g = gen;
    for (const [name, ev] of Object.entries(S.ir.events)) if (ev.every) {
      let busy = false;
      timers.push(setInterval(async () => {
        if (busy || g !== gen || !S.sid) return; busy = true;
        try { const r = await S.vm.dispatch(S.sid, name, {}); saveState(); send({ type: "state", sid: S.sid, state: r.state }) } catch { }
        busy = false;
      }, Math.max(5, ev.every) * 1000));
    }
  }
  const status = () => ({ file, program: basename(file), programs: programs(), name: S.ir?.name || null, text: S.text, ir: S.ir, compiling: S.compiling, stage: S.stage, error: S.error, warnings: S.warnings, stats: S.stats, checks: S.checks, upstream: U, requests: S.requests, sid: S.sid, realityOn, models: { compile: compileModel, cpu: cpuModel } });

  function load(f) {
    gen++; pending = false; timers.forEach(clearInterval); timers = [];
    if (watcher) watcher.close();
    file = resolve(dir, f); work = join(dir, ".kuron", basename(file, extname(file)));
    mkdirSync(work, { recursive: true });
    S = { text: readFileSync(file, "utf8"), ir: null, vm: null, compiling: false, stage: null, error: null, warnings: [], stats: null, checks: null, requests: [], sid: null };
    reqFile = join(work, "requests.json");
    if (existsSync(reqFile)) try { S.requests = JSON.parse(readFileSync(reqFile, "utf8")) } catch { }
    let wt = null;
    watcher = watch(file, () => { clearTimeout(wt); wt = setTimeout(() => { try { const t = readFileSync(file, "utf8"); if (t !== S.text) { S.text = t; send({ type: "source", text: t }); build() } } catch { } }, 250) });
    send({ type: "program", program: basename(file) });
    build();
  }

  async function build() {
    if (S.compiling) { pending = true; return }
    const g = gen, P = S;
    P.compiling = true; P.error = null; send({ type: "compile", phase: "start" });
    try {
      const r = await compile(P.text, { model: compileModel, cacheDir: work, onProgress: p => { if (g !== gen) return; P.stage = p.stage; send({ type: "compile", phase: "stage", stage: p.stage }) } });
      if (g !== gen) return;
      if (!r.ok) { S.error = { code: "source", errors: r.errors } }
      else {
        r.ir.model = cpuModel; S.ir = r.ir; S.warnings = r.ir.warnings; S.stats = r.stats; S.checks = null;
        writeFileSync(join(work, "ir.json"), JSON.stringify(r.ir, null, 1));
        if (S.vm) S.vm.setIR(r.ir); else S.vm = new VM(r.ir, { dir: work, onEvent: send });
        S.vm.realityOn = realityOn;
        if (!S.sid || !S.vm.get(S.sid)) {
          let saved = null; try { saved = JSON.parse(readFileSync(stateFile(), "utf8")) } catch { }
          S.sid = saved && saved.sid ? S.vm.restore(saved.sid, saved.state).id : (await S.vm.newSession()).id;
          saveState();
        }
        schedule();
      }
    } catch (e) { if (g === gen) S.error = { code: "compile", message: e.message } }
    P.compiling = false; P.stage = null;
    if (g !== gen) return;
    send({ type: "compile", phase: "done", status: status() });
    if (pending) { pending = false; build() }
  }

  const body = req => new Promise(r => { let d = ""; req.on("data", c => d += c); req.on("end", () => { try { r(d ? JSON.parse(d) : {}) } catch { r({}) } }) });
  const json = (res, code, o) => { res.writeHead(code, { "content-type": "application/json; charset=utf-8" }); res.end(JSON.stringify(o)) };
  const saveReq = () => writeFileSync(reqFile, JSON.stringify(S.requests, null, 1));

  // Starts an upstream (Claude Code) job without waiting for it; progress goes out over SSE.
  function upstream(kind, fn) {
    if (U.busy) return false;
    Object.assign(U, { busy: true, kind, error: null, started: Date.now(), done: null }); send({ type: "upstream", upstream: U });
    fn().then(() => Object.assign(U, { busy: false, error: null, done: Date.now() }), e => Object.assign(U, { busy: false, error: e.message }))
      .finally(() => send({ type: "upstream", upstream: U, status: status() }));
    return true;
  }
  // speech for the speak component: macOS `say`, one voice per language, cached as WAV
  let voices = null;
  const voiceFor = lang => {
    if (!voices) { try { voices = execFileSync("say", ["-v", "?"], { encoding: "utf8" }).split("\n").map(l => /^(.+?)\s{2,}([a-z]{2}_[A-Z]{2})/.exec(l)).filter(Boolean).map(m => ({ name: m[1].trim(), loc: m[2] })) } catch { voices = [] } }
    const pref = { ja: ["Kyoko", "Otoya"], en: ["Samantha", "Alex"], zh: ["Tingting", "Meijia"], ko: ["Yuna"] }[lang] || [];
    const own = voices.filter(v => v.loc.startsWith(lang + "_"));
    return (own.find(v => pref.includes(v.name)) || own[0] || {}).name || null;
  };
  const fileName = title => {
    const base = (title || "app").replace(/[\\/:*?"<>|\s]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "app";
    let n = base + ".kuron", i = 2; while (existsSync(join(dir, n))) n = base + "-" + (i++) + ".kuron";
    return n;
  };

  const server = createServer(async (req, res) => {
    const u = new URL(req.url, "http://x");
    try {
      if (req.method === "GET" && (u.pathname === "/" || u.pathname === "/present")) { res.writeHead(200, { "content-type": MIME[".html"] }); return res.end(readFileSync(join(ROOT, "ui", "index.html"))) }
      if (req.method === "GET" && u.pathname.startsWith("/ui/")) {
        const p = join(ROOT, "ui", basename(u.pathname));
        if (!existsSync(p)) { res.writeHead(404); return res.end() }
        res.writeHead(200, { "content-type": MIME[extname(p)] || "text/plain" }); return res.end(readFileSync(p));
      }
      if (u.pathname === "/api/events") {
        res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
        res.write("data: " + JSON.stringify({ type: "hello" }) + "\n\n"); clients.add(res); req.on("close", () => clients.delete(res)); return;
      }
      if (u.pathname === "/api/status") return json(res, 200, status());
      if (u.pathname === "/api/reality" && req.method === "POST") {
        const b = await body(req); realityOn = !!b.on; if (S.vm) S.vm.realityOn = realityOn;
        send({ type: "reality", on: realityOn }); return json(res, 200, { on: realityOn });
      }
      if (u.pathname === "/api/set" && req.method === "POST") {
        const b = await body(req); const s = S.vm && S.vm.get(b.sid);
        if (!s || !b.changes || typeof b.changes !== "object") return json(res, 400, { error: "bad_request" });
        for (const [k, v] of Object.entries(b.changes)) if (S.ir.state.fields.some(f => f.name === k)) s.state[k] = v;
        if (b.sid === S.sid) saveState(); send({ type: "state", sid: b.sid, state: s.state }); return json(res, 200, { ok: true });
      }
      if (u.pathname === "/api/decide" && req.method === "POST") {
        const b = await body(req);
        if (!b.schema || typeof b.schema !== "object") return json(res, 400, { error: "schema_required" });
        const s = S.vm && S.vm.get(b.sid);
        try {
          const t0 = Date.now();
          const { value, cost } = await chat({ model: cpuModel, temperature: 0.2, images: Array.isArray(b.images) ? b.images : [],
            system: `You are the decision unit of a Kuron program, a system whose CPU is a language model. Decide concretely and quickly, the way a skilled person in this role would. Text you write is in ${langName(S.ir.lang)}.`,
            user: JSON.stringify({ system: S.ir.name + " — " + S.ir.desc, question: String(b.question || ""), data: b.data ?? null, state: s ? s.state : null }, null, 1),
            schema: { type: "object", properties: { answer: b.schema }, required: ["answer"] } });
          const trace = { id: Date.now().toString(36), at: new Date().toISOString(), sid: b.sid, action: "decide: " + String(b.question || "").slice(0, 60), steps: [String(b.question || "")], inputs: { images: (b.images || []).length }, after: value.answer, ms: Date.now() - t0, cost };
          S.vm.record(trace, false);
          return json(res, 200, { value: value.answer });
        } catch (e) { return json(res, 500, { error: e.message }) }
      }
      if (u.pathname === "/api/speak") {
        const text = String(u.searchParams.get("text") || "").slice(0, 400);
        const v = voiceFor((S.ir && S.ir.lang) || "ja");
        const f = join(work, "speech", createHash("sha1").update((v || "") + text).digest("hex") + ".wav");
        try {
          if (!existsSync(f)) { mkdirSync(dirname(f), { recursive: true }); execFileSync("say", [...(v ? ["-v", v] : []), "-o", f, "--file-format=WAVE", "--data-format=LEI16@22050", text]) }
          res.writeHead(200, { "content-type": "audio/wav", "cache-control": "max-age=3600" }); return res.end(readFileSync(f));
        } catch (e) { return json(res, 500, { error: "speech_failed: " + e.message }) }
      }
      if (u.pathname === "/api/log" && req.method === "POST") {
        const b = await body(req); if (S.vm) S.vm.record({ id: Date.now().toString(36), at: new Date().toISOString(), sid: b.sid, action: "device", steps: [String(b.message || "").slice(0, 500)], ms: 0 }, false);
        return json(res, 200, { ok: true });
      }
      if (u.pathname === "/api/programs") return json(res, 200, { programs: programs(), program: basename(file) });
      if (u.pathname === "/api/open" && req.method === "POST") {
        const b = await body(req); const f = basename(String(b.file || ""));
        if (!f.endsWith(".kuron") || !existsSync(join(dir, f))) return json(res, 404, { error: "no_program" });
        if (f !== basename(file)) load(f);
        return json(res, 200, { ok: true });
      }
      if (u.pathname === "/api/new" && req.method === "POST") {
        const b = await body(req); const idea = String(b.idea || "").trim().slice(0, 4000);
        if (!idea) return json(res, 400, { error: "empty" });
        const started = upstream("new", async () => {
          const text = await writeProgram(idea, { cwd: dir });
          const f = fileName(parseSource(text).name);
          writeFileSync(join(dir, f), text); load(f);
        });
        return json(res, started ? 200 : 409, started ? { ok: true } : { error: "upstream_busy" });
      }
      if (u.pathname === "/api/health") return json(res, 200, { models: await models(), compile: compileModel, cpu: cpuModel });
      if (u.pathname === "/api/source" && req.method === "POST") { const b = await body(req); if (typeof b.text === "string" && b.text !== S.text) { writeFileSync(file, b.text); S.text = b.text; build() } return json(res, 200, { ok: true }) }
      if (u.pathname === "/api/compile" && req.method === "POST") { build(); return json(res, 200, { ok: true }) }
      if (u.pathname === "/api/session" && req.method === "POST") {
        if (!S.vm) return json(res, 409, { error: "not_compiled" });
        const s = await S.vm.newSession(); S.sid = s.id; saveState(); send({ type: "session", sid: s.id, state: s.state }); return json(res, 200, { id: s.id, state: s.state });
      }
      if (u.pathname === "/api/state") { const s = S.vm && S.vm.get(u.searchParams.get("sid")); return s ? json(res, 200, { state: s.state }) : json(res, 404, { error: "no_session" }) }
      if (u.pathname === "/api/act" && req.method === "POST") {
        const b = await body(req);
        try { const r = await S.vm.dispatch(b.sid, b.action, { inputs: b.inputs || {}, list: b.list || "", index: b.index ?? -1, images: Array.isArray(b.images) ? b.images.slice(0, 4) : [] }); if (b.sid === S.sid) saveState(); send({ type: "state", sid: b.sid, state: r.state }); return json(res, 200, { state: r.state, notice: r.notice, ms: r.ms }) }
        catch (e) { return json(res, 500, { error: e.message }) }
      }
      if (u.pathname === "/api/traces") return json(res, 200, { traces: S.vm ? S.vm.traces.slice(-100) : [] });
      if (u.pathname === "/api/check" && req.method === "POST") {
        if (!S.vm) return json(res, 409, { error: "not_compiled" });
        send({ type: "check", phase: "start" });
        S.checks = await S.vm.check({ onProgress: p => send({ type: "check", phase: "progress", ...p }) });
        send({ type: "check", phase: "done", checks: S.checks }); return json(res, 200, { checks: S.checks });
      }
      if (u.pathname === "/api/requests" && req.method === "POST") {
        const b = await body(req); const r = { id: Date.now().toString(36), at: new Date().toISOString(), text: String(b.text || "").slice(0, 2000), context: b.context || null, status: "open" };
        if (!r.text.trim()) return json(res, 400, { error: "empty" });
        S.requests.push(r); saveReq(); send({ type: "requests", requests: S.requests }); return json(res, 200, r);
      }
      if (u.pathname === "/api/apply" && req.method === "POST") {
        const b = await body(req);
        const r = S.requests.find(x => x.id === b.id) || (b.text ? { id: Date.now().toString(36), at: new Date().toISOString(), text: b.text, context: b.context || null, status: "open" } : null);
        if (!r) return json(res, 404, { error: "no_request" });
        if (!S.requests.includes(r)) { S.requests.push(r); saveReq() }
        const started = upstream("revise", async () => {
          r.status = "working"; saveReq(); send({ type: "requests", requests: S.requests });
          try {
            const next = await reviseProgram(S.text, r.text, { context: r.context, cwd: dir });
            writeFileSync(join(work, "before-" + r.id + ".kuron"), S.text);
            writeFileSync(file, next); S.text = next; send({ type: "source", text: next }); r.status = "done";
            build();
          } catch (e) { r.status = "open"; r.error = e.message; throw e }
          finally { saveReq(); send({ type: "requests", requests: S.requests }) }
        });
        return json(res, started ? 200 : 409, started ? { ok: true } : { error: "upstream_busy" });
      }
      if (u.pathname === "/api/reverse" && req.method === "GET") {
        const rd = join(dir, "reverse", basename(file, extname(file)));
        const rf = n => existsSync(join(rd, n)) ? readFileSync(join(rd, n), "utf8") : null;
        return json(res, 200, { dir: rd, spec: rf("SPEC.md"), plan: rf("PLAN.md") });
      }
      if (u.pathname === "/api/reverse" && req.method === "POST") {
        if (!S.ir) return json(res, 409, { error: "not_compiled" });
        const rd = join(dir, "reverse", basename(file, extname(file))); mkdirSync(rd, { recursive: true });
        const traces = loadTraces(join(work, "traces.jsonl"));
        const specMd = buildSpec(S.ir, { source: S.text, traces, checks: S.checks });
        writeFileSync(join(rd, "SPEC.md"), specMd); writeFileSync(join(rd, "examples.jsonl"), examplesJsonl(traces));
        writeFileSync(join(rd, "ir.json"), JSON.stringify(S.ir, null, 1));
        const started = upstream("plan", async () => { const plan = await writePlan(specMd, { lang: S.ir.lang, cwd: dir }); writeFileSync(join(rd, "PLAN.md"), plan) });
        return json(res, started ? 200 : 409, started ? { ok: true, dir: rd } : { error: "upstream_busy" });
      }
      res.writeHead(404); res.end();
    } catch (e) { json(res, 500, { error: e.message }) }
  });
  await new Promise((r, j) => { server.once("error", e => j(e.code === "EADDRINUSE" ? new Error(`ポート ${port} はもう使われています（前の kuron dev が動いていませんか）。止めるか --port で別の番号を指定してください。/ Port ${port} is already in use.`) : e)); server.listen(port, "127.0.0.1", r) });
  const first = file ? basename(file) : (programs()[0] || {}).file;
  if (!first) throw new Error("no .kuron program in " + dir);
  load(first);
  return { url: `http://127.0.0.1:${port}/`, server };
}
