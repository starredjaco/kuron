// The kuron artifact: pick or write an idea, let Claude set it up, use it by hand, ask for changes,
// flip to "existing tech", run checks and reverse it into a plan. Claude runs on the viewer's account.
(function () {
  const { World, setup, runTurn, eventMessage, runChecks, specMd, writePlan, sampler } = window.Kuron;
  const { createFace, faceIR } = window.KuronFace;
  const I18N = {
    en: { thinking: "Claude is acting", decided: "Done", error: "Error", newIdea: "New idea", ideaLabel: "Describe the system in a line or a page", ideaPh: "e.g. A bakery that takes pre-orders on a phone, plans tomorrow's baking from them and texts customers when their bread is ready.", create: "Set it up", cancel: "Cancel",
      ideal: "Ideal", existing: "Existing tech", restart: "Start over", stop: "Stop", reqPh: "This should… (e.g. show why each patient got their urgency)", reqApply: "Ask Claude to change it",
      tabRuns: "Runs", tabWorld: "World", tabChecks: "Checks", tabReverse: "Reverse", tabIdea: "Idea",
      settingUp: "Claude is setting the system up", pass: "pass", hands: "tools used", readyIn: "Usable {s} s after the idea. Try it by hand.",
      noRuns: "Nothing has run yet. Press a button on any screen: each action, the tools Claude used and its reply appear here.",
      runChecks: "Run checks", checking: "Running checks…", pass_: "pass", fail_: "fail", noChecks: "This system has no checks yet.",
      revMake: "Write the spec and the plan", revNote: "Try the system first. The spec uses what it actually did as golden examples; Claude then writes a build plan with prompts for a coding agent.", copy: "Copy", copied: "Copied", spec: "Spec", plan: "Plan",
      briefTitle: "Brief (written by Claude for itself)", ideaTitle: "Idea", timers: "Timers", runNow: "Run now", every: "every {n} s in the desktop version",
      realityTitle: "If built with today's technology", realityNone: "No estimate yet.", rIntent: "Action", rPart: "What it does", rBuilt: "Built with", rError: "Wrong", rDelay: "Delay", built: { code: "ordinary code", model: "needs a model", service: "outside service", not_yet: "not possible yet" },
      notInClaude: "Running it needs Claude. Open this page on claude.ai (signed in): every action then runs on your own Claude account. Until then you can look around the clinic as it was set up.",
      noTools: "This Claude app cannot run page tools yet, so the system cannot act here. Try claude.ai in a desktop browser.", declined: "Claude was not allowed for this page. Reload the page to be asked again.",
      limited: "Claude is busy or your usage limit was reached. Wait a moment and try again.", example: "example", yours: "yours", reviewer: "Every action runs on your own Claude account: about 5–60 seconds each.",
      lvUseImage: "Choose a picture", lvLook: "Show and decide", lvNoPicture: "Choose a picture first.", lvCameraHint: "The picture is sent to Claude only to decide.", lvCamera: "Camera", lvNoMic: "The microphone is not available in this page.", lvMic: "Microphone", lvSend: "Decide on this sound",
      lvPlaySounds: "Play test sounds", lvSounds: "Test sounds", lvNoSounds: "No test sounds yet.", lvProcOn: "Processing on", lvProcOff: "Processing off", lvOutputTitle: "Earphones / speakers", lvConnect: "Plays through this device's audio output.", lvSpeak: "Speak", lvNoDrawing: "No picture yet.",
      started: "Started over.", delete: "Remove", confirmDelete: "Remove this system from this browser?", yes: "Remove", no: "Keep" },
    ja: { thinking: "Claude が動いています", decided: "完了", error: "エラー", newIdea: "新しいアイデア", ideaLabel: "作りたいシステムを一言（長くても可）で", ideaPh: "例: パン屋の予約をスマホで受け、明日の仕込みを決めて、焼き上がったらお客に知らせる", create: "立ち上げる", cancel: "やめる",
      ideal: "空論", existing: "既存技術", restart: "最初から", stop: "止める", reqPh: "ここをこうしたい…（例: 緊急度の理由も出して）", reqApply: "Claude に直させる",
      tabRuns: "実行記録", tabWorld: "状態", tabChecks: "検証", tabReverse: "逆算", tabIdea: "アイデア",
      settingUp: "Claude がシステムを立ち上げています", pass: "回目", hands: "使った手足", readyIn: "アイデアから {s} 秒で使えるようになりました。触って確かめてください。",
      noRuns: "まだ何も動いていません。どれかの画面のボタンを押すと、操作・Claude が使った手足・返事がここに出ます。",
      runChecks: "検証する", checking: "検証中…", pass_: "合格", fail_: "不合格", noChecks: "検証がまだありません。",
      revMake: "仕様と計画を書く", revNote: "先に触ってください。実際の動きを正解例にした仕様を作り、Claude がコーディングエージェント向けのプロンプトつき計画を書きます。", copy: "コピー", copied: "コピーしました", spec: "仕様", plan: "計画",
      briefTitle: "ふるまいのメモ（Claude が自分用に書いたもの）", ideaTitle: "アイデア", timers: "タイマー", runNow: "いま動かす", every: "デスクトップ版では {n} 秒ごと",
      realityTitle: "いまの技術で作った場合", realityNone: "見積もりがありません。", rIntent: "操作", rPart: "中でやること", rBuilt: "作り方", rError: "誤り", rDelay: "遅れ", built: { code: "普通のコード", model: "モデルが必要", service: "外部サービス", not_yet: "今は無理" },
      notInClaude: "動かすには Claude が必要です。claude.ai でこのページを開くと（ログイン済み）、操作はあなたの Claude で動きます。それまでは立ち上げ済みの診療所を見て回れます。",
      noTools: "この Claude アプリはまだページの手足を動かせません。デスクトップのブラウザで claude.ai を開いてください。", declined: "このページでの Claude の利用が許可されませんでした。再読み込みすると、もう一度聞かれます。",
      limited: "Claude が混んでいるか、利用上限に達しました。少し待ってからもう一度どうぞ。", example: "例", yours: "自作", reviewer: "操作はあなたの Claude で動きます。1回あたり約5〜60秒です。",
      lvUseImage: "画像を選ぶ", lvLook: "見せて判断", lvNoPicture: "先に画像を選んでください。", lvCameraHint: "画像は判断のためだけに Claude に渡します。", lvCamera: "カメラ", lvNoMic: "このページではマイクは使えません。", lvMic: "マイク", lvSend: "いまの音で判断",
      lvPlaySounds: "試す音を流す", lvSounds: "試す音", lvNoSounds: "試す音はまだありません。", lvProcOn: "処理あり", lvProcOff: "処理なし", lvOutputTitle: "イヤホン・スピーカー", lvConnect: "この端末の音声出力から流れます。", lvSpeak: "読み上げ", lvNoDrawing: "図はまだありません。",
      started: "最初からにしました。", delete: "削除", confirmDelete: "このシステムをこのブラウザから消しますか？", yes: "消す", no: "残す" },
  };
  let lang = (() => { try { return localStorage.getItem("kuron.lang") } catch { return null } })() || ((navigator.language || "en").startsWith("ja") ? "ja" : "en");
  const T = k => k.split(".").reduce((o, x) => o && o[x], I18N[lang]) ?? k;
  const $ = id => document.getElementById(id);
  const el = (tag, cls, txt) => { const n = document.createElement(tag); if (cls) n.className = cls; if (txt != null) n.textContent = txt; return n };

  /* ---------- systems kept in this browser ---------- */
  const PRELOAD = JSON.parse($("preload").textContent);
  const KEY = "kuron.systems.v1";
  let systems = [], current = null, world = null, reality = false, queue = Promise.resolve(), tab = "runs", checks = null, checking = false, ctl = null, settingUp = null, rev = { spec: null, plan: null, busy: false };
  const store = { load() { try { return JSON.parse(localStorage.getItem(KEY) || "null") } catch { return null } }, save() { try { localStorage.setItem(KEY, JSON.stringify({ systems, current: current && current.id })) } catch { } } };
  function boot() {
    const saved = store.load();
    systems = saved && Array.isArray(saved.systems) && saved.systems.length ? saved.systems : [];
    for (const ex of PRELOAD.systems) if (!systems.some(s => s.id === ex.id)) systems.push({ id: ex.id, example: true, idea: ex.idea, data: ex.data, traces: [], requests: [] });
    open((saved && systems.find(s => s.id === saved.current)) || systems.find(s => s.id === PRELOAD.systems[0].id) || systems[0]);
  }
  function open(sys) {
    current = sys; world = new World(sys.data); world.on(() => { sys.data = world.data; renderStage() });
    checks = null; rev = { spec: null, plan: null, busy: false }; face.reset(); renderAll(); store.save();
  }
  const save = () => { if (current) { current.data = world.data; store.save() } };

  /* ---------- face ---------- */
  const face = createFace({ root: $("stage"), T, onPress: ev => event(ev), onLive: ev => event(ev), onError: e => banner(T("error") + ": " + e.message) });
  function renderStage() {
    face.setReality(reality ? world.data.reality : null);
    face.set({ ir: world.data.screens.length ? faceIR(world.data) : null, state: world.view() });
    renderTimers();
  }

  /* ---------- turns ---------- */
  function explain(e) {
    const c = e && (e.code || e.message);
    if (c === "not_in_claude") return T("notInClaude"); if (c === "tools_unavailable") return T("noTools");
    if (c === "not_granted" || c === "sampling_disabled") return T("declined"); if (c === "rate_limited" || c === "upstream_error") return T("limited");
    return T("error") + ": " + (e && (e.message || e.code) || e);
  }
  function emit(ev) { if (ev.type === "notice") banner(ev.text); if (ev.type === "speak") face.say(ev.text) }
  // An event: a button, a picture, a sound, a timer. Events run one at a time.
  function event(ev) {
    const run = queue.then(async () => {
      const t0 = Date.now();
      const r = await runTurn({ role: "event", world, message: eventMessage(ev), reality: reality ? world.data.reality : null, images: ev.images || [], sound: ev.inputs && ev.inputs.sound || null, emit,
        onHand: name => face.label(name + "…") });
      // existing-technology mode: answer as late as the estimate for this intent says (the general figure if none is given for it)
      const R = reality && world.data.reality, own = R && (R.intents || []).find(x => x.intent === ev.intent), delay = own ? own.delayMs : R ? R.decisionDelayMs : 0;
      if (delay > 0) await new Promise(x => setTimeout(x, Math.min(8000, delay)));
      const trace = { at: new Date().toISOString(), action: ev.intent, inputs: ev.inputs || {}, target: ev.item || null, calls: r.calls, notice: r.text, ms: Date.now() - t0, reality: reality || undefined, tier: r.tier };
      current.traces = [...(current.traces || []), trace].slice(-60); save(); if (tab === "runs") renderPane();
      return { notice: r.text, ms: trace.ms };
    });
    queue = run.catch(() => { });
    return run.catch(e => { banner(explain(e)); throw e });
  }

  async function newSystem(idea) {
    const sys = { id: "s" + Date.now().toString(36), idea, data: null, traces: [], requests: [] };
    systems.unshift(sys); open(sys);
    const t0 = Date.now(), calls = [];
    ctl = new AbortController(); settingUp = { t0, pass: 1, calls };
    renderSetup();
    const tick = setInterval(renderSetup, 500);
    try {
      await setup({ world, idea, emit, signal: ctl.signal, onHand: n => { calls.push(n); renderSetup() }, onPass: p => { settingUp.pass = p; renderSetup() } });
      banner(T("readyIn").replace("{s}", Math.round((Date.now() - t0) / 1000)));
    } catch (e) { if (e.code !== "cancelled") banner(explain(e)) }
    finally { clearInterval(tick); settingUp = null; ctl = null; save(); renderAll() }
  }
  function renderSetup() {
    const o = $("setupOverlay"); o.hidden = !settingUp; if (!settingUp) return;
    o.textContent = "";
    const counts = {}; settingUp.calls.forEach(n => counts[n] = (counts[n] || 0) + 1);
    o.append(el("i", "spin"), el("b", "", T("settingUp")), el("span", "mono", `${Math.round((Date.now() - settingUp.t0) / 1000)} s · ${settingUp.pass} ${T("pass")}`),
      el("span", "dim", T("hands") + ": " + (Object.entries(counts).map(([k, v]) => v > 1 ? `${k} ×${v}` : k).join(", ") || "…")));
    const stop = el("button", "btn", T("stop")); stop.type = "button"; stop.onclick = () => ctl && ctl.abort(); o.append(stop);
  }

  async function request(text) {
    const btn = $("reqApply"); btn.disabled = true; const t0 = Date.now(), r = { at: new Date().toISOString(), text, status: "working" };
    current.requests = [...(current.requests || []), r]; banner(T("thinking") + "…");
    try { await queue; const out = await runTurn({ role: "request", world, message: `REQUEST: ${text}\nWHERE: ${JSON.stringify(face.devices().map(d => d.label + " · " + d.screen))}`, emit }); r.status = "done"; r.reply = out.text; r.ms = Date.now() - t0; banner(out.text) }
    catch (e) { r.status = "failed"; banner(explain(e)) }
    finally { btn.disabled = false; save(); renderAll() }
  }

  /* ---------- side panes ---------- */
  function renderPane() {
    const p = $("pane"); p.textContent = "";
    document.querySelectorAll(".tabs button").forEach(b => b.setAttribute("aria-selected", String(b.dataset.tab === tab)));
    if (tab === "runs") {
      const list = [...(current.traces || [])].reverse();
      (current.requests || []).slice().reverse().forEach(r => { const d = el("div", "item"); d.append(el("b", "", "↻ " + r.text), el("p", "note", (r.reply || r.status) + (r.ms ? ` · ${(r.ms / 1000).toFixed(1)} s` : ""))); p.append(d) });
      if (!list.length) p.append(el("p", "note", T("noRuns")));
      list.forEach(t => {
        const d = el("div", "item"), h = el("div", "h");
        h.append(el("b", "", t.action), el("span", "t", `${(t.ms / 1000).toFixed(1)} s${t.reality ? " · " + T("existing") : ""} · ${t.at.slice(11, 19)}`));
        d.append(h);
        if (t.inputs && Object.keys(t.inputs).length) d.append(el("div", "t", JSON.stringify(t.inputs)));
        const ol = el("ol", "steps"); (t.calls || []).forEach(c => ol.append(el("li", "", c.name + " " + JSON.stringify(c.args).slice(0, 180)))); d.append(ol);
        if (t.notice) d.append(el("p", "reply", t.notice));
        p.append(d);
      });
    }
    if (tab === "world") p.append(el("pre", "code", JSON.stringify(world.view(), (k, v) => k.startsWith("__") && Array.isArray(v) && !v.length ? undefined : v, 1)));
    if (tab === "checks") {
      const b = el("button", "btn", checking ? T("checking") : T("runChecks")); b.type = "button"; b.disabled = checking || !world.data.checks.length;
      b.onclick = async () => { checking = true; renderPane(); try { checks = await runChecks({ world }) } catch (e) { banner(explain(e)) } checking = false; renderPane() };
      p.append(b);
      if (!world.data.checks.length) p.append(el("p", "note", T("noChecks")));
      (checks || world.data.checks.map(c => ({ name: c.name, expect: c.expect.map(text => ({ text })) }))).forEach(c => {
        const d = el("div", "item"); d.append(el("b", c.ok == null ? "" : c.ok ? "ok" : "ng", (c.ok == null ? "" : c.ok ? "✓ " : "✗ ") + c.name));
        if (c.error) d.append(el("p", "ng", explain({ code: c.error })));
        (c.steps || []).forEach(s => d.append(el("div", "t", "▸ " + s.action + " · " + (s.ms / 1000).toFixed(1) + " s")));
        (c.expect || []).forEach(e => { const x = el("div"); if (e.pass != null) x.append(el("b", e.pass ? "ok" : "ng", (e.pass ? T("pass_") : T("fail_")) + " ")); x.append(document.createTextNode(e.text)); d.append(x); if (e.reason) d.append(el("p", "note", e.reason)) });
        p.append(d);
      });
    }
    if (tab === "reverse") {
      p.append(el("p", "note", T("revNote")));
      const b = el("button", "btn", T("revMake")); b.type = "button"; b.disabled = rev.busy || !world.data.screens.length;
      b.onclick = async () => {
        rev = { spec: specMd(world, current.traces || []), plan: "", busy: true }; renderPane();
        try { rev.plan = await writePlan(rev.spec, { lang: world.data.lang, onText: ({ text }) => { rev.plan = text; const n = $("planOut"); if (n) n.textContent = text } }) } catch (e) { banner(explain(e)) }
        rev.busy = false; renderPane();
      };
      p.append(b);
      for (const [k, v] of [["plan", rev.plan], ["spec", rev.spec]]) if (v != null) {
        const h = el("div", "h"); h.append(el("h3", "", T(k)));
        const c = el("button", "btn small", T("copy")); c.type = "button"; c.onclick = async () => { try { await navigator.clipboard.writeText(v); c.textContent = T("copied") } catch { const r = document.createRange(); r.selectNodeContents(pre); getSelection().removeAllRanges(); getSelection().addRange(r) } };
        h.append(c); const pre = el("pre", "code", v); if (k === "plan") pre.id = "planOut"; p.append(h, pre);
      }
    }
    if (tab === "idea") {
      p.append(el("h3", "", T("ideaTitle")), el("pre", "code", current.idea || world.data.idea || ""), el("h3", "", T("briefTitle")), el("pre", "code", world.data.brief || "—"));
      if (!current.example) { const del = el("button", "btn", T("delete")); del.type = "button"; del.onclick = () => confirmRemove(del); p.append(del) }
    }
  }
  function confirmRemove(btn) {
    const box = el("div", "row"); box.append(el("span", "", T("confirmDelete")));
    const y = el("button", "btn danger", T("yes")), n = el("button", "btn", T("no")); y.type = n.type = "button";
    y.onclick = () => { systems = systems.filter(s => s !== current); open(systems[0]) }; n.onclick = () => box.replaceWith(btn);
    box.append(y, n); btn.replaceWith(box);
  }
  function renderTimers() {
    const t = $("timers"); t.textContent = ""; const list = world.data.timers || []; t.hidden = !list.length; if (!list.length) return;
    t.append(el("b", "", T("timers")));
    list.forEach(x => { const b = el("button", "btn small", "⏱ " + x.name + " · " + T("runNow")); b.type = "button"; b.title = T("every").replace("{n}", x.every); b.onclick = () => event({ intent: x.intent, source: "timer " + x.name }).then(r => r.notice && banner(r.notice)).catch(() => { }); t.append(b) });
  }
  function renderReality() {
    const b = $("btnReality"), p = $("reality"), R = world.data.reality;
    b.textContent = (reality ? "◉ " : "○ ") + T("existing"); b.setAttribute("aria-pressed", String(reality));
    p.hidden = !reality; p.textContent = ""; face.setReality(reality ? R : null); if (!reality) return;
    p.append(el("b", "", T("realityTitle")));
    if (!R) { p.append(el("p", "note", T("realityNone"))); return }
    p.append(el("p", "", R.summary));
    if ((R.intents || []).length) {
      const w = el("div", "tablewrap"), tb = el("table"), hr = el("tr"); [T("rIntent"), T("rPart"), T("rBuilt"), T("rError"), T("rDelay")].forEach(h => hr.append(el("th", "", h))); tb.append(hr);
      for (const x of R.intents) x.parts.forEach((q, i) => { const tr = el("tr"); tr.append(el("td", "", i ? "" : x.intent), el("td", "", q.what), el("td", "built built-" + q.builtWith, T("built." + q.builtWith)), el("td", "num", i ? "" : Math.round(x.errorRate * 100) + "%"), el("td", "num", i ? "" : (x.delayMs / 1000).toFixed(1) + " s")); tb.append(tr) });
      w.append(tb); p.append(w);
    }
  }
  function renderTop() {
    $("sysName").textContent = world.data.name || "…";
    const sel = $("systems"); sel.textContent = "";
    systems.forEach(s => { const o = new Option((s.data && s.data.name || (s.idea || "").slice(0, 40)) + " · " + (s.example ? T("example") : T("yours")), s.id); o.selected = s === current; sel.append(o) });
    document.querySelectorAll("[data-t]").forEach(n => n.textContent = T(n.dataset.t));
    document.querySelectorAll("[data-tph]").forEach(n => n.placeholder = T(n.dataset.tph));
    $("lang").value = lang; document.documentElement.lang = lang;
  }
  function renderAll() { renderTop(); renderReality(); renderStage(); renderPane(); renderSetup() }
  function banner(msg) { const b = $("banner"); b.textContent = msg || ""; b.hidden = !msg }

  /* ---------- controls ---------- */
  $("systems").onchange = e => open(systems.find(s => s.id === e.target.value));
  $("lang").onchange = e => { lang = e.target.value; try { localStorage.setItem("kuron.lang", lang) } catch { } renderAll() };
  $("btnReality").onclick = () => { reality = !reality; renderReality() };
  $("btnRestart").onclick = () => {
    if (current.example) { const ex = PRELOAD.systems.find(x => x.id === current.id); current.data = JSON.parse(JSON.stringify(ex.data)); current.traces = []; current.requests = []; open(current); banner(T("started")) }
    else { const idea = current.idea; systems = systems.filter(s => s !== current); newSystem(idea) }
  };
  $("btnNew").onclick = () => { $("newSheet").hidden = false; $("newIdea").focus() };
  $("newCancel").onclick = () => $("newSheet").hidden = true;
  $("newForm").onsubmit = e => { e.preventDefault(); const idea = $("newIdea").value.trim(); if (!idea) return; $("newSheet").hidden = true; $("newIdea").value = ""; newSystem(idea) };
  document.querySelectorAll("#ideas button").forEach(b => b.onclick = () => { $("newIdea").value = b.dataset.idea; $("newIdea").focus() });
  $("reqForm").onsubmit = e => { e.preventDefault(); const t = $("reqText").value.trim(); if (!t) return; $("reqText").value = ""; request(t) };
  document.querySelectorAll(".tabs button").forEach(b => b.onclick = () => { tab = b.dataset.tab; renderPane() });

  boot();
  // Claude availability: the page renders without it and lights up when the viewer can run it.
  sampler().then(async s => {
    if (!s) { banner(T("notInClaude")); return }
    const lim = await s.limits().catch(() => null);
    if (lim && !lim.tools) banner(T("noTools")); else $("hint").textContent = T("reviewer");
  });
})();
