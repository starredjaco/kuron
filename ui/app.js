// kuron dev UI: renders the compiled screens, sends actions to the LLM-CPU, and shows state,
// executions, checks, requests (to upstream Claude Code) and the reverse-engineering plan.
import { createLive } from "/ui/live.js";
const PRESENT = location.pathname === "/present";
const I18N = {
  ja: { modelsTitle: "使うモデル", modelSetup: "セットアップ・要望・計画", modelEvents: "ボタン操作・タイマー・検証の判定", modelSave: "このモデルにする", modelSaved: "モデルを切り替えました",
    ahead: "先読み", aheadTitle: "押せるものの結果を AI が先に演じておき、押した瞬間に反映します（その分 AI を多く使います）",
    modelNote: "名前の書き方: claude-…（Claude Code）／ codex:<モデル>（Codex CLI）／ anthropic:・openai:・gemini:・openrouter:・groq:・lmstudio:<モデル> ／ それ以外は Ollama のモデル名。", modelHere: "この Mac で使えるもの", modelSetupLabel: "準備", modelEventsLabel: "操作", newProgram: "＋ 新しく作る", newIdeaLabel: "作りたいものを一言で", newIdeaPh: "例: 来客の受付をして、担当者のスマホに知らせるシステム", newNote: "セットアップ用のモデルがシステムを立ち上げ、そのまま使える状態で開きます。", create: "作る", writing: "AI が書いています", readyIn: "一言から {s} 秒で使えるようになりました。触って確かめてください。", restored: "前回の続きから再開しました（{t}）", staleServer: "サーバーが古いコードのままです。ターミナルで止めて、起動し直してください。", ideal: "空論", existing: "既存技術", realityTitle: "既存の技術で作った場合", realityNone: "見積もりがありません。", rLatency: "音の遅れ", rLeak: "漏れて直接届く音", rDelay: "判断の遅れ", rError: "判断の誤り", rInterval: "判断の間隔", rIntent: "意図", rPart: "中でやること", rBuilt: "作り方", built: { code: "普通のコード", model: "モデルが必要", service: "外部サービス", not_yet: "今は無理" },
    lvThinking: "LLM が判断しています…", lvDone: "判断しました", lvNoPicture: "まだ映像がありません。カメラを使うか画像で試してください。", lvAuto: "自動", lvUseCamera: "カメラを使う", lvUseImage: "画像で試す", lvLook: "見せて判断", lvCameraHint: "映像は判断のためだけに LLM に渡します。", lvCamera: "カメラ",
    lvUseMic: "マイクを使う", lvSend: "いまの音で判断", lvMic: "マイク", lvPlaySounds: "試す音を流す", lvSounds: "試す音", lvNoSounds: "試す音がまだありません。試す音を作る動きを実行してください。",
    lvFindOutputs: "出力先を探す", lvOutput: "出力", lvNoSink: "このブラウザでは出力先を選べません。OS の出力をイヤホンにしてください。", lvProcOn: "処理あり", lvProcOff: "処理なし（そのまま）", lvOutputTitle: "イヤホン・スピーカー", lvConnect: "イヤホンを接続して、出力先から選んでください。", lvSpeak: "読み上げ", lvNoDrawing: "図はまだありません。",
    newRun: "最初から動かす", runChecks: "検証する", present: "発表モード", requestLabel: "直したいこと", requestPh: "ここをこうしたい…（例: 優先度の理由も出して）", memo: "メモする", applyNow: "AI に反映させる", memoFab: "要望をメモ", cancel: "やめる",
    tabState: "状態", tabTrace: "実行記録", tabCheck: "検証", tabReq: "要望", tabRev: "逆算", tabSrc: "ソース",
    compiling: "準備中", compiled: "動いています", compileFail: "立ち上げに失敗", stage: { setup: "LLM がシステムを立ち上げ中" },
    cpu: "CPU 実行中", noState: "まだ動いていません。", noTraces: "まだ何も実行していません。ボタンを押すと、ここに CPU が実行した命令と状態の変化が出ます。",
    checksNone: "「## 確かめる」がありません。", checksRun: "検証を実行", checksRunning: "検証中…", pass: "合格", fail: "不合格",
    reqNone: "要望はまだありません。発表モードや下の欄からメモできます。", reqApply: "反映", reqStatus: { open: "未反映", working: "AI が反映中", done: "反映済み" },
    upstreamBusy: "AI が作業中", upstreamErr: "AI でエラー",
    revMake: "逆算する（仕様・実行例・計画）", revNone: "まだ逆算していません。触って動きを確かめてから押すと、実行記録を正解例にした仕様と、作るための計画・プロンプトをセットアップ用のモデルが書きます。", revPlan: "計画", revSpec: "仕様",
    save: "アイデアを保存", srcNote: "アイデアを書き換えたら「最初から動かす」で、LLM がシステムを立ち上げ直します。", briefTitle: "ふるまいのメモ（LLM が書いたもの）", ideaTitle: "アイデア", saved: "保存しました", warnings: "コンパイラからの注意", reads: "読む", writes: "書く", inputs: "入力",
    ms: "ミリ秒", empty: "なし", screenOf: "画面", sec: "秒", noticeLabel: "知らせ", error: "エラー", noLLM: "ローカル LLM に繋がりません" },
  en: { modelsTitle: "Models", modelSetup: "Setup, requests and plans", modelEvents: "Button presses, timers and judging checks", modelSave: "Use these models", modelSaved: "Models changed",
    ahead: "Look ahead", aheadTitle: "The AI plays what can be pressed next in advance, so a press answers at once (uses the AI more)",
    modelNote: "Names: claude-… (Claude Code) / codex:<model> (Codex CLI) / anthropic: · openai: · gemini: · openrouter: · groq: · lmstudio:<model> / anything else is an Ollama model.", modelHere: "Available on this machine", modelSetupLabel: "setup", modelEventsLabel: "events", newProgram: "+ New", newIdeaLabel: "Describe what you want in one line", newIdeaPh: "e.g. a reception desk that notifies the host on their phone", newNote: "The setup model brings the system up and opens it ready to use.", create: "Create", writing: "The AI is writing", readyIn: "Usable {s}s after the idea. Try it.", restored: "Resumed where you left off ({t})", staleServer: "The server is running old code. Stop it in the terminal and start it again.", ideal: "Ideal", existing: "Existing tech", realityTitle: "If built with existing technology", realityNone: "No estimate.", rLatency: "Sound delay", rLeak: "Sound leaking in", rDelay: "Decision delay", rError: "Wrong decisions", rInterval: "Decision interval", rIntent: "Intent", rPart: "What it does", rBuilt: "Built with", built: { code: "ordinary code", model: "needs a model", service: "outside service", not_yet: "not possible yet" },
    lvThinking: "The LLM is deciding…", lvDone: "Decided", lvNoPicture: "No picture yet. Use the camera or try an image.", lvAuto: "Auto", lvUseCamera: "Use camera", lvUseImage: "Try an image", lvLook: "Show and decide", lvCameraHint: "The picture is only given to the LLM to decide.", lvCamera: "Camera",
    lvUseMic: "Use microphone", lvSend: "Decide on this sound", lvMic: "Microphone", lvPlaySounds: "Play test sounds", lvSounds: "Test sounds", lvNoSounds: "No test sounds yet. Run the action that makes them.",
    lvFindOutputs: "Find outputs", lvOutput: "Output", lvNoSink: "This browser cannot choose an output. Set your earphones as the system output.", lvProcOn: "Processing on", lvProcOff: "Processing off (as is)", lvOutputTitle: "Earphones / speakers", lvConnect: "Connect your earphones and choose them as the output.", lvSpeak: "Speak", lvNoDrawing: "No picture yet.",
    newRun: "Restart", runChecks: "Run checks", present: "Present", requestLabel: "What should change", requestPh: "I'd like this to… (e.g. show why it chose the priority)", memo: "Note it", applyNow: "Ask the AI to apply", memoFab: "Note a request", cancel: "Cancel",
    tabState: "State", tabTrace: "Executions", tabCheck: "Checks", tabReq: "Requests", tabRev: "Reverse", tabSrc: "Source",
    compiling: "Preparing", compiled: "Running", compileFail: "Setup failed", stage: { setup: "the LLM is setting the system up" },
    cpu: "CPU running", noState: "Not running yet.", noTraces: "Nothing has run yet. Press a button: the instructions the CPU executed and the state changes appear here.",
    checksNone: "There is no Checks section.", checksRun: "Run checks", checksRunning: "Running checks…", pass: "pass", fail: "fail",
    reqNone: "No requests yet. Note them in presentation mode or in the bar below.", reqApply: "Apply", reqStatus: { open: "open", working: "The AI is applying", done: "applied" },
    upstreamBusy: "The AI is working", upstreamErr: "The AI failed",
    revMake: "Reverse (spec, examples, plan)", revNone: "Not reversed yet. Try the system first; then the setup model writes a spec that uses the recorded executions as golden examples, plus the build plan and prompts.", revPlan: "Plan", revSpec: "Spec",
    save: "Save the idea", srcNote: "After changing the idea, press Restart and the LLM sets the system up again.", briefTitle: "Brief (written by the LLM)", ideaTitle: "Idea", saved: "Saved", warnings: "Compiler notes", reads: "reads", writes: "writes", inputs: "inputs",
    ms: "ms", empty: "none", screenOf: "screen", sec: "s", noticeLabel: "notice", error: "Error", noLLM: "Cannot reach the local LLM" },
};
let lang = (() => { try { return localStorage.getItem("kuron.lang") } catch { return null } })() || (navigator.language || "ja").slice(0, 2);
if (!I18N[lang]) lang = "en";
const T = k => k.split(".").reduce((o, x) => o && o[x], I18N[lang]) ?? k;
const $ = id => document.getElementById(id);
const el = (tag, cls, txt) => { const n = document.createElement(tag); if (cls) n.className = cls; if (txt != null) n.textContent = txt; return n };

