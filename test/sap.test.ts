// N5.7: semi-finished products and SAP BOMs, on the downstream example (Receiving, per batch). The BOM lines and
// their quantities never change; the SAP BOMs are built from them (and from the prepared materials' recipes).
import ExcelJS from "exceljs";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { computeBom } from "../src/bom/model";
import { addForEveryUo, addSemi, applySemiPaste, assignLine, conversion, describeSap, pasteDown, pasteTable, planSemiPaste, removeSemi, replaceInSap, round3, sapBoms, sapDate, setBomUnit, setLineSplit, setSapSettings, setSemi, type SapResult } from "../src/bom/sap";
import { sapSheets, sapWorkbook } from "../src/bom/sapExcel";
import { describeChange } from "../src/model/history";
import { parseProject, serializeProject } from "../src/model/project";
import { replaceMaterial } from "../src/model/replace";
import type { Project } from "../src/model/types";

const load = () => parseProject(readFileSync(join(__dirname, "../examples/example-downstream.pcs.json"), "utf8")).project;
const uo = (p: Project, code: string) => p.uos.find((u) => u.code === code)!;
const mat = (p: Project, code: string) => p.materials.find((m) => m.code === code)!;

/** The example with a semi-finished product per unit operation (codes 1000001 …), plant 1000, a PROA column packing (1000101) taking the resin. */
function setUp(): { p: Project; packing: string } {
  let p = addForEveryUo(load()).project;
  p.bom.sap!.semi.forEach((s, i) => { p = setSemi(p, s.id, { code: String(1000001 + i) }); });
  p = setSapSettings(p, { plant: "1000" });
  const r = addSemi(p, { kind: "packing", uoId: uo(p, "PROA").id, code: "1000101", name: "PROA column packing" });
  p = assignLine(r.project, uo(r.project, "PROA").id, mat(r.project, "RES-0001").id, r.id);
  return { p, packing: r.id };
}
const run = (p: Project) => sapBoms(p, computeBom(p));
const bomOf = (s: SapResult, code: string) => s.boms.find((b) => b.code === code)!;
const items = (s: SapResult, code: string) => bomOf(s, code).items.map((i) => [i.pos, i.code, i.sapQty, i.unit, i.fixed, i.scrapPct, i.source]);

