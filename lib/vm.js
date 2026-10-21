// The Kuron VM. The local LLM is the CPU: every action runs as one instruction batch over the
// current state, and the result is constrained by the state's JSON schema so the system stays valid.
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { chat } from "./llm.js";
import { langName } from "./source.js";

const clone = x => JSON.parse(JSON.stringify(x));

// Apply a CPU patch to a list of records: update → remove → add → order.
export function patch(list, p = {}) {
  const items = list.map((x, i) => ({ i, x: { ...x } }));
  for (const u of p.update || []) { const it = items.find(y => y.i === u._index); if (it && u.set) Object.assign(it.x, u.set) }
  const rm = new Set(p.remove || []);
  let next = items.filter(y => !rm.has(y.i));
  let n = list.length;
  for (const a of p.add || []) next.push({ i: n++, x: a });
  const order = (p.order || []).filter(i => next.some(y => y.i === i));
  if (order.length) { const pos = new Map(order.map((i, k) => [i, k])); next.sort((a, b) => (pos.has(a.i) ? pos.get(a.i) : 1e9 + a.i) - (pos.has(b.i) ? pos.get(b.i) : 1e9 + b.i)) }
  return next.map(y => y.x);
}

export class VM {
  constructor(ir, { dir = null, onEvent = () => { } } = {}) {
    this.ir = ir; this.dir = dir; this.onEvent = onEvent;
    this.sessions = new Map(); this.traces = [];
    this.realityOn = false; // "existing technology" mode: behave like a shippable implementation would
  }
  setIR(ir) {
    // keep running sessions across a recompile: values of fields that still exist with the same type survive
    const old = this.ir; this.ir = ir;
    for (const s of this.sessions.values()) {
      const next = clone(ir.state.initial);
      for (const f of ir.state.fields) { const of = old.state.fields.find(x => x.name === f.name); if (of && of.type === f.type && f.name in s.state) next[f.name] = s.state[f.name] }
      s.state = next;
    }
  }
  async newSession({ silent = false } = {}) {
    const id = randomUUID().slice(0, 8);
    const s = { id, state: clone(this.ir.state.initial), queue: Promise.resolve(), notices: [] };
    this.sessions.set(id, s);
    if (this.sessions.size > 50) this.sessions.delete(this.sessions.keys().next().value);
    if (this.ir.events.__start) await this.dispatch(id, "__start", {}, { silent });
    return s;
  }
  // Bring back a saved session: fields that still exist with the same type keep their saved values.
  restore(id, saved) {
    const s = { id, state: clone(this.ir.state.initial), queue: Promise.resolve(), notices: [] };
    for (const f of this.ir.state.fields) if (saved && f.name in saved) s.state[f.name] = saved[f.name];
    this.sessions.set(id, s);
    return s;
  }
  get(id) { return this.sessions.get(id) }

  dispatch(sid, action, payload = {}, opt = {}) {
    const s = this.sessions.get(sid); if (!s) return Promise.reject(new Error("no_session"));
    const run = s.queue.then(() => this.exec(s, action, payload, opt));
    s.queue = run.catch(() => { });
    return run;
  }

