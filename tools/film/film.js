// Plays a recorded kuron run (film.json) as a timed film for screen recording. Every state, reply and tool
// call comes from the recording; only the waiting is sped up, and the film says so on screen.
(function () {
  const { createFace, faceIR } = window.KuronFace;
  const $ = id => document.getElementById(id);
  const el = (tag, cls, txt) => { const n = document.createElement(tag); if (cls) n.className = cls; if (txt != null) n.textContent = txt; return n };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const T = k => ({ thinking: "Claude is acting" })[k] || k;
  const face = createFace({ root: $("stage"), T });
  const view = d => ({ ...d.values, ...d.collections, __sounds: d.output.sounds, __bands: d.output.bands });
  const secs = ms => (ms / 1000).toFixed(1) + " s";
  const usd = c => c != null ? " · $" + c.toFixed(2) : "";
  const Q = new URLSearchParams(location.search), tight = Q.has("tight");
  const PACE = tight ? { pre: 1800, ff: 1500, ready: 3000, estimate: 6500, base: 2200, perChar: 22, max: 6000, end: 4500 }
    : { pre: 2600, ff: 2200, ready: 4500, estimate: 8000, base: 2600, perChar: 28, max: 7000, end: 5000 };
  const readMs = t => Math.min(PACE.max, PACE.base + String(t || "").length * PACE.perChar);

  // Which devices show what changed: a device changes when a collection or value its screens refer to changed.
  function refs(view, out = new Set()) {
    for (const p of view || []) {
      for (const k of ["source", "field", "gains"]) if (p[k]) out.add(p[k]);
      for (const t of [p.text, p.label]) for (const m of String(t || "").matchAll(/\{(?:count:)?([^{}|]+)/g)) out.add(m[1].trim().split(".")[0]);
      if (p.row) refs(p.row, out);
    }
    return out;
  }
  function changed(ir, before, after) {
    const keys = new Set(Object.keys({ ...before, ...after }).filter(k => JSON.stringify(before[k]) !== JSON.stringify(after[k])));
    const devs = [];
    for (const s of ir.screens) if ([...refs(s.view)].some(k => keys.has(k)) && !devs.includes(s.formLabel)) devs.push(s.formLabel);
    return devs;
  }
  // Fit the shown devices into the 1840-pixel stage.
  function fit(n) {
    const scale = n <= 1 ? 1.25 : n <= 3 ? 1 : 0.8, st = $("stage");
    st.style.width = Math.round(1840 / scale) + "px"; st.style.transform = `scale(${scale})`;
  }
  function cap(k, say, sub = "") { $("k").textContent = k; $("say").textContent = say; $("sub").textContent = sub; }
  function reply(label, text) { const r = $("reply"); r.hidden = !text; r.textContent = ""; if (text) r.append(el("b", "", label), document.createTextNode(text)) }
  function over(node) { const o = $("over"); o.textContent = ""; o.hidden = !node; if (node) o.append(node) }
  // Fast-forward: a counter runs to the real duration in `ms` of film time.
  async function fastForward(realMs, filmMs, onTick = () => { }) {
    const ff = $("ff"), speed = Math.max(2, Math.round(realMs / filmMs));
    ff.hidden = false; const t0 = performance.now();
    while (true) {
      const p = Math.min(1, (performance.now() - t0) / filmMs), now = realMs * p;
      ff.textContent = `⏩ ${speed}× · ${secs(now)}`; onTick(now, p);
      if (p >= 1) break; await sleep(50);
    }
    await sleep(250); ff.hidden = true;
  }

  // A real screen recording (already cut and sped up), with captions per part and the idea shown while it is pasted.
  async function realScene(Rl, idea) {
    const box = el("div", "realbox"), v = el("video"); v.src = Rl.src; v.muted = true; v.playsInline = true; box.append(v);
    over(null); document.body.append(box);
    await new Promise(r => v.readyState >= 2 ? r() : v.addEventListener("loadeddata", r, { once: true }));
    const ff = $("ff"); let part = -1, pasted = null;
    const playing = new Promise(r => v.addEventListener("ended", r, { once: true }));
    v.play();
    const tick = () => {
      const t = v.currentTime, i = Rl.parts.findIndex(p => t >= p.from && t < p.to);
      if (i !== part && i >= 0) {
        part = i; const p = Rl.parts[i];
        cap("Real screen recording · the browser version on claude.ai", p.say, p.sub || "");
        ff.hidden = false; reply(null, "");
        if (p.idea && !pasted) { pasted = el("div", "pastebox"); pasted.append(el("div", "k", "The idea being pasted (full text)"), el("pre", "", idea.trim())); document.body.append(pasted) }
        if (!p.idea && pasted) { pasted.remove(); pasted = null }
      }
      const p = Rl.parts[part];
      if (p) {
        ff.textContent = `⏩ ${p.speed}× · ${secs(Math.max(0, (t - p.from) * p.speed * 1000))}`;
        $("real").textContent = p.real || "";
        if (p.reply && t >= p.reply.at && $("reply").hidden) reply(p.reply.label, p.reply.text);
      }
    };
    const iv = setInterval(tick, 50);
    await playing; clearInterval(iv); ff.hidden = true; if (pasted) pasted.remove(); reply(null, ""); box.remove();
    const b = el("div", "card"); b.append(el("h1", "", "Same idea, recorded step by step"), el("p", "", "Next: the same airline idea run through Claude Code, with every button press, tool call and reply recorded."));
    over(b); cap("", ""); $("real").textContent = ""; await sleep(3200); over(null);
  }

  async function run() {
    const F = await (await fetch("film.json")).json(), R = F.replay;
    const start = R.start;
    let ir = faceIR(start), state = view(start), real = false, n = 0;

    // title
    const t = el("div", "card"); t.append(el("h1", "", "Instead of writing the app,\nClaude is the app."), el("p", "", "A real run of kuron: " + F.title + ", from one idea. Waiting time is sped up; every reply is what Claude actually did."));
    t.querySelector("h1").style.whiteSpace = "pre-line"; over(t); cap("kuron", ""); await sleep(4200);

    if (F.real) await realScene(F.real, R.idea);
    else {
      // the idea, shown in full while it is pasted
      const p = el("div", "paste"); p.append(el("div", "k", "The idea, pasted as is (full text)"), el("pre", "", R.idea.trim()));
      over(p); cap("Step 0 · the idea", "One idea in plain words. No grammar, no code."); await sleep(7500);
      // setup, fast-forwarded
      const s = el("div", "setup"), clock = el("div", "clock", "0.0 s"), calls = el("div", "calls");
      s.append(el("div", "k", "Claude sets the whole system up through its tools"), clock, calls); over(s);
      cap("Setup", "Claude writes its brief, creates test data, defines a screen per device, adds checks and an estimate.", "");
      let shown = 0;
      await fastForward(R.setup.ms, 6500, (now, q) => {
        clock.textContent = secs(now);
        const want = Math.floor(q * R.setup.calls.length);
        while (shown < want) { calls.querySelectorAll(".new").forEach(x => x.classList.remove("new")); calls.append(el("span", "new", R.setup.calls[shown].name)); shown++ }
      });
      await sleep(900); over(null);
    }
    $("real").textContent = `setup ${secs(R.setup.ms)} · ${R.setup.calls.length} tool calls${usd(R.setup.cost)}`;
    $("stage").classList.remove("focus"); fit(9);
    face.set({ ir, state, highlight: null, busy: {}, only: null });
    cap(F.real ? "Recorded with Claude Code" : "Ready", `${ir.screens.length} screens on ${new Set(ir.screens.map(x => x.formLabel)).size} devices, with test data. Now we use it.`, F.real ? "The same idea, run through Claude Code and recorded step by step." : ""); await sleep(PACE.ready);

    for (const [i, f] of R.steps.entries()) {
      if ((F.drop || []).includes(i)) continue;
      if (f.kind === "reality") {
        real = f.on; if (!real) continue;
        const e = el("div", "est"); e.append(el("div", "k", "Claude's estimate of a version you could ship today"), el("p", "", R.reality.summary));
        const tb = el("table"), hr = el("tr"); ["Action", "How it would really be built", "Wrong", "Delay"].forEach(h => hr.append(el("th", "", h))); tb.append(hr);
        for (const x of R.reality.intents.slice(0, 6)) { const tr = el("tr"), td = el("td"); x.parts.forEach(q => { const d = el("div"); d.append(el("span", "tag " + q.builtWith, q.builtWith.replace("_", " ")), document.createTextNode(q.what)); td.append(d) }); tr.append(el("td", "", x.intent), td, el("td", "num", Math.round(x.errorRate * 100) + "%"), el("td", "num", secs(x.delayMs))); tb.append(tr) }
        e.append(tb); over(e); reply(null, "");
        cap("Existing tech", "Flip the switch: the same buttons now behave like a shippable version, late and sometimes wrong."); await sleep(PACE.estimate); over(null); continue;
      }
      n++;
      if (f.kind === "request") {
        $("stage").classList.remove("focus"); reply(null, "");
        cap(`Step ${n} · a change, in words`, "“" + f.text + "”", "No code edited: Claude changes its own screens, data and brief.");
        const devs = changed(f.ir || ir, state, f.state).slice(0, 3);
        fit(9); face.set({ ir, state, highlight: null, busy: {}, only: null }); await sleep(PACE.pre);
        await fastForward(f.ms, PACE.ff);
        ir = f.ir || ir; state = f.state; fit(devs.length || 9); face.set({ ir, state, highlight: null, busy: {}, only: devs.length ? devs : null });
        $("real").textContent = `real ${secs(f.ms)}`;
        reply("Claude", f.reply.replace(/\*\*/g, "").split("\n").filter(Boolean).slice(0, 3).join(" ")); await sleep(readMs(f.reply)); continue;
      }
      $("stage").classList.add("focus"); reply(null, "");
      const hl = { dev: f.device, intent: f.intent, id: f.item && f.item.id }, screens = { [f.device]: f.screen };
      cap(`Step ${n} · ${f.device}${real ? " · existing tech" : ""}`, f.say, "Pressed: “" + f.intent + "”");
      const devs = [f.device, ...changed(f.ir || ir, state, f.state).filter(d => d !== f.device)].slice(0, 3);
      fit(1); face.set({ ir, state, highlight: hl, busy: {}, screens, only: [f.device], forms: { [f.screen]: f.inputs || {} } }); await sleep(PACE.pre);
      face.set({ busy: { [f.device]: { action: f.intent, label: "" } } });
      await fastForward(f.ms, PACE.ff, now => face.label(f.calls.map(x => x.name).join(" → ") + " · " + secs(now)));
      ir = f.ir || ir; state = f.state;
      face.set({ forms: { [f.screen]: Object.fromEntries(Object.keys(f.inputs || {}).map(k => [k, ""])) } });
      fit(devs.length); face.set({ ir, state, highlight: hl, busy: {}, screens, only: devs });
      $("real").textContent = `real ${secs(f.ms)}${usd(f.cost)} · ${f.calls.map(x => x.name).join(", ")}`;
      reply("Claude, acting as the system", f.reply || "(no reply)"); await sleep(readMs(f.reply));
    }

    reply(null, ""); $("real").textContent = "";
    const end = el("div", "card"), links = el("div", "links");
    links.append(el("div", "", "kuron.pages.dev"), el("div", "", "github.com/Ag3497120/kuron"));
    end.append(el("h1", "", "kuron"), el("p", "", "Try an idea by hand in minutes, before building it. Then turn what it did into a spec and a build plan."), links);
    over(end); cap("", ""); await sleep(PACE.end);
    window.__done = true;
  }
  run().catch(e => { document.body.append(el("pre", "", String(e.stack || e))); window.__done = true });
})();
