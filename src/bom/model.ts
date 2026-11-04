/**
 * The BOM: material quantities per unit operation (UO), for each scenario (Sending, Receiving).
 *
 * Each line takes its quantity from exactly one source:
 *   MB      Σ material rows of the applied mass balance for this UO and material
 *   PFD     Σ counts linked on shapes in this UO's PFD drawing (pieces: for count units such as EA)
 *   manual  a number entered on the BOM screen, with a reason
 * and   quantity = source value × (1 + overage / 100).
 *
 * Lines come from three places: materials in the applied MB, materials linked on the PFD, and lines
 * the user added. A derived line is only stored once the user changes it (source, overage, note …).
 * Default source: MB when the MB has the material in that UO, else PFD when it is linked there and
 * counted in pieces, else manual (not entered yet).
 *
 * The applied MB is checked against the current PFD and material list (link/check.ts): rows for a
 * stream that is no longer on the PFD, an unknown material or another unit are left out, and the
 * line says so.
 *
 * Prepared materials (a material with a recipe: buffers, media, stock solutions made in-house) are
 * exploded: each counted line gets parts = line quantity × component quantity / recipe amount
 * (+ the component's default overage), recursively. The totals then list what to buy (purchased
 * materials, from lines and parts) apart from what to prepare (prepared materials).
 * A recipe with a batch size counts batches = ⌈line quantity ÷ batch size⌉ per line: components
 * "per batch" (a bag, a filter per preparation) are batches × their quantity, rounded up that way;
 * with "whole batches", proportional components are counted for batches × batch size.
 *
 * Backups (alternate materials) are listed under every line and part of their primary material with
 * quantity = primary quantity × ratio. They are summed on their own and never added to the totals.
 */
import { appliedRows, whyNotCounted } from "../link/check";
import { backupRatio, batchCount, batchSize, recipeOf, usesBatches } from "../model/recipes";
import type { BomLine, Material, Project, QtySource, Scenario, UnitOperation } from "../model/types";
import { pfdMaterialCounts, uosOnMap } from "../pfd/sync";

export type Values = Record<string, number | null>;

export interface BomRow {
  uoId: string;
  material: Material;
  /** The line as it applies: the stored one, or the derived default. */
  line: BomLine;
  stored: boolean;
  /** Added by the user (no MB rows and no PFD links for it). */
  manualOnly: boolean;
  /** What each source offers for this UO and material. */
  mb: Values | null;
  pfd: number | null;
  /** Value from the chosen source, before overage. */
  base: Values;
  overagePct: number;
  /** base × (1 + overage); null when the source has no value. */
  qty: Values;
  /** Needs attention: no value from the source, a manual line without a reason, MB values left out … */
  issues: string[];
  /** Applied MB rows for this UO and material that are not counted, and why. */
  leftOut: string[];
  /** For information: another source also has this material here (it is not counted). */
  notes: string[];
  /** Components from the material's recipe (nested recipes follow their parent, depth > 1). */
  parts: BomPart[];
  /** Batches to prepare per scenario, when the material's recipe counts in batches (else null). */
  batches: Values | null;
  /** Alternate materials of this line's material. */
  backups: BomBackup[];
}

/** A component of a prepared material on a BOM line (recipe explosion). */
export interface BomPart {
  material: Material;
  /** 1 = component of the line's material; 2 = component of a component … */
  depth: number;
  /** The prepared material it is made for (the line's material, or a component at depth − 1). */
  parent: Material;
  /** Recipe quantity of this component for `per` units of the parent (or per batch, see `basis`). */
  recipeQty: number;
  per: number;
  /** "batch": recipeQty per batch of the parent, counted `parentBatches` times. */
  basis?: "batch";
  /** Batch size of the parent's recipe, when it has one. */
  batch?: number;
  /** Batches of the parent per scenario, when its recipe counts in batches. */
  parentBatches?: Values;
  /** parent quantity × recipeQty / per (or batches × recipeQty), before overage. */
  base: Values;
  /** The component material's default overage. */
  overagePct: number;
  qty: Values;
  /** Set when the recipes loop back to a material above it: the part is not counted. */
  loop?: string;
  backups: BomBackup[];
}

