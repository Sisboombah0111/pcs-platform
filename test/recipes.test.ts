import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { addManualLine, computeBom, setLine, type BomResult } from "../src/bom/model";
import { linkCheck } from "../src/link/check";
import { checkLinkSheet, toSnapshot } from "../src/mb/pcsLink";
import { applyImport, applyRefsImport, backupRows, planMaterialImport, planRefsImport, recipeRows, BACKUP_EXPORT_HEADER, RECIPE_EXPORT_HEADER } from "../src/model/materials";
import { createProject, DEFAULT_SCENARIOS, parseProject, serializeProject } from "../src/model/project";
import { deleteMaterial, loopWith, recipeLoops, usedIn, withRecipe } from "../src/model/recipes";
import { addMissingSamples, hasMissingSamples, sampleMaterials } from "../src/model/sampleData";
import type { Material, MbRow, Project } from "../src/model/types";
import { readWorkbook } from "../src/xlsx/workbook";

/** 10L seed and 100L bioreactor with MB_example.xlsx applied, the sample materials (with recipes and backups). */
async function example(extraRows: MbRow[] = []): Promise<Project> {
  const p = createProject("Recipes");
  p.materials = sampleMaterials();
  p.uos = [{ id: "u10", code: "10L", name: "10L Seed bioreactor", order: 1 }, { id: "u100", code: "100L", name: "100L Bioreactor", order: 2 }];
  p.streams.active = {
    "ST-10L-001": { kind: "pfd", elementId: "a1", uoId: "u10" },
    "ST-10L-100L": { kind: "transfer", elementId: "a2", fromUoId: "u10", toUoId: "u100" },
    "ST-100L-001": { kind: "pfd", elementId: "a3", uoId: "u100" },
    "ST-100L-002": { kind: "pfd", elementId: "a4", uoId: "u100" },
  };
  const wb = await readWorkbook(new Uint8Array(readFileSync(join(__dirname, "../examples/MB_example.xlsx"))));
  const res = checkLinkSheet(wb, { scenarios: DEFAULT_SCENARIOS, streamIds: Object.keys(p.streams.active), materials: p.materials });
  expect(res.ok).toBe(true);
  p.mb.current = toSnapshot(res, { id: "mb1", source: "file", importedAt: "2026-10-31T00:00:00Z" });
  p.mb.current.rows.push(...extraRows);
  return p;
}
const mbRow = (streamId: string, matCode: string, unit: string, s: number, r: number): MbRow => ({ streamId, matCode, unit, values: { sending: s, receiving: r } });
const id = (p: Pick<Project, "materials">, c: string) => p.materials.find((m) => m.code === c)!.id;
const row = (b: BomResult, uo: string, code: string) => b.uos.find((u) => u.uo.code === uo)!.rows.find((r) => r.material.code === code)!;
const sr = (v: { sending: number | null; receiving: number | null } | Record<string, number | null>) => [v.sending, v.receiving];
const totals = (list: BomResult["totals"]) => Object.fromEntries(list.map((t) => [t.material.code, sr(t.qty)]));
// Sodium bicarbonate 7.5 % in the basal medium of 100L: 2.8 L (Sending) and 14 L (Receiving).
const BICARB = mbRow("ST-100L-001", "MAT-0007", "L", 2.8, 14);

