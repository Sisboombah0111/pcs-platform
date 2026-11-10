/**
 * BOM revisions: save what the BOM says now (Rev A, Rev B …) and compare any two states later.
 *
 * A revision keeps the results, by material and unit operation CODE (not ids): the lines that are
 * counted and the totals (to buy, prepared in-house), per scenario. Comparing two states gives, for the
 * lines (unit operation × material) and for the totals (material), what was added, removed or changed.
 * Revisions saved since N4.11 also keep the material and unit operation ids, so a material whose code
 * changed reads as "changed (code A → B)"; with an older revision it reads as removed + added.
 * N5.6: a material replaced by another (Materials › Replace…, the old one marked obsolete) reads as one
 * "replaced" row, not removed + added; revisions keep the materials' details (spec, supplier, part no. …),
 * so the comparison also lists what changed on the materials themselves, before → after. Pure: no React.
 */
import type { BomResult } from "./model";
import type { BomRevision, Material, MaterialSnap, Project, ScenarioValues } from "../model/types";
import { newId } from "../model/ids";
import { BASIC_DETAILS, changeText, detailChanges, PURCHASE_DETAILS, SNAP_DETAILS, type MaterialDetails } from "../model/materialDiff";

export type ChangeKind = "added" | "removed" | "replaced" | "changed" | "same";

export interface Change {
  kind: ChangeKind;
  /** Line: "PROA|BUF-1001"; total: "BUF-1001". */
  key: string;
  uo?: string;
  code: string;
  name: string;
  unit: string;
  category?: string;
  /** The material's id (revisions saved since N4.11). */
  mid?: string;
  before: ScenarioValues | null;
  after: ScenarioValues | null;
  /** after − before per scenario (missing side = 0; null when a replaced material had another unit). */
  delta: ScenarioValues;
  /** What else changed on a line: source, unit, name. */
  notes: string[];
  /** "replaced": the material it replaced, as it was in the first state. */
  was?: { code: string; name: string; unit: string };
}

/** One change on a material itself: replaced, a detail edited (one row per detail), added to or gone from the BOM. */
export interface MaterialChange {
  kind: "replaced" | "edited" | "added" | "removed";
  code: string;
  name: string;
  was?: { code: string; name: string; unit: string };
  /** "Material" (replaced, added, removed) or the detail: "Name", "Spec", "Part no." … */
  what: string;
  before: string;
  after: string;
  /** Where it is used (in the second state; in the first when removed): unit operation codes, or "recipes". */
  uos: string;
}

export interface Comparison {
  from: string;
  to: string;
  scenarios: { id: string; name: string }[];
  lines: Change[];
  totals: Change[];
  /** What changed on the materials (replaced, details before → after, added, removed). */
  materials: MaterialChange[];
  /** One of the two states was saved before N5.6: only code, name, unit and category can be compared. */
  materialsPartial: boolean;
  count: { added: number; removed: number; replaced: number; changed: number };
}

const snapOf = (m: Material, all?: readonly Material[]): MaterialSnap => {
  const s: MaterialSnap = { mid: m.id, code: m.code, name: m.name, unit: m.unit };
  for (const k of ["category", "spec", "supplier", "partNo"] as const) if (m[k]) s[k] = m[k];
  if (m.packSize != null) s.packSize = m.packSize;
  if (m.status) s.status = m.status;
  const by = m.replacedBy ? all?.find((x) => x.id === m.replacedBy)?.code : undefined;
  if (by) s.replacedBy = by;
  return s;
};

/**
 * The BOM as it is now, in revision form (label, note and author added by `makeRevision`). `all` (the
 * project's materials) gives the code of the material that replaced an obsolete one.
 */
export function snapshotBom(bom: BomResult, all?: readonly Material[]): Pick<BomRevision, "scenarios" | "lines" | "totals" | "materials"> {
  const scen = bom.scenarios.map((s) => ({ id: s.id, name: s.name }));
  const lines: BomRevision["lines"] = [];
  const used = new Map<string, Material>();
  for (const u of bom.uos) {
    for (const r of u.rows) {
      if (r.line.excluded) continue;
      const line: BomRevision["lines"][number] = {
        uo: u.uo.code, uoName: u.uo.name, code: r.material.code, name: r.material.name, unit: r.material.unit,
        source: r.line.qtySource, qty: { ...r.qty }, mid: r.material.id, uoId: u.uo.id,
      };
      if (r.material.category) line.category = r.material.category;
      if (r.batches) line.batches = { ...r.batches };
      lines.push(line);
      used.set(r.material.id, r.material);
    }
  }
  const totals: BomRevision["totals"] = [
    ...bom.totals.map((t) => ({ code: t.material.code, name: t.material.name, unit: t.material.unit, kind: "buy" as const, qty: { ...t.qty }, mid: t.material.id, ...(t.material.category ? { category: t.material.category } : {}) })),
    ...bom.prepared.map((t) => ({ code: t.material.code, name: t.material.name, unit: t.material.unit, kind: "prep" as const, qty: { ...t.qty }, mid: t.material.id, ...(t.material.category ? { category: t.material.category } : {}) })),
  ];
  for (const t of [...bom.totals, ...bom.prepared]) used.set(t.material.id, t.material);
  const materials = [...used.values()].map((m) => snapOf(m, all)).sort((a, b) => a.code.localeCompare(b.code));
  return { scenarios: scen, lines, totals, materials };
}

