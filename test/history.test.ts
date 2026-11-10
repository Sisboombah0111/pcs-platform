import { describe, expect, it } from "vitest";
import { createProject, parseProject, serializeProject } from "../src/model/project";
import { addLog, changedKeys, describeChange, describeUos, emptyHistory, logLine, record, redo, undo, updateLog } from "../src/model/history";
import type { Project } from "../src/model/types";

const base = (): Project => {
  const p = createProject("H");
  p.materials = [{ id: "m1", code: "A-1", name: "Alpha", unit: "kg" }];
  p.uos = [{ id: "u1", code: "PROA", name: "Protein A", order: 1 }];
  return p;
};
const rename = (p: Project, name: string): Project => ({ ...p, materials: p.materials.map((m) => ({ ...m, name })) });

describe("undo and redo", () => {
  it("records changes, merges a continued edit, undoes and redoes", () => {
    const p0 = base();
    const p1 = rename(p0, "Alph");
    let r = record(emptyHistory(), p0, p1, "Materials", 1000)!;
    expect(r.merged).toBe(false);
    const p2 = rename(p1, "Alpha 2");
    r = record(r.history, p1, p2, "Materials", 2000)!;
    expect(r.merged).toBe(true);
    expect(r.history.past).toHaveLength(1);
    // Much later: a new step.
    const p3 = rename(p2, "Alpha 3");
    r = record(r.history, p2, p3, "Materials", 9000)!;
    expect(r.history.past).toHaveLength(2);
    const u = undo(r.history, p3)!;
    if ("error" in u) throw new Error(u.error);
    expect(u.patch.materials![0].name).toBe("Alpha 2");
    const p4 = { ...p3, ...u.patch };
    const u2 = undo(u.history, p4)!;
    if ("error" in u2) throw new Error(u2.error);
    expect(u2.patch.materials![0].name).toBe("Alpha");
    const p5 = { ...p4, ...u2.patch };
    const rd = redo(u2.history, p5)!;
    if ("error" in rd) throw new Error(rd.error);
    expect(rd.patch.materials![0].name).toBe("Alpha 2");
  });

  it("refuses to undo when the same data changed since; ignores view settings", () => {
    const p0 = base();
    const p1 = rename(p0, "B");
    const r = record(emptyHistory(), p0, p1, "Materials", 0)!;
    const elsewhere = rename(p1, "C"); // changed without being recorded
    const u = undo(r.history, elsewhere)!;
    expect("error" in u && u.error).toMatch(/cannot be undone/);
    expect(changedKeys(p0, { ...p0, mb: { ...p0.mb, activeScenario: "receiving" } })).toEqual([]);
    expect(record(emptyHistory(), p0, { ...p0, meta: { ...p0.meta, name: "x" } }, "x", 0)).toBeNull();
  });
});

describe("change log", () => {
  it("says what changed", () => {
    const p0 = base();
    const p1: Project = {
      ...p0,
      materials: [{ ...p0.materials[0], code: "A-2", status: "obsolete" }, { id: "m2", code: "B-1", name: "Beta", unit: "L" }],
      operations: { u1: [{ id: "s", name: "Load", actions: [] }] },
      equipment: [{ id: "e", tag: "XV-1", type: "valve" }],
    };
    const lines = describeChange(p0, p1, (id) => (id === "u1" ? "PROA" : "?"));
    expect(lines).toEqual(["Materials added: B-1 “Beta”", "Material A-2: code A-1 → A-2; status In use → Obsolete", "Equipment added: XV-1", "Steps of PROA: 0 → 1"]);
    expect(describeUos(p0.uos, [...p0.uos, { id: "u2", code: "CEX", name: "Cation exchange", order: 2 }])).toEqual(["Unit operation added: CEX Cation exchange"]);
    let log = addLog([], logLine("Materials", ["a"], "Kim", "2026-11-04T00:00:00Z"));
    log = addLog(log, logLine("BOM", ["b"], undefined, "2026-11-04T00:01:00Z"));
    log = updateLog(log, log[1].id, ["a2"], "2026-11-04T00:02:00Z");
    expect(log.map((l) => l.what[0])).toEqual(["a2", "b"]);
    // Saved with the project.
    const q = { ...p0, changeLog: log };
    expect(parseProject(serializeProject(q)).project.changeLog).toEqual(log);
  });
});
