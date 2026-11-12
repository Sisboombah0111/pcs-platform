/**
 * SAP BOMs of semi-finished products (N5.7), built from the BOM screen's lines without changing them.
 *
 * A semi-finished product (SAP material type HALB) is set up per unit operation:
 *   uo         the unit operation's run: its BOM lines (buffers, filters, consumables …) and, when the
 *              unit operation receives a transfer from one that has its own, that semi-finished product
 *              (the intermediate, as much as the transfer stream carries).
 *              Base quantity = one batch's output: the MB flow of its output stream (the first transfer
 *              out, or a stream chosen, or a number typed).
 *   packing    column packing: the BOM lines of its unit operation given to it (resin, packing buffer …).
 *   unpacking  unpacking / cleaning: the same. Both are 1 EA unless a base quantity is typed.
 * Every prepared material (a buffer or medium with a recipe) is a semi-finished product too, under its own
 * code (MatCode = SAP material number): its recipe is its BOM, written for one batch (or for the recipe's
 * amount when it has no batch size). Components "per batch" (a bag per preparation) are fixed quantities.
 *
 * Quantities are those of one scenario (the receiving one by default), before overage: the overage is the
 * item's component scrap (AUSCH), as SAP adds it on top. SAP keeps 3 decimals: a quantity that would be
 * rounded is flagged, with a smaller unit to use in the BOMs (kg → g × 1000) as a conversion factor of
 * the material (alternative unit of measure).
 */
import type { BomResult, BomRow } from "./model";
import { batchSize, recipeOf } from "../model/recipes";
import { newId } from "../model/ids";
import type { Material, Project, Scenario, SapDateFormat, SapSetup, SemiFinished, SemiKind, UnitOperation } from "../model/types";
import { streamFlow, uoStreams } from "../ops/model";

export const SEMI_KIND_LABEL: Record<SemiKind, string> = { uo: "Unit operation", packing: "Column packing", unpacking: "Unpacking" };
const KIND_ORDER: Record<SemiKind, number> = { packing: 0, uo: 1, unpacking: 2 };

export const DEFAULT_CODE_DIGITS = 7;
export const DATE_FORMATS: SapDateFormat[] = ["YYYY.MM.DD", "YYYYMMDD", "YYYY-MM-DD", "DD.MM.YYYY", "MM/DD/YYYY"];
/** App unit (lower case) → SAP unit of measure. */
export const DEFAULT_UNITS: Record<string, string> = { l: "L", ml: "ML", kg: "KG", g: "G", mg: "MG", ea: "EA" };
/** A smaller unit for quantities SAP would round (3 decimals): 1 of the unit = 1000 of the smaller one. */
export const SMALLER_UNIT: Record<string, string> = { kg: "g", g: "mg", l: "mL" };

export interface SapItem {
  /** Item number, "0010", "0020" … */
  pos: string;
  code: string;
  name: string;
  /** Exact quantity in `unit`, and as SAP will keep it (3 decimals). */
  qty: number | null;
  sapQty: number | null;
  /** SAP unit, and the unit in this app. */
  unit: string;
  appUnit: string;
  /** Fixed quantity (FMENG): not in proportion to the order quantity (a bag per preparation). */
  fixed: boolean;
  /** Component scrap % (AUSCH): the overage. */
  scrapPct: number | null;
  /** Where the quantity comes from: MB, PFD, Manual, Recipe, Per batch, ST-… (the intermediate). */
  source: string;
  materialId?: string;
  semiId?: string;
  /** A conversion factor is used: 1 appUnit = factor unit. */
  factor?: number;
}

export interface SapBom {
  /** Semi-finished id, or "prep:<material id>". */
  key: string;
  kind: SemiKind | "prep";
  code: string;
  name: string;
  uo?: UnitOperation;
  baseQty: number | null;
  baseUnit: string;
  appBaseUnit: string;
  /** Where the base quantity comes from: "ST-PROA-CEX · Receiving", "typed", "one batch (2,000 L)" … */
  baseFrom: string;
  items: SapItem[];
  semi?: SemiFinished;
  material?: Material;
  /** Prepared materials: the unit operations whose lines use it. */
  usedIn?: string[];
}

