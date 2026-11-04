/**
 * Where a material is used: BOM lines (and the recipes that bring it in), applied MB rows, PFD links,
 * recipes and backup lists. Answers "if this material changes, what changes with it, and where do I go
 * to fix it?". Pure: no React.
 */
import type { BomResult } from "../bom/model";
import { appliedRows } from "../link/check";
import { pcsOf, MAP, type BoardElement } from "../pfd/sync";
import { symbolById } from "../pfd/symbols";
import type { Material, Project, ScenarioValues } from "./types";

export interface WhereUsed {
  material: Material;
  /** BOM lines of the material itself, per unit operation. */
  bomLines: { uo: string; uoName: string; source: string; excluded: boolean; qty: ScenarioValues }[];
  /** Where it comes in through a recipe on the BOM: the line it is part of. */
  bomParts: { uo: string; parent: string; via: string; qty: ScenarioValues }[];
  /** Applied MB rows (PCS_LINK material rows) with this code. */
  mbRows: { streamId: string; uo?: string; values: ScenarioValues; unit: string; counted: boolean }[];
  /** PFD shapes and arrows it is linked on. */
  pfdLinks: { scope: string; uo: string; elementId: string; what: string; qty: number }[];
  /** Prepared materials whose recipe has it. */
  inRecipes: { code: string; name: string; qty: number; per: number; perBatch: boolean; unit: string }[];
  /** Materials it is a backup for, and its own backups. */
  backupFor: { code: string; name: string; ratio: number }[];
  backups: { code: string; name: string; ratio: number }[];
  /** Total number of places. */
  count: number;
}

export function whereUsed(p: Project, materialId: string, bom: BomResult): WhereUsed | null {
  const m = p.materials.find((x) => x.id === materialId);
  if (!m) return null;
  const byId = new Map(p.materials.map((x) => [x.id, x]));

  const bomLines: WhereUsed["bomLines"] = [];
  const bomParts: WhereUsed["bomParts"] = [];
  for (const u of bom.uos) {
    for (const r of u.rows) {
      if (r.material.id === m.id) bomLines.push({ uo: u.uo.code, uoName: u.uo.name, source: r.line.excluded ? "Not counted" : r.line.qtySource, excluded: !!r.line.excluded, qty: { ...r.qty } });
      for (const part of r.parts) if (part.material.id === m.id && !part.loop) bomParts.push({ uo: u.uo.code, parent: r.material.code, via: part.parent.code, qty: { ...part.qty } });
    }
  }

  const mbRows: WhereUsed["mbRows"] = appliedRows(p)
    .filter((a) => a.row.matCode === m.code)
    .map((a) => ({ streamId: a.row.streamId, ...(a.uoCode ? { uo: a.uoCode } : {}), values: { ...a.row.values }, unit: a.row.unit, counted: a.status === "ok" }));

  const pfdLinks: WhereUsed["pfdLinks"] = [];
  const scan = (scope: string, uo: string, elements: readonly unknown[]) => {
    for (const e of elements as BoardElement[]) {
      if (e.isDeleted) continue;
      const pcs = pcsOf(e);
      const link = pcs.materials?.find((l) => l.materialId === m.id);
      if (!link) continue;
      const what = e.type === "arrow" ? `arrow ${pcs.streamId ?? ""}`.trim() : pcs.symbol ? (symbolById(pcs.symbol)?.name ?? pcs.symbol) : "shape";
      pfdLinks.push({ scope, uo, elementId: e.id, what, qty: link.qty });
    }
  };
  for (const u of [...p.uos].sort((a, b) => a.order - b.order)) if (p.pfd.sheets[u.id]) scan(u.id, u.code, p.pfd.sheets[u.id].elements);
  scan(MAP, "Process map", p.pfd.map.elements);

  const inRecipes: WhereUsed["inRecipes"] = [];
  for (const x of p.materials) {
    const c = x.recipe?.components.find((k) => k.materialId === m.id);
    if (c) inRecipes.push({ code: x.code, name: x.name, qty: c.qty, per: x.recipe!.per, perBatch: c.basis === "batch", unit: x.unit });
  }
  const backupFor = p.materials.filter((x) => x.backups?.some((b) => b.materialId === m.id))
    .map((x) => ({ code: x.code, name: x.name, ratio: x.backups!.find((b) => b.materialId === m.id)!.ratio ?? 1 }));
  const backups = (m.backups ?? []).map((b) => byId.get(b.materialId)).filter((x): x is Material => !!x)
    .map((x) => ({ code: x.code, name: x.name, ratio: m.backups!.find((b) => b.materialId === x.id)!.ratio ?? 1 }));

  const count = bomLines.length + bomParts.length + mbRows.length + pfdLinks.length + inRecipes.length + backupFor.length + backups.length;
  return { material: m, bomLines, bomParts, mbRows, pfdLinks, inRecipes, backupFor, backups, count };
}

/** How many places use each material (the count `whereUsed` would give), in one pass. */
export function usageCounts(p: Project, bom: BomResult): Map<string, number> {
  const out = new Map<string, number>();
  const add = (id: string | undefined, n = 1) => { if (id) out.set(id, (out.get(id) ?? 0) + n); };
  const byCode = new Map(p.materials.map((m) => [m.code, m.id]));
  for (const u of bom.uos) for (const r of u.rows) { add(r.material.id); for (const part of r.parts) if (!part.loop) add(part.material.id); }
  for (const a of appliedRows(p)) if (a.row.matCode) add(byCode.get(a.row.matCode));
  const scan = (elements: readonly unknown[]) => { for (const e of elements as BoardElement[]) if (!e.isDeleted) for (const l of pcsOf(e).materials ?? []) add(l.materialId); };
  for (const sheet of Object.values(p.pfd.sheets)) scan(sheet.elements);
  scan(p.pfd.map.elements);
  for (const m of p.materials) {
    for (const c of m.recipe?.components ?? []) add(c.materialId);
    for (const b of m.backups ?? []) { add(b.materialId); add(m.id); }
  }
  return out;
}
