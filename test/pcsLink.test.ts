import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkLinkSheet, colLetter, type LinkContext, type LinkResult } from "../src/mb/pcsLink";
import { diffRows, flowValues, fmtQty, materialTotals, valueLine } from "../src/mb/model";
import { DEFAULT_SCENARIOS } from "../src/model/project";
import { readWorkbook } from "../src/xlsx/workbook";
import type { MbSnapshot } from "../src/model/types";

const fixture = (f: string) => new Uint8Array(readFileSync(join(__dirname, "fixtures/xlsx", f)));
// Phase 0 samples use the v66 material codes.
const materials = [
  { code: "K3CD002", unit: "kg", name: "Basal Medium" },
  { code: "K6FG005", unit: "kg", name: "Feed Medium FM1" },
];
const ctx: LinkContext = { scenarios: DEFAULT_SCENARIOS, materials };
const check = async (f: string, extra: Partial<LinkContext> = {}) => checkLinkSheet(await readWorkbook(fixture(f)), { ...ctx, ...extra });
const rules = (r: LinkResult) => r.issues.filter((i) => i.level === "error").map((i) => i.rule);
const count = (a: string[], x: string) => a.filter((y) => y === x).length;
const snap = (r: LinkResult, id = "s1"): MbSnapshot => ({
  id, source: "file", importedAt: "2026-10-30T00:00:00Z", scenarios: r.scenarios,
  rows: r.rows.map((x) => ({ streamId: x.streamId, matCode: x.matCode, unit: x.unit, values: x.values })),
});

