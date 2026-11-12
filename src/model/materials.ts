import { newId } from "./ids";
import { recipeLoops, withBackups, withRecipe } from "./recipes";
import type { BackupMaterial, Material, MaterialStatus, Recipe } from "./types";

type ImportField = "code" | "name" | "unit" | "category" | "spec" | "note" | "overagePct" | "status" | "supplier" | "partNo" | "packSize";

/** Header names accepted when importing a material list (case and spaces ignored; Korean headers too). */
const HEADER_ALIASES: Record<ImportField, string[]> = {
  code: ["code", "matcode", "materialcode", "코드", "자재코드", "물질코드", "품목코드"],
  name: ["name", "materialname", "이름", "자재명", "물질명", "품명", "품목명"],
  unit: ["unit", "uom", "단위"],
  category: ["category", "class", "bomclass", "분류", "구분", "카테고리"],
  spec: ["spec", "specification", "grade", "규격", "사양"],
  note: ["note", "remark", "remarks", "비고", "메모"],
  overagePct: ["overage", "overage%", "overagepct", "overagepercent", "여유율", "여유율%", "여유분"],
  status: ["status", "state", "lifecycle", "상태", "사용상태"],
  supplier: ["supplier", "vendor", "manufacturer", "maker", "공급사", "공급업체", "제조사", "업체"],
  partNo: ["partno", "partnumber", "catalogno", "catalognumber", "catalogueno", "catno", "cat#", "partno#", "품번", "카탈로그번호", "카탈로그", "제품번호", "부품번호"],
  packSize: ["packsize", "pack", "packquantity", "packqty", "unitsperpack", "포장단위", "포장크기", "포장", "입수"],
};

/** "Under review", "검토 중" → review; "Obsolete", "단종" → obsolete; "", "Active", "사용 중" → in use. */
export function parseStatus(s: string): MaterialStatus | undefined | null {
  const v = s.toLowerCase().replace(/[\s_\-.]/g, "");
  if (["", "active", "inuse", "use", "사용", "사용중", "정상"].includes(v)) return undefined;
  if (["review", "underreview", "inreview", "검토", "검토중"].includes(v)) return "review";
  if (["obsolete", "discontinued", "phaseout", "단종", "사용중지", "폐기"].includes(v)) return "obsolete";
  return null;
}
export const STATUS_LABEL: Record<"active" | MaterialStatus, string> = { active: "In use", review: "Under review", obsolete: "Obsolete" };

const normHeader = (s: unknown) => String(s ?? "").toLowerCase().replace(/[\s_\-./()]/g, "");

export interface ImportRow {
  row: number;
  code: string;
  name: string;
  unit: string;
  category?: string;
  spec?: string;
  note?: string;
  overagePct?: number;
  /** null: in use (the file says so); undefined: the file has no status. */
  status?: MaterialStatus | null;
  supplier?: string;
  partNo?: string;
  packSize?: number;
}

export interface ImportPlan {
  columns: Partial<Record<ImportField, number>>;
  add: ImportRow[];
  update: { row: ImportRow; existing: Material; changes: string[] }[];
  unchanged: ImportRow[];
  errors: { row: number; message: string }[];
}

/**
 * Plan an import from a table (first row = headers). Rows whose code exists are updates; new codes
 * are additions. Nothing changes until `applyImport`.
 */
