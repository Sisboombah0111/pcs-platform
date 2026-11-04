/**
 * Read and check the PCS_LINK sheet of an engineer's MB workbook. The app reads no other sheet.
 *
 *   StreamID | MatCode | Unit | Sending | Receiving | Note        (row 1 = headers, any column order)
 *
 * A row without MatCode is the stream's flow row (its value goes on the PFD label); a row with a
 * MatCode is a material row (its value goes to that UO's BOM). Rules:
 *   V1 sheet, required headers and cells        V2 StreamID is a stream on the PFD
 *   V3 a PFD stream has no flow row (warning)   V4 one flow row per StreamID
 *   V5 numbers: numeric, ≥ 0, formula result saved in the file
 *   V6 MatCode is in the material list          V7 material row unit = the material's unit
 *   V8 the same UO and material is not also counted from PFD links (no double counting)
 *
 * Ported from Phase 0 pcs_link.js (SheetJS) to the app's ExcelJS reader; same rules and cases.
 */
import { parseStreamId } from "../model/ids";
import type { MbRow, MbSnapshot, Scenario } from "../model/types";
import type { CellInfo, WorkbookData } from "../xlsx/workbook";

export const LINK_SHEET = "PCS_LINK";
export const LINK_HEADERS = ["StreamID", "MatCode", "Unit", "Sending", "Receiving", "Note"];

export type Rule = "V1" | "V2" | "V3" | "V4" | "V5" | "V6" | "V7" | "V8" | "ID";

export interface LinkIssue {
  level: "error" | "warning";
  rule: Rule;
  /** Excel row number (1-based), or null for the whole sheet. */
  row: number | null;
  /** Column letter, or null. */
  col: string | null;
  message: string;
  streamId?: string;
}

export interface LinkRow {
  row: number;
  kind: "flow" | "material";
  streamId: string;
  matCode: string | null;
  unit: string;
  /** scenario id → value (null: empty or unreadable) */
  values: Record<string, number | null>;
  note: string;
  formulas: Record<string, string | null>;
  ok: boolean;
}

export interface LinkResult {
  ok: boolean;
  sheetNames: string[];
  /** Scenario ids whose column is in the sheet. */
  scenarios: string[];
  columns: Record<string, string>;
  rows: LinkRow[];
  issues: LinkIssue[];
  summary: { errors: number; warnings: number; rows: number; flowRows: number; materialRows: number; streams: number };
}

export interface LinkContext {
  /** Scenario columns; the first one is required. */
  scenarios: Scenario[];
  /** Stream IDs on the PFD (V2, V3). Without it, V2 is skipped and V3 checks the IDs in the sheet. */
  streamIds?: readonly string[];
  /** Material list (V6, V7). */
  materials?: readonly { code: string; unit: string; name: string }[];
  /** UO code a stream's materials count toward (V8): its own UO, or a transfer's destination. */
  uoOfStream?: (streamId: string) => string | null;
  /** UO code → material code → count linked on PFD shapes (V8). */
  pfdLinks?: ReadonlyMap<string, ReadonlyMap<string, number>>;
}

const norm = (s: string) => s.trim().toLowerCase().replace(/[\s_-]/g, "");

