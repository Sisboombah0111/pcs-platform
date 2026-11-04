/**
 * Mass Balance helpers that need the project: where a stream's materials count, PFD links per UO,
 * stream names, change preview, material totals per UO, and the value line on PFD labels.
 */
import { shortNames } from "./scenarios";
import { bomUoCodeOf } from "../model/ids";
import type { LabelMode, MbRow, MbSnapshot, Project, Scenario } from "../model/types";
import { pfdMaterialCounts, streamNamesOf } from "../pfd/sync";
import type { LinkContext } from "./pcsLink";

/** UO code a stream's materials count toward: its own UO, or the destination of a transfer. */
export function streamUoCode(p: Pick<Project, "streams" | "uos">, streamId: string): string | null {
  const owner = p.streams.active[streamId];
  const uoId = owner ? (owner.kind === "pfd" ? owner.uoId : owner.toUoId) : undefined;
  const uo = uoId ? p.uos.find((u) => u.id === uoId) : undefined;
  return uo?.code ?? bomUoCodeOf(streamId);
}

/** Where a stream runs, for people: "100L" or "10L → 100L". */
export function streamRoute(p: Pick<Project, "streams" | "uos">, streamId: string): string {
  const o = p.streams.active[streamId];
  const code = (id?: string) => p.uos.find((u) => u.id === id)?.code ?? "?";
  if (!o) return "";
  return o.kind === "pfd" ? code(o.uoId) : `${code(o.fromUoId)} → ${code(o.toUoId)}`;
}

/** Stream ID → name typed on the PFD (any drawing). */
export function streamNames(p: Pick<Project, "pfd">): Map<string, string> {
  return streamNamesOf(p.pfd);
}

/** Stream IDs on the PFD, in UO order. */
export function pfdStreamIds(p: Pick<Project, "streams" | "uos">): string[] {
  const order = (id: string) => {
    const o = p.streams.active[id];
    const uoId = o?.kind === "pfd" ? o.uoId : o?.fromUoId;
    return p.uos.find((u) => u.id === uoId)?.order ?? 9999;
  };
  return Object.keys(p.streams.active).sort((a, b) => order(a) - order(b) || a.localeCompare(b));
}

/** UO code → material code → count linked on PFD shapes. */
export function pfdLinksByCode(p: Pick<Project, "pfd" | "uos" | "materials" | "streams">): Map<string, Map<string, number>> {
  const counts = pfdMaterialCounts(p.pfd, p.uos, p.streams);
  const out = new Map<string, Map<string, number>>();
  for (const [uoId, m] of counts) {
    const uo = p.uos.find((u) => u.id === uoId);
    if (!uo) continue;
    const byCode = new Map<string, number>();
    for (const [matId, qty] of m) {
      const mat = p.materials.find((x) => x.id === matId);
      if (mat) byCode.set(mat.code, (byCode.get(mat.code) ?? 0) + qty);
    }
    if (byCode.size) out.set(uo.code, byCode);
  }
  return out;
}

export function linkContext(p: Project): LinkContext {
  return {
    scenarios: p.mb.scenarios,
    streamIds: pfdStreamIds(p),
    materials: p.materials.map((m) => ({ code: m.code, unit: m.unit, name: m.name })),
    uoOfStream: (id) => streamUoCode(p, id),
    pfdLinks: pfdLinksByCode(p),
  };
}

// ---- change preview ----------------------------------------------------------------------

export interface DiffEntry {
  key: string;
  streamId: string;
  matCode: string | null;
  unit: string;
  beforeUnit?: string;
  before: Record<string, number | null> | null;
  after: Record<string, number | null> | null;
  status: "added" | "changed" | "removed" | "same";
}

const rowKey = (r: Pick<MbRow, "streamId" | "matCode">) => `${r.streamId}\u0000${r.matCode ?? ""}`;
const same = (a: number | null | undefined, b: number | null | undefined) =>
  (a ?? null) === (b ?? null) || (a != null && b != null && Math.abs(a - b) <= 1e-12 * Math.max(1, Math.abs(a), Math.abs(b)));