describe("semi-finished products from the BOM", () => {
  it("one per unit operation: base quantity = one batch's output (the MB flow of the transfer out, Receiving)", () => {
    const s = run(setUp().p);
    expect(s.scenario?.id).toBe("receiving");
    expect(s.boms.filter((b) => b.kind === "uo").map((b) => [b.code, b.uo?.code, b.baseQty, b.baseUnit, b.baseFrom])).toEqual([
      ["1000001", "PROA", 2824.8, "L", "ST-PROA-CEX · Receiving"],
      ["1000002", "CEX", 3600, "L", "ST-CEX-MMC · Receiving"],
      ["1000003", "MMC", 4704, "L", "ST-MMC-VF · Receiving"],
      ["1000004", "VF", 4902, "L", "ST-VF-UFDF · Receiving"],
      ["1000005", "UFDF", 453.6, "L", "ST-UFDF-FILL · Receiving"],
      ["1000006", "FILL", 453.6, "L", "ST-FILL-STOR · Receiving"],
      ["1000007", "STOR", null, "L", ""],
    ]);
    // STOR has no transfer out: an error until its output stream is chosen.
    expect(s.issues.filter((i) => i.code === "1000007").map((i) => i.message)).toEqual(["No base quantity: STOR has no transfer out. Choose its output stream or type the quantity (one batch's output)."]);
  });

  it("items: the counted lines before overage (overage = component scrap), the intermediate before it, zeros left out", () => {
    const s = run(setUp().p);
    expect(items(s, "1000001")).toEqual([
      ["0010", "BUF-1001-T", 14520, "L", false, null, "MB"],
      ["0020", "BUF-1002", 6600, "L", false, null, "MB"],
      ["0030", "BUF-1003", 3960, "L", false, null, "MB"],
      ["0040", "BUF-1004", 52.8, "L", false, null, "MB"],
      ["0050", "BUF-1005", 132, "L", false, null, "MB"],
      ["0060", "BUF-1006", 3960, "L", false, null, "MB"],
      ["0070", "FLT-0001", 18, "EA", false, null, "MB"],
      ["0080", "FLT-0002", 1, "EA", false, null, "PFD"],
      ["0090", "UTL-0001", 990, "L", false, null, "MB"],
    ]);
    // BUF-1001-B (200 L bags) is 0 in Receiving (the tank batches are used): left out, with a note.
    expect(s.issues.filter((i) => i.level === "note").map((i) => i.message)).toEqual(["1000001: BUF-1001-B is 0 in Receiving, left out."]);
    // CEX takes PROA's semi-finished product, as much as the transfer carries.
    expect(items(s, "1000002")[0]).toEqual(["0010", "1000001", 2824.8, "L", false, null, "ST-PROA-CEX"]);
    // Without the chain, it does not.
    expect(items(run(setSapSettings(setUp().p, { chain: false })), "1000002")[0][1]).toBe("BUF-1006");
  });

  it("column packing takes the lines given to it; the unit operation's keeps the rest", () => {
    const { p, packing } = setUp();
    const s = run(p);
    expect([bomOf(s, "1000101").baseQty, bomOf(s, "1000101").baseUnit]).toEqual([1, "EA"]);
    expect(items(s, "1000101")).toEqual([["0010", "RES-0001", 330, "L", false, null, "Manual"]]);
    expect(bomOf(s, "1000001").items.some((i) => i.code === "RES-0001")).toBe(false);
    // Back to the unit operation's.
    const back = run(assignLine(p, uo(p, "PROA").id, mat(p, "RES-0001").id, null));
    expect(bomOf(back, "1000101").items).toEqual([]);
    expect(bomOf(back, "1000001").items.map((i) => i.code)).toContain("RES-0001");
    // Removing the packing gives its lines back too.
    expect(bomOf(run(removeSemi(p, packing)), "1000001").items.map((i) => i.code)).toContain("RES-0001");
  });

  it("prepared materials: the recipe for one batch (or for the recipe's amount); per-batch parts are fixed; scrap = the component's overage", () => {
    const s = run(setUp().p);
    expect([bomOf(s, "BUF-1001-B").baseQty, bomOf(s, "BUF-1001-B").baseFrom]).toEqual([200, "one batch (200 L)"]);
    expect(items(s, "BUF-1001-B")).toEqual([["0010", "BUF-1001", 200, "L", false, null, "Recipe"], ["0020", "CON-0004", 1, "EA", true, null, "Per batch"]]);
    expect(items(s, "BUF-1001")).toEqual([["0010", "CHM-0001", 2.423, "KG", false, 5, "Recipe"], ["0020", "CHM-0002", 8.766, "KG", false, 5, "Recipe"], ["0030", "UTL-0001", 1000, "L", false, null, "Recipe"]]);
    expect(bomOf(s, "BUF-1001").usedIn).toEqual(["PROA"]);
    expect(s.boms.filter((b) => b.kind === "prep")).toHaveLength(14);
  });

  it("the BOM lines and their quantities do not change", () => {
    const plain = load();
    const { p } = setUp();
    expect(JSON.stringify(computeBom(p))).toBe(JSON.stringify(computeBom(plain)));
    expect(p.bom.lines).toEqual(plain.bom.lines);
  });
});

