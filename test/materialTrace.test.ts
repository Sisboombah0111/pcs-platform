// N5.6: a material that changes during tech transfer (a sampling bag that does not fit → the C-Flex version):
// recorded before → after in the change log, one "replaced" row in the BOM comparison, material details
// before → after, and the Excel sheets that carry them. Linkage (codes, PCS_LINK, quantities) is not touched.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { computeBom } from "../src/bom/model";
import { addRevision, compareBom, countText, makeRevision, snapshotBom } from "../src/bom/revisions";
import { describeChange } from "../src/model/history";
import { materialToRow, MATERIAL_EXPORT_HEADER, planMaterialImport } from "../src/model/materials";
import { parseProject, serializeProject } from "../src/model/project";
import { replaceMaterial } from "../src/model/replace";
import type { Material, Project } from "../src/model/types";
import { comparisonSheets } from "../src/views/BomRevisions";
import { writeWorkbook } from "../src/xlsx/workbook";

const load = (): Project => parseProject(readFileSync(join(__dirname, "../examples/example-downstream.pcs.json"), "utf8")).project;
const BAG: Material = { id: "mat_bag", code: "CON-0010", name: "NovaSeptum sampling bag 100 mL", unit: "EA", category: "Consumable", spec: "Single-use, TPE tubing", supplier: "Supplier X", partNo: "NS-100" };
const CFLEX: Material = { id: "mat_cflex", code: "CON-0011", name: "NovaSeptum sampling bag 100 mL, C-Flex tubing", unit: "EA", category: "Consumable", spec: "Single-use, C-Flex tubing", supplier: "Supplier X", partNo: "NS-100-CF" };
const uo = (p: Project, code: string) => p.uos.find((u) => u.code === code)!.id;
const now = (p: Project) => ({ label: "Now", ...snapshotBom(computeBom(p), p.materials) });
const code = (id: string) => (id === "u1" ? "PROA" : id);

/** The example with the sampling bag on PROA (4 per scenario, a line entered by hand) and Rev A saved. */
function withBag(): { p: Project; revA: ReturnType<typeof makeRevision> } {
  const p0 = load();
  const proa = uo(p0, "PROA");
  const p1: Project = {
    ...p0, materials: [...p0.materials, BAG],
    bom: { ...p0.bom, lines: { ...p0.bom.lines, [proa]: [...(p0.bom.lines[proa] ?? []), { materialId: BAG.id, qtySource: "manual", manualQty: { sending: 4, receiving: 4 }, note: "4 samples per cycle" }] } },
  };
  const revA = makeRevision(p1, computeBom(p1), { label: "Rev A", now: "2026-11-01T09:00:00Z" });
  return { p: addRevision(p1, revA), revA };
}

const cells = async (sheets: Awaited<ReturnType<typeof comparisonSheets>>) => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await (await writeWorkbook(sheets)).arrayBuffer());
  const out: Record<string, string[][]> = {};
  wb.eachSheet((ws) => { out[ws.name] = []; ws.eachRow((r) => out[ws.name].push(Array.from((r.values as unknown[]).slice(1), (v) => (v == null ? "" : String(v))))); });
  return out;
};