export function planMaterialImport(table: unknown[][], existing: Material[]): ImportPlan {
  const plan: ImportPlan = { columns: {}, add: [], update: [], unchanged: [], errors: [] };
  const header = (table[0] ?? []).map(normHeader);
  for (const [key, aliases] of Object.entries(HEADER_ALIASES) as [keyof typeof HEADER_ALIASES, string[]][]) {
    const idx = header.findIndex((h) => aliases.includes(h));
    if (idx >= 0) plan.columns[key] = idx;
  }
  const missing = (["code", "name", "unit"] as const).filter((k) => plan.columns[k] === undefined);
  if (missing.length) {
    plan.errors.push({ row: 1, message: `Row 1 has no ${missing.map((k) => ({ code: "Code", name: "Name", unit: "Unit" })[k]).join(", ")} header.` });
    return plan;
  }
  const byCode = new Map(existing.map((m) => [m.code, m]));
  const seen = new Map<string, number>();
  for (let i = 1; i < table.length; i++) {
    const cells = table[i] ?? [];
    const get = (k: keyof typeof HEADER_ALIASES) => {
      const idx = plan.columns[k];
      return idx === undefined ? "" : String(cells[idx] ?? "").trim();
    };
    const row: ImportRow = { row: i + 1, code: get("code"), name: get("name"), unit: get("unit") };
    for (const k of ["category", "spec", "note", "supplier", "partNo"] as const) {
      const v = get(k);
      if (v) row[k] = v;
    }
    if (!row.code && !row.name && !row.unit) continue;
    const pack = get("packSize").replace(/,/g, "").trim();
    if (pack) {
      const n = Number(pack);
      if (!Number.isFinite(n) || n <= 0) { plan.errors.push({ row: row.row, message: `${row.code || "?"}: Pack size '${pack}' is not a number above 0 (in the material's unit, e.g. 25 for a 25 kg bag).` }); continue; }
      row.packSize = n;
    }
    const ovg = get("overagePct").replace(/%$/, "").trim();
    if (ovg) {
      const n = Number(ovg.replace(/,/g, ""));
      if (!Number.isFinite(n) || n < 0) { plan.errors.push({ row: row.row, message: `${row.code || "?"}: Overage '${ovg}' is not a number ≥ 0 (write 5 for 5 %).` }); continue; }
      row.overagePct = n;
    }
    if (plan.columns.status !== undefined) {
      const st = parseStatus(get("status"));
      if (st === null) { plan.errors.push({ row: row.row, message: `${row.code || "?"}: Status '${get("status")}' is not In use, Under review or Obsolete.` }); continue; }
      row.status = st ?? null;
    }
    if (!row.code) { plan.errors.push({ row: row.row, message: "Code is empty." }); continue; }
    if (!row.unit) { plan.errors.push({ row: row.row, message: `${row.code}: Unit is empty.` }); continue; }
    if (seen.has(row.code)) { plan.errors.push({ row: row.row, message: `${row.code}: same code as row ${seen.get(row.code)}.` }); continue; }
    seen.set(row.code, row.row);
    const cur = byCode.get(row.code);
    if (!cur) { plan.add.push(row); continue; }
    const changes: string[] = [];
    if (row.name && row.name !== cur.name) changes.push(`name ${cur.name} → ${row.name}`);
    if (row.unit !== cur.unit) changes.push(`unit ${cur.unit} → ${row.unit}`);
    for (const k of ["category", "spec", "note"] as const) if (row[k] !== undefined && row[k] !== (cur[k] ?? "")) changes.push(`${k} changed`);
    if (row.supplier !== undefined && row.supplier !== (cur.supplier ?? "")) changes.push("supplier changed");
    if (row.partNo !== undefined && row.partNo !== (cur.partNo ?? "")) changes.push(`part no. ${cur.partNo ?? "–"} → ${row.partNo}`);
    if (row.packSize !== undefined && row.packSize !== cur.packSize) changes.push(`pack ${cur.packSize ?? "–"} → ${row.packSize} ${row.unit}`);
    if (row.overagePct !== undefined && row.overagePct !== (cur.overagePct ?? 0)) changes.push(`overage ${cur.overagePct ?? 0} → ${row.overagePct} %`);
    if (row.status !== undefined && (row.status ?? undefined) !== cur.status) changes.push(`status ${STATUS_LABEL[cur.status ?? "active"]} → ${STATUS_LABEL[row.status ?? "active"]}`);
    if (changes.length) plan.update.push({ row, existing: cur, changes });
    else plan.unchanged.push(row);
  }
  return plan;
}

export function applyImport(existing: Material[], plan: ImportPlan): Material[] {
  const updates = new Map(plan.update.map((u) => [u.existing.id, u.row]));
  const out = existing.map((m) => {
    const r = updates.get(m.id);
    if (!r) return m;
    const next: Material = { ...m, name: r.name || m.name, unit: r.unit };
    for (const k of ["category", "spec", "note", "supplier", "partNo"] as const) if (r[k] !== undefined) next[k] = r[k];
    if (r.packSize !== undefined) next.packSize = r.packSize;
    if (r.overagePct !== undefined) next.overagePct = r.overagePct;
    if (r.status !== undefined) { if (r.status) next.status = r.status; else delete next.status; }
    return next;
  });
  for (const r of plan.add) {
    const m: Material = { id: newId("mat"), code: r.code, name: r.name || r.code, unit: r.unit };
    for (const k of ["category", "spec", "note", "supplier", "partNo"] as const) if (r[k] !== undefined) m[k] = r[k];
    if (r.packSize !== undefined) m.packSize = r.packSize;
    if (r.overagePct !== undefined) m.overagePct = r.overagePct;
    if (r.status) m.status = r.status;
    out.push(m);
  }
  return out;
}

