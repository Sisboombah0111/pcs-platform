// N5.6.1: MB workbooks with merged cells. A merged StreamID or Unit is read on every row of the block; merged
// quantities are an error (each row would count the same number); a quantity formula that points inside a
// merged block of the calculation sheet reads 0 (an error) or is flagged; a title row above the headers is fine.
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { checkLinkSheet, mergedRefs } from "../src/mb/pcsLink";
import { rewriteMatCodes } from "../src/mb/rewrite";
import { readWorkbook } from "../src/xlsx/workbook";

const ctx = {
  scenarios: [{ id: "sending", name: "Sending", column: "Sending" }, { id: "receiving", name: "Receiving", column: "Receiving" }],
  streamIds: ["ST-PROA-001", "ST-PROA-002"],
  materials: [{ code: "BUF-1001", unit: "L", name: "Equilibration buffer" }, { code: "BUF-1002", unit: "L", name: "Elution buffer" }],
};
const HEAD = ["StreamID", "MatCode", "Unit", "Sending", "Receiving", "Note"];
const ROWS: (string | number | null)[][] = [
  ["ST-PROA-001", null, "L", 2000, 15000, "flow"],
  ["ST-PROA-001", "BUF-1001", "L", 100, 750, "equilibration"],
  ["ST-PROA-001", "BUF-1002", "L", 50, 375, "elution"],
  ["ST-PROA-002", null, "L", 1900, 14250, "flow"],
];

/** A workbook with a PCS_LINK sheet (headers in `headerRow`) and an optional calculation sheet. */
async function book(edit: (link: ExcelJS.Worksheet, calc: ExcelJS.Worksheet, top: number) => void, headerRow = 1) {
  const wb = new ExcelJS.Workbook();
  const calc = wb.addWorksheet("Calc");
  const link = wb.addWorksheet("PCS_LINK");
  link.getRow(headerRow).values = HEAD;
  ROWS.forEach((r, i) => { link.getRow(headerRow + 1 + i).values = r; });
  edit(link, calc, headerRow + 1);
  return new Uint8Array(await wb.xlsx.writeBuffer());
}
const check = async (bytes: Uint8Array) => checkLinkSheet(await readWorkbook(bytes), ctx);

describe("merged cells in PCS_LINK", () => {
  it("a StreamID and a Unit merged down read on every row of the block", async () => {
    const r = await check(await book((ws) => { ws.getCell("A3").value = null; ws.getCell("A4").value = null; ws.mergeCells("A2:A4"); ws.mergeCells("C2:C5"); }));
    expect([r.ok, r.summary]).toEqual([true, { errors: 0, warnings: 0, rows: 4, flowRows: 2, materialRows: 2, streams: 2 }]);
    expect(r.rows.map((x) => [x.streamId, x.matCode, x.unit, x.values.sending])).toEqual([["ST-PROA-001", null, "L", 2000], ["ST-PROA-001", "BUF-1001", "L", 100], ["ST-PROA-001", "BUF-1002", "L", 50], ["ST-PROA-002", null, "L", 1900]]);
  });

  it("merged quantities are an error: every row of the block would count the same number", async () => {
    const r = await check(await book((ws) => { ws.mergeCells("D3:D4"); ws.mergeCells("E3:E4"); }));
    expect(r.ok).toBe(false);
    const msgs = r.issues.filter((i) => i.rule === "V5").map((i) => [i.row, i.col, i.message]);
    expect(msgs).toEqual([
      [3, "D", "Sending cells D3:D4 are merged: each of rows 3–4 would read the same number (100) and count it again. Unmerge them and give each row its own value."],
      [3, "E", "Receiving cells E3:E4 are merged: each of rows 3–4 would read the same number (750) and count it again. Unmerge them and give each row its own value."],
    ]);
    expect(r.rows.map((x) => x.ok)).toEqual([true, false, false, true]);
  });

  it("a quantity merged across scenario columns is an error too", async () => {
    const r = await check(await book((ws) => { ws.mergeCells("D5:E5"); }));
    expect(r.issues.map((i) => i.message)).toEqual(["Sending and Receiving cells D5:E5 are merged: each column would read the same number (1900) and count it again. Unmerge them and give each row its own value."]);
  });
});

