// Write examples/MB_example_buffer.xlsx: MB_example.xlsx plus one PCS_LINK row for a solution made
// in-house (MAT-0007 Sodium Bicarbonate 7.5 %, in litres) so the BOM can turn it into its chemicals
// with the sample recipe. Formula results of the original are kept.
// Usage (from the repository root): node tools/make-mb-buffer-example.mjs
import ExcelJS from "exceljs";

const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile("examples/MB_example.xlsx");
const ws = wb.getWorksheet("PCS_LINK");
const last = ws.getRow(ws.rowCount);
// After the basal medium rows of ST-100L-001: 2.8 L (Sending) and 14 L (Receiving) of bicarbonate solution.
const at = [...Array(ws.rowCount).keys()].map((i) => i + 1).filter((r) => ws.getRow(r).getCell(1).value === "ST-100L-001").pop() + 1;
ws.insertRow(at, ["ST-100L-001", "MAT-0007", "L", 2.8, 14, "Sodium bicarbonate 7.5 % solution, made in-house (sample recipe: 75 g/L, WFI)"]);
const row = ws.getRow(at);
row.eachCell((c, i) => { c.border = last.getCell(i).border; c.numFmt = last.getCell(i).numFmt; c.font = last.getCell(i).font; });
await wb.xlsx.writeFile("examples/MB_example_buffer.xlsx");
console.log(`examples/MB_example_buffer.xlsx: row ${at} added`);
