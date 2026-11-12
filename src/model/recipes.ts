/**
 * Prepared materials (buffers, media, stock solutions made in-house) and backup materials.
 *
 *   recipe   BUF-0001 per 1000 L = 2.423 kg Tris + 8.766 kg NaCl + 1000 L WFI
 *            → the BOM turns 1100 L of BUF-0001 into 2.665 kg Tris, 9.643 kg NaCl, 1100 L WFI.
 *            A component may itself have a recipe (a stock solution); loops are refused.
 *   batches  BUF-0001-B, batch 200 L = 1000 L BUF-0001 per 1000 L + 1 EA 200 L bag per batch
 *            → 1980 L needs ⌈1980 ÷ 200⌉ = 10 batches: 1980 L of BUF-0001 and 10 bags.
 *            With "whole batches", proportional components are counted for 10 × 200 = 2000 L.
 *   backups  MAT-0008 NaCl (supplier A) → MAT-0044 NaCl (supplier B), ratio 1:
 *            listed under every BOM line of MAT-0008 with the same quantity; never added to the totals.
 */
import type { BackupMaterial, Material, Recipe } from "./types";

/** The recipe of a material when it has at least one component. */
export function recipeOf(m: Pick<Material, "recipe"> | undefined): Recipe | null {
  return m?.recipe && m.recipe.components.length > 0 && m.recipe.per > 0 ? m.recipe : null;
}

export const backupRatio = (b: BackupMaterial) => (b.ratio != null && b.ratio > 0 ? b.ratio : 1);

/** Batch size of a recipe when one is set (a number > 0), else null. */
export const batchSize = (r: Pick<Recipe, "batch"> | null | undefined): number | null => (r?.batch != null && Number.isFinite(r.batch) && r.batch > 0 ? r.batch : null);

/** True when the recipe counts in batches: a batch size, or a component per batch. */
export const usesBatches = (r: Recipe | null | undefined) => !!r && (batchSize(r) != null || r.components.some((c) => c.basis === "batch"));

/**
 * Batches needed for a quantity of the prepared material: ⌈quantity ÷ batch size⌉ (2000 L in 200 L
 * batches = 10, 1980 L = 10, 2001 L = 11; nothing = 0). Without a batch size the whole quantity is one batch.
 */
export function batchCount(r: Pick<Recipe, "batch">, qty: number): number {
  if (!(qty > 0)) return 0;
  const size = batchSize(r);
  if (size == null) return 1;
  return Math.ceil(Number((qty / size).toPrecision(12)));
}

/**
 * Recipe loops (A uses B, B uses A …), each as the codes along the loop, e.g. ["A", "B", "A"].
 * Each loop is reported once.
 */
export function recipeLoops(materials: readonly Material[]): string[][] {
  const byId = new Map(materials.map((m) => [m.id, m]));
  const loops: string[][] = [];
  const seen = new Set<string>();
  const walk = (id: string, path: string[]) => {
    const m = byId.get(id);
    const r = recipeOf(m);
    if (!r) return;
    for (const c of r.components) {
      const at = path.indexOf(c.materialId);
      if (at >= 0) {
        const ids = path.slice(at);
        const key = [...ids].sort().join(",");
        if (!seen.has(key)) {
          seen.add(key);
          loops.push([...ids, c.materialId].map((x) => byId.get(x)?.code || "?"));
        }
        continue;
      }
      walk(c.materialId, [...path, c.materialId]);
    }
  };
  for (const m of materials) walk(m.id, [m.id]);
  return loops;
}

/** The loop a recipe would make if `materialId` got these components (codes along it), or null. */
export function loopWith(materials: readonly Material[], materialId: string, recipe: Recipe | undefined): string[] | null {
  const next = materials.map((m) => (m.id === materialId ? withRecipe(m, recipe) : m));
  const code = materials.find((m) => m.id === materialId)?.code;
  return recipeLoops(next).find((l) => l.includes(code ?? "\u0000")) ?? null;
}

export function withRecipe(m: Material, recipe: Recipe | undefined): Material {
  const next = { ...m };
  if (recipe && recipe.components.length) next.recipe = recipe; else delete next.recipe;
  return next;
}

export function withBackups(m: Material, backups: BackupMaterial[] | undefined): Material {
  const next = { ...m };
  if (backups && backups.length) next.backups = backups; else delete next.backups;
  return next;
}

/** Every material a prepared material is made of, through nested recipes too (ids). */
export function componentIds(m: Material, byId: ReadonlyMap<string, Material>): Set<string> {
  const out = new Set<string>();
  const walk = (x: Material | undefined) => {
    for (const c of recipeOf(x)?.components ?? []) {
      if (out.has(c.materialId) || c.materialId === m.id) continue;
      out.add(c.materialId);
      walk(byId.get(c.materialId));
    }
  };
  walk(m);
  return out;
}

/** Materials whose recipe or backups name this one. */
export function usedIn(materials: readonly Material[], id: string): { recipes: Material[]; backups: Material[] } {
  return {
    recipes: materials.filter((m) => m.recipe?.components.some((c) => c.materialId === id)),
    backups: materials.filter((m) => m.backups?.some((b) => b.materialId === id)),
  };
}

