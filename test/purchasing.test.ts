import { describe, expect, it } from "vitest";
import { computeBom, packsFor } from "../src/bom/model";
import { MATERIAL_EXPORT_HEADER, applyImport, materialToRow, planMaterialImport } from "../src/model/materials";
import { createProject, parseProject, serializeProject } from "../src/model/project";

describe("purchasing: supplier, part no., pack size", () => {
  it("rounds totals up to whole packs", () => {
    const scen = [{ id: "s" }, { id: "r" }];
    expect(packsFor(25, { s: 60, r: 0 }, scen)).toEqual({ s: 3, r: 0 });
    expect(packsFor(25, { s: 75, r: null }, scen)).toEqual({ s: 3, r: null });
    expect(packsFor(0.1, { s: 0.3, r: 0.30000000000000004 }, scen)).toEqual({ s: 3, r: 3 });
    expect(packsFor(undefined, { s: 1 }, scen)).toBeUndefined();
  });

  it("imports and exports the columns (Korean headers too), and reads them from a file", () => {
    const plan = planMaterialImport([
      ["자재코드", "자재명", "단위", "공급사", "품번", "포장 단위"],
      ["NACL", "Sodium chloride", "kg", "Merck", "1.06404.5000", "25"],
      ["BAD", "x", "kg", "", "", "0"],
    ], []);
    expect(plan.errors.map((e) => e.message)).toEqual(["BAD: Pack size '0' is not a number above 0 (in the material's unit, e.g. 25 for a 25 kg bag)."]);
    const [m] = applyImport([], plan);
    expect([m.supplier, m.partNo, m.packSize]).toEqual(["Merck", "1.06404.5000", 25]);
    expect(MATERIAL_EXPORT_HEADER.slice(-3)).toEqual(["Supplier", "Part no.", "Pack size"]);
    expect(materialToRow(m).slice(-3)).toEqual(["Merck", "1.06404.5000", 25]);
    const again = planMaterialImport([["Code", "Name", "Unit", "Pack size"], ["NACL", "Sodium chloride", "kg", "50"]], [m]);
    expect(again.update[0].changes).toEqual(["pack 25 → 50 kg"]);
    const p = createProject();
    p.materials = [m];
    expect(parseProject(serializeProject(p)).project.materials[0]).toMatchObject({ supplier: "Merck", partNo: "1.06404.5000", packSize: 25 });
  });

  it("puts packs on the BOM totals of materials bought in packs", () => {
    const p = createProject();
    p.materials = [{ id: "m1", code: "NACL", name: "NaCl", unit: "kg", packSize: 25 }, { id: "m2", code: "TRIS", name: "Tris", unit: "kg" }];
    p.uos = [{ id: "u1", code: "PREP", name: "Prep", order: 1 }];
    p.bom.lines.u1 = [
      { materialId: "m1", qtySource: "manual", manualQty: { sending: 60, receiving: 410 }, note: "x" },
      { materialId: "m2", qtySource: "manual", manualQty: { sending: 2, receiving: 9 }, note: "x" },
    ];
    const bom = computeBom(p);
    const nacl = bom.totals.find((t) => t.material.code === "NACL")!;
    expect(nacl.packs).toEqual({ sending: 3, receiving: 17 });
    expect(bom.totals.find((t) => t.material.code === "TRIS")!.packs).toBeUndefined();
  });
});

describe("bulk edit of materials", () => {
  it("sets, clears and keeps fields on the chosen materials only", async () => {
    const { bulkEdit } = await import("../src/model/materials");
    const list = [
      { id: "a", code: "A", name: "a", unit: "kg", category: "Buffer", spec: "USP", status: "obsolete" as const, replacedBy: "b" },
      { id: "b", code: "B", name: "b", unit: "L", category: "Media" },
      { id: "c", code: "C", name: "c", unit: "EA", category: "Filter" },
    ];
    const out = bulkEdit(list, new Set(["a", "b"]), { category: "Chemical", spec: "", supplier: "Merck", overagePct: 5, status: "active" });
    expect(out[0]).toEqual({ id: "a", code: "A", name: "a", unit: "kg", category: "Chemical", supplier: "Merck", overagePct: 5 });
    expect(out[1]).toEqual({ id: "b", code: "B", name: "b", unit: "L", category: "Chemical", supplier: "Merck", overagePct: 5 });
    expect(out[2]).toBe(list[2]);
    expect(bulkEdit(out, new Set(["a"]), { overagePct: 0, packSize: 25 })[0]).toMatchObject({ packSize: 25 });
    expect(bulkEdit(out, new Set(["a"]), { overagePct: 0 })[0].overagePct).toBeUndefined();
  });
});