  async exec(s, action, { inputs = {}, list = "", index = -1, images = [] } = {}, { silent = false } = {}) {
    const ev = this.ir.events[action]; if (!ev) throw new Error("unknown_action: " + action);
    const fields = this.ir.state.fields;
    const writes = ev.writes.filter(w => fields.some(f => f.name === w));
    const touched = [...new Set([...ev.reads, ...writes])].filter(n => n in s.state);
    const isRecords = n => fields.find(f => f.name === n)?.type === "records";
    // lists of records are shown with their index and edited with patches, so the CPU never rewrites a whole list
    const view = Object.fromEntries(touched.map(n => [n, isRecords(n) && Array.isArray(s.state[n]) ? s.state[n].map((x, i) => ({ _index: i, ...x })) : s.state[n]]));
    const target = list && index >= 0 && Array.isArray(s.state[list]) ? { list, index, item: s.state[list][index] ?? null } : null;
    const props = {};
    for (const w of writes) {
      const sch = this.ir.state.schema.properties[w];
      if (isRecords(w)) {
        const item = sch.items, partial = { type: "object", properties: item.properties };
        props[w] = { type: "object", properties: {
          add: { type: "array", items: item },
          update: { type: "array", items: { type: "object", properties: { _index: { type: "number" }, set: partial }, required: ["_index", "set"] } },
          remove: { type: "array", items: { type: "number" } },
          order: { type: "array", items: { type: "number" } } }, required: ["add", "update", "remove", "order"] };
      } else props[w] = sch;
    }
    const schema = { type: "object", properties: { changes: { type: "object", properties: props, required: writes }, notice: { type: "string" } }, required: ["changes", "notice"] };
    const L = langName(this.ir.lang);
    const system = `You are the CPU of Kuron, a programming language executed by a large language model.
Execute the instructions in order against the current state and return the changes for the fields you were told to write.
When an instruction asks for judgement, prediction, generation or anything an ordinary program could not do, actually do it, concretely and realistically.
Follow every length and form the instructions or field descriptions state exactly (one sentence means a single sentence with one full stop; N characters means at most N).
When an instruction says what a text must contain (a name, a reason, a number), it must literally contain it.
Plain fields: return their complete new value (unchanged if the instructions do not change them).
Lists of records are edited, never rewritten: "add" = new items to append; "update" = {_index, set: only the changed properties} for existing items (by their _index); "remove" = _index values to delete; "order" = the new order as a list of _index values (new items get the next numbers after the last existing _index), or [] to keep the order.
Text you create is written in ${L}. notice: one short sentence the user sees after the action, or "" if nothing worth saying.`;
    const R = this.realityOn && this.ir.reality;
    const sys = R ? system + `\nTHIS RUN SIMULATES THE EXISTING-TECHNOLOGY VERSION, not the ideal one. ${R.cpuNote} About ${Math.round((R.errorRate || 0) * 100)}% of judgements should go wrong the way that implementation goes wrong, and coarse or late where it would be.` : system;
    const user = JSON.stringify({ system: this.ir.name + " — " + this.ir.desc, action: action === "__start" ? "on start" : action, instructions: ev.steps, inputs, target, fields: Object.fromEntries(fields.filter(f => touched.includes(f.name)).map(f => [f.name, f.desc])), state: view, write: writes }, null, 1);
    const t0 = Date.now();
    const trace = { id: randomUUID().slice(0, 8), at: new Date().toISOString(), sid: s.id, action, inputs, target, steps: ev.steps, before: clone(Object.fromEntries(writes.map(w => [w, s.state[w]]))) };
    try {
      const { value, cost } = await chat({ model: this.ir.model, system: sys, user, schema, temperature: R ? 0.6 : 0.2, images });
      if (R && R.decisionDelayMs > 0) await new Promise(r => setTimeout(r, Math.min(5000, R.decisionDelayMs)));
      if (R) trace.reality = true;
      if (images.length) trace.images = images.length;
      if (cost != null) trace.cost = cost;
      const ch = value.changes || {};
      for (const w of writes) {
        if (!(w in ch)) continue;
        s.state[w] = isRecords(w) ? patch(s.state[w] || [], ch[w]) : ch[w];
      }
      trace.after = clone(Object.fromEntries(writes.map(w => [w, s.state[w]]))); trace.patch = clone(ch); trace.notice = value.notice || ""; trace.ms = Date.now() - t0;
      if (trace.notice) s.notices.push(trace.notice);
    } catch (e) { trace.error = e.message; trace.ms = Date.now() - t0 }
    this.record(trace, silent);
    if (trace.error) throw new Error(trace.error);
    return { state: s.state, notice: trace.notice, ms: trace.ms, trace };
  }

  record(trace, silent) {
    this.traces.push(trace); if (this.traces.length > 300) this.traces.shift();
    if (this.dir) { mkdirSync(this.dir, { recursive: true }); appendFileSync(join(this.dir, "traces.jsonl"), JSON.stringify(trace) + "\n") }
    if (!silent) this.onEvent({ type: "trace", trace });
  }

  // Run every scenario in a fresh session, then let the LLM judge each expectation against the final state.
  async check({ onProgress = () => { } } = {}) {
    const L = langName(this.ir.lang), out = [];
    for (const c of this.ir.checks) {
      const r = { name: c.name, text: c.text, ln: c.ln, steps: [], expect: [], ok: true };
      onProgress({ check: c.name });
      try {
        const s = await this.newSession({ silent: true });
        const initialState = clone(s.state);
        for (const st of c.steps) {
          let index = st.index;
          if (st.list && st.matchField && Array.isArray(s.state[st.list])) {
            const want = String(st.matchValue ?? "").trim();
            const items = s.state[st.list];
            let i = items.findIndex(x => x && String(x[st.matchField] ?? "").trim() === want);
            if (i < 0) i = items.findIndex(x => x && String(x[st.matchField] ?? "").includes(want));
            if (i < 0) throw new Error(`no item with ${st.matchField} = ${want} in ${st.list}`);
            index = i;
          }
          const res = await this.dispatch(s.id, st.action, { inputs: st.inputs, list: st.list, index }, { silent: true });
          r.steps.push({ action: st.action, inputs: st.inputs, ms: res.ms, notice: res.notice });
        }
        for (const e of c.expect) {
          const { value } = await chat({ model: this.ir.model, temperature: 0,
            system: `You judge a test of a system built in Kuron. Decide strictly whether the expectation holds for the final state.
Pass only if the final state itself shows it (compare with state_before_scenario for anything about changes); notices are not evidence. Missing, empty or placeholder values mean fail.
When the expectation is about a particular item, find that item (by the name used in the scenario) and judge only that item; other items never count as evidence. Explain briefly in ${L}, quoting the values you looked at.`,
            user: JSON.stringify({ system: this.ir.name, scenario: c.text, expectation: e, state_before_scenario: initialState, final_state: s.state, notices: s.notices }, null, 1),
            schema: { type: "object", properties: { pass: { type: "boolean" }, reason: { type: "string" } }, required: ["pass", "reason"] } });
          r.expect.push({ text: e, pass: value.pass, reason: value.reason });
          if (!value.pass) r.ok = false;
        }
        r.final = s.state;
      } catch (e) { r.ok = false; r.error = e.message }
      out.push(r);
    }
    return out;
  }
}