describe("checks", () => {
  it("codes that are not SAP numbers: one check per material, with the BOMs it is in; 0 digits = any code", () => {
    const s = run(setUp().p);
    const codes = s.issues.filter((i) => i.group === "codes");
    expect(codes).toHaveLength(39);
    expect(codes.find((i) => i.code === "BUF-1006")?.message).toBe("BUF-1006 Sanitization solution (0.5 M NaOH): the code is not a 7-digit number (a prepared material, with its own BOM). Used in 1000001, 1000002, 1000003, 1000005. Give it its SAP number as MatCode on the Materials screen.");
    const any = run(setSapSettings(setUp().p, { codeDigits: 0 }));
    expect(any.issues.filter((i) => i.group === "codes")).toEqual([]);
    expect(any.errors).toBe(1); // STOR's base quantity
  });

  it("ready: plant, codes, every base quantity → no errors or warnings", () => {
    let { p } = setUp();
    p = setSapSettings(p, { codeDigits: 0 });
    p = setSemi(p, p.bom.sap!.semi.find((x) => x.code === "1000007")!.id, { stream: "ST-FILL-STOR" });
    const s = run(p);
    expect([s.errors, s.warnings]).toEqual([0, 0]);
    expect([bomOf(s, "1000007").baseQty, bomOf(s, "1000007").baseFrom]).toEqual([453.6, "ST-FILL-STOR · Receiving"]);
    // No plant: an error.
    expect(run(setSapSettings(p, { plant: "" })).issues.filter((i) => i.level !== "note").map((i) => i.message)).toEqual(["No plant (WERKS): set it in the SAP settings. Every BOM header needs it."]);
  });

  it("missing or repeated codes of semi-finished products, a code that is a raw material's", () => {
    let { p } = setUp();
    p = setSapSettings(p, { codeDigits: 0 });
    const ids = p.bom.sap!.semi.map((x) => x.id);
    p = setSemi(p, ids[0], { code: "" });
    p = setSemi(p, ids[1], { code: "1000003" });
    p = setSemi(p, ids[3], { code: "CHM-0001" });
    const msgs = run(p).issues.filter((i) => i.level === "error").map((i) => i.message);
    expect(msgs).toContain("The unit operation semi-finished product of PROA has no SAP code: enter its material number.");
    expect(msgs.filter((m) => m === "Code 1000003 is used by 2 semi-finished products: each needs its own.")).toHaveLength(2);
    expect(msgs).toContain("Code CHM-0001 is the code of material Tris base: a semi-finished product needs its own number.");
  });

  it("SAP keeps 3 decimals: a quantity that would lose more than 0.1 % is an error, fixed by counting it in g", () => {
    let { p } = setUp();
    const proa = uo(p, "PROA").id, ps80 = mat(p, "CHM-0009");
    p = { ...p, bom: { ...p.bom, lines: { ...p.bom.lines, [proa]: [...(p.bom.lines[proa] ?? []), { materialId: ps80.id, qtySource: "manual", manualQty: { sending: 0.0021, receiving: 0.01575 }, note: "spike" }] } } };
    let s = run(p);
    const it0 = bomOf(s, "1000001").items.find((i) => i.code === "CHM-0009")!;
    expect([it0.qty, it0.sapQty, it0.unit, it0.scrapPct]).toEqual([0.01575, 0.016, "KG", 10]);
    const issue = s.issues.find((i) => i.fix)!;
    expect([issue.level, issue.message, issue.fix]).toEqual(["error", "1000001 item 0070 CHM-0009: 0.01575 KG is kept as 0.016 (1.6 % off): SAP keeps 3 decimals. Use a smaller unit in the BOMs.", { materialId: ps80.id, unit: "g", factor: 1000, label: "Use g (1 kg = 1,000 g)" }]);
    p = setBomUnit(p, issue.fix!.materialId, { unit: issue.fix!.unit, factor: issue.fix!.factor });
    s = run(p);
    const it1 = bomOf(s, "1000001").items.find((i) => i.code === "CHM-0009")!;
    expect([it1.qty, it1.sapQty, it1.unit, it1.factor]).toEqual([15.75, 15.75, "G", 1000]);
    // The same material in a recipe is counted in g too (BUF-5002: 1.25 kg → 1,250 g).
    expect(bomOf(s, "BUF-5002").items.find((i) => i.code === "CHM-0009")!.sapQty).toBe(1250);
    expect(s.issues.some((i) => i.fix)).toBe(false);
    expect(s.units).toEqual([{ code: "CHM-0009", name: "Polysorbate 80", base: "KG", alt: "G", umrez: 1, umren: 1000, text: "1 KG = 1,000 G" }]);
  });

  it("units, dates and conversions as SAP takes them", () => {
    expect([round3(0.0125), round3(2.4235), round3(1.0005)]).toEqual([0.013, 2.424, 1.001]);
    expect(conversion(1000)).toEqual({ umrez: 1, umren: 1000 });
    expect(conversion(0.001)).toEqual({ umrez: 1000, umren: 1 });
    expect(["YYYY.MM.DD", "YYYYMMDD", "YYYY-MM-DD", "DD.MM.YYYY", "MM/DD/YYYY"].map((f) => sapDate("2026-11-12", f as never))).toEqual(["2026.11.12", "20261112", "2026-11-12", "12.11.2026", "11/12/2026"]);
    let p = load();
    p = { ...p, materials: p.materials.map((m) => (m.code === "FLT-0001" ? { ...m, unit: "pcs" } : m)) };
    p = addForEveryUo(p).project;
    expect(run(p).issues.map((i) => i.message)).toContain("Unit pcs is written as PCS: check it is a unit of measure in SAP, or map it in the settings.");
    p = setSapSettings(p, { units: { pcs: "PC" } });
    const s = run(p);
    expect(s.boms.find((b) => b.uo?.code === "PROA")!.items.find((i) => i.code === "FLT-0001")!.unit).toBe("PC");
    expect(s.issues.some((i) => /Unit pcs/.test(i.message))).toBe(false);
  });
});

