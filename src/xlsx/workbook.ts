/**
 * XLSX read/write through ExcelJS (MIT). One place that knows ExcelJS's cell value shapes, so the
 * rest of the app works with plain values.
 */
import ExcelJS from "exceljs";
import JSZip from "jszip";

export type CellValue = string | number | boolean | null;

export interface CellInfo {
  /** empty | number | text | bool | error | nocache (formula without a saved result) */
  kind: "empty" | "number" | "text" | "bool" | "error" | "nocache";
  value: CellValue;
  formula?: string;
  errorText?: string;
}

function richTextToString(v: { richText: { text: string }[] }): string {
  return v.richText.map((r) => r.text).join("");
}

/** Normalize one ExcelJS cell value. */
export function cellInfo(raw: unknown): CellInfo {
  if (raw === null || raw === undefined || raw === "") return { kind: "empty", value: null };
  if (typeof raw === "number") return { kind: "number", value: raw };
  if (typeof raw === "string") return raw.trim() === "" ? { kind: "empty", value: null } : { kind: "text", value: raw };
  if (typeof raw === "boolean") return { kind: "bool", value: raw };
  if (raw instanceof Date) return { kind: "text", value: raw.toISOString().slice(0, 10) };
  if (typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    if ("formula" in o || "sharedFormula" in o) {
      const formula = "=" + String(o.formula ?? o.sharedFormula ?? "");
      const res = o.result;
      if (res === undefined || res === null) return { kind: "nocache", value: null, formula };
      const inner = cellInfo(res);
      return { ...inner, formula };
    }
    if ("error" in o) return { kind: "error", value: null, errorText: String(o.error) };
    if (Array.isArray(o.richText)) {
      const s = richTextToString(o as { richText: { text: string }[] });
      return s.trim() === "" ? { kind: "empty", value: null } : { kind: "text", value: s };
    }
    if ("text" in o) return cellInfo(o.text);
  }
  return { kind: "text", value: String(raw) };
}

export interface SheetGrid {
  name: string;
  rowCount: number;
  colCount: number;
  /**
   * 0-based [row][col]. Every cell of a merged block reads as the block's value (its top-left cell),
   * as ExcelJS gives it: a StreamID merged down over three rows is that StreamID on each row.
   */
  cell(r: number, c: number): CellInfo;
  /** The merged blocks (N5.6.1), to tell a merged cell from one typed three times. */
  merges?: CellRange[];
}

/** A block of cells, 0-based, inclusive. */
export interface CellRange { top: number; left: number; bottom: number; right: number }

/** "D3" → 0-based row and column; null when it is not a cell address. */
export function parseAddress(a: string): { row: number; col: number } | null {
  const m = /^\$?([A-Z]{1,3})\$?(\d+)$/.exec(a.trim().toUpperCase());
  if (!m) return null;
  let col = 0;
  for (const ch of m[1]) col = col * 26 + (ch.charCodeAt(0) - 64);
  const row = Number(m[2]);
  return row >= 1 ? { row: row - 1, col: col - 1 } : null;
}
/** 0-based row and column → "D3". */
export function addressOf(row: number, col: number): string {
  let n = col + 1, s = "";
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return `${s}${row + 1}`;
}
export const rangeText = (m: CellRange) => `${addressOf(m.top, m.left)}:${addressOf(m.bottom, m.right)}`;
function parseRange(t: string): CellRange | null {
  const [a, b] = t.split(":");
  const p = parseAddress(a ?? ""), q = parseAddress(b ?? a ?? "");
  if (!p || !q) return null;
  return { top: Math.min(p.row, q.row), left: Math.min(p.col, q.col), bottom: Math.max(p.row, q.row), right: Math.max(p.col, q.col) };
}

export interface WorkbookData {
  sheetNames: string[];
  sheet(name: string): SheetGrid | null;
  creator?: string;
  lastModifiedBy?: string;
  modified?: string;
}

/**
 * ExcelJS leaves a formula result of exactly 0 (or false, or "") out of `cell.value` (it copies only truthy
 * fields), so a formula that calculates to 0 looked as if it had no saved result. `cell.result` keeps it.
 */
function withResult(value: unknown, result: unknown, formula?: string): unknown {
  if (!value || typeof value !== "object") return value;
  let o = value as Record<string, unknown>;
  // A cell sharing another cell's formula names that cell ("D2"); ExcelJS's `formula` gives its own (Calc!B3).
  if ("sharedFormula" in o && !("formula" in o) && formula) o = { ...o, formula };
  if (!("formula" in o || "sharedFormula" in o) || o.result !== undefined || result === undefined || result === null) return o;
  return { ...o, result };
}

