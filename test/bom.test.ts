import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { addManualLine, computeBom, defaultSource, isCountUnit, removeLine, setLine, withOverage, type BomResult } from "../src/bom/model";
import { checkLinkSheet, toSnapshot } from "../src/mb/pcsLink";
import { createProject, DEFAULT_SCENARIOS, parseProject, serializeProject } from "../src/model/project";
import { sampleMaterials } from "../src/model/sampleData";
import type { Project } from "../src/model/types";
import type { BoardElement } from "../src/pfd/sync";
import { readWorkbook } from "../src/xlsx/workbook";

/** The example process: 10L seed and 100L fed-batch, MB_example.xlsx applied, bags linked on the PFD. */
async function example(): Promise<Project> {
  const p = createProject("Example process");
  p.materials = sampleMaterials();
  const id = (code: string) => p.materials.find((m) => m.code === code)!.id;
  p.uos = [{ id: "u10", code: "10L", name: "10L Seed bioreactor", order: 1 }, { id: "u100", code: "100L", name: "100L Bioreactor", order: 2 }];
  p.streams.active = {
    "ST-10L-001": { kind: "pfd", elementId: "a1", uoId: "u10" },
    "ST-10L-100L": { kind: "transfer", elementId: "a2", fromUoId: "u10", toUoId: "u100" },
    "ST-100L-001": { kind: "pfd", elementId: "a3", uoId: "u100" },
    "ST-100L-002": { kind: "pfd", elementId: "a4", uoId: "u100" },
  };
  const frame = (fid: string, uoId: string): BoardElement => ({ id: fid, type: "frame", x: 0, y: 0, width: 600, height: 400, customData: { pcs: { kind: "uo", uoId } } });
  const box = (bid: string, uoId: string, x: number): BoardElement => ({ id: bid, type: "rectangle", x, y: 80, width: 220, height: 110, customData: { pcs: { kind: "uo", uoId } } });
  const shape = (sid: string, frameId: string, links: [string, number][]): BoardElement =>
    ({ id: sid, type: "rectangle", x: 0, y: 0, width: 10, height: 10, frameId, customData: { pcs: { symbol: "bag", materials: links.map(([c, qty]) => ({ materialId: id(c), qty })) } } });
  // Process map: a box per UO. Drawings: bags linked in each UO's own drawing (a link on the map does not count).
  p.pfd.map.elements = [box("b10", "u10", 80), box("b100", "u100", 440), { ...shape("note", "", [["MAT-0018", 5]]), frameId: null }];
  p.pfd.sheets = {
    u10: { elements: [frame("f10", "u10"), shape("s1", "f10", [["MAT-0017", 1]])], files: {} },
    u100: { elements: [frame("f100", "u100"), shape("s2", "f100", [["MAT-0018", 1]]), shape("s3", "f100", [["MAT-0017", 1]])], files: {} },
  };
  const wb = await readWorkbook(new Uint8Array(readFileSync(join(__dirname, "../examples/MB_example.xlsx"))));
  const res = checkLinkSheet(wb, { scenarios: DEFAULT_SCENARIOS, streamIds: Object.keys(p.streams.active), materials: p.materials });
  expect(res.ok).toBe(true);
  p.mb.current = toSnapshot(res, { id: "mb1", source: "file", importedAt: "2026-10-30T00:00:00Z" });
  return p;
}
const code = (p: Project, c: string) => p.materials.find((m) => m.code === c)!.id;
const rowsOf = (b: BomResult, uo: string) => Object.fromEntries(b.uos.find((u) => u.uo.code === uo)!.rows.map((r) => [r.material.code, [r.line.qtySource, r.qty.sending, r.qty.receiving]]));
const totalsOf = (b: BomResult) => Object.fromEntries(b.totals.map((t) => [t.material.code, [t.qty.sending, t.qty.receiving]]));

