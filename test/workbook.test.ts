import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readTable, readWorkbook, writeWorkbook } from "../src/xlsx/workbook";

const fixture = (f: string) => new Uint8Array(readFileSync(join(__dirname, "fixtures/xlsx", f)));

describe("ExcelJS reading (Phase 0 workbooks)", () => {
  it("GridCraft-saved file: cached formula results, Korean sheet name", async () => {
    const wb = await readWorkbook(fixture("MB_sample_gridcraft.xlsx"));
    expect(wb.sheetNames).toEqual(["MB_계산", "PCS_LINK"]);
    const g = wb.sheet("PCS_LINK")!;
    expect(g.cell(0, 0)).toMatchObject({ kind: "text", value: "StreamID" });
    expect(g.cell(1, 3)).toMatchObject({ kind: "number", value: 85, formula: "=MB_계산!C12" });
    expect(g.cell(2, 4)).toMatchObject({ kind: "number", value: 7.4375 });
    expect(g.cell(5, 5).value).toBe("N-1 → 100L 이송");
    expect(g.cell(1, 1).kind).toBe("empty");
  });

  it("formula without a cached result is nocache, never 0", async () => {
    const g = (await readWorkbook(fixture("MB_sample_raw.xlsx"))).sheet("PCS_LINK")!;
    expect(g.cell(1, 3)).toEqual({ kind: "nocache", value: null, formula: "='MB_계산'!C12" });
  });

  it("rich text from LibreOffice reads as a plain string", async () => {
    const g = (await readWorkbook(fixture("MB_sample_libreoffice.xlsx"))).sheet("PCS_LINK")!;
    expect(g.cell(1, 5)).toEqual({ kind: "text", value: "Basal 배지 공급" });
  });

  it("write and read back", async () => {
    const blob = await writeWorkbook([{ name: "Materials", header: ["Code", "Name", "Unit"], rows: [["A", "가나다", "kg"], ["B", undefined, "L"]] }]);
    const table = await readTable(new Uint8Array(await blob.arrayBuffer()));
    expect(table).toEqual([["Code", "Name", "Unit"], ["A", "가나다", "kg"], ["B", "", "L"]]);
  });
});

describe("examples/materials-import-example.xlsx", () => {
  it("against the 18 sample materials: 3 new, 1 updated, 1 unchanged, 1 rejected", async () => {
    const { planMaterialImport } = await import("../src/model/materials");
    const { sampleMaterials } = await import("../src/model/sampleData");
    const table = await readTable(new Uint8Array(readFileSync(join(__dirname, "../examples/materials-import-example.xlsx"))));
    const plan = planMaterialImport(table, sampleMaterials());
    expect([plan.add.length, plan.update.length, plan.unchanged.length, plan.errors.length]).toEqual([3, 1, 1, 1]);
  });
});