export interface BomBackup {
  material: Material;
  /** The material it stands in for. */
  primary: Material;
  ratio: number;
  /** primary quantity × ratio (not counted in the totals). */
  qty: Values;
  note?: string;
  /** Different units and no ratio set: the quantity is probably not right. */
  unitHint?: string;
}

export interface BomUo {
  uo: UnitOperation;
  /** False when the UO's box is no longer on the process map. */
  onMap: boolean;
  rows: BomRow[];
}

export interface BomTotal {
  material: Material;
  qty: Values;
  /** Some counted lines have no quantity for a scenario: the total is a lower bound. */
  incomplete: Record<string, boolean>;
  uos: string[];
  /** Prepared materials it is a component of (codes), when some of it comes from recipes. */
  via: string[];
  /** Part of the quantity that comes from recipes (null when none does). */
  fromRecipes: Values | null;
  /** Prepared materials counted in batches: batches over all lines (each line is prepared on its own). */
  batches?: Values;
  /** Bought in packs (material.packSize): packs to order, ⌈total ÷ pack size⌉. */
  packs?: Values;
}

export interface BomBackupTotal {
  material: Material;
  qty: Values;
  incomplete: Record<string, boolean>;
  /** Codes of the materials it is a backup for. */
  forCodes: string[];
  uos: string[];
}

export interface BomResult {
  scenarios: Scenario[];
  uos: BomUo[];
  /** Materials to buy: lines and recipe parts of materials without a recipe. */
  totals: BomTotal[];
  /** Materials made in-house from their recipe (their components are in `totals`). */
  prepared: BomTotal[];
  /** Backup materials, summed on their own (not part of `totals`). */
  backupTotals: BomBackupTotal[];
  /** MB rows that cannot become BOM lines at all (material or unit operation not known), and why. */
  orphans: string[];
  /** Applied MB material rows left out of the BOM because they no longer match the PFD or the material list. */
  leftOutCount: number;
  issueCount: number;
}

const COUNT_UNITS = /^(ea|pcs?|pc|piece|pieces|set|sets|unit|units|개|ea\.)$/i;
export const isCountUnit = (unit: string) => COUNT_UNITS.test(unit.trim());

export function defaultSource(mb: Values | null, pfd: number | null, unit: string, mbLeftOut = false): QtySource {
  if (mb) return "MB";
  if (pfd != null && isCountUnit(unit)) return "PFD";
  // The MB had it here but its rows no longer count: keep MB, so the line says why it is empty.
  if (mbLeftOut) return "MB";
  return "manual";
}

const nf = new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 });
const fmt = (v: number) => nf.format(v);
/** Overage arithmetic without float noise (1.4875 × 1.1 = 1.63625, not 1.6362500000000002). */
export const withOverage = (v: number, pct: number) => Number((v * (1 + pct / 100)).toPrecision(12));
const clean = (v: number) => Number(v.toPrecision(12));

/** Backups of `primary` for a quantity of it. */
function backupsFor(primary: Material, qty: Values, scen: Scenario[], matById: Map<string, Material>): BomBackup[] {
  const out: BomBackup[] = [];
  for (const b of primary.backups ?? []) {
    const material = matById.get(b.materialId);
    if (!material) continue;
    const ratio = backupRatio(b);
    const q: Values = {};
    for (const s of scen) q[s.id] = qty[s.id] == null ? null : clean(qty[s.id]! * ratio);
    const x: BomBackup = { material, primary, ratio, qty: q };
    if (b.note) x.note = b.note;
    if (b.ratio == null && material.unit !== primary.unit) x.unitHint = `${material.code} is counted in ${material.unit}, ${primary.code} in ${primary.unit}: set the ratio (${material.unit} per ${primary.unit}) on the Materials screen.`;
    out.push(x);
  }
  return out;
}

/** Batches of a prepared material for a quantity of it, per scenario, when its recipe counts in batches. */
export function batchesFor(m: Material, qty: Values, scen: Scenario[]): Values | null {
  const r = recipeOf(m);
  if (!usesBatches(r)) return null;
  const out: Values = {};
  for (const s of scen) out[s.id] = qty[s.id] == null ? null : batchCount(r!, qty[s.id]!);
  return out;
}

