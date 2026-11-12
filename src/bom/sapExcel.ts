/**
 * The SAP BOM workbook (N5.7): header and item sheets with SAP field names (MATNR, POSNR, IDNRK …), ready to
 * copy into the upload template or CS01, plus the material master and alternative units to check first, the
 * checks and a page on how it was made. Codes and item numbers are text (0010 stays 0010); quantities have
 * 3 decimals, as SAP keeps them. Columns marked (info) are for reading only: leave them out of an upload.
 */
import ExcelJS from "exceljs";
import { SEMI_KIND_LABEL, checksOf, codeDigits, sapDate, type SapResult } from "./sap";

export interface SapCol { header: string; note: string; width: number; fmt?: "text" | "qty" | "pct"; info?: boolean }
export interface SapSheet { name: string; cols: SapCol[]; rows: (string | number | null)[][]; widthsOnly?: boolean }

const T = (header: string, note: string, width = 12): SapCol => ({ header, note, width, fmt: "text" });
const Q = (header: string, note: string, width = 13): SapCol => ({ header, note, width, fmt: "qty" });
const I = (header: string, note: string, width = 16, fmt?: SapCol["fmt"]): SapCol => ({ header: `(info) ${header}`, note, width, info: true, ...(fmt ? { fmt } : {}) });
const GAP: SapCol = { header: "", note: "", width: 3 };

export interface SapContext { project: string; mbFile?: string; today: string }

