// Faces the LLM writes itself (a page of its own HTML and CSS) and the stage (things that move many times a
// second by reflexes the LLM declared). Plain script, shared by the dev UI and the browser version.
// Nothing here knows any idea: a page is shown as written, a stage runs the bodies and rules it was given,
// and whatever means something is sent back to the LLM in its own words.
(function () {
  const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c; if (x != null) n.textContent = x; return n };
  const shadows = new Set(), stages = new Set(), held = new Set();
  const NOT_INPUT = ["intent", "key", "point", "ahead", "drag", "dropIntent"];
  const plain = ds => { const d = { ...ds }; NOT_INPUT.forEach(k => delete d[k]); return d };
  const typing = e => { const t = e.composedPath ? e.composedPath()[0] : e.target; return t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) };
  const sameKey = (want, e) => want === e.key || want === e.code || String(want).toLowerCase() === String(e.key).toLowerCase() || (want === "Space" && e.key === " ");

  /* ---------- what can be touched: the same for a drawing and a page ----------
     data-intent           touching (or changing, for a field) sends that intent with the element's other data-*
     data-key="ArrowLeft"  that key does the same as touching it
     data-point            the place touched comes along as px, py (0–1 across the element)
     data-drag + data-drop-intent  dropping a dragged element on a target sends the target's drop intent with both */
  function wire(root, o) {
    root.querySelectorAll("[data-intent]").forEach(n => {
      const intent = n.dataset.intent, d = plain(n.dataset), item = n.__item || null, field = /^(INPUT|SELECT|TEXTAREA)$/.test(n.tagName);
      const go = e => {
        if (e) e.stopPropagation(); if (n.__dragged) { n.__dragged = false; return }
        const inputs = { ...o.inputs(), ...d };
        if (n.hasAttribute("data-point") && e && e.clientX != null) { const b = n.getBoundingClientRect(); inputs.px = +((e.clientX - b.left) / (b.width || 1)).toFixed(3); inputs.py = +((e.clientY - b.top) / (b.height || 1)).toFixed(3) }
        o.fire(intent, { screen: o.screen, item, inputs });
      };
      n.__go = go;
      if (field) { n.addEventListener("change", go); return }
      n.setAttribute("tabindex", "0"); if (!n.hasAttribute("role")) n.setAttribute("role", "button"); n.classList.add("lv-touch");
      n.addEventListener("click", go); n.addEventListener("keydown", e => { if (e.target === n && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); go(e) } });
      // what touching it would send, for looking ahead (only when nothing typed or pointed comes along)
      if (!n.hasAttribute("data-point") && !o.hasFields) n.setAttribute("data-ahead", JSON.stringify({ intent, screen: o.screen, item, inputs: d }));
    });
    root.querySelectorAll("[data-drag]").forEach(n => {
      n.style.touchAction = "none";
      n.addEventListener("pointerdown", e => {
        if (o.readOnly || e.button) return;
        const x0 = e.clientX, y0 = e.clientY, m = n.getScreenCTM ? n.getScreenCTM() : null, sx = m && n.ownerSVGElement ? m.a || 1 : 1, sy = m && n.ownerSVGElement ? m.d || 1 : 1, was = n.style.transform;
        let moved = false; try { n.setPointerCapture(e.pointerId) } catch { }
        const move = ev => { if (Math.abs(ev.clientX - x0) + Math.abs(ev.clientY - y0) > 4) moved = true; if (moved) n.style.transform = `translate(${(ev.clientX - x0) / sx}px,${(ev.clientY - y0) / sy}px)` };
        const up = ev => {
          n.removeEventListener("pointermove", move); n.removeEventListener("pointerup", up); n.removeEventListener("pointercancel", up);
          if (!moved) return; n.__dragged = true; setTimeout(() => n.__dragged = false, 0);
          const pe = n.style.pointerEvents; n.style.pointerEvents = "none";
          const under = (n.getRootNode().elementFromPoint || document.elementFromPoint).call(n.getRootNode(), ev.clientX, ev.clientY), target = under && under.closest && under.closest("[data-drop-intent]");
          n.style.pointerEvents = pe; n.style.transform = was;
          if (target && target !== n) o.fire(target.dataset.dropIntent, { screen: o.screen, item: target.__item || null, inputs: { ...o.inputs(), ...plain(target.dataset), dragged: { ...plain(n.dataset), ...(n.__item ? { item: n.__item } : {}) } } });
        };
        n.addEventListener("pointermove", move); n.addEventListener("pointerup", up); n.addEventListener("pointercancel", up);
      });
    });
  }

  document.addEventListener("keydown", e => {
    if (typing(e) || e.metaKey || e.ctrlKey || e.altKey) return;
    let used = false;
    if (!e.repeat) for (const S of stages) if (S.live()) used = S.key(e) || used;
    held.add(e.key); held.add(e.code);
    for (const S of stages) if (S.live() && S.wants(e)) used = true;
    if (!used && !e.repeat) for (const root of [document, ...shadows]) {
      const n = [...root.querySelectorAll("[data-key]")].find(x => x.__go && x.isConnected && sameKey(x.dataset.key, e));
      if (n) { n.__go(); used = true; break }
    }
    if (used) e.preventDefault();
  });
  document.addEventListener("keyup", e => { held.delete(e.key); held.delete(e.code) });
  window.addEventListener("blur", () => held.clear());

  /* ---------- keep what the LLM wrote from reaching outside the screen ---------- */
  function clean(root) {
    root.querySelectorAll("script,iframe,object,embed,link,meta,base,frame,frameset,applet,audio,video,source,track").forEach(n => n.remove());
    root.querySelectorAll("*").forEach(n => {
      for (const a of [...n.attributes]) {
        const name = a.name.toLowerCase(), v = a.value;
        if (name.startsWith("on") || ["srcdoc", "formaction", "action", "ping", "target"].includes(name)) n.removeAttribute(a.name);
        else if (["href", "xlink:href", "src", "srcset", "poster", "background"].includes(name) && !/^(#|data:image\/)/i.test(v.trim())) n.removeAttribute(a.name);
        else if (name === "style" && /url\s*\(|@import|expression\s*\(/i.test(v)) n.setAttribute("style", v.replace(/url\s*\([^)]*\)/gi, "none").replace(/@import[^;]*;?/gi, ""));
      }
    });
    root.querySelectorAll("style").forEach(s => s.textContent = s.textContent.replace(/@import[^;]*;?/gi, "").replace(/url\s*\(\s*['"]?(?!data:image\/|#)[^)]*\)/gi, "none"));
  }

  window.KuronParts = function ({ send, tpl, rows, getState, T = k => k, readOnly = false }) {
    const reg = {};
    const fire = (key, intent, payload) => {
      const r = reg[key]; if (!intent || readOnly) return Promise.resolve();
      r.waiting = (r.waiting || 0) + 1; r.box.classList.add("lv-wait");
      return Promise.resolve(send(key, intent, payload)).catch(() => { }).finally(() => { if (!--r.waiting) r.box.classList.remove("lv-wait") });
    };
    // values in braces, in text and in attributes (never inside a style element)
    const fill = (node, row) => {
      for (const n of [...node.childNodes]) {
        if (n.nodeType === 3) { if (n.nodeValue.includes("{")) n.nodeValue = tpl(n.nodeValue, row) }
        else if (n.nodeType === 1 && !/^(style|template)$/i.test(n.tagName)) { for (const a of [...n.attributes]) if (a.value.includes("{")) a.value = tpl(a.value, row); fill(n, row) }
      }
    };

    /* ---------- page: a screen in the LLM's own HTML and CSS ---------- */
    function page(c, key, ctx) {
      const r = reg[key] ||= { box: el("div", "pg"), values: {} };
      if (!r.root) { r.root = r.box.attachShadow({ mode: "open" }); shadows.add(r.root); r.root.addEventListener("submit", e => e.preventDefault()) }
      const html = String((getState() || {})[c.field] || ""), active = r.root.activeElement, focus = active && active.getAttribute("name");
      r.root.textContent = "";
      if (!html.trim()) { r.root.append(el("small", "", T("lvNoDrawing"))); return r.box }
      const doc = new DOMParser().parseFromString(html, "text/html"), body = doc.body;
      doc.head.querySelectorAll("style").forEach(s => body.prepend(s));
      fill(body, null);
      // <template data-each="collection" data-where='{"property":value}' data-sort="property" data-empty="…"> is written once per item
      body.querySelectorAll("template[data-each]").forEach(t => {
        const d = t.dataset; let where = null; try { where = d.where ? JSON.parse(d.where) : null } catch { }
        const [wk, wv] = where && typeof where === "object" ? Object.entries(where)[0] || [] : [];
        const list = rows({ source: d.each, whereField: wk, whereValue: wk === undefined ? undefined : String(wv), sortField: d.sort, sortValues: d.sortValues ? d.sortValues.split("|") : [], sortDesc: d.sortDirection === "descending" });
        const out = doc.createDocumentFragment();
        for (const { item } of list) {
          const f = t.content.cloneNode(true); fill(f, item);
          f.querySelectorAll("[data-intent],[data-drop-intent],[data-drag]").forEach(n => n.__item = item && typeof item === "object" ? { collection: d.each, ...item } : null);
          out.append(f);
        }
        if (!list.length && d.empty) out.append(doc.createTextNode(d.empty));
        t.replaceWith(out);
      });
      clean(body);
      const base = el("style"); base.textContent = ":host{display:block;contain:layout paint}[data-intent]:not(input):not(select):not(textarea){cursor:pointer}[data-drag]{cursor:grab}";
      r.root.append(base, ...[...body.childNodes].map(n => document.adoptNode(n)));
      const fields = [...r.root.querySelectorAll("input[name],select[name],textarea[name]")], val = f => f.type === "checkbox" ? f.checked : f.value;
      fields.forEach(f => {
        if (r.values[f.name] !== undefined) { if (f.type === "checkbox") f.checked = !!r.values[f.name]; else f.value = r.values[f.name] } else r.values[f.name] = val(f);
        f.addEventListener("input", () => r.values[f.name] = val(f)); f.disabled = f.disabled || readOnly;
      });
      const inputs = () => Object.fromEntries(fields.map(f => [f.name, r.values[f.name]]));
      wire(r.root, { screen: ctx.screen, inputs, hasFields: fields.length > 0, readOnly,
        fire: (intent, payload) => fire(key, intent, payload).then(() => { for (const f of r.root.querySelectorAll("input[name],textarea[name]")) if (!/^(checkbox|radio|range|color)$/.test(f.type)) { r.values[f.name] = ""; f.value = "" } }) });
      if (focus) { const f = r.root.querySelector(`[name="${CSS.escape(focus)}"]`); if (f) f.focus({ preventScroll: true }) }
      return r.box;
    }

    /* ---------- stage: bodies that move every frame and the reflexes the LLM declared for them ---------- */
    const num = v => Array.isArray(v) ? +v[0] + Math.random() * (+v[1] - +v[0]) : +v || 0;
    const is = (b, sel) => sel != null && (b.id === sel || b.tags.includes(sel));
    function make(b, S) {
      const size = num(b.size) || 24, r = num(b.r), text = b.text == null ? null : String(b.text);
      const w = num(b.w) || (r ? r * 2 : b.shape === "text" ? size * Math.max(1, [...(text || "")].length) * 0.9 : 20), h = num(b.h) || (r ? r * 2 : b.shape === "text" ? size * 1.2 : 20);
      const o = { id: b.id || "", tags: [].concat(b.tags || []), shape: b.shape || "rect", x: num(b.x), y: num(b.y), w, h, vx: num(b.vx), vy: num(b.vy), ax: num(b.ax), ay: num(b.ay),
        fill: b.fill || "#8aa", stroke: b.stroke || null, text, size, edges: b.edges || "none", follow: b.follow || null, keys: b.keys || null, life: num(b.life), born: S.t, radius: num(b.radius), on: {} };
      o.base = { vx: o.vx, vy: o.vy }; return o;
    }
    const brief = b => b ? { id: b.id, tags: b.tags, x: Math.round(b.x), y: Math.round(b.y), ...(b.text ? { text: b.text } : {}) } : undefined;
    function start(r, key, def) {
      if (r.sim) stages.delete(r.sim);
      cancelAnimationFrame(r.raf); r.raf = 0; r.sim = null; r.note.textContent = "";
      if (!def || typeof def !== "object") return;
      const W = +def.width || 400, H = +def.height || 300;
      r.canvas.width = W * 2; r.canvas.height = H * 2; r.canvas.style.aspectRatio = W + " / " + H;
      const S = r.sim = { W, H, def, t: 0, bodies: [], counters: { ...(def.counters || {}) }, clock: {}, side: {}, done: new Set(), contacts: new Set(), paused: false, pointer: null, telling: 0, rules: Array.isArray(def.rules) ? def.rules : [] };
      (def.bodies || []).forEach(b => S.bodies.push(make(b, S)));
      S.live = () => r.sim === S && r.box.isConnected;
      S.wants = e => S.bodies.some(b => b.keys && Object.keys(b.keys).some(k => sameKey(k, e))) || S.rules.some(x => x.when === "key" && sameKey(x.key, e));
      S.key = e => {
        if (S.paused) return false; let used = false;
        for (const b of S.bodies) if (b.keys) for (const [k, o] of Object.entries(b.keys)) if (o && o.push && sameKey(k, e)) { if (o.push.vx !== undefined) b.vx = num(o.push.vx); if (o.push.vy !== undefined) b.vy = num(o.push.vy); used = true }
        S.rules.forEach(x => { if (x.when === "key" && sameKey(x.key, e)) { act(r, key, S, x, {}); used = true } });
        return used;
      };
      stages.add(S);
      if (def.camera && !readOnly) camera(r); else if (r.stream) { r.stream.getTracks().forEach(t => t.stop()); r.stream = null; r.video.hidden = true }
      let last = performance.now();
      const frame = now => { if (r.sim !== S) return; r.raf = requestAnimationFrame(frame); const dt = Math.min(0.05, (now - last) / 1000); last = now; if (!r.box.isConnected) return; if (!S.paused && !readOnly) step(r, key, S, dt); paint(r, S) };
      r.raf = requestAnimationFrame(frame); paint(r, S);
    }
    async function camera(r) {
      if (r.stream) return;
      try { r.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false }); r.video.srcObject = r.stream; r.video.hidden = false; await r.video.play().catch(() => { }) }
      catch (e) { r.note.textContent = T("error") + ": " + e.message }
    }
    function picture(r) {
      const v = r.video; if (!r.stream || !v.videoWidth) return null;
      const c = el("canvas"), w = Math.min(640, v.videoWidth); c.width = w; c.height = Math.round(w * v.videoHeight / v.videoWidth); c.getContext("2d").drawImage(v, 0, 0, c.width, c.height); return c.toDataURL("image/jpeg", 0.7);
    }
    function act(r, key, S, rule, hit) {
      const who = sel => sel === "a" || sel == null ? (hit.a ? [hit.a] : []) : sel === "b" ? (hit.b ? [hit.b] : []) : S.bodies.filter(b => is(b, sel));
      for (const a of rule.then || []) {
        if (a.do === "remove") who(a.who).forEach(b => b.gone = true);
        else if (a.do === "stop") who(a.who).forEach(b => { b.vx = b.vy = 0; b.base = { vx: 0, vy: 0 } });
        else if (a.do === "set") who(a.who).forEach(b => { for (const [k, v] of Object.entries(a.props || {})) { b[k] = typeof b[k] === "number" ? num(v) : v; if (k === "vx" || k === "vy") b.base[k] = b[k] } });
        else if (a.do === "bounce") who(a.who).forEach(b => {
          const other = b === hit.a ? hit.b : hit.a;
          if (!other) { if (hit.side === "left" || hit.side === "right") b.vx = -b.vx; else b.vy = -b.vy; return }
          const ox = (b.w + other.w) / 2 - Math.abs(b.x - other.x), oy = (b.h + other.h) / 2 - Math.abs(b.y - other.y);
          if (ox < oy) { b.vx = Math.sign(b.x - other.x || 1) * Math.abs(b.vx || other.vx); b.x += Math.sign(b.x - other.x || 1) * ox } else { b.vy = Math.sign(b.y - other.y || 1) * Math.abs(b.vy || other.vy); b.y += Math.sign(b.y - other.y || 1) * oy }
        });
        else if (a.do === "spawn" && a.body && S.bodies.length < 300) S.bodies.push(make(a.body, S));
        else if (a.do === "count") S.counters[a.counter] = (+S.counters[a.counter] || 0) + (a.by === undefined ? 1 : num(a.by));
        else if (a.do === "pause") S.paused = true;
        else if (a.do === "resume") S.paused = false;
        else if (a.do === "tell" && a.intent && (a.pause || S.telling < 1)) {
          // the only way out of the stage: something that means something happened, in the LLM's own words
          const img = a.picture ? picture(r) : null; S.telling++; if (a.pause) S.paused = true;
          fire(key, a.intent, { screen: r.screen, item: null, inputs: { counters: { ...S.counters }, seconds: Math.round(S.t), ...(hit.a ? { a: brief(hit.a) } : {}), ...(hit.b ? { b: brief(hit.b) } : {}), ...(hit.side ? { edge: hit.side } : {}) }, ...(img ? { images: [img] } : {}) })
            .finally(() => { S.telling--; if (a.pause && r.sim === S) S.paused = false });
        }
      }
    }
    function step(r, key, S, dt) {
      S.t += dt;
      const run = (when, test, hit) => S.rules.forEach(x => { if (x.when === when && test(x)) act(r, key, S, x, hit) });
      for (const b of S.bodies) {
        if (b.keys) for (const ax of ["vx", "vy"]) {
          let set; for (const [k, o] of Object.entries(b.keys)) if (o && o.set && o.set[ax] !== undefined && held.has(k === "Space" ? " " : k)) set = +o.set[ax];
          if (set !== undefined) { b[ax] = set; b.on[ax] = true } else if (b.on[ax]) { b[ax] = b.base[ax]; b.on[ax] = false }
        }
        if (b.follow && S.pointer) { if (b.follow !== "pointer-y") b.x = S.pointer.x; if (b.follow !== "pointer-x") b.y = S.pointer.y }
        b.vx += b.ax * dt; b.vy += b.ay * dt; b.x += b.vx * dt; b.y += b.vy * dt;
        if (b.life && S.t - b.born > b.life) b.gone = true;
        const L = b.x - b.w / 2, R = b.x + b.w / 2, U = b.y - b.h / 2, D = b.y + b.h / 2;
        // a body that starts outside (something about to fall or flow in) has not left: it leaves once it has been in, or is heading away
        const out = R < 0 ? "left" : L > S.W ? "right" : D < 0 ? "top" : U > S.H ? "bottom" : null; if (!out) b.seen = true;
        const away = out && (b.seen || (out === "left" && b.vx < 0) || (out === "right" && b.vx > 0) || (out === "top" && b.vy < 0) || (out === "bottom" && b.vy > 0));
        const side = b.edges === "leave" ? (away ? out : null) : out && !b.seen ? null : (L <= 0 ? "left" : R >= S.W ? "right" : U <= 0 ? "top" : D >= S.H ? "bottom" : null);
        if (side && b.edges === "bounce") { if (side === "left") { b.x = b.w / 2; b.vx = Math.abs(b.vx) } if (side === "right") { b.x = S.W - b.w / 2; b.vx = -Math.abs(b.vx) } if (side === "top") { b.y = b.h / 2; b.vy = Math.abs(b.vy) } if (side === "bottom") { b.y = S.H - b.h / 2; b.vy = -Math.abs(b.vy) } }
        if (side && b.edges === "stop") { b.x = Math.max(b.w / 2, Math.min(S.W - b.w / 2, b.x)); b.y = Math.max(b.h / 2, Math.min(S.H - b.h / 2, b.y)); if (side === "left" || side === "right") b.vx = 0; else b.vy = 0 }
        if (b.edges === "wrap") { if (R < 0) b.x = S.W + b.w / 2; else if (L > S.W) b.x = -b.w / 2; if (D < 0) b.y = S.H + b.h / 2; else if (U > S.H) b.y = -b.h / 2 }
        if (side && b.edges === "leave") b.gone = true;
        if (side && b.edges !== "wrap" && b.on.edge !== side) run("edge", x => is(b, x.a) && (!x.edge || x.edge === "any" || x.edge === side), { a: b, side });
        b.on.edge = side;
      }
      const touching = new Set();
      for (const x of S.rules) if (x.when === "touch") for (const A of S.bodies) if (!A.gone && is(A, x.a)) for (const B of S.bodies) {
        if (B === A || B.gone || !is(B, x.b) || Math.abs(A.x - B.x) * 2 >= A.w + B.w || Math.abs(A.y - B.y) * 2 >= A.h + B.h) continue;
        const k = S.rules.indexOf(x) + ":" + S.bodies.indexOf(A) + ":" + S.bodies.indexOf(B); touching.add(k + "#" + A.born + "#" + B.born);
        if (!S.contacts.has(k + "#" + A.born + "#" + B.born)) act(r, key, S, x, { a: A, b: B });
      }
      S.contacts = touching;
      S.rules.forEach((x, i) => {
        if (x.when === "every" && +x.seconds > 0) { S.clock[i] = (S.clock[i] || 0) + dt; if (S.clock[i] >= +x.seconds) { S.clock[i] = 0; act(r, key, S, x, {}) } }
        if (x.when === "count" && !S.done.has(i)) {
          // "reaches" from whichever side the counter started on: lives falling to 0 as much as a score rising to 100
          const v = +S.counters[x.counter] || 0, want = +x.reaches; if (!S.side[i]) S.side[i] = Math.sign(want - v);
          if (S.side[i] && (S.side[i] > 0 ? v >= want : v <= want)) { S.done.add(i); act(r, key, S, x, {}) }
        }
      });
      if (S.bodies.some(b => b.gone)) S.bodies = S.bodies.filter(b => !b.gone);
    }
    function paint(r, S) {
      const g = r.canvas.getContext("2d"); g.setTransform(2, 0, 0, 2, 0, 0); g.clearRect(0, 0, S.W, S.H);
      if (S.def.background && !(S.def.camera && r.stream)) { g.fillStyle = S.def.background; g.fillRect(0, 0, S.W, S.H) }
      const words = t => tpl(String(t).replace(/\{([^{}]+)\}/g, (m, k) => S.counters[k.trim()] !== undefined ? S.counters[k.trim()] : m), null);
      for (const b of S.bodies) {
        g.fillStyle = b.fill; g.strokeStyle = b.stroke || "transparent"; g.lineWidth = 3;
        if (b.shape === "circle") { g.beginPath(); g.ellipse(b.x, b.y, b.w / 2, b.h / 2, 0, 0, Math.PI * 2); g.fill(); if (b.stroke) g.stroke() }
        else if (b.shape === "rect") { g.beginPath(); if (g.roundRect) g.roundRect(b.x - b.w / 2, b.y - b.h / 2, b.w, b.h, b.radius || 0); else g.rect(b.x - b.w / 2, b.y - b.h / 2, b.w, b.h); if (b.fill !== "none") g.fill(); if (b.stroke) g.stroke() }
        if (b.text != null) { g.fillStyle = b.shape === "text" ? b.fill : (b.textFill || "#fff"); g.font = `${b.size}px system-ui, sans-serif`; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(words(b.text), b.x, b.y) }
      }
      if (S.paused && S.telling) { g.fillStyle = "rgba(0,0,0,.35)"; g.fillRect(0, 0, S.W, S.H) }
    }
    function stage(c, key, ctx) {
      const r = reg[key] ||= { box: el("div", "stg"), canvas: el("canvas"), video: el("video"), note: el("small", "stg-note") };
      if (!r.built) {
        r.built = true; r.video.muted = true; r.video.playsInline = true; r.video.hidden = true; r.box.append(r.video, r.canvas, r.note);
        const at = e => { const b = r.canvas.getBoundingClientRect(), S = r.sim; return S ? { x: (e.clientX - b.left) / b.width * S.W, y: (e.clientY - b.top) / b.height * S.H } : null };
        r.canvas.style.touchAction = "none";
        r.canvas.addEventListener("pointermove", e => { if (r.sim) r.sim.pointer = at(e) });
        r.canvas.addEventListener("pointerdown", e => {
          const S = r.sim, p = at(e); if (!S || !p || S.paused || readOnly) return; S.pointer = p;
          S.rules.forEach(x => { if (x.when !== "tap") return; if (x.a == null) return act(r, key, S, x, {}); const b = S.bodies.find(b => is(b, x.a) && Math.abs(b.x - p.x) * 2 <= b.w && Math.abs(b.y - p.y) * 2 <= b.h); if (b) act(r, key, S, x, { a: b }) });
        });
      }
      r.screen = ctx.screen;
      const def = (getState() || {})[c.field], json = JSON.stringify(def || null);
      if (json !== r.json || (r.sim && !r.raf)) { r.json = json; start(r, key, def) }
      return r.box;
    }

    return {
      page, stage,
      // what can be touched inside pages right now (their shadow roots are not reached from outside)
      candidates() { const out = []; for (const k of Object.keys(reg)) { const r = reg[k]; if (r.root && r.box.isConnected) r.root.querySelectorAll("[data-ahead]").forEach(n => out.push(n.getAttribute("data-ahead"))) } return out },
      reset() { for (const k of Object.keys(reg)) { const r = reg[k]; cancelAnimationFrame(r.raf); if (r.sim) stages.delete(r.sim); if (r.stream) r.stream.getTracks().forEach(t => t.stop()); if (r.root) shadows.delete(r.root); delete reg[k] } },
    };
  };
  window.KuronParts.wire = wire;
  window.KuronParts.stages = stages;   // the running stages, for looking at them while developing
})();