/** Minimal RFC 4180 CSV reader (quotes, escaped quotes, CRLF). Detects ; or tab when there is no comma. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const firstLine = src.split(/\r?\n/, 1)[0] ?? "";
  const delim = firstLine.includes(",") ? "," : firstLine.includes("\t") ? "\t" : firstLine.includes(";") ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"' && field === "") quoted = true;
    else if (c === delim) { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

export function materialToRow(m: Material, all?: readonly Material[]): (string | number | undefined)[] {
  const by = m.replacedBy ? all?.find((x) => x.id === m.replacedBy)?.code : undefined;
  // N5.6: the other way round too: the materials this one replaced (marked obsolete, replaced by it).
  const replaces = all?.filter((x) => x.replacedBy === m.id).map((x) => x.code).join(", ") || undefined;
  return [m.code, m.name, m.unit, m.category, m.spec, m.overagePct, m.note, STATUS_LABEL[m.status ?? "active"], by, m.supplier, m.partNo, m.packSize, replaces];
}
/** Import reads these by name; Replaced by and Replaces are only shown (Replace… sets them). */
export const MATERIAL_EXPORT_HEADER = ["Code", "Name", "Unit", "Category", "Spec", "Overage %", "Note", "Status", "Replaced by", "Supplier", "Part no.", "Pack size", "Replaces"];

// ---- recipes and backups as sheets (export and import) ------------------------------------------

export const RECIPE_EXPORT_HEADER = ["Code", "Name", "Per", "Unit", "Component code", "Component", "Quantity", "Component unit", "Basis", "Batch size", "Whole batches", "Note", "Shared preparation"];
export const BACKUP_EXPORT_HEADER = ["Code", "Name", "Backup code", "Backup", "Ratio", "Note"];

/**
 * One row per recipe component: the prepared material, the amount the recipe is for, the component and
 * its quantity, "Per batch" for a component counted per batch, and the recipe's batch size and
 * whole-batches setting (on every row, like Per).
 */
export function recipeRows(materials: readonly Material[]): (string | number | undefined)[][] {
  const byId = new Map(materials.map((m) => [m.id, m]));
  const rows: (string | number | undefined)[][] = [];
  for (const m of materials) {
    if (!m.recipe?.components.length) continue;
    const r = m.recipe;
    r.components.forEach((c, i) => {
      const comp = byId.get(c.materialId);
      rows.push([m.code, m.name, r.per, m.unit, comp?.code, comp?.name, c.qty, comp?.unit, c.basis === "batch" ? "Per batch" : undefined, r.batch, r.batch && r.wholeBatches ? "Yes" : undefined, i === 0 ? r.note : undefined, r.shared ? "Yes" : undefined]);
    });
  }
  return rows;
}

/** One row per backup material. */
export function backupRows(materials: readonly Material[]): (string | number | undefined)[][] {
  const byId = new Map(materials.map((m) => [m.id, m]));
  const rows: (string | number | undefined)[][] = [];
  for (const m of materials) for (const b of m.backups ?? []) {
    const alt = byId.get(b.materialId);
    rows.push([m.code, m.name, alt?.code, alt?.name, b.ratio ?? 1, b.note]);
  }
  return rows;
}

