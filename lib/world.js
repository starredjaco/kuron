// The world a kuron system lives in. It stores whatever the LLM decides to keep and knows nothing about
// any idea: collections of items, single values, screens, timers, the system's brief, checks, the
// reality estimate and what the sound output is doing.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const empty = () => ({ name: "", idea: "", brief: "", lang: "ja", values: {}, collections: {}, screens: [], timers: [], checks: [], reality: null, output: { sounds: [], bands: [] }, nextId: 1 });
const clone = x => JSON.parse(JSON.stringify(x));

export class World {
  constructor(file = null, data = null) {
    this.file = file;
    this.data = data ? clone(data) : (file && existsSync(file) ? { ...empty(), ...JSON.parse(readFileSync(file, "utf8")) } : empty());
    this.listeners = new Set(); this.saveTimer = null;
  }
  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn) }
  changed(what) {
    for (const f of this.listeners) f(what);
    if (!this.file) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => { mkdirSync(dirname(this.file), { recursive: true }); writeFileSync(this.file, JSON.stringify(this.data, null, 1)) }, 200);
  }
  copy() { return new World(null, this.data) }

  // What the face draws from: values and collections side by side, plus what the sound output plays.
  view() { return { ...clone(this.data.values), ...clone(this.data.collections), __sounds: clone(this.data.output.sounds), __bands: clone(this.data.output.bands) } }

  overview({ samples = 2 } = {}) {
    const d = this.data;
    return {
      name: d.name, brief: d.brief, values: d.values,
      collections: Object.fromEntries(Object.entries(d.collections).map(([k, v]) => [k, {
        count: v.length, properties: [...new Set(v.flatMap(x => Object.keys(x)))], sample: v.slice(-samples) }])),
      screens: d.screens.map(s => ({ name: s.name, device: s.device, intents: [...new Set(s.parts.flatMap(p => [p.intent, ...(p.row || []).map(r => r.intent)]).filter(Boolean))] })),
      timers: d.timers, output: d.output,
      checks: d.checks.map(c => ({ name: c.name, steps: c.steps, expect: c.expect })),
    };
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
      // a collection comes into being only by adding to it, and never under the name of a value (the face reads both by name)
      if (!d.collections[c.collection]) {
        if (c.op !== "add") { problems.push(where + `: there is no collection "${c.collection}"${d.values[c.collection] !== undefined ? " (that name is a value: set it with values, or with the hand that wrote it)" : ""}`); continue }
        if (d.values[c.collection] !== undefined) { problems.push(where + `: "${c.collection}" is already the name of a value; use another name`); continue }
      }
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
    if (values && typeof values === "object") for (const [k, v] of Object.entries(values)) { if (d.collections[k]) { problems.push(`value "${k}": that name is a collection; use another name`); continue } d.values[k] = v; done.push({ op: "value", name: k }) }
    if (done.length) this.changed("state");
    return { done, problems };
  }
}
