// Dev server: hosts the world and the hands, and lets an LLM behave as the system.
// A .kuron file is an idea in words; opening it lets the setup agent build the system the first time.
import { createServer } from "node:http";
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, appendFileSync } from "node:fs";
import { join, dirname, extname, basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { World } from "./world.js";
import { HANDS, facePart, shapeProblems } from "./hands.js";
import { runTurn, ROLE_MODELS } from "./agent.js";
import { chat, missingFor, available } from "./llm.js";
import { langName } from "./lang.js";
const FRAME = { website: "web", phone: "phone", desktop: "desktop", iot: "iot", terminal: "term", watch: "watch", panel: "panel" };
import { writePlan } from "./upstream.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json" };

export async function serve({ file = null, dir = null, port = 4870, compileModel, cpuModel, remember = false }) {
  dir = resolve(dir || dirname(file));
  const models = { compile: compileModel, cpu: cpuModel };
  // The models chosen in the dev UI are kept next to the ideas; names given on the command line win over them.
  const modelsFile = join(dir, ".kuron", "models.json");
  let aheadOn = false;
  if (remember) try { const m = JSON.parse(readFileSync(modelsFile, "utf8")); if (m.compile) models.compile = m.compile; if (m.cpu) models.cpu = m.cpu; aheadOn = !!m.ahead } catch { }
  const saveSettings = () => { mkdirSync(dirname(modelsFile), { recursive: true }); writeFileSync(modelsFile, JSON.stringify({ ...models, ahead: aheadOn }, null, 1)) };
  const clients = new Set();
  const send = ev => { const d = "data: " + JSON.stringify(ev) + "\n\n"; for (const c of clients) c.write(d) };
  const programs = () => readdirSync(dir, { withFileTypes: true }).filter(e => e.isFile() && e.name.endsWith(".kuron")).map(e => e.name).sort().map(n => {
    const w = join(dir, ".kuron", basename(n, ".kuron"), "world.json");
    let title = basename(n, ".kuron"); try { if (existsSync(w)) title = JSON.parse(readFileSync(w, "utf8")).name || title } catch { }
    return { file: n, title };
  });
  const turns = new Map();       // turn id → what this turn's hands may use
  const U = { busy: false, kind: null, error: null };
  let P = null, gen = 0, realityOn = false, hostUrl = "";

  /* ---------- the open program ---------- */
  function load(f) {
    gen++; if (P) { P.timers.forEach(clearInterval); P.unsub() }
    const file = resolve(dir, f), work = join(dir, ".kuron", basename(file, ".kuron"));
    mkdirSync(work, { recursive: true });
    const world = new World(join(work, "world.json"));
    P = { file, work, world, timers: [], queue: Promise.resolve(), requests: [], checks: null, setting: false, ahead: { ver: null, map: new Map(), waiting: [], running: 0 } };
    try { P.requests = JSON.parse(readFileSync(join(work, "requests.json"), "utf8")) } catch { }
    P.unsub = world.on(what => { send({ type: "world", what, status: status() }); if (what === "timers") schedule() });
    send({ type: "program", program: basename(file) });
    if (!world.data.screens.length) setup(); else schedule();
  }
  const faceIR = () => {
    const d = P.world.data;
    return { name: d.name, desc: "", lang: d.lang, reality: d.reality, checks: d.checks.map(c => ({ name: c.name, text: c.name })), events: {},
      state: { fields: [] }, screens: d.screens.map(s => ({ name: s.name, form: FRAME[s.frame] || "panel", formLabel: s.device, view: s.parts.map(facePart) })) };
  };
  const status = () => ({ file: P.file, program: basename(P.file), programs: programs(), name: P.world.data.name, text: readFileSync(P.file, "utf8"),
    ir: P.world.data.screens.length ? faceIR() : null, state: P.world.view(), brief: P.world.data.brief, compiling: P.setting, stage: P.setting ? "setup" : null,
    error: P.error || null, warnings: [], stats: P.stats || null, checks: P.checks, upstream: U, requests: P.requests, sid: "world", realityOn, aheadOn, models });

  // Every turn of an LLM goes through here: it gets a turn id its hands are bound to.
  async function turn(role, message, { images = [], sound = null, world = P.world, silent = false, held = null } = {}) {
    const id = randomUUID(), calls = [];
    turns.set(id, { role, world, images, sound, calls, emit: ev => { if (held) held.push(ev); else if (!silent) send(ev) } });
    const model = models[ROLE_MODELS[role]];
    try { const r = await runTurn({ role, model, world, hostUrl, turnId: id, message, reality: role === "event" && realityOn ? world.data.reality : null, images }); return { ...r, calls } }
    finally { turns.delete(id) }
  }
  function setup() {
    const g = gen; P.setting = true; P.error = null; send({ type: "compile", phase: "start" });
    const t0 = Date.now();
    turn("setup", readFileSync(P.file, "utf8"))
      .then(r => { if (g !== gen) return; if (!P.world.data.screens.length) P.error = { code: "setup", message: "the setup model finished without defining any screen" + (r.text ? ": " + r.text.slice(0, 200) : "") }; P.stats = { ms: Date.now() - t0, cost: r.cost, turns: r.turns }; appendFileSync(join(P.work, "traces.jsonl"), JSON.stringify({ at: new Date().toISOString(), role: "setup", text: r.text, ms: r.ms, cost: r.cost, calls: r.calls }) + "\n") })
      .catch(e => { if (g === gen) P.error = { code: "setup", message: e.message } })
      .finally(() => { if (g !== gen) return; P.setting = false; schedule(); send({ type: "compile", phase: "done", status: status() }) });
  }
  function schedule() {
    P.timers.forEach(clearInterval); P.timers = [];
    for (const t of P.world.data.timers) {
      let busy = false;
      P.timers.push(setInterval(() => { if (busy) return; busy = true; event({ intent: t.intent, source: "timer " + t.name }).catch(() => { }).finally(() => busy = false) }, Math.max(5, t.every) * 1000));
    }
  }
  const eventText = ev => `EVENT: ${ev.intent}${ev.screen ? `\nON SCREEN: ${ev.screen}` : ""}${ev.item ? `\nITEM: ${JSON.stringify(ev.item)}` : ""}${ev.inputs && Object.keys(ev.inputs).length ? `\nINPUTS: ${JSON.stringify(ev.inputs)}` : ""}`;

  /* ---------- looking ahead: while nobody is pressing anything, the same event turn is played on copies of the world
     for the things a person could touch next. A press whose answer is already there takes it as it is. Nothing is
     guessed: each answer is a whole turn of the LLM, kept only while the world is exactly as it was. ---------- */
  const AHEAD_MAX = 12, AHEAD_AT_ONCE = 3;
  const worldVer = () => createHash("sha1").update(JSON.stringify(P.world.data)).digest("hex");
  const keyOf = ev => JSON.stringify([ev.intent, ev.screen || "", ev.item || null, ev.inputs || {}]);
  const aheadNote = () => { const A = P.ahead, all = [...A.map.values()]; send({ type: "ahead", on: aheadOn, ready: all.filter(e => e.state === "ready").length, total: all.length }) };
  function lookAhead(cands) {
    if (!aheadOn || realityOn || P.setting || U.busy || !P.world.data.screens.length) return;
    const A = P.ahead, ver = worldVer();
    if (A.ver !== ver) { A.ver = ver; A.map = new Map(); A.waiting = [] }   // answers for an older world finish on their own and are dropped
    for (const ev of cands) {
      if (!ev || typeof ev.intent !== "string" || !ev.intent) continue;
      const k = keyOf(ev); if (A.map.has(k) || A.map.size >= AHEAD_MAX) continue;
      const e = { ev: { intent: ev.intent, screen: ev.screen, item: ev.item || null, inputs: ev.inputs || {} }, ver, state: "waiting" }; A.map.set(k, e); A.waiting.push(e);
    }
    pump(); aheadNote();
  }
  function pump() {
    const A = P.ahead, p = P;
    if (A.waiting.length && worldVer() !== A.ver) { A.waiting = []; return }
    while (A.running < AHEAD_AT_ONCE && A.waiting.length) {
      const e = A.waiting.shift(), w = P.world.copy(), held = [], t0 = Date.now();
      A.running++; e.state = "running";
      e.done = turn("event", eventText(e.ev), { world: w, held }).then(r => { e.state = "ready"; return { r, world: w, held, ms: Date.now() - t0 } }, () => { e.state = "failed"; return null })
        .finally(() => { A.running--; if (p === P) { pump(); if (e.ver === A.ver) aheadNote() } });
    }
  }
  // Take an answer that was played ahead, if there is one for exactly this event on exactly this world.
  async function takeAhead(ev) {
    if (!aheadOn || realityOn || ev.source || ev.sound || (ev.images && ev.images.length)) return null;
    const A = P.ahead, e = A.map.get(keyOf(ev)), ver = worldVer();
    if (!e || e.ver !== ver || !e.done) return null;
    const got = await e.done; if (!got || worldVer() !== ver) return null;
    const timers = JSON.stringify(P.world.data.timers), d = got.world.data;
    P.world.data = d; P.world.changed("state"); if (JSON.stringify(d.timers) !== timers) P.world.changed("timers");
    got.held.forEach(send);
    return { ...got.r, aheadMs: got.ms };
  }

  // An event: a button, a timer, a camera frame, sound. Events run one at a time per world.
  function event(ev) {
    const run = P.queue.then(async () => {
      const t0 = Date.now();
      const msg = `EVENT: ${ev.intent}${ev.screen ? `\nON SCREEN: ${ev.screen}` : ""}${ev.item ? `\nITEM: ${JSON.stringify(ev.item)}` : ""}${ev.inputs && Object.keys(ev.inputs).length ? `\nINPUTS: ${JSON.stringify(ev.inputs)}` : ""}${ev.images && ev.images.length ? "\nA camera picture came with it (use look)." : ""}${ev.sound ? "\nSound came with it (use listen)." : ""}${ev.source ? `\nFROM: ${ev.source}` : ""}`;
      const r = await takeAhead(ev) || await turn("event", msg, { images: ev.images || [], sound: ev.sound || null });
      // existing-technology mode: answer as late as the estimate for this intent says (the general figure if none is given for it)
      const R = realityOn && P.world.data.reality, own = R && (R.intents || []).find(x => x.intent === ev.intent), delay = own ? own.delayMs : R ? R.decisionDelayMs : 0;
      if (delay > 0) await new Promise(x => setTimeout(x, Math.min(8000, delay)));
      const trace = { id: randomUUID().slice(0, 8), at: new Date().toISOString(), action: ev.intent, inputs: ev.inputs || {}, target: ev.item || null, steps: r.calls.map(c => c.name + " " + JSON.stringify(c.args).slice(0, 200)), calls: r.calls, notice: r.text, ms: Date.now() - t0, cost: r.cost, reality: realityOn || undefined, ahead: r.aheadMs || undefined };
      appendFileSync(join(P.work, "traces.jsonl"), JSON.stringify(trace) + "\n"); send({ type: "trace", trace });
      if (r.text) send({ type: "notice", text: r.text });
      return { state: P.world.view(), notice: r.text, ms: trace.ms };
    });
    P.queue = run.catch(() => { }); return run;
  }

  /* ---------- jobs shared by every program ---------- */
  function job(kind, fn) {
    if (U.busy) return false;
    Object.assign(U, { busy: true, kind, error: null, started: Date.now() }); send({ type: "upstream", upstream: U });
    fn().then(() => Object.assign(U, { busy: false, error: null }), e => Object.assign(U, { busy: false, error: e.message })).finally(() => send({ type: "upstream", upstream: U, status: status() }));
    return true;
  }
  const saveReq = () => writeFileSync(join(P.work, "requests.json"), JSON.stringify(P.requests, null, 1));
  const fileName = title => { const b = (title || "idea").replace(/[\\/:*?"<>|\s]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "idea"; let n = b + ".kuron", i = 2; while (existsSync(join(dir, n))) n = b + "-" + i++ + ".kuron"; return n };

  /* ---------- checks: the agent plays each scenario on a copy of the world, then an LLM judges ---------- */
  async function runChecks() {
    const out = [];
    for (const c of P.world.data.checks) {
      const w = P.world.copy(), before = w.view(), r = { name: c.name, text: c.name, steps: [], expect: [], ok: true };
      try {
        for (const s of c.steps) {
          const res = await turn("event", `EVENT: ${s.intent}${s.inputs ? `\nINPUTS: ${JSON.stringify(s.inputs)}` : ""}${s.item ? `\nITEM (find it yourself): ${s.item}` : ""}`, { world: w, silent: true });
          r.steps.push({ action: s.intent, inputs: s.inputs || {}, ms: res.ms, notice: res.text });
        }
        for (const e of c.expect) {
          const { value } = await chat({ model: models.cpu, temperature: 0, system: `You judge a test of a system. Decide strictly whether the expectation holds, comparing the world before and after. When the expectation is about what a person sees (shown, listed, gone from a list, a count on a screen), judge what the screens would draw from the world: a list or table with "where" shows only the items whose property equals that value, in the given order. Explain briefly in ${langName(w.data.lang)}, quoting the values you looked at.`,
            user: JSON.stringify({ scenario: c.name, expectation: e, screens: w.data.screens, before, after: w.view() }), schema: { type: "object", properties: { pass: { type: "boolean" }, reason: { type: "string" } }, required: ["pass", "reason"] } });
          r.expect.push({ text: e, pass: value.pass, reason: value.reason }); if (!value.pass) r.ok = false;
        }
      } catch (e) { r.ok = false; r.error = e.message }
      out.push(r);
    }
    return out;
  }

  /* ---------- reverse: brief + screens + what the system actually did ---------- */
  function specMd() {
    const d = P.world.data, L = [];
    L.push(`# ${d.name} — specification from a running kuron prototype`, "", "## Brief", "", d.brief, "", "## Data", "");
    for (const [k, v] of Object.entries(d.collections)) L.push(`- **${k}** (${v.length} items) — properties: ${[...new Set(v.flatMap(x => Object.keys(x)))].join(", ")}`);
    for (const k of Object.keys(d.values)) L.push(`- value **${k}**`);
    L.push("", "## Screens", "");
    for (const s of d.screens) { L.push(`### ${s.name} (${s.device})`, ""); s.parts.forEach(p => L.push(`- ${p.kind}${p.text ? ` "${p.text}"` : ""}${p.collection ? ` of ${p.collection}` : ""}${p.intent ? ` → ${p.intent}` : ""}`)); L.push("") }
    L.push("## What the system did (golden examples)", "");
    let n = 0;
    try { for (const l of readFileSync(join(P.work, "traces.jsonl"), "utf8").split("\n").reverse()) { if (!l.trim() || n >= 20) continue; const t = JSON.parse(l); if (!t.action) continue; n++; L.push(`### ${t.action}`, "", "```json", JSON.stringify({ inputs: t.inputs, item: t.target, hands: t.calls, reply: t.notice }, null, 1).slice(0, 3000), "```", "") } } catch { }
    L.push("## Checks", ""); d.checks.forEach(c => { L.push(`- ${c.name}`); c.expect.forEach(e => L.push(`  - expect: ${e}`)) });
    if (d.reality) {
      L.push("", "## Existing technology estimate", "", d.reality.summary, ...d.reality.items.map(i => `- ${i.part}: ${i.existing} → ${i.effect}`));
      if ((d.reality.intents || []).length) {
        L.push("", "### Per intent: what is ordinary code, what needs a model or a service, what is not possible yet", "", "| intent | part | built with | detail | error rate | delay |", "|---|---|---|---|---|---|");
        for (const x of d.reality.intents) for (const p of x.parts) L.push(`| ${x.intent} | ${p.what} | ${p.builtWith} | ${p.detail} | ${Math.round(x.errorRate * 100)}% | ${x.delayMs} ms |`);
      }
    }
    return L.join("\n") + "\n";
  }

  /* ---------- speech for the speak part ---------- */
  let voices = null;
  const voiceFor = lang => {
    if (!voices) { try { voices = execFileSync("say", ["-v", "?"], { encoding: "utf8" }).split("\n").map(l => /^(.+?)\s{2,}([a-z]{2}_[A-Z]{2})/.exec(l)).filter(Boolean).map(m => ({ name: m[1].trim(), loc: m[2] })) } catch { voices = [] } }
    const own = voices.filter(v => v.loc.startsWith(lang + "_")); return (own[0] || {}).name || null;
  };

  const body = req => new Promise(r => { let d = ""; req.on("data", c => d += c); req.on("end", () => { try { r(d ? JSON.parse(d) : {}) } catch { r({}) } }) });
  const json = (res, code, o) => { res.writeHead(code, { "content-type": "application/json; charset=utf-8" }); res.end(JSON.stringify(o)) };

  const server = createServer(async (req, res) => {
    const u = new URL(req.url, "http://x");
    try {
      if (req.method === "GET" && (u.pathname === "/" || u.pathname === "/present")) { res.writeHead(200, { "content-type": MIME[".html"] }); return res.end(readFileSync(join(ROOT, "ui", "index.html"))) }
      if (req.method === "GET" && u.pathname.startsWith("/ui/")) { const p = join(ROOT, "ui", basename(u.pathname)); if (!existsSync(p)) { res.writeHead(404); return res.end() } res.writeHead(200, { "content-type": MIME[extname(p)] || "text/plain" }); return res.end(readFileSync(p)) }
      if (u.pathname === "/api/events") { res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" }); res.write("data: {\"type\":\"hello\"}\n\n"); clients.add(res); req.on("close", () => clients.delete(res)); return }
      if (u.pathname === "/api/hand" && req.method === "POST") {
        const b = await body(req); const ext = /^external:(setup|event|request)$/.exec(String(b.turn || "")), h = HANDS.find(x => x.name === b.name);
        const t = turns.get(b.turn) || (ext && P ? { role: ext[1], world: P.world, images: [], sound: null, calls: [], emit: send } : null);
        if (!t) return json(res, 200, { content: [{ type: "text", text: b.turn === "external" ? 'name the role you act in: use turn "external:setup", "external:event" or "external:request"' : "this turn has ended" }], isError: true });
        if (!h || !h.roles.includes(t.role)) return json(res, 200, { content: [{ type: "text", text: `hand "${b.name}" is not available here` }], isError: true });
        const problems = shapeProblems(h.input, b.args || {});
        if (problems.length) return json(res, 200, { content: [{ type: "text", text: "not done, fix and call again: " + problems.slice(0, 12).join("; ") }], isError: true });
        try { const r = await h.run({ world: t.world, turn: t, emit: t.emit }, b.args || {}); t.calls.push({ name: b.name, args: b.args }); return json(res, 200, r) }
        catch (e) { return json(res, 200, { content: [{ type: "text", text: e.message }], isError: true }) }
      }
      if (u.pathname === "/api/models" && req.method === "GET") return json(res, 200, { models, available: await available() });
      if (u.pathname === "/api/models" && req.method === "POST") {
        const b = await body(req), next = { compile: String(b.compile ?? models.compile).trim(), cpu: String(b.cpu ?? models.cpu).trim() };
        const problems = (await Promise.all(Object.entries(next).map(async ([k, m]) => [k, await missingFor(m)]))).filter(x => x[1]).map(([k, m]) => `${k === "compile" ? "setup" : "events"}: ${m}`);
        if (problems.length) return json(res, 400, { error: problems.join(" / ") });
        Object.assign(models, next); saveSettings();
        send({ type: "models", status: status() });
        if (P && !P.setting && !P.world.data.screens.length) setup();   // an idea that could not be set up before gets its turn now
        return json(res, 200, { models });
      }
      if (u.pathname === "/api/status") return json(res, 200, status());
      if (u.pathname === "/api/state") return json(res, 200, { state: P.world.view() });
      if (u.pathname === "/api/traces") { let t = []; try { t = readFileSync(join(P.work, "traces.jsonl"), "utf8").split("\n").filter(Boolean).slice(-100).map(l => JSON.parse(l)).filter(x => x.action) } catch { } return json(res, 200, { traces: t }) }
      if (u.pathname === "/api/programs") return json(res, 200, { programs: programs(), program: basename(P.file) });
      if (u.pathname === "/api/open" && req.method === "POST") { const b = await body(req), f = basename(String(b.file || "")); if (!f.endsWith(".kuron") || !existsSync(join(dir, f))) return json(res, 404, { error: "no_program" }); if (f !== basename(P.file)) load(f); return json(res, 200, { ok: true }) }
      if (u.pathname === "/api/new" && req.method === "POST") {
        const b = await body(req), idea = String(b.idea || "").trim(); if (!idea) return json(res, 400, { error: "empty" });
        const f = fileName(idea.slice(0, 24)); writeFileSync(join(dir, f), idea + "\n"); load(f); return json(res, 200, { ok: true, file: f });
      }
      if (u.pathname === "/api/source" && req.method === "POST") { const b = await body(req); if (typeof b.text === "string" && b.text.trim()) writeFileSync(P.file, b.text); return json(res, 200, { ok: true }) }
      if (u.pathname === "/api/session" && req.method === "POST") { // start over: rebuild the world from the idea
        P.world.data = new World().data; P.world.changed("reset"); setup(); return json(res, 200, { id: "world", state: P.world.view() });
      }
      if ((u.pathname === "/api/event" || u.pathname === "/api/act") && req.method === "POST") {
        const b = await body(req);
        try { return json(res, 200, await event({ intent: b.intent || b.action, screen: b.screen, item: b.item || null, inputs: b.inputs || {}, images: Array.isArray(b.images) ? b.images.slice(0, 4) : [], sound: b.sound || (b.inputs && b.inputs.sound) || null })) }
        catch (e) { return json(res, 500, { error: e.message }) }
      }
      if (u.pathname === "/api/ahead" && req.method === "POST") {
        const b = await body(req);
        if (typeof b.on === "boolean") { aheadOn = b.on; if (remember) saveSettings(); if (!aheadOn) { P.ahead.map = new Map(); P.ahead.waiting = []; P.ahead.ver = null } aheadNote() }
        if (Array.isArray(b.candidates)) lookAhead(b.candidates.slice(0, 40));
        return json(res, 200, { on: aheadOn });
      }
      if (u.pathname === "/api/reality" && req.method === "POST") { const b = await body(req); realityOn = !!b.on; send({ type: "reality", on: realityOn }); return json(res, 200, { on: realityOn }) }
      if (u.pathname === "/api/check" && req.method === "POST") { send({ type: "check", phase: "start" }); P.checks = await runChecks(); send({ type: "check", phase: "done", checks: P.checks }); return json(res, 200, { checks: P.checks }) }
      if (u.pathname === "/api/requests" && req.method === "POST") { const b = await body(req); const r = { id: Date.now().toString(36), at: new Date().toISOString(), text: String(b.text || "").slice(0, 2000), context: b.context || null, status: "open" }; if (!r.text.trim()) return json(res, 400, { error: "empty" }); P.requests.push(r); saveReq(); send({ type: "requests", requests: P.requests }); return json(res, 200, r) }
      if (u.pathname === "/api/apply" && req.method === "POST") {
        const b = await body(req);
        const r = P.requests.find(x => x.id === b.id) || (b.text ? { id: Date.now().toString(36), at: new Date().toISOString(), text: b.text, context: b.context || null, status: "open" } : null);
        if (!r) return json(res, 404, { error: "no_request" }); if (!P.requests.includes(r)) P.requests.push(r);
        const started = job("revise", async () => {
          r.status = "working"; saveReq(); send({ type: "requests", requests: P.requests });
          try { const out = await turn("request", `REQUEST: ${r.text}${r.context ? `\nWHERE: ${JSON.stringify(r.context)}` : ""}`); r.status = "done"; r.reply = out.text; schedule() }
          catch (e) { r.status = "open"; r.error = e.message; throw e } finally { saveReq(); send({ type: "requests", requests: P.requests }) }
        });
        return json(res, started ? 200 : 409, started ? { ok: true } : { error: "upstream_busy" });
      }
      if (u.pathname === "/api/reverse" && req.method === "GET") { const rd = join(dir, "reverse", basename(P.file, ".kuron")); const rf = n => existsSync(join(rd, n)) ? readFileSync(join(rd, n), "utf8") : null; return json(res, 200, { dir: rd, spec: rf("SPEC.md"), plan: rf("PLAN.md") }) }
      if (u.pathname === "/api/reverse" && req.method === "POST") {
        const rd = join(dir, "reverse", basename(P.file, ".kuron")); mkdirSync(rd, { recursive: true });
        const spec = specMd(); writeFileSync(join(rd, "SPEC.md"), spec); writeFileSync(join(rd, "world.json"), JSON.stringify(P.world.data, null, 1));
        const started = job("plan", async () => writeFileSync(join(rd, "PLAN.md"), await writePlan(spec, { lang: P.world.data.lang, cwd: dir, model: models.compile })));
        return json(res, started ? 200 : 409, started ? { ok: true, dir: rd } : { error: "upstream_busy" });
      }
      if (u.pathname === "/api/speak") {
        const text = String(u.searchParams.get("text") || "").slice(0, 400), v = voiceFor(P.world.data.lang || "ja");
        const f = join(P.work, "speech", createHash("sha1").update((v || "") + text).digest("hex") + ".wav");
        try { if (!existsSync(f)) { mkdirSync(dirname(f), { recursive: true }); execFileSync("say", [...(v ? ["-v", v] : []), "-o", f, "--file-format=WAVE", "--data-format=LEI16@22050", text]) } res.writeHead(200, { "content-type": "audio/wav" }); return res.end(readFileSync(f)) }
        catch (e) { return json(res, 500, { error: "speech_failed: " + e.message }) }
      }
      res.writeHead(404); res.end();
    } catch (e) { json(res, 500, { error: e.message }) }
  });
  await new Promise((r, j) => { server.once("error", e => j(e.code === "EADDRINUSE" ? new Error(`ポート ${port} はもう使われています / Port ${port} is already in use.`) : e)); server.listen(port, "127.0.0.1", r) });
  hostUrl = `http://127.0.0.1:${server.address().port}`;
  const first = file ? basename(file) : (programs()[0] || {}).file;
  if (!first) throw new Error("no .kuron idea in " + dir);
  load(first);
  return { url: hostUrl + "/", server, host: { get world() { return P.world }, event, runChecks, status, setupDone: () => new Promise(r => { const t = setInterval(() => { if (!P.setting) { clearInterval(t); r(P) } }, 500) }) } };
}
