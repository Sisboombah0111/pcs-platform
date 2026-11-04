import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { computeBom } from "../src/bom/model";
import { appliedRows, findingCount, linkCheck, workbookNotApplied } from "../src/link/check";
import { linkContext, valueLines } from "../src/mb/model";
import { checkLinkSheet, toSnapshot } from "../src/mb/pcsLink";
import { parseProject } from "../src/model/project";
import type { Project } from "../src/model/types";
import { readWorkbook, type WorkbookData } from "../src/xlsx/workbook";

let wb: WorkbookData;
beforeAll(async () => { wb = await readWorkbook(new Uint8Array(readFileSync(join(__dirname, "../examples/MB_example.xlsx")))); });

/** The example project with MB_example.xlsx applied (the workbook kept with the project). */
function example(): Project {
  const p = parseProject(readFileSync(join(__dirname, "../examples/example-process.pcs.json"), "utf8")).project;
  const res = checkLinkSheet(wb, linkContext(p));
  expect(res.ok).toBe(true);
  p.mb.current = toSnapshot(res, { id: "mb1", source: "file", importedAt: "2026-10-30T00:00:00Z", sha256: "abc" });
  p.mb.workbook = { name: "MB_example.xlsx", dataBase64: "", sha256: "abc", source: "file", updatedAt: "2026-10-30T00:00:00Z" };
  return p;
}
const retire = (p: Project, id: string) => {
  const o = p.streams.active[id];
  delete p.streams.active[id];
  p.streams.retired.push({ ...o, streamId: id, retiredAt: "2026-10-30T01:00:00Z" });
};
const lines = (p: Project) => Object.fromEntries(computeBom(p).uos.map((u) => [u.uo.code, Object.fromEntries(u.rows.map((r) => [r.material.code, [r.line.qtySource, r.qty.sending, r.qty.receiving]]))]));
const row = (p: Project, uo: string, code: string) => computeBom(p).uos.find((u) => u.uo.code === uo)!.rows.find((r) => r.material.code === code)!;