export interface SapFix { materialId: string; unit: string; factor: number; label: string }
export interface SapIssue {
  level: "error" | "warning" | "note";
  /** BOM key and code it belongs to (not set: the whole set-up). */
  key?: string;
  code?: string;
  pos?: string;
  message: string;
  fix?: SapFix;
  /** "codes": a material whose code is not a SAP number (shown together). */
  group?: "codes";
  /** The BOMs it concerns besides `key` (a component code in several BOMs). */
  keys?: string[];
  /** A shorter line for a list under a summary (the material codes). */
  short?: string;
}

export interface SapMaterial { code: string; name: string; type: "HALB" | "ROH"; unit: string; appUnit: string; usedIn: string[]; category?: string; note?: string }
export interface SapUnitRow { code: string; name: string; base: string; alt: string; umrez: number; umren: number; text: string }

export interface SapResult {
  setup: Required<Pick<SapSetup, "usage" | "alternative" | "status" | "dateFormat">> & SapSetup;
  scenario: Scenario | null;
  boms: SapBom[];
  /** Unit operations with counted lines and no semi-finished product of their own. */
  unassigned: { uo: UnitOperation; rows: number }[];
  materials: SapMaterial[];
  units: SapUnitRow[];
  issues: SapIssue[];
  errors: number;
  warnings: number;
}

const clean = (v: number) => Number(v.toPrecision(12));
export const round3 = (v: number) => Math.round(Number((v * 1000).toPrecision(12))) / 1000;
const nf = new Intl.NumberFormat("en-US", { maximumFractionDigits: 6 });
const fmt = (v: number) => nf.format(v);
export const posText = (n: number) => String(n * 10).padStart(4, "0");

export const emptySetup = (): SapSetup => ({ semi: [] });
export const setupOf = (p: Pick<Project, "bom">): SapSetup => p.bom.sap ?? emptySetup();

/** The scenario whose quantities go to SAP: the one set, else "receiving", else the last. */
export function sapScenario(p: Pick<Project, "mb" | "bom">): Scenario | null {
  const list = p.mb.scenarios;
  const want = p.bom.sap?.scenarioId;
  return list.find((s) => s.id === want) ?? list.find((s) => s.id === "receiving" || /receiv/i.test(s.name)) ?? list[list.length - 1] ?? null;
}

/** SAP unit of an app unit. `known` is false when it is not in the map (written in capitals, to check). */
export function sapUnit(setup: SapSetup, unit: string): { unit: string; known: boolean } {
  const k = unit.trim().toLowerCase();
  const own = setup.units?.[k];
  if (own) return { unit: own, known: true };
  const d = DEFAULT_UNITS[k];
  return d ? { unit: d, known: true } : { unit: unit.trim().toUpperCase(), known: false };
}

/** The code rule: N digits (default 7); 0 = any code. */
export const codeDigits = (setup: SapSetup) => (setup.codeDigits == null ? DEFAULT_CODE_DIGITS : setup.codeDigits);
export function codeProblem(setup: SapSetup, code: string): string | null {
  const c = code.trim();
  if (!c) return "no code";
  const n = codeDigits(setup);
  if (n > 0 && !new RegExp(`^\\d{${n}}$`).test(c)) return `not a ${n}-digit number`;
  if (/\s/.test(c)) return "has a space";
  if (c.length > 40) return "longer than 40 characters";
  return null;
}

/** Date as SAP is to read it (the format of the user's SAP profile). */
export function sapDate(iso: string, f: SapDateFormat): string {
  const [y, m, d] = iso.slice(0, 10).split("-");
  if (!y || !m || !d) return iso;
  switch (f) {
    case "YYYYMMDD": return `${y}${m}${d}`;
    case "YYYY-MM-DD": return `${y}-${m}-${d}`;
    case "DD.MM.YYYY": return `${d}.${m}.${y}`;
    case "MM/DD/YYYY": return `${m}/${d}/${y}`;
    default: return `${y}.${m}.${d}`;
  }
}

/** UMREZ / UMREN for "1 base unit = factor alternative units" (SAP: base = alt × UMREZ ÷ UMREN). */
export function conversion(factor: number): { umrez: number; umren: number } {
  if (factor >= 1) return { umrez: 1, umren: clean(factor) };
  return { umrez: clean(1 / factor), umren: 1 };
}

