/**
 * Undo/redo for the changes made outside the drawing (Materials, BOM, Operations, Mass Balance), and the
 * change log saved with the project ("who changed what, when"). The PFD drawing keeps its own undo.
 *
 * An entry keeps the parts of the project it changed, before and after. Undo puts "before" back only when
 * those parts are still exactly as the entry left them, so it never overwrites a later change.
 */
import type { ChangeEntry, Equipment, Material, OpStep, Project } from "./types";
import { newId } from "./ids";
import { changeText, detailChanges, detailsOf } from "./materialDiff";
import { describeSap } from "../bom/sap";

/** Changed materials logged detail by detail (before → after); more in one line by code. */
const DETAILED = 10;

export const TRACKED = ["materials", "bom", "equipment", "operations", "mb"] as const;
export type TrackedKey = (typeof TRACKED)[number];
type Parts = Partial<Pick<Project, TrackedKey>>;

export interface HistoryEntry {
  id: string;
  /** What the user did, e.g. "Materials" or "Replace FLT-0001 with FLT-0011". */
  label: string;
  at: number;
  keys: TrackedKey[];
  before: Parts;
  after: Parts;
  /** Shown when it is undone (e.g. what an undo does not take back). */
  note?: string;
  /** The change log line it wrote. */
  logId?: string;
}

export interface History { past: HistoryEntry[]; future: HistoryEntry[] }
export const emptyHistory = (): History => ({ past: [], future: [] });
const MAX = 60;
/** Edits of the same kind within this time count as one step (typing a name letter by letter). */
const MERGE_MS = 2500;

/** The tracked parts that differ (by reference). Switching the active scenario is a view setting, not a change. */
export function changedKeys(prev: Project, next: Project): TrackedKey[] {
  return TRACKED.filter((k) => {
    if (k !== "mb") return prev[k] !== next[k];
    const a = prev.mb, b = next.mb;
    return a !== b && (a.workbook !== b.workbook || a.current !== b.current || a.history !== b.history || a.scenarios !== b.scenarios);
  });
}

const pick = (p: Project, keys: readonly TrackedKey[]): Parts => Object.fromEntries(keys.map((k) => [k, p[k]])) as Parts;

/** Add a change; one that continues the last one (same label and parts, soon after, nothing in between) is merged into it. */
export function record(h: History, prev: Project, next: Project, label: string, now: number, note?: string): { history: History; entry: HistoryEntry; merged: boolean } | null {
  const keys = changedKeys(prev, next);
  if (!keys.length) return null;
  const last = h.past[h.past.length - 1];
  if (last && last.label === label && now - last.at < MERGE_MS && last.keys.length === keys.length && keys.every((k) => last.keys.includes(k)) && keys.every((k) => last.after[k] === prev[k])) {
    const entry = { ...last, at: now, after: pick(next, keys) };
    return { history: { past: [...h.past.slice(0, -1), entry], future: [] }, entry, merged: true };
  }
  const entry: HistoryEntry = { id: newId("h"), label, at: now, keys, before: pick(prev, keys), after: pick(next, keys), ...(note ? { note } : {}) };
  return { history: { past: [...h.past, entry].slice(-MAX), future: [] }, entry, merged: false };
}

/** Undo the last change: the parts to put back, or why it cannot be done (changed again since, e.g. on the PFD). */
export function undo(h: History, current: Project): { history: History; patch: Parts; entry: HistoryEntry } | { error: string; history: History } | null {
  const entry = h.past[h.past.length - 1];
  if (!entry) return null;
  if (!entry.keys.every((k) => current[k] === entry.after[k])) {
    return { error: `“${entry.label}” cannot be undone: the same data changed since (for example from the PFD).`, history: { past: h.past.slice(0, -1), future: [] } };
  }
  return { history: { past: h.past.slice(0, -1), future: [...h.future, entry] }, patch: entry.before, entry };
}