export function colLetter(index0: number): string {
  let n = index0 + 1;
  let s = "";
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

function textOf(c: CellInfo): string {
  if (c.kind === "text") return String(c.value).trim();
  if (c.kind === "number" || c.kind === "bool") return String(c.value);
  return "";
}

export function checkLinkSheet(wb: WorkbookData, ctx: LinkContext): LinkResult {
  const issues: LinkIssue[] = [];
  const add = (level: LinkIssue["level"], rule: Rule, row: number | null, col: string | null, message: string, streamId?: string) =>
    issues.push({ level, rule, row, col, message, ...(streamId ? { streamId } : {}) });
  const out: LinkResult = {
    ok: false, sheetNames: wb.sheetNames, scenarios: [], columns: {}, rows: [], issues,
    summary: { errors: 0, warnings: 0, rows: 0, flowRows: 0, materialRows: 0, streams: 0 },
  };
  const grid = wb.sheet(LINK_SHEET);
  if (!grid) {
    const near = wb.sheetNames.find((n) => norm(n) === norm(LINK_SHEET));
    add("error", "V1", null, null, `The workbook has no '${LINK_SHEET}' sheet.` +
      (near ? ` A sheet is named '${near}': rename it to exactly '${LINK_SHEET}'.` : ` Sheets: ${wb.sheetNames.join(", ") || "none"}.`));
    return finish(out);
  }

  // Headers in row 1, any order.
  const keys = ["streamId", "matCode", "unit", ...ctx.scenarios.map((s) => `s:${s.id}`), "note"] as const;
  const headerOf: Record<string, string> = { streamId: "StreamID", matCode: "MatCode", unit: "Unit", note: "Note" };
  for (const s of ctx.scenarios) headerOf[`s:${s.id}`] = s.column;
  const required = new Set(["streamId", "unit", `s:${ctx.scenarios[0]?.id}`]);
  const colIndex: Record<string, number> = {};
  const seen: string[] = [];
  for (let c = 0; c < grid.colCount; c++) {
    const h = textOf(grid.cell(0, c));
    if (!h) continue;
    seen.push(h);
    for (const k of keys) {
      if (norm(h) !== norm(headerOf[k])) continue;
      if (colIndex[k] !== undefined) add("error", "V1", 1, colLetter(c), `The '${headerOf[k]}' header appears twice.`);
      else colIndex[k] = c;
    }
  }
  const missing = [...required].filter((k) => colIndex[k] === undefined).map((k) => headerOf[k]);
  if (missing.length) {
    add("error", "V1", 1, null, `Row 1 is missing required headers: ${missing.join(", ")}. Headers found: ${seen.join(", ") || "none"}.`);
    return finish(out);
  }
  for (const [k, c] of Object.entries(colIndex)) out.columns[k.replace(/^s:/, "")] = colLetter(c);
  const scen = ctx.scenarios.filter((s) => colIndex[`s:${s.id}`] !== undefined);
  out.scenarios = scen.map((s) => s.id);
  for (const s of ctx.scenarios.filter((x) => colIndex[`s:${x.id}`] === undefined)) {
    add("warning", "V1", 1, null, `No '${s.column}' column for the scenario ${s.name}: it gets no values from this workbook. Add the column, or change the scenario's column (Mass Balance › Scenarios).`);
  }

  const flowRowOf = new Map<string, number>();
  const idsInSheet = new Set<string>();
  const known = ctx.streamIds ? new Set(ctx.streamIds) : null;
  const materials = ctx.materials ? new Map(ctx.materials.map((m) => [m.code, m])) : null;

  for (let r = 1; r < grid.rowCount; r++) {
    const excelRow = r + 1;
    const cell = (k: string): CellInfo => (colIndex[k] === undefined ? { kind: "empty", value: null } : grid.cell(r, colIndex[k]));
    const dataKeys = ["streamId", "matCode", "unit", ...scen.map((s) => `s:${s.id}`)];
    if (dataKeys.every((k) => cell(k).kind === "empty")) continue; // blank or note-only row

    const col = (k: string) => (colIndex[k] === undefined ? null : colLetter(colIndex[k]));
    const streamId = textOf(cell("streamId"));
    const matCode = textOf(cell("matCode"));
    const unit = textOf(cell("unit"));
    const kind: LinkRow["kind"] = matCode ? "material" : "flow";
    let ok = true;

    if (!streamId) { add("error", "V1", excelRow, col("streamId"), "StreamID is empty."); ok = false; }
    else {
      idsInSheet.add(streamId);
      if (known && !known.has(streamId)) { add("error", "V2", excelRow, col("streamId"), `${streamId} is not a stream on the PFD.`, streamId); ok = false; }
      else if (!known && !parseStreamId(streamId)) add("warning", "ID", excelRow, col("streamId"), `'${streamId}' does not look like a Stream ID (ST-<UO>-<nnn> or ST-<from>-<to>).`, streamId);
    }
    if (!unit) { add("error", "V1", excelRow, col("unit"), "Unit is empty.", streamId || undefined); ok = false; }

    const values: Record<string, number | null> = {};
    const formulas: Record<string, string | null> = {};
    scen.forEach((s, i) => {
      const k = `s:${s.id}`;
      const info = cell(k);
      formulas[s.id] = info.formula ?? null;
      values[s.id] = null;
      const where = col(k);
      const label = s.column;
      switch (info.kind) {
        case "number": {
          const v = info.value as number;
          if (!Number.isFinite(v)) { add("error", "V5", excelRow, where, `${label} is not a finite number.`, streamId); ok = false; }
          else if (v < 0) { add("error", "V5", excelRow, where, `${label} is negative (${v}).`, streamId); ok = false; }
          else values[s.id] = v;
          break;
        }
        case "empty":
          if (i === 0) { add("error", "V1", excelRow, where, `${label} is empty.`, streamId); ok = false; }
          break;
        case "nocache":
          add("error", "V5", excelRow, where, `${label} formula (${info.formula}) has no saved result in the file. Open the workbook in Excel or GridCraft, save it, and upload it again.`, streamId);
          ok = false;
          break;
        case "error":
          add("error", "V5", excelRow, where, `${label} formula result is an error (${info.errorText ?? "#ERROR"}${info.formula ? `, ${info.formula}` : ""}).`, streamId);
          ok = false;
          break;
        case "text": {
          const t = String(info.value);
          const numeric = t.trim() !== "" && Number.isFinite(Number(t.replace(/,/g, "")));
          add("error", "V5", excelRow, where, numeric ? `${label} '${t}' is a number stored as text. Format the cell as a number.` : `${label} '${t}' is not a number.`, streamId);
          ok = false;
          break;
        }
        default:
          add("error", "V5", excelRow, where, `${label} is not a number.`, streamId);
          ok = false;
      }
    });

    if (kind === "flow" && streamId) {
      const first = flowRowOf.get(streamId);
      if (first) { add("error", "V4", excelRow, col("streamId"), `${streamId} already has a flow row (MatCode empty) in row ${first}. Each stream has one flow row.`, streamId); ok = false; }
      else flowRowOf.set(streamId, excelRow);
    }
    if (kind === "material" && materials) {
      const m = materials.get(matCode);
      if (!m) { add("error", "V6", excelRow, col("matCode"), `MatCode ${matCode} is not in the material list.`, streamId); ok = false; }
      else if (unit && m.unit !== unit) { add("error", "V7", excelRow, col("unit"), `${matCode} (${m.name}) is counted in ${m.unit} in the material list, not '${unit}'.`, streamId); ok = false; }
    }

    out.rows.push({ row: excelRow, kind, streamId, matCode: matCode || null, unit, values, note: textOf(cell("note")), formulas, ok });
  }

  // V8: a material counted from the MB for a UO must not also be counted from PFD links there.
  if (ctx.pfdLinks && ctx.uoOfStream) {
    for (const r of out.rows) {
      if (r.kind !== "material" || !r.matCode || !r.streamId) continue;
      const uo = ctx.uoOfStream(r.streamId);
      const qty = uo ? ctx.pfdLinks.get(uo)?.get(r.matCode) : undefined;
      if (uo && qty !== undefined) {
        add("error", "V8", r.row, out.columns.matCode ?? null, `${r.matCode} in ${uo} would be counted twice: ${qty} linked on the PFD and this row. Keep it in one place.`, r.streamId);
        r.ok = false;
      }
    }
  }

  const expected = ctx.streamIds ?? [...idsInSheet];
  for (const id of expected) {
    if (!flowRowOf.has(id)) add("warning", "V3", null, null, `${id} has no flow row (MatCode empty), so its PFD label shows no value.`, id);
  }
  return finish(out);
}

function finish(out: LinkResult): LinkResult {
  const errors = out.issues.filter((i) => i.level === "error").length;
  out.ok = errors === 0;
  out.summary = {
    errors,
    warnings: out.issues.length - errors,
    rows: out.rows.length,
    flowRows: out.rows.filter((r) => r.kind === "flow").length,
    materialRows: out.rows.filter((r) => r.kind === "material").length,
    streams: new Set(out.rows.map((r) => r.streamId).filter(Boolean)).size,
  };
  return out;
}

export function snapshotRows(result: LinkResult): MbRow[] {
  return result.rows.map((r) => {
    const row: MbRow = { streamId: r.streamId, matCode: r.matCode, unit: r.unit, values: { ...r.values }, sourceRow: r.row };
    if (r.note) row.note = r.note;
    return row;
  });
}

export type SnapshotMeta = Omit<MbSnapshot, "rows" | "scenarios">;

export function toSnapshot(result: LinkResult, meta: SnapshotMeta): MbSnapshot {
  return { ...meta, scenarios: result.scenarios, rows: snapshotRows(result) };
}