describe("PCS_LINK check (Phase 0 workbooks)", () => {
  it("GridCraft and LibreOffice saves read clean with the same numbers", async () => {
    for (const f of ["MB_sample_gridcraft.xlsx", "MB_sample_libreoffice.xlsx"]) {
      const r = await check(f);
      expect(r.summary).toMatchObject({ errors: 0, warnings: 0, rows: 5, flowRows: 3, materialRows: 2, streams: 3 });
      const flows = Object.fromEntries([...flowValues(snap(r))].map(([id, v]) => [id, [v.values.sending, v.values.receiving]]));
      expect(flows).toEqual({ "ST-100L-001": [85, 425], "ST-100L-002": [5, 25], "ST-10L-100L": [10, 50] });
      expect(r.rows[4].note).toBe("N-1 → 100L 이송");
      expect(r.rows[0].formulas.sending).toMatch(/MB_계산'?!C12$/);
    }
  });

  it("materials total per UO; a transfer's materials count at its destination", async () => {
    const r = await check("MB_sample_gridcraft.xlsx");
    const totals = materialTotals(snap(r), (id) => (id.startsWith("ST-100L-") ? "100L" : null));
    expect(totals.map((t) => [t.uo, t.matCode, t.values.sending, t.values.receiving])).toEqual([
      ["100L", "K3CD002", 1.4875, 7.4375], ["100L", "K6FG005", 0.62, 3.1],
    ]);
  });

  it("a formula never calculated is a V5 error, never a silent 0", async () => {
    const r = await check("MB_sample_raw.xlsx");
    expect(count(rules(r), "V5")).toBe(10);
    expect(rules(r)).toHaveLength(10);
    expect(r.rows.every((x) => x.values.sending === null)).toBe(true);
    expect(r.issues[0].message).toMatch(/no saved result/);
  });

  it("deliberate mistakes: V4, V7, V5 ×2, V1 ×2", async () => {
    const r = await check("MB_sample_errors_gridcraft.xlsx");
    const e = rules(r);
    expect([count(e, "V4"), count(e, "V7"), count(e, "V5"), count(e, "V1")]).toEqual([1, 1, 2, 2]);
    expect(r.ok).toBe(false);
    const v7 = r.issues.find((i) => i.rule === "V7")!;
    expect(`${v7.col}${v7.row}`).toBe("C4");
  });

  it("against the PFD: V2 for an unknown stream, V3 for a stream without a flow row", async () => {
    const r = await check("MB_sample_gridcraft.xlsx", { streamIds: ["ST-100L-001", "ST-100L-002", "ST-100L-003"] });
    expect(r.issues.filter((i) => i.rule === "V2").map((i) => i.streamId)).toEqual(["ST-10L-100L"]);
    expect(r.issues.filter((i) => i.rule === "V3").map((i) => i.streamId)).toEqual(["ST-100L-003"]);
  });

  it("V6 unknown material code", async () => {
    const r = await check("MB_sample_gridcraft.xlsx", { materials: materials.slice(0, 1) });
    expect(r.issues.filter((i) => i.rule === "V6").map((i) => i.message)).toEqual(["MatCode K6FG005 is not in the material list."]);
  });

  it("V8: the same UO and material linked on the PFD is double counting", async () => {
    const r = await check("MB_sample_gridcraft.xlsx", {
      uoOfStream: () => "100L",
      pfdLinks: new Map([["100L", new Map([["K6FG005", 2]])]]),
    });
    expect(r.issues.filter((i) => i.rule === "V8")).toHaveLength(1);
    expect(r.ok).toBe(false);
  });

  it("a renamed sheet is V1 with a hint", async () => {
    const r = await check("MB_sample_misnamed.xlsx");
    expect(rules(r)).toEqual(["V1"]);
    expect(r.issues[0].message).toMatch(/PCS-LINK/);
  });

  it("change preview against the applied snapshot", async () => {
    const before = snap(await check("MB_sample_gridcraft.xlsx"));
    const after = await check("MB_edit_gridcraft.xlsx");
    const d = diffRows(before, after.rows, ["sending", "receiving"]);
    expect(d.filter((x) => x.status === "changed").map((x) => [x.streamId, x.matCode, x.before?.receiving, x.after?.receiving])).toEqual([
      ["ST-100L-001", null, 425, 850], ["ST-100L-001", "K3CD002", 7.4375, 14.875], ["ST-100L-002", null, 25, 50],
      ["ST-100L-002", "K6FG005", 3.1, 6.2], ["ST-10L-100L", null, 50, 100],
    ]);
    expect(diffRows(null, after.rows, ["sending"]).every((x) => x.status === "added")).toBe(true);
    const removed = diffRows(before, after.rows.slice(0, 4), ["sending", "receiving"]);
    expect(removed.find((x) => x.status === "removed")?.streamId).toBe("ST-10L-100L");
  });
});

describe("labels and formatting", () => {
  const flow = { unit: "L", values: { sending: 85, receiving: 425.5 } };
  it("value line per label mode", () => {
    expect(valueLine(flow, "id", DEFAULT_SCENARIOS, "sending")).toBeUndefined();
    expect(valueLine(flow, "id+active", DEFAULT_SCENARIOS, "receiving")).toBe("425.5 L");
    expect(valueLine(flow, "id+both", DEFAULT_SCENARIOS, "sending")).toBe("S 85 · R 425.5 L");
    expect(valueLine({ unit: "kg", values: { sending: 1.4875, receiving: null } }, "id+both", DEFAULT_SCENARIOS, "sending")).toBe("S 1.4875 kg");
    expect(valueLine(undefined, "id+both", DEFAULT_SCENARIOS, "sending")).toBeUndefined();
  });
  it("numbers and column letters", () => {
    expect([fmtQty(1234.56789), fmtQty(0.62), fmtQty(null), fmtQty(1e-12)]).toEqual(["1,234.5679", "0.62", "", "0"]);
    expect([colLetter(0), colLetter(25), colLetter(26), colLetter(701)]).toEqual(["A", "Z", "AA", "ZZ"]);
  });
});

describe("examples/ MB workbooks (made by tools/make-mb-examples.py + gridcraft-cli)", () => {
  const ex = (f: string) => new Uint8Array(readFileSync(join(__dirname, "../examples", f)));
  const streamIds = ["ST-10L-001", "ST-10L-100L", "ST-100L-001", "ST-100L-002"];
  const sample = [
    { code: "MAT-0001", unit: "kg", name: "Basal Medium (powder)" },
    { code: "MAT-0002", unit: "kg", name: "Feed Medium A (powder)" },
  ];
  const run = async (f: string) => checkLinkSheet(await readWorkbook(ex(f)), { scenarios: DEFAULT_SCENARIOS, streamIds, materials: sample });

  it("MB_example.xlsx: clean, values for every stream, materials in two UOs", async () => {
    const r = await run("MB_example.xlsx");
    expect(r.summary).toMatchObject({ errors: 0, warnings: 0, flowRows: 4, materialRows: 3 });
    const flows = Object.fromEntries([...flowValues(snap(r))].map(([id, v]) => [id, [v.values.sending, v.values.receiving]]));
    expect(flows).toEqual({ "ST-10L-001": [9, 45], "ST-10L-100L": [10, 50], "ST-100L-001": [85, 425], "ST-100L-002": [5, 25] });
    const totals = materialTotals(snap(r), (id) => (id.startsWith("ST-10L-") ? "10L" : "100L"));
    expect(totals.map((t) => [t.uo, t.matCode, t.values.sending, t.values.receiving])).toEqual([
      ["10L", "MAT-0001", 0.1575, 0.7875], ["100L", "MAT-0001", 1.4875, 7.4375], ["100L", "MAT-0002", 0.62, 3.1],
    ]);
  });

  it("MB_example_v2.xlsx: Receiving working volume 1000 L doubles every Receiving value", async () => {
    const a = snap(await run("MB_example.xlsx"));
    const b = await run("MB_example_v2.xlsx");
    const d = diffRows(a, b.rows, ["sending", "receiving"]);
    expect(d.filter((x) => x.status === "changed")).toHaveLength(7);
    expect(d.every((x) => x.status !== "changed" || (x.after!.receiving === 2 * x.before!.receiving! && x.after!.sending === x.before!.sending))).toBe(true);
  });

  it("MB_example_errors.xlsx: one mistake per row", async () => {
    const r = await run("MB_example_errors.xlsx");
    const e = rules(r);
    expect([count(e, "V1"), count(e, "V2"), count(e, "V4"), count(e, "V5"), count(e, "V6"), count(e, "V7")]).toEqual([1, 1, 1, 2, 1, 1]);
    expect(r.summary.warnings).toBe(0);
  });
});
