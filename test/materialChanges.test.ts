import { readFileSync } from "node:fs";
import { join } from "node:path";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { computeBom } from "../src/bom/model";
import { guideStatus } from "../src/guide/status";
import { linkCheck } from "../src/link/check";
import { changeCodesInMb } from "../src/mb/codeChanges";
import { checkLinkSheet } from "../src/mb/pcsLink";
import { rewriteMatCodes } from "../src/mb/rewrite";
import { applyImport, materialToRow, MATERIAL_EXPORT_HEADER, parseStatus, planMaterialImport } from "../src/model/materials";
import { parseProject, serializeProject } from "../src/model/project";
import { planReplace, replaceMaterial } from "../src/model/replace";
import type { Project } from "../src/model/types";
import { base64ToBytes } from "../src/storage/files";
import { readWorkbook } from "../src/xlsx/workbook";

const load = (): Project => parseProject(readFileSync(join(__dirname, "../examples/example-downstream.pcs.json"), "utf8")).project;
const MB = () => new Uint8Array(readFileSync(join(__dirname, "../examples/MB_downstream.xlsx")));
const id = (p: Project, code: string) => p.materials.find((m) => m.code === code)!.id;
const total = (p: Project, code: string) => { const t = computeBom(p).totals.find((x) => x.material.code === code); return t ? [t.qty.sending, t.qty.receiving] : undefined; };
const recode = (p: Project, from: string, to: string): Project => ({ ...p, materials: p.materials.map((m) => (m.code === from ? { ...m, code: to } : m)) });

describe("PCS_LINK codes rewritten in the workbook, nothing else", () => {
  it("only the MatCode cells with the old code change; every other part of the file is the same", async () => {
    const before = MB();
    const r = await rewriteMatCodes(before, new Map([["BUF-1001-B", "BUF-1001-BAG"]]));
    expect([r.changed, r.skipped]).toEqual([[{ row: 4, from: "BUF-1001-B", to: "BUF-1001-BAG" }], []]);
    const [za, zb] = [await JSZip.loadAsync(before), await JSZip.loadAsync(r.bytes)];
    const names = Object.keys(za.files).filter((n) => !za.files[n].dir);
    expect(Object.keys(zb.files).filter((n) => !zb.files[n].dir).sort()).toEqual([...names].sort());
    const differ: string[] = [];
    for (const n of names) if ((await za.file(n)!.async("string")) !== (await zb.file(n)!.async("string"))) differ.push(n);
    expect(differ).toEqual(["xl/worksheets/sheet2.xml"]);
    // Read back: the row has the new code and its values; MB_calc still has its results.
    const wb = await readWorkbook(r.bytes);
    const p = recode(load(), "BUF-1001-B", "BUF-1001-BAG");
    const res = checkLinkSheet(wb, { scenarios: p.mb.scenarios, streamIds: Object.keys(p.streams.active), materials: p.materials });
    expect(res.ok).toBe(true);
    expect(res.rows.filter((x) => x.streamId === "ST-PROA-002" && x.matCode).map((x) => [x.matCode, x.values.sending, x.values.receiving])).toEqual([["BUF-1001-BAG", 1980, 0], ["BUF-1001-T", 0, 14520]]);
  });

  it("a MatCode cell with a formula is left alone and reported; nothing to change gives the same bytes", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("PCS_LINK");
    ws.addRow(["StreamID", "MatCode", "Unit", "Sending"]);
    ws.addRow(["ST-A-001", "CHM-1", "kg", 1]);
    ws.addRow(["ST-A-002", { formula: '"CHM-"&"1"', result: "CHM-1" }, "kg", 2]);
    const bytes = new Uint8Array(await wb.xlsx.writeBuffer());
    const r = await rewriteMatCodes(bytes, new Map([["CHM-1", "CHM-9"]]));
    expect(r.changed.map((c) => c.row)).toEqual([2]);
    expect(r.skipped).toEqual([{ row: 3, code: "CHM-1", why: "MatCode is a formula: change it in the workbook" }]);
    const none = await rewriteMatCodes(bytes, new Map([["NOPE", "X"]]));
    expect(none.bytes).toBe(bytes);
    await expect(rewriteMatCodes(bytes, new Map())).resolves.toMatchObject({ changed: [] });
  });

  it("the project: workbook and applied values follow, still applied, History says so, the link check is clean", async () => {
    let p = recode(load(), "BUF-1001-B", "BUF-1001-BAG");
    expect(linkCheck(p).map((f) => f.id)).toContain("unknown-material");
    const r = await changeCodesInMb(p, new Map([["BUF-1001-B", "BUF-1001-BAG"]]), { why: "Code changed", by: "Kim", now: "2026-11-04T05:00:00Z" });
    p = r.project;
    expect([r.workbookRows, r.appliedRows, r.skipped]).toEqual([1, 1, []]);
    expect(p.mb.current!.sha256).toBe(p.mb.workbook!.sha256);
    expect(p.mb.workbook!.savedBy).toBe("PCS Platform");
    expect(p.mb.history[0]).toMatchObject({ source: "app", importedBy: "Kim", note: "Code changed: BUF-1001-B → BUF-1001-BAG (1 PCS_LINK row(s) in the workbook, 1 applied row(s))" });
    expect(linkCheck(p)).toEqual([]);
    expect(total(p, "CON-0004")).toEqual([10, 0]);
    // The rewritten workbook reads back with the new code.
    const wb = await readWorkbook(base64ToBytes(p.mb.workbook!.dataBase64));
    expect(checkLinkSheet(wb, { scenarios: p.mb.scenarios, streamIds: Object.keys(p.streams.active), materials: p.materials }).ok).toBe(true);
  });
});