/** Rows of the new sheet against the applied snapshot, changes first. */
export function diffRows(prev: MbSnapshot | null, next: readonly MbRow[], scenarioIds: readonly string[]): DiffEntry[] {
  const before = new Map((prev?.rows ?? []).map((r) => [rowKey(r), r]));
  const out: DiffEntry[] = [];
  for (const r of next) {
    const k = rowKey(r);
    const b = before.get(k);
    before.delete(k);
    const status: DiffEntry["status"] = !b ? "added"
      : b.unit !== r.unit || scenarioIds.some((s) => !same(b.values[s], r.values[s])) ? "changed" : "same";
    out.push({ key: k, streamId: r.streamId, matCode: r.matCode, unit: r.unit, ...(b && b.unit !== r.unit ? { beforeUnit: b.unit } : {}), before: b?.values ?? null, after: r.values, status });
  }
  for (const [k, b] of before) out.push({ key: k, streamId: b.streamId, matCode: b.matCode, unit: b.unit, before: b.values, after: null, status: "removed" });
  const rank = { changed: 0, added: 1, removed: 2, same: 3 } as const;
  return out.sort((a, b) => rank[a.status] - rank[b.status]);
}

// ---- applied values ------------------------------------------------------------------------

export interface MaterialTotal {
  uo: string;
  matCode: string;
  unit: string;
  values: Record<string, number | null>;
  streams: string[];
}

/** Σ material rows per (UO, MatCode): what the BOM takes from the MB. */
export function materialTotals(snap: MbSnapshot | null, uoOf: (streamId: string) => string | null): MaterialTotal[] {
  if (!snap) return [];
  const map = new Map<string, MaterialTotal>();
  for (const r of snap.rows) {
    if (!r.matCode) continue;
    const uo = uoOf(r.streamId) ?? "?";
    const key = `${uo}\u0000${r.matCode}`;
    const cur = map.get(key) ?? { uo, matCode: r.matCode, unit: r.unit, values: {}, streams: [] };
    for (const s of snap.scenarios) {
      const v = r.values[s];
      if (v != null) cur.values[s] = (cur.values[s] ?? 0) + v;
      else if (!(s in cur.values)) cur.values[s] = null;
    }
    if (!cur.streams.includes(r.streamId)) cur.streams.push(r.streamId);
    map.set(key, cur);
  }
  return [...map.values()];
}

export interface FlowValue { unit: string; values: Record<string, number | null>; note?: string }

export function flowValues(snap: MbSnapshot | null): Map<string, FlowValue> {
  const out = new Map<string, FlowValue>();
  for (const r of snap?.rows ?? []) if (!r.matCode && !out.has(r.streamId)) out.set(r.streamId, { unit: r.unit, values: r.values, ...(r.note ? { note: r.note } : {}) });
  return out;
}

const nf = new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 });
export function fmtQty(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "";
  return nf.format(Math.abs(v) < 1e-9 ? 0 : v);
}

/** The value line under a stream's ID and name on its PFD label. */
export function valueLine(flow: FlowValue | undefined, mode: LabelMode, scenarios: readonly Scenario[], active: string): string | undefined {
  if (!flow || mode === "id") return undefined;
  if (mode === "id+active") {
    const v = flow.values[active];
    return v == null ? undefined : `${fmtQty(v)} ${flow.unit}`;
  }
  const short = shortNames(scenarios);
  const parts = scenarios.filter((s) => flow.values[s.id] != null).map((s) => `${short.get(s.id)} ${fmtQty(flow.values[s.id])}`);
  return parts.length ? `${parts.join(" · ")} ${flow.unit}` : undefined;
}

/** One function for PfdView: stream ID → value line, from the applied snapshot and label settings. */
export function valueLines(p: Pick<Project, "mb" | "settings">): (streamId: string) => string | undefined {
  const flows = flowValues(p.mb.current);
  return (id) => valueLine(flows.get(id), p.settings.labelMode, p.mb.scenarios, p.mb.activeScenario);
}

// ---- the PCS_LINK starter sheet --------------------------------------------------------------

/** A PCS_LINK sheet listing the PFD's streams (flow rows only; values are left for the engineer). */
export function linkSheet(p: Project): { header: string[]; rows: (string | number | null)[][] } {
  const names = streamNames(p);
  const header = ["StreamID", "MatCode", "Unit", ...p.mb.scenarios.map((s) => s.column), "Note"];
  const rows = pfdStreamIds(p).map((id) => {
    const note = [names.get(id), streamRoute(p, id)].filter(Boolean).join(" · ");
    return [id, null, null, ...p.mb.scenarios.map(() => null), note];
  });
  return { header, rows };
}

export const MAX_HISTORY = 50;