const RECIPE_ALIASES = {
  code: ["code", "preparedcode", "buffercode", "solutioncode", "제조품코드", "버퍼코드", "자재코드", "코드"],
  per: ["per", "peramount", "recipeamount", "기준량", "기준"],
  basis: ["basis", "countedper", "산정기준", "기준방식"],
  batch: ["batchsize", "batch", "batchvolume", "배치크기", "배치", "조제단위", "조제량"],
  whole: ["wholebatches", "fullbatches", "wholebatch", "전량조제", "배치전량"],
  shared: ["sharedpreparation", "shared", "onepreparation", "preparedonce", "공유조제", "한번조제", "나눠씀"],
  unit: ["unit", "uom", "단위"],
  component: ["componentcode", "chemicalcode", "ingredientcode", "rawmaterialcode", "원료코드", "성분코드"],
  qty: ["quantity", "qty", "amount", "수량", "함량", "투입량"],
  compUnit: ["componentunit", "chemicalunit", "원료단위", "성분단위"],
  note: ["note", "remark", "remarks", "비고", "메모"],
};
const BACKUP_ALIASES = {
  code: ["code", "primarycode", "주자재코드", "자재코드", "코드"],
  backup: ["backupcode", "alternatecode", "substitutecode", "대체자재코드", "대체코드", "백업코드"],
  ratio: ["ratio", "factor", "비율", "환산비"],
  note: ["note", "remark", "remarks", "비고", "메모"],
};

function columnsOf<K extends string>(header: unknown[], aliases: Record<K, string[]>): Partial<Record<K, number>> {
  const h = header.map(normHeader);
  const out: Partial<Record<K, number>> = {};
  for (const [k, list] of Object.entries(aliases) as [K, string[]][]) {
    const i = h.findIndex((x) => list.includes(x));
    if (i >= 0) out[k] = i;
  }
  return out;
}

const num = (s: string) => Number(s.replace(/,/g, "").trim());
const BATCH_BASIS = ["batch", "perbatch", "배치", "배치당", "batchwise"];
const AMOUNT_BASIS = ["", "per", "amount", "peramount", "proportional", "비례", "양"];
const YES = ["yes", "y", "true", "1", "o", "예", "네"];
const NO = ["", "no", "n", "false", "0", "x", "아니오"];

export interface RefsPlan {
  /** Prepared materials (by code) whose recipe the file sets; `changed` = differs from the list. */
  recipes: { code: string; per: number; components: { code: string; qty: number; basis?: "batch" }[]; batch?: number; wholeBatches?: boolean; shared?: boolean; note?: string; changed: boolean }[];
  /** Materials (by code) whose backups the file sets. */
  backups: { code: string; backups: { code: string; ratio?: number; note?: string }[]; changed: boolean }[];
  errors: { sheet: string; row: number; message: string }[];
}

const sameRecipe = (a: Recipe | undefined, b: Recipe | undefined) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * Plan the Recipes and Backups sheets of a material file against the list as it will be after the
 * material rows are imported (`after`). A material named in a sheet gets exactly the rows the sheet has.
 */