describe("a title row above the headers", () => {
  it("the headers are found in row 2; rows are read from row 3 with their Excel row numbers", async () => {
    const r = await check(await book((ws) => { ws.getCell("A1").value = "PCS_LINK (from the calculation sheet)"; ws.mergeCells("A1:F1"); ws.getCell("C4").value = "kg"; }, 2));
    expect([r.headerRow, r.summary.rows, r.summary.errors]).toEqual([2, 4, 1]);
    expect(r.issues[0]).toMatchObject({ rule: "V7", row: 4, col: "C" });
  });

  it("no header row in rows 1–10: the error says so once, without repeating a merged title", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("PCS_LINK");
    ws.getCell("A1").value = "MB summary"; ws.mergeCells("A1:F1");
    const r = await check(new Uint8Array(await wb.xlsx.writeBuffer()));
    expect(r.issues.map((i) => i.message)).toEqual(["Row 1 is missing required headers: StreamID, Unit, Sending. Headers found: MB summary. (No row among rows 1–10 has them.)"]);
  });

  it("changing a material code rewrites the MatCode cells below the header row, not the title", async () => {
    const bytes = await book((ws) => { ws.getCell("A1").value = "BUF-1001 list"; }, 2);
    const res = await rewriteMatCodes(bytes, new Map([["BUF-1001", "BUF-1001W"]]));
    expect(res.changed).toEqual([{ row: 4, from: "BUF-1001", to: "BUF-1001W" }]);
    const r = await check(res.bytes);
    expect(r.rows.find((x) => x.row === 4)?.matCode).toBe("BUF-1001W");
  });
});

describe("a quantity formula that points inside merged cells", () => {
  const calcBlock = (calc: ExcelJS.Worksheet) => { calc.getCell("B2").value = 2000; calc.mergeCells("B2:B4"); calc.getCell("C2").value = 15000; calc.mergeCells("C2:C4"); };

  it("reads 0 → an error naming the top-left cell; the top-left cell itself is fine", async () => {
    const r = await check(await book((ws, calc) => {
      calcBlock(calc);
      ws.getCell("D2").value = { formula: "Calc!B2", result: 2000 };
      ws.getCell("D3").value = { formula: "Calc!B3", result: 0 };
    }));
    expect(r.ok).toBe(false);
    expect(r.issues.map((i) => [i.level, i.row, i.col, i.message])).toEqual([[
      "error", 3, "D",
      "Sending formula (=Calc!B3) reads 0 from Calc!B3, inside the merged cells B2:B4: only the top-left cell of merged cells holds a value. Point it to Calc!B2, the top-left cell, which holds the block's value.",
    ]]);
  });

  it("a value other than 0 (an app that kept the hidden value) → a warning; ranges and sums are fine", async () => {
    const r = await check(await book((ws, calc) => {
      calcBlock(calc);
      ws.getCell("E3").value = { formula: "Calc!$C$3*0.05", result: 750 };
      ws.getCell("D4").value = { formula: "SUM(Calc!B2:B4)*0.025", result: 50 };
    }));
    expect(r.issues.map((i) => [i.level, i.row, i.col])).toEqual([["warning", 3, "E"]]);
    expect(r.ok).toBe(true);
  });

  it("a cell sharing the formula of the cell above is checked with its own reference", async () => {
    const r = await check(await book((ws, calc) => {
      calcBlock(calc);
      ws.getCell("D2").value = { formula: "Calc!B2", result: 2000, shareType: "shared", ref: "D2:D3" } as ExcelJS.CellSharedFormulaValue & { shareType: string; ref: string };
      ws.getCell("D3").value = { sharedFormula: "D2", result: 0 } as ExcelJS.CellSharedFormulaValue;
    }));
    expect(r.issues.map((i) => i.message.slice(0, 50))).toEqual(["Sending formula (=Calc!B3) reads 0 from Calc!B3, i"]);
  });

  it("finds references with quoted sheet names; leaves functions, ranges and text alone", async () => {
    const wb = new ExcelJS.Workbook();
    const calc = wb.addWorksheet("MB calc");
    calc.getCell("B2").value = 1; calc.mergeCells("B2:B4");
    wb.addWorksheet("PCS_LINK");
    const data = await readWorkbook(new Uint8Array(await wb.xlsx.writeBuffer()));
    expect(mergedRefs(data, "='MB calc'!$B$3*2")).toEqual([{ sheet: "MB calc", cell: "B3", range: "B2:B4", topLeft: "B2" }]);
    expect(mergedRefs(data, "=SUM('MB calc'!B2:B4)+LOG10(4)")).toEqual([]);
    expect(mergedRefs(data, "='MB calc'!B2")).toEqual([]);
    expect(mergedRefs(data, "=\"'MB calc'!B3\"")).toEqual([]);
  });
});
