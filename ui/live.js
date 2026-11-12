// General real-world components. Nothing here is specific to one idea: the program's actions (run by the
// LLM-CPU) decide what the camera sees, how the sound is shaped and what is said. In "existing technology"
// mode the same components add the delay, leakage and coarse timing such an implementation would have.
const BANDS = [63, 125, 250, 500, 1000, 2000, 4000, 8000];

export function createLive({ api, getState, getSid, T, onResult, onError, lang }) {
  const reg = {};            // persistent nodes and loops per component (key = screen:index)
  const A = { ctx: null };   // shared audio engine
  let R = null;              // reality estimate while "existing technology" mode is on

  /* ---------- audio engine: sources → bus → [EQ → delay] → out; dry path for A/B and leakage ---------- */
  function audio() {
    if (A.ctx) return A;
    const ctx = A.ctx = new (window.AudioContext || window.webkitAudioContext)();
    A.bus = ctx.createGain();
    A.analyser = ctx.createAnalyser(); A.analyser.fftSize = 4096; A.analyser.smoothingTimeConstant = 0.6;
    A.bus.connect(A.analyser);
    A.eqIn = ctx.createGain(); A.bus.connect(A.eqIn);
    A.eq = []; A.delay = ctx.createDelay(2); A.wet = ctx.createGain(); A.dry = ctx.createGain(); A.out = ctx.createGain();
    A.eqIn.connect(A.delay); A.delay.connect(A.wet); A.bus.connect(A.dry);
    A.wet.connect(A.out); A.dry.connect(A.out); A.out.connect(ctx.destination);
    A.processing = true; A.hist = []; applyMix();
    return A;
  }
  function applyMix() {
    if (!A.ctx) return;
    const t = A.ctx.currentTime, leak = R ? Math.max(0, Math.min(1, R.leak || 0)) : 0;
    A.delay.delayTime.setTargetAtTime(R ? Math.min(1.5, (R.audioLatencyMs || 0) / 1000) : 0, t, 0.02);
    // ideal: processed only (or untouched when off). existing tech: the real sound leaks in on top of a late processed sound
    A.wet.gain.setTargetAtTime(A.processing ? 1 : 0, t, 0.02);
    A.dry.gain.setTargetAtTime(A.processing ? leak : 1, t, 0.02);
  }
  function setGains(rows) {
    const a = audio(), ctx = a.ctx;
    const bands = (rows || []).map(r => ({ low: +r.lowHz, high: +r.highHz, gain: +r.gainDb })).filter(b => b.low > 0 && b.high > b.low && isFinite(b.gain));
    const key = JSON.stringify(bands.map(b => [b.low, b.high]));
    if (key !== a.eqKey) {           // rebuild the chain only when the bands themselves change
      a.eqIn.disconnect(); a.eq.forEach(f => f.disconnect());
      a.eq = bands.map(b => {
        const f = ctx.createBiquadFilter();
        if (b.low <= 40) { f.type = "lowshelf"; f.frequency.value = b.high }
        else if (b.high >= 12000) { f.type = "highshelf"; f.frequency.value = b.low }
        else { f.type = "peaking"; const c = Math.sqrt(b.low * b.high); f.frequency.value = c; f.Q.value = Math.max(0.3, c / (b.high - b.low)) }
        return f;
      });
      let node = a.eqIn; for (const f of a.eq) { node.connect(f); node = f } node.connect(a.delay);
      a.eqKey = key;
    }
    bands.forEach((b, i) => a.eq[i].gain.setTargetAtTime(Math.max(-60, Math.min(24, b.gain)), ctx.currentTime, 0.05));
  }
  function features() {
    const a = audio(), n = a.analyser.frequencyBinCount, data = new Float32Array(n);
    a.analyser.getFloatFrequencyData(data);
    const hz = i => i * a.ctx.sampleRate / a.analyser.fftSize;
    const level = {}, now = performance.now();
    for (const c of BANDS) {
      let sum = 0, k = 0;
      for (let i = 1; i < n; i++) { const f = hz(i); if (f >= c / Math.SQRT2 && f < c * Math.SQRT2) { sum += Math.pow(10, data[i] / 10); k++ } }
      level[c >= 1000 ? c / 1000 + "kHz" : c + "Hz"] = k ? Math.round(10 * Math.log10(sum / k + 1e-12)) : -120;
    }
    const loud = Math.round(10 * Math.log10(Object.values(level).reduce((s, v) => s + Math.pow(10, v / 10), 0) + 1e-12));
    a.hist.push({ t: now, level }); while (a.hist.length && now - a.hist[0].t > 3000) a.hist.shift();
    const old = a.hist[0] && a.hist[0].level;
    const rising = old ? Object.keys(level).filter(k => level[k] - old[k] > 6) : [];
    return { loudness_db: loud, level_per_band_db: level, rising_bands: rising, words_heard: (reg.__words || []).slice(-3).join(" / ") };
  }

  /* ---------- test sounds, synthesized from data an action wrote ---------- */
  let noiseBuf = null;
  const noise = ctx => { if (noiseBuf) return noiseBuf; noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; return noiseBuf };
  // Each item follows the sounds contract exactly (kind/envelope are fixed words, level 0–1): no guessing here.
  async function playSounds(rows, loop) {
    stopSounds();
    const a = audio(), ctx = a.ctx, t0 = ctx.currentTime + 0.1;
    const nodes = []; let end = 0;
    for (const r of rows || []) {
      const low = Math.max(20, +r.lowHz || 200), high = Math.max(low + 10, +r.highHz || 2000);
      const lvl = Math.max(0, Math.min(1, +r.level || 0)), start = Math.max(0, +r.startSec || 0), dur = Math.max(0.3, +r.durationSec || 3);
      const out = ctx.createGain(); out.gain.value = 0; out.connect(a.bus);
      const s = t0 + start, e = s + dur, G = out.gain; end = Math.max(end, start + dur);
      if (r.envelope === "approach") { G.setValueAtTime(Math.max(1e-4, lvl * 0.05), s); G.exponentialRampToValueAtTime(Math.max(1e-4, lvl), e - 0.05) }
      else if (r.envelope === "away") { G.setValueAtTime(Math.max(1e-4, lvl), s); G.exponentialRampToValueAtTime(Math.max(1e-4, lvl * 0.05), e - 0.05) }
      else if (r.envelope === "pulse") { for (let t = s; t < e; t += 0.5) { G.setValueAtTime(lvl, t); G.setValueAtTime(0, t + 0.25) } }
      else G.setValueAtTime(lvl, s);
      G.setValueAtTime(0, e);
      if (r.kind === "voice") {
        try {
          const buf = await ctx.decodeAudioData(await (await fetch("/api/speak?text=" + encodeURIComponent(String(r.words || r.label || "")))).arrayBuffer());
          for (let t = s; t < e; t += buf.duration + 0.6) { const src = ctx.createBufferSource(); src.buffer = buf; src.connect(out); src.start(t); nodes.push(src) }
        } catch (err) { onError(err) }
      } else if (r.kind === "tone" || r.kind === "siren" || r.kind === "beep") {
        const o = ctx.createOscillator(); o.type = r.kind === "beep" ? "square" : "sine"; o.frequency.value = (low + high) / 2;
        if (r.kind === "siren") { const lfo = ctx.createOscillator(), dep = ctx.createGain(); lfo.frequency.value = 0.7; dep.gain.value = (high - low) / 2; lfo.connect(dep); dep.connect(o.frequency); lfo.start(s); lfo.stop(e); nodes.push(lfo) }
        if (r.kind === "beep") { const gate = ctx.createGain(); o.connect(gate); gate.connect(out); for (let t = s; t < e; t += 0.4) { gate.gain.setValueAtTime(1, t); gate.gain.setValueAtTime(0, t + 0.2) } } else o.connect(out);
        o.start(s); o.stop(e); nodes.push(o);
      } else { // noise and hum: band-limited noise, hum adds its fundamental
        const src = ctx.createBufferSource(); src.buffer = noise(ctx); src.loop = true;
        const hp = ctx.createBiquadFilter(), lp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = low; lp.type = "lowpass"; lp.frequency.value = high;
        src.connect(hp); hp.connect(lp); lp.connect(out);
        if (r.kind === "hum") { const o = ctx.createOscillator(); o.frequency.value = low; const og = ctx.createGain(); og.gain.value = 0.5; o.connect(og); og.connect(out); o.start(s); o.stop(e); nodes.push(o) }
        src.start(s); src.stop(e); nodes.push(src);
      }
    }
    A.sounds = { nodes, timer: loop ? setTimeout(() => playSounds(rows, loop), (end + 1.5) * 1000) : null };
  }
  function stopSounds() { if (!A.sounds) return; clearTimeout(A.sounds.timer); A.sounds.nodes.forEach(n => { try { n.stop() } catch { } }); A.sounds = null }

  /* ---------- helpers ---------- */
  const el = (tag, cls, txt) => { const n = document.createElement(tag); if (cls) n.className = cls; if (txt != null) n.textContent = txt; return n };
  const btn = (txt, fn) => { const b = el("button", "lv-btn", txt); b.type = "button"; b.onclick = fn; return b };
  const interval = sec => Math.max(1, R ? Math.max(sec || 0, R.minIntervalSec || 0) : sec || 0);
  async function send(key, action, payload) {
    const r = reg[key]; if (!action || r.busy) return; r.busy = true; r.status && (r.status.textContent = T("lvThinking"));
    try { const res = await api("/api/act", { sid: getSid(), action, ...payload }); onResult(res); r.status && (r.status.textContent = T("lvDone") + " · " + (res.ms / 1000).toFixed(1) + T("sec")) }
    catch (e) { r.status && (r.status.textContent = T("error") + ": " + e.message); onError(e) }
    finally { r.busy = false }
  }
  function autoLoop(key, c, fn) {
    const r = reg[key]; clearInterval(r.timer); r.timer = null;
    if (r.auto && c.every > 0) r.timer = setInterval(fn, interval(c.every) * 1000);
  }

  /* ---------- components ---------- */
  function camera(c, key) {
    const r = reg[key] ||= { box: el("div", "lv lv-cam"), video: el("video"), canvas: el("canvas"), img: null, auto: false };
    if (!r.built) {
      r.built = true; r.video.muted = true; r.video.playsInline = true; r.video.autoplay = true;
      const bar = el("div", "lv-bar"), file = el("input"); file.type = "file"; file.accept = "image/*"; file.hidden = true;
      file.onchange = () => { const f = file.files[0]; if (!f) return; const im = new Image(); im.onload = () => { r.img = im; r.video.hidden = true; r.preview.src = im.src; r.preview.hidden = false }; im.src = URL.createObjectURL(f) };
      r.preview = el("img"); r.preview.hidden = true;
      const shot = () => { const src = r.img || (r.stream ? r.video : null); if (!src) return null; const w = Math.min(640, src.videoWidth || src.naturalWidth || 640), h = Math.round(w * ((src.videoHeight || src.naturalHeight || 480) / (src.videoWidth || src.naturalWidth || 640))); r.canvas.width = w; r.canvas.height = h; r.canvas.getContext("2d").drawImage(src, 0, 0, w, h); return r.canvas.toDataURL("image/jpeg", 0.7) };
      r.look = () => { const im = shot(); if (im) send(key, c.action, { images: [im], inputs: {} }); else r.status.textContent = T("lvNoPicture") };
      r.autoBtn = btn("", () => { r.auto = !r.auto; r.autoBtn.textContent = (r.auto ? "■ " : "▶ ") + T("lvAuto"); autoLoop(key, c, r.look) });
      r.autoBtn.textContent = "▶ " + T("lvAuto");
      bar.append(btn(T("lvUseCamera"), async () => { try { r.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false }); r.video.srcObject = r.stream; r.img = null; r.video.hidden = false; r.preview.hidden = true } catch (e) { r.status.textContent = T("error") + ": " + e.message } }),
        btn(T("lvUseImage"), () => file.click()), btn(T("lvLook"), r.look), ...(c.every > 0 ? [r.autoBtn] : []), file);
      r.status = el("small", "lv-status", c.action ? T("lvCameraHint") : "");
      r.box.append(el("b", "lv-title", c.label || T("lvCamera")), r.video, r.preview, bar, r.status);
    }
    return r.box;
  }
  function mic(c, key) {
    const r = reg[key] ||= { box: el("div", "lv lv-mic"), meter: el("canvas", "lv-meter"), auto: false };
    if (!r.built) {
      r.built = true;
      const send1 = () => send(key, c.action, { inputs: { sound: JSON.stringify(features()) } });
      r.autoBtn = btn("▶ " + T("lvAuto"), () => { r.auto = !r.auto; r.autoBtn.textContent = (r.auto ? "■ " : "▶ ") + T("lvAuto"); autoLoop(key, c, send1) });
      const start = btn(T("lvUseMic"), async () => {
        try {
          const a = audio(); await a.ctx.resume();
          r.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
          r.src = a.ctx.createMediaStreamSource(r.stream); r.src.connect(a.bus); start.disabled = true; meter(r.meter);
          const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
          if (SR) { const rec = new SR(); rec.lang = { ja: "ja-JP", en: "en-US", zh: "zh-CN", ko: "ko-KR" }[lang] || lang; rec.continuous = true; rec.onresult = e => { reg.__words = [...(reg.__words || []), e.results[e.results.length - 1][0].transcript].slice(-10) }; rec.onend = () => { if (r.stream) try { rec.start() } catch { } }; try { rec.start() } catch { } r.rec = rec }
        } catch (e) { r.status.textContent = T("error") + ": " + e.message }
      });
      r.status = el("small", "lv-status", "");
      r.box.append(el("b", "lv-title", c.label || T("lvMic")), r.meter, el("div", "lv-bar"), r.status);
      r.box.children[2].append(start, ...(c.action ? [btn(T("lvSend"), send1)] : []), ...(c.action && c.every > 0 ? [r.autoBtn] : []));
    }
    return r.box;
  }
  function meter(cv) {
    const draw = () => {
      if (!A.ctx || !cv.isConnected) { requestAnimationFrame(draw); return }
      const f = features(), g = cv.getContext("2d"), w = cv.width = cv.clientWidth || 300, h = cv.height = 60, vals = Object.values(f.level_per_band_db);
      g.clearRect(0, 0, w, h); const bw = w / vals.length;
      vals.forEach((v, i) => { const y = Math.max(0, Math.min(1, (v + 100) / 80)); g.fillStyle = "#6e8dfb"; g.fillRect(i * bw + 2, h - y * h, bw - 4, y * h) });
      requestAnimationFrame(draw);
    };
    if (!cv.dataset.on) { cv.dataset.on = "1"; requestAnimationFrame(draw) }
  }
  function sounds(c, key, state) {
    const r = reg[key] ||= { box: el("div", "lv lv-sounds"), list: el("ul", "lv-list") };
    const rows = (state && state[c.source]) || [];
    if (!r.built) {
      r.built = true;
      r.play = btn("▶ " + T("lvPlaySounds"), async () => { await audio().ctx.resume(); r.on = !r.on; r.play.textContent = (r.on ? "■ " : "▶ ") + T("lvPlaySounds"); if (r.on) playSounds(r.rows, true); else stopSounds() });
      r.box.append(el("b", "lv-title", c.label || T("lvSounds")), r.list, r.play);
    }
    const sig = JSON.stringify(rows);
    if (sig !== r.sig) { r.sig = sig; r.rows = rows; r.list.textContent = ""; rows.forEach(x => r.list.append(el("li", "", [x.label, x.kind, x.envelope, x.lowHz + "–" + x.highHz + "Hz", "level " + x.level].filter(Boolean).join(" · ")))); if (r.on) playSounds(rows, true) }
    if (!rows.length) r.list.append(el("li", "lv-status", T("lvNoSounds")));
    return r.box;
  }
  function output(c, key, state) {
    const r = reg[key] ||= { box: el("div", "lv lv-out"), meter: el("canvas", "lv-meter"), bars: el("div", "lv-gains"), auto: false };
    const rows = (state && state[c.gains]) || [];
    if (!r.built) {
      r.built = true;
      const sel = el("select"), find = btn(T("lvFindOutputs"), async () => { try { const s = await navigator.mediaDevices.getUserMedia({ audio: true }); s.getTracks().forEach(t => t.stop()) } catch { } fill() });
      const fill = async () => { try { const ds = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === "audiooutput"); sel.textContent = ""; ds.forEach((d, i) => sel.append(new Option(d.label || T("lvOutput") + " " + (i + 1), d.deviceId))) } catch { } };
      sel.onchange = async () => { const a = audio(); try { if (a.ctx.setSinkId) await a.ctx.setSinkId(sel.value === "default" ? "" : sel.value); else r.status.textContent = T("lvNoSink") } catch (e) { r.status.textContent = T("error") + ": " + e.message } };
      const ab = btn("", () => { A.processing = !A.processing; ab.textContent = A.processing ? T("lvProcOn") : T("lvProcOff"); applyMix() }); ab.textContent = T("lvProcOn");
      const send1 = () => send(key, c.action, { inputs: { sound: JSON.stringify(features()) } });
      r.autoBtn = btn("▶ " + T("lvAuto"), async () => { await audio().ctx.resume(); r.auto = !r.auto; r.autoBtn.textContent = (r.auto ? "■ " : "▶ ") + T("lvAuto"); autoLoop(key, c, send1) });
      const bar = el("div", "lv-bar"); bar.append(sel, find, ab, ...(c.action ? [btn(T("lvSend"), send1)] : []), ...(c.action && c.every > 0 ? [r.autoBtn] : []));
      r.status = el("small", "lv-status", T("lvConnect"));
      r.box.append(el("b", "lv-title", c.label || T("lvOutputTitle")), bar, r.meter, r.bars, r.status);
      fill(); audio(); meter(r.meter);
    }
    setGains(rows);
    r.bars.textContent = "";
    rows.forEach(x => { const gdb = +x.gainDb || 0, d = el("div", "lv-gain"); d.append(el("span", "", x.label || (x.lowHz + "–" + x.highHz + "Hz")), el("i")); d.lastChild.style.width = Math.min(100, Math.abs(gdb) * 2) + "%"; d.lastChild.className = gdb < 0 ? "cut" : "boost"; d.append(el("small", "", (gdb > 0 ? "+" : "") + gdb + " dB")); r.bars.append(d) });
    return r.box;
  }
  function speak(c, key, text) {
    const r = reg[key] ||= { box: el("div", "lv lv-speak"), line: el("p") };
    if (!r.built) { r.built = true; r.box.append(r.line, btn("🔊 " + T("lvSpeak"), () => say(r.text))) }
    if (text && text !== r.text) { r.text = text; r.line.textContent = text; if (A.ctx && A.ctx.state === "running" && r.spoken !== undefined) say(text); r.spoken = true }
    return r.box;
  }
  async function say(text) {
    if (!text) return; const a = audio(); await a.ctx.resume();
    try { const buf = await a.ctx.decodeAudioData(await (await fetch("/api/speak?text=" + encodeURIComponent(text))).arrayBuffer()); const s = a.ctx.createBufferSource(); s.buffer = buf; s.connect(a.ctx.destination); s.start() } catch (e) { onError(e) }
  }
  function drawing(c, key, ctx, state) {
    reg[key] ||= {};
    const box = el("div", "lv lv-draw"), svg = String((state && state[c.field]) || "");
    reg[key].box = box; if (reg[key].busy) box.classList.add("lv-wait");   // a redraw in the middle of a turn keeps waiting
    if (!svg.trim().startsWith("<svg")) { box.append(el("small", "lv-status", T("lvNoDrawing"))); return box }
    const doc = new DOMParser().parseFromString(svg, "image/svg+xml"), root = doc.documentElement;
    if (root.nodeName !== "svg") { box.append(el("small", "lv-status", T("lvNoDrawing"))); return box }
    root.querySelectorAll("script,foreignObject,iframe").forEach(n => n.remove());
    root.querySelectorAll("*").forEach(n => [...n.attributes].forEach(a => { if (/^on/i.test(a.name) || /javascript:/i.test(a.value)) n.removeAttribute(a.name) }));
    root.removeAttribute("width"); root.removeAttribute("height"); const node = document.importNode(root, true);
    // Whatever in the picture carries data-intent can be touched, pressed by a key or dragged (see parts.js).
    // Text in the picture may name values in braces, like any text part.
    node.querySelectorAll("text,tspan").forEach(n => n.childNodes.forEach(t => { if (t.nodeType === 3 && t.nodeValue.includes("{")) t.nodeValue = ctx.tpl(t.nodeValue) }));
    window.KuronParts.wire(node, { screen: ctx.screen, inputs: () => ({}), hasFields: false,
      fire: (intent, payload) => { if (reg[key].busy) return; box.classList.add("lv-wait"); return send(key, intent, payload).finally(() => reg[key].box.classList.remove("lv-wait")) } });
    box.append(node); return box;
  }

  return {
    say,
    render(c, ctx, state) {
      const key = ctx.screen + ":" + ctx.index;
      if (c.kind === "camera") return camera(c, key);
      if (c.kind === "mic") return mic(c, key);
      if (c.kind === "sounds") return sounds(c, key, state);
      if (c.kind === "output") return output(c, key, state);
      if (c.kind === "speak") return speak(c, key, ctx.tpl(c.text));
      if (c.kind === "drawing") return drawing(c, key, ctx, state);
      return null;
    },
    setReality(r) {
      R = r; applyMix();
      for (const k of Object.keys(reg)) { const x = reg[k]; if (x && x.timer && x.autoBtn) x.autoBtn.click(), x.autoBtn.click() }
    },
    reset() { stopSounds(); for (const k of Object.keys(reg)) { const x = reg[k]; if (!x || k === "__words") continue; clearInterval(x.timer); if (x.stream) x.stream.getTracks().forEach(t => t.stop()); if (x.rec) try { x.rec.stop() } catch { } } for (const k of Object.keys(reg)) delete reg[k]; noiseBuf = null; if (A.ctx) { A.ctx.close(); A.ctx = null; A.eqKey = null } },
  };
}