export async function readWorkbook(bytes: ArrayBuffer | Uint8Array): Promise<WorkbookData> {
  const wb = new ExcelJS.Workbook();
  const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const grids = new Map<string, SheetGrid>();
  for (const ws of wb.worksheets) {
    const rows: CellInfo[][] = [];
    let colCount = 0;
    ws.eachRow({ includeEmpty: true }, (row, r) => {
      const cells: CellInfo[] = [];
      row.eachCell({ includeEmpty: true }, (cell, c) => {
        const x = cell as unknown as { result?: unknown; formula?: string };
        cells[c - 1] = cellInfo(withResult(cell.value, x.result, x.formula));
      });
      rows[r - 1] = cells;
      colCount = Math.max(colCount, cells.length);
    });
    const empty: CellInfo = { kind: "empty", value: null };
    const merges = ((ws.model as { merges?: string[] }).merges ?? []).map(parseRange).filter((m): m is CellRange => m !== null);
    grids.set(ws.name, {
      name: ws.name,
      rowCount: rows.length,
      colCount,
      cell: (r, c) => rows[r]?.[c] ?? empty,
      merges,
    });
  }
  return {
    sheetNames: wb.worksheets.map((w) => w.name),
    sheet: (name) => grids.get(name) ?? null,
    creator: wb.creator || undefined,
    lastModifiedBy: wb.lastModifiedBy || undefined,
    modified: wb.modified ? new Date(wb.modified).toISOString() : undefined,
  };
}

/** First sheet (or `sheetName`) as a table of display values, for imports. */
export async function readTable(bytes: ArrayBuffer | Uint8Array, sheetName?: string): Promise<string[][]> {
  const wb = await readWorkbook(bytes);
  return tableOf(wb, sheetName ?? wb.sheetNames[0] ?? "");
}

/** Every sheet as a table of display values, in workbook order. */
export async function readTables(bytes: ArrayBuffer | Uint8Array): Promise<{ name: string; table: string[][] }[]> {
  const wb = await readWorkbook(bytes);
  return wb.sheetNames.map((name) => ({ name, table: tableOf(wb, name) }));
}

function tableOf(wb: WorkbookData, name: string): string[][] {
  const grid = wb.sheet(name);
  if (!grid) return [];
  const out: string[][] = [];
  for (let r = 0; r < grid.rowCount; r++) {
    const row: string[] = [];
    for (let c = 0; c < grid.colCount; c++) {
      const v = grid.cell(r, c).value;
      row.push(v === null ? "" : String(v));
    }
    out.push(row);
  }
  return out;
}

export interface SheetSpec {
  name: string;
  header: string[];
  rows: (CellValue | undefined)[][];
  widths?: number[];
  /** Number format per column index, e.g. { 3: "0.000" }. */
  numFmt?: Record<number, string>;
  /** Look of single cells, by row index (in `rows`) and column index: fill colour (RRGGBB), bold, grey text. */
  cellStyles?: (r: number, c: number) => { fill?: string; bold?: boolean; muted?: boolean } | undefined;
}

/** Build an .xlsx from simple tables (bold header, frozen first row, column widths). */
export async function writeWorkbook(sheets: SheetSpec[], creator = "PCS Platform"): Promise<Blob> {
  const wb = new ExcelJS.Workbook();
  wb.creator = creator;
  wb.created = new Date();
  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name, { views: [{ state: "frozen", ySplit: 1 }] });
    ws.addRow(s.header);
    ws.getRow(1).font = { bold: true };
    for (const r of s.rows) ws.addRow(r.map((v) => (v === undefined ? null : v)));
    if (s.cellStyles) {
      s.rows.forEach((r, ri) => r.forEach((_, ci) => {
        const st = s.cellStyles!(ri, ci);
        if (!st) return;
        const cell = ws.getCell(ri + 2, ci + 1);
        if (st.fill) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${st.fill}` } };
        if (st.bold || st.muted) cell.font = { ...(st.bold ? { bold: true } : {}), ...(st.muted ? { color: { argb: "FF6B7280" } } : {}) };
      }));
    }
    s.header.forEach((_, i) => {
      const col = ws.getColumn(i + 1);
      col.width = s.widths?.[i] ?? Math.max(10, s.header[i].length + 4);
      const fmt = s.numFmt?.[i];
      if (fmt) col.numFmt = fmt;
    });
  }
  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

/** The application that last saved an .xlsx (docProps/app.xml), e.g. "Microsoft Excel" or "GridCraft". */
export async function readSavedBy(bytes: Uint8Array): Promise<string | undefined> {
  try {
    const zip = await JSZip.loadAsync(bytes);
    const xml = await zip.file("docProps/app.xml")?.async("string");
    const m = xml ? /<(?:\w+:)?Application>([^<]*)<\/(?:\w+:)?Application>/.exec(xml) : null;
    return m?.[1].trim() || undefined;
  } catch {
    return undefined;
  }
}