describe("BOM from the example (hand calculation)", () => {
  it("MB materials per UO and PFD bag counts, with their default sources", async () => {
    const b = computeBom(await example());
    // 10L: seed medium 9 L × 17.5 g/L = 0.1575 kg (Receiving 45 L → 0.7875 kg); one 50 L bag.
    expect(rowsOf(b, "10L")).toEqual({ "MAT-0001": ["MB", 0.1575, 0.7875], "MAT-0017": ["PFD", 1, 1] });
    // 100L: basal 85 L × 17.5 g/L = 1.4875 kg; feed 5 L × 124 g/L = 0.62 kg; one bag of each size.
    expect(rowsOf(b, "100L")).toEqual({ "MAT-0001": ["MB", 1.4875, 7.4375], "MAT-0002": ["MB", 0.62, 3.1], "MAT-0017": ["PFD", 1, 1], "MAT-0018": ["PFD", 1, 1] });
    expect(totalsOf(b)).toEqual({ "MAT-0001": [1.645, 8.225], "MAT-0002": [0.62, 3.1], "MAT-0017": [2, 2], "MAT-0018": [1, 1] });
    expect(b.issueCount).toBe(0);
    expect(b.totals.find((t) => t.material.code === "MAT-0017")!.uos).toEqual(["10L", "100L"]);
  });

  it("overage: the material's default, a line's own value, and back to the default", async () => {
    let p = await example();
    p.materials = p.materials.map((m) => (m.code === "MAT-0001" ? { ...m, overagePct: 10 } : m));
    let b = computeBom(p);
    expect(rowsOf(b, "100L")["MAT-0001"]).toEqual(["MB", 1.63625, 8.18125]);
    expect(totalsOf(b)["MAT-0001"]).toEqual([1.8095, 9.0475]);
    const feed = b.uos[1].rows.find((r) => r.material.code === "MAT-0002")!;
    p = setLine(p, feed, { overagePct: 5 });
    b = computeBom(p);
    expect(rowsOf(b, "100L")["MAT-0002"]).toEqual(["MB", 0.651, 3.255]);
    p = setLine(p, b.uos[1].rows.find((r) => r.material.code === "MAT-0002")!, { overagePct: undefined });
    expect(rowsOf(computeBom(p), "100L")["MAT-0002"]).toEqual(["MB", 0.62, 3.1]);
  });

  it("a manual line needs both quantities and a reason", async () => {
    const ex = await example();
    let p = addManualLine(ex, "u100", code(ex, "MAT-0012"));
    const wfi = () => computeBom(p).uos[1].rows.find((r) => r.material.code === "MAT-0012")!;
    expect(wfi().issues).toEqual(["Enter Sending and Receiving.", "Give a reason for the manual quantity."]);
    p = setLine(p, wfi(), { manualQty: { sending: 50, receiving: 250 }, note: "Line flush before inoculation" });
    expect([wfi().qty.sending, wfi().qty.receiving, wfi().issues]).toEqual([50, 250, []]);
    expect(wfi().manualOnly).toBe(true);
    p = removeLine(p, "u100", wfi().material.id);
    expect(computeBom(p).uos[1].rows.some((r) => r.material.code === "MAT-0012")).toBe(false);
  });

  it("one source per line: switching to manual leaves the MB value out and says so", async () => {
    let p = await example();
    const basal = computeBom(p).uos[1].rows.find((r) => r.material.code === "MAT-0001")!;
    p = setLine(p, basal, { qtySource: "manual" });
    const row = computeBom(p).uos[1].rows.find((r) => r.material.code === "MAT-0001")!;
    expect(row.qty).toEqual({ sending: null, receiving: null });
    expect(row.notes[0]).toMatch(/mass balance also has it \(Sending 1\.4875, Receiving 7\.4375\)/);
    expect(computeBom(p).totals.find((t) => t.material.code === "MAT-0001")!.incomplete).toEqual({ sending: true, receiving: true });
    p = removeLine(p, "u100", basal.material.id); // back to the default: MB
    expect(rowsOf(computeBom(p), "100L")["MAT-0001"]).toEqual(["MB", 1.4875, 7.4375]);
  });

  it("a line marked not counted stays listed but leaves the totals", async () => {
    let p = await example();
    p = setLine(p, computeBom(p).uos[1].rows.find((r) => r.material.code === "MAT-0017")!, { excluded: true });
    const b = computeBom(p);
    expect(rowsOf(b, "100L")["MAT-0017"]).toEqual(["PFD", null, null]);
    expect(totalsOf(b)["MAT-0017"]).toEqual([1, 1]);
  });

  it("PFD counts are pieces: a kg material linked on the PFD defaults to manual", async () => {
    const p = await example();
    p.pfd.sheets.u100.elements = [...p.pfd.sheets.u100.elements, { id: "s9", type: "rectangle", x: 0, y: 0, width: 1, height: 1, frameId: "f100", customData: { pcs: { materials: [{ materialId: code(p, "MAT-0004"), qty: 3 }] } } }];
    const g = computeBom(p).uos[1].rows.find((r) => r.material.code === "MAT-0004")!;
    expect(g.line.qtySource).toBe("manual");
    expect(g.notes[0]).toMatch(/Also linked on the PFD \(3\)/);
    expect([defaultSource(null, 3, "EA"), defaultSource(null, 3, "kg"), defaultSource({ sending: 1 }, 3, "EA")]).toEqual(["PFD", "manual", "MB"]);
    expect([isCountUnit("EA"), isCountUnit("pcs"), isCountUnit("kg"), isCountUnit("L")]).toEqual([true, true, false, false]);
  });

  it("a project file v1 converts with the same BOM (and the saved example in the new format matches it)", async () => {
    const wb = await readWorkbook(new Uint8Array(readFileSync(join(__dirname, "../examples/MB_example.xlsx"))));
    const bomOf = (file: string) => {
      const p = parseProject(readFileSync(join(__dirname, file), "utf8")).project;
      const res = checkLinkSheet(wb, { scenarios: DEFAULT_SCENARIOS, streamIds: Object.keys(p.streams.active), materials: p.materials });
      p.mb.current = toSnapshot(res, { id: "mb1", source: "file", importedAt: "2026-10-30T00:00:00Z" });
      const b = computeBom(p);
      return { rows: Object.fromEntries(b.uos.map((u) => [u.uo.code, rowsOf(b, u.uo.code)])), totals: totalsOf(b), onMap: b.uos.map((u) => u.onMap) };
    };
    const v1 = bomOf("fixtures/example-v1.pcs.json");
    expect(v1.rows).toEqual({
      "10L": { "MAT-0001": ["MB", 0.1575, 0.7875], "MAT-0017": ["PFD", 1, 1] },
      "100L": { "MAT-0001": ["MB", 1.4875, 7.4375], "MAT-0002": ["MB", 0.62, 3.1], "MAT-0017": ["PFD", 1, 1], "MAT-0018": ["PFD", 1, 1] },
    });
    expect(v1.onMap).toEqual([true, true]);
    expect(bomOf("../examples/example-process.pcs.json")).toEqual(v1);
  });

  it("a UO taken off the process map is flagged; its drawing's links still count", async () => {
    const p = await example();
    p.pfd.map.elements = p.pfd.map.elements.filter((e) => (e as BoardElement).id !== "b10");
    const b = computeBom(p);
    expect(b.uos.map((u) => [u.uo.code, u.onMap])).toEqual([["10L", false], ["100L", true]]);
    expect(rowsOf(b, "10L")["MAT-0017"]).toEqual(["PFD", 1, 1]);
  });

  it("MB rows for a material not in the list are reported, not dropped silently", async () => {
    const p = await example();
    p.materials = p.materials.filter((m) => m.code !== "MAT-0002");
    const b = computeBom(p);
    expect(b.orphans).toEqual(["MAT-0002 in 100L (from ST-100L-002): material not in the list"]);
    expect(b.issueCount).toBe(1);
  });

  it("stored lines survive the project file; bad values are cleaned up", async () => {
    let p = await example();
    p = setLine(p, computeBom(p).uos[1].rows[0], { overagePct: 2.5, note: "spare", excluded: true });
    const back = parseProject(serializeProject(p)).project;
    expect(back.bom).toEqual(p.bom);
    const raw = JSON.parse(serializeProject(p));
    raw.bom.lines.u100.push({ materialId: 7 }, { materialId: "m", qtySource: "X", manualQty: { sending: "a" }, overagePct: "x" });
    const fixed = parseProject(JSON.stringify(raw)).project.bom.lines.u100;
    expect(fixed[fixed.length - 1]).toEqual({ materialId: "m", qtySource: "manual", manualQty: { sending: null } });
    expect(withOverage(1.4875, 10)).toBe(1.63625);
  });
});
