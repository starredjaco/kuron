// The Kuron compiler. The local LLM reads each section of the design document and lowers it
// into a language-neutral intermediate representation (IR) that the LLM-CPU executes.
// Order matters: state → screens (which name the inputs) → actions (which use those inputs) → checks.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { chat, DEFAULT_MODEL } from "./llm.js";
import { parseSource, langName } from "./source.js";
import { supplementPrompt, realityPrompt, COMPONENTS, CONTRACTS } from "./realworld.js";

const FIELD_TYPES = ["text", "number", "bool", "texts", "numbers", "records", "record"];
const PRIM = ["text", "number", "bool"];
const COMP_KINDS = ["heading", "text", "metric", "input", "select", "button", "list", "table", "badge", "chart", "divider", "image", "camera", "mic", "sounds", "output", "speak", "drawing"];
const LIVE = ["camera", "mic", "output"];

export function fieldSchema(f) {
  if (f.contract) return { type: "array", items: f.contract };
  const prim = t => ({ text: { type: "string" }, number: { type: "number" }, bool: { type: "boolean" } }[t] || { type: "string" });
  const obj = () => ({ type: "object", properties: Object.fromEntries((f.items || []).map(i => [i.name, prim(i.type)])), required: (f.items || []).map(i => i.name) });
  switch (f.type) {
    case "number": return { type: "number" };
    case "bool": return { type: "boolean" };
    case "texts": return { type: "array", items: { type: "string" } };
    case "numbers": return { type: "array", items: { type: "number" } };
    case "records": return { type: "array", items: obj() };
    case "record": return obj();
    default: return { type: "string" };
  }
}
export const stateSchema = fields => ({ type: "object", properties: Object.fromEntries(fields.map(f => [f.name, fieldSchema(f)])), required: fields.map(f => f.name) });
const enumOr = (xs, extra = [""]) => ({ type: "string", enum: [...new Set([...xs, ...extra])].length ? [...new Set([...xs, ...extra])] : [""] });

class Cache {
  constructor(dir) { this.file = dir && join(dir, "compile-cache.json"); this.map = {}; if (this.file && existsSync(this.file)) try { this.map = JSON.parse(readFileSync(this.file, "utf8")) } catch { } }
  key(x) { return createHash("sha1").update(JSON.stringify(x)).digest("hex") }
  get(k) { return this.map[k] }
  set(k, v) { this.map[k] = v; if (this.file) { mkdirSync(join(this.file, ".."), { recursive: true }); writeFileSync(this.file, JSON.stringify(this.map)) } }
}

const SYS = `You are the compiler of Kuron, a programming language whose CPU is a large language model.
The program is a design document. You lower one part of it into a strict JSON form that the LLM-CPU and the renderer execute.
Names (fields, properties, screens, actions, inputs) must be written exactly as in the source, in the source's own language. Never translate or romanize names.`;