let ST = null, sid = null, state = null, traces = [], checks = null, checking = false, tab = "state";
const cur = {}, forms = {}, busy = {}, toastT = {};

function applyI18n() {
  document.documentElement.lang = lang; $("lang").value = lang;
  document.querySelectorAll("[data-i18n]").forEach(n => n.textContent = T(n.dataset.i18n));
  document.querySelectorAll("[data-i18n-ph]").forEach(n => n.placeholder = T(n.dataset.i18nPh));
  document.querySelectorAll("[data-i18n-title]").forEach(n => n.title = T(n.dataset.i18nTitle));
}
$("lang").onchange = e => { lang = e.target.value; try { localStorage.setItem("kuron.lang", lang) } catch { } applyI18n(); renderAll() };

async function api(path, body) {
  const r = await fetch(path, body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (r.status === 404 && !j.error) { banner(T("staleServer")); throw new Error(T("staleServer")) }
  if (!r.ok) throw new Error(j.error || r.status);
  return j;
}

/* ---------- templates and lists ---------- */
const get = (obj, path) => path.split(".").reduce((o, k) => (o == null ? o : o[k]), obj);
function show(v) { if (v == null) return ""; if (typeof v === "boolean") return v ? "✓" : "—"; if (Array.isArray(v)) return v.map(show).join(", "); if (typeof v === "object") return Object.values(v).map(show).join(" / "); return String(v) }
function tpl(text, row) {
  return String(text || "").replace(/\{([^{}]+)\}/g, (_, k) => {
    k = k.trim();
    if (k.startsWith("count:")) {
      const [path, cond] = k.slice(6).split("|"); const v = get(state, path.trim()); if (!Array.isArray(v)) return 0;
      if (!cond) return v.length;
      const [p, val] = cond.split("="); return v.filter(x => x && typeof x === "object" && matches(x[p.trim()], val)).length;
    }
    if (row && typeof row === "object" && get(row, k) !== undefined) return show(get(row, k));
    if (row != null && typeof row !== "object" && (k === "value" || k === "." || k === "item")) return show(row);
    const v = get(state, k); return v === undefined ? "{" + k + "}" : show(v);
  });
}
// Filter values are written by the compiler LLM; booleans as "true"/"false". No word lists here.
const matches = (v, want) => { const s = String(want ?? "").trim(); if (!s) return true; if (typeof v === "boolean") return v === (s.toLowerCase() === "true"); return String(v ?? "") === s };
function listOf(c) {
  const src = state && state[c.source]; if (!Array.isArray(src)) return [];
  let rows = src.map((item, index) => ({ item, index }));
  if (c.whereField) rows = rows.filter(r => r.item && typeof r.item === "object" ? matches(r.item[c.whereField], c.whereValue) : true);
  if (c.sortField) {
    // word values follow the display order the compiler LLM gave (sortValues); numbers and dates compare as they are
    const vals = Array.isArray(c.sortValues) ? c.sortValues.map(String) : [];
    const val = r => r.item && typeof r.item === "object" ? r.item[c.sortField] : r.item;
    if (vals.length) { const pos = v => { const i = vals.indexOf(String(v)); return i < 0 ? vals.length : i }; rows.sort((a, b) => pos(val(a)) - pos(val(b))) }
    else rows.sort((a, b) => { const x = val(a), y = val(b); const n = isFinite(+x) && isFinite(+y) && x !== "" && y !== ""; const d = n ? +x - +y : String(x ?? "").localeCompare(String(y ?? "")); return c.sortDesc ? -d : d });
  }
  return rows;
}
function chart(values) {
  const vs = values.map(Number).filter(Number.isFinite); if (vs.length < 2) return el("small", "", "—");
  const W = 300, H = 90, P = 6, mn = Math.min(...vs), mx = Math.max(...vs), sp = mx - mn || 1;
  const pts = vs.map((v, i) => [P + i * (W - 2 * P) / (vs.length - 1), H - P - (v - mn) / sp * (H - 2 * P)]).map(p => p.map(n => n.toFixed(1)).join(",")).join(" ");
  const box = el("div"); box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="var(--accent)" stroke-width="2.2" vector-effect="non-scaling-stroke"/></svg>`; return box;
}

/* ---------- components ---------- */
const LIVE_KINDS = ["camera", "mic", "sounds", "output", "speak", "drawing"];
function comp(c, ctx) {
  if (c.kind === "page" || c.kind === "stage") return ctx.row ? null : parts[c.kind](c, ctx.screen + ":" + ctx.index, ctx);
  if (LIVE_KINDS.includes(c.kind)) return ctx.row ? null : live.render(c, { ...ctx, tpl: t => tpl(t, null) }, state);
  const row = ctx.row ? ctx.row.item : undefined;
  switch (c.kind) {
    case "heading": return el("h2", "c-heading", tpl(c.text, row));
    case "text": return el("p", "c-text", tpl(c.text, row));
    case "metric": { const d = el("div", "c-metric"); d.append(el("small", "", tpl(c.label, row)), el("strong", "", tpl(c.text || "", row))); return d }
    case "badge": { if (ctx.row && c.whereField && !matches(row && row[c.whereField], c.whereValue)) return null; return el("span", "c-badge", tpl(c.text, row)) }
    case "image": { const d = el("div", "c-image"); d.append(el("span", "", tpl(c.text, row))); return d }
    case "divider": return el("hr", "c-divider");
    case "input": case "select": {
      const f = forms[ctx.screen] ||= {}; const lab = el("label", "c-in"); lab.append(tpl(c.label || c.name, row));
      let i;
      if (c.kind === "select") { i = el("select"); (c.options || []).forEach(o => i.append(new Option(o, o))); if (f[c.name] == null && c.options && c.options[0]) f[c.name] = c.options[0] }
      else if (c.inputType === "longtext") i = el("textarea");
      else { i = el("input"); i.type = c.inputType === "number" ? "number" : c.inputType === "date" ? "date" : "text" }
      i.value = f[c.name] ?? ""; i.dataset.form = ctx.screen; i.dataset.name = c.name;
      i.oninput = i.onchange = () => { f[c.name] = i.value };
      lab.append(i); return lab;
    }
    case "button": {
      const b = el("button", "c-btn", tpl(c.text, row)); b.type = "button"; b.disabled = !!busy[ctx.dev];
      b.onclick = () => press(c, ctx);
      if (c.action && !hasInputs(ctx.screen)) b.dataset.ahead = JSON.stringify({ intent: c.action, screen: ctx.screen, item: rowItem(ctx), inputs: {} });   // what pressing it would send, for looking ahead
      return b;
    }
    case "list": case "table": {
      const rows = listOf(c);
      if (!rows.length) return el("p", "c-empty", tpl(c.empty || "—", null));
      if (c.kind === "table") {
        const w = el("div", "c-table"), t = el("table"), cols = c.columns && c.columns.length ? c.columns : Object.keys(rows[0].item || {});
        const hr = el("tr"); cols.forEach(k => hr.append(el("th", "", k))); t.append(hr);
        rows.forEach(r => { const tr = el("tr"); cols.forEach(k => tr.append(el("td", "", show(r.item && typeof r.item === "object" ? r.item[k] : r.item)))); t.append(tr) });
        w.append(t); return w;
      }
      const ul = el("ul", "c-list");
      rows.forEach(r => {
        const li = el("li");
        // no row parts defined: show the item as it is (every property but its id)
        if (!(c.row || []).length) li.append(el("span", "c-text", r.item && typeof r.item === "object" ? Object.entries(r.item).filter(([k]) => k !== "id").map(([k, v]) => k + ": " + show(v)).join(" · ") : show(r.item)));
        else li.append(...c.row.map(x => comp(x, { ...ctx, row: r, list: c.source })).filter(Boolean));
        ul.append(li);
      });
      return ul;
    }
    case "chart": {
      const d = el("div", "c-chart"); d.append(el("small", "", tpl(c.label || c.source, row)));
      const v = state && state[c.source]; const nums = Array.isArray(v) ? v.map(x => typeof x === "object" && x ? Object.values(x).find(y => typeof y === "number") : x) : [];
      d.append(chart(nums)); return d;
    }
  }
  return null;
}

/* ---------- actions ---------- */
const rowItem = ctx => ctx.row && ctx.row.item && typeof ctx.row.item === "object" ? { collection: ctx.list, ...ctx.row.item } : null;
const hasInputs = screen => { const s = ST && ST.ir && ST.ir.screens.find(x => x.name === screen); return !s || s.view.some(p => p.kind === "input" || p.kind === "select") };
// Looking ahead: tell the server what can be touched right now, so it can play those events before anyone presses.
let aheadTimer = null, aheadInfo = null;
function aheadSoon() {
  clearTimeout(aheadTimer);
  aheadTimer = setTimeout(() => {
    if (!ST || !ST.aheadOn || ST.compiling || Object.keys(busy).length || document.querySelector(".lv-wait")) return;
    const seen = new Set(), candidates = [];
    for (const k of [...[...document.querySelectorAll("#stage [data-ahead]")].map(n => n.getAttribute("data-ahead")), ...parts.candidates()]) if (!seen.has(k)) { seen.add(k); candidates.push(JSON.parse(k)) }
    if (candidates.length) api("/api/ahead", { candidates }).catch(() => { });
  }, 400);
}
function renderAhead() {
  const on = !!(ST && ST.aheadOn), b = $("btnAhead");
  b.textContent = (on ? "◉ " : "○ ") + T("ahead") + (on && aheadInfo && aheadInfo.total ? ` ${aheadInfo.ready}/${aheadInfo.total}` : ""); b.setAttribute("aria-pressed", String(on)); b.title = T("aheadTitle");
}
async function press(c, ctx) {
  if (!c.action) { if (c.goto) go(ctx.dev, c.goto); return }
  const f = forms[ctx.screen] || {};
  const inputs = { ...f };
  const t0 = Date.now(); busy[ctx.dev] = { t0, action: c.action }; renderDevice(ctx.dev);
  const tick = setInterval(() => { const n = document.querySelector(`[data-dev="${CSS.escape(ctx.dev)}"] .cpubusy em`); if (n) n.textContent = ((Date.now() - t0) / 1000).toFixed(1) + T("sec") }, 100);
  try {
    const item = rowItem(ctx);
    const r = await api("/api/event", { intent: c.action, screen: ctx.screen, item, inputs });
    state = r.state;
    for (const k of Object.keys(f)) if (!(document.querySelector(`select[data-name="${CSS.escape(k)}"]`))) f[k] = "";
    if (r.notice) toast(ctx.dev, r.notice);
    if (c.goto) cur[ctx.dev] = c.goto;
  } catch (e) { toast(ctx.dev, T("error") + ": " + e.message) }
  finally { clearInterval(tick); delete busy[ctx.dev]; renderStage(); renderPane() }
}
function go(dev, screen) { cur[dev] = screen; renderDevice(dev) }
function toast(dev, msg) {
  const n = document.querySelector(`[data-dev="${CSS.escape(dev)}"] .toast`); if (!n) return;
  n.textContent = msg; n.hidden = false; clearTimeout(toastT[dev]); toastT[dev] = setTimeout(() => n.hidden = true, 3600);
}

/* ---------- devices ---------- */
function devices() {
  const out = []; if (!ST || !ST.ir) return out;
  for (const s of ST.ir.screens) { const key = s.formLabel || s.form; let d = out.find(x => x.key === key); if (!d) out.push(d = { key, form: s.form, label: s.formLabel, screens: [] }); d.screens.push(s) }
  out.forEach(d => { if (!cur[d.key] || !d.screens.some(s => s.name === cur[d.key])) cur[d.key] = d.screens[0].name });
  return out;
}
function frame(d) {
  const f = d.form, root = el("figure", "devw w-" + f); root.dataset.dev = d.key;
  const dev = el("div", "dev f-" + f), scr = el("div", "scr"), sc = el("div", "sc");
  const navBtns = host => d.screens.length > 1 && d.screens.forEach(s => { const b = el("button", "", s.name); b.type = "button"; b.setAttribute("aria-current", String(s.name === cur[d.key])); b.onclick = () => go(d.key, s.name); host.append(b) });
  if (f === "phone") { const sb = el("div", "sbar"); sb.append(el("span", "", new Date().toTimeString().slice(0, 5)), el("span", "", "●●● 5G")); scr.append(sb, el("div", "abar", cur[d.key])) }
  else if (f === "web" || f === "desktop") { const bar = el("div", "wbar"); bar.append(el("span", "dots"), el("span", "addr", (f === "web" ? "https://" : "") + ST.ir.name + (f === "web" ? "/" + cur[d.key] : ""))); const nav = el("nav", "nav"); navBtns(nav); dev.append(bar, nav) }
  else if (f === "term") { const bar = el("div", "wbar"); bar.append(el("span", "dots"), el("span", "", ST.ir.name + " — " + cur[d.key])); dev.append(bar) }
  else if (f === "iot") { const t = el("div", "iot"); t.append(el("span", "", (d.label || "IoT").toUpperCase()), el("i", "pwr")); dev.append(t) }
  else if (f !== "watch") { const t = el("div", "pbar"); t.append(el("span", "", d.label || ""), el("span", "", cur[d.key])); dev.append(t) }
  scr.append(sc);
  if (f === "phone" && d.screens.length > 1) { const tb = el("nav", "tabbar"); navBtns(tb); scr.append(tb) }
  if (f !== "web" && f !== "desktop" && f !== "phone" && d.screens.length > 1) { const nav = el("nav", "nav"); navBtns(nav); scr.prepend(nav) }
  const t = el("div", "toast"); t.hidden = true; scr.append(t);
  if (busy[d.key]) { const b = el("div", "cpubusy"); b.append(el("i"), el("span", "", T("cpu") + " · " + busy[d.key].action), el("em", "", "")); scr.append(b) }
  dev.append(scr); root.append(dev, el("figcaption", "", (d.label || f) + " · " + cur[d.key]));
  const screen = d.screens.find(s => s.name === cur[d.key]);
  if (screen && state) screen.view.forEach((c, index) => { const n = comp(c, { dev: d.key, screen: screen.name, index }); if (n) sc.append(n) });
  return root;
}
function renderDevice(key) {
  const d = devices().find(x => x.key === key); const old = document.querySelector(`[data-dev="${CSS.escape(key)}"]`);
  if (!d || !old) return renderStage();
  const focus = document.activeElement && document.activeElement.dataset && document.activeElement.dataset.name;
  old.replaceWith(frame(d)); restoreFocus(focus); aheadSoon();
}
function renderStage() {
  const st = $("stage"), focus = document.activeElement && document.activeElement.dataset && document.activeElement.dataset.name;
  st.textContent = "";
  if (!ST || !ST.ir) { st.append(el("p", "note", ST && ST.error ? T("compileFail") + ": " + (ST.error.message || JSON.stringify(ST.error.errors)) : T("compiling") + "…")); return }
  devices().forEach(d => st.append(frame(d))); restoreFocus(focus); aheadSoon();
}
function restoreFocus(name) { if (!name) return; const n = document.querySelector(`[data-name="${CSS.escape(name)}"]`); if (n) { n.focus({ preventScroll: true }); try { n.setSelectionRange(n.value.length, n.value.length) } catch { } } }

/* ---------- side panes ---------- */
const PANES = ["state", "trace", "check", "req", "rev", "src"];
document.querySelectorAll(".tabs button").forEach(b => b.onclick = () => { tab = b.dataset.tab; document.querySelectorAll(".tabs button").forEach(x => x.setAttribute("aria-selected", String(x === b))); PANES.forEach(p => $("pane-" + p).hidden = p !== tab); renderPane() });
function renderPane() {
  const p = $("pane-" + tab); if (!p || PRESENT) return;
  p.textContent = "";
  if (tab === "state") {
    if (!state) { p.append(el("p", "note", T("noState"))); return }
    p.append(el("h3", "", "state · " + (sid || "")), el("pre", "code", JSON.stringify(state, null, 2)));
    if (ST.ir) { p.append(el("h3", "", "schema")); p.append(el("pre", "code", ST.ir.state.fields.map(f => `${f.name}: ${f.type}${f.items ? " {" + f.items.map(i => i.name + ": " + i.type).join(", ") + "}" : ""}`).join("\n"))) }
  }
  if (tab === "trace") {
    if (!traces.length) { p.append(el("p", "note", T("noTraces"))); return }
    [...traces].reverse().forEach(t => {
      const d = el("div", "item"), h = el("div", "h");
      h.append(el("b", t.error ? "ng" : "", (t.action === "__start" ? "on start" : t.action)), el("span", "t", (t.ms ?? "?") + T("ms") + (t.cost != null ? " · $" + t.cost.toFixed(4) : "") + " · " + t.at.slice(11, 19)));
      d.append(h);
      const ol = el("ol", "steps"); (t.steps || []).forEach(s => ol.append(el("li", "", s))); d.append(ol);
      if (t.inputs && Object.keys(t.inputs).length) d.append(el("pre", "code", T("inputs") + " " + JSON.stringify(t.inputs)));
      if (t.target) d.append(el("pre", "code", "target " + t.target.list + "[" + t.target.index + "]"));
      if (t.error) d.append(el("p", "ng", t.error));
      else d.append(el("pre", "code", JSON.stringify(t.patch || t.after, null, 1)));
      if (t.notice) d.append(el("p", "note", T("noticeLabel") + ": " + t.notice));
      p.append(d);
    });
  }
  if (tab === "check") {
    const run = el("button", "b", checking ? T("checksRunning") : T("checksRun")); run.type = "button"; run.disabled = checking || !ST.ir; run.onclick = runChecks; p.append(run);
    if (ST.ir && !ST.ir.checks.length) p.append(el("p", "note", T("checksNone")));
    (checks || []).forEach(c => {
      const d = el("div", "item"), h = el("div", "h"); h.append(el("b", c.ok ? "ok" : "ng", (c.ok ? "✓ " : "✗ ") + c.name)); d.append(h);
      if (c.error) d.append(el("p", "ng", c.error));
      (c.steps || []).forEach(s => d.append(el("div", "t", "▸ " + s.action + " " + JSON.stringify(s.inputs) + " · " + s.ms + T("ms"))));
      (c.expect || []).forEach(e => { const x = el("div"); x.append(el("b", e.pass ? "ok" : "ng", (e.pass ? T("pass") : T("fail")) + " ")); x.append(document.createTextNode(e.text)); d.append(x, el("p", "note", e.reason)) });
      p.append(d);
    });
  }
  if (tab === "req") {
    upstreamLine(p);
    if (!ST.requests.length) p.append(el("p", "note", T("reqNone")));
    [...ST.requests].reverse().forEach(r => {
      const d = el("div", "item"), h = el("div", "h"); h.append(el("b", "", r.text), el("span", "t", T("reqStatus." + r.status))); d.append(h);
      if (r.context) d.append(el("div", "t", JSON.stringify(r.context)));
      if (r.error) d.append(el("p", "ng", r.error));
      if (r.status === "open") { const b = el("button", "b", T("reqApply")); b.type = "button"; b.disabled = ST.upstream.busy; b.onclick = () => api("/api/apply", { id: r.id }).catch(e => alertLine(p, e)); d.append(b) }
      p.append(d);
    });
  }
  if (tab === "rev") {
    upstreamLine(p);
    const b = el("button", "b", T("revMake")); b.type = "button"; b.disabled = ST.upstream.busy || !ST.ir; b.onclick = () => api("/api/reverse", {}).catch(e => alertLine(p, e)); p.append(b);
    api("/api/reverse").then(r => {
      if (!r.plan && !r.spec) { p.append(el("p", "note", T("revNone"))); return }
      p.append(el("p", "t", r.dir));
      if (r.plan) { p.append(el("h3", "", T("revPlan"))); const m = el("div", "md"); m.innerHTML = md(r.plan); p.append(m) }
      if (r.spec) { p.append(el("h3", "", T("revSpec"))); p.append(el("pre", "code", r.spec)) }
    }).catch(() => { });
  }
  if (tab === "src") {
    p.append(el("h3", "", T("briefTitle")), el("pre", "code", ST.brief || "—"));
    p.append(el("h3", "", T("ideaTitle")), el("p", "note", T("srcNote")));
    const ta = el("textarea", "src"); ta.value = ST.text; ta.spellcheck = false; p.append(ta);
    const b = el("button", "b", T("save")); b.type = "button"; b.onclick = () => api("/api/source", { text: ta.value }).then(() => banner(T("saved"))); p.append(b);
  }
}
function upstreamLine(p) {
  const u = ST.upstream || {};
  if (u.busy) { const s = el("p", "note", T("upstreamBusy") + " · " + (u.kind || "") + " · " + Math.round((Date.now() - (u.started || Date.now())) / 1000) + T("sec")); p.append(s) }
  else if (u.error) p.append(el("p", "ng", T("upstreamErr") + ": " + u.error));
}
const alertLine = (p, e) => p.prepend(el("p", "ng", T("error") + ": " + e.message));
function md(src) {
  const esc = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const out = []; let inCode = false, code = [], list = null;
  const inl = s => esc(s).replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
  const endList = () => { if (list) { out.push("</" + list + ">"); list = null } };
  for (const l of src.split("\n")) {
    if (l.startsWith("```")) { if (inCode) { out.push("<pre>" + esc(code.join("\n")) + "</pre>"); code = []; inCode = false } else { endList(); inCode = true } continue }
    if (inCode) { code.push(l); continue }
    let m;
    if ((m = /^(#{1,3})\s+(.*)/.exec(l))) { endList(); out.push(`<h${m[1].length}>${inl(m[2])}</h${m[1].length}>`) }
    else if ((m = /^\s*[-*]\s+(.*)/.exec(l))) { if (list !== "ul") { endList(); out.push("<ul>"); list = "ul" } out.push("<li>" + inl(m[1]) + "</li>") }
    else if ((m = /^\s*\d+[.)]\s+(.*)/.exec(l))) { if (list !== "ol") { endList(); out.push("<ol>"); list = "ol" } out.push("<li>" + inl(m[1]) + "</li>") }
    else if (l.trim()) { endList(); out.push("<p>" + inl(l) + "</p>") }
    else endList();
  }
  endList(); if (inCode) out.push("<pre>" + esc(code.join("\n")) + "</pre>");
  return out.join("");
}

/* ---------- top bar ---------- */
function renderTop() {
  $("sysName").textContent = ST && ST.ir ? ST.ir.name : "—";
  document.title = (ST && ST.ir ? ST.ir.name + " · " : "") + "kuron";
  const cs = $("compileStatus");
  if (ST.compiling) { cs.className = "pill busy"; cs.textContent = T("compiling") + (ST.stage ? " · " + T("stage." + ST.stage) : "") }
  else if (ST.error) { cs.className = "pill ng"; cs.textContent = T("compileFail") }
  else if (ST.ir) { cs.className = "pill ok"; cs.textContent = T("compiled") + (ST.stats ? " · " + (ST.stats.ms / 1000).toFixed(1) + T("sec") + (ST.stats.hits ? " (" + ST.stats.hits + " cached)" : "") : "") }
  $("models").textContent = T("modelSetupLabel") + " " + ST.models.compile + " · " + T("modelEventsLabel") + " " + ST.models.cpu;
  const u = ST.upstream || {};
  if (u.busy && u.kind === "new") { cs.className = "pill busy"; cs.textContent = T("writing") + " · " + Math.round((Date.now() - u.started) / 1000) + T("sec") }
  const sel = $("prog"); sel.textContent = "";
  (ST.programs || []).forEach(p => { const o = new Option(p.title + "  (" + p.file + ")", p.file); o.selected = p.file === ST.program; sel.append(o) });
  if (newStart && !ST.compiling && ST.ir && !u.busy && newFile === ST.program) { banner(T("readyIn").replace("{s}", Math.round((Date.now() - newStart) / 1000))); newStart = null }
}
let newStart = null, newFile = null;
// pages the LLM wrote and stages it declared (ui/parts.js): what they send is an event like any other
const parts = window.KuronParts({ tpl, rows: listOf, getState: () => state, T: k => T(k),
  send: async (key, intent, payload) => {
    try { const r = await api("/api/act", { sid, action: intent, ...payload }); state = r.state; if (r.notice) banner(r.notice); renderStage(); renderPane() }
    catch (e) { banner(T("error") + ": " + e.message) }
  } });
const live = createLive({ api, getSid: () => sid, getState: () => state, T: k => T(k), lang: (ST && ST.ir && ST.ir.lang) || lang,
  onResult: r => { state = r.state; if (r.notice) banner(r.notice); renderStage(); renderPane() }, onError: e => banner(T("error") + ": " + e.message) });
function renderReality() {
  const on = !!(ST && ST.realityOn), R = ST && ST.ir && ST.ir.reality, b = $("btnReality"), p = $("realityPane");
  b.textContent = (on ? "◉ " : "○ ") + T("existing"); b.setAttribute("aria-pressed", String(on)); b.title = T("ideal") + " / " + T("existing");
  live.setReality(on ? R : null);
  p.hidden = !on; p.textContent = ""; if (!on) return;
  p.append(el("b", "", T("realityTitle")));
  if (!R) { p.append(el("p", "note", T("realityNone"))); return }
  p.append(el("p", "", R.summary));
  const ul = el("ul"); (R.items || []).forEach(x => { const li = el("li"); li.append(el("b", "", x.part + ": "), document.createTextNode(x.existing + " → " + x.effect)); ul.append(li) }); p.append(ul);
  if ((R.intents || []).length) {
    const tw = el("div", "c-table"), tb = el("table"), hr = el("tr");
    [T("rIntent"), T("rPart"), T("rBuilt"), T("rError"), T("rDelay")].forEach(h => hr.append(el("th", "", h))); tb.append(hr);
    for (const x of R.intents) x.parts.forEach((q, i) => { const tr = el("tr"); tr.append(el("td", "", i ? "" : x.intent), el("td", "", q.what + " — " + q.detail), el("td", "built-" + q.builtWith, T("built." + q.builtWith)), el("td", "", i ? "" : Math.round(x.errorRate * 100) + "%"), el("td", "", i ? "" : x.delayMs + "ms")); tb.append(tr) });
    tw.append(tb); p.append(tw);
  }
  p.append(el("p", "dim", [T("rLatency") + " " + R.audioLatencyMs + "ms", T("rLeak") + " " + Math.round(R.leak * 100) + "%", T("rDelay") + " " + R.decisionDelayMs + "ms", T("rError") + " " + Math.round(R.errorRate * 100) + "%", T("rInterval") + " " + R.minIntervalSec + T("sec")].join(" · ")));
}
$("btnAhead").onclick = () => api("/api/ahead", { on: !(ST && ST.aheadOn) }).catch(e => banner(e.message));
$("btnReality").onclick = () => api("/api/reality", { on: !(ST && ST.realityOn) }).catch(e => banner(e.message));
function banner(msg) { const b = $("banner"); b.textContent = msg; b.hidden = !msg }
$("prog").onchange = e => api("/api/open", { file: e.target.value }).catch(err => banner(T("error") + ": " + err.message));
$("btnNew").onclick = () => { $("newSheet").hidden = false; $("newIdea").focus() };
$("newCancel").onclick = () => $("newSheet").hidden = true;
/* ---------- model picker: any model, changed while the system runs ---------- */
$("models").onclick = async () => {
  $("modelSheet").hidden = false; $("modelErr").textContent = "";
  $("modelCompile").value = ST.models.compile; $("modelCpu").value = ST.models.cpu;
  const a = (await api("/api/models").catch(() => ({}))).available || {}, names = [];
  if (a.claudeCode) names.push("claude-sonnet-5-5", "claude-haiku-5-5");
  if (a.codex) names.push("codex:");
  (a.ollama || []).forEach(n => names.push(n));
  (a.apis || []).filter(p => p.ready).forEach(p => names.push(p.name + ":"));
  const dl = $("modelNames"); dl.textContent = ""; names.forEach(n => dl.append(new Option(n, n)));
  $("modelHere").textContent = T("modelHere") + ": " + [a.claudeCode && "Claude Code", a.codex && "Codex CLI", (a.ollama || []).length && "Ollama (" + a.ollama.join(", ") + ")", ...(a.apis || []).filter(p => p.ready && p.key).map(p => p.name + " API")].filter(Boolean).join(" · ");
};
$("modelCancel").onclick = () => $("modelSheet").hidden = true;
$("modelForm").onsubmit = async e => {
  e.preventDefault(); $("modelErr").textContent = "";
  try { const r = await api("/api/models", { compile: $("modelCompile").value, cpu: $("modelCpu").value }); ST.models = r.models; renderTop(); $("modelSheet").hidden = true; banner(T("modelSaved")) }
  catch (err) { $("modelErr").textContent = err.message }
};
$("newForm").onsubmit = async e => {
  e.preventDefault(); const idea = $("newIdea").value.trim(); if (!idea) return;
  try { await api("/api/new", { idea }); newStart = Date.now(); newFile = null; $("newSheet").hidden = true; $("newIdea").value = ""; banner(""); ST.upstream = { busy: true, kind: "new", started: newStart }; renderTop() }
  catch (err) { banner(T("error") + ": " + err.message) }
};
async function reloadProgram() {
  ST = await api("/api/status"); sid = ST.sid; checks = ST.checks; state = null; traces = [];
  Object.keys(forms).forEach(k => delete forms[k]); Object.keys(cur).forEach(k => delete cur[k]);
  state = ST.state || null;
  traces = (await api("/api/traces")).traces;
  renderAll();
}
function renderAll() { if (!ST) return; renderTop(); renderStage(); renderPane(); renderReality(); renderAhead() }


async function runChecks() { checking = true; renderPane(); try { checks = (await api("/api/check", {})).checks } catch (e) { checks = [{ name: T("error"), ok: false, error: e.message }] } checking = false; renderPane() }
$("btnCheck").onclick = () => { document.querySelector('.tabs [data-tab="check"]').click(); runChecks() };
$("btnSession").onclick = async () => { const r = await api("/api/session", {}); sid = r.id; state = r.state; Object.keys(forms).forEach(k => delete forms[k]); renderStage(); renderPane() };
function context() { return Object.fromEntries(devices().map(d => [d.label || d.form, cur[d.key]])) }
$("reqForm").onsubmit = async e => { e.preventDefault(); const t = $("reqText").value.trim(); if (!t) return; await api("/api/requests", { text: t, context: context() }); $("reqText").value = "" };
$("reqApply").onclick = async () => { const t = $("reqText").value.trim(); if (!t) return; await api("/api/apply", { text: t, context: context() }); $("reqText").value = ""; document.querySelector('.tabs [data-tab="req"]').click() };
if (PRESENT) {
  document.body.classList.add("present"); $("fab").hidden = false;
  $("fab").onclick = () => { $("sheet").hidden = false; $("sheetText").focus() };
  $("sheetCancel").onclick = () => $("sheet").hidden = true;
  $("sheetForm").onsubmit = async e => { e.preventDefault(); const t = $("sheetText").value.trim(); if (!t) return; await api("/api/requests", { text: t, context: context() }); $("sheetText").value = ""; $("sheet").hidden = true };
}

/* ---------- live updates ---------- */
async function boot() {
  applyI18n();
  ST = await api("/api/status"); sid = ST.sid; checks = ST.checks;
  if (sid) state = (await api("/api/state?sid=" + sid).catch(() => ({ state: null }))).state;
  traces = (await api("/api/traces")).traces;
  renderAll();
  const es = new EventSource("/api/events");
  es.onmessage = async m => {
    const ev = JSON.parse(m.data);
    if (ev.type === "compile") { if (ev.status) { ST = ev.status; if (ST.sid && ST.sid !== sid) sid = ST.sid; if (sid) state = (await api("/api/state?sid=" + sid).catch(() => ({ state }))).state; renderAll() } else { ST.compiling = true; ST.stage = ev.stage; renderTop() } }
    if (ev.type === "trace") { traces.push(ev.trace); if (traces.length > 100) traces.shift(); if (tab === "trace") renderPane() }
    if (ev.type === "world" && ev.status) { const keep = ST.upstream; ST = ev.status; ST.upstream = keep; state = ST.state; if (!Object.keys(busy).length) renderStage(); renderTop(); if (tab === "state" || tab === "src") renderPane(); return }
    if (ev.type === "notice") { banner(ev.text); return }
    if (ev.type === "speak") { live.say(ev.text); return }
    if (ev.type === "state" && ev.sid === sid) { state = ev.state; if (!Object.keys(busy).length) renderStage(); if (tab === "state") renderPane() }
    if (ev.type === "session") { sid = ev.sid; state = ev.state; renderStage(); renderPane() }
    if (ev.type === "requests") { ST.requests = ev.requests; if (tab === "req") renderPane() }
    if (ev.type === "models" && ev.status) { ST.models = ev.status.models; renderTop(); return }
    if (ev.type === "reality") { ST.realityOn = ev.on; renderReality(); return }
    if (ev.type === "ahead") { const was = ST.aheadOn; ST.aheadOn = ev.on; aheadInfo = ev; renderAhead(); if (ev.on && !was) aheadSoon(); return }
    if (ev.type === "program") { live.reset(); parts.reset(); if (newStart) newFile = ev.program; else banner(""); await reloadProgram(); return }
    if (ev.type === "upstream") { ST.upstream = ev.upstream; if (ev.upstream.kind === "new" && !ev.upstream.busy && ev.upstream.error) { banner(T("upstreamErr") + ": " + ev.upstream.error); newStart = null } renderTop(); if (ev.status) ST = ev.status; if (tab === "req" || tab === "rev") renderPane() }
    if (ev.type === "source") { ST.text = ev.text; if (tab === "src") renderPane() }
    if (ev.type === "check" && ev.phase === "done") { checks = ev.checks; checking = false; if (tab === "check") renderPane() }
  };
  setInterval(() => { if (ST && ST.upstream && ST.upstream.busy) { renderTop(); if (tab === "req" || tab === "rev") renderPane() } }, 1000);
}
boot().catch(e => { $("stage").textContent = T("error") + ": " + e.message });
