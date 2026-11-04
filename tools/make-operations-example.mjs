// Writes examples/operations-downstream.xlsx: the steps of PROA (Protein A capture, low-pH viral
// inactivation, depth filtration) in the downstream example, written the way a team would by hand:
// an Equipment list, the Steps with their Stream IDs, and an Actions list (open/close, start/stop).
// tools/add-operations-example.mjs imports it into examples/example-downstream.pcs.json.
// Usage: node tools/make-operations-example.mjs
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ExcelJS = require("exceljs");

const EQUIPMENT = [
  // Tag, Type, Name, Unit operation, Initial state, Note
  ["P-101", "Pump", "Chromatography skid pump", "PROA", "Off", ""],
  ["XV-101", "Valve", "Skid inlet: HCCF load", "PROA", "Closed", ""],
  ["XV-102", "Valve", "Skid inlet: equilibration / wash buffer (BUF-1001)", "PROA", "Closed", ""],
  ["XV-103", "Valve", "Skid inlet: intermediate wash (BUF-1002)", "PROA", "Closed", ""],
  ["XV-104", "Valve", "Skid inlet: elution buffer (BUF-1003)", "PROA", "Closed", ""],
  ["XV-105", "Valve", "Skid inlet: 0.5 M NaOH (BUF-1006)", "PROA", "Closed", ""],
  ["XV-110", "Valve", "Column outlet to drain", "PROA", "Closed", ""],
  ["XV-111", "Valve", "Column outlet to VI vessel", "PROA", "Closed", "Opens on the UV rise (eluate peak)"],
  ["C-101", "Column", "Protein A column", "PROA", "", "Drawn on the PFD"],
  ["T-101", "Vessel", "Low-pH VI vessel", "PROA", "", "Drawn on the PFD"],
  ["AG-101", "Agitator", "VI vessel agitator", "PROA", "Off", ""],
  ["P-102", "Pump", "VI pool transfer pump", "PROA", "Off", ""],
  ["XV-120", "Valve", "VI vessel outlet to depth filter", "PROA", "Closed", ""],
  ["XV-121", "Valve", "WFI to depth filter (flush)", "PROA", "Closed", ""],
  ["F-101", "Filter", "Depth filter", "PROA", "", "Drawn on the PFD"],
  ["F-102", "Filter", "0.2 µm filter", "PROA", "", "Drawn on the PFD"],
];

const STEPS = [
  // No., Step, Minutes, Streams, Note, actions [tag, state, note?]
  [1, "Sanitize column", 30, "ST-PROA-005, ST-PROA-006", "0.5 M NaOH, 3 CV", [["XV-105", "Open"], ["XV-110", "Open"], ["P-101", "Start"], ["C-101", "Flow 300 cm/h"]]],
  [2, "Equilibrate", 20, "ST-PROA-002, ST-PROA-006", "5 CV, until pH and conductivity are stable", [["XV-105", "Close"], ["XV-102", "Open"]]],
  [3, "Load HCCF", 150, "ST-PROA-001, ST-PROA-006", "Up to 35 g/L resin", [["XV-102", "Close"], ["XV-101", "Open"]]],
  [4, "Wash 1", 20, "ST-PROA-002, ST-PROA-006", "", [["XV-101", "Close"], ["XV-102", "Open"]]],
  [5, "Wash 2 (intermediate)", 20, "ST-PROA-003, ST-PROA-006", "", [["XV-102", "Close"], ["XV-103", "Open"]]],
  [6, "Elute to VI vessel", 30, "ST-PROA-004, ST-PROA-007", "Collect from 0.5 AU rising to 0.5 AU falling", [["XV-103", "Close"], ["XV-104", "Open"], ["XV-110", "Close"], ["XV-111", "Open"], ["AG-101", "Start", "100 rpm"]]],
  [7, "Strip and sanitize", 30, "ST-PROA-005, ST-PROA-006", "", [["XV-104", "Close"], ["XV-111", "Close"], ["XV-110", "Open"], ["XV-105", "Open"]]],
  [8, "Re-equilibrate", 20, "ST-PROA-002, ST-PROA-006", "Column stored in equilibration buffer", [["XV-105", "Close"], ["XV-102", "Open"]]],
  [9, "Titrate to pH 3.6", 20, "ST-PROA-008", "Skid stops; titration in T-101", [["P-101", "Stop"], ["XV-102", "Close"], ["XV-110", "Close"], ["T-101", "Add 1 M acetic acid to pH 3.6"]]],
  [10, "Low-pH hold", 60, "", "60 min at pH 3.5-3.7, 18-25 °C", [["T-101", "Hold 60 min"]]],
  [11, "Neutralize to pH 5.5", 20, "ST-PROA-009", "", [["T-101", "Add 1 M Tris to pH 5.5"]]],
  [12, "Flush depth filter", 20, "ST-PROA-011", "100 L/m² WFI", [["XV-121", "Open"], ["F-101", "Flush to drain"]]],
  [13, "Depth filtration", 60, "ST-PROA-010, ST-PROA-012, ST-PROA-CEX", "Filtrate to CEX through the 0.2 µm filter", [["XV-121", "Close"], ["XV-120", "Open"], ["P-102", "Start"]]],
  [14, "Stop", 5, "", "", [["P-102", "Stop"], ["XV-120", "Close"], ["AG-101", "Stop"]]],
];

const wb = new ExcelJS.Workbook();
wb.creator = "PCS Platform example";
const sheet = (name, header, rows, widths) => {
  const ws = wb.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1 }] });
  ws.addRow(header);
  ws.getRow(1).font = { bold: true };
  for (const r of rows) ws.addRow(r);
  widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
};
sheet("About", ["Item", "Value"], [
  ["What", "Steps of PROA in the downstream example: Protein A capture, low-pH viral inactivation, depth filtration."],
  ["How", "Written as an action list (Actions sheet). Import it on Operations › Import from Excel; the app makes the state table from it."],
  ["States", "Valves: Open / Close. Pumps and agitators: Start / Stop. Vessels, filters, columns: what is done in that step."],
], [12, 110]);
sheet("Equipment", ["Tag", "Type", "Name", "Unit operation", "Initial state", "Note"], EQUIPMENT, [12, 12, 48, 16, 14, 36]);
sheet("Steps", ["Unit operation", "No.", "Step", "Minutes", "Streams", "Note"], STEPS.map(([no, name, min, streams, note]) => ["PROA", no, name, min, streams, note]), [16, 6, 26, 10, 44, 44]);
sheet("Actions", ["Unit operation", "No.", "Step", "Tag", "State", "Note"],
  STEPS.flatMap(([no, name, , , , acts]) => acts.map(([tag, state, note]) => ["PROA", no, name, tag, state, note ?? ""])), [16, 6, 26, 12, 34, 20]);
await wb.xlsx.writeFile("examples/operations-downstream.xlsx");
console.log(`wrote examples/operations-downstream.xlsx: ${EQUIPMENT.length} equipment, ${STEPS.length} steps, ${STEPS.reduce((n, s) => n + s[5].length, 0)} actions`);