describe("saved with the project", () => {
  it("written as v4 with SAP data (v2/v3 without), read back the same; unknown materials are dropped", () => {
    const { p } = setUp();
    const q = setBomUnit(p, mat(p, "CHM-0009").id, { unit: "g", factor: 1000 });
    const text = serializeProject(q);
    expect(JSON.parse(text).version).toBe(4);
    expect(JSON.parse(serializeProject(load())).version).toBe(3);
    const back = parseProject(text);
    expect(back.notes).toEqual([]);
    expect(back.project.bom.sap).toEqual(q.bom.sap);
    const raw = JSON.parse(text);
    raw.bom.sap.bomUnits.mat_gone = { unit: "g", factor: 1000 };
    raw.bom.sap.semi[7].materials.push("mat_gone");
    raw.bom.sap.semi.push({ id: "x", kind: "bad", uoId: "u" });
    expect(parseProject(JSON.stringify(raw)).project.bom.sap).toEqual(q.bom.sap);
  });

  it("Replace moves the semi-finished assignment and the unit to the new material", () => {
    const { p } = setUp();
    const res = mat(p, "RES-0001");
    const next = { ...res, id: "mat_newresin", code: "RES-0011", name: "Protein A resin (new lot size)" };
    let q: Project = { ...p, materials: [...p.materials, next] };
    q = setBomUnit(q, res.id, { unit: "mL", factor: 1000 });
    q = replaceMaterial(q, res.id, next.id, { after: "obsolete" });
    expect(q.bom.sap!.semi.find((x) => x.kind === "packing")!.materials).toEqual(["mat_newresin"]);
    expect(q.bom.sap!.bomUnits).toEqual({ mat_newresin: { unit: "mL", factor: 1000 } });
    expect(items(run(q), "1000101")).toEqual([["0010", "RES-0011", 330000, "ML", false, null, "Manual"]]);
    expect(replaceInSap(undefined, "a", "b")).toBeUndefined();
  });

  it("the change log says what changed", () => {
    const a = load();
    const { p: b } = setUp();
    const lines = describeChange({ bom: a.bom }, { bom: b.bom }, (id) => b.uos.find((u) => u.id === id)?.code ?? "?");
    expect(lines).toEqual([
      "Semi-finished added: 1000001 unit operation PROA, 1000002 unit operation CEX, 1000003 unit operation MMC, 1000004 unit operation VF, 1000005 unit operation UFDF, 1000006 unit operation FILL and 2 more",
      "SAP BOM settings changed",
    ]);
    const c = setSemi(b, b.bom.sap!.semi[0].id, { code: "1000011", name: "ProA run" });
    expect(describeSap(b.bom.sap, c.bom.sap, () => "PROA")).toEqual(["Semi-finished 1000011: code 1000001 → 1000011; name “Protein A, VI, depth filtration” → “ProA run”"]);
  });
});