/** The stream whose MB flow is a unit-operation semi-finished product's base quantity. */
export function baseStream(p: Pick<Project, "streams">, sf: Pick<SemiFinished, "uoId" | "stream">): string | null {
  const list = uoStreams(p, sf.uoId);
  if (sf.stream && list.some((s) => s.id === sf.stream)) return sf.stream;
  return list.find((s) => s.dir === "out")?.id ?? null;
}

/** Which semi-finished product of its unit operation each BOM line goes to: material id → semi id. */
function assignment(semis: readonly SemiFinished[], uoId: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const s of semis) if (s.uoId === uoId && s.kind !== "uo") for (const m of s.materials ?? []) if (!out.has(m)) out.set(m, s.id);
  return out;
}

export function sapBoms(p: Pick<Project, "uos" | "materials" | "mb" | "bom" | "streams">, bom: BomResult): SapResult {
  const raw = setupOf(p);
  const setup = { ...raw, usage: raw.usage || "1", alternative: raw.alternative || "1", status: raw.status || "1", dateFormat: raw.dateFormat ?? "YYYY.MM.DD" };
  const scen = sapScenario(p);
  const sid = scen?.id ?? "";
  const matById = new Map(p.materials.map((m) => [m.id, m]));
  const uoById = new Map(p.uos.map((u) => [u.id, u]));
  const issues: SapIssue[] = [];
  const boms: SapBom[] = [];
  const unknownUnits = new Set<string>();

  const unitOf = (appUnit: string) => {
    const u = sapUnit(setup, appUnit);
    if (!u.known && appUnit.trim()) unknownUnits.add(appUnit.trim());
    return u.unit;
  };

  /** An item of material m with a quantity in its own unit (conversion factor applied). */
  const materialItem = (m: Material, qty: number | null, source: string, scrapPct: number | null, fixed = false): Omit<SapItem, "pos"> => {
    const conv = setup.bomUnits?.[m.id];
    const factor = conv && conv.factor > 0 ? conv.factor : undefined;
    const q = qty == null ? null : factor ? clean(qty * factor) : qty;
    return {
      code: m.code, name: m.name, qty: q, sapQty: q == null ? null : round3(q),
      unit: unitOf(factor ? conv!.unit : m.unit), appUnit: m.unit, fixed, scrapPct: scrapPct ? scrapPct : null, source, materialId: m.id,
      ...(factor ? { factor } : {}),
    };
  };

  // ---- semi-finished products set up per unit operation --------------------------------------------------------------------------
  const semis = [...setup.semi].sort((a, b) => (uoById.get(a.uoId)?.order ?? 1e9) - (uoById.get(b.uoId)?.order ?? 1e9) || KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);
  const uoSemi = new Map<string, SemiFinished>();
  for (const s of semis) if (s.kind === "uo" && !uoSemi.has(s.uoId)) uoSemi.set(s.uoId, s);
  const rowsOf = new Map(bom.uos.map((u) => [u.uo.id, u.rows]));

  for (const s of semis) {
    const uo = uoById.get(s.uoId);
    const b: SapBom = { key: s.id, kind: s.kind, code: s.code.trim(), name: s.name.trim(), uo, baseQty: null, baseUnit: "", appBaseUnit: "", baseFrom: "", items: [], semi: s };
    boms.push(b);
    if (!uo) { issues.push({ level: "error", key: s.id, code: b.code, message: "Its unit operation is not in the process any more: remove this semi-finished product." }); continue; }
    if (s.kind === "uo" && uoSemi.get(s.uoId) !== s) issues.push({ level: "error", key: s.id, code: b.code, message: `${uo.code} has another unit-operation semi-finished product (${uoSemi.get(s.uoId)!.code || "no code"}): keep one.` });

    // Base quantity.
    if (s.baseQty != null && s.baseQty > 0) {
      b.baseQty = s.baseQty;
      b.appBaseUnit = s.baseUnit || (s.kind === "uo" ? "L" : "EA");
      b.baseFrom = "typed";
    } else if (s.kind === "uo") {
      const st = baseStream(p, s);
      const flow = st ? streamFlow(p, st, sid) : null;
      if (st && flow && flow.value > 0) {
        b.baseQty = flow.value; b.appBaseUnit = flow.unit; b.baseFrom = `${st} · ${scen?.name ?? ""}`.trim();
      } else {
        b.appBaseUnit = flow?.unit ?? "L";
        b.baseFrom = st ? `${st} · ${scen?.name ?? ""}`.trim() : "";
        issues.push({ level: "error", key: s.id, code: b.code, message: st
          ? `No base quantity: the applied mass balance has no ${scen?.name ?? ""} flow for ${st}. Apply the MB, choose another output stream, or type the quantity.`
          : `No base quantity: ${uo.code} has no transfer out. Choose its output stream or type the quantity (one batch's output).` });
      }
    } else {
      b.baseQty = 1; b.appBaseUnit = s.baseUnit || "EA"; b.baseFrom = "one";
    }
    b.baseUnit = unitOf(b.appBaseUnit);

    // Items: the unit operation's counted lines given to this semi-finished product.
    const given = assignment(semis, s.uoId);
    const rows = (rowsOf.get(s.uoId) ?? []).filter((r) => !r.line.excluded && (s.kind === "uo" ? !given.has(r.material.id) : given.get(r.material.id) === s.id));
    const items: Omit<SapItem, "pos">[] = [];
    // The intermediate from the unit operations before (transfers in), when they have their own semi-finished product.
    if (s.kind === "uo" && setup.chain !== false) {
      for (const st of uoStreams(p, s.uoId).filter((x) => x.dir === "in")) {
        const from = p.streams.active[st.id]?.fromUoId;
        const prev = from ? uoSemi.get(from) : undefined;
        if (!prev) continue;
        const flow = streamFlow(p, st.id, sid);
        items.push({ code: prev.code.trim(), name: prev.name.trim(), qty: flow?.value ?? null, sapQty: flow ? round3(flow.value) : null, unit: unitOf(flow?.unit ?? "L"), appUnit: flow?.unit ?? "L", fixed: false, scrapPct: null, source: st.id, semiId: prev.id });
      }
    }
    for (const r of rows) items.push(rowItem(r));
    b.items = numbered(b, items);
  }

  /** Items numbered 0010, 0020 …; a 0 quantity in the scenario is left out (a note says so). */
  function numbered(b: SapBom, items: Omit<SapItem, "pos">[]): SapItem[] {
    const kept = items.filter((it) => {
      if (it.qty !== 0) return true;
      issues.push({ level: "note", key: b.key, code: b.code, message: `${b.code || b.name}: ${it.code || it.name} is 0 in ${scen?.name ?? "this scenario"}, left out.` });
      return false;
    });
    return kept.map((x, i) => ({ ...x, pos: posText(i + 1) }));
  }

  function rowItem(r: BomRow): Omit<SapItem, "pos"> {
    const v = r.base[sid];
    const source = r.line.qtySource === "manual" ? "Manual" : r.line.qtySource;
    return materialItem(r.material, v ?? null, source, r.overagePct || null);
  }

  // ---- prepared materials: their recipe is their BOM -------------------------------------------------------------------------------
  for (const t of [...bom.prepared].sort((a, b) => a.material.code.localeCompare(b.material.code))) {
    const m = t.material;
    const r = recipeOf(m);
    if (!r) continue;
    const size = batchSize(r);
    const base = size ?? r.per;
    const b: SapBom = {
      key: `prep:${m.id}`, kind: "prep", code: m.code, name: m.name, baseQty: base, appBaseUnit: m.unit, baseUnit: unitOf(m.unit), usedIn: [...t.uos],
      baseFrom: size != null ? `one batch (${fmt(size)} ${m.unit})` : `the recipe's amount (per ${fmt(r.per)} ${m.unit})`, items: [], material: m,
    };
    const items: Omit<SapItem, "pos">[] = [];
    for (const c of r.components) {
      const cm = matById.get(c.materialId);
      if (!cm) continue;
      if (c.basis === "batch") items.push(materialItem(cm, c.qty, "Per batch", cm.overagePct || null, true));
      else items.push(materialItem(cm, clean((c.qty * base) / r.per), "Recipe", cm.overagePct || null));
    }
    b.items = numbered(b, items);
    boms.push(b);
  }

  // ---- checks ----------------------------------------------------------------------------------------------------------------------
  /** Materials whose code is not a SAP number: one check per material, with the BOMs it is in. */
  const bad = new Map<string, { m: Material; in: string[]; keys: string[] }>();
  function badCode(m: Material, b: SapBom) {
    const x = bad.get(m.id) ?? { m, in: [], keys: [] };
    if (b.code && !x.in.includes(b.code)) x.in.push(b.code);
    if (!x.keys.includes(b.key)) x.keys.push(b.key);
    bad.set(m.id, x);
  }
  const prepIds = new Set(bom.prepared.map((t) => t.material.id));
  const headerCodes = new Map<string, SapBom[]>();
  for (const b of boms) if (b.code) headerCodes.set(b.code, [...(headerCodes.get(b.code) ?? []), b]);
  for (const b of boms) {
    const at = { key: b.key, code: b.code };
    const what = b.kind === "prep" ? `${b.code || "(no code)"} (prepared material)` : `The ${SEMI_KIND_LABEL[b.kind].toLowerCase()} semi-finished product${b.uo ? ` of ${b.uo.code}` : ""}`;
    const prob = codeProblem(setup, b.code);
    if (prob && b.material) badCode(b.material, b);
    else if (prob) issues.push({ level: "error", ...at, message: prob === "no code" ? `${what} has no SAP code: enter its material number.` : `${what}: code ${b.code} is ${prob}.` });
    if ((headerCodes.get(b.code)?.length ?? 0) > 1 && b.code) issues.push({ level: "error", ...at, message: `Code ${b.code} is used by ${headerCodes.get(b.code)!.length} semi-finished products: each needs its own.` });
    if (b.kind !== "prep") {
      const clash = p.materials.find((m) => m.code === b.code && !prepIds.has(m.id));
      if (b.code && clash) issues.push({ level: "error", ...at, message: `Code ${b.code} is the code of material ${clash.name}: a semi-finished product needs its own number.` });
      if (!b.name) issues.push({ level: "error", ...at, message: `${what} has no name (the BOM text).` });
    }
    if (b.kind !== "prep" && b.name.length > 40) issues.push({ level: "warning", ...at, message: `The name of ${b.code || what} is ${b.name.length} characters: SAP keeps 40 (material description, BOM text).` });
    if (b.baseQty != null && round3(b.baseQty) !== b.baseQty) issues.push({ level: "warning", ...at, message: `Base quantity ${fmt(b.baseQty)} ${b.appBaseUnit} has more than 3 decimals: SAP keeps ${fmt(round3(b.baseQty))}.` });
    if (!b.items.length && b.kind !== "prep") issues.push({ level: "warning", ...at, message: `${what} has no items.` });

    for (const it of b.items) {
      const ia = { ...at, pos: it.pos };
      const label = `${b.code || what} item ${it.pos} ${it.code || "(no code)"}`;
      const m0 = it.materialId ? matById.get(it.materialId) : undefined;
      if (m0 && codeProblem(setup, it.code)) badCode(m0, b);
      if (it.qty == null) { issues.push({ level: "error", ...ia, message: `${label}: no ${scen?.name ?? ""} quantity${it.semiId ? " (no MB flow for the transfer)" : " (see the line on its unit operation's sheet)"}.` }); continue; }
      if (it.qty < 0) issues.push({ level: "error", ...ia, message: `${label}: the quantity is negative.` });
      const m = it.materialId ? matById.get(it.materialId) : undefined;
      if (m?.status === "obsolete") issues.push({ level: "warning", ...ia, message: `${label}: ${m.code} is obsolete.` });
      if (it.sapQty != null && it.sapQty !== it.qty) {
        const rel = it.qty ? Math.abs(it.sapQty - it.qty) / it.qty : 0;
        const smaller = m ? SMALLER_UNIT[(it.factor ? setup.bomUnits![m.id].unit : m.unit).trim().toLowerCase()] : undefined;
        const fix: SapFix | undefined = m && smaller && !it.factor ? { materialId: m.id, unit: smaller, factor: 1000, label: `Use ${smaller} (1 ${m.unit} = 1,000 ${smaller})` } : undefined;
        const lost = it.sapQty === 0 ? "becomes 0" : `is kept as ${fmt(it.sapQty)} (${rel >= 0.0001 ? `${(rel * 100).toPrecision(2)} %` : "< 0.01 %"} off)`;
        issues.push({ level: it.sapQty === 0 || rel >= 0.001 ? "error" : "warning", ...ia, message: `${label}: ${fmt(it.qty)} ${it.unit} ${lost}: SAP keeps 3 decimals.${fix ? " Use a smaller unit in the BOMs." : it.unit === "EA" ? " Pieces cannot be split: check the quantity." : ""}`, ...(fix ? { fix } : {}) });
      }
      if (it.semiId) {
        const prev = boms.find((x) => x.key === it.semiId);
        if (prev && prev.baseUnit && prev.baseUnit !== it.unit) issues.push({ level: "warning", ...ia, message: `${label}: taken in ${it.unit}, but ${prev.code || "it"} is made in ${prev.baseUnit} (its base unit).` });
      }
    }
  }

  for (const { m, in: where, keys } of bad.values()) {
    const prob = codeProblem(setup, m.code);
    const own = where.includes(m.code);
    const others = where.filter((c) => c !== m.code);
    const usedIn = others.length ? ` · used in ${others.slice(0, 8).join(", ")}${others.length > 8 ? ` and ${others.length - 8} more` : ""}` : "";
    issues.push({ level: "error", group: "codes", code: m.code, keys, short: `${m.code || "(no code)"} ${m.name}${own ? " · prepared in-house, its own BOM" : ""}${usedIn}`, message: `${m.code || "(no code)"} ${m.name}: the code is ${prob}${own ? " (a prepared material, with its own BOM)" : ""}.${others.length ? ` Used in ${others.slice(0, 5).join(", ")}${others.length > 5 ? ` and ${others.length - 5} more` : ""}.` : ""} Give it its SAP number as MatCode on the Materials screen.` });
  }

  // Unit operations with counted lines but no semi-finished product of their own.
  const unassigned: SapResult["unassigned"] = [];
  if (semis.length) {
    for (const u of bom.uos) {
      const n = u.rows.filter((r) => !r.line.excluded).length;
      if (n && !uoSemi.has(u.uo.id)) {
        const given = assignment(semis, u.uo.id);
        const left = u.rows.filter((r) => !r.line.excluded && !given.has(r.material.id)).length;
        if (left) { unassigned.push({ uo: u.uo, rows: left }); issues.push({ level: "warning", message: `${u.uo.code}: ${left} counted line(s) are on no semi-finished product. Add one for ${u.uo.code}.` }); }
      }
    }
  }
  for (const u of unknownUnits) issues.push({ level: "warning", message: `Unit ${u} is written as ${u.toUpperCase()}: check it is a unit of measure in SAP, or map it in the settings.` });
  if (!scen) issues.push({ level: "error", message: "No scenario: the quantities come from a scenario of the mass balance." });
  if (boms.length && !setup.plant?.trim()) issues.push({ level: "error", message: "No plant (WERKS): set it in the SAP settings. Every BOM header needs it." });

  // ---- the material master to check: every code in the BOMs ----------------------------------------------------------------------
  const mats = new Map<string, SapMaterial>();
  const use = (code: string, add: Omit<SapMaterial, "usedIn">, usedIn?: string) => {
    if (!code) return;
    const x = mats.get(code) ?? { ...add, usedIn: [] };
    if (add.type === "HALB") x.type = "HALB";
    if (usedIn && !x.usedIn.includes(usedIn)) x.usedIn.push(usedIn);
    mats.set(code, x);
  };
  for (const b of boms) use(b.code, { code: b.code, name: b.name, type: "HALB", unit: b.baseUnit, appUnit: b.appBaseUnit, ...(b.material?.category ? { category: b.material.category } : {}), note: b.kind === "prep" ? "Prepared in-house (recipe)" : `${SEMI_KIND_LABEL[b.kind]}${b.uo ? ` · ${b.uo.code}` : ""}` });
  for (const b of boms) for (const it of b.items) {
    const m = it.materialId ? matById.get(it.materialId) : undefined;
    if (it.semiId) use(it.code, { code: it.code, name: it.name, type: "HALB", unit: it.unit, appUnit: it.appUnit }, b.code);
    else if (m) use(it.code, { code: it.code, name: m.name, type: prepIds.has(m.id) ? "HALB" : "ROH", unit: unitOf(m.unit), appUnit: m.unit, ...(m.category ? { category: m.category } : {}) }, b.code);
  }
  const materials = [...mats.values()].sort((a, b) => (a.type === b.type ? a.code.localeCompare(b.code) : a.type === "HALB" ? -1 : 1));

  // ---- alternative units (conversion factors) used ---------------------------------------------------------------------------------
  const units: SapUnitRow[] = [];
  for (const [mid, c] of Object.entries(setup.bomUnits ?? {})) {
    const m = matById.get(mid);
    if (!m || !(c.factor > 0) || !boms.some((b) => b.items.some((it) => it.materialId === mid))) continue;
    const base = unitOf(m.unit), alt = unitOf(c.unit);
    units.push({ code: m.code, name: m.name, base, alt, ...conversion(c.factor), text: `1 ${base} = ${fmt(c.factor)} ${alt}` });
  }
  units.sort((a, b) => a.code.localeCompare(b.code));

  const order = { error: 0, warning: 1, note: 2 };
  issues.sort((a, b) => order[a.level] - order[b.level]);
  return {
    setup, scenario: scen, boms, unassigned, materials, units, issues,
    errors: issues.filter((i) => i.level === "error").length,
    warnings: issues.filter((i) => i.level === "warning").length,
  };
}

