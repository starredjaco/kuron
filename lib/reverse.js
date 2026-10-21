// Reverse engineering: the compiled IR and the CPU's recorded executions become a specification
// and golden examples that a real implementation must reproduce.
import { readFileSync, existsSync } from "node:fs";

const KIND_LINE = c => {
  const bits = [c.kind];
  if (c.text) bits.push(`"${c.text}"`);
  if (c.label) bits.push(`label "${c.label}"`);
  if (c.name) bits.push(`input ${c.name}${c.inputType ? " (" + c.inputType + ")" : ""}`);
  if (c.options && c.options.length) bits.push(`options ${c.options.join("/")}`);
  if (c.source) bits.push(`from ${c.source}`);
  if (c.whereField) bits.push(`where ${c.whereField} = ${c.whereValue}`);
  if (c.sortField) bits.push(`sort by ${c.sortField}${c.sortDesc ? " desc" : ""}`);
  if (c.action) bits.push(`→ action ${c.action}`);
  if (c.goto) bits.push(`→ screen ${c.goto}`);
  return bits.join(" · ");
};

export function loadTraces(file, limitPerAction = 4) {
  if (!existsSync(file)) return {};
  const by = {};
  for (const l of readFileSync(file, "utf8").split("\n")) {
    if (!l.trim()) continue;
    try { const t = JSON.parse(l); if (t.error) continue; (by[t.action] ||= []).push(t) } catch { }
  }
  for (const k in by) by[k] = by[k].slice(-limitPerAction);
  return by;
}

export function buildSpec(ir, { source = "", traces = {}, checks = null } = {}) {
  const L = [];
  L.push(`# ${ir.name} — specification from a running Kuron prototype`, "", ir.desc || "", "");
  L.push("## State", "", "```json", JSON.stringify(ir.state.schema, null, 2), "```", "");
  ir.state.fields.forEach(f => L.push(`- **${f.name}** (${f.type}) — ${f.desc || ""}`));
  L.push("", "Initial value:", "", "```json", JSON.stringify(ir.state.initial, null, 2), "```", "");
  L.push("## Screens", "");
  for (const s of ir.screens) {
    L.push(`### ${s.name} (${s.formLabel || s.form})`, "");
    for (const c of s.view) { L.push("- " + KIND_LINE(c)); for (const r of c.row || []) L.push("  - row: " + KIND_LINE(r)) }
    L.push("");
  }
  L.push("## Actions", "");
  for (const [name, e] of Object.entries(ir.events)) {
    L.push(`### ${name === "__start" ? "(on start)" : name}${e.every ? ` — every ${e.every}s` : ""}`, "");
    L.push(`reads: ${e.reads.join(", ") || "-"} · writes: ${e.writes.join(", ") || "-"} · inputs: ${e.inputs.join(", ") || "-"}`, "");
    e.steps.forEach((s, i) => L.push(`${i + 1}. ${s}`));
    const ex = traces[name] || [];
    if (ex.length) {
      L.push("", "Observed executions (golden examples):", "");
      for (const t of ex) L.push("```json", JSON.stringify({ inputs: t.inputs, target: t.target, before: t.before, after: t.after, notice: t.notice, ms: t.ms }, null, 1), "```");
    }
    L.push("");
  }
  L.push("## Checks", "");
  for (const c of ir.checks) {
    const r = checks && checks.find(x => x.name === c.name);
    L.push(`- ${c.text}${r ? (r.ok ? "  ✅ passed on the prototype" : "  ❌ failed on the prototype") : ""}`);
    c.expect.forEach(e => L.push(`  - expect: ${e}`));
  }
  if (source) L.push("", "## Original Kuron program", "", "```", source.trim(), "```");
  return L.join("\n") + "\n";
}

export function examplesJsonl(traces) {
  return Object.values(traces).flat().map(t => JSON.stringify({ action: t.action, inputs: t.inputs, target: t.target, before: t.before, after: t.after })).join("\n") + "\n";
}