describe("a new material and Replace… (the old one marked obsolete)", () => {
  it("reads as one replaced row in the lines, the totals and the materials; the log says what replaced what", async () => {
    const { p, revA } = withBag();
    const added: Project = { ...p, materials: [...p.materials, CFLEX] };
    expect(describeChange(p, added, code)).toEqual(["Materials added: CON-0011 “NovaSeptum sampling bag 100 mL, C-Flex tubing”"]);
    const q = replaceMaterial(added, BAG.id, CFLEX.id, { after: "obsolete" });
    expect(describeChange(added, q, code)[0]).toBe("Material CON-0010: status In use → Obsolete; replaced by CON-0011");

    const c = compareBom(revA, now(q), q.materials);
    expect(c.count).toEqual({ added: 0, removed: 0, replaced: 1, changed: 0 });
    expect(countText(c.count)).toBe("0 added · 0 removed · 1 replaced · 0 changed");
    const line = c.lines.find((x) => x.kind !== "same")!;
    expect([line.kind, line.uo, line.code, line.was?.code, line.before, line.after, line.delta]).toEqual(["replaced", "PROA", "CON-0011", "CON-0010", { sending: 4, receiving: 4 }, { sending: 4, receiving: 4 }, { sending: 0, receiving: 0 }]);
    expect(c.totals.filter((x) => x.kind !== "same").map((x) => [x.kind, x.was?.code, x.code])).toEqual([["replaced", "CON-0010", "CON-0011"]]);
    expect(c.materials).toEqual([{ kind: "replaced", code: "CON-0011", name: CFLEX.name, was: { code: "CON-0010", name: BAG.name, unit: "EA" }, what: "Material", before: `CON-0010 · ${BAG.name}`, after: `CON-0011 · ${CFLEX.name}`, uos: "PROA" }]);
    expect(c.materialsPartial).toBe(false);

    // Excel: the three Changes sheets.
    const x = await cells(comparisonSheets(c));
    expect(Object.keys(x)).toEqual(["Changes (lines)", "Changes (totals)", "Changes (materials)"]);
    expect(x["Changes (lines)"][1].slice(0, 5)).toEqual(["Replaced", "PROA", "CON-0010 → CON-0011", CFLEX.name, "EA"]);
    expect(x["Changes (lines)"][1].at(-1)).toBe(`was CON-0010 “${BAG.name}”`);
    expect(x["Changes (materials)"]).toEqual([
      ["Change", "Code", "Material", "What changed", "Rev A", "Now", "Unit operations"],
      ["Replaced", "CON-0010 → CON-0011", CFLEX.name, "Material", `CON-0010 · ${BAG.name}`, `CON-0011 · ${CFLEX.name}`, "PROA"],
    ]);
  });

  it("without “replaced by” (deleted, or kept as it is) it stays removed + added; with the replacement on the BOM already, the removed row says so", () => {
    const { p, revA } = withBag();
    const added: Project = { ...p, materials: [...p.materials, CFLEX] };
    const deleted = replaceMaterial(added, BAG.id, CFLEX.id, { after: "delete" });
    expect(compareBom(revA, now(deleted), deleted.materials).lines.filter((x) => x.kind !== "same").map((x) => x.kind).sort()).toEqual(["added", "removed"]);
    // The C-Flex bag already counted in PROA (same unit operation): the bag's line goes, the C-Flex line is kept.
    const proa = uo(added, "PROA");
    const both: Project = { ...added, bom: { ...added.bom, lines: { ...added.bom.lines, [proa]: [...added.bom.lines[proa], { materialId: CFLEX.id, qtySource: "manual", manualQty: { sending: 2, receiving: 2 } }] } } };
    const revB = makeRevision(both, computeBom(both), { label: "Rev B" });
    const q = replaceMaterial(both, BAG.id, CFLEX.id, { after: "obsolete" });
    const c = compareBom(revB, now(q), q.materials);
    expect(c.lines.find((x) => x.kind === "removed")!.notes).toEqual(["replaced by CON-0011 (on the BOM already)"]);
    expect(c.materials.map((m) => [m.kind, m.code])).toEqual([["replaced", "CON-0011"]]);
  });

  it("a replacement in another unit: quantities in their own unit, no change figure", () => {
    const { p, revA } = withBag();
    const roll: Material = { ...CFLEX, id: "mat_roll", code: "CON-0012", name: "Sampling bags, box of 10", unit: "BOX" };
    const q = replaceMaterial({ ...p, materials: [...p.materials, roll] }, BAG.id, roll.id, { after: "obsolete", factor: 0.1 });
    const line = compareBom(revA, now(q), q.materials).lines.find((x) => x.kind === "replaced")!;
    expect([line.before, line.after, line.delta, line.notes]).toEqual([{ sending: 4, receiving: 4 }, { sending: 0.4, receiving: 0.4 }, { sending: null, receiving: null }, ["unit EA → BOX"]]);
  });
});

