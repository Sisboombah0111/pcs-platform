// N5.7: a buffer made once and shared by several BOM lines (a packing evaluation buffer for three columns) is
// counted as one preparation: batches and per-batch parts for the total over its lines. Without the setting (the
// default), each line is prepared on its own — the same buffer made again for each use.
import { describe, expect, it } from "vitest";
import { computeBom, type BomResult } from "../src/bom/model";
import { createProject, parseProject, serializeProject } from "../src/model/project";
import { planRefsImport, applyRefsImport, recipeRows, RECIPE_EXPORT_HEADER } from "../src/model/materials";
import type { Material, Project } from "../src/model/types";

const mat = (id: string, code: string, unit: string, extra: Partial<Material> = {}): Material => ({ id, code, name: code, unit, ...extra });
/** PKE: packing evaluation buffer, 400 L batches, one filter per batch, 1 kg NaCl per 100 L; 100 L for each of three columns. */
function project(shared: boolean, whole = false): Project {
  const p = createProject("Shared");
  p.materials = [
    mat("nacl", "CHM-NACL", "kg"),
    mat("flt", "FLT-02", "EA"),
    mat("pke", "BUF-PKE", "L", { recipe: { per: 100, batch: 400, components: [{ materialId: "nacl", qty: 1 }, { materialId: "flt", qty: 1, basis: "batch" }], ...(shared ? { shared: true } : {}), ...(whole ? { wholeBatches: true } : {}) } }),
  ];
  p.uos = [{ id: "u1", code: "PROA", name: "Protein A", order: 1 }, { id: "u2", code: "CEX", name: "Cation exchange", order: 2 }, { id: "u3", code: "MMC", name: "Mixed mode", order: 3 }];
  for (const u of p.uos) p.bom.lines[u.id] = [{ materialId: "pke", qtySource: "manual", manualQty: { sending: 100, receiving: 100 }, note: "packing evaluation" }];
  return p;
}
const total = (b: BomResult, code: string) => b.totals.find((t) => t.material.code === code)?.qty.sending;
const prep = (b: BomResult, code: string) => b.prepared.find((t) => t.material.code === code);

describe("shared preparation", () => {
  it("not shared (default): each line is its own preparation — 3 batches, 3 filters", () => {
    const b = computeBom(project(false));
    expect([prep(b, "BUF-PKE")?.batches?.sending, total(b, "FLT-02"), total(b, "CHM-NACL")]).toEqual([3, 3, 3]);
    expect(b.uos.map((u) => u.rows[0].batches?.sending)).toEqual([1, 1, 1]);
  });

  it("shared: one preparation of 300 L — 1 batch, 1 filter; each line shows its share", () => {
    const b = computeBom(project(true));
    expect([prep(b, "BUF-PKE")?.batches?.sending, total(b, "FLT-02"), total(b, "CHM-NACL")]).toEqual([1, 1, 3]);
    const r = b.uos[0].rows[0];
    expect(r.batches).toBeNull();
    expect(r.parts.map((x) => [x.material.code, x.qty.sending, x.poolLines])).toEqual([["CHM-NACL", 1, 3], ["FLT-02", 0.333333333333, 3]]);
    expect(r.notes).toContain("Prepared once for its 3 lines (PROA, CEX, MMC): Sending 300 L in 1 batch, Receiving 300 L in 1 batch. Its components here are this line's share.");
    // Whole batches: one 400 L batch is made → 4 kg NaCl in total.
    expect(total(computeBom(project(true, true)), "CHM-NACL")).toBe(4);
    expect(total(computeBom(project(false, true)), "CHM-NACL")).toBe(12);
  });

  it("a line not counted or a single line: as before", () => {
    const p = project(true);
    p.bom.lines.u2[0].excluded = true;
    p.bom.lines.u3[0].excluded = true;
    const b = computeBom(p);
    expect([b.uos[0].rows[0].batches?.sending, total(b, "FLT-02")]).toEqual([1, 1]);
    expect(b.uos[0].rows[0].notes).toEqual([]);
  });

  it("saved (file v4), read back, and in the Recipes sheet as Shared preparation", () => {
    const p = project(true);
    const text = serializeProject(p);
    expect(JSON.parse(text).version).toBe(4);
    expect(parseProject(text).project.materials[2].recipe?.shared).toBe(true);
    expect(JSON.parse(serializeProject(project(false))).version).toBe(2);
    const rows = [RECIPE_EXPORT_HEADER, ...recipeRows(p.materials)].map((r) => r.map((c) => (c == null ? "" : String(c))));
    expect(rows[1].at(-1)).toBe("Yes");
    const bare = p.materials.map((m) => { const x = { ...m }; delete x.recipe; return x; });
    const plan = planRefsImport(rows, null, bare);
    expect(plan.errors).toEqual([]);
    expect(applyRefsImport(bare, plan)[2].recipe).toEqual(p.materials[2].recipe);
    // Korean header and value.
    const ko = planRefsImport([["제조품코드", "기준량", "원료코드", "수량", "공유조제"], ["BUF-PKE", "100", "CHM-NACL", "1", "예"]], null, bare);
    expect(ko.recipes[0].shared).toBe(true);
  });
});