describe("prepared materials: recipe explosion in the BOM", () => {
  it("an MB row of a prepared solution becomes its chemicals; totals buy the chemicals and list the solution as prepared", async () => {
    const b = computeBom(await example([BICARB]));
    const r = row(b, "100L", "MAT-0007");
    expect([r.line.qtySource, ...sr(r.qty)]).toEqual(["MB", 2.8, 14]);
    // Per 1000 L: 75 kg sodium bicarbonate, 1000 L WFI → 2.8 L: 0.21 kg and 2.8 L; 14 L: 1.05 kg and 14 L.
    expect(r.parts.map((x) => [x.material.code, x.depth, ...sr(x.qty)])).toEqual([["MAT-0040", 1, 0.21, 1.05], ["MAT-0012", 1, 2.8, 14]]);
    expect(totals(b.totals)).toMatchObject({ "MAT-0040": [0.21, 1.05], "MAT-0012": [2.8, 14] });
    expect(totals(b.totals)["MAT-0007"]).toBeUndefined();
    expect(totals(b.prepared)).toEqual({ "MAT-0007": [2.8, 14] });
    const wfi = b.totals.find((t) => t.material.code === "MAT-0012")!;
    expect([wfi.via, sr(wfi.fromRecipes!)]).toEqual([["MAT-0007"], [2.8, 14]]);
    expect(b.issueCount).toBe(0);
  });

  it("the solution's overage carries into its chemicals; each chemical adds its own default overage", async () => {
    let p = await example([BICARB]);
    p.materials = p.materials.map((m) => (m.code === "MAT-0040" ? { ...m, overagePct: 5 } : m));
    p = setLine(p, row(computeBom(p), "100L", "MAT-0007"), { overagePct: 10 });
    const r = row(computeBom(p), "100L", "MAT-0007");
    expect(sr(r.qty)).toEqual([3.08, 15.4]);
    // 3.08 L × 75 / 1000 = 0.231 kg, + 5 % = 0.24255 kg; WFI 3.08 L (no overage of its own).
    expect(r.parts.map((x) => [x.material.code, ...sr(x.base), x.overagePct, ...sr(x.qty)])).toEqual([
      ["MAT-0040", 0.231, 1.155, 5, 0.24255, 1.21275],
      ["MAT-0012", 3.08, 15.4, 0, 3.08, 15.4],
    ]);
  });

  it("a manual line of a buffer explodes too; a line not counted does not", async () => {
    let p = await example();
    p = addManualLine(p, "u100", id(p, "MAT-0043"));
    p = setLine(p, row(computeBom(p), "100L", "MAT-0043"), { manualQty: { sending: 200, receiving: 1000 }, note: "Column equilibration" });
    let b = computeBom(p);
    expect(row(b, "100L", "MAT-0043").parts.map((x) => [x.material.code, ...sr(x.qty)])).toEqual([
      ["MAT-0009", 0.4846, 2.423], ["MAT-0008", 1.7532, 8.766], ["MAT-0012", 200, 1000],
    ]);
    p = setLine(p, row(b, "100L", "MAT-0043"), { excluded: true });
    b = computeBom(p);
    expect(row(b, "100L", "MAT-0043").parts).toEqual([]);
    expect(b.prepared).toEqual([]);
    expect(totals(b.totals)["MAT-0009"]).toBeUndefined();
  });

  it("nested recipes (a stock solution inside a buffer) and missing quantities", () => {
    const p = createProject("Nested");
    const mats: Material[] = [
      { id: "tris", code: "TRIS", name: "Tris", unit: "kg" },
      { id: "nacl", code: "NACL", name: "NaCl", unit: "kg" },
      { id: "wfi", code: "WFI", name: "WFI", unit: "L" },
      { id: "stk", code: "STK", name: "1 M Tris stock", unit: "L", recipe: { per: 1, components: [{ materialId: "tris", qty: 0.12114 }, { materialId: "wfi", qty: 1 }] } },
      { id: "buf", code: "BUF", name: "Buffer", unit: "L", recipe: { per: 1000, components: [{ materialId: "stk", qty: 20 }, { materialId: "nacl", qty: 8.766 }, { materialId: "wfi", qty: 980 }] } },
    ];
    p.materials = mats;
    p.uos = [{ id: "c", code: "CHR", name: "Chromatography", order: 1 }];
    p.bom.lines = { c: [{ materialId: "buf", qtySource: "manual", manualQty: { sending: 500, receiving: null }, note: "Equilibration" }] };
    const b = computeBom(p);
    const r = row(b, "CHR", "BUF");
    expect(r.parts.map((x) => [x.material.code, x.depth, x.parent.code, ...sr(x.qty)])).toEqual([
      ["STK", 1, "BUF", 10, null], ["TRIS", 2, "STK", 1.2114, null], ["WFI", 2, "STK", 10, null],
      ["NACL", 1, "BUF", 4.383, null], ["WFI", 1, "BUF", 490, null],
    ]);
    expect(totals(b.totals)).toEqual({ TRIS: [1.2114, null], NACL: [4.383, null], WFI: [500, null] });
    expect(b.totals.find((t) => t.material.code === "WFI")!.incomplete).toEqual({ receiving: true });
    expect(totals(b.prepared)).toEqual({ BUF: [500, null], STK: [10, null] });
    expect(b.prepared.find((t) => t.material.code === "STK")!.via).toEqual(["BUF"]);
  });

  it("recipe loops are found, shown on the line and not counted", () => {
    const a: Material = { id: "a", code: "A", name: "A", unit: "L" };
    const bm: Material = { id: "b", code: "B", name: "B", unit: "L", recipe: { per: 1, components: [{ materialId: "a", qty: 1 }] } };
    expect(loopWith([a, bm], "a", { per: 1, components: [{ materialId: "b", qty: 2 }] })).toEqual(["A", "B", "A"]);
    const looped = [withRecipe(a, { per: 1, components: [{ materialId: "b", qty: 2 }] }), bm];
    expect(recipeLoops(looped)).toEqual([["A", "B", "A"]]);
    const p = createProject("Loop");
    p.materials = looped;
    p.uos = [{ id: "u", code: "X", name: "X", order: 1 }];
    p.bom.lines = { u: [{ materialId: "a", qtySource: "manual", manualQty: { sending: 1, receiving: 1 }, note: "test" }] };
    const b = computeBom(p);
    const r = row(b, "X", "A");
    expect(r.parts.map((x) => [x.material.code, !!x.loop])).toEqual([["B", false], ["A", true]]);
    expect(r.issues.some((t) => /Recipe loop: A → B → A/.test(t))).toBe(true);
    expect(totals(b.prepared)).toEqual({ A: [1, 1], B: [2, 2] });
    expect(linkCheck(p).find((f) => f.id === "recipe-loop")?.items.map((i) => i.text)).toEqual(["A → B → A"]);
  });

  it("a stream whose MB rows list a solution and one of its chemicals: a note; on another stream of the UO: none", async () => {
    const p = await example([BICARB, mbRow("ST-100L-001", "MAT-0040", "kg", 0.21, 1.05), mbRow("ST-100L-002", "MAT-0012", "L", 1, 5)]);
    const b = computeBom(p);
    expect(row(b, "100L", "MAT-0040").notes.join(" ")).toMatch(/MAT-0040 is also in the recipe of MAT-0007 \(ST-100L-001\), on the same stream/);
    expect(totals(b.totals)["MAT-0040"]).toEqual([0.42, 2.1]);
    // WFI used on its own on another stream (a flush) is not a double count.
    expect(row(b, "100L", "MAT-0012").notes.join(" ")).not.toMatch(/recipe/);
    expect(linkCheck(p).find((f) => f.id === "recipe-double")?.items.map((i) => i.text)).toEqual(["ST-100L-001 (100L): MAT-0007 and MAT-0040, which is in its recipe"]);
  });
});