export function planRefsImport(recipeTable: unknown[][] | null, backupTable: unknown[][] | null, after: readonly Material[]): RefsPlan {
  const plan: RefsPlan = { recipes: [], backups: [], errors: [] };
  const byCode = new Map(after.map((m) => [m.code, m]));
  const cell = (cells: unknown[], i: number | undefined) => (i === undefined ? "" : String(cells[i] ?? "").trim());

  if (recipeTable && recipeTable.length) {
    const col = columnsOf(recipeTable[0] ?? [], RECIPE_ALIASES);
    const missing = [["code", "Code"], ["component", "Component code"], ["qty", "Quantity"]].filter(([k]) => col[k as keyof typeof col] === undefined).map(([, l]) => l);
    if (missing.length) plan.errors.push({ sheet: "Recipes", row: 1, message: `Row 1 has no ${missing.join(", ")} header.` });
    else {
      const map = new Map<string, RefsPlan["recipes"][number]>();
      for (let i = 1; i < recipeTable.length; i++) {
        const cells = recipeTable[i] ?? [];
        const code = cell(cells, col.code), comp = cell(cells, col.component), qtyText = cell(cells, col.qty);
        if (!code && !comp && !qtyText) continue;
        const err = (message: string) => plan.errors.push({ sheet: "Recipes", row: i + 1, message });
        const m = byCode.get(code), c = byCode.get(comp);
        if (!m) { err(`${code || "?"}: not in the material list.`); continue; }
        if (!c) { err(`${code}: component ${comp || "?"} is not in the material list.`); continue; }
        if (c === m) { err(`${code}: a material cannot be its own component.`); continue; }
        const qty = num(qtyText);
        if (!Number.isFinite(qty) || qty <= 0) { err(`${code}: quantity of ${comp} '${qtyText}' is not a number > 0.`); continue; }
        const perText = cell(cells, col.per);
        const per = perText ? num(perText) : 1;
        if (!Number.isFinite(per) || per <= 0) { err(`${code}: Per '${perText}' is not a number > 0.`); continue; }
        const unit = cell(cells, col.unit), compUnit = cell(cells, col.compUnit);
        if (unit && unit !== m.unit) { err(`${code} is counted in ${m.unit}, the file says ${unit}.`); continue; }
        if (compUnit && compUnit !== c.unit) { err(`${comp} is counted in ${c.unit}, the file says ${compUnit}.`); continue; }
        const basisText = cell(cells, col.basis).toLowerCase().replace(/[\s_\-./()]/g, "");
        if (!BATCH_BASIS.includes(basisText) && !AMOUNT_BASIS.includes(basisText)) { err(`${code}: Basis '${cell(cells, col.basis)}' is neither 'Per batch' nor empty (per ${per} ${m.unit}).`); continue; }
        const batchText = cell(cells, col.batch);
        const batch = batchText ? num(batchText) : undefined;
        if (batch !== undefined && (!Number.isFinite(batch) || batch <= 0)) { err(`${code}: Batch size '${batchText}' is not a number > 0.`); continue; }
        const wholeText = cell(cells, col.whole).toLowerCase();
        if (!YES.includes(wholeText) && !NO.includes(wholeText)) { err(`${code}: Whole batches '${cell(cells, col.whole)}' is not Yes or empty.`); continue; }
        const sharedText = cell(cells, col.shared).toLowerCase();
        if (!YES.includes(sharedText) && !NO.includes(sharedText)) { err(`${code}: Shared preparation '${cell(cells, col.shared)}' is not Yes or empty.`); continue; }
        const r = map.get(code) ?? { code, per, components: [], changed: false };
        if (r.per !== per) { err(`${code}: Per ${per} differs from ${r.per} on an earlier row.`); continue; }
        if (batch !== undefined && r.batch !== undefined && r.batch !== batch) { err(`${code}: Batch size ${batch} differs from ${r.batch} on an earlier row.`); continue; }
        if (r.components.some((x) => x.code === comp)) { err(`${code}: ${comp} appears twice.`); continue; }
        r.components.push(BATCH_BASIS.includes(basisText) ? { code: comp, qty, basis: "batch" } : { code: comp, qty });
        if (batch !== undefined) r.batch = batch;
        if (YES.includes(wholeText)) r.wholeBatches = true;
        if (YES.includes(sharedText)) r.shared = true;
        const note = cell(cells, col.note);
        if (note && !r.note) r.note = note;
        map.set(code, r);
      }
      plan.recipes = [...map.values()];
      for (const r of plan.recipes) if (r.wholeBatches && r.batch === undefined) plan.errors.push({ sheet: "Recipes", row: 0, message: `${r.code}: Whole batches needs a batch size; it is ignored.` });
    }
  }

  if (backupTable && backupTable.length) {
    const col = columnsOf(backupTable[0] ?? [], BACKUP_ALIASES);
    const missing = [["code", "Code"], ["backup", "Backup code"]].filter(([k]) => col[k as keyof typeof col] === undefined).map(([, l]) => l);
    if (missing.length) plan.errors.push({ sheet: "Backups", row: 1, message: `Row 1 has no ${missing.join(", ")} header.` });
    else {
      const map = new Map<string, RefsPlan["backups"][number]>();
      for (let i = 1; i < backupTable.length; i++) {
        const cells = backupTable[i] ?? [];
        const code = cell(cells, col.code), alt = cell(cells, col.backup);
        if (!code && !alt) continue;
        const err = (message: string) => plan.errors.push({ sheet: "Backups", row: i + 1, message });
        if (!byCode.has(code)) { err(`${code || "?"}: not in the material list.`); continue; }
        if (!byCode.has(alt)) { err(`${code}: backup ${alt || "?"} is not in the material list.`); continue; }
        if (alt === code) { err(`${code}: a material cannot be its own backup.`); continue; }
        const ratioText = cell(cells, col.ratio);
        const ratio = ratioText ? num(ratioText) : undefined;
        if (ratio !== undefined && (!Number.isFinite(ratio) || ratio <= 0)) { err(`${code}: ratio '${ratioText}' is not a number > 0.`); continue; }
        const b = map.get(code) ?? { code, backups: [], changed: false };
        if (b.backups.some((x) => x.code === alt)) { err(`${code}: backup ${alt} appears twice.`); continue; }
        const note = cell(cells, col.note);
        b.backups.push({ code: alt, ...(ratio !== undefined && ratio !== 1 ? { ratio } : {}), ...(note ? { note } : {}) });
        map.set(code, b);
      }
      plan.backups = [...map.values()];
    }
  }

  // What would change, and loops the new recipes would make.
  const next = applyRefsImport(after, plan);
  const nextBy = new Map(next.map((m) => [m.code, m]));
  for (const r of plan.recipes) r.changed = !sameRecipe(byCode.get(r.code)?.recipe, nextBy.get(r.code)?.recipe);
  for (const b of plan.backups) b.changed = JSON.stringify(byCode.get(b.code)?.backups ?? null) !== JSON.stringify(nextBy.get(b.code)?.backups ?? null);
  const before = new Set(recipeLoops(after).map((l) => l.join(">")));
  for (const loop of recipeLoops(next)) {
    if (before.has(loop.join(">"))) continue;
    plan.errors.push({ sheet: "Recipes", row: 0, message: `These recipes make a loop (${loop.join(" → ")}); their rows are left out.` });
    const inLoop = new Set(loop);
    plan.recipes = plan.recipes.filter((r) => !inLoop.has(r.code));
  }
  return plan;
}

