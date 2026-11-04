// Writes examples/materials-import-example.xlsx: a small list to try "Import Excel/CSV" with.
// With the 18 sample materials loaded it gives 3 new, 1 updated, 1 unchanged and 1 rejected row.
import ExcelJS from "exceljs";

const wb = new ExcelJS.Workbook();
wb.creator = "PCS Platform";
const ws = wb.addWorksheet("Materials", { views: [{ state: "frozen", ySplit: 1 }] });
ws.addRow(["Code", "Name", "Unit", "Category", "Spec"]);
ws.getRow(1).font = { bold: true };
for (const r of [
  ["MAT-0001", "Basal Medium (powder)", "kg", "Media", "Animal-free"],
  ["MAT-0004", "Glucose anhydrous", "kg", "Media", "≥ 99.5 %"],
  ["MAT-0019", "Poloxamer 188", "kg", "Media", "USP"],
  ["MAT-0020", "Polysorbate 80", "kg", "Buffer", "NF"],
  ["MAT-0021", "Protein A Column (pre-packed)", "EA", "Resin", "1 L"],
  ["MAT-0022", "Unit missing on purpose", "", "Buffer", ""],
]) ws.addRow(r);
[12, 34, 8, 12, 14].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
await wb.xlsx.writeFile("examples/materials-import-example.xlsx");
console.log("wrote examples/materials-import-example.xlsx");
