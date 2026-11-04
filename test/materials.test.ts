import { describe, expect, it } from "vitest";
import { applyImport, parseCsv, planMaterialImport } from "../src/model/materials";
import type { Material } from "../src/model/types";

const existing: Material[] = [
  { id: "m1", code: "MAT-0001", name: "Basal Medium", unit: "kg" },
  { id: "m2", code: "MAT-0002", name: "Glucose", unit: "kg", category: "Media" },
];

describe("material import", () => {
  it("Korean or English headers; new, updated, unchanged and rejected rows", () => {
    const table = [
      ["자재코드", "자재명", "단위", "분류"],
      ["MAT-0001", "Basal Medium", "kg", ""],
      ["MAT-0002", "Glucose anhydrous", "kg", "Media"],
      ["MAT-0003", "Depth Filter", "EA", "Filter"],
      ["", "코드 없음", "kg", ""],
      ["MAT-0004", "단위 없음", "", ""],
      ["MAT-0003", "중복", "EA", ""],
      ["", "", "", ""],
    ];
    const plan = planMaterialImport(table, existing);
    expect(plan.add.map((r) => r.code)).toEqual(["MAT-0003"]);
    expect(plan.update.map((u) => u.row.code)).toEqual(["MAT-0002"]);
    expect(plan.unchanged.map((r) => r.code)).toEqual(["MAT-0001"]);
    expect(plan.errors.map((e) => e.row)).toEqual([5, 6, 7]);
    const next = applyImport(existing, plan);
    expect(next).toHaveLength(3);
    expect(next.find((m) => m.code === "MAT-0002")?.name).toBe("Glucose anhydrous");
    expect(next.find((m) => m.code === "MAT-0003")).toMatchObject({ unit: "EA", category: "Filter" });
  });

  it("does nothing without the required headers", () => {
    const plan = planMaterialImport([["Code", "Name"], ["A", "a"]], []);
    expect(plan.errors[0].message).toMatch(/no Unit header/);
    expect(plan.add).toEqual([]);
  });
});

describe("CSV", () => {
  it("quotes, commas, line breaks, BOM, tab separated", () => {
    expect(parseCsv('﻿Code,Name,Unit\r\nA,"Buffer, pH 7.4",L\nB,"say ""hi""",kg\n')).toEqual([
      ["Code", "Name", "Unit"], ["A", "Buffer, pH 7.4", "L"], ["B", 'say "hi"', "kg"],
    ]);
    expect(parseCsv("Code\tName\tUnit\nA\tx\tkg")).toEqual([["Code", "Name", "Unit"], ["A", "x", "kg"]]);
  });
});

describe("material overage", () => {
  it("imports 'Overage %' (or 여유율) as a percent number; rejects text and negatives", () => {
    const plan = planMaterialImport([
      ["Code", "Name", "Unit", "Overage %"],
      ["MAT-0001", "Basal Medium", "kg", "10"],
      ["MAT-0003", "Depth Filter", "EA", "5%"],
      ["MAT-0004", "Bad", "kg", "lots"],
      ["MAT-0005", "Negative", "kg", "-1"],
    ], existing);
    expect(plan.update.map((u) => u.changes)).toEqual([["overage 0 → 10 %"]]);
    expect(plan.add.map((r) => [r.code, r.overagePct])).toEqual([["MAT-0003", 5]]);
    expect(plan.errors.map((e) => e.row)).toEqual([4, 5]);
    const next = applyImport(existing, plan);
    expect(next.find((m) => m.code === "MAT-0001")?.overagePct).toBe(10);
    expect(planMaterialImport([["자재코드", "자재명", "단위", "여유율"], ["A", "a", "kg", "3"]], []).add[0].overagePct).toBe(3);
  });
});