describe("the same material changed in place", () => {
  it("the log, the totals and the materials say before → after; supplier and part no. are no longer silent", async () => {
    const { p, revA } = withBag();
    const edited: Project = { ...p, materials: p.materials.map((m) => (m.id === BAG.id ? { ...m, name: CFLEX.name, spec: CFLEX.spec, partNo: CFLEX.partNo } : m)) };
    expect(describeChange(p, edited, code)).toEqual([`Material CON-0010: name “${BAG.name}” → “${CFLEX.name}”; spec “Single-use, TPE tubing” → “Single-use, C-Flex tubing”; part no. NS-100 → NS-100-CF`]);
    const c = compareBom(revA, now(edited), edited.materials);
    expect(c.lines.filter((x) => x.kind !== "same").map((x) => [x.kind, x.notes])).toEqual([["changed", [`name “${BAG.name}” → “${CFLEX.name}”`]]]);
    expect(c.totals.find((x) => x.code === "CON-0010")!.notes).toEqual([`name “${BAG.name}” → “${CFLEX.name}”`, "spec “Single-use, TPE tubing” → “Single-use, C-Flex tubing”", "part no. NS-100 → NS-100-CF"]);
    expect(c.materials.map((m) => [m.kind, m.what, m.before, m.after])).toEqual([["edited", "Name", BAG.name, CFLEX.name], ["edited", "Spec", BAG.spec, CFLEX.spec], ["edited", "Part no.", "NS-100", "NS-100-CF"]]);

    const supplier: Project = { ...p, materials: p.materials.map((m) => (m.id === BAG.id ? { ...m, supplier: "Supplier Y", packSize: 10 } : m)) };
    expect(describeChange(p, supplier, code)).toEqual(["Material CON-0010: supplier “Supplier X” → “Supplier Y”; pack size – → 10"]);
    const s = compareBom(revA, now(supplier), supplier.materials);
    expect([s.count.changed, s.totals.filter((x) => x.kind === "changed").map((x) => x.code)]).toEqual([0, ["CON-0010"]]);
    expect(s.materials.map((m) => m.what)).toEqual(["Supplier", "Pack size"]);
  });

  it("an obsolete material still counted shows its status; many changes at once: ten in detail, the rest by code", () => {
    const { p, revA } = withBag();
    const old: Project = { ...p, materials: p.materials.map((m) => (m.id === BAG.id ? { ...m, status: "obsolete" } : m)) };
    expect(compareBom(revA, now(old), old.materials).materials.map((m) => [m.what, m.before, m.after])).toEqual([["Status", "In use", "Obsolete"]]);
    const many: Project = { ...p, materials: p.materials.map((m) => (m.category === "Chemical" ? { ...m, supplier: "New supplier" } : m)) };
    const log = describeChange(p, many, code);
    expect(log.length).toBe(11);
    expect(log[0]).toBe("Material CHM-0001: supplier – → “New supplier”");
    expect(log[10]).toMatch(/^Materials changed, more: /);
  });

  it("a revision saved before N5.6 (no material details): code, name, unit and category only, and a note saying so", async () => {
    const { p, revA } = withBag();
    const { materials, ...older } = revA;
    void materials;
    const edited: Project = { ...p, materials: p.materials.map((m) => (m.id === BAG.id ? { ...m, name: CFLEX.name, partNo: CFLEX.partNo } : m)) };
    const c = compareBom(older, now(edited), edited.materials);
    expect([c.materialsPartial, c.materials.map((m) => m.what)]).toEqual([true, ["Name"]]);
    const x = await cells(comparisonSheets(c));
    expect(x["Changes (materials)"].at(-1)!.slice(0, 3)).toEqual(["Note", "", "Rev A was saved before v5.6: spec, supplier, part no., pack size and status are compared only between revisions saved since (and the BOM now)."]);
  });
});

describe("kept with the project; the material list", () => {
  it("a revision's material details are saved and read back", () => {
    const { p, revA } = withBag();
    expect(revA.materials!.find((m) => m.code === "CON-0010")).toEqual({ mid: BAG.id, code: "CON-0010", name: BAG.name, unit: "EA", category: "Consumable", spec: BAG.spec, supplier: "Supplier X", partNo: "NS-100" });
    const back = parseProject(serializeProject(p)).project;
    expect(back.bom.revisions).toEqual(p.bom.revisions);
  });

  it("the Materials export says what replaced what both ways; importing it back changes nothing", () => {
    const { p } = withBag();
    const q = replaceMaterial({ ...p, materials: [...p.materials, CFLEX] }, BAG.id, CFLEX.id, { after: "obsolete" });
    const row = (c: string) => materialToRow(q.materials.find((m) => m.code === c)!, q.materials);
    expect(MATERIAL_EXPORT_HEADER.slice(7)).toEqual(["Status", "Replaced by", "Supplier", "Part no.", "Pack size", "Replaces"]);
    expect([row("CON-0010").slice(7, 9), row("CON-0011").slice(7, 9), row("CON-0011")[12]]).toEqual([["Obsolete", "CON-0011"], ["In use", undefined], "CON-0010"]);
    const table = [MATERIAL_EXPORT_HEADER, ...q.materials.map((m) => materialToRow(m, q.materials).map((v) => (v == null ? "" : String(v))))];
    const plan = planMaterialImport(table, q.materials);
    expect([plan.errors, plan.add.length, plan.update.length]).toEqual([[], 0, 0]);
  });
});