describe("the SAP BOM workbook", () => {
  it("header and items with SAP field names; codes and item numbers as text, quantities with 3 decimals", async () => {
    let { p } = setUp();
    p = setSapSettings(p, { validFrom: "2026-12-01" });
    const s = run(p);
    const sheets = sapSheets(s, { project: "Downstream", today: "2026-11-12" });
    expect(sheets.map((x) => x.name)).toEqual(["BOM header", "BOM items", "Materials", "Units", "Checks", "About"]);
    const [head, it, mats] = sheets;
    expect(head.cols.slice(0, 9).map((c) => c.header)).toEqual(["MATNR", "WERKS", "STLAN", "STLAL", "DATUV", "BMENG", "BMEIN", "STLST", "STKTX"]);
    expect(head.rows[1].slice(0, 9)).toEqual(["1000001", "1000", "1", "1", "2026.12.01", 2824.8, "L", "1", "Protein A, VI, depth filtration"]);
    expect(it.cols.slice(0, 12).map((c) => c.header)).toEqual(["MATNR", "WERKS", "STLAN", "STLAL", "POSNR", "POSTP", "IDNRK", "MENGE", "MEINS", "FMENG", "AUSCH", "VORNR"]);
    expect(it.rows.find((r) => r[0] === "1000002")!.slice(0, 12)).toEqual(["1000002", "1000", "1", "1", "0010", "L", "1000001", 2824.8, "L", null, null, null]);
    expect(it.rows.find((r) => r[0] === "BUF-1001-B" && r[4] === "0020")!.slice(4, 11)).toEqual(["0020", "L", "CON-0004", 1, "EA", "X", null]);
    expect(mats.rows.find((r) => r[0] === "1000001")!.slice(0, 4)).toEqual(["1000001", "Protein A, VI, depth filtration", "HALB", "L"]);
    expect(mats.rows.find((r) => r[0] === "BUF-1001")![2]).toBe("HALB");
    expect(mats.rows.find((r) => r[0] === "CHM-0001")![2]).toBe("ROH");
    expect(head.rows).toHaveLength(22);
    expect(it.rows).toHaveLength(s.boms.reduce((n, b) => n + b.items.length, 0));

    const blob = await sapWorkbook(s, { project: "Downstream", today: "2026-11-12" });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await blob.arrayBuffer());
    const ws = wb.getWorksheet("BOM items")!;
    const r = ws.getRow(2);
    expect([r.getCell(1).value, r.getCell(5).value, r.getCell(5).numFmt, r.getCell(8).numFmt]).toEqual(["1000101", "0010", "@", "0.000"]);
    expect(ws.getRow(1).getCell(7).note).toBeTruthy();
    expect(wb.getWorksheet("BOM header")!.getRow(1).getCell(14).value).toBe("(info) Items");
  });
});

describe("a BOM line split between the run and its packing / unpacking", () => {
  it("by MB streams: UFDF's DF buffer on ST-UFDF-005 goes to the unpacking, the rest (ST-UFDF-003) stays on the run", () => {
    let { p } = setUp();
    const ufdf = uo(p, "UFDF").id, buf = mat(p, "BUF-5001").id;
    const r = addSemi(p, { kind: "unpacking", uoId: ufdf, code: "1000105", name: "UFDF flush and storage" });
    p = setLineSplit(r.project, ufdf, buf, { [r.id]: { kind: "part", part: { streams: ["ST-UFDF-005"] } } });
    const s = run(p);
    expect(items(s, "1000105")).toEqual([["0010", "BUF-5001", 918, "L", false, null, "MB · ST-UFDF-005"]]);
    expect(bomOf(s, "1000005").items.find((i) => i.code === "BUF-5001")).toMatchObject({ qty: 7200, source: "MB (rest)", partial: "rest" });
    expect(s.issues.filter((i) => i.level === "error" && !i.group).map((i) => i.message)).toEqual(["No base quantity: STOR has no transfer out. Choose its output stream or type the quantity (one batch's output)."]);
    // The BOM line is unchanged.
    expect(computeBom(p).uos.find((u) => u.uo.code === "UFDF")!.rows.find((x) => x.material.code === "BUF-5001")!.base.receiving).toBe(8118);
  });

  it("by an amount: 200 L of PROA's water for injection to its packing, 790 L stay on the run; too much is an error", () => {
    const { p, packing } = setUp();
    const proa = uo(p, "PROA").id, wfi = mat(p, "UTL-0001").id;
    let q = setLineSplit(p, proa, wfi, { [packing]: { kind: "part", part: { qty: { receiving: 200 } } } });
    let s = run(q);
    expect(bomOf(s, "1000101").items.map((i) => [i.code, i.qty, i.source])).toEqual([["RES-0001", 330, "Manual"], ["UTL-0001", 200, "Part (typed)"]]);
    expect(bomOf(s, "1000001").items.find((i) => i.code === "UTL-0001")?.qty).toBe(790);
    // The resin (given whole) stays given whole.
    expect(q.bom.sap!.semi.find((x) => x.id === packing)!.materials).toEqual([mat(p, "RES-0001").id]);
    q = setLineSplit(p, proa, wfi, { [packing]: { kind: "part", part: { qty: { receiving: 1200 } } } });
    s = run(q);
    expect(s.issues.map((i) => i.message)).toContain("UTL-0001: the parts given to 1000101 are more than the line (990 L in Receiving). Change the split.");
    // Streams on a line that is not from the MB: an error saying so.
    q = setLineSplit(p, proa, mat(p, "RES-0001").id, { [packing]: { kind: "part", part: { streams: ["ST-PROA-001"] } } });
    expect(run(q).issues.map((i) => i.message)).toContain("1000101: the part of RES-0001 has no quantity: its quantity is not from the mass balance, so streams cannot split it: type an amount.");
    // Moving the whole line clears the part; "nothing" takes it back.
    q = setLineSplit(p, proa, wfi, { [packing]: { kind: "part", part: { qty: { receiving: 200 } } } });
    expect(assignLine(q, proa, wfi, null).bom.sap!.semi.find((x) => x.id === packing)!.split).toBeUndefined();
    expect(setLineSplit(q, proa, wfi, {}).bom.sap!.semi.find((x) => x.id === packing)!.split).toBeUndefined();
    // Saved and read back.
    expect(parseProject(serializeProject(q)).project.bom.sap).toEqual(q.bom.sap);
  });
});