export function redo(h: History, current: Project): { history: History; patch: Parts; entry: HistoryEntry } | { error: string; history: History } | null {
  const entry = h.future[h.future.length - 1];
  if (!entry) return null;
  if (!entry.keys.every((k) => current[k] === entry.before[k])) {
    return { error: `“${entry.label}” cannot be redone: the same data changed since.`, history: { past: h.past, future: [] } };
  }
  return { history: { past: [...h.past, entry], future: h.future.slice(0, -1) }, patch: entry.after, entry };
}

// ---- the change log ----------------------------------------------------------------------------------------------------------

const list = (xs: string[], max = 6) => (xs.length > max ? `${xs.slice(0, max).join(", ")} and ${xs.length - max} more` : xs.join(", "));
const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);

function byId<T extends { id: string }>(a: readonly T[], b: readonly T[]) {
  const A = new Map(a.map((x) => [x.id, x])), B = new Map(b.map((x) => [x.id, x]));
  return {
    added: b.filter((x) => !A.has(x.id)),
    removed: a.filter((x) => !B.has(x.id)),
    changed: b.filter((x) => A.has(x.id) && !same(A.get(x.id), x)).map((x) => [A.get(x.id)!, x] as const),
  };
}

/** What a change did, in a few short lines (for the change log). */
export function describeChange(before: Parts, after: Parts, uoCode: (id: string) => string): string[] {
  const out: string[] = [];
  if (before.materials && after.materials) {
    const d = byId<Material>(before.materials, after.materials);
    // A few by code and name (“CON-0011 “NovaSeptum … C-Flex””), many by code.
    const named = (ms: Material[]) => (ms.length <= 3 ? ms.map((m) => `${m.code || "(no code)"} “${m.name}”`).join(", ") : list(ms.map((m) => m.code || "(no code)")));
    if (d.added.length) out.push(`Materials added: ${named(d.added)}`);
    if (d.removed.length) out.push(`Materials deleted: ${named(d.removed)}`);
    if (d.changed.length) {
      // N5.6: each detail before → after (name, spec, supplier, part no., status, replaced by …).
      const all = [...after.materials, ...before.materials];
      const codeOf = (id: string) => all.find((m) => m.id === id)?.code ?? "?";
      const parts = d.changed.map(([a, b]) => {
        const what = detailChanges(detailsOf(a, all), detailsOf(b, all)).map((c) => changeText(c));
        if (!same(a.recipe, b.recipe)) what.push("recipe changed");
        if (!same(a.backups, b.backups)) {
          const ids = (m: Material) => new Set((m.backups ?? []).map((x) => x.materialId));
          const [x, y] = [ids(a), ids(b)];
          const plus = [...y].filter((i) => !x.has(i)).map(codeOf), minus = [...x].filter((i) => !y.has(i)).map(codeOf);
          what.push(plus.length || minus.length ? [...plus.map((c) => `backup ${c} added`), ...minus.map((c) => `backup ${c} removed`)].join("; ") : "backups edited");
        }
        return { code: b.code, what };
      });
      for (const c of parts.slice(0, DETAILED)) out.push(`Material ${c.code}: ${c.what.join("; ") || "changed"}`);
      if (parts.length > DETAILED) out.push(`Materials changed, more: ${list(parts.slice(DETAILED).map((c) => c.code))}`);
    }
  }
  if (before.bom && after.bom) {
    const uos = [...new Set([...Object.keys(before.bom.lines), ...Object.keys(after.bom.lines)])].filter((u) => !same(before.bom!.lines[u] ?? [], after.bom!.lines[u] ?? []));
    if (uos.length) out.push(`BOM lines changed in ${list(uos.map(uoCode))}`);
    const ra = before.bom.revisions ?? [], rb = after.bom.revisions ?? [];
    const addedRev = rb.filter((r) => !ra.some((x) => x.id === r.id)), removedRev = ra.filter((r) => !rb.some((x) => x.id === r.id));
    if (addedRev.length) out.push(`BOM revision saved: ${addedRev.map((r) => r.label).join(", ")}`);
    if (removedRev.length) out.push(`BOM revision deleted: ${removedRev.map((r) => r.label).join(", ")}`);
    out.push(...describeSap(before.bom.sap, after.bom.sap, uoCode));
  }
  if (before.equipment && after.equipment) {
    const d = byId<Equipment>(before.equipment, after.equipment);
    if (d.added.length) out.push(`Equipment added: ${list(d.added.map((e) => e.tag))}`);
    if (d.removed.length) out.push(`Equipment deleted: ${list(d.removed.map((e) => e.tag))}`);
    if (d.changed.length) out.push(`Equipment changed: ${list(d.changed.map(([a, b]) => (a.tag !== b.tag ? `${a.tag} → ${b.tag}` : b.tag)), 5)}`);
  }
  if (before.operations && after.operations) {
    const uos = [...new Set([...Object.keys(before.operations), ...Object.keys(after.operations)])];
    for (const u of uos) {
      const a: OpStep[] = before.operations[u] ?? [], b: OpStep[] = after.operations[u] ?? [];
      if (same(a, b)) continue;
      const acts = (s: OpStep[]) => s.reduce((n, x) => n + x.actions.length, 0);
      out.push(a.length !== b.length ? `Steps of ${uoCode(u)}: ${a.length} → ${b.length}` : acts(a) !== acts(b) ? `Actions in ${uoCode(u)}: ${acts(a)} → ${acts(b)}` : `Steps of ${uoCode(u)} edited`);
    }
  }
  if (before.mb && after.mb) {
    if (before.mb.workbook !== after.mb.workbook) out.push(after.mb.workbook ? `MB workbook ${before.mb.workbook ? "changed" : "added"}: ${after.mb.workbook.name}` : "MB workbook removed");
    if (before.mb.current !== after.mb.current) out.push(after.mb.current ? `MB values applied (${after.mb.current.rows.length} rows${after.mb.current.fileName ? `, ${after.mb.current.fileName}` : ""})` : "MB values taken off");
    if (before.mb.scenarios !== after.mb.scenarios) out.push(`Scenarios: ${after.mb.scenarios.map((s) => s.name).join(", ")}`);
  }
  return out.length ? out : ["Changed"];
}