describe("backup (alternate) materials", () => {
  it("listed under the primary's lines and recipe parts, summed apart, never in the totals", async () => {
    let p = await example();
    p = addManualLine(p, "u100", id(p, "MAT-0008"));
    p = setLine(p, row(computeBom(p), "100L", "MAT-0008"), { manualQty: { sending: 2, receiving: 10 }, note: "Salt for the harvest flush" });
    p = addManualLine(p, "u100", id(p, "MAT-0043"));
    p = setLine(p, row(computeBom(p), "100L", "MAT-0043"), { manualQty: { sending: 1000, receiving: 1000 }, note: "Equilibration" });
    const b = computeBom(p);
    expect(row(b, "100L", "MAT-0008").backups.map((x) => [x.material.code, x.ratio, ...sr(x.qty)])).toEqual([["MAT-0044", 1, 2, 10]]);
    const nacl = row(b, "100L", "MAT-0043").parts.find((x) => x.material.code === "MAT-0008")!;
    expect(nacl.backups.map((x) => [x.material.code, ...sr(x.qty)])).toEqual([["MAT-0044", 8.766, 8.766]]);
    expect(totals(b.totals)["MAT-0008"]).toEqual([10.766, 18.766]);
    expect(totals(b.totals)["MAT-0044"]).toBeUndefined();
    expect(b.backupTotals.map((t) => [t.material.code, ...sr(t.qty), t.forCodes])).toEqual([["MAT-0044", 10.766, 18.766, ["MAT-0008"]]]);
  });

  it("a ratio converts the quantity; other units without a ratio get a hint", async () => {
    let p = await example();
    const bag50 = id(p, "MAT-0017"), bag500 = id(p, "MAT-0018"), wfi = id(p, "MAT-0012");
    p.materials = p.materials.map((m) => (m.id === bag500 ? { ...m, backups: [{ materialId: bag50, ratio: 10, note: "10 small bags" }, { materialId: wfi }] } : m));
    p = addManualLine(p, "u100", bag500);
    p = setLine(p, row(computeBom(p), "100L", "MAT-0018"), { manualQty: { sending: 1, receiving: 2 }, note: "Media hold" });
    const r = row(computeBom(p), "100L", "MAT-0018");
    expect(r.backups.map((x) => [x.material.code, ...sr(x.qty), x.note ?? "", !!x.unitHint])).toEqual([["MAT-0017", 10, 20, "10 small bags", false], ["MAT-0012", 1, 2, "", true]]);
  });
});