/**
 * The components of a prepared material for a quantity of it, recursively (a component with a recipe
 * is followed by its own components). A component already above it in the chain is a loop: shown,
 * not counted, and not followed.
 */
export function explodeRecipe(parent: Material, parentQty: Values, scen: Scenario[], matById: Map<string, Material>, depth = 1, path: string[] = [parent.id]): BomPart[] {
  const recipe = recipeOf(parent);
  if (!recipe) return [];
  const out: BomPart[] = [];
  const size = batchSize(recipe);
  const batches = batchesFor(parent, parentQty, scen);
  for (const c of recipe.components) {
    const material = matById.get(c.materialId);
    if (!material) continue;
    const overagePct = material.overagePct ?? 0;
    const base: Values = {};
    const qty: Values = {};
    const loop = path.includes(material.id);
    for (const s of scen) {
      const pq = parentQty[s.id];
      const n = batches?.[s.id] ?? null;
      if (pq == null) base[s.id] = null;
      else if (c.basis === "batch") base[s.id] = clean(n! * c.qty);
      else base[s.id] = clean(((recipe.wholeBatches && size != null ? n! * size : pq) * c.qty) / recipe.per);
      qty[s.id] = base[s.id] == null || loop ? null : withOverage(base[s.id]!, overagePct);
    }
    const part: BomPart = { material, depth, parent, recipeQty: c.qty, per: recipe.per, base, overagePct, qty, backups: [] };
    if (c.basis === "batch") part.basis = "batch";
    if (size != null) part.batch = size;
    if (batches) part.parentBatches = batches;
    if (loop) {
      part.loop = `Recipe loop: ${[...path, material.id].map((id) => matById.get(id)?.code ?? "?").join(" → ")}. Not counted; fix the recipes on the Materials screen.`;
      out.push(part);
      continue;
    }
    part.backups = backupsFor(material, qty, scen, matById);
    out.push(part, ...explodeRecipe(material, qty, scen, matById, depth + 1, [...path, material.id]));
  }
  return out;
}

