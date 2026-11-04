import { describe, expect, it } from "vitest";
import { computeBom, setLine, type BomResult } from "../src/bom/model";
import { createProject, parseProject, serializeProject } from "../src/model/project";
import { batchCount, batchText, cleanMaterialRefs, componentText } from "../src/model/recipes";
import type { Material, Project, Recipe } from "../src/model/types";

/**
 * One buffer, two ways of preparing it: in 200 L single-use bags with a filter built in (BUF-B), or in
 * a 2000 L tank, filtered through a 0.2 µm capsule (BUF-T). Both are made of the same solution BUF.
 */
const mat = (id: string, code: string, unit: string, extra: Partial<Material> = {}): Material => ({ id, code, name: code, unit, ...extra });
function materials(bRecipe: Partial<Recipe> = {}, tRecipe: Partial<Recipe> = {}): Material[] {
  return [
    mat("nacl", "CHM-NACL", "kg", { overagePct: 5 }),
    mat("wfi", "UTL-WFI", "L"),
    mat("bag", "BAG-200", "EA", { category: "Consumable" }),
    mat("flt", "FLT-02", "EA", { category: "Filter" }),
    mat("buf", "BUF", "L", { recipe: { per: 1000, components: [{ materialId: "nacl", qty: 8.766 }, { materialId: "wfi", qty: 1000 }] } }),
    mat("bufb", "BUF-B", "L", { recipe: { per: 1000, batch: 200, components: [{ materialId: "buf", qty: 1000 }, { materialId: "bag", qty: 1, basis: "batch" }], ...bRecipe } }),
    mat("buft", "BUF-T", "L", { recipe: { per: 1000, batch: 2000, components: [{ materialId: "buf", qty: 1000 }, { materialId: "flt", qty: 1, basis: "batch" }], ...tRecipe } }),
  ];
}
/** PROA uses the bag version at the sending site (1,980 L) and the tank version at the receiving site (14,520 L). */
function project(ms = materials()): Project {
  const p = createProject("Batches");
  p.materials = ms;
  p.uos = [{ id: "u1", code: "PROA", name: "Protein A", order: 1 }];
  p.streams.active = { "ST-PROA-002": { kind: "pfd", elementId: "a1", uoId: "u1" } };
  p.mb.current = {
    id: "mb1", source: "file", importedAt: "2026-11-02T00:00:00Z", scenarios: ["sending", "receiving"],
    rows: [
      { streamId: "ST-PROA-002", matCode: null, unit: "L", values: { sending: 1980, receiving: 14520 } },
      { streamId: "ST-PROA-002", matCode: "BUF-B", unit: "L", values: { sending: 1980, receiving: 0 } },
      { streamId: "ST-PROA-002", matCode: "BUF-T", unit: "L", values: { sending: 0, receiving: 14520 } },
    ],
  };
  return p;
}
const sr = (v: Record<string, number | null> | undefined | null) => (v ? [v.sending, v.receiving] : null);
const row = (b: BomResult, code: string) => b.uos[0].rows.find((r) => r.material.code === code)!;
const parts = (b: BomResult, code: string) => row(b, code).parts.map((x) => [x.material.code, ...sr(x.qty)!]);
const total = (list: BomResult["totals"], code: string) => sr(list.find((t) => t.material.code === code)?.qty);