/** "Rev A" … "Rev Z", "Rev AA" …: the next label after the revisions there are. */
export function nextLabel(revisions: readonly BomRevision[]): string {
  const letters = (n: number): string => (n < 26 ? String.fromCharCode(65 + n) : letters(Math.floor(n / 26) - 1) + String.fromCharCode(65 + (n % 26)));
  const taken = new Set(revisions.map((r) => r.label));
  for (let i = revisions.length; ; i++) { const l = `Rev ${letters(i)}`; if (!taken.has(l)) return l; }
}

export function makeRevision(p: Project, bom: BomResult, meta: { label?: string; note?: string; by?: string; now?: string }): BomRevision {
  const revs = p.bom.revisions ?? [];
  const r: BomRevision = {
    id: newId("rev"),
    label: meta.label?.trim() || nextLabel(revs),
    createdAt: meta.now ?? new Date().toISOString(),
    ...snapshotBom(bom, p.materials),
  };
  if (meta.note?.trim()) r.note = meta.note.trim();
  if (meta.by?.trim()) r.createdBy = meta.by.trim();
  if (p.mb.current?.fileName) r.mbFile = p.mb.current.fileName;
  return r;
}

export const addRevision = (p: Project, r: BomRevision): Project => ({ ...p, bom: { ...p.bom, revisions: [...(p.bom.revisions ?? []), r] } });
export const deleteRevision = (p: Project, id: string): Project => {
  const revisions = (p.bom.revisions ?? []).filter((r) => r.id !== id);
  const bom = { ...p.bom };
  if (revisions.length) bom.revisions = revisions; else delete bom.revisions;
  return { ...p, bom };
};
/** The newest revision, or null. */
export const latestRevision = (p: Pick<Project, "bom">): BomRevision | null => (p.bom.revisions?.length ? p.bom.revisions[p.bom.revisions.length - 1] : null);

const close = (a: number | null | undefined, b: number | null | undefined) => (a ?? null) === (b ?? null) || (a != null && b != null && Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b)));
const ORDER: Record<ChangeKind, number> = { added: 0, removed: 1, replaced: 2, changed: 3, same: 4 };
const byKind = (p: Change, q: Change) => ORDER[p.kind] - ORDER[q.kind] || (p.uo ?? "").localeCompare(q.uo ?? "") || p.code.localeCompare(q.code);

function diff<T extends { code: string; name: string; unit: string; category?: string; qty: ScenarioValues; mid?: string }>(
  before: readonly T[], after: readonly T[], keyOf: (x: T) => string, scen: string[], extra: (a: T, b: T) => string[], uoOf?: (x: T) => string,
): Change[] {
  const a = new Map(before.map((x) => [keyOf(x), x]));
  const b = new Map(after.map((x) => [keyOf(x), x]));
  const keys = [...new Set([...a.keys(), ...b.keys()])];
  const out: Change[] = [];
  for (const key of keys) {
    const x = a.get(key), y = b.get(key);
    const ref = (y ?? x)!;
    const delta: ScenarioValues = {};
    for (const s of scen) {
      const p = x?.qty[s] ?? null, q = y?.qty[s] ?? null;
      delta[s] = p == null && q == null ? null : Number(((q ?? 0) - (p ?? 0)).toPrecision(12));
    }
    const notes = x && y ? extra(x, y) : [];
    const kind: ChangeKind = !x ? "added" : !y ? "removed" : scen.some((s) => !close(x.qty[s], y.qty[s])) || notes.length ? "changed" : "same";
    const c: Change = { kind, key, code: ref.code, name: ref.name, unit: ref.unit, before: x ? { ...x.qty } : null, after: y ? { ...y.qty } : null, delta, notes };
    if (ref.category) c.category = ref.category;
    if (ref.mid) c.mid = ref.mid;
    if (uoOf) c.uo = uoOf(ref);
    out.push(c);
  }
  return out.sort(byKind);
}