// ---- edits ---------------------------------------------------------------------------------------------------------------------------

type P = Pick<Project, "bom">;
const withSetup = <T extends P>(p: T, fn: (s: SapSetup) => SapSetup): T => ({ ...p, bom: { ...p.bom, sap: fn(setupOf(p)) } });

export function setSapSettings<T extends P>(p: T, patch: Partial<Omit<SapSetup, "semi">>): T {
  return withSetup(p, (s) => {
    const next: SapSetup = { ...s, ...patch };
    for (const [k, v] of Object.entries(patch)) if (v === undefined || v === "") delete (next as unknown as Record<string, unknown>)[k];
    return next;
  });
}

export function addSemi<T extends P>(p: T, sf: Omit<SemiFinished, "id">, id = newId("sf")): { project: T; id: string } {
  return { project: withSetup(p, (s) => ({ ...s, semi: [...s.semi, { id, ...sf }] })), id };
}

/** A unit-operation semi-finished product for every unit operation that has none (named after it, no code yet). */
export function addForEveryUo<T extends Pick<Project, "bom" | "uos">>(p: T): { project: T; added: number } {
  const have = new Set(setupOf(p).semi.filter((s) => s.kind === "uo").map((s) => s.uoId));
  const add = [...p.uos].sort((a, b) => a.order - b.order).filter((u) => !have.has(u.id));
  if (!add.length) return { project: p, added: 0 };
  return { project: withSetup(p, (s) => ({ ...s, semi: [...s.semi, ...add.map((u): SemiFinished => ({ id: newId("sf"), kind: "uo", uoId: u.id, code: "", name: u.name }))] })), added: add.length };
}