describe("batches: rounding up per preparation", () => {
  it("batchCount is ⌈quantity ÷ batch size⌉; nothing needs no batch; no batch size is one batch", () => {
    expect([1980, 2000, 2000.0000000000002, 2001, 200, 1, 0].map((q) => batchCount({ batch: 200 }, q))).toEqual([10, 10, 10, 11, 1, 1, 0]);
    // 0.1 + 0.2 style noise does not add a batch: 3 × 0.1 L in 0.1 L batches is 3 batches.
    expect(batchCount({ batch: 0.1 }, 0.30000000000000004)).toBe(3);
    expect([batchCount({}, 14520), batchCount({}, 0)]).toEqual([1, 0]);
  });

  it("bags per batch: 1,980 L in 200 L bags is 10 bags; the solution and its chemicals stay proportional", () => {
    const b = computeBom(project());
    expect(sr(row(b, "BUF-B").batches)).toEqual([10, 0]);
    expect(parts(b, "BUF-B")).toEqual([
      ["BUF", 1980, 0], ["CHM-NACL", 18.224514, 0], ["UTL-WFI", 1980, 0],
      ["BAG-200", 10, 0],
    ]);
    // 14,520 L in 2,000 L tank batches: 8 filters (7.26 rounded up).
    expect(sr(row(b, "BUF-T").batches)).toEqual([0, 8]);
    expect(parts(b, "BUF-T").find((x) => x[0] === "FLT-02")).toEqual(["FLT-02", 0, 8]);
    expect(total(b.totals, "BAG-200")).toEqual([10, 0]);
    expect(total(b.totals, "FLT-02")).toEqual([0, 8]);
    // NaCl from both versions: 1980 and 14520 L × 8.766 kg / 1000 L, + 5 %.
    expect(total(b.totals, "CHM-NACL")).toEqual([18.224514, 133.646436]);
    // Prepared in-house: both versions and the solution itself, with the batches.
    expect(sr(b.prepared.find((t) => t.material.code === "BUF-B")!.batches)).toEqual([10, 0]);
    expect(total(b.prepared, "BUF")).toEqual([1980, 14520]);
    expect(b.issueCount).toBe(0);
  });

  it("the line's overage comes first: 1,980 L + 10 % = 2,178 L is 11 bags", () => {
    let p = project();
    p = setLine(p, row(computeBom(p), "BUF-B"), { overagePct: 10 });
    const b = computeBom(p);
    expect(sr(row(b, "BUF-B").batches)).toEqual([11, 0]);
    expect(parts(b, "BUF-B").find((x) => x[0] === "BAG-200")).toEqual(["BAG-200", 11, 0]);
    expect(parts(b, "BUF-B")[0]).toEqual(["BUF", 2178, 0]);
  });

  it("whole batches: the proportional parts are counted for batches × batch size (8 × 2,000 = 16,000 L)", () => {
    const b = computeBom(project(materials({}, { wholeBatches: true })));
    expect(parts(b, "BUF-T").filter((x) => x[0] !== "FLT-02")).toEqual([["BUF", 0, 16000], ["CHM-NACL", 0, 147.2688], ["UTL-WFI", 0, 16000]]);
  });

  it("a component per batch without a batch size: one batch per BOM line", () => {
    const b = computeBom(project(materials({ batch: undefined })));
    expect(sr(row(b, "BUF-B").batches)).toEqual([1, 0]);
    expect(parts(b, "BUF-B").find((x) => x[0] === "BAG-200")).toEqual(["BAG-200", 1, 0]);
  });

  it("texts for the BOM and the recipe dialog", () => {
    const bag = { unit: "EA", code: "BAG-200" }, buf = { unit: "L" };
    expect(componentText(1, bag, 1000, buf, "batch", 200)).toBe("1 EA per batch of 200 L");
    expect(componentText(1, bag, 1000, buf, "batch", null)).toBe("1 EA per batch");
    expect(componentText(8.766, { unit: "kg", code: "X" }, 1000, buf)).toBe("8.766 kg per 1,000 L");
    expect(batchText({ per: 1000, batch: 2000, wholeBatches: true, components: [] }, "L")).toBe("batches of 2,000 L, made in full");
    expect(batchText({ per: 1000, components: [{ materialId: "x", qty: 1 }] }, "L")).toBe("");
  });

  it("the project file keeps batch sizes, per-batch components and whole batches; bad values are dropped", () => {
    const p = project(materials({}, { wholeBatches: true }));
    const back = parseProject(serializeProject(p)).project;
    expect(back.materials.find((m) => m.code === "BUF-B")!.recipe).toEqual(p.materials.find((m) => m.code === "BUF-B")!.recipe);
    expect(back.materials.find((m) => m.code === "BUF-T")!.recipe!.wholeBatches).toBe(true);
    const ms = materials({ batch: -5, wholeBatches: true });
    cleanMaterialRefs(ms);
    const r = ms.find((m) => m.code === "BUF-B")!.recipe!;
    expect([r.batch, r.wholeBatches, r.components[1].basis]).toEqual([undefined, undefined, "batch"]);
  });
});
