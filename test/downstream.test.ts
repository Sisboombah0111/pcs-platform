import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { computeBom, type BomResult } from "../src/bom/model";
import { linkCheck } from "../src/link/check";
import { checkLinkSheet } from "../src/mb/pcsLink";
import { parseProject } from "../src/model/project";
import { readWorkbook } from "../src/xlsx/workbook";

/** examples/example-downstream.pcs.json: HCCF of 2,000 L (Sending) or 15,000 L (Receiving) through PROA … STOR. */
const load = () => parseProject(readFileSync(join(__dirname, "../examples/example-downstream.pcs.json"), "utf8"));
const total = (list: BomResult["totals"], code: string) => {
  const t = list.find((x) => x.material.code === code);
  return t ? [t.qty.sending, t.qty.receiving] : undefined;
};

describe("downstream example (hand calculation)", () => {
  it("opens without notes; PFD, MB, BOM and materials line up", () => {
    const { project, notes } = load();
    expect(notes).toEqual([]);
    expect(project.uos.map((u) => u.code)).toEqual(["PROA", "CEX", "MMC", "VF", "UFDF", "FILL", "STOR"]);
    expect(Object.keys(project.streams.active)).toHaveLength(43);
    expect(linkCheck(project)).toEqual([]);
    const b = computeBom(project);
    expect([b.issueCount, b.leftOutCount, b.orphans]).toEqual([0, 0, []]);
  });

  it("the MB workbook checks clean against the project", async () => {
    const { project } = load();
    const wb = await readWorkbook(new Uint8Array(readFileSync(join(__dirname, "../examples/MB_downstream.xlsx"))));
    const res = checkLinkSheet(wb, { scenarios: project.mb.scenarios, streamIds: Object.keys(project.streams.active), materials: project.materials });
    expect(res.ok).toBe(true);
    expect(res.rows).toHaveLength(70);
    // Formulas that calculate to 0 keep their saved 0 (ExcelJS leaves a 0 result out of cell.value).
    const proa2 = res.rows.filter((r) => r.streamId === "ST-PROA-002" && r.matCode).map((r) => [r.matCode, r.values.sending, r.values.receiving]);
    expect(proa2).toEqual([["BUF-1001-B", 1980, 0], ["BUF-1001-T", 0, 14520]]);
  });

  it("one buffer, two ways of preparing it: 200 L bags (Sending) and 2,000 L tank batches (Receiving), rounded up", () => {
    const b = computeBom(load().project);
    const proa = b.uos.find((u) => u.uo.code === "PROA")!;
    const bag = proa.rows.find((r) => r.material.code === "BUF-1001-B")!;
    const tank = proa.rows.find((r) => r.material.code === "BUF-1001-T")!;
    // 1,980 L in 200 L bags: ⌈9.9⌉ = 10 bags (the filter is part of the bag); 14,520 L in 2,000 L batches: ⌈7.26⌉ = 8 filters.
    expect([bag.batches, tank.batches]).toEqual([{ sending: 10, receiving: 0 }, { sending: 0, receiving: 8 }]);
    expect(total(b.totals, "CON-0004")).toEqual([10, 0]);
    expect(total(b.totals, "FLT-0007")).toEqual([0, 8]);
    // Both are made of BUF-1001, which is made of the chemicals.
    expect(total(b.prepared, "BUF-1001")).toEqual([1980, 14520]);
    expect(b.prepared.find((t) => t.material.code === "BUF-1001-T")!.batches).toEqual({ sending: 0, receiving: 8 });
  });

  it("buffers become chemicals: NaOH and Tris over all unit operations", () => {
    const b = computeBom(load().project);
    // 0.5 M NaOH (20 kg per 1000 L) in PROA, CEX, MMC and UFDF: Sending 540 + 450 + 150 + 150 L, Receiving 3960 + 3600 + 960 + 900 L; + 5 %.
    const naoh = total(b.totals, "CHM-0005")!;
    expect(naoh[0]).toBeCloseTo(1290 * 0.02 * 1.05, 9);
    expect(naoh[1]).toBeCloseTo(9420 * 0.02 * 1.05, 9);
    // Tris (Receiving): BUF-1001 14,520 L × 2.423, BUF-1002 6,600 L × 2.423, BUF-1005 (132 + 144) L × 121.14, BUF-3001 (2,560 + 594) L × 3.029 per 1000 L; + 5 %.
    const tris = (14520 * 2.423 + 6600 * 2.423 + 276 * 121.14 + 3154 * 3.029) / 1000 * 1.05;
    expect(total(b.totals, "CHM-0001")![1]).toBeCloseTo(tris, 9);
    expect(b.prepared.map((t) => t.material.code)).toEqual(["BUF-1001", "BUF-1001-B", "BUF-1001-T", "BUF-1002", "BUF-1003", "BUF-1004", "BUF-1005", "BUF-1006", "BUF-2001", "BUF-2002", "BUF-2003", "BUF-3001", "BUF-5001", "BUF-5002"]);
    expect(total(b.prepared, "BUF-1006")).toEqual([1290, 9420]);
    expect(total(b.totals, "BUF-1001")).toBeUndefined();
  });

  it("consumables from the MB (scale) and from the PFD (count), resins entered by hand, backups apart", () => {
    const b = computeBom(load().project);
    expect(total(b.totals, "CON-0001")).toEqual([34, 252]);
    expect(total(b.totals, "FLT-0001")).toEqual([3, 18]);
    expect(total(b.totals, "FLT-0004")).toEqual([1, 6]);
    expect(total(b.totals, "FLT-0005")).toEqual([3, 18]);
    expect(total(b.totals, "FLT-0002")).toEqual([4, 4]);
    expect(total(b.totals, "LIN-0001")).toEqual([6, 6]);
    expect(total(b.totals, "RES-0001")).toEqual([60, 330]);
    const alt = Object.fromEntries(b.backupTotals.map((t) => [t.material.code, [t.qty.sending, t.qty.receiving]]));
    expect(alt["FLT-0104"]).toEqual([3, 18]);
    expect(alt["RES-0101"]).toEqual([60, 330]);
    expect(alt["CHM-0102"]).toEqual(total(b.totals, "CHM-0002"));
    expect(total(b.totals, "FLT-0104")).toBeUndefined();
  });
});