export function setSemi<T extends P>(p: T, id: string, patch: Partial<Omit<SemiFinished, "id">>): T {
  return withSetup(p, (s) => ({
    ...s,
    semi: s.semi.map((x) => {
      if (x.id !== id) return x;
      const next: SemiFinished = { ...x, ...patch };
      for (const [k, v] of Object.entries(patch)) if (v === undefined) delete (next as unknown as Record<string, unknown>)[k];
      return next;
    }),
  }));
}

export function removeSemi<T extends P>(p: T, id: string): T {
  return withSetup(p, (s) => ({ ...s, semi: s.semi.filter((x) => x.id !== id) }));
}

/** Give a BOM line (unit operation, material) to a packing / unpacking semi-finished product, or back to the unit operation's (null). */
export function assignLine<T extends P>(p: T, uoId: string, materialId: string, semiId: string | null): T {
  return withSetup(p, (s) => ({
    ...s,
    semi: s.semi.map((x) => {
      if (x.uoId !== uoId || x.kind === "uo") return x;
      const has = (x.materials ?? []).includes(materialId);
      const want = x.id === semiId;
      if (has === want) return x;
      const materials = want ? [...(x.materials ?? []), materialId] : (x.materials ?? []).filter((m) => m !== materialId);
      const next: SemiFinished = { ...x, materials };
      if (!materials.length) delete next.materials;
      return next;
    }),
  }));
}