describe("replace a material with another", () => {
  it("NaCl → its backup from supplier B: recipes follow, the old one is obsolete and replaced, totals move", async () => {
    let p = load();
    const before = total(p, "CHM-0002");
    const plan = planReplace(p, id(p, "CHM-0002"), id(p, "CHM-0102"))!;
    expect(plan.blocked).toBeUndefined();
    expect([plan.sameUnit, plan.recipes.map((r) => r.code), plan.pfdLinks, plan.mbRows, plan.ownBackups]).toEqual([true, ["BUF-1001", "BUF-1002", "BUF-2002", "BUF-2003", "BUF-3001"], 0, 0, 0]);
    p = replaceMaterial(p, id(p, "CHM-0002"), id(p, "CHM-0102"), { after: "obsolete" });
    expect(total(p, "CHM-0002")).toBeUndefined();
    // Same quantities, with the new material's own default overage (0 % instead of 5 %).
    const after = total(p, "CHM-0102")!;
    expect(after[0]).toBeCloseTo(before![0]! / 1.05, 9);
    expect(after[1]).toBeCloseTo(before![1]! / 1.05, 9);
    const old = p.materials.find((m) => m.code === "CHM-0002")!;
    expect([old.status, p.materials.find((m) => m.id === old.replacedBy)!.code]).toEqual(["obsolete", "CHM-0102"]);
    expect(linkCheck(p)).toEqual([]);
    // Status and "replaced by" are saved with the project.
    const back = parseProject(serializeProject(p)).project.materials.find((m) => m.code === "CHM-0002")!;
    expect([back.status, back.replacedBy]).toEqual(["obsolete", old.replacedBy]);
  });

  it("a filter linked on the PFD: the links move to the new filter, the counts add up", () => {
    let p = load();
    const [f2, f6] = [total(p, "FLT-0002")!, total(p, "FLT-0006")!];
    const plan = planReplace(p, id(p, "FLT-0002"), id(p, "FLT-0006"))!;
    expect(plan.pfdLinks).toBeGreaterThan(0);
    p = replaceMaterial(p, id(p, "FLT-0002"), id(p, "FLT-0006"), { after: "delete" });
    expect(p.materials.some((m) => m.code === "FLT-0002")).toBe(false);
    expect(total(p, "FLT-0006")).toEqual([f2[0]! + f6[0]!, f2[1]! + f6[1]!]);
  });

  it("refused when it would make a recipe loop", () => {
    const p = load();
    // Tris is in BUF-1001; BUF-1001-B is made of BUF-1001: BUF-1001 would contain itself.
    expect(planReplace(p, id(p, "CHM-0001"), id(p, "BUF-1001-B"))!.blocked).toMatch(/recipe loop/);
    expect(planReplace(p, id(p, "CHM-0001"), id(p, "CHM-0001"))!.blocked).toBe("Choose another material.");
  });

  it("different units: quantities × factor in recipes", () => {
    let p = load();
    p = { ...p, materials: [...p.materials, { id: "nacl-g", code: "CHM-0202", name: "Sodium chloride (g)", unit: "g" }] };
    expect(planReplace(p, id(p, "CHM-0002"), "nacl-g")!.sameUnit).toBe(false);
    p = replaceMaterial(p, id(p, "CHM-0002"), "nacl-g", { factor: 1000, after: "keep" });
    expect(p.materials.find((m) => m.code === "BUF-1001")!.recipe!.components.find((c) => c.materialId === "nacl-g")!.qty).toBe(8766);
  });
});