/** The materials that replaced `mid`, nearest first (A replaced by B, B later by C: B, C). */
const chainOf = (next: ReadonlyMap<string, string>, mid: string): string[] => {
  const out: string[] = [];
  const seen = new Set([mid]);
  for (let cur = next.get(mid); cur && !seen.has(cur); cur = next.get(cur)) { out.push(cur); seen.add(cur); }
  return out;
};

/**
 * A removed material whose replacement was added in the same place (unit operation, or the totals) becomes
 * one "replaced" row: before = the old material's quantities, after = the new one's. When the replacement
 * was there already, the removed row says so.
 */
function pairReplaced(list: Change[], next: ReadonlyMap<string, string>, scen: string[], groupOf: (c: Change) => string): Change[] {
  if (!next.size) return list;
  const merged = new Map<Change, Change>();
  const out: Change[] = [];
  for (const r of list) {
    if (r.kind !== "removed" || !r.mid) { out.push(r); continue; }
    let row: Change | null = r;
    for (const target of chainOf(next, r.mid)) {
      const y = list.find((c) => c.mid === target && groupOf(c) === groupOf(r) && c.kind !== "removed" && !merged.has(c));
      if (!y) continue;
      if (y.kind === "added") {
        const sameUnit = r.unit === y.unit;
        const delta: ScenarioValues = {};
        for (const s of scen) {
          const p = r.before?.[s] ?? null, q = y.after?.[s] ?? null;
          delta[s] = !sameUnit || (p == null && q == null) ? null : Number(((q ?? 0) - (p ?? 0)).toPrecision(12));
        }
        merged.set(y, { ...y, kind: "replaced", before: r.before, delta, was: { code: r.code, name: r.name, unit: r.unit }, notes: [...(sameUnit ? [] : [`unit ${r.unit} → ${y.unit}`]), ...y.notes] });
        row = null;
      } else row = { ...r, notes: [...r.notes, `replaced by ${y.code} (on the BOM already)`] };
      break;
    }
    if (row) out.push(row);
  }
  return out.map((c) => merged.get(c) ?? c).sort(byKind);
}

type State = Pick<BomRevision, "scenarios" | "lines" | "totals" | "materials"> & { label: string };

interface Mat { d: Partial<MaterialDetails> & { code: string; name: string; unit: string }; mid?: string; full: boolean; uos: Set<string>; inTotals: boolean }

/** The materials of a state: its kept details (since N5.6), else what its totals and lines say. */
function materialsIn(s: State, byIds: boolean): Map<string, Mat> {
  const out = new Map<string, Mat>();
  const keyOf = (x: { mid?: string; code: string }) => (byIds && x.mid ? x.mid : x.code);
  for (const m of s.materials ?? []) out.set(keyOf(m), { d: m, mid: m.mid, full: true, uos: new Set(), inTotals: false });
  const basic = (x: { code: string; name: string; unit: string; category?: string }) => ({ code: x.code, name: x.name, unit: x.unit, ...(x.category ? { category: x.category } : {}) });
  for (const t of s.totals) {
    const k = keyOf(t);
    if (!out.has(k)) out.set(k, { d: basic(t), mid: t.mid, full: false, uos: new Set(), inTotals: false });
    out.get(k)!.inTotals = true;
  }
  for (const l of s.lines) {
    const k = keyOf(l);
    if (!out.has(k)) out.set(k, { d: basic(l), mid: l.mid, full: false, uos: new Set(), inTotals: false });
    out.get(k)!.uos.add(l.uo);
  }
  return out;
}

const MAT_ORDER: Record<MaterialChange["kind"], number> = { replaced: 0, edited: 1, added: 2, removed: 3 };

function materialChanges(a: State, b: State, byIds: boolean, next: ReadonlyMap<string, string>): MaterialChange[] {
  const A = materialsIn(a, byIds), B = materialsIn(b, byIds);
  const usage = (m: Mat) => [...m.uos].sort().join(", ") || (m.inTotals ? "recipes" : "");
  const label = (m: Mat, unit = false) => `${m.d.code} · ${m.d.name}${unit ? ` (${m.d.unit})` : ""}`;
  const out: MaterialChange[] = [];
  const targets = new Set<string>();
  for (const [k, x] of A) {
    if (B.has(k)) continue;
    const target = byIds && x.mid ? chainOf(next, x.mid).find((m) => B.has(m)) : undefined;
    if (target) {
      const y = B.get(target)!;
      const unit = x.d.unit !== y.d.unit;
      out.push({ kind: "replaced", code: y.d.code, name: y.d.name, was: { code: x.d.code, name: x.d.name, unit: x.d.unit }, what: "Material", before: label(x, unit), after: label(y, unit), uos: usage(y) });
      if (!A.has(target)) targets.add(target);
    } else out.push({ kind: "removed", code: x.d.code, name: x.d.name, what: "Material", before: label(x), after: "", uos: usage(x) });
  }
  for (const [k, y] of B) {
    const x = A.get(k);
    if (!x) { if (!targets.has(k)) out.push({ kind: "added", code: y.d.code, name: y.d.name, what: "Material", before: "", after: label(y), uos: usage(y) }); continue; }
    for (const c of detailChanges(x.d, y.d, x.full && y.full ? SNAP_DETAILS : BASIC_DETAILS)) {
      out.push({ kind: "edited", code: y.d.code, name: y.d.name, what: c.label, before: c.before, after: c.after, uos: usage(y) });
    }
  }
  return out.sort((p, q) => MAT_ORDER[p.kind] - MAT_ORDER[q.kind] || p.code.localeCompare(q.code));
}