/** Set the recipes and backups of the plan (codes resolved in `materials`). */
export function applyRefsImport(materials: readonly Material[], plan: Pick<RefsPlan, "recipes" | "backups">): Material[] {
  const byCode = new Map(materials.map((m) => [m.code, m]));
  const recipes = new Map(plan.recipes.map((r) => [r.code, r]));
  const backups = new Map(plan.backups.map((b) => [b.code, b]));
  return materials.map((m) => {
    let next = m;
    const r = recipes.get(m.code);
    if (r) {
      const recipe: Recipe = { per: r.per, components: r.components.map((c) => ({ materialId: byCode.get(c.code)!.id, qty: c.qty, ...(c.basis === "batch" ? { basis: "batch" as const } : {}) })) };
      const note = r.note ?? m.recipe?.note;
      if (note) recipe.note = note;
      if (r.batch !== undefined) recipe.batch = r.batch;
      if (r.batch !== undefined && r.wholeBatches) recipe.wholeBatches = true;
      if (r.shared) recipe.shared = true;
      next = withRecipe(next, recipe);
    }
    const b = backups.get(m.code);
    if (b) next = withBackups(next, b.backups.map((x): BackupMaterial => ({ materialId: byCode.get(x.code)!.id, ...(x.ratio !== undefined ? { ratio: x.ratio } : {}), ...(x.note ? { note: x.note } : {}) })));
    return next;
  });
}

// ---- bulk edit ---------------------------------------------------------------------------------------

/** Fields set on many materials at once; a field left out is kept as it is on each material. */
export interface BulkPatch {
  category?: string;
  spec?: string;
  note?: string;
  supplier?: string;
  overagePct?: number;
  packSize?: number;
  status?: "active" | MaterialStatus;
}

/** Apply a bulk patch to the materials with these ids ("" clears a text field; status "active" = in use). */
export function bulkEdit(materials: readonly Material[], ids: ReadonlySet<string>, patch: BulkPatch): Material[] {
  return materials.map((m) => {
    if (!ids.has(m.id)) return m;
    const n: Material = { ...m };
    for (const k of ["category", "spec", "note", "supplier"] as const) {
      const v = patch[k];
      if (v === undefined) continue;
      if (v.trim()) n[k] = v.trim(); else delete n[k];
    }
    if (patch.overagePct !== undefined) { if (patch.overagePct > 0) n.overagePct = patch.overagePct; else delete n.overagePct; }
    if (patch.packSize !== undefined) { if (patch.packSize > 0) n.packSize = patch.packSize; else delete n.packSize; }
    if (patch.status === "active") { delete n.status; delete n.replacedBy; } else if (patch.status) n.status = patch.status;
    return n;
  });
}
