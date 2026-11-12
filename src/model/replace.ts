/**
 * Replace one material with another everywhere it is used (except the MB workbook, which
 * mb/codeChanges.ts rewrites): BOM lines entered or changed by hand, recipes, PFD links (shapes and
 * arrows), backup lists. The old material is then marked obsolete ("replaced by …"), deleted, or kept.
 * Pure: no React.
 */
import { pcsOf, type BoardElement, type PcsData } from "../pfd/sync";
import { deleteMaterial, recipeLoops, withBackups, withRecipe } from "./recipes";
import { replaceInSap } from "../bom/sap";
import type { BackupMaterial, Material, PfdSheet, Project } from "./types";

export type AfterReplace = "obsolete" | "delete" | "keep";

export interface ReplacePlan {
  from: Material;
  to: Material;
  sameUnit: boolean;
  /** Stored BOM lines (per unit operation code); conflict = the new material already has a line there. */
  bomLines: { uo: string; conflict: boolean }[];
  /** Recipes with the old material; self = the new material's own recipe (left alone). */
  recipes: { code: string; merge: boolean; self: boolean }[];
  pfdLinks: number;
  /** Materials whose backup list names the old material. */
  backupFor: string[];
  /** Backups of the old material that move to the new one. */
  ownBackups: number;
  /** Applied MB rows with the old code (the workbook is rewritten when the units match). */
  mbRows: number;
  /** Why it cannot be done, if it cannot. */
  blocked?: string;
}

const sheetsOf = (p: Project): [string, PfdSheet][] => [["map", p.pfd.map], ...Object.entries(p.pfd.sheets)];
const linksOf = (e: BoardElement) => (e.isDeleted ? undefined : pcsOf(e).materials);

export function planReplace(p: Project, fromId: string, toId: string): ReplacePlan | null {
  const from = p.materials.find((m) => m.id === fromId), to = p.materials.find((m) => m.id === toId);
  if (!from || !to) return null;
  const code = (id: string) => p.uos.find((u) => u.id === id)?.code ?? "?";
  const plan: ReplacePlan = {
    from, to, sameUnit: from.unit.trim().toLowerCase() === to.unit.trim().toLowerCase(),
    bomLines: Object.entries(p.bom.lines).flatMap(([uo, lines]) => lines.some((l) => l.materialId === fromId) ? [{ uo: code(uo), conflict: lines.some((l) => l.materialId === toId) }] : []),
    recipes: p.materials.filter((m) => m.recipe?.components.some((c) => c.materialId === fromId))
      .map((m) => ({ code: m.code, merge: !!m.recipe!.components.some((c) => c.materialId === toId), self: m.id === toId })),
    pfdLinks: sheetsOf(p).reduce((n, [, s]) => n + (s.elements as BoardElement[]).filter((e) => linksOf(e)?.some((l) => l.materialId === fromId)).length, 0),
    backupFor: p.materials.filter((m) => m.backups?.some((b) => b.materialId === fromId)).map((m) => m.code),
    ownBackups: (from.backups ?? []).filter((b) => b.materialId !== toId).length,
    mbRows: p.mb.current?.rows.filter((r) => r.matCode === from.code).length ?? 0,
  };
  if (from.id === to.id) plan.blocked = "Choose another material.";
  else {
    const loopsBefore = new Set(recipeLoops(p.materials).map((l) => l.join(">")));
    const after = replaceInMaterials(p.materials, fromId, toId, 1);
    const loop = recipeLoops(after).find((l) => !loopsBefore.has(l.join(">")));
    if (loop) plan.blocked = `This would make a recipe loop (${loop.join(" → ")}).`;
  }
  return plan;
}

