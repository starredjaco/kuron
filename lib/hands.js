// The hands an LLM uses to behave as a system. Each hand checks only the shape of what it is given and
// answers in words; it never judges content, guesses meaning or fills gaps — the LLM does that.
import { CONTRACTS } from "./realworld.js";

const KINDS = ["heading", "text", "metric", "input", "select", "button", "list", "table", "badge", "chart", "image", "divider", "camera", "mic", "sounds", "output", "speak", "drawing", "page", "stage"];
const ROW_KINDS = ["heading", "text", "badge", "button", "metric"];
const partProps = {
  kind: { type: "string", enum: KINDS },
  text: { type: "string", description: "visible text; insert a value by its name in braces, e.g. {clock}; counts as {count:collection} or {count:collection|property=value}; inside a row {property}" },
  label: { type: "string" },
  name: { type: "string", description: "input/select: the name its value is sent under" },
  inputType: { type: "string", enum: ["text", "number", "date", "longtext"] },
  options: { type: "array", items: { type: "string" } },
  intent: { type: "string", description: "button / camera / mic / output: what happens, in plain words; it is sent to you when used" },
  goto: { type: "string", description: "button: screen to show after it" },
  collection: { type: "string", description: "list / table / chart: the collection shown" },
  where: { type: "object", description: "list: show only items whose property equals the value, e.g. {\"done\": false}" },
  order: { type: "object", properties: { property: { type: "string" }, values: { type: "array", items: { type: "string" }, description: "word values in display order (first shown first)" }, direction: { type: "string", enum: ["ascending", "descending"] } } },
  columns: { type: "array", items: { type: "string" } },
  empty: { type: "string" },
  every: { type: "number", description: "camera / mic / output: seconds between automatic sends (0 = only on a button)" },
  value: { type: "string", description: "drawing: the value that holds the SVG (draw). page: the value that holds your HTML (write_page). stage: the value that holds the stage (set_stage)" },
};
const BODY = { type: "object", properties: {
  id: { type: "string" }, tags: { type: "array", items: { type: "string" }, description: "names rules use to pick bodies" },
  shape: { type: "string", enum: ["rect", "circle", "text"] }, text: { type: "string", description: "words or an emoji drawn at its centre; may name a counter or a value in braces" },
  x: { description: "centre, in stage units; any number here may be [min, max] for a random one" }, y: {}, w: {}, h: {}, r: {}, size: { description: "text size" }, radius: {},
  vx: { description: "units per second" }, vy: {}, ax: {}, ay: { description: "acceleration, e.g. gravity" },
  fill: { type: "string" }, stroke: { type: "string" },
  edges: { type: "string", enum: ["none", "bounce", "stop", "wrap", "leave"], description: "what the stage's edges do to it; leave = it is removed once outside" },
  follow: { type: "string", enum: ["pointer", "pointer-x", "pointer-y"] },
  keys: { type: "object", description: "key name → {set:{vx,vy}} while held, or {push:{vx,vy}} once when pressed, e.g. {\"ArrowLeft\":{\"set\":{\"vx\":-220}},\"Space\":{\"push\":{\"vy\":-380}}}" },
  life: { description: "seconds until it disappears" } }, required: ["shape", "x", "y"] };
const rowPart = { type: "object", properties: { ...partProps, kind: { type: "string", enum: ROW_KINDS } }, required: ["kind"] };
const part = { type: "object", properties: { ...partProps, row: { type: "array", items: rowPart } }, required: ["kind"] };

// Turn a part as the LLM wrote it into what the face draws. This only renames fields; it decides nothing.
function facePart(p) {
  const q = { ...p };
  if (p.collection) q.source = p.collection;
  if (p.intent) q.action = p.intent;
  if (p.where && typeof p.where === "object") { const [k, v] = Object.entries(p.where)[0] || []; if (k !== undefined) { q.whereField = k; q.whereValue = String(v) } }
  if (p.order && p.order.property) { q.sortField = p.order.property; q.sortValues = p.order.values || []; q.sortDesc = p.order.direction === "descending" }
  if (p.kind === "sounds") q.source = "__sounds";
  if (p.kind === "output") q.gains = "__bands";
  if (p.kind === "drawing" || p.kind === "page" || p.kind === "stage") q.field = p.value;
  if (p.row) q.row = p.row.map(facePart);
  return q;
}

