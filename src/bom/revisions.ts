/**
 * BOM revisions: save what the BOM says now (Rev A, Rev B …) and compare any two states later.
 *
 * A revision keeps the results, by material and unit operation CODE (not ids): the lines that are
 * counted and the totals (to buy, prepared in-house), per scenario. Comparing two states gives, for the
 * lines (unit operation × material) and for the totals (material), what was added, removed or changed.
 * Revisions saved since N4.11 also keep the material and unit operation ids, so a material whose code
 * changed reads as "changed (code A → B)"; with an older revision it reads as removed + added. Pure: no React.
 */
import type { BomResult } from "./model";
import type { BomRevision, Project, ScenarioValues } from "../model/types";
import { newId } from "../model/ids";

export type ChangeKind = "added" | "removed" | "changed" | "same";

export interface Change {
  kind: ChangeKind;
  /** Line: "PROA|BUF-1001"; total: "BUF-1001". */
  key: string;
  uo?: string;
  code: string;
  name: string;
  unit: string;
  category?: string;
  before: ScenarioValues | null;
  after: ScenarioValues | null;
  /** after − before per scenario (missing side = 0). */
  delta: ScenarioValues;
  /** What else changed on a line: source, unit, name. */
  notes: string[];
}

export interface Comparison {
  from: string;
  to: string;
  scenarios: { id: string; name: string }[];
  lines: Change[];
  totals: Change[];
  count: { added: number; removed: number; changed: number };
}

/** The BOM as it is now, in revision form (label, note and author added by `makeRevision`). */
export function snapshotBom(bom: BomResult): Pick<BomRevision, "scenarios" | "lines" | "totals"> {
  const scen = bom.scenarios.map((s) => ({ id: s.id, name: s.name }));
  const lines: BomRevision["lines"] = [];
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
    }
  }
  const totals: BomRevision["totals"] = [
    ...bom.totals.map((t) => ({ code: t.material.code, name: t.material.name, unit: t.material.unit, kind: "buy" as const, qty: { ...t.qty }, mid: t.material.id, ...(t.material.category ? { category: t.material.category } : {}) })),
    ...bom.prepared.map((t) => ({ code: t.material.code, name: t.material.name, unit: t.material.unit, kind: "prep" as const, qty: { ...t.qty }, mid: t.material.id, ...(t.material.category ? { category: t.material.category } : {}) })),
  ];
  return { scenarios: scen, lines, totals };
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
    ...snapshotBom(bom),
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

function diff<T extends { code: string; name: string; unit: string; category?: string; qty: ScenarioValues }>(
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
    if (uoOf) c.uo = uoOf(ref);
    out.push(c);
  }
  const order: Record<ChangeKind, number> = { added: 0, removed: 1, changed: 2, same: 3 };
  return out.sort((p, q) => order[p.kind] - order[q.kind] || (p.uo ?? "").localeCompare(q.uo ?? "") || p.code.localeCompare(q.code));
}

type State = Pick<BomRevision, "scenarios" | "lines" | "totals"> & { label: string };

/** What changed from `a` to `b` (two revisions, or a revision and the BOM now). */
export function compareBom(a: State, b: State): Comparison {
  const scenarios = b.scenarios.length ? b.scenarios : a.scenarios;
  const scen = scenarios.map((s) => s.id);
  const byIds = a.lines.every((l) => l.mid && l.uoId) && b.lines.every((l) => l.mid && l.uoId) && a.totals.every((t) => t.mid) && b.totals.every((t) => t.mid);
  const lineExtra = (x: State["lines"][number], y: State["lines"][number]) => {
    const n: string[] = [];
    if (x.code !== y.code) n.push(`code ${x.code} → ${y.code}`);
    if (x.source !== y.source) n.push(`source ${x.source} → ${y.source}`);
    if (x.unit !== y.unit) n.push(`unit ${x.unit} → ${y.unit}`);
    if (x.name !== y.name) n.push("name changed");
    return n;
  };
  const totalExtra = (x: State["totals"][number], y: State["totals"][number]) => {
    const n: string[] = [];
    if (x.code !== y.code) n.push(`code ${x.code} → ${y.code}`);
    if (x.unit !== y.unit) n.push(`unit ${x.unit} → ${y.unit}`);
    if (x.kind !== y.kind) n.push(y.kind === "prep" ? "now prepared in-house" : "now bought");
    return n;
  };
  const lines = diff(a.lines, b.lines, (x) => (byIds ? `${x.uoId}|${x.mid}` : `${x.uo}|${x.code}`), scen, lineExtra, (x) => x.uo);
  const totals = diff(a.totals, b.totals, (x) => (byIds ? x.mid! : x.code), scen, totalExtra);
  const count = { added: 0, removed: 0, changed: 0 };
  for (const c of lines) if (c.kind !== "same") count[c.kind]++;
  return { from: a.label, to: b.label, scenarios, lines, totals, count };
}

/** Lines that changed since `base`, by "UO code|material code" as the BOM shows them now (for the marks). */
export function changesByLine(cmp: Comparison): Map<string, Change> {
  return new Map(cmp.lines.filter((c) => c.kind !== "same").map((c) => [`${c.uo}|${c.code}`, c]));
}