/** The unit a material is counted in in the SAP BOMs (a conversion factor), or back to its own unit (null). */
export function setBomUnit<T extends P>(p: T, materialId: string, conv: { unit: string; factor: number } | null): T {
  return withSetup(p, (s) => {
    const bomUnits = { ...(s.bomUnits ?? {}) };
    if (conv) bomUnits[materialId] = conv; else delete bomUnits[materialId];
    const next: SapSetup = { ...s, bomUnits };
    if (!Object.keys(bomUnits).length) delete next.bomUnits;
    return next;
  });
}

/** Material ids after Replace: the new material takes the old one's place in the semi-finished products and conversions. */
export function replaceInSap(s: SapSetup | undefined, fromId: string, toId: string): SapSetup | undefined {
  if (!s) return s;
  const semi = s.semi.map((x) => (x.materials?.includes(fromId) ? { ...x, materials: [...new Set(x.materials.map((m) => (m === fromId ? toId : m)))] } : x));
  const next: SapSetup = { ...s, semi };
  if (s.bomUnits?.[fromId] && !s.bomUnits[toId]) {
    const bomUnits = { ...s.bomUnits, [toId]: s.bomUnits[fromId] };
    delete bomUnits[fromId];
    next.bomUnits = bomUnits;
  }
  return next;
}