/**
 * What changed from `a` to `b` (two revisions, or a revision and the BOM now). `materials` (the project's
 * list) says which material replaced which: Replace… marks the old one obsolete, "replaced by" the new one.
 */
export function compareBom(a: State, b: State, materials?: readonly Material[]): Comparison {
  const scenarios = b.scenarios.length ? b.scenarios : a.scenarios;
  const scen = scenarios.map((s) => s.id);
  const byIds = a.lines.every((l) => l.mid && l.uoId) && b.lines.every((l) => l.mid && l.uoId) && a.totals.every((t) => t.mid) && b.totals.every((t) => t.mid);
  const next = new Map<string, string>(byIds ? (materials ?? []).filter((m) => m.replacedBy).map((m) => [m.id, m.replacedBy!]) : []);
  const snapA = new Map((a.materials ?? []).map((m) => [m.mid, m])), snapB = new Map((b.materials ?? []).map((m) => [m.mid, m]));
  const nameNote = (x: string, y: string) => changeText({ key: "name", label: "Name", before: x, after: y }, 80);
  const lineExtra = (x: State["lines"][number], y: State["lines"][number]) => {
    const n: string[] = [];
    if (x.code !== y.code) n.push(`code ${x.code} → ${y.code}`);
    if (x.source !== y.source) n.push(`source ${x.source} → ${y.source}`);
    if (x.unit !== y.unit) n.push(`unit ${x.unit} → ${y.unit}`);
    if (x.name !== y.name) n.push(nameNote(x.name, y.name));
    return n;
  };
  const totalExtra = (x: State["totals"][number], y: State["totals"][number]) => {
    const n: string[] = [];
    if (x.code !== y.code) n.push(`code ${x.code} → ${y.code}`);
    if (x.unit !== y.unit) n.push(`unit ${x.unit} → ${y.unit}`);
    if (x.kind !== y.kind) n.push(y.kind === "prep" ? "now prepared in-house" : "now bought");
    if (x.name !== y.name) n.push(nameNote(x.name, y.name));
    // What purchasing reads (spec, supplier, part no., pack size), when both states kept it.
    const p = x.mid ? snapA.get(x.mid) : undefined, q = y.mid ? snapB.get(y.mid) : undefined;
    if (p && q) for (const c of detailChanges(p, q, PURCHASE_DETAILS)) n.push(changeText(c, 80));
    return n;
  };
  // Lines pair within their unit operation (the key starts with its id).
  const lines = pairReplaced(diff(a.lines, b.lines, (x) => (byIds ? `${x.uoId}|${x.mid}` : `${x.uo}|${x.code}`), scen, lineExtra, (x) => x.uo), next, scen, (c) => c.key.split("|")[0]);
  const totals = pairReplaced(diff(a.totals, b.totals, (x) => (byIds ? x.mid! : x.code), scen, totalExtra), next, scen, () => "");
  const count = { added: 0, removed: 0, replaced: 0, changed: 0 };
  for (const c of lines) if (c.kind !== "same") count[c.kind]++;
  return {
    from: a.label, to: b.label, scenarios, lines, totals,
    materials: materialChanges(a, b, byIds, next),
    materialsPartial: !a.materials || !b.materials,
    count,
  };
}

/** Lines that changed since `base`, by "UO code|material code" as the BOM shows them now (for the marks). */
export function changesByLine(cmp: Comparison): Map<string, Change> {
  return new Map(cmp.lines.filter((c) => c.kind !== "same").map((c) => [`${c.uo}|${c.code}`, c]));
}

/** "1 added · 0 removed · 1 replaced · 2 changed" (replaced only when there is one). */
export function countText(c: Comparison["count"], sep = " · "): string {
  return [`${c.added} added`, `${c.removed} removed`, ...(c.replaced ? [`${c.replaced} replaced`] : []), `${c.changed} changed`].join(sep);
}
export const countSum = (c: Comparison["count"]) => c.added + c.removed + c.replaced + c.changed;
