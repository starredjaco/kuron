// kuron in the browser: the world, the hands and the turns of an LLM with hands, run through the
// Claude artifact's `sample` capability (the page's functions are the hands). Nothing here knows any idea.
(function () {
  const clone = x => JSON.parse(JSON.stringify(x));
  const empty = () => ({ name: "", idea: "", brief: "", lang: "en", values: {}, collections: {}, screens: [], timers: [], checks: [], reality: null, output: { sounds: [], bands: [] }, nextId: 1 });
  const LANG_NAMES = { ja: "Japanese", en: "English", zh: "Chinese", ko: "Korean", es: "Spanish", fr: "French", de: "German", pt: "Portuguese" };
  const langName = c => LANG_NAMES[c] || c;

  /* ---------- the world: whatever the LLM decides to keep ---------- */
  class World {
    constructor(data = null) { this.data = { ...empty(), ...(data ? clone(data) : {}) }; this.listeners = new Set() }
    on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn) }
    changed(what) { for (const f of this.listeners) f(what) }
    copy() { return new World(this.data) }
    view() { return { ...clone(this.data.values), ...clone(this.data.collections), __sounds: clone(this.data.output.sounds), __bands: clone(this.data.output.bands) } }
    overview({ samples = 2 } = {}) {
      const d = this.data;
      return { name: d.name, brief: d.brief, values: d.values,
        collections: Object.fromEntries(Object.entries(d.collections).map(([k, v]) => [k, { count: v.length, properties: [...new Set(v.flatMap(x => Object.keys(x)))], sample: v.slice(-samples) }])),
        screens: d.screens.map(s => ({ name: s.name, device: s.device, intents: [...new Set(s.parts.flatMap(p => [p.intent, ...(p.row || []).map(r => r.intent)]).filter(Boolean))] })),
        timers: d.timers, output: d.output, checks: d.checks.map(c => ({ name: c.name, steps: c.steps, expect: c.expect })) };
    }
    query({ collection, where = null, ids = null, limit = 50 }) {
      const list = this.data.collections[collection];
      if (!list) throw new Error(`no collection "${collection}". Existing: ${Object.keys(this.data.collections).join(", ") || "(none)"}`);
      let items = list;
      if (ids && ids.length) items = items.filter(x => ids.includes(x.id));
      if (where && typeof where === "object") items = items.filter(x => Object.entries(where).every(([k, v]) => JSON.stringify(x[k]) === JSON.stringify(v) || String(x[k]) === String(v)));
      return items.slice(0, Math.max(1, Math.min(500, limit)));
    }
    // One batch of changes. Every problem is reported back in words; nothing is guessed.
    apply({ changes = [], values = null }) {
      const d = this.data, done = [], problems = [];
      for (const [i, c] of changes.entries()) {
        const where = `change ${i + 1} (${c.op} ${c.collection || ""})`;
        if (!c.collection) { problems.push(where + ": collection is missing"); continue }
        const list = d.collections[c.collection] ||= [];
        if (c.op === "add") {
          if (!c.item || typeof c.item !== "object") { problems.push(where + ": item must be an object"); continue }
          const item = { ...c.item, id: c.item.id && !list.some(x => x.id === c.item.id) ? String(c.item.id) : "i" + d.nextId++ };
          list.push(item); done.push({ op: "add", collection: c.collection, id: item.id });
        } else if (c.op === "update") {
          const it = list.find(x => x.id === c.id);
          if (!it) { problems.push(where + `: no item with id "${c.id}"`); continue }
          if (!c.set || typeof c.set !== "object") { problems.push(where + ": set must be an object"); continue }
          Object.assign(it, c.set, { id: it.id }); done.push({ op: "update", collection: c.collection, id: it.id });
        } else if (c.op === "remove") {
          const n = list.length; d.collections[c.collection] = list.filter(x => x.id !== c.id);
          if (d.collections[c.collection].length === n) problems.push(where + `: no item with id "${c.id}"`); else done.push({ op: "remove", collection: c.collection, id: c.id });
        } else if (c.op === "order") {
          if (!Array.isArray(c.ids)) { problems.push(where + ": ids must list the item ids in the new order"); continue }
          const unknown = c.ids.filter(id => !list.some(x => x.id === id));
          if (unknown.length) { problems.push(where + `: no item with id ${unknown.map(x => `"${x}"`).join(", ")}; nothing was reordered`); continue }
          const pos = new Map(c.ids.map((id, k) => [id, k]));
          list.sort((a, b) => (pos.has(a.id) ? pos.get(a.id) : 1e9) - (pos.has(b.id) ? pos.get(b.id) : 1e9)); done.push({ op: "order", collection: c.collection });
        } else problems.push(where + ': op must be "add", "update", "remove" or "order"');
      }
      if (values && typeof values === "object") for (const [k, v] of Object.entries(values)) { d.values[k] = v; done.push({ op: "value", name: k }) }
      if (done.length) this.changed("state");
      return { done, problems };
    }
  }

  /* ---------- the hands: each checks only the shape of what it is given and answers in words ---------- */
  const CONTRACTS = {
    sounds: { type: "object", properties: {
      label: { type: "string", description: "what this sound is" }, kind: { type: "string", enum: ["noise", "hum", "tone", "siren", "beep", "voice"] },
      lowHz: { type: "number", description: "lowest frequency, 20–16000" }, highHz: { type: "number", description: "highest frequency, above lowHz" },
      level: { type: "number", description: "loudness from 0 (silent) to 1 (very loud)" }, startSec: { type: "number" }, durationSec: { type: "number" },
      envelope: { type: "string", enum: ["steady", "approach", "away", "pulse"] }, words: { type: "string", description: "for kind voice: the words spoken; otherwise empty" } },
      required: ["label", "kind", "lowHz", "highHz", "level", "startSec", "durationSec", "envelope", "words"] },
    output: { type: "object", properties: { label: { type: "string" }, lowHz: { type: "number" }, highHz: { type: "number" },
      gainDb: { type: "number", description: "gain of this band in dB: 0 = unchanged, negative = suppress (down to -60), positive = boost (up to +24)" } },
      required: ["label", "lowHz", "highHz", "gainDb"] },
  };
  const KINDS = ["heading", "text", "metric", "input", "select", "button", "list", "table", "badge", "chart", "image", "divider", "camera", "mic", "sounds", "output", "speak", "drawing"];
  const ROW_KINDS = ["heading", "text", "badge", "button", "metric"];
  const partProps = {
    kind: { type: "string", enum: KINDS },
    text: { type: "string", description: "visible text; insert a value by its name in braces, e.g. {clock}; counts as {count:collection} or {count:collection|property=value}; inside a row {property}" },
    label: { type: "string" }, name: { type: "string", description: "input/select: the name its value is sent under" },
    inputType: { type: "string", enum: ["text", "number", "date", "longtext"] }, options: { type: "array", items: { type: "string" } },
    intent: { type: "string", description: "button / camera / mic / output: what happens, in plain words; it is sent to you when used" },
    goto: { type: "string", description: "button: screen to show after it" },
    collection: { type: "string", description: "list / table / chart: the collection shown" },
    where: { type: "object", description: "list: show only items whose property equals the value, e.g. {\"done\": false}" },
    order: { type: "object", properties: { property: { type: "string" }, values: { type: "array", items: { type: "string" }, description: "word values in display order (first shown first)" }, direction: { type: "string", enum: ["ascending", "descending"] } } },
    columns: { type: "array", items: { type: "string" } }, empty: { type: "string" },
    every: { type: "number", description: "camera / mic / output: seconds between automatic sends (0 = only on a button)" },
    value: { type: "string", description: "drawing: the value that holds the SVG; elements in it with data-intent can be touched" },
  };
  const rowPart = { type: "object", properties: { ...partProps, kind: { type: "string", enum: ROW_KINDS } }, required: ["kind"] };
  const part = { type: "object", properties: { ...partProps, row: { type: "array", items: rowPart } }, required: ["kind"] };
  const ok = t => ({ text: typeof t === "string" ? t : JSON.stringify(t) }), fail = t => ({ text: t, isError: true });

  const HANDS = [
    { name: "overview", roles: ["setup", "event", "request"], description: "See the whole world briefly: the brief, values, each collection's count, properties and latest items, screens and their intents, timers.",
      input: { type: "object", properties: {} }, run: ({ world }) => ok(world.overview()) },
    { name: "query", roles: ["setup", "event", "request"], description: "Read items of one collection, optionally only those whose properties equal the given values, or by ids.",
      input: { type: "object", properties: { collection: { type: "string" }, where: { type: "object" }, ids: { type: "array", items: { type: "string" } }, limit: { type: "number" } }, required: ["collection"] },
      run: ({ world }, a) => ok(world.query(a)) },
    { name: "apply", roles: ["setup", "event", "request"], description: "Change the world in one batch. changes: {op:\"add\", collection, item} | {op:\"update\", collection, id, set} | {op:\"remove\", collection, id} | {op:\"order\", collection, ids}. values: named single values to set. New collections are created by adding to them. Returns what was done and any problems to fix.",
      input: { type: "object", properties: { changes: { type: "array", items: { type: "object", properties: { op: { type: "string", enum: ["add", "update", "remove", "order"] }, collection: { type: "string" }, id: { type: "string" }, item: { type: "object" }, set: { type: "object" }, ids: { type: "array", items: { type: "string" } } }, required: ["op", "collection"] } }, values: { type: "object" } } },
      run: ({ world }, a) => { const r = world.apply(a); return r.problems.length && !r.done.length ? fail(JSON.stringify(r)) : ok(r) } },
    { name: "define_screen", roles: ["setup", "request", "event"], description: "Create or replace one screen of the system. device: what it runs on, in words (e.g. reception tablet). frame: how it is drawn. Parts are drawn top to bottom. A screen stays as defined until you define it again.",
      input: { type: "object", properties: { name: { type: "string" }, device: { type: "string" }, frame: { type: "string", enum: ["website", "phone", "desktop", "iot", "terminal", "watch", "panel"] }, parts: { type: "array", items: part } }, required: ["name", "device", "frame", "parts"] },
      run: ({ world }, a) => {
        const bad = (a.parts || []).filter(p => !KINDS.includes(p.kind)).map(p => p.kind);
        if (bad.length) return fail(`unknown part kinds: ${bad.join(", ")}. Use: ${KINDS.join(", ")}`);
        const NEED = { heading: ["text"], text: ["text"], metric: ["label", "text"], badge: ["text"], button: ["text"], input: ["name"], select: ["name", "options"], list: ["collection"], table: ["collection"], chart: ["collection"], drawing: ["value"], speak: ["text"], image: ["text"] };
        const missing = [];
        const look = (list, where) => list.forEach((p, i) => { for (const k of NEED[p.kind] || []) if (p[k] === undefined || p[k] === "") missing.push(`${where}[${i}] ${p.kind} needs ${k}`); if (p.where && typeof p.where === "object" && Object.keys(p.where).length !== 1) missing.push(`${where}[${i}] ${p.kind} where must name exactly one property (it has ${Object.keys(p.where).length})`); if (p.row) look(p.row, `${where}[${i}].row`) });
        look(a.parts || [], "parts");
        if (missing.length) return fail("not saved, fix and call again: " + missing.slice(0, 12).join("; "));
        const d = world.data, s = { name: a.name, device: a.device, frame: a.frame, parts: a.parts }, i = d.screens.findIndex(x => x.name === a.name);
        if (i >= 0) d.screens[i] = s; else d.screens.push(s);
        world.changed("screens"); return ok(`screen "${a.name}" saved with ${a.parts.length} parts`);
      } },
    { name: "notify", roles: ["event", "request"], description: "Show a short message to the person using the system.",
      input: { type: "object", properties: { text: { type: "string" } }, required: ["text"] }, run: ({ emit }, a) => { emit({ type: "notice", text: a.text }); return ok("shown") } },
    { name: "listen", roles: ["event"], description: "Hear what came with this event from the earphone output: loudness, level per band, rising bands, words heard.",
      input: { type: "object", properties: {} }, run: ({ turn }) => turn.sound ? ok(turn.sound) : fail("no sound came with this event") },
    { name: "play_sounds", roles: ["setup", "event", "request"], description: "Set the test sounds the sounds part plays (replaces the list). Each sound follows the exact shape.",
      input: { type: "object", properties: { sounds: { type: "array", items: CONTRACTS.sounds } }, required: ["sounds"] },
      run: ({ world }, a) => { world.data.output.sounds = a.sounds; world.changed("state"); return ok(`${a.sounds.length} test sounds set`) } },
    { name: "shape_sound", roles: ["setup", "event", "request"], description: "Set the bands the output part applies to the sound going to the earphones (replaces the list).",
      input: { type: "object", properties: { bands: { type: "array", items: CONTRACTS.output } }, required: ["bands"] },
      run: ({ world }, a) => { world.data.output.bands = a.bands; world.changed("state"); return ok(`${a.bands.length} bands set`) } },
    { name: "speak", roles: ["event", "request"], description: "Say something aloud through the person's speakers or earphones.",
      input: { type: "object", properties: { text: { type: "string" } }, required: ["text"] }, run: ({ emit }, a) => { emit({ type: "speak", text: a.text }); return ok("spoken") } },
    { name: "draw", roles: ["setup", "event", "request"], description: "Draw a picture as SVG into a named value; a drawing part shows it. The picture can be the face itself (a board, a map, cards, a scene): give any element data-intent=\"what touching it means, in plain words\" and touching it sends you that intent, with the element's other data-* attributes as inputs (e.g. data-cell=\"b3\"). Text may name values in braces, e.g. {score}, so it follows the world without redrawing. It may move (SVG animate, CSS in a style element). No scripts, no outside images.",
      input: { type: "object", properties: { value: { type: "string" }, svg: { type: "string" } }, required: ["value", "svg"] },
      run: ({ world }, a) => { if (!/^\s*<svg[\s>]/.test(a.svg)) return fail("svg must start with <svg"); world.data.values[a.value] = a.svg; world.changed("state"); return ok("drawn") } },
    { name: "set_timer", roles: ["setup", "request"], description: "Run an intent every N seconds while the system is open (e.g. time passing, a sensor drifting). Same name replaces; everySec 0 removes; otherwise at least 5.",
      input: { type: "object", properties: { name: { type: "string" }, everySec: { type: "number" }, intent: { type: "string" } }, required: ["name", "everySec", "intent"] },
      run: ({ world }, a) => { if (a.everySec > 0 && a.everySec < 5) return fail("everySec must be 0 (remove) or at least 5; nothing was set"); const d = world.data; d.timers = d.timers.filter(t => t.name !== a.name); if (a.everySec > 0) d.timers.push({ name: a.name, every: a.everySec, intent: a.intent }); world.changed("timers"); return ok(a.everySec > 0 ? "timer set" : "timer removed") } },
    { name: "write_brief", roles: ["setup", "request"], description: "Write the system's name and its brief: how it behaves, its roles, rules and what each intent should do. You get this brief on every turn.",
      input: { type: "object", properties: { name: { type: "string" }, lang: { type: "string", description: "language code of everything the person sees, e.g. ja, en" }, brief: { type: "string" } }, required: ["name", "brief"] },
      run: ({ world }, a) => { Object.assign(world.data, { name: a.name, brief: a.brief }, a.lang ? { lang: a.lang } : {}); world.changed("brief"); return ok("brief saved") } },
    { name: "add_check", roles: ["setup", "request"], description: "Add a test scenario: the steps a person takes (intent, inputs, which item in words) and what must be true afterwards.",
      input: { type: "object", properties: { name: { type: "string" }, steps: { type: "array", items: { type: "object", properties: { intent: { type: "string" }, inputs: { type: "object" }, item: { type: "string", description: "which item the step acts on, in words; empty if none" } }, required: ["intent"] } }, expect: { type: "array", items: { type: "string" } } }, required: ["name", "steps", "expect"] },
      run: ({ world }, a) => { const d = world.data; d.checks = d.checks.filter(c => c.name !== a.name); d.checks.push(a); world.changed("checks"); return ok("check saved") } },
    { name: "remove_check", roles: ["setup", "request"], description: "Remove a test scenario by its name.",
      input: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
      run: ({ world }, a) => { const d = world.data, n = d.checks.length; d.checks = d.checks.filter(c => c.name !== a.name); if (d.checks.length === n) return fail(`no check named "${a.name}". Existing: ${d.checks.map(c => c.name).join(", ") || "(none)"}`); world.changed("checks"); return ok("check removed") } },
    { name: "set_reality", roles: ["setup", "request"], description: "Estimate how this idea would behave if built today with existing, shippable technology. Give one entry per intent: how each part of what that intent does would really be built (ordinary code, a model, an outside service, or not possible yet), how often it would go wrong and how late it would answer. The 'existing technology' switch makes the system behave like this, intent by intent.",
      input: { type: "object", properties: { summary: { type: "string" }, items: { type: "array", items: { type: "object", properties: { part: { type: "string" }, existing: { type: "string" }, effect: { type: "string" } }, required: ["part", "existing", "effect"] } },
        intents: { type: "array", items: { type: "object", properties: {
          intent: { type: "string", description: "the intent exactly as screens and timers send it" },
          parts: { type: "array", items: { type: "object", properties: { what: { type: "string", description: "one thing this intent does" }, builtWith: { type: "string", enum: ["code", "model", "service", "not_yet"] }, detail: { type: "string", description: "which rule, model, service or missing technology, and why" } }, required: ["what", "builtWith", "detail"] } },
          errorRate: { type: "number", description: "0–1, how often the shippable version gets this intent wrong" }, delayMs: { type: "number", description: "how long the shippable version takes to answer" }, mistakes: { type: "string", description: "how it typically goes wrong" } }, required: ["intent", "parts", "errorRate", "delayMs", "mistakes"] } },
        audioLatencyMs: { type: "number" }, leak: { type: "number" }, decisionDelayMs: { type: "number" }, errorRate: { type: "number" }, minIntervalSec: { type: "number" }, cpuNote: { type: "string" } },
        required: ["summary", "items", "intents", "audioLatencyMs", "leak", "decisionDelayMs", "errorRate", "minIntervalSec", "cpuNote"] },
      run: ({ world }, a) => { world.data.reality = a; world.changed("reality"); return ok("reality estimate saved") } },
  ];

  // Shape check against a hand's input schema: required fields and basic types, one level into arrays.
  function shapeProblems(schema, value, path = "input") {
    const out = [], typeOf = v => Array.isArray(v) ? "array" : v === null ? "null" : typeof v;
    if (!schema || !schema.type) return out;
    const t = typeOf(value), want = schema.type === "integer" ? "number" : schema.type;
    if (t !== want) { out.push(`${path} must be ${want}, got ${t}`); return out }
    if (want === "object") {
      for (const k of schema.required || []) if (value[k] === undefined) out.push(`${path}.${k} is missing`);
      for (const [k, sub] of Object.entries(schema.properties || {})) if (value[k] !== undefined) out.push(...shapeProblems(sub, value[k], `${path}.${k}`));
    }
    if (want === "array" && schema.items) value.slice(0, 50).forEach((v, i) => out.push(...shapeProblems(schema.items, v, `${path}[${i}]`)));
    if (schema.enum && !schema.enum.includes(value)) out.push(`${path} must be one of ${schema.enum.join(", ")}`);
    return out;
  }
  const handsFor = role => HANDS.filter(h => h.roles.includes(role));

  // The artifact runtime refuses tool schemas nested deeper than 8 levels. Parts deeper than that are shown to
  // Claude as a one-line shape instead; the full schema still checks every call and answers in words.
  const depth = v => v && typeof v === "object" ? 1 + Math.max(0, ...Object.values(v).map(depth)) : 0;
  const sig = s => !s || typeof s !== "object" ? "any" : s.enum ? s.enum.join("|") : s.type === "array" ? [sig(s.items)]
    : s.type === "object" && s.properties ? Object.fromEntries(Object.entries(s.properties).map(([k, v]) => [k + ((s.required || []).includes(k) ? "" : "?"), sig(v)])) : s.type || "any";
  const collapse = s => ({ type: s.type, description: (s.description ? s.description + " — " : "") + "shape: " + JSON.stringify(sig(s)) });
  function shallow(s, budget = 7) {
    if (depth(s) <= budget) return s;
    if (budget <= 3) return collapse(s);
    const out = { ...s };
    if (s.properties) out.properties = Object.fromEntries(Object.entries(s.properties).map(([k, v]) => [k, shallow(v, budget - 2)]));
    if (s.items) out.items = shallow(s.items, budget - 1);
    return depth(out) <= budget ? out : collapse(s);
  }

  /* ---------- turns ---------- */
  const COMMON = `You are not writing software. You ARE the system: everything it does happens because you do it, through the tools (your hands). Never write code. Write everything a person sees in the system's language. Call independent tools together in the same round.`;
  const ROLE_PROMPTS = {
    setup: `${COMMON}
Make the idea exist as a system a person can use by hand right now — even if it would normally take weeks to build. First decide what this is to the person using it — a tool for work, a game, a story, a board, a map, an instrument, a companion, something else — and what they should see and touch. Do not fall back on forms and lists: they suit records and queues of work. When the idea is played, explored or watched, the face is a picture you draw: the board, scene, cards or map itself (draw + a drawing part), with the things a person touches carrying intents, text that follows values, and motion where it gives life. Then, using only the tools:
1. write_brief: the system's name, language and brief — what kind of thing it is, its roles, rules, and what you will do for each intent (including judgements ordinary code could not make, and how you redraw the picture as things happen).
2. apply: create the collections it needs with realistic test data (a believable situation to try right away).
3. define_screen: a screen for each device or role the idea needs, in the form you decided; only what is needed to use the core. A drawn face is a drawing part (draw it before you finish), with ordinary parts around it only where they help. Buttons carry intents in plain words; lists name their collection and, when the order matters, give it (with word values in display order). Use real-world parts (camera, sounds, output, speak, drawing) when the idea touches the real world.
4. set_timer when time passing matters; play_sounds when a test situation needs them.
5. add_check: 2–4 scenarios of a person using it and what must then be true.
6. set_reality: how this would behave if built today with existing technology — for every intent, which parts would be ordinary code, a model, an outside service or not possible yet, how often it would go wrong, how late it would answer and how it typically fails; plus sound delay and leakage if sound is involved.
If a tool reports a problem, correct your call. Finish with one sentence saying what you made.`,
    event: `${COMMON}
Something just happened in the system (below). Act as the system would: read only what you need (query), make every change in one apply, redraw (draw) a picture you drew when what it shows has changed, and add speak / notify / play_sounds / shape_sound / draw / define_screen only if the behaviour calls for it. Judge, predict and generate concretely and realistically. Never invent facts the world contradicts; if something needed is missing, say so in your reply. Use at most 4 tools. Reply with one short sentence for the person, or nothing.`,
    request: `${COMMON}
A person tried the system and asked for a change (below). Make the change through the tools — rewrite the brief, redefine screens, adjust data, timers or checks. Keep everything else as it is. Reply with one sentence saying what changed.`,
  };
  const TIER = { setup: "default", request: "default", event: "quick" };
  const clip = (s, n = 30000) => s.length > n ? s.slice(0, n) + `… (cut at ${n} characters; use query to read more)` : s;
  function contextText(world, extra) {
    const o = world.overview();
    return `SYSTEM: ${o.name || "(not set up yet)"}\nBRIEF:\n${o.brief || "(none yet)"}\n\nWORLD NOW:\n${clip(JSON.stringify({ values: o.values, collections: o.collections, screens: o.screens, timers: o.timers, ...(extra.startsWith("REQUEST") ? { checks: o.checks, screenDefinitions: world.data.screens } : {}) }), 120000)}\n\n${extra}`;
  }
  // The final sentence of a turn: the text of its last round.
  const lastRound = t => String(t || "").split(/\n\s*\n/).map(s => s.trim()).filter(Boolean).pop() || "";

  async function sampler() { return window.claude && window.claude.use ? await window.claude.use("sample") : null }

  async function runTurn({ role, world, message, reality = null, images = [], sound = null, emit = () => { }, onHand = () => { }, signal }) {
    const sample = await sampler(); if (!sample) throw Object.assign(new Error("not_in_claude"), { code: "not_in_claude" });
    let prompt = ROLE_PROMPTS[role];
    if (role === "event" && reality) prompt += `\nTHIS RUN SIMULATES THE EXISTING-TECHNOLOGY VERSION, not the ideal one. Find the estimate for this event's intent below and behave as that implementation would: parts built with ordinary code are exact; parts that need a model go wrong about as often and in the way it says; services answer as described; parts that are not possible yet do not work (say so instead of doing them). If no entry fits, use the general note.\nGENERAL: ${reality.cpuNote}\nPER INTENT: ${JSON.stringify(reality.intents || [])}`;
    prompt += "\n\n" + (role === "setup" ? `IDEA:\n${message}` : contextText(world, message));
    const calls = [], turn = { sound };
    const tools = handsFor(role).map(h => ({ name: h.name, description: h.description, inputSchema: shallow(h.input),
      execute: async input => {
        const a = input && typeof input === "object" ? input : {};
        const problems = shapeProblems(h.input, a);
        if (problems.length) throw new Error("not done, fix and call again: " + problems.slice(0, 12).join("; "));
        let r; try { r = h.run({ world, emit, turn }, a) } catch (e) { throw new Error(e.message) }
        calls.push({ name: h.name, args: a }); onHand(h.name, a);
        if (r.isError) throw new Error(r.text);
        return clip(r.text);
      } }));
    const t0 = Date.now();
    const res = await sample(prompt, { tools, modelTier: TIER[role], signal, ...(images.length ? { images } : {}) });
    return { text: lastRound(res.text), ms: Date.now() - t0, calls, tier: res.modelTierApplied };
  }

  // Setup may need more rounds than one call allows, so it continues until every part exists (a shape check only).
  function missingParts(d) {
    const m = [];
    if (!d.brief) m.push("write_brief"); if (!Object.keys(d.collections).length) m.push("apply (the data)");
    if (!d.screens.length) m.push("define_screen (every device or role)"); if (!d.checks.length) m.push("add_check"); if (!d.reality) m.push("set_reality");
    return m;
  }
  async function setup({ world, idea, emit, onHand, signal, onPass = () => { } }) {
    world.data.idea = idea;
    const all = { text: "", ms: 0, calls: [], passes: 0 };
    for (let pass = 0; pass < 4; pass++) {
      const missing = pass ? missingParts(world.data) : null;
      if (pass && !missing.length) break;
      onPass(pass + 1, missing);
      const r = pass === 0
        ? await runTurn({ role: "setup", world, message: idea, emit, onHand, signal })
        : await runTurn({ role: "request", world, message: `REQUEST: Continue setting the system up from this idea. Still missing: ${missing.join(", ")}. Do those now; keep what exists.\nIDEA:\n${idea}`, emit, onHand, signal });
      all.text = r.text || all.text; all.ms += r.ms; all.calls.push(...r.calls); all.passes = pass + 1;
    }
    return all;
  }

  function eventMessage(ev) {
    return `EVENT: ${ev.intent}${ev.screen ? `\nON SCREEN: ${ev.screen}` : ""}${ev.item ? `\nITEM: ${JSON.stringify(ev.item)}` : ""}${ev.inputs && Object.keys(ev.inputs).length ? `\nINPUTS: ${JSON.stringify(ev.inputs)}` : ""}${ev.images && ev.images.length ? "\nA camera picture came with it (attached)." : ""}${ev.sound ? "\nSound came with it (use listen)." : ""}${ev.source ? `\nFROM: ${ev.source}` : ""}`;
  }

  /* ---------- checks: play each scenario on a copy of the world, then Claude judges ---------- */
  async function runChecks({ world, signal, onStep = () => { } }) {
    const sample = await sampler(); if (!sample) throw Object.assign(new Error("not_in_claude"), { code: "not_in_claude" });
    const out = [];
    for (const c of world.data.checks) {
      const w = world.copy(), before = w.view(), r = { name: c.name, steps: [], expect: [], ok: true };
      try {
        for (const s of c.steps) {
          onStep(c.name, s.intent);
          const res = await runTurn({ role: "event", world: w, message: `EVENT: ${s.intent}${s.inputs ? `\nINPUTS: ${JSON.stringify(s.inputs)}` : ""}${s.item ? `\nITEM (find it yourself): ${s.item}` : ""}`, signal });
          r.steps.push({ action: s.intent, inputs: s.inputs || {}, ms: res.ms, notice: res.text });
        }
        const verdicts = await sample.json(`You judge a test of a system. For each expectation, decide strictly whether it holds, comparing the world before and after. When the expectation is about what a person sees (shown, listed, gone from a list, a count on a screen), judge what the screens would draw from the world: a list or table with "where" shows only the items whose property equals that value, in the given order. Explain briefly in ${langName(w.data.lang)}, quoting the values you looked at.
Reply with only a JSON array, one {"pass": boolean, "reason": string} per expectation, in order.

${clip(JSON.stringify({ scenario: c.name, expectations: c.expect, screens: w.data.screens, before, after: w.view() }), 200000)}`, { modelTier: "quick", cache: false, signal });
        c.expect.forEach((e, i) => { const v = Array.isArray(verdicts) ? verdicts[i] || {} : {}; r.expect.push({ text: e, pass: v.pass === true, reason: String(v.reason || "") }); if (v.pass !== true) r.ok = false });
      } catch (e) { r.ok = false; r.error = e.code || e.message }
      out.push(r);
    }
    return out;
  }

  /* ---------- reverse: brief + screens + what the system actually did ---------- */
  function specMd(world, traces) {
    const d = world.data, L = [];
    L.push(`# ${d.name} — specification from a running kuron prototype`, "", "## Idea", "", d.idea || "", "", "## Brief", "", d.brief, "", "## Data", "");
    for (const [k, v] of Object.entries(d.collections)) L.push(`- **${k}** (${v.length} items) — properties: ${[...new Set(v.flatMap(x => Object.keys(x)))].join(", ")}`);
    for (const k of Object.keys(d.values)) L.push(`- value **${k}**`);
    L.push("", "## Screens", "");
    for (const s of d.screens) { L.push(`### ${s.name} (${s.device})`, ""); s.parts.forEach(p => L.push(`- ${p.kind}${p.text ? ` "${p.text}"` : ""}${p.collection ? ` of ${p.collection}` : ""}${p.intent ? ` → ${p.intent}` : ""}`)); L.push("") }
    L.push("## What the system did (golden examples)", "");
    traces.filter(t => t.action).slice(-20).reverse().forEach(t => L.push(`### ${t.action}`, "", "```json", JSON.stringify({ inputs: t.inputs, item: t.target, hands: t.calls, reply: t.notice }, null, 1).slice(0, 3000), "```", ""));
    L.push("## Checks", ""); d.checks.forEach(c => { L.push(`- ${c.name}`); (c.expect || []).forEach(e => L.push(`  - expect: ${e}`)) });
    if (d.reality) {
      L.push("", "## Existing technology estimate", "", d.reality.summary, ...(d.reality.items || []).map(i => `- ${i.part}: ${i.existing} → ${i.effect}`));
      if ((d.reality.intents || []).length) {
        L.push("", "### Per intent", "", "| intent | part | built with | detail | error rate | delay |", "|---|---|---|---|---|---|");
        for (const x of d.reality.intents) for (const p of x.parts) L.push(`| ${x.intent} | ${p.what} | ${p.builtWith} | ${p.detail} | ${Math.round(x.errorRate * 100)}% | ${x.delayMs} ms |`);
      }
    }
    return L.join("\n") + "\n";
  }
  async function writePlan(spec, { lang, signal, onText }) {
    const sample = await sampler(); if (!sample) throw Object.assign(new Error("not_in_claude"), { code: "not_in_claude" });
    const r = await sample(`You plan the real implementation of a prototype that already runs on an LLM with hands. Below is its specification, including real examples of what each action did.
Write PLAN.md in ${langName(lang || "en")}:
1. Summary: what the system is and what the prototype proved.
2. For every action: ordinary code / needs a model (say which kind) / needs an outside service or data / keep on an LLM, with the reason.
3. Architecture and data model for the real system.
4. Schedule: ordered work items with an estimate in hours, the riskiest first.
5. Prompts: for each work item, the exact prompt to give a coding agent, as a fenced block, referencing the spec and the golden examples.
6. Acceptance: turn the checks and the examples into the tests the real implementation must pass.
Reply with the Markdown only.

${clip(spec, 200000)}`, { modelTier: "default", cache: false, signal, onText });
    return r.text.trim() + "\n";
  }

  window.Kuron = { World, HANDS, handsFor, shapeProblems, shallow, depth, runTurn, setup, eventMessage, runChecks, specMd, writePlan, sampler, missingParts, langName };
})();