/** Recipes and backup lists with `toId` instead of `fromId` (quantities × factor). */
function replaceInMaterials(materials: readonly Material[], fromId: string, toId: string, factor: number): Material[] {
  const from = materials.find((m) => m.id === fromId);
  return materials.map((m) => {
    let next = m;
    if (m.id !== toId && m.recipe?.components.some((c) => c.materialId === fromId)) {
      const comps: typeof m.recipe.components = [];
      for (const c of m.recipe.components) {
        if (c.materialId !== fromId) { comps.push(c); continue; }
        const qty = Number((c.qty * factor).toPrecision(12));
        const there = comps.find((x) => x.materialId === toId) ?? m.recipe.components.find((x) => x.materialId === toId);
        if (there) {
          const i = comps.findIndex((x) => x.materialId === toId);
          if (i >= 0) comps[i] = { ...comps[i], qty: Number((comps[i].qty + qty).toPrecision(12)) };
          else comps.push({ ...there, qty: Number((there.qty + qty).toPrecision(12)) });
        } else comps.push({ ...c, materialId: toId, qty });
      }
      // A component listed after the old one may have been merged already: keep each material once.
      const seen = new Set<string>();
      next = withRecipe(next, { ...m.recipe, components: comps.filter((c) => (seen.has(c.materialId) ? false : (seen.add(c.materialId), true))) });
    }
    if (m.backups?.some((b) => b.materialId === fromId)) {
      const list: BackupMaterial[] = [];
      for (const b of m.backups) {
        if (b.materialId !== fromId) { list.push(b); continue; }
        if (m.id === toId || m.backups.some((x) => x.materialId === toId) || list.some((x) => x.materialId === toId)) continue;
        list.push({ ...b, materialId: toId });
      }
      next = withBackups(next, list);
    }
    // The old material's own backups move to the new one.
    if (m.id === toId && from?.backups?.length) {
      const list = [...(next.backups ?? [])];
      for (const b of from.backups) if (b.materialId !== toId && !list.some((x) => x.materialId === b.materialId)) list.push(b);
      next = withBackups(next, list);
    }
    return next;
  });
}

const bump = (e: BoardElement, pcs: PcsData): BoardElement => ({
  ...e, customData: { ...(e.customData ?? {}), pcs }, version: ((e as { version?: number }).version ?? 0) + 1, versionNonce: Math.floor(Math.random() * 2 ** 31),
} as BoardElement);

/**
 * Everything but the MB workbook: stored BOM lines (a line the new material already has in that unit
 * operation wins), recipes, PFD links, backups; then the old material is marked obsolete, deleted or kept.
 * `factor` = quantity of the new material per 1 of the old one (1 when the units match).
 */
export function replaceMaterial(p: Project, fromId: string, toId: string, opts: { factor?: number; after: AfterReplace }): Project {
  const factor = opts.factor && opts.factor > 0 ? opts.factor : 1;
  // BOM lines kept on the BOM screen.
  const lines: Project["bom"]["lines"] = {};
  for (const [uo, list] of Object.entries(p.bom.lines)) {
    const hasTo = list.some((l) => l.materialId === toId);
    lines[uo] = list.flatMap((l) => {
      if (l.materialId !== fromId) return [l];
      if (hasTo) return [];
      return [{ ...l, materialId: toId, manualQty: Object.fromEntries(Object.entries(l.manualQty).map(([k, v]) => [k, v == null ? v : Number((v * factor).toPrecision(12))])) }];
    });
  }
  // PFD links.
  const swap = (s: PfdSheet): PfdSheet => {
    let changed = false;
    const elements = (s.elements as BoardElement[]).map((e) => {
      const links = linksOf(e);
      if (!links?.some((l) => l.materialId === fromId)) return e;
      changed = true;
      const out: { materialId: string; qty: number }[] = [];
      for (const l of links) {
        const id = l.materialId === fromId ? toId : l.materialId;
        const qty = l.materialId === fromId ? Number((l.qty * factor).toPrecision(12)) : l.qty;
        const there = out.find((x) => x.materialId === id);
        if (there) there.qty = Number((there.qty + qty).toPrecision(12)); else out.push({ materialId: id, qty });
      }
      return bump(e, { ...pcsOf(e), materials: out });
    });
    return changed ? { ...s, elements } : s;
  };
  const pfd = { ...p.pfd, map: swap(p.pfd.map), sheets: Object.fromEntries(Object.entries(p.pfd.sheets).map(([k, s]) => [k, swap(s)])) };
  let materials = replaceInMaterials(p.materials, fromId, toId, factor);
  if (opts.after === "obsolete") materials = materials.map((m) => (m.id === fromId ? { ...m, status: "obsolete" as const, replacedBy: toId } : m));
  if (opts.after === "delete") materials = deleteMaterial(materials, fromId);
  if (opts.after === "delete") materials = materials.map((m) => (m.replacedBy === fromId ? { ...m, replacedBy: toId } : m));
  const bom: Project["bom"] = { ...p.bom, lines: Object.fromEntries(Object.entries(lines).filter(([, l]) => l.length)) };
  if (p.bom.sap) bom.sap = replaceInSap(p.bom.sap, fromId, toId);
  return { ...p, materials, pfd, bom };
}