describe("materials: deleting, reading and the sample list", () => {
  it("deleting a material takes it out of recipes and backup lists", () => {
    const list = sampleMaterials();
    const wfi = id({ materials: list }, "MAT-0012"), alt = id({ materials: list }, "MAT-0044");
    expect(usedIn(list, wfi).recipes.map((m) => m.code)).toEqual(["MAT-0007", "MAT-0011", "MAT-0043"]);
    const next = deleteMaterial(deleteMaterial(list, wfi), alt);
    expect(next.find((m) => m.code === "MAT-0007")!.recipe!.components.map((c) => c.materialId)).toEqual([id({ materials: list }, "MAT-0040")]);
    expect(next.find((m) => m.code === "MAT-0008")!.backups).toBeUndefined();
  });

  it("project files keep recipes and backups; references to unknown materials are dropped with a note", () => {
    const p = createProject("Refs");
    p.materials = sampleMaterials();
    const back = parseProject(serializeProject(p));
    expect(back.project.materials).toEqual(p.materials);
    expect(back.notes).toEqual([]);
    const raw = JSON.parse(serializeProject(p));
    raw.materials.find((m: Material) => m.code === "MAT-0011").recipe.components.push({ materialId: "gone", qty: 1 }, { materialId: raw.materials[0].id, qty: -1 });
    raw.materials.find((m: Material) => m.code === "MAT-0008").backups.push({ materialId: raw.materials.find((m: Material) => m.code === "MAT-0008").id });
    const fixed = parseProject(JSON.stringify(raw));
    expect(fixed.notes).toEqual(["3 recipe component(s) or backup material(s) named a material that is not in the list (or had no quantity) and were left out."]);
    expect(fixed.project.materials).toEqual(p.materials);
  });

  it("the example list (18 samples) gets the new samples and the sample recipes and backups", () => {
    const old = sampleMaterials().slice(0, 18).map((m) => { const x = { ...m }; delete x.recipe; delete x.backups; return x; });
    expect(hasMissingSamples(old)).toBe(true);
    const r = addMissingSamples(old);
    expect(r.added.map((m) => m.code)).toEqual(["MAT-0031", "MAT-0032", "MAT-0033", "MAT-0034", "MAT-0035", "MAT-0036", "MAT-0037", "MAT-0038", "MAT-0039", "MAT-0040", "MAT-0041", "MAT-0042", "MAT-0043", "MAT-0044", "MAT-0045"]);
    expect(r.completed.map((m) => m.code)).toEqual(["MAT-0007", "MAT-0008", "MAT-0011", "MAT-0015"]);
    const by = new Map(r.materials.map((m) => [m.code, m]));
    expect(by.get("MAT-0011")!.recipe!.components.map((c) => r.materials.find((m) => m.id === c.materialId)!.code)).toEqual(["MAT-0041", "MAT-0042", "MAT-0012"]);
    expect(by.get("MAT-0043")!.recipe!.components.map((c) => r.materials.find((m) => m.id === c.materialId)!.code)).toEqual(["MAT-0009", "MAT-0008", "MAT-0012"]);
    expect(hasMissingSamples(r.materials)).toBe(false);
    // A sample code with another name is the user's own material: left alone.
    const own = old.map((m) => (m.code === "MAT-0011" ? { ...m, name: "Our citrate buffer" } : m));
    expect(addMissingSamples(own).materials.find((m) => m.code === "MAT-0011")!.recipe).toBeUndefined();
  });
});