// Field names written by the author before ":" in the State section are taken literally.
const declaredName = item => { const m = /^\s*([^:：（(、,]+?)\s*[:：]/.exec(item); return m ? m[1].trim() : null };

export async function compile(text, { model = DEFAULT_MODEL, think = false, cacheDir = null, onProgress = () => { } } = {}) {
  const t0 = Date.now();
  let src = parseSource(text);
  const cache = new Cache(cacheDir);
  const L = langName(src.lang);
  const warnings = [];
  let calls = 0, hits = 0;
  const ask = async (stage, system, user, schema, temperature = 0.1, effort = undefined) => {
    const k = cache.key([model, think, stage, system, user, schema, effort || null]);
    const c = cache.get(k); if (c) { hits++; return c }
    calls++; onProgress({ stage });
    const { value } = await chat({ model, system, user, schema, temperature, think, effort });
    cache.set(k, value); return value;
  };
  if (src.errors.length) return { ok: false, src, errors: src.errors };

  // 0. the LLM fills in what the program still needs to work for real (fields, screen parts, actions,
  // a test situation), written as additions in the program's own format; then estimates existing technology.
  const sup = await ask("supplement", SYS + "\n" + supplementPrompt(L), "PROGRAM:\n" + text, { type: "object", properties: { additions: { type: "string" } }, required: ["additions"] }, 0.2);
  const additions = String(sup.additions || "").trim();
  const full = additions ? text.trimEnd() + "\n\n" + additions + "\n" : text;
  if (additions) src = parseSource(full);
  if (src.errors.length) return { ok: false, src, errors: src.errors };
  const realityP = ask("reality", SYS + "\n" + realityPrompt(L), "PROGRAM:\n" + full,
    { type: "object", properties: { summary: { type: "string" }, items: { type: "array", items: { type: "object", properties: { part: { type: "string" }, existing: { type: "string" }, effect: { type: "string" } }, required: ["part", "existing", "effect"] } },
      audioLatencyMs: { type: "number" }, leak: { type: "number" }, decisionDelayMs: { type: "number" }, errorRate: { type: "number" }, minIntervalSec: { type: "number" }, cpuNote: { type: "string" } },
      required: ["summary", "items", "audioLatencyMs", "leak", "decisionDelayMs", "errorRate", "minIntervalSec", "cpuNote"] }).catch(() => null);

  // 1. state fields
  const declared = src.state.map(declaredName).filter(Boolean);
  const fieldsOut = await ask("fields", SYS + `\nTask: define the typed state fields this system remembers.
Types: text, number, bool, texts (list of text), numbers (list of numbers), records (list of objects), record (one object).
For records and record you MUST list the item properties (name + type text/number/bool), taken from the description, in ${L}.
Choosing types: words, labels, categories (like high/medium/low), dates or deadlines written in words, and advice are text. Use number only for amounts, counts and scores. Use bool only for yes/no flags such as done.
${declared.length ? "The author declared these field names; use them exactly: " + declared.join(", ") + ". " : ""}Add a field only if the screens or actions clearly need to remember something not covered.
startsWithData: true only if the program asks for the system to start with existing, sample or demo data; false if it starts empty.`,
    stateContext(src),
    { type: "object", properties: { fields: { type: "array", items: { type: "object", properties: {
      name: { type: "string" }, type: { type: "string", enum: FIELD_TYPES }, desc: { type: "string" },
      items: { type: "array", items: { type: "object", properties: { name: { type: "string" }, type: { type: "string", enum: PRIM } }, required: ["name", "type"] } } },
      required: ["name", "type", "desc", "items"] } }, startsWithData: { type: "boolean" } }, required: ["fields", "startsWithData"] });
  const seen = new Set();
  let fields = (fieldsOut.fields || []).filter(f => f.name && !seen.has(f.name) && seen.add(f.name))
    .map(f => ({ name: f.name, type: f.type, desc: f.desc || "", items: (f.type === "records" || f.type === "record") ? (f.items || []).filter(i => i.name) : undefined }));
  for (const d of declared) if (!fields.some(f => f.name === d)) warnings.push({ code: "field_renamed", name: d });
  for (const f of fields.filter(f => f.items && !f.items.length)) {
    const o = await ask("items", SYS + `\nTask: list the properties of each item of the field "${f.name}", in ${L}.`, stateContext(src),
      { type: "object", properties: { items: { type: "array", items: { type: "object", properties: { name: { type: "string" }, type: { type: "string", enum: PRIM } }, required: ["name", "type"] } } }, required: ["items"] });
    f.items = (o.items || []).filter(i => i.name);
  }
  const schema = stateSchema(fields);
  const listFields = fields.filter(f => ["records", "texts", "numbers"].includes(f.type)).map(f => f.name);
  let fieldList = fields.map(f => `- ${f.name}: ${f.type}${f.items ? " of {" + f.items.map(i => i.name + ": " + i.type).join(", ") + "}" : ""} — ${f.desc}`).join("\n");

  // 2. initial state (in parallel with the rest)
  const wantsData = !!fieldsOut.startsWithData;
  const initialP = !wantsData ? Promise.resolve(emptyState(fields)) : ask("initial", SYS + `\nTask: produce the initial value of the whole state. If the source asks for sample, demo or existing data, invent realistic data in ${L}. Otherwise use empty lists, 0, false and "".`,
    stateContext(src) + "\n\nFIELDS:\n" + fieldList, schema, 0.5);

  // 3. screens → view trees. Inputs are named here; actions will use these names.
  const actionNames = [...src.events.filter(e => !e.start).map(e => e.name)];
  const screenNames = src.screens.map(s => s.name);
  const prop = { text: { type: "string" }, label: { type: "string" }, name: { type: "string" }, inputType: { type: "string", enum: ["text", "number", "date", "longtext"] },
    options: { type: "array", items: { type: "string" } }, action: enumOr(actionNames), goto: enumOr(screenNames), whereField: { type: "string" }, whereValue: { type: "string" } };
  const rowComp = { type: "object", properties: { kind: { type: "string", enum: ["heading", "text", "badge", "button", "metric"] }, ...prop }, required: ["kind"] };
  const textFields = fields.filter(f => f.type === "text").map(f => f.name);
  const comp = { type: "object", properties: { kind: { type: "string", enum: COMP_KINDS }, ...prop, source: enumOr(listFields), sortField: { type: "string" }, sortDesc: { type: "boolean" },
    every: { type: "number" }, gains: enumOr(listFields), field: enumOr(textFields), from: { type: "string", enum: ["mic", "sounds", "both", ""] },
    columns: { type: "array", items: { type: "string" } }, empty: { type: "string" }, row: { type: "array", items: rowComp } }, required: ["kind"] };
  const actList = src.events.filter(e => !e.start).map(e => `- ${e.name}: ${e.items.join(" / ")}`).join("\n");
  const EXAMPLE = `Example (for a different system with fields "notes: records of {title: text, importance: text, done: bool}" and "summary: text", actions "Add" and "Done"):
[{"kind":"heading","text":"My notes"},{"kind":"text","text":"{summary}"},
 {"kind":"input","name":"title","label":"Title","inputType":"text"},{"kind":"button","text":"Add","action":"Add"},
 {"kind":"list","source":"notes","whereField":"done","whereValue":"false","sortField":"importance","sortDesc":true,"empty":"Nothing yet","row":[{"kind":"text","text":"{title}"},{"kind":"badge","text":"{importance}"},{"kind":"button","text":"Done","action":"Done"}]},
 {"kind":"metric","label":"Finished","text":"{count:notes|done=true}"}]
(here the screen said: "unfinished notes, most important first, each with a Done button" and "how many are finished").`;
  const scOut = await Promise.all(src.screens.map(s => ask("screen", SYS + `\nTask: compile one screen into UI components, top to bottom.
kinds: heading(text) · text(text) · metric(label, text) · input(name, label, inputType) · select(name, label, options) · button(text, action and/or goto) · list(source, whereField/whereValue filter, sortField/sortDesc, row, empty) · table(source, columns) · badge(text, optional whereField/whereValue) · chart(source, label) · image(text = what it shows) · divider.
Templates inside text: {field} = a state field, {count:field} = number of items, {count:field|property=value} = number of items whose property equals value. Inside a list row, {property} = that item's property (e.g. {title}). Do not write {prop.x} or {item.x}.
${COMPONENTS}
Component fields: camera(label, every, action) · mic(label, every, action) · sounds(label, source) · output(label, gains, from, every, action) · speak(text) · drawing(field).
sounds.source and output.gains must each name a list field; the compiler fixes those fields to the component's exact data shape.
If the screen description says which items to show (e.g. only unfinished ones) set whereField/whereValue; if it says an order (e.g. highest priority first, newest first) set sortField/sortDesc. A metric shows one value in text; it has no source and no row.
Give each input a short name in ${L} describing what the user types; the action triggered by the button next to it receives it. A button inside a row acts on that row's item. Visible wording in ${L}.
${EXAMPLE}`,
    `SYSTEM: ${src.name} — ${src.desc}\nFIELDS:\n${fieldList}\nACTIONS:\n${actList || "(none)"}\nSCREENS: ${screenNames.join(", ")}\n\nSCREEN "${s.name}" (${s.formLabel || "web"}):\n- ${s.items.join("\n- ")}`,
    { type: "object", properties: { view: { type: "array", items: comp } }, required: ["view"] })));
  const screens = src.screens.map((s, i) => ({ name: s.name, form: s.form, formLabel: s.formLabel, source: s.items, ln: s.ln, view: clean(scOut[i].view || [], { actionNames, screenNames, listFields, warnings, screen: s.name }) }));

  const initialExtra = {};
  // 3a. fields read by components get the component's exact data shape (the CPU can then only write valid data)
  // A field already shown by a list, table or chart keeps its own shape; the component then gets a field of its own.
  const shown = new Set(screens.flatMap(sc => sc.view.filter(c => ["list", "table", "chart"].includes(c.kind) && c.source).map(c => c.source)));
  const bound = new Set();
  for (const sc of screens) for (const c of sc.view) {
    if (c.kind !== "sounds" && c.kind !== "output") continue;
    const key = c.kind === "sounds" ? "source" : "gains";
    let f = fields.find(x => x.name === c[key]);
    if (!f || (shown.has(f.name) && !f.contract) || (bound.has(f.name) && f.contract !== CONTRACTS[c.kind])) {
      let name = (c.label || c.kind).trim(), n = 2; while (fields.some(x => x.name === name)) name = (c.label || c.kind).trim() + " " + n++;
      f = { name, type: "records", desc: "" }; fields.push(f); initialExtra[name] = [];
      warnings.push({ code: "component_field_added", screen: sc.name, name });
    }
    c[key] = f.name; bound.add(f.name);
    f.type = "records"; f.contract = CONTRACTS[c.kind];
    f.items = Object.entries(CONTRACTS[c.kind].properties).map(([k, v]) => ({ name: k, type: v.type === "number" ? "number" : "text" }));
    f.desc = (f.desc ? f.desc + " " : "") + `(data for the ${c.kind} component: ${Object.entries(CONTRACTS[c.kind].properties).map(([k, v]) => k + (v.enum ? " one of " + v.enum.join("/") : v.description ? " = " + v.description : "")).join("; ")})`;
    schema.properties[f.name] = fieldSchema(f);
  }
  fieldList = fields.map(f => `- ${f.name}: ${f.type}${f.items ? " of {" + f.items.map(i => i.name + ": " + i.type).join(", ") + "}" : ""} — ${f.desc}`).join("\n");

  // 3b. lists: a focused pass decides filter and order, which the screen pass tends to leave out.
  // Lists, actions and checks only need the screens, so these three passes run at the same time.
  const listsP = Promise.all(screens.flatMap((sc, si) => sc.view.filter(c => (c.kind === "list" || c.kind === "table") && c.source).map(async c => {
    const f = fields.find(x => x.name === c.source); const props = (f && f.items || []).map(i => i.name);
    if (!props.length) return;
    const o = await ask("listspec", SYS + `\nTask: decide which items of the list "${c.source}" this screen shows and in which order, from the screen description only.
whereField/whereValue: show only items whose property equals the value ("" if the description shows all items; booleans are "true"/"false"). sortField/sortDesc: the order ("" if no order is described; sortDesc true for highest/newest/most first).
sortValues: when sortField holds words rather than numbers or dates (e.g. priority levels, statuses), every value it can take, in the order they should appear on screen (first = shown first); otherwise [].`,
      `SCREEN "${sc.name}":\n- ${src.screens[si].items.join("\n- ")}\nLIST "${c.source}" item properties: ${(f.items || []).map(i => i.name + " (" + i.type + ")").join(", ")}`,
      { type: "object", properties: { whereField: enumOr(props), whereValue: { type: "string" }, sortField: enumOr(props), sortDesc: { type: "boolean" }, sortValues: { type: "array", items: { type: "string" } } }, required: ["whereField", "whereValue", "sortField", "sortDesc", "sortValues"] });
    if (o.whereField) { c.whereField = o.whereField; c.whereValue = o.whereValue } else { delete c.whereField; delete c.whereValue }
    if (o.sortField) { c.sortField = o.sortField; c.sortDesc = !!o.sortDesc; c.sortValues = o.sortValues || [] } else { delete c.sortField; delete c.sortDesc; delete c.sortValues }
  })));

  // which inputs sit on the same screen as a button for each action
  const inputsFor = {}, liveFor = {};
  for (const sc of screens) {
    const ins = sc.view.filter(c => c.kind === "input" || c.kind === "select").map(c => c.name).filter(Boolean);
    const acts = new Set([...sc.view.filter(c => c.action).map(c => c.action), ...sc.view.flatMap(c => (c.row || []).filter(r => r.action).map(r => r.action))]);
    for (const a of acts) inputsFor[a] = [...new Set([...(inputsFor[a] || []), ...ins])];
    for (const c of sc.view) if (LIVE.includes(c.kind) && c.action) { liveFor[c.action] = c.kind === "camera" ? "image" : "sound"; inputsFor[c.action] = [...new Set([...(inputsFor[c.action] || []), ...(c.kind === "camera" ? [] : ["sound"])])] }
  }

  // 4. actions (and timers) → CPU instruction lists
  const allEvents = [...src.events, ...src.timers.map(t => ({ name: t.name, items: t.items, ln: t.ln, every: t.every }))];
  const fieldEnum = { type: "array", items: enumOr(fields.map(f => f.name), []) };
  const evP = Promise.all(allEvents.map(e => {
    const ins = inputsFor[e.name] || [];
    return ask("event", SYS + `\nTask: compile one action into instructions for the LLM-CPU.
reads: fields the action looks at. writes: fields it changes. inputs: which of the available form inputs it uses (an action triggered from a row button usually works on the target item and needs no inputs).
steps: short imperative instructions in ${L}, one operation each, in order, naming fields, properties and inputs exactly. Keep judgement, prediction and generation as single steps; the CPU does them directly.
Fields marked "data for the … component" are what the real-world components play or apply: if this action produces that kind of data (test sounds, band gains…), it must write that field too, in the component's exact shape.`,
      `SYSTEM: ${src.name} — ${src.desc}\nFIELDS:\n${fieldList}\nAVAILABLE INPUTS: ${ins.join(", ") || "(none)"}${liveFor[e.name] === "image" ? "\nThis action receives the current camera picture as an image; steps may look at it." : liveFor[e.name] === "sound" ? "\nThis action receives input \"sound\": loudness, level per band (Hz → dB), rising bands and words heard." : ""}\n\nACTION "${e.start ? "on start" : e.name}":\n- ${e.items.join("\n- ")}`,
      { type: "object", properties: { reads: fieldEnum, writes: fieldEnum, inputs: { type: "array", items: enumOr(ins, []) }, steps: { type: "array", items: { type: "string" } } }, required: ["reads", "writes", "inputs", "steps"] });
  }));
  // 5. checks → steps + expectations (input names come from the screens, so this does not wait for the actions)
  const evList = actionNames.map(n => `- ${n} (inputs: ${(inputsFor[n] || []).join(", ") || "none"}): ${(src.events.find(e => e.name === n) || { items: [] }).items.join(" / ")}`).join("\n");
  const allInputs = [...new Set(Object.values(inputsFor).flat())];
  const initialForChecks = normalize(await initialP, fields);
  const sample = JSON.stringify(initialForChecks).slice(0, 4000);
  const ckP = Promise.all(src.checks.map(c => ask("check", SYS + `\nTask: compile one test scenario into steps for the test runner and expectations to judge afterwards.
Each step triggers one action and gives values for that action's inputs (only its own inputs). If the action works on one item of a list (like a button in a row), set list, and name the item by a property value (matchField + matchValue, e.g. the item's name) — set index to -1 unless the scenario really means a position. Otherwise list "", matchField "", index -1.
When the scenario describes something by a quality ("a person who is in a meeting", "an urgent request"), pick concrete values from the initial state that have that quality (e.g. the name of a staff member whose status is "in a meeting"); never type the description itself as a value.
expect: short, concrete sentences in ${L} that can be judged from the final state alone.`,
    `FIELDS:\n${fieldList}\nINITIAL STATE:\n${sample}\nACTIONS:\n${evList || "(none)"}\n\nSCENARIO: ${c.text}`,
    { type: "object", properties: { steps: { type: "array", items: { type: "object", properties: { action: enumOr(actionNames, []), inputs: { type: "array", items: { type: "object", properties: { name: enumOr(allInputs, []), value: { type: "string" } }, required: ["name", "value"] } }, list: enumOr(listFields), matchField: { type: "string" }, matchValue: { type: "string" }, index: { type: "number" } }, required: ["action", "inputs", "list", "matchField", "matchValue", "index"] } },
      expect: { type: "array", items: { type: "string" } } }, required: ["steps", "expect"] })));

  const [, evOut, ckOut] = await Promise.all([listsP, evP, ckP]);
  const events = {};
  allEvents.forEach((e, i) => {
    const o = evOut[i], key = e.start ? "__start" : e.name;
    events[key] = { live: liveFor[e.name] || null, reads: [...new Set(o.reads)].filter(Boolean), writes: [...new Set(o.writes)].filter(Boolean), inputs: [...new Set(o.inputs || [])].filter(Boolean), steps: o.steps.length ? o.steps : e.items, source: e.items, ln: e.ln, start: !!e.start, every: e.every || null };
  });

  const checks = src.checks.map((c, i) => ({ name: c.name, text: c.text, ln: c.ln, steps: (ckOut[i].steps || []).map(s => ({ ...s, inputs: Object.fromEntries((s.inputs || []).filter(x => x.name).map(x => [x.name, x.value])) })), expect: ckOut[i].expect || [] }));

  const initial = { ...normalize(await initialP, fields), ...initialExtra };
  const reality = await realityP;
  return { ok: true, ir: { version: 1, name: src.name, desc: src.desc, lang: src.lang, model, state: { fields, schema, initial }, screens, events, checks, reality, additions, warnings }, src, stats: { ms: Date.now() - t0, calls, hits } };
}

// The state stage sees only the system summary and the State section, so editing a screen or an
// action does not invalidate it (incremental compile: each stage is cached by its own input).
function stateContext(src) {
  return `SYSTEM: ${src.name} — ${src.desc}\nSTATE SECTION:\n- ${src.state.join("\n- ") || "(empty)"}\nSCREENS: ${src.screens.map(s => s.name).join(", ")}\nACTIONS: ${src.events.map(e => e.start ? "on start" : e.name).join(", ")}`;
}

function emptyState(fields) {
  return Object.fromEntries(fields.map(f => [f.name, { text: "", number: 0, bool: false, texts: [], numbers: [], records: [], record: Object.fromEntries((f.items || []).map(i => [i.name, i.type === "number" ? 0 : i.type === "bool" ? false : ""])) }[f.type] ?? ""]));
}

// Drop empty placeholder records the model sometimes emits in initial lists.
function normalize(init, fields) {
  const out = { ...init };
  for (const f of fields) if (f.type === "records" && Array.isArray(out[f.name])) out[f.name] = out[f.name].filter(x => x && Object.values(x).some(v => v !== "" && v != null));
  return out;
}

function clean(view, ctx) {
  const ok = c => {
    if (c.action && !ctx.actionNames.includes(c.action)) { ctx.warnings.push({ code: "unknown_action", screen: ctx.screen, name: c.action }); c.action = "" }
    if (c.goto && !ctx.screenNames.includes(c.goto)) { ctx.warnings.push({ code: "unknown_screen", screen: ctx.screen, name: c.goto }); c.goto = "" }
    if (c.goto === ctx.screen) c.goto = "";
    if (c.kind !== "button") { delete c.goto; if (!LIVE.includes(c.kind)) delete c.action }
    if (c.kind === "button" && !c.action && !c.goto) ctx.warnings.push({ code: "dead_button", screen: ctx.screen, name: c.text });
    if ((c.kind === "list" || c.kind === "table" || c.kind === "chart") && !c.source) ctx.warnings.push({ code: "no_source", screen: ctx.screen, name: c.label || c.kind });
    if (c.kind === "metric" && !c.text && c.row && c.row[0] && c.row[0].text) c.text = c.row[0].text;
    if (["metric", "heading", "text", "badge", "input", "select", "button", "image", "divider", "camera", "mic", "output", "speak", "drawing"].includes(c.kind)) { delete c.row; delete c.source }
    if (typeof c.text === "string") c.text = c.text.replace(/\{(?:prop|item|row)\.([^{}]+)\}/g, "{$1}");
    if (c.row) c.row = c.row.filter(ok);
    return true;
  };
  return view.filter(ok);
}