describe("material status", () => {
  it("an obsolete material still used: the BOM line and the link check say so, the guide asks to replace it", () => {
    const p0 = load();
    const p = { ...p0, materials: p0.materials.map((m) => (m.code === "FLT-0001" ? { ...m, status: "obsolete" as const } : m.code === "CHM-0009" ? { ...m, status: "review" as const } : m)) };
    const b = computeBom(p);
    const proa = b.uos.find((u) => u.uo.code === "PROA")!;
    expect(proa.rows.find((r) => r.material.code === "FLT-0001")!.issues).toEqual(["FLT-0001 is obsolete: replace it (Materials › Replace…) or set the line to Not counted."]);
    const f = linkCheck(p).find((x) => x.id === "obsolete-in-use")!;
    expect([f.level, f.items.map((i) => i.text)]).toEqual(["warn", ["FLT-0001 Depth filter capsule (1.1 m²): MB ST-PROA-010"]]);
    const ufdf = b.uos.find((u) => u.uo.code === "UFDF")!;
    // CHM-0009 (in the excipient stock) is only under review: no issue.
    expect(ufdf.rows.find((r) => r.material.code === "BUF-5002")!.issues).toEqual([]);
    const s = guideStatus(p, linkCheck(p), b);
    expect(s[0]).toMatchObject({ id: "materials", state: "check" });
  });

  it("Status in the material file: read in English or Korean, written back", () => {
    expect(["", "Active", "In use", "사용 중", "Under review", "검토중", "Obsolete", "단종", "maybe"].map(parseStatus)).toEqual([undefined, undefined, undefined, undefined, "review", "review", "obsolete", "obsolete", null]);
    const p = load();
    const plan = planMaterialImport([["Code", "Name", "Unit", "상태"], ["FLT-0001", "Depth filter capsule (1.1 m²)", "EA", "단종"], ["FLT-0002", "x", "EA", "sometimes"]], p.materials);
    expect(plan.update.map((u) => [u.existing.code, u.changes])).toEqual([["FLT-0001", ["status In use → Obsolete"]]]);
    expect(plan.errors).toEqual([{ row: 3, message: "FLT-0002: Status 'sometimes' is not In use, Under review or Obsolete." }]);
    const after = applyImport(p.materials, plan);
    expect(after.find((m) => m.code === "FLT-0001")!.status).toBe("obsolete");
    expect(MATERIAL_EXPORT_HEADER.slice(7, 9)).toEqual(["Status", "Replaced by"]);
    expect(materialToRow(after.find((m) => m.code === "FLT-0001")!, after).slice(7, 9)).toEqual(["Obsolete", undefined]);
  });
});