/** What changed in the SAP set-up, for the change log. */
export function describeSap(a: SapSetup | undefined, b: SapSetup | undefined, uoCode: (id: string) => string): string[] {
  if (a === b) return [];
  const A = a?.semi ?? [], B = b?.semi ?? [];
  const label = (x: SemiFinished) => `${x.code || "(no code)"} ${SEMI_KIND_LABEL[x.kind].toLowerCase()} ${uoCode(x.uoId)}`;
  const out: string[] = [];
  const added = B.filter((x) => !A.some((y) => y.id === x.id)), removed = A.filter((x) => !B.some((y) => y.id === x.id));
  if (added.length) out.push(`Semi-finished added: ${added.slice(0, 6).map(label).join(", ")}${added.length > 6 ? ` and ${added.length - 6} more` : ""}`);
  if (removed.length) out.push(`Semi-finished removed: ${removed.slice(0, 6).map(label).join(", ")}${removed.length > 6 ? ` and ${removed.length - 6} more` : ""}`);
  const changed = B.filter((x) => { const y = A.find((z) => z.id === x.id); return y && JSON.stringify(y) !== JSON.stringify(x); });
  for (const x of changed.slice(0, 6)) {
    const y = A.find((z) => z.id === x.id)!;
    const what: string[] = [];
    if (y.code !== x.code) what.push(`code ${y.code || "—"} → ${x.code || "—"}`);
    if (y.name !== x.name) what.push(`name “${y.name}” → “${x.name}”`);
    if (y.stream !== x.stream || y.baseQty !== x.baseQty || y.baseUnit !== x.baseUnit) what.push("base quantity");
    if (JSON.stringify(y.materials ?? []) !== JSON.stringify(x.materials ?? [])) what.push(`lines ${(y.materials ?? []).length} → ${(x.materials ?? []).length}`);
    out.push(`Semi-finished ${x.code || y.code || "(no code)"}: ${what.join("; ") || "changed"}`);
  }
  if (changed.length > 6) out.push(`Semi-finished changed, more: ${changed.length - 6}`);
  const rest = (s?: SapSetup) => JSON.stringify({ ...(s ?? {}), semi: undefined, bomUnits: undefined });
  if (rest(a) !== rest(b)) out.push("SAP BOM settings changed");
  if (JSON.stringify(a?.bomUnits ?? {}) !== JSON.stringify(b?.bomUnits ?? {})) out.push("SAP BOM units (conversion factors) changed");
  return out;
}

/** The checks of one BOM (its own, and component codes it uses). */
export const checksOf = (res: Pick<SapResult, "issues">, key: string) => res.issues.filter((i) => i.level !== "note" && (i.key === key || i.keys?.includes(key)));