/** A change log line; the log keeps the newest entries only. */
export const MAX_LOG = 1000;
export function logLine(screen: string, what: string[], by: string | undefined, at = new Date().toISOString()): ChangeEntry {
  return { id: newId("log"), at, screen, what, ...(by ? { by } : {}) };
}
export function addLog(log: readonly ChangeEntry[], line: ChangeEntry): ChangeEntry[] {
  return [line, ...log].slice(0, MAX_LOG);
}
/** Put a merged change's new description on its line (and move it to the top). */
export function updateLog(log: readonly ChangeEntry[], id: string, what: string[], at: string): ChangeEntry[] {
  const line = log.find((l) => l.id === id);
  if (!line) return [...log];
  return [{ ...line, what, at }, ...log.filter((l) => l.id !== id)];
}

/** Unit operations added, deleted or renamed on the PFD (logged; the drawing has its own undo). */
export function describeUos(prev: Project["uos"], next: Project["uos"]): string[] {
  if (prev === next) return [];
  const A = new Map(prev.map((u) => [u.id, u])), B = new Map(next.map((u) => [u.id, u]));
  const out: string[] = [];
  const added = next.filter((u) => !A.has(u.id)), removed = prev.filter((u) => !B.has(u.id));
  const renamed = next.filter((u) => A.has(u.id) && (A.get(u.id)!.code !== u.code || A.get(u.id)!.name !== u.name));
  if (added.length) out.push(`Unit operation added: ${list(added.map((u) => `${u.code} ${u.name}`))}`);
  if (removed.length) out.push(`Unit operation deleted: ${list(removed.map((u) => `${u.code} ${u.name}`))}`);
  if (renamed.length) out.push(`Unit operation renamed: ${list(renamed.map((u) => { const a = A.get(u.id)!; return a.code !== u.code ? `${a.code} → ${u.code}` : `${u.code} “${u.name}”`; }))}`);
  return out;
}