describe("materials file: Recipes and Backups sheets", () => {
  it("export → import gives the same recipes and backups", () => {
    const list = sampleMaterials();
    const rec = [RECIPE_EXPORT_HEADER, ...recipeRows(list)].map((r) => r.map((c) => (c == null ? "" : String(c))));
    const bak = [BACKUP_EXPORT_HEADER, ...backupRows(list)].map((r) => r.map((c) => (c == null ? "" : String(c))));
    expect(rec[1]).toEqual(["MAT-0007", "Sodium Bicarbonate 7.5 %", "1000", "L", "MAT-0040", "Sodium Bicarbonate (powder)", "75", "kg", "", "", "", "Example: 75 g/L sodium bicarbonate, WFI to volume", ""]);
    const bare = list.map((m) => { const x = { ...m }; delete x.recipe; delete x.backups; return x; });
    const plan = planRefsImport(rec, bak, bare);
    expect(plan.errors).toEqual([]);
    expect([plan.recipes.length, plan.backups.length, plan.recipes.every((r) => r.changed)]).toEqual([3, 2, true]);
    expect(applyRefsImport(bare, plan)).toEqual(list);
    expect(planRefsImport(rec, bak, list).recipes.some((r) => r.changed)).toBe(false);
    // Batch size, a component per batch and whole batches go out and come back.
    const withBatch = list.map((m) => (m.code === "MAT-0043" ? { ...m, recipe: { ...m.recipe!, batch: 200, wholeBatches: true, components: [...m.recipe!.components.slice(0, 2), { ...m.recipe!.components[2], basis: "batch" as const }] } } : m));
    const rec2 = [RECIPE_EXPORT_HEADER, ...recipeRows(withBatch)].map((r) => r.map((c) => (c == null ? "" : String(c))));
    const row43 = rec2.filter((r) => r[0] === "MAT-0043");
    expect(row43.map((r) => r.slice(8, 11))).toEqual([["", "200", "Yes"], ["", "200", "Yes"], ["Per batch", "200", "Yes"]]);
    const plan2 = planRefsImport(rec2, null, bare);
    expect(plan2.errors).toEqual([]);
    expect(applyRefsImport(bare, plan2).find((m) => m.code === "MAT-0043")!.recipe).toEqual(withBatch.find((m) => m.code === "MAT-0043")!.recipe);
  });

  it("batch columns: Korean headers, values and refusals", () => {
    const list = sampleMaterials().map((m) => { const x = { ...m }; delete x.recipe; delete x.backups; return x; });
    const plan = planRefsImport([
      ["제조품코드", "기준량", "원료코드", "수량", "산정기준", "배치크기", "전량조제"],
      ["MAT-0043", "1000", "MAT-0012", "1000", "", "200", "예"],
      ["MAT-0043", "1000", "MAT-0017", "1", "배치당", "200", ""],
      ["MAT-0043", "1000", "MAT-0009", "1", "per batch", "300", ""],
      ["MAT-0011", "1000", "MAT-0012", "1000", "maybe", "", ""],
      ["MAT-0011", "1000", "MAT-0041", "1", "", "-1", ""],
      ["MAT-0007", "1000", "MAT-0012", "1000", "", "", "Yes"],
    ], null, list);
    expect(plan.errors.map((e) => [e.row, e.message])).toEqual([
      [4, "MAT-0043: Batch size 300 differs from 200 on an earlier row."],
      [5, "MAT-0011: Basis 'maybe' is neither 'Per batch' nor empty (per 1000 L)."],
      [6, "MAT-0011: Batch size '-1' is not a number > 0."],
      [0, "MAT-0007: Whole batches needs a batch size; it is ignored."],
    ]);
    const r = plan.recipes.find((x) => x.code === "MAT-0043")!;
    expect([r.batch, r.wholeBatches, r.components.map((c) => c.basis ?? "")]).toEqual([200, true, ["", "batch"]]);
  });

  it("Korean headers, a new material from the same file, and rows that are refused", () => {
    const existing = sampleMaterials().slice(0, 12).map((m) => { const x = { ...m }; delete x.recipe; delete x.backups; return x; });
    const matPlan = planMaterialImport([["자재코드", "자재명", "단위"], ["BUF-0001", "Wash buffer", "L"]], existing);
    const after = applyImport(existing, matPlan);
    const plan = planRefsImport([
      ["제조품코드", "기준량", "원료코드", "수량", "원료단위"],
      ["BUF-0001", "100", "MAT-0008", "2.9", "kg"],
      ["BUF-0001", "100", "MAT-0012", "100", ""],
      ["BUF-0001", "100", "MAT-0099", "1", ""],
      ["BUF-0001", "100", "MAT-0009", "0", ""],
      ["BUF-0001", "100", "MAT-0004", "1", "g"],
      ["BUF-0001", "50", "MAT-0010", "1", ""],
    ], [
      ["주자재코드", "대체자재코드", "비율"],
      ["MAT-0008", "MAT-0004", "1.5"],
      ["MAT-0008", "MAT-0008", ""],
    ], after);
    expect(plan.recipes.map((r) => [r.code, r.per, r.components.map((c) => `${c.code}:${c.qty}`).join(",")])).toEqual([["BUF-0001", 100, "MAT-0008:2.9,MAT-0012:100"]]);
    expect(plan.backups.map((b) => [b.code, b.backups])).toEqual([["MAT-0008", [{ code: "MAT-0004", ratio: 1.5 }]]]);
    expect(plan.errors.map((e) => `${e.sheet} ${e.row}`)).toEqual(["Recipes 4", "Recipes 5", "Recipes 6", "Recipes 7", "Backups 3"]);
  });

  it("recipes that would make a loop are refused", () => {
    const a: Material = { id: "a", code: "A", name: "A", unit: "L", recipe: { per: 1, components: [{ materialId: "b", qty: 1 }] } };
    const b: Material = { id: "b", code: "B", name: "B", unit: "L" };
    const plan = planRefsImport([["Code", "Component code", "Quantity"], ["B", "A", "1"]], null, [a, b]);
    expect(plan.recipes).toEqual([]);
    expect(plan.errors.map((e) => e.message)).toEqual(["These recipes make a loop (A → B → A); their rows are left out."]);
  });
});