export function computeBom(p: Pick<Project, "uos" | "materials" | "bom" | "mb" | "pfd" | "streams">, pfdLinks?: Map<string, Map<string, number>>): BomResult {
  const scen = p.mb.scenarios;
  const matById = new Map(p.materials.map((m) => [m.id, m]));
  const matByCode = new Map(p.materials.map((m) => [m.code, m]));
  const orphans: string[] = [];

  // What the MB offers: uoId → materialId → values (rows that still match), and what it left out.
  const mbOffer = new Map<string, Map<string, Values>>();
  /** uoId → materialId → streams whose counted MB rows have it (to spot a solution and its chemicals on one stream). */
  const mbStreams = new Map<string, Map<string, Set<string>>>();
  const leftOut = new Map<string, Map<string, string[]>>();
  let leftOutCount = 0;
  for (const a of appliedRows(p)) {
    if (!a.row.matCode) continue;
    const m = a.material ?? matByCode.get(a.row.matCode);
    if (a.status !== "ok") leftOutCount++;
    if (!a.uo || !m) {
      orphans.push(a.status === "ok" || a.status === "unknown-material"
        ? `${a.row.matCode} in ${a.uoCode ?? "?"} (from ${a.row.streamId})${!m ? ": material not in the list" : ": unit operation not found"}`
        : whyNotCounted(p, a));
      continue;
    }
    if (a.status !== "ok") {
      const byMat = leftOut.get(a.uo.id) ?? new Map<string, string[]>();
      byMat.set(m.id, [...(byMat.get(m.id) ?? []), whyNotCounted(p, a)]);
      leftOut.set(a.uo.id, byMat);
      continue;
    }
    const st = mbStreams.get(a.uo.id) ?? new Map<string, Set<string>>();
    st.set(m.id, (st.get(m.id) ?? new Set<string>()).add(a.row.streamId));
    mbStreams.set(a.uo.id, st);
    const byMat = mbOffer.get(a.uo.id) ?? new Map<string, Values>();
    const cur = byMat.get(m.id) ?? {};
    for (const s of scen) {
      const v = a.row.values[s.id];
      if (v != null) cur[s.id] = Number(((cur[s.id] ?? 0) + v).toPrecision(12));
      else if (!(s.id in cur)) cur[s.id] = null;
    }
    byMat.set(m.id, cur);
    mbOffer.set(a.uo.id, byMat);
  }
  // What the PFD offers: uoId → materialId → count.
  const pfdOffer = pfdLinks ?? pfdMaterialCounts(p.pfd, p.uos, p.streams);
  const onMap = uosOnMap(p.pfd);

  const appliedScen = new Set(p.mb.current?.scenarios ?? []);
  let issueCount = 0;
  const uos: BomUo[] = [];
  for (const uo of [...p.uos].sort((a, b) => a.order - b.order)) {
    const stored = new Map((p.bom.lines[uo.id] ?? []).map((l) => [l.materialId, l]));
    const ids = new Set<string>([...(mbOffer.get(uo.id)?.keys() ?? []), ...(pfdOffer.get(uo.id)?.keys() ?? []), ...(leftOut.get(uo.id)?.keys() ?? []), ...stored.keys()]);
    const rows: BomRow[] = [];
    for (const matId of ids) {
      const material = matById.get(matId);
      if (!material) continue;
      const mb = mbOffer.get(uo.id)?.get(matId) ?? null;
      const pfd = pfdOffer.get(uo.id)?.get(matId) ?? null;
      const saved = stored.get(matId);
      const out = leftOut.get(uo.id)?.get(matId) ?? [];
      const line: BomLine = saved ?? { materialId: matId, qtySource: defaultSource(mb, pfd, material.unit, out.length > 0), manualQty: {} };
      const overagePct = line.overagePct ?? material.overagePct ?? 0;
      const base: Values = {};
      const qty: Values = {};
      const issues: string[] = [];
      const notes: string[] = [];
      for (const s of scen) {
        let v: number | null = null;
        if (line.qtySource === "MB") v = mb ? mb[s.id] ?? null : null;
        else if (line.qtySource === "PFD") v = pfd;
        else v = line.manualQty[s.id] ?? null;
        base[s.id] = v;
        qty[s.id] = v == null || line.excluded ? null : withOverage(v, overagePct);
      }
      if (!line.excluded) {
        if (line.qtySource === "MB" && !mb && !out.length) issues.push("The applied mass balance has no rows for this material here.");
        if (line.qtySource === "MB") issues.push(...out);
        else if (out.length) notes.push(...out);
        if (line.qtySource === "MB" && mb) for (const s of scen) if (appliedScen.has(s.id) && mb[s.id] == null) issues.push(`No ${s.name} value in the mass balance.`);
        if (line.qtySource === "PFD" && pfd == null) issues.push("Not linked on any shape in this unit operation's PFD drawing.");
        if (line.qtySource === "PFD" && pfd != null && !isCountUnit(material.unit)) issues.push(`PFD links count pieces, but ${material.code} is counted in ${material.unit}.`);
        if (line.qtySource === "manual") {
          const missing = scen.filter((s) => line.manualQty[s.id] == null).map((s) => s.name);
          if (missing.length) issues.push(`Enter ${missing.join(" and ")}.`);
          if (!line.note?.trim()) issues.push("Give a reason for the manual quantity.");
        }
        if (line.qtySource !== "PFD" && pfd != null) notes.push(`Also linked on the PFD (${fmt(pfd)}), not counted: the source is ${line.qtySource === "MB" ? "MB" : "manual"}.`);
        if (line.qtySource !== "MB" && mb) notes.push(`The mass balance also has it (${scen.filter((s) => mb[s.id] != null).map((s) => `${s.name} ${fmt(mb[s.id]!)}`).join(", ")}), not counted: the source is ${line.qtySource === "PFD" ? "PFD" : "manual"}.`);
      }
      const parts = line.excluded ? [] : explodeRecipe(material, qty, scen, matById);
      for (const part of parts) if (part.loop) issues.push(part.loop);
      // Material status: an obsolete material still counted needs replacing; one under review is a note.
      if (!line.excluded) {
        const by = (m: Material) => (m.replacedBy ? matById.get(m.replacedBy)?.code : undefined);
        if (material.status === "obsolete") issues.push(`${material.code} is obsolete${by(material) ? ` (replaced by ${by(material)})` : ""}: replace it (Materials › Replace…) or set the line to Not counted.`);
        else if (material.status === "review") notes.push(`${material.code} is under review.`);
        const old = [...new Map(parts.filter((x) => !x.loop && x.material.status === "obsolete").map((x) => [x.material.id, x])).values()];
        for (const x of old) issues.push(`Its recipe uses ${x.material.code}, which is obsolete${by(x.material) ? ` (replaced by ${by(x.material)})` : ""}: change the recipe of ${x.parent.code} (Materials).`);
      }
      issueCount += issues.length;
      const backups = line.excluded ? [] : backupsFor(material, qty, scen, matById);
      const batches = line.excluded ? null : batchesFor(material, qty, scen);
      rows.push({ uoId: uo.id, material, line, stored: !!saved, manualOnly: !mb && pfd == null && !out.length, mb, pfd, base, overagePct, qty, issues, notes, leftOut: out, parts, backups, batches });
    }
    // A stream whose MB rows list a solution and also one of its chemicals: probably counted twice.
    const st = mbStreams.get(uo.id);
    for (const r of rows) {
      if (r.line.excluded || r.line.qtySource !== "MB" || !st) continue;
      const mine = st.get(r.material.id) ?? new Set<string>();
      const hits: string[] = [];
      for (const o of rows) {
        if (o === r || o.line.qtySource !== "MB" || !o.parts.some((x) => x.material.id === r.material.id && !x.loop)) continue;
        const shared = [...(st.get(o.material.id) ?? [])].filter((id) => mine.has(id));
        if (shared.length) hits.push(`${o.material.code} (${shared.join(", ")})`);
      }
      if (hits.length) r.notes.push(`${r.material.code} is also in the recipe of ${hits.join(", ")}, on the same stream. If the mass balance lists both the solution and its chemicals there, it is counted twice.`);
    }
    rows.sort((a, b) => (a.material.category ?? "").localeCompare(b.material.category ?? "") || a.material.code.localeCompare(b.material.code));
    if (rows.length || onMap.has(uo.id)) uos.push({ uo, onMap: onMap.has(uo.id), rows });
  }

  // Totals per material over all UOs (lines not counted are left out): what to buy (lines and recipe
  // parts of materials without a recipe), what to prepare (materials with one), and backups apart.
  const buy = new Map<string, BomTotal>();
  const prep = new Map<string, BomTotal>();
  const alt = new Map<string, BomBackupTotal>();
  const addTo = (t: { qty: Values; incomplete: Record<string, boolean>; uos: string[] }, qty: Values, uoCode: string) => {
    for (const s of scen) {
      const v = qty[s.id];
      if (v == null) t.incomplete[s.id] = true;
      else t.qty[s.id] = clean((t.qty[s.id] ?? 0) + v);
      if (!(s.id in t.qty)) t.qty[s.id] = null;
    }
    if (!t.uos.includes(uoCode)) t.uos.push(uoCode);
  };
  const addItem = (material: Material, qty: Values, uoCode: string, via?: Material) => {
    const map = recipeOf(material) ? prep : buy;
    const t = map.get(material.id) ?? { material, qty: {}, incomplete: {}, uos: [], via: [], fromRecipes: null };
    addTo(t, qty, uoCode);
    const n = batchesFor(material, qty, scen);
    if (n) {
      const b: Values = t.batches ?? {};
      for (const s of scen) b[s.id] = n[s.id] == null ? b[s.id] ?? null : (b[s.id] ?? 0) + n[s.id]!;
      t.batches = b;
    }
    if (via) {
      if (!t.via.includes(via.code)) t.via.push(via.code);
      const f: Values = t.fromRecipes ?? {};
      for (const s of scen) f[s.id] = qty[s.id] == null ? f[s.id] ?? null : clean((f[s.id] ?? 0) + qty[s.id]!);
      t.fromRecipes = f;
    }
    map.set(material.id, t);
  };
  const addBackups = (list: BomBackup[], uoCode: string) => {
    for (const b of list) {
      const t = alt.get(b.material.id) ?? { material: b.material, qty: {}, incomplete: {}, forCodes: [], uos: [] };
      addTo(t, b.qty, uoCode);
      if (!t.forCodes.includes(b.primary.code)) t.forCodes.push(b.primary.code);
      alt.set(b.material.id, t);
    }
  };
  for (const u of uos) {
    for (const r of u.rows) {
      if (r.line.excluded) continue;
      addItem(r.material, r.qty, u.uo.code);
      addBackups(r.backups, u.uo.code);
      for (const part of r.parts) {
        if (part.loop) continue;
        addItem(part.material, part.qty, u.uo.code, part.parent);
        addBackups(part.backups, u.uo.code);
      }
    }
  }
  const byCat = (a: { material: Material }, b: { material: Material }) => (a.material.category ?? "").localeCompare(b.material.category ?? "") || a.material.code.localeCompare(b.material.code);
  return {
    scenarios: scen, uos,
    totals: [...buy.values()].map((t) => withPacks(t, scen)).sort(byCat),
    prepared: [...prep.values()].sort(byCat),
    backupTotals: [...alt.values()].sort(byCat),
    orphans, leftOutCount, issueCount: issueCount + orphans.length,
  };
}