const text = o => ({ content: [{ type: "text", text: typeof o === "string" ? o : JSON.stringify(o) }] });
const fail = m => ({ content: [{ type: "text", text: m }], isError: true });

export const HANDS = [
  { name: "overview", roles: ["setup", "event", "request", "judge"],
    description: "See the whole world briefly: the brief, values, each collection's count, properties and latest items, screens and their intents, timers.",
    input: { type: "object", properties: {} },
    run: ({ world }) => text(world.overview()) },
  { name: "query", roles: ["setup", "event", "request", "judge"],
    description: "Read items of one collection, optionally only those whose properties equal the given values, or by ids.",
    input: { type: "object", properties: { collection: { type: "string" }, where: { type: "object" }, ids: { type: "array", items: { type: "string" } }, limit: { type: "number" } }, required: ["collection"] },
    run: ({ world }, a) => text(world.query(a)) },
  { name: "apply", roles: ["setup", "event", "request"],
    description: "Change the world in one batch. changes: {op:\"add\", collection, item} | {op:\"update\", collection, id, set} | {op:\"remove\", collection, id} | {op:\"order\", collection, ids}. values: named single values to set. New collections are created by adding to them. Returns what was done and any problems to fix.",
    input: { type: "object", properties: { changes: { type: "array", items: { type: "object", properties: { op: { type: "string", enum: ["add", "update", "remove", "order"] }, collection: { type: "string" }, id: { type: "string" }, item: { type: "object" }, set: { type: "object" }, ids: { type: "array", items: { type: "string" } } }, required: ["op", "collection"] } }, values: { type: "object" } } },
    run: ({ world }, a) => { const r = world.apply(a); return r.problems.length ? { ...text(r), isError: r.done.length === 0 } : text(r) } },
  { name: "define_screen", roles: ["setup", "request", "event"],
    description: "Create or replace one screen of the system. device: what it runs on, in words (e.g. reception tablet). frame: how it is drawn. Parts are drawn top to bottom. A screen stays as defined until you define it again.",
    input: { type: "object", properties: { name: { type: "string" }, device: { type: "string" }, frame: { type: "string", enum: ["website", "phone", "desktop", "iot", "terminal", "watch", "panel"] }, parts: { type: "array", items: part } }, required: ["name", "device", "frame", "parts"] },
    run: ({ world }, a) => {
      const bad = (a.parts || []).filter(p => !KINDS.includes(p.kind)).map(p => p.kind);
      if (bad.length) return fail(`unknown part kinds: ${bad.join(", ")}. Use: ${KINDS.join(", ")}`);
      // each kind's required fields (shape only)
      const NEED = { heading: ["text"], text: ["text"], metric: ["label", "text"], badge: ["text"], button: ["text"], input: ["name"], select: ["name", "options"], list: ["collection"], table: ["collection"], chart: ["collection"], drawing: ["value"], page: ["value"], stage: ["value"], speak: ["text"], image: ["text"] };
      const missing = [];
      const look = (list, where) => list.forEach((p, i) => { for (const k of NEED[p.kind] || []) if (p[k] === undefined || p[k] === "") missing.push(`${where}[${i}] ${p.kind} needs ${k}`); if (p.where && typeof p.where === "object" && Object.keys(p.where).length !== 1) missing.push(`${where}[${i}] ${p.kind} where must name exactly one property (it has ${Object.keys(p.where).length})`); if (p.row) look(p.row, `${where}[${i}].row`) });
      look(a.parts || [], "parts");
      if (missing.length) return fail("not saved, fix and call again: " + missing.slice(0, 12).join("; "));
      const s = { name: a.name, device: a.device, frame: a.frame, parts: a.parts };
      const d = world.data, i = d.screens.findIndex(x => x.name === a.name);
      if (i >= 0) d.screens[i] = s; else d.screens.push(s);
      world.changed("screens"); return text(`screen "${a.name}" saved with ${a.parts.length} parts`);
    } },
  { name: "notify", roles: ["event", "request"],
    description: "Show a short message to the person using the system.",
    input: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
    run: ({ emit }, a) => { emit({ type: "notice", text: a.text }); return text("shown") } },
  { name: "look", roles: ["event"],
    description: "See the camera picture that came with this event.",
    input: { type: "object", properties: {} },
    run: ({ turn }) => turn.images && turn.images.length
      ? { content: turn.images.map(d => { const m = /^data:([^;]+);base64,(.+)$/.exec(d) || []; return { type: "image", mimeType: m[1] || "image/jpeg", data: m[2] || "" } }) }
      : fail("no camera picture came with this event") },
  { name: "listen", roles: ["event"],
    description: "Hear what came with this event from the microphone or the earphone output: loudness, level per band, rising bands, words heard.",
    input: { type: "object", properties: {} },
    run: ({ turn }) => turn.sound ? text(turn.sound) : fail("no sound came with this event") },
  { name: "play_sounds", roles: ["setup", "event", "request"],
    description: "Set the test sounds the sounds part plays (replaces the list). Each sound follows the exact shape.",
    input: { type: "object", properties: { sounds: { type: "array", items: CONTRACTS.sounds } }, required: ["sounds"] },
    run: ({ world }, a) => { world.data.output.sounds = a.sounds; world.changed("state"); return text(`${a.sounds.length} test sounds set`) } },
  { name: "shape_sound", roles: ["setup", "event", "request"],
    description: "Set the bands the output part applies to the sound going to the earphones (replaces the list).",
    input: { type: "object", properties: { bands: { type: "array", items: CONTRACTS.output } }, required: ["bands"] },
    run: ({ world }, a) => { world.data.output.bands = a.bands; world.changed("state"); return text(`${a.bands.length} bands set`) } },
  { name: "speak", roles: ["event", "request"],
    description: "Say something aloud through the person's speakers or earphones.",
    input: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
    run: ({ emit }, a) => { emit({ type: "speak", text: a.text }); return text("spoken") } },
  { name: "draw", roles: ["setup", "event", "request"],
    description: "Draw a picture as SVG into a named value; a drawing part shows it. The picture can be the face itself (a board, a map, cards, a scene): give any element data-intent=\"what touching it means, in plain words\" and touching it sends you that intent, with the element's other data-* attributes as inputs (e.g. data-cell=\"b3\"). Text may name values in braces, e.g. {score}, so it follows the world without redrawing. It may move (SVG animate, CSS in a style element). No scripts, no outside images.",
    input: { type: "object", properties: { value: { type: "string" }, svg: { type: "string" } }, required: ["value", "svg"] },
    run: ({ world }, a) => { if (!/^\s*<svg[\s>]/.test(a.svg)) return fail("svg must start with <svg"); if (world.data.collections[a.value]) return fail(`"${a.value}" is the name of a collection; use another name`); world.data.values[a.value] = a.svg; world.changed("state"); return text("drawn") } },
  { name: "write_page", roles: ["setup", "event", "request"],
    description: "Write a face of your own as HTML and CSS into a named value; a page part shows it exactly as written (scoped to that screen). Use it when the look and layout matter and the ordinary parts would flatten the idea. No scripts and nothing from outside (no links, images by URL, fonts); inline SVG and emoji are fine. Set both the background and the text colour of what you write (the device frame around it may be light or dark). Text and attributes may name values in braces ({score}, style=\"width:{percent}%\"). <template data-each=\"collection\" data-where='{\"property\":value}' data-sort=\"property\" data-empty=\"…\">…{property}…</template> is written once per item. Anything with data-intent=\"…\" can be touched and sends you that intent with its other data-* attributes, the item it was written for, and the values of the page's named input/select/textarea fields; a field with data-intent sends when changed. data-key=\"ArrowLeft\" lets a key do the same; data-point adds where it was touched (px, py from 0 to 1); an element with data-drag can be dropped on one with data-drop-intent=\"…\", which sends that intent with both.",
    input: { type: "object", properties: { value: { type: "string" }, html: { type: "string" } }, required: ["value", "html"] },
    run: ({ world }, a) => { if (/<script[\s>]/i.test(a.html)) return fail("not saved: a page cannot hold scripts; what happens is yours to do when an intent reaches you"); if (world.data.collections[a.value]) return fail(`"${a.value}" is the name of a collection; use another name`); world.data.values[a.value] = a.html; world.changed("state"); return text("page written") } },
  { name: "set_stage", roles: ["setup", "event", "request"],
    description: "For what must move or answer many times a second (things falling, flowing, bouncing, steered by keys or the pointer), where you cannot answer each instant yourself: declare bodies and reflex rules into a named value; a stage part runs them every frame on the person's device. Reflexes only move, remove, spawn and count; everything that means something (a level cleared, a life lost, a pose to judge) you ask to be told with do:\"tell\" and decide yourself — then change values, or set the stage again for what comes next (setting it restarts it). Rules: when \"touch\" (a meets b), \"edge\" (a reaches an edge), \"every\" (seconds), \"key\", \"tap\" (a, or anywhere), \"count\" (a counter reaches a number from where it started, rising or falling; once). Each rule's then is a list of {do:\"bounce\"|\"remove\"|\"stop\"|\"set\"|\"spawn\"|\"count\"|\"pause\"|\"resume\"|\"tell\"}; who is \"a\", \"b\", an id or a tag. tell sends you its intent with the counters, the seconds run and the bodies involved; pause:true holds the stage until you have answered; picture:true sends a camera picture too (with camera:true the camera is the stage's background).",
    input: { type: "object", properties: { value: { type: "string" }, stage: { type: "object", properties: {
      width: { type: "number" }, height: { type: "number" }, background: { type: "string" }, camera: { type: "boolean" }, counters: { type: "object" },
      bodies: { type: "array", items: BODY },
      rules: { type: "array", items: { type: "object", properties: {
        when: { type: "string", enum: ["touch", "edge", "every", "key", "tap", "count"] }, a: { type: "string", description: "id or tag" }, b: { type: "string" },
        edge: { type: "string", enum: ["left", "right", "top", "bottom", "any"] }, seconds: { type: "number" }, key: { type: "string" }, counter: { type: "string" }, reaches: { type: "number" },
        then: { type: "array", items: { type: "object", properties: { do: { type: "string", enum: ["bounce", "remove", "stop", "set", "spawn", "count", "pause", "resume", "tell"] }, who: { type: "string" }, props: { type: "object" }, body: BODY, counter: { type: "string" }, by: {}, intent: { type: "string" }, pause: { type: "boolean" }, picture: { type: "boolean" } }, required: ["do"] } } }, required: ["when", "then"] } } }, required: ["width", "height", "bodies"] } }, required: ["value", "stage"] },
    run: ({ world }, a) => { if (world.data.collections[a.value]) return fail(`"${a.value}" is the name of a collection; use another name`); world.data.values[a.value] = a.stage; world.changed("state"); return text(`stage set with ${a.stage.bodies.length} bodies and ${(a.stage.rules || []).length} rules`) } },
  { name: "set_timer", roles: ["setup", "request"],
    description: "Run an intent every N seconds while the system is open (e.g. time passing, a sensor drifting). Same name replaces; everySec 0 removes; otherwise at least 5.",
    input: { type: "object", properties: { name: { type: "string" }, everySec: { type: "number" }, intent: { type: "string" } }, required: ["name", "everySec", "intent"] },
    run: ({ world }, a) => {
      if (a.everySec > 0 && a.everySec < 5) return fail("everySec must be 0 (remove) or at least 5; nothing was set");
      const d = world.data; d.timers = d.timers.filter(t => t.name !== a.name);
      if (a.everySec > 0) d.timers.push({ name: a.name, every: a.everySec, intent: a.intent });
      world.changed("timers"); return text(a.everySec > 0 ? "timer set" : "timer removed");
    } },
  { name: "write_brief", roles: ["setup", "request"],
    description: "Write the system's name and its brief: how it behaves, its roles, rules and what each intent should do. You get this brief on every turn.",
    input: { type: "object", properties: { name: { type: "string" }, lang: { type: "string", description: "language code of everything the person sees, e.g. ja, en" }, brief: { type: "string" } }, required: ["name", "brief"] },
    run: ({ world }, a) => { Object.assign(world.data, { name: a.name, brief: a.brief }, a.lang ? { lang: a.lang } : {}); world.changed("brief"); return text("brief saved") } },
  { name: "add_check", roles: ["setup", "request"],
    description: "Add a test scenario: the steps a person takes (intent, inputs, which item in words) and what must be true afterwards.",
    input: { type: "object", properties: { name: { type: "string" }, steps: { type: "array", items: { type: "object", properties: { intent: { type: "string" }, inputs: { type: "object" }, item: { type: "string", description: "which item the step acts on, in words; empty if none" } }, required: ["intent"] } }, expect: { type: "array", items: { type: "string" } } }, required: ["name", "steps", "expect"] },
    run: ({ world }, a) => { const d = world.data; d.checks = d.checks.filter(c => c.name !== a.name); d.checks.push(a); world.changed("checks"); return text("check saved") } },
  { name: "remove_check", roles: ["setup", "request"],
    description: "Remove a test scenario by its name.",
    input: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
    run: ({ world }, a) => { const d = world.data, n = d.checks.length; d.checks = d.checks.filter(c => c.name !== a.name); if (d.checks.length === n) return fail(`no check named "${a.name}". Existing: ${d.checks.map(c => c.name).join(", ") || "(none)"}`); world.changed("checks"); return text("check removed") } },
  { name: "set_reality", roles: ["setup", "request"],
    description: "Estimate how this idea would behave if built today with existing, shippable technology. Give one entry per intent: how each part of what that intent does would really be built (ordinary code, a model, an outside service, or not possible yet), how often it would go wrong and how late it would answer. The 'existing technology' switch makes the system behave like this, intent by intent.",
    input: { type: "object", properties: { summary: { type: "string" }, items: { type: "array", items: { type: "object", properties: { part: { type: "string" }, existing: { type: "string" }, effect: { type: "string" } }, required: ["part", "existing", "effect"] } },
      intents: { type: "array", items: { type: "object", properties: {
        intent: { type: "string", description: "the intent exactly as screens and timers send it" },
        parts: { type: "array", items: { type: "object", properties: {
          what: { type: "string", description: "one thing this intent does" },
          builtWith: { type: "string", enum: ["code", "model", "service", "not_yet"] },
          detail: { type: "string", description: "which rule, model, service or missing technology, and why" } }, required: ["what", "builtWith", "detail"] } },
        errorRate: { type: "number", description: "0–1, how often the shippable version gets this intent wrong" },
        delayMs: { type: "number", description: "how long the shippable version takes to answer" },
        mistakes: { type: "string", description: "how it typically goes wrong" } }, required: ["intent", "parts", "errorRate", "delayMs", "mistakes"] } },
      audioLatencyMs: { type: "number" }, leak: { type: "number" }, decisionDelayMs: { type: "number" }, errorRate: { type: "number" }, minIntervalSec: { type: "number" }, cpuNote: { type: "string" } },
      required: ["summary", "items", "intents", "audioLatencyMs", "leak", "decisionDelayMs", "errorRate", "minIntervalSec", "cpuNote"] },
    run: ({ world }, a) => { world.data.reality = a; world.changed("reality"); return text("reality estimate saved") } },
];

// Shape check against a hand's input schema: required fields and basic types, one level into arrays.
// It reports what is wrong in words and decides nothing else.
export function shapeProblems(schema, value, path = "input") {
  const out = [];
  const typeOf = v => Array.isArray(v) ? "array" : v === null ? "null" : typeof v;
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

export const handsFor = role => HANDS.filter(h => h.roles.includes(role));
export { facePart };