describe("link check: the BOM follows the current PFD and material list", () => {
  it("everything lines up after applying the example", () => {
    const p = example();
    expect(appliedRows(p).every((r) => r.status === "ok")).toBe(true);
    expect(findingCount(linkCheck(p))).toBe(0);
    expect(computeBom(p).issueCount).toBe(0);
  });

  it("a stream deleted on the PFD after applying: its MB values leave the BOM, with the reason; drawn back, they count again", () => {
    const p = example();
    retire(p, "ST-100L-002");
    expect(lines(p)["100L"]["MAT-0002"]).toEqual(["MB", null, null]);
    const r = row(p, "100L", "MAT-0002");
    expect(r.issues).toEqual(["MAT-0002 from ST-100L-002 (Sending 0.62 · Receiving 3.1 kg) is not counted: ST-100L-002 is no longer on the PFD."]);
    expect(computeBom(p).totals.find((t) => t.material.code === "MAT-0002")!.incomplete).toMatchObject({ sending: true, receiving: true });
    const f = linkCheck(p).find((x) => x.id === "stream-gone")!;
    expect(f.items.map((i) => i.text)).toEqual(["ST-100L-002 (100L): flow Sending 5 · Receiving 25 L; MAT-0002 Sending 0.62 · Receiving 3.1 kg"]);
    expect(findingCount(linkCheck(p))).toBe(1);
    // Undo on the PFD brings the ID back: the values count again.
    const back = p.streams.retired.pop()!;
    p.streams.active["ST-100L-002"] = { kind: back.kind, elementId: back.elementId, uoId: back.uoId };
    expect(lines(p)["100L"]["MAT-0002"]).toEqual(["MB", 0.62, 3.1]);
  });

  it("a transfer redrawn to another unit gets a new ID: the old ID's material rows leave the BOM", () => {
    const p = example();
    // Give the transfer a material row (counts toward its destination), then redraw it to a new UO.
    p.mb.current!.rows.push({ streamId: "ST-10L-100L", matCode: "MAT-0001", unit: "kg", values: { sending: 0.2, receiving: 1 } });
    expect(lines(p)["100L"]["MAT-0001"]).toEqual(["MB", 1.6875, 8.4375]);
    const o = p.streams.active["ST-10L-100L"];
    retire(p, "ST-10L-100L");
    p.uos.push({ id: "uh", code: "HARV", name: "Harvest", order: 3 });
    p.streams.active["ST-10L-HARV"] = { ...o, toUoId: "uh" };
    expect(lines(p)["100L"]["MAT-0001"]).toEqual(["MB", 1.4875, 7.4375]);
    expect(row(p, "100L", "MAT-0001").issues.join()).toMatch(/ST-10L-100L is no longer on the PFD/);
  });

  it("a material counted in another unit now: its MB rows are left out and the line says why", () => {
    const p = example();
    p.materials = p.materials.map((m) => (m.code === "MAT-0001" ? { ...m, unit: "g" } : m));
    expect(lines(p)["100L"]["MAT-0001"]).toEqual(["MB", null, null]);
    expect(row(p, "100L", "MAT-0001").issues.join()).toMatch(/the MB gives kg, but MAT-0001 is counted in g/);
    expect(linkCheck(p).find((f) => f.id === "unit-mismatch")!.items.length).toBe(2);
  });

  it("a material code changed in the list: reported, not counted", () => {
    const p = example();
    p.materials = p.materials.map((m) => (m.code === "MAT-0002" ? { ...m, code: "MAT-0102" } : m));
    expect(computeBom(p).orphans).toEqual(["MAT-0002 in 100L (from ST-100L-002): material not in the list"]);
    expect(linkCheck(p).some((f) => f.id === "unknown-material")).toBe(true);
  });

  it("a unit operation deleted: its streams are gone, its MB values are reported", () => {
    const p = example();
    const u = p.uos.find((x) => x.code === "100L")!;
    p.uos = p.uos.filter((x) => x !== u);
    for (const [id, o] of Object.entries(p.streams.active)) if (o.uoId === u.id || o.toUoId === u.id) retire(p, id);
    const b = computeBom(p);
    expect(b.uos.map((x) => x.uo.code)).toEqual(["10L"]);
    expect(b.orphans.length).toBe(2);
    expect(b.orphans[0]).toMatch(/is no longer on the PFD/);
  });

  it("a new stream on the PFD without an MB value is listed; labels show the ID only", () => {
    const p = example();
    p.streams.active["ST-100L-003"] = { kind: "pfd", elementId: "new", uoId: p.uos[1].id };
    expect(linkCheck(p).find((f) => f.id === "no-flow")!.items.map((i) => i.streamId)).toEqual(["ST-100L-003"]);
    expect(valueLines(p)("ST-100L-003")).toBeUndefined();
    expect(findingCount(linkCheck(p))).toBe(0); // information, not a problem
  });

  it("a workbook saved after applying is flagged until it is applied", () => {
    const p = example();
    expect(workbookNotApplied(p)).toBe(false);
    p.mb.workbook = { ...p.mb.workbook!, sha256: "def", source: "gridcraft" };
    expect(workbookNotApplied(p)).toBe(true);
    expect(linkCheck(p)[0]).toMatchObject({ id: "not-applied", level: "warn", area: "mb" });
  });

  it("a PFD link added after applying, for a material the MB already has there: noted", () => {
    const p = example();
    const sheet = p.pfd.sheets[p.uos[1].id];
    const id = p.materials.find((m) => m.code === "MAT-0002")!.id;
    sheet.elements = [...sheet.elements, { id: "x", type: "rectangle", x: 0, y: 0, width: 1, height: 1, customData: { pcs: { materials: [{ materialId: id, qty: 2 }] } } }];
    expect(linkCheck(p).find((f) => f.id === "double")!.items).toEqual([{ text: "MAT-0002 in 100L" }]);
    expect(lines(p)["100L"]["MAT-0002"]).toEqual(["MB", 0.62, 3.1]);
  });
});