export function sapSheets(res: SapResult, ctx: SapContext): SapSheet[] {
  const s = res.setup;
  const plant = s.plant ?? "";
  const datuv = sapDate(s.validFrom ?? ctx.today, s.dateFormat);
  const bomChecks = (key: string) => checksOf(res, key).length;

  const header: SapSheet = {
    name: "BOM header",
    cols: [
      T("MATNR", "Material: the semi-finished product's SAP number.", 12),
      T("WERKS", "Plant.", 8),
      T("STLAN", "BOM usage (1 = production).", 8),
      T("STLAL", "Alternative BOM.", 8),
      T("DATUV", `Valid from (${s.dateFormat}).`, 12),
      Q("BMENG", "Base quantity: the quantities of the items are for this much of the semi-finished product (one batch's output)."),
      T("BMEIN", "Base unit of measure of the base quantity.", 8),
      T("STLST", "BOM status (1 = active).", 8),
      T("STKTX", "BOM text (alternative text), up to 40 characters.", 36),
      GAP,
      I("Kind", "Unit operation, column packing, unpacking, or prepared in-house (recipe)."),
      I("Unit operation", "Where it is made (a prepared material: where it is used).", 12),
      I("Base quantity from", "The stream and scenario of the mass balance, the recipe's batch, or a number typed.", 28),
      I("Items", "Number of items in BOM items.", 8),
      I("Checks", "Errors and warnings for this BOM (Checks sheet).", 8),
    ],
    rows: res.boms.map((b) => [
      b.code, plant, s.usage, s.alternative, datuv, b.baseQty, b.baseUnit, s.status, b.name.slice(0, 40), null,
      b.kind === "prep" ? "Prepared (recipe)" : SEMI_KIND_LABEL[b.kind], b.uo?.code ?? b.usedIn?.join(", ") ?? "", b.baseFrom, b.items.length, bomChecks(b.key) || null,
    ]),
  };

  const items: SapSheet = {
    name: "BOM items",
    cols: [
      T("MATNR", "Material of the BOM header (the semi-finished product).", 12),
      T("WERKS", "Plant.", 8),
      T("STLAN", "BOM usage.", 8),
      T("STLAL", "Alternative BOM.", 8),
      T("POSNR", "Item number.", 8),
      T("POSTP", "Item category (L = stock item).", 8),
      T("IDNRK", "Component: its SAP material number (MatCode).", 12),
      Q("MENGE", "Component quantity for the base quantity of the header, before overage (3 decimals)."),
      T("MEINS", "Component unit of measure (its base unit, or an alternative unit on the Units sheet).", 8),
      T("FMENG", "Fixed quantity (X): the same for any order quantity (a bag or a filter per preparation).", 8),
      { header: "AUSCH", note: "Component scrap in %: the overage, added on top by SAP.", width: 8, fmt: "pct" },
      T("VORNR", "Operation: assign it in the routing (component allocation). Left empty here.", 8),
      GAP,
      I("Component", "Name of the component.", 34),
      I("Source", "MB, PFD or Manual (the line on the BOM screen), Recipe or Per batch (the recipe), or the transfer stream (the semi-finished product before).", 14),
      I("Exact quantity", "The quantity before SAP's 3-decimal rounding.", 14, "qty"),
      I("Unit in PCS", "The unit in this app.", 9),
    ],
    rows: res.boms.flatMap((b) => b.items.map((it) => [
      b.code, plant, s.usage, s.alternative, it.pos, "L", it.code, it.sapQty, it.unit, it.fixed ? "X" : null, it.scrapPct, null, null,
      it.name, it.source, it.qty, it.factor ? `${it.appUnit} (× ${it.factor} = ${it.unit})` : it.appUnit,
    ])),
  };

  const materials: SapSheet = {
    name: "Materials",
    cols: [
      T("MATNR", "Material number: every header and component above must exist in the plant before the BOMs are created.", 12),
      T("MAKTX", "Material description (40 characters).", 40),
      T("MTART", "Material type: HALB semi-finished (made here: unit operations, packing, buffers and media), ROH raw material.", 8),
      T("MEINS", "Base unit of measure.", 8),
      GAP,
      I("Used in", "The BOMs it is a component of.", 30),
      I("Category", "Category in this app.", 12),
      I("Note", "What it is.", 30),
    ],
    rows: res.materials.map((m) => [m.code, m.name.slice(0, 40), m.type, m.unit, null, m.usedIn.join(", "), m.category ?? "", m.note ?? ""]),
  };

  const units: SapSheet = {
    name: "Units",
    cols: [
      T("MATNR", "Material.", 12),
      T("MEINS", "Base unit of measure.", 8),
      T("MEINH", "Alternative unit of measure used in the BOMs.", 8),
      { header: "UMREZ", note: "Numerator for conversion to the base unit.", width: 8 },
      { header: "UMREN", note: "Denominator for conversion to the base unit (base = alternative × UMREZ ÷ UMREN).", width: 8 },
      GAP,
      I("Meaning", "The conversion in words.", 20),
      I("Material", "Name.", 34),
    ],
    rows: res.units.map((u) => [u.code, u.base, u.alt, u.umrez, u.umren, null, u.text, u.name]),
  };

  const checks: SapSheet = {
    name: "Checks",
    cols: [
      { header: "Level", note: "error: SAP would refuse it or take a wrong number. warning: look at it. note: for information.", width: 9 },
      T("Code", "The BOM (MATNR) or material it concerns.", 12),
      T("POSNR", "The item of that BOM.", 8),
      { header: "Message", note: "What to do.", width: 110 },
    ],
    rows: res.issues.map((i) => [i.level, i.code ?? "", i.pos ?? "", i.message]),
  };

  const n = codeDigits(s);
  const about: SapSheet = {
    name: "About",
    cols: [{ header: "", note: "", width: 24 }, { header: "", note: "", width: 110 }],
    widthsOnly: true,
    rows: [
      ["SAP BOMs of semi-finished products", null],
      ["Project", ctx.project],
      ["Exported", ctx.today],
      ["Quantities", `${res.scenario?.name ?? "—"} scenario, per batch, before overage (the overage is the component scrap, AUSCH).`],
      ["Mass balance", ctx.mbFile ?? "—"],
      ["Plant / usage / alternative / status", `${s.plant || "(not set)"} / ${s.usage} / ${s.alternative} / ${s.status}`],
      ["Valid from", `${sapDate(s.validFrom ?? ctx.today, s.dateFormat)} (format ${s.dateFormat}: set it to the date format of your SAP user profile).`],
      ["Codes", n > 0 ? `${n}-digit numbers (MatCode = SAP material number).` : "Any code (MatCode = SAP material number)."],
      ["Result", `${res.boms.length} BOMs, ${res.boms.reduce((k, b) => k + b.items.length, 0)} items · ${res.errors} errors, ${res.warnings} warnings (Checks sheet).`],
      [null, null],
      ["How it is built", null],
      ["Unit operation", "Its counted BOM lines (not those given to its packing or unpacking), and the semi-finished product of the unit operation before it, as much as the transfer stream carries. Base quantity: one batch's output, the MB flow of its output stream."],
      ["Column packing / unpacking", "The BOM lines of its unit operation given to it. Base quantity 1 EA unless typed."],
      ["Prepared in-house", "A buffer or medium with a recipe: its recipe, for one batch (or for the recipe's amount when it has no batch size). Components per batch are fixed quantities (FMENG = X)."],
      ["Quantities", "SAP keeps 3 decimals. MENGE is rounded to 3 decimals; the exact number is in (info) Exact quantity. A component that would lose more than 0.1 % is an error: count it in a smaller unit (kg → g) and register that unit with the material (Units sheet)."],
      ["Not included", "Backup materials, lines set to Not counted, and items that are 0 in this scenario. Operations (VORNR) are assigned in the routing."],
      ["Order", "Create the materials first (Materials sheet: HALB and ROH, with the alternative units of the Units sheet), then the BOMs. The (info) columns are for reading: leave them out of an upload."],
    ],
  };
  return [header, items, materials, units, checks, about];
}