describe("codes pasted from Excel", () => {
  it("a column of codes pasted into a code cell fills down the list (a second column = names)", () => {
    let p = addForEveryUo(load()).project;
    const order = p.bom.sap!.semi.map((x) => x.id);
    const r = pasteDown(p, order, order[1], pasteTable("1000002\tCEX run\r\n1000003\n\n1000004\n"));
    p = r.project;
    expect(r.count).toBe(3);
    expect(p.bom.sap!.semi.map((x) => [x.code, x.name])).toEqual([["", "Protein A, VI, depth filtration"], ["1000002", "CEX run"], ["1000003", "Mixed-mode chromatography"], ["1000004", "Virus filtration"], ["", "UF/DF and formulation"], ["", "Bulk fill"], ["", "Frozen storage -70 °C"]]);
  });

  it("a list with a header: updates the run of each unit operation and adds a packing; Korean kinds; skips what it cannot place", () => {
    const p = addForEveryUo(load()).project;
    const text = ["공정\t구분\t반제품코드\t반제품명", "PROA\t실행\t1000001\tProtein A capture", "PROA\t패킹\t1000101\tPROA column packing", "CEX\t\t1000002\t", "XYZ\t\t1000009\tNo such step", "MMC\t\t1000002\tDuplicate"].join("\n");
    const plan = planSemiPaste(text, p);
    expect(plan.map((r) => [r.line, r.uo?.code, r.kind, r.code, r.action, r.why ?? ""])).toEqual([
      [2, "PROA", "uo", "1000001", "update", ""],
      [3, "PROA", "packing", "1000101", "create", ""],
      [4, "CEX", "uo", "1000002", "update", ""],
      [5, undefined, "uo", "1000009", "skip", "unit operation not found"],
      [6, "MMC", "uo", "1000002", "skip", "code used twice in the list"],
    ]);
    const r = applySemiPaste(p, plan);
    expect([r.updated, r.created]).toEqual([2, 1]);
    const semi = r.project.bom.sap!.semi;
    expect(semi.find((x) => x.code === "1000001")!.name).toBe("Protein A capture");
    expect(semi.find((x) => x.code === "1000101")).toMatchObject({ kind: "packing", uoId: uo(p, "PROA").id, name: "PROA column packing" });
    expect(semi.find((x) => x.code === "1000002")!.name).toBe("Cation exchange");
  });

  it("a list without a header, columns in any order: the unit operation, a kind label, the code (digits), the name", () => {
    const p = load();
    const plan = planSemiPaste("1000001\tPROA\tProA run\nColumn packing\tPROA\t1000101\nVF\t1000004", p);
    expect(plan.map((r) => [r.uo?.code, r.kind, r.code, r.name, r.action])).toEqual([
      ["PROA", "uo", "1000001", "ProA run", "create"],
      ["PROA", "packing", "1000101", "", "create"],
      ["VF", "uo", "1000004", "", "create"],
    ]);
    const q = applySemiPaste(p, plan).project;
    expect(q.bom.sap!.semi.map((x) => [x.kind, x.code, x.name])).toEqual([["uo", "1000001", "ProA run"], ["packing", "1000101", "PROA column packing"], ["uo", "1000004", "Virus filtration"]]);
  });
});