/** Delete a material, and take it out of the recipes and backup lists of the others. */
export function deleteMaterial(materials: readonly Material[], id: string): Material[] {
  return materials.filter((m) => m.id !== id).map((m) => {
    let next = m;
    if (m.recipe?.components.some((c) => c.materialId === id)) next = withRecipe(next, { ...m.recipe, components: m.recipe.components.filter((c) => c.materialId !== id) });
    if (m.backups?.some((b) => b.materialId === id)) next = withBackups(next, m.backups.filter((b) => b.materialId !== id));
    return next;
  });
}

/**
 * Keep only recipe components and backups that name another material of the list, once, with a
 * quantity / ratio that is a number > 0. Returns how many entries were dropped.
 */
export function cleanMaterialRefs(materials: Material[]): number {
  const ids = new Set(materials.map((m) => m.id));
  let dropped = 0;
  for (const m of materials) {
    if (m.recipe) {
      const seen = new Set<string>();
      const comps = m.recipe.components.filter((c) => {
        const ok = ids.has(c.materialId) && c.materialId !== m.id && !seen.has(c.materialId) && Number.isFinite(c.qty) && c.qty > 0;
        seen.add(c.materialId);
        if (!ok) dropped++;
        return ok;
      });
      const per = Number.isFinite(m.recipe.per) && m.recipe.per > 0 ? m.recipe.per : 1;
      if (comps.length) {
        const next: Recipe = { ...m.recipe, per, components: comps.map((c) => (c.basis === "batch" ? { materialId: c.materialId, qty: c.qty, basis: "batch" as const } : { materialId: c.materialId, qty: c.qty })) };
        if (batchSize(next) == null) delete next.batch;
        if (next.batch == null || next.wholeBatches !== true) delete next.wholeBatches;
        m.recipe = next;
      } else delete m.recipe;
    }
    if (m.backups) {
      const seen = new Set<string>();
      const list = m.backups.filter((b) => {
        const ok = ids.has(b.materialId) && b.materialId !== m.id && !seen.has(b.materialId) && (b.ratio == null || (Number.isFinite(b.ratio) && b.ratio > 0));
        seen.add(b.materialId);
        if (!ok) dropped++;
        return ok;
      });
      if (list.length) m.backups = list; else delete m.backups;
    }
  }
  return dropped;
}

/** Read the recipe and backups of a material as stored in a project file (ids, not checked yet). */
export function readMaterialRefs(raw: Record<string, unknown>): Pick<Material, "recipe" | "backups"> {
  const out: Pick<Material, "recipe" | "backups"> = {};
  const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
  if (isObj(raw.recipe) && Array.isArray(raw.recipe.components)) {
    const r = raw.recipe;
    const components = (r.components as unknown[]).filter(isObj)
      .filter((c) => typeof c.materialId === "string")
      .map((c) => (c.basis === "batch" ? { materialId: c.materialId as string, qty: Number(c.qty), basis: "batch" as const } : { materialId: c.materialId as string, qty: Number(c.qty) }));
    out.recipe = { per: Number(r.per ?? 1), components };
    if (typeof r.note === "string" && r.note.trim()) out.recipe.note = r.note;
    if (r.batch != null && r.batch !== "") out.recipe.batch = Number(r.batch);
    if (r.wholeBatches === true) out.recipe.wholeBatches = true;
    if (r.shared === true) out.recipe.shared = true;
  }
  if (Array.isArray(raw.backups)) {
    out.backups = (raw.backups as unknown[]).filter(isObj).filter((b) => typeof b.materialId === "string").map((b) => {
      const x: BackupMaterial = { materialId: b.materialId as string };
      if (b.ratio != null && b.ratio !== "") x.ratio = Number(b.ratio);
      if (typeof b.note === "string" && b.note.trim()) x.note = b.note;
      return x;
    });
  }
  return out;
}

const nf = new Intl.NumberFormat("en-US", { maximumFractionDigits: 6 });

/**
 * "2.423 kg per 1,000 L" style summary of one component; a component per batch reads
 * "1 EA per batch of 200 L" (or "1 EA per batch" when the recipe has no batch size).
 */
export function componentText(qty: number, comp: Pick<Material, "unit" | "code">, per: number, parent: Pick<Material, "unit">, basis?: "batch", batch?: number | null): string {
  if (basis === "batch") return `${nf.format(qty)} ${comp.unit} per batch${batch ? ` of ${nf.format(batch)} ${parent.unit}` : ""}`;
  return `${nf.format(qty)} ${comp.unit} per ${nf.format(per)} ${parent.unit}`;
}

/** "Batches of 200 L, made in full" style summary of a recipe's batch settings, or "" when it has none. */
export function batchText(r: Recipe | null | undefined, unit: string): string {
  const size = batchSize(r);
  if (!r || size == null) return r?.components.some((c) => c.basis === "batch") ? (r.shared ? "one batch for all its BOM lines" : "one batch per BOM line") : "";
  return `batches of ${nf.format(size)} ${unit}${r.wholeBatches ? ", made in full" : ""}${r.shared ? ", one preparation for all its lines" : ""}`;
}