export async function sapWorkbook(res: SapResult, ctx: SapContext): Promise<Blob> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "PCS Platform";
  wb.created = new Date();
  for (const sh of sapSheets(res, ctx)) {
    const ws = wb.addWorksheet(sh.name, sh.widthsOnly ? {} : { views: [{ state: "frozen", ySplit: 1 }] });
    sh.cols.forEach((c, i) => {
      const col = ws.getColumn(i + 1);
      col.width = c.width;
      if (c.fmt === "text") col.numFmt = "@";
      if (c.fmt === "qty") col.numFmt = "0.000";
      if (c.fmt === "pct") col.numFmt = "0.##";
    });
    if (!sh.widthsOnly) {
      const head = ws.getRow(1);
      sh.cols.forEach((c, i) => {
        const cell = head.getCell(i + 1);
        cell.value = c.header || null;
        if (!c.header) return;
        cell.font = c.info ? { bold: true, italic: true, color: { argb: "FF6B7280" } } : { bold: true };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: c.info ? "FFF3F4F6" : "FFDBEAFE" } };
        if (c.note) cell.note = c.note;
      });
    }
    sh.rows.forEach((r, ri) => {
      const row = ws.getRow(ri + (sh.widthsOnly ? 1 : 2));
      r.forEach((v, ci) => {
        if (v === null || v === undefined || v === "") return;
        const c = sh.cols[ci];
        row.getCell(ci + 1).value = c?.fmt === "text" ? String(v) : v;
        if (c?.info) row.getCell(ci + 1).font = { color: { argb: "FF6B7280" } };
      });
      if (sh.widthsOnly && r[1] === null && r[0]) row.getCell(1).font = { bold: true, size: ri === 0 ? 13 : 11 };
      if (sh.name === "Checks") {
        const lvl = r[0];
        const color = lvl === "error" ? "FFFEE2E2" : lvl === "warning" ? "FFFEF3C7" : undefined;
        if (color) row.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: color } };
      }
    });
    if (sh.widthsOnly) ws.getColumn(2).alignment = { wrapText: true, vertical: "top" };
  }
  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}
