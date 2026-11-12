// kuron's face for the browser: draws the screens the LLM defined, and the generic real-world parts.
// It decides nothing about any idea. Used by the Claude artifact (live) and by the site's replay (read-only).
(function () {
  const FRAME = { website: "web", phone: "phone", desktop: "desktop", iot: "iot", terminal: "term", watch: "watch", panel: "panel" };
  const BANDS = [63, 125, 250, 500, 1000, 2000, 4000, 8000];
  const LIVE_KINDS = ["camera", "mic", "sounds", "output", "speak", "drawing"];

  // Turn a part as the LLM wrote it into what the face draws. This only renames fields; it decides nothing.
  function facePart(p) {
    const q = { ...p };
    if (p.collection) q.source = p.collection;
    if (p.intent) q.action = p.intent;
    if (p.where && typeof p.where === "object") { const [k, v] = Object.entries(p.where)[0] || []; if (k !== undefined) { q.whereField = k; q.whereValue = String(v) } }
    if (p.order && p.order.property) { q.sortField = p.order.property; q.sortValues = p.order.values || []; q.sortDesc = p.order.direction === "descending" }
    if (p.kind === "sounds") q.source = "__sounds";
    if (p.kind === "output") q.gains = "__bands";
    if (p.kind === "drawing") q.field = p.value;
    if (p.row) q.row = p.row.map(facePart);
    return q;
  }
  const faceIR = d => ({ name: d.name, lang: d.lang, reality: d.reality,
    screens: (d.screens || []).map(s => ({ name: s.name, form: FRAME[s.frame] || "panel", formLabel: s.device, view: (s.parts || []).map(facePart) })) });

  const el = (tag, cls, txt) => { const n = document.createElement(tag); if (cls) n.className = cls; if (txt != null) n.textContent = txt; return n };
  const get = (obj, path) => String(path).split(".").reduce((o, k) => (o == null ? o : o[k]), obj);
  function show(v) { if (v == null) return ""; if (typeof v === "boolean") return v ? "✓" : "—"; if (Array.isArray(v)) return v.map(show).join(", "); if (typeof v === "object") return Object.values(v).map(show).join(" / "); return String(v) }
  // Filter values are written by the LLM; booleans as "true"/"false". No word lists here.
  const matches = (v, want) => { const s = String(want ?? "").trim(); if (!s) return true; if (typeof v === "boolean") return v === (s.toLowerCase() === "true"); return String(v ?? "") === s };

  function createFace({ root, T, onPress = null, onLive = null, onError = () => { } }) {
    let ir = null, state = null, busy = {}, highlight = null, readOnly = !onPress, R = null, only = null;
    const cur = {}, forms = {}, toastT = {};

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
    function listOf(c) {
      const src = state && state[c.source]; if (!Array.isArray(src)) return [];
      let rows = src.map((item, index) => ({ item, index }));
      if (c.whereField) rows = rows.filter(r => r.item && typeof r.item === "object" ? matches(r.item[c.whereField], c.whereValue) : true);
      if (c.sortField) {
        // word values follow the display order the LLM gave (sortValues); numbers and dates compare as they are
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
      const box = el("div"); box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="var(--k-accent)" stroke-width="2.2" vector-effect="non-scaling-stroke"/></svg>`; return box;
    }

    function comp(c, ctx) {
      if (LIVE_KINDS.includes(c.kind)) return ctx.row ? null : live.render(c, { ...ctx, tpl: t => tpl(t, null) });
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
          i.value = f[c.name] ?? ""; i.dataset.form = ctx.screen; i.dataset.name = c.name; i.id = "f-" + ctx.screen + "-" + c.name;
          i.disabled = readOnly; i.oninput = i.onchange = () => { f[c.name] = i.value };
          lab.append(i); return lab;
        }
        case "button": {
          const b = el("button", "c-btn", tpl(c.text, row)); b.type = "button"; b.disabled = readOnly || !!busy[ctx.dev];
          if (highlight && highlight.dev === ctx.dev && highlight.intent === c.action && (!highlight.id || (row && row.id === highlight.id))) b.classList.add("hit");
          b.onclick = () => press(c, ctx); return b;
        }
        case "list": case "table": {
          const rows = listOf(c);
          if (!rows.length) return el("p", "c-empty", tpl(c.empty || "—", null));
          if (c.kind === "table") {
            const w = el("div", "c-table"), t = el("table"), cols = c.columns && c.columns.length ? c.columns : Object.keys(rows[0].item || {}).filter(k => k !== "id");
            const hr = el("tr"); cols.forEach(k => hr.append(el("th", "", k))); t.append(hr);
            rows.forEach(r => { const tr = el("tr"); cols.forEach(k => tr.append(el("td", "", show(r.item && typeof r.item === "object" ? r.item[k] : r.item)))); t.append(tr) });
            w.append(t); return w;
          }
          const ul = el("ul", "c-list");
          rows.forEach(r => {
            const li = el("li");
            if (highlight && highlight.id && r.item && r.item.id === highlight.id && highlight.dev === ctx.dev) li.classList.add("hit");
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

    async function press(c, ctx) {
      if (readOnly) return;
      if (!c.action) { if (c.goto) go(ctx.dev, c.goto); return }
      const f = forms[ctx.screen] || {}, inputs = { ...f };
      const item = ctx.row && ctx.row.item && typeof ctx.row.item === "object" ? { collection: ctx.list, ...ctx.row.item } : null;
      const t0 = Date.now(); busy[ctx.dev] = { t0, action: c.action }; renderDevice(ctx.dev);
      const tick = setInterval(() => { const n = root.querySelector(`[data-dev="${CSS.escape(ctx.dev)}"] .cpubusy em`); if (n) n.textContent = ((Date.now() - t0) / 1000).toFixed(1) + " s" }, 100);
      try {
        const r = await onPress({ intent: c.action, screen: ctx.screen, item, inputs });
        for (const k of Object.keys(f)) if (!root.querySelector(`select[data-name="${CSS.escape(k)}"]`)) f[k] = "";
        if (r && r.notice) toast(ctx.dev, r.notice);
        if (c.goto) cur[ctx.dev] = c.goto;
      } catch (e) { toast(ctx.dev, T("error") + ": " + (e.message || e.code || e)) }
      finally { clearInterval(tick); delete busy[ctx.dev]; render() }
    }
    function go(dev, screen) { cur[dev] = screen; renderDevice(dev) }
    function toast(dev, msg) {
      const n = root.querySelector(`[data-dev="${CSS.escape(dev)}"] .toast`); if (!n) return;
      n.textContent = msg; n.hidden = false; clearTimeout(toastT[dev]); toastT[dev] = setTimeout(() => n.hidden = true, readOnly ? 6000 : 4200);
    }

    function devices() {
      const out = []; if (!ir) return out;
      for (const s of ir.screens) { const key = s.formLabel || s.form; let d = out.find(x => x.key === key); if (!d) out.push(d = { key, form: s.form, label: s.formLabel, screens: [] }); d.screens.push(s) }
      out.forEach(d => { if (!cur[d.key] || !d.screens.some(s => s.name === cur[d.key])) cur[d.key] = d.screens[0].name });
      return out;
    }
    function frame(d) {
      const f = d.form, fig = el("figure", "devw w-" + f); fig.dataset.dev = d.key;
      if (highlight && highlight.dev === d.key) fig.classList.add("active");
      const dev = el("div", "dev f-" + f), scr = el("div", "scr"), sc = el("div", "sc");
      const navBtns = host => d.screens.length > 1 && d.screens.forEach(s => { const b = el("button", "", s.name); b.type = "button"; b.setAttribute("aria-current", String(s.name === cur[d.key])); b.onclick = () => go(d.key, s.name); host.append(b) });
      if (f === "phone") { const sb = el("div", "sbar"); sb.append(el("span", "", "9:41"), el("span", "", "●●● 5G")); scr.append(sb, el("div", "abar", cur[d.key])) }
      else if (f === "web" || f === "desktop") { const bar = el("div", "wbar"); bar.append(el("span", "dots"), el("span", "addr", (f === "web" ? "https://" : "") + (ir.name || "") + (f === "web" ? "/" + cur[d.key] : ""))); const nav = el("nav", "nav"); navBtns(nav); dev.append(bar, nav) }
      else if (f === "term") { const bar = el("div", "wbar"); bar.append(el("span", "dots"), el("span", "", (ir.name || "") + " — " + cur[d.key])); dev.append(bar) }
      else if (f === "iot") { const t = el("div", "iot"); t.append(el("span", "", (d.label || "IoT").toUpperCase()), el("i", "pwr")); dev.append(t) }
      else if (f !== "watch") { const t = el("div", "pbar"); t.append(el("span", "", d.label || ""), el("span", "", cur[d.key])); dev.append(t) }
      scr.append(sc);
      if (f === "phone" && d.screens.length > 1) { const tb = el("nav", "tabbar"); navBtns(tb); scr.append(tb) }
      if (f !== "web" && f !== "desktop" && f !== "phone" && d.screens.length > 1) { const nav = el("nav", "nav"); navBtns(nav); scr.prepend(nav) }
      const t = el("div", "toast"); t.hidden = true; t.setAttribute("role", "status"); scr.append(t);
      if (busy[d.key]) { const b = el("div", "cpubusy"); b.append(el("i"), el("span", "", T("thinking") + " · " + busy[d.key].action), el("em", "", busy[d.key].label || "")); scr.append(b) }
      dev.append(scr); fig.append(dev, el("figcaption", "", (d.label || f) + " · " + cur[d.key]));
      const screen = d.screens.find(s => s.name === cur[d.key]);
      if (screen && state) screen.view.forEach((c, index) => { const n = comp(c, { dev: d.key, screen: screen.name, index }); if (n) sc.append(n) });
      return fig;
    }
    function renderDevice(key) {
      const d = devices().find(x => x.key === key), old = root.querySelector(`[data-dev="${CSS.escape(key)}"]`);
      if (!d || !old) return render();
      const focus = document.activeElement && document.activeElement.dataset && document.activeElement.dataset.name;
      old.replaceWith(frame(d)); restoreFocus(focus);
    }
    function render() {
      const focus = document.activeElement && document.activeElement.dataset && document.activeElement.dataset.name;
      root.textContent = ""; devices().filter(d => !only || only.includes(d.key)).forEach(d => root.append(frame(d))); restoreFocus(focus);
    }
    function restoreFocus(name) { if (!name) return; const n = root.querySelector(`[data-name="${CSS.escape(name)}"]`); if (n) { n.focus({ preventScroll: true }); try { n.setSelectionRange(n.value.length, n.value.length) } catch { } } }

    /* ---------- real-world parts: test sounds, sound shaping, speech, drawings, pictures ---------- */
    const live = (() => {
      const reg = {}, A = { ctx: null };
      function audio() {
        if (A.ctx) return A;
        const ctx = A.ctx = new (window.AudioContext || window.webkitAudioContext)();
        A.bus = ctx.createGain(); A.analyser = ctx.createAnalyser(); A.analyser.fftSize = 4096; A.analyser.smoothingTimeConstant = 0.6;
        A.bus.connect(A.analyser); A.eqIn = ctx.createGain(); A.bus.connect(A.eqIn);
        A.eq = []; A.delay = ctx.createDelay(2); A.wet = ctx.createGain(); A.dry = ctx.createGain(); A.out = ctx.createGain();
        A.eqIn.connect(A.delay); A.delay.connect(A.wet); A.bus.connect(A.dry); A.wet.connect(A.out); A.dry.connect(A.out); A.out.connect(ctx.destination);
        A.processing = true; A.hist = []; applyMix(); return A;
      }
      function applyMix() {
        if (!A.ctx) return;
        const t = A.ctx.currentTime, leak = R ? Math.max(0, Math.min(1, R.leak || 0)) : 0;
        A.delay.delayTime.setTargetAtTime(R ? Math.min(1.5, (R.audioLatencyMs || 0) / 1000) : 0, t, 0.02);
        // ideal: processed only (or untouched when off). existing tech: the real sound leaks in on top of a late processed sound
        A.wet.gain.setTargetAtTime(A.processing ? 1 : 0, t, 0.02); A.dry.gain.setTargetAtTime(A.processing ? leak : 1, t, 0.02);
      }
      function setGains(rows) {
        const a = audio(), ctx = a.ctx;
        const bands = (rows || []).map(r => ({ low: +r.lowHz, high: +r.highHz, gain: +r.gainDb })).filter(b => b.low > 0 && b.high > b.low && isFinite(b.gain));
        const key = JSON.stringify(bands.map(b => [b.low, b.high]));
        if (key !== a.eqKey) {
          a.eqIn.disconnect(); a.eq.forEach(f => f.disconnect());
          a.eq = bands.map(b => { const f = ctx.createBiquadFilter(); if (b.low <= 40) { f.type = "lowshelf"; f.frequency.value = b.high } else if (b.high >= 12000) { f.type = "highshelf"; f.frequency.value = b.low } else { f.type = "peaking"; const c = Math.sqrt(b.low * b.high); f.frequency.value = c; f.Q.value = Math.max(0.3, c / (b.high - b.low)) } return f });
          let node = a.eqIn; for (const f of a.eq) { node.connect(f); node = f } node.connect(a.delay); a.eqKey = key;
        }
        bands.forEach((b, i) => a.eq[i].gain.setTargetAtTime(Math.max(-60, Math.min(24, b.gain)), ctx.currentTime, 0.05));
      }
      function features() {
        const a = audio(), n = a.analyser.frequencyBinCount, data = new Float32Array(n); a.analyser.getFloatFrequencyData(data);
        const hz = i => i * a.ctx.sampleRate / a.analyser.fftSize, level = {}, now = performance.now();
        for (const c of BANDS) { let sum = 0, k = 0; for (let i = 1; i < n; i++) { const f = hz(i); if (f >= c / Math.SQRT2 && f < c * Math.SQRT2) { sum += Math.pow(10, data[i] / 10); k++ } } level[c >= 1000 ? c / 1000 + "kHz" : c + "Hz"] = k ? Math.round(10 * Math.log10(sum / k + 1e-12)) : -120 }
        const loud = Math.round(10 * Math.log10(Object.values(level).reduce((s, v) => s + Math.pow(10, v / 10), 0) + 1e-12));
        a.hist.push({ t: now, level }); while (a.hist.length && now - a.hist[0].t > 3000) a.hist.shift();
        const old = a.hist[0] && a.hist[0].level, rising = old ? Object.keys(level).filter(k => level[k] - old[k] > 6) : [];
        return { loudness_db: loud, level_per_band_db: level, rising_bands: rising, words_heard: (A.words || []).slice(-3).join(" / ") };
      }
      let noiseBuf = null;
      const noise = ctx => { if (noiseBuf) return noiseBuf; noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; return noiseBuf };
      // Each item follows the sounds contract exactly (kind/envelope are fixed words, level 0–1): no guessing here.
      function playSounds(rows, loop) {
        stopSounds();
        const a = audio(), ctx = a.ctx, t0 = ctx.currentTime + 0.1, nodes = [], spoken = []; let end = 0;
        for (const r of rows || []) {
          const low = Math.max(20, +r.lowHz || 200), high = Math.max(low + 10, +r.highHz || 2000);
          const lvl = Math.max(0, Math.min(1, +r.level || 0)), start = Math.max(0, +r.startSec || 0), dur = Math.max(0.3, +r.durationSec || 3);
          end = Math.max(end, start + dur);
          if (r.kind === "voice") { spoken.push(setTimeout(() => say(String(r.words || r.label || ""), lvl), (start + 0.1) * 1000)); A.words = [...(A.words || []), String(r.words || "")].slice(-10); continue }
          const out = ctx.createGain(); out.gain.value = 0; out.connect(a.bus);
          const s = t0 + start, e = s + dur, G = out.gain;
          if (r.envelope === "approach") { G.setValueAtTime(Math.max(1e-4, lvl * 0.05), s); G.exponentialRampToValueAtTime(Math.max(1e-4, lvl), e - 0.05) }
          else if (r.envelope === "away") { G.setValueAtTime(Math.max(1e-4, lvl), s); G.exponentialRampToValueAtTime(Math.max(1e-4, lvl * 0.05), e - 0.05) }
          else if (r.envelope === "pulse") { for (let t = s; t < e; t += 0.5) { G.setValueAtTime(lvl, t); G.setValueAtTime(0, t + 0.25) } }
          else G.setValueAtTime(lvl, s);
          G.setValueAtTime(0, e);
          if (r.kind === "tone" || r.kind === "siren" || r.kind === "beep") {
            const o = ctx.createOscillator(); o.type = r.kind === "beep" ? "square" : "sine"; o.frequency.value = (low + high) / 2;
            if (r.kind === "siren") { const lfo = ctx.createOscillator(), dep = ctx.createGain(); lfo.frequency.value = 0.7; dep.gain.value = (high - low) / 2; lfo.connect(dep); dep.connect(o.frequency); lfo.start(s); lfo.stop(e); nodes.push(lfo) }
            if (r.kind === "beep") { const gate = ctx.createGain(); o.connect(gate); gate.connect(out); for (let t = s; t < e; t += 0.4) { gate.gain.setValueAtTime(1, t); gate.gain.setValueAtTime(0, t + 0.2) } } else o.connect(out);
            o.start(s); o.stop(e); nodes.push(o);
          } else {
            const src = ctx.createBufferSource(); src.buffer = noise(ctx); src.loop = true;
            const hp = ctx.createBiquadFilter(), lp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = low; lp.type = "lowpass"; lp.frequency.value = high;
            src.connect(hp); hp.connect(lp); lp.connect(out);
            if (r.kind === "hum") { const o = ctx.createOscillator(); o.frequency.value = low; const og = ctx.createGain(); og.gain.value = 0.5; o.connect(og); og.connect(out); o.start(s); o.stop(e); nodes.push(o) }
            src.start(s); src.stop(e); nodes.push(src);
          }
        }
        A.sounds = { nodes, spoken, timer: loop ? setTimeout(() => playSounds(rows, loop), (end + 1.5) * 1000) : null };
      }
      function stopSounds() { if (!A.sounds) return; clearTimeout(A.sounds.timer); A.sounds.spoken.forEach(clearTimeout); A.sounds.nodes.forEach(n => { try { n.stop() } catch { } }); A.sounds = null }
      function say(text, volume = 1) {
        if (!text || !window.speechSynthesis) return;
        try { const u = new SpeechSynthesisUtterance(text); u.lang = ir && ir.lang || document.documentElement.lang || "en"; u.volume = Math.max(0.05, Math.min(1, volume)); speechSynthesis.speak(u) } catch (e) { onError(e) }
      }
      const btn = (txt, fn) => { const b = el("button", "lv-btn", txt); b.type = "button"; b.onclick = fn; b.disabled = readOnly; return b };
      async function send(key, action, payload) {
        const r = reg[key]; if (!action || r.busy || !onLive) return; r.busy = true; r.status && (r.status.textContent = T("thinking"));
        try { const res = await onLive({ intent: action, ...payload }); r.status && (r.status.textContent = T("decided") + " · " + ((res && res.ms || 0) / 1000).toFixed(1) + " s"); if (res && res.notice) r.status.textContent += " · " + res.notice }
        catch (e) { r.status && (r.status.textContent = T("error") + ": " + (e.message || e.code)) }
        finally { r.busy = false }
      }
      function camera(c, key) {
        const r = reg[key] ||= { box: el("div", "lv lv-cam") };
        if (!r.built) {
          r.built = true;
          const file = el("input"); file.type = "file"; file.accept = "image/*"; file.hidden = true; r.preview = el("img"); r.preview.hidden = true; r.preview.alt = "";
          file.onchange = () => { const f = file.files[0]; if (!f) return; r.file = f; r.preview.src = URL.createObjectURL(f); r.preview.hidden = false };
          const bar = el("div", "lv-bar");
          bar.append(btn(T("lvUseImage"), () => file.click()), btn(T("lvLook"), () => r.file ? send(key, c.action, { images: [r.file], inputs: {} }) : (r.status.textContent = T("lvNoPicture"))), file);
          r.status = el("small", "lv-status", T("lvCameraHint"));
          r.box.append(el("b", "lv-title", c.label || T("lvCamera")), r.preview, bar, r.status);
        }
        return r.box;
      }
      function mic(c, key) {
        const r = reg[key] ||= { box: el("div", "lv lv-mic") };
        if (!r.built) {
          r.built = true; r.status = el("small", "lv-status", T("lvNoMic"));
          const bar = el("div", "lv-bar"); if (c.action) bar.append(btn(T("lvSend"), () => send(key, c.action, { inputs: { sound: JSON.stringify(features()) } })));
          r.box.append(el("b", "lv-title", c.label || T("lvMic")), bar, r.status);
        }
        return r.box;
      }
      function meter(cv) {
        const draw = () => {
          if (!cv.isConnected) return;
          if (A.ctx) { const f = features(), g = cv.getContext("2d"), w = cv.width = cv.clientWidth || 300, h = cv.height = 60, vals = Object.values(f.level_per_band_db), bw = w / vals.length; g.clearRect(0, 0, w, h); g.fillStyle = getComputedStyle(cv).color; vals.forEach((v, i) => { const y = Math.max(0, Math.min(1, (v + 100) / 80)); g.fillRect(i * bw + 2, h - y * h, bw - 4, y * h) }) }
          requestAnimationFrame(draw);
        };
        requestAnimationFrame(draw);
      }
      function sounds(c, key) {
        const r = reg[key] ||= { box: el("div", "lv lv-sounds"), list: el("ul", "lv-list") };
        const rows = (state && state[c.source]) || [];
        if (!r.built) {
          r.built = true;
          r.play = btn("▶ " + T("lvPlaySounds"), async () => { await audio().ctx.resume(); r.on = !r.on; r.play.textContent = (r.on ? "■ " : "▶ ") + T("lvPlaySounds"); if (r.on) playSounds(r.rows, true); else stopSounds() });
          r.box.append(el("b", "lv-title", c.label || T("lvSounds")), r.list, r.play);
        }
        const sig = JSON.stringify(rows);
        if (sig !== r.sig) { r.sig = sig; r.rows = rows; r.list.textContent = ""; rows.forEach(x => r.list.append(el("li", "", [x.label, x.kind, x.envelope, x.lowHz + "–" + x.highHz + " Hz", "level " + x.level].filter(Boolean).join(" · ")))); if (r.on) playSounds(rows, true) }
        if (!rows.length) r.list.append(el("li", "lv-status", T("lvNoSounds")));
        return r.box;
      }
      function output(c, key) {
        const r = reg[key] ||= { box: el("div", "lv lv-out"), meter: el("canvas", "lv-meter"), bars: el("div", "lv-gains") };
        const rows = (state && state[c.gains]) || [];
        if (!r.built) {
          r.built = true;
          const ab = btn(T("lvProcOn"), () => { A.processing = !A.processing; ab.textContent = A.processing ? T("lvProcOn") : T("lvProcOff"); applyMix() });
          const bar = el("div", "lv-bar"); bar.append(ab, ...(c.action ? [btn(T("lvSend"), () => send(key, c.action, { inputs: { sound: JSON.stringify(features()) } }))] : []));
          r.status = el("small", "lv-status", T("lvConnect"));
          r.box.append(el("b", "lv-title", c.label || T("lvOutputTitle")), bar, r.meter, r.bars, r.status); meter(r.meter);
        }
        if (A.ctx || rows.length) try { setGains(rows) } catch { }
        r.bars.textContent = "";
        rows.forEach(x => { const gdb = +x.gainDb || 0, d = el("div", "lv-gain"), bar = el("i"); bar.style.width = Math.min(100, Math.abs(gdb) * 2) + "%"; bar.className = gdb < 0 ? "cut" : "boost"; d.append(el("span", "", x.label || (x.lowHz + "–" + x.highHz + " Hz")), bar, el("small", "", (gdb > 0 ? "+" : "") + gdb + " dB")); r.bars.append(d) });
        return r.box;
      }
      function speak(c, key, text) {
        const r = reg[key] ||= { box: el("div", "lv lv-speak"), line: el("p") };
        if (!r.built) { r.built = true; r.box.append(r.line, btn("▶ " + T("lvSpeak"), () => say(r.text))) }
        if (text && text !== r.text) { if (r.text !== undefined && !readOnly) say(text); r.text = text; r.line.textContent = text }
        return r.box;
      }
      function drawing(c, key, ctx) {
        reg[key] ||= {};
        const box = el("div", "lv lv-draw"), svg = String((state && state[c.field]) || "");
        reg[key].box = box; if (reg[key].busy) box.classList.add("lv-wait");   // a redraw in the middle of a turn keeps waiting
        if (!svg.trim().startsWith("<svg")) { box.append(el("small", "lv-status", T("lvNoDrawing"))); return box }
        const doc = new DOMParser().parseFromString(svg, "image/svg+xml"), r = doc.documentElement;
        if (r.nodeName !== "svg") { box.append(el("small", "lv-status", T("lvNoDrawing"))); return box }
        r.querySelectorAll("script,foreignObject,iframe,image,use").forEach(n => n.remove());
        r.querySelectorAll("*").forEach(n => [...n.attributes].forEach(a => { if (/^on/i.test(a.name) || /javascript:|url\(/i.test(a.value) || /href$/i.test(a.name)) n.removeAttribute(a.name) }));
        r.removeAttribute("width"); r.removeAttribute("height"); const node = document.importNode(r, true);
        // Whatever in the picture carries data-intent can be touched: the intent goes to the LLM in its own words,
        // with the element's other data-* attributes. Text in the picture may name values in braces, like any text part.
        node.querySelectorAll("text,tspan").forEach(n => n.childNodes.forEach(t => { if (t.nodeType === 3 && t.nodeValue.includes("{")) t.nodeValue = ctx.tpl(t.nodeValue) }));
        node.querySelectorAll("[data-intent]").forEach(n => {
          const { intent, ...rest } = n.dataset;
          const go = e => { e.stopPropagation(); if (reg[key].busy) return; box.classList.add("lv-wait"); send(key, intent, { screen: ctx.screen, inputs: rest }).finally(() => reg[key].box.classList.remove("lv-wait")) };
          n.setAttribute("tabindex", "0"); n.setAttribute("role", "button"); n.classList.add("lv-touch");
          n.addEventListener("click", go); n.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(e) } });
        });
    if (readOnly) node.querySelectorAll(".lv-touch").forEach(n => n.classList.remove("lv-touch"));
        box.append(node); return box;
      }
      return {
        say, setReality() { applyMix() },
        render(c, ctx) {
          const key = ctx.screen + ":" + ctx.index;
          if (c.kind === "camera") return camera(c, key);
          if (c.kind === "mic") return mic(c, key);
          if (c.kind === "sounds") return sounds(c, key);
          if (c.kind === "output") return output(c, key);
          if (c.kind === "speak") return speak(c, key, ctx.tpl(c.text));
          if (c.kind === "drawing") return drawing(c, key, ctx);
          return null;
        },
        reset() { stopSounds(); for (const k of Object.keys(reg)) delete reg[k]; noiseBuf = null; if (A.ctx) { A.ctx.close(); A.ctx = null; A.eqKey = null } },
      };
    })();

    return {
      set(next = {}) {
        if ("ir" in next) ir = next.ir; if ("state" in next) state = next.state;
        if ("busy" in next) busy = next.busy || {}; if ("highlight" in next) highlight = next.highlight;
        if ("screens" in next) Object.assign(cur, next.screens);
        if ("only" in next) only = next.only;
        if (next.forms) for (const [screen, values] of Object.entries(next.forms)) forms[screen] = { ...(forms[screen] || {}), ...values };
        render();
      },
      toast, say: t => live.say(t),
      label(text) { for (const k of Object.keys(busy)) busy[k].label = text; render() },
      setReality(r) { R = r; live.setReality() },
      reset() { live.reset(); Object.keys(cur).forEach(k => delete cur[k]); Object.keys(forms).forEach(k => delete forms[k]) },
      devices: () => devices().map(d => ({ key: d.key, label: d.label, form: d.form, screen: cur[d.key] })),
    };
  }

  window.KuronFace = { createFace, faceIR, facePart, FRAME };
})();