/** Packs to order for a total bought in packs: ⌈total ÷ pack size⌉ per scenario (rounded up; 0 for 0). */
export function packsFor(packSize: number | undefined, qty: Values, scen: readonly { id: string }[]): Values | undefined {
  if (!packSize || !(packSize > 0)) return undefined;
  const out: Values = {};
  for (const s of scen) {
    const q = qty[s.id];
    out[s.id] = q == null ? null : q <= 0 ? 0 : Math.ceil(Number((q / packSize).toPrecision(12)));
  }
  return out;
}
const withPacks = (t: BomTotal, scen: readonly { id: string }[]): BomTotal => {
  const packs = packsFor(t.material.packSize, t.qty, scen);
  return packs ? { ...t, packs } : t;
};

// ---- editing lines --------------------------------------------------------------------------

/** Store a line for (uo, material) with a change applied; the derived line is the starting point. */
export function setLine(p: Project, row: Pick<BomRow, "uoId" | "line">, patch: Partial<BomLine>): Project {
  const list = p.bom.lines[row.uoId] ?? [];
  const next: BomLine = { ...row.line, ...patch };
  // A key set to undefined is cleared (overage back to the material's default, counted again …).
  for (const [k, v] of Object.entries(patch)) if (v === undefined) delete (next as unknown as Record<string, unknown>)[k];
  const exists = list.some((l) => l.materialId === row.line.materialId);
  const lines = exists ? list.map((l) => (l.materialId === row.line.materialId ? next : l)) : [...list, next];
  return { ...p, bom: { ...p.bom, lines: { ...p.bom.lines, [row.uoId]: lines } } };
}

/** Forget the stored line: a derived line goes back to its defaults, an added one disappears. */
export function removeLine(p: Project, uoId: string, materialId: string): Project {
  const lines = (p.bom.lines[uoId] ?? []).filter((l) => l.materialId !== materialId);
  const all = { ...p.bom.lines };
  if (lines.length) all[uoId] = lines; else delete all[uoId];
  return { ...p, bom: { ...p.bom, lines: all } };
}

export function addManualLine(p: Project, uoId: string, materialId: string): Project {
  if ((p.bom.lines[uoId] ?? []).some((l) => l.materialId === materialId)) return p;
  const line: BomLine = { materialId, qtySource: "manual", manualQty: {} };
  return { ...p, bom: { ...p.bom, lines: { ...p.bom.lines, [uoId]: [...(p.bom.lines[uoId] ?? []), line] } } };
}
