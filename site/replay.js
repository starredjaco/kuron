// Plays back a recorded kuron run (replay.json) with the same renderer the tool uses. Nothing is simulated:
// every state, reply and tool call comes from the recording.
(function () {
  const { createFace, faceIR } = window.KuronFace;
  const $ = id => document.getElementById(id);
  const el = (tag, cls, txt) => { const n = document.createElement(tag); if (cls) n.className = cls; if (txt != null) n.textContent = txt; return n };
  const T = k => ({ thinking: "Claude is acting", error: "Error", lvNoDrawing: "No picture yet.", lvNoSounds: "No test sounds yet.", lvSounds: "Test sounds" })[k] || k;
  const face = createFace({ root: $("rpStage"), T });
  const view = d => ({ ...d.values, ...d.collections, __sounds: d.output.sounds, __bands: d.output.bands });
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let R, frames, at = 0, timer = null, phase = [];

  fetch("replay.json").then(r => r.json()).then(data => { R = data; build(); show(0, false) })
    .catch(() => { $("rpStage").textContent = "The recording could not be loaded." });

  // Each frame: what the screens show before, during and after one recorded step.
  function build() {
    let ir = faceIR(R.start), state = view(R.start), real = false;
    frames = [{ kind: "setup", ir, before: state, after: state, real }];
    for (const s of R.steps) {
      if (s.kind === "reality") { real = s.on; frames.push({ ...s, ir, before: state, after: state, real, quiet: !s.on }); continue }
      const before = state, nextIr = s.ir ? { ...s.ir, screens: s.ir.screens } : ir;
      state = s.state; frames.push({ ...s, ir, irAfter: nextIr, before, after: state, real }); ir = nextIr;
    }
    frames = frames.filter(f => !f.quiet);
    const ol = $("rpDots"); ol.textContent = "";
    frames.forEach((f, i) => { const li = el("li"), b = el("button", f.kind === "event" ? "" : "rq", String(i)); b.type = "button"; b.title = label(f); b.onclick = () => { stop(); show(i, true) }; li.append(b); ol.append(li) });
  }
  const label = f => f.kind === "setup" ? "Setup" : f.kind === "request" ? "Change request" : f.kind === "reality" ? "Existing tech" : f.intent;
  const secs = ms => (ms / 1000).toFixed(1) + " s";
  const usd = c => c != null ? " · $" + c.toFixed(3) : "";

  function caption(f) {
    const c = $("rpCap"); c.textContent = "";
    const k = el("div", "k", `Step ${frames.indexOf(f)} of ${frames.length - 1}` + (f.real ? " · existing-tech mode" : ""));
    if (f.kind === "setup") {
      c.append(k, el("div", "say", "One idea in, a working five-device clinic out."));
      const counts = {}; R.setup.calls.forEach(x => counts[x.name] = (counts[x.name] || 0) + 1);
      c.append(el("div", "act", "Setup tools: " + Object.entries(counts).map(([n, v]) => v > 1 ? `${n} ×${v}` : n).join(", ")));
      c.append(el("div", "reply", "Its first screens used “label” where a heading needs “text”; the define_screen tool answered with what was missing and Claude redefined them. Nothing in the code fixed it."));
      c.append(el("div", "meta", `${secs(R.setup.ms)}${usd(R.setup.cost)} · Claude Sonnet 5.5`));
    } else if (f.kind === "event") {
      c.append(k, el("div", "say", f.say));
      c.append(el("div", "act", `${f.device} → “${f.intent}”` + (Object.keys(f.inputs || {}).length ? "  " + JSON.stringify(f.inputs) : "")));
      c.append(el("div", "reply", f.reply || "(no reply)"));
      c.append(el("div", "meta", `${secs(f.ms)}${usd(f.cost)} · tools: ${f.calls.map(x => x.name).join(", ")}` + (f.real ? " · includes the estimated delay of a shippable version" : "")));
    } else if (f.kind === "request") {
      c.append(k, el("div", "say", "A change request, in words. Claude changes its own screens, data and brief."));
      c.append(el("div", "act", "“" + f.text + "”"));
      c.append(el("div", "reply", f.reply.replace(/\*\*/g, "")));
      c.append(el("div", "meta", secs(f.ms) + " · Claude Sonnet 5.5"));
    } else if (f.kind === "reality") {
      c.append(k, el("div", "say", "Existing tech: the same buttons now behave like a version you could ship today."));
      c.append(el("div", "reply", "Claude estimated, during setup, how each action would really be built, how often it goes wrong and how late it answers. In this mode every action follows that estimate."));
    }
  }
  function realityPanel(f) {
    const p = $("rpReal"), r = R.reality; p.hidden = !(f.real && r); p.textContent = ""; if (p.hidden) return;
    p.append(el("p", "", r.summary));
    const w = el("div", "scroll"), t = el("table"), hr = el("tr");
    ["Action", "How a real version would do it", "Wrong", "Delay"].forEach(h => hr.append(el("th", "", h))); t.append(hr);
    for (const x of r.intents) {
      const tr = el("tr"), ul = el("ul", "parts");
      x.parts.forEach(q => { const li = el("li"); li.append(el("span", "tag " + (q.builtWith === "not_yet" ? "notyet" : q.builtWith), q.builtWith.replace("_", " ")), document.createTextNode(q.what)); ul.append(li) });
      const td = el("td"); td.append(ul);
      tr.append(el("td", "", x.intent), td, el("td", "num", Math.round(x.errorRate * 100) + "%"), el("td", "num", secs(x.delayMs))); t.append(tr);
    }
    w.append(t); p.append(w);
  }

  function clear() { phase.forEach(clearTimeout); phase = [] }
  function show(i, animate) {
    clear(); at = i; const f = frames[i];
    [...$("rpDots").querySelectorAll("button")].forEach((b, k) => b.setAttribute("aria-current", k === i ? "step" : "false"));
    caption(f); realityPanel(f);
    const stage = $("rpStage");
    if (f.kind !== "event") { stage.classList.remove("focus"); face.set({ ir: f.irAfter || f.ir, state: f.after, highlight: null, busy: {} }); return }
    stage.classList.add("focus");
    const hl = { dev: f.device, intent: f.intent, id: f.item && f.item.id }, screens = { [f.device]: f.screen };
    const after = () => { face.set({ ir: f.irAfter, state: f.after, highlight: hl, busy: {}, screens }); face.toast(f.device, f.reply) };
    if (!animate || reduced) { after(); return }
    face.set({ ir: f.ir, state: f.before, highlight: hl, busy: {}, screens });
    phase.push(setTimeout(() => face.set({ busy: { [f.device]: { action: f.intent, label: f.calls.map(x => x.name).join(" → ") + " · " + secs(f.ms) } } }), 1100));
    phase.push(setTimeout(after, 2900));
  }
  function stop() { clearInterval(timer); timer = null; $("rpPlay").textContent = "▶ Play" }
  function play() {
    if (timer) return stop();
    if (at >= frames.length - 1) at = -1;
    $("rpPlay").textContent = "❚❚ Pause";
    const next = () => { if (at >= frames.length - 1) return stop(); show(at + 1, true) };
    next(); timer = setInterval(next, 8500);
  }
  $("rpPlay").onclick = play;
  $("rpPrev").onclick = () => { stop(); show(Math.max(0, at - 1), true) };
  $("rpNext").onclick = () => { stop(); show(Math.min(frames.length - 1, at + 1), true) };
})();
