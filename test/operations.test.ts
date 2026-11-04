import { describe, expect, it } from "vitest";
import { createProject, parseProject, serializeProject } from "../src/model/project";
import type { Equipment, OpStep, Project } from "../src/model/types";
import {
  actionText, deleteEquipment, moveAction, dropUnitOperations, equipmentShapes, parseState, putAction, setCell, startTimes, tableEquipment,
  templateSteps, timeline, toggleCell, typeForSymbol, typeForTag,
} from "../src/ops/model";
import { applyOperationsImport, operationsSheets, planOperationsImport, type OpsImportPlan } from "../src/ops/xlsx";
import { linkCheck } from "../src/link/check";

const valve: Equipment = { id: "e1", tag: "XV-101", type: "valve" };
const pump: Equipment = { id: "e2", tag: "P-101", type: "pump" };
const bag: Equipment = { id: "e3", tag: "BAG-1", type: "vessel" };
const steps = (n: number): OpStep[] => Array.from({ length: n }, (_, i) => ({ id: `s${i}`, name: `Step ${i + 1}`, actions: [] }));

function project(): Project {
  const p = createProject("Ops");
  p.uos = [{ id: "u1", code: "PROA", name: "Protein A", order: 1 }, { id: "u2", code: "CEX", name: "CEX", order: 2 }];
  p.streams.active = {
    "ST-PROA-001": { kind: "pfd", elementId: "a1", uoId: "u1" },
    "ST-PROA-002": { kind: "pfd", elementId: "a2", uoId: "u1" },
    "ST-PROA-CEX": { kind: "transfer", elementId: "a3", fromUoId: "u1", toUoId: "u2" },
  };
  p.equipment = [{ ...valve, uoId: "u1" }, { ...pump, uoId: "u1" }, { ...bag, uoId: "u1" }];
  return p;
}

describe("operations: states and actions", () => {
  it("valves keep their state from step to step; vessels have events", () => {
    let s = steps(4);
    s = setCell(s, 1, valve, "Open");
    s = setCell(s, 3, valve, "Closed");
    s = putAction(s, 2, { equipmentId: bag.id, state: "Fill to 200 L" });
    expect(timeline(s, valve).map((c) => c.state)).toEqual(["Closed", "Open", "Open", "Closed"]);
    expect(timeline(s, valve).map((c) => !!c.action)).toEqual([false, true, false, true]);
    expect(timeline(s, bag).map((c) => c.state)).toEqual(["", "", "Fill to 200 L", ""]);
    expect(actionText(valve, "Open")).toBe("Open XV-101");
    expect(actionText(valve, "Closed")).toBe("Close XV-101");
    expect(actionText(pump, "On")).toBe("Start P-101");
    expect(actionText(pump, "120 rpm")).toBe("P-101: 120 rpm");
  });

  it("a click switches the state; switching back to the state before removes the action", () => {
    let s = steps(3);
    s = toggleCell(s, 1, pump);
    expect(s[1].actions).toEqual([{ equipmentId: "e2", state: "On" }]);
    expect(timeline(s, pump).map((c) => c.state)).toEqual(["Off", "On", "On"]);
    s = toggleCell(s, 2, pump); // stop in step 3
    expect(timeline(s, pump).map((c) => c.state)).toEqual(["Off", "On", "Off"]);
    s = toggleCell(s, 1, pump); // back to Off in step 2: no action left there
    expect(s[1].actions).toEqual([]);
    // Step 3 still says Off, now a check (same state as before), kept as an action.
    expect(s[2].actions).toEqual([{ equipmentId: "e2", state: "Off" }]);
    expect(timeline(s, pump)[2].changed).toBe(false);
    // An action with a note stays when set to the state it already had.
    s = putAction(steps(1), 0, { equipmentId: "e1", state: "Open", note: "slowly" });
    expect(setCell(s, 0, valve, "Closed")[0].actions).toEqual([{ equipmentId: "e1", state: "Closed", note: "slowly" }]);
  });

  it("moves an action earlier or later in its step (the state table does not change)", () => {
    let s = putAction(putAction(putAction(steps(1), 0, { equipmentId: "e1", state: "Open" }), 0, { equipmentId: "e2", state: "On" }), 0, { equipmentId: "e3", state: "Fill" });
    s = moveAction(s, 0, 2, 0);
    expect(s[0].actions.map((a) => a.equipmentId)).toEqual(["e3", "e1", "e2"]);
    expect(moveAction(s, 0, 0, -1)).toEqual(s);
    expect(timeline(moveAction(s, 0, 1, 2), valve).map((c) => c.state)).toEqual(["Open"]);
  });

  it("reads typed states in English and Korean", () => {
    expect(parseState("valve", "open")).toBe("Open");
    expect(parseState("valve", "닫힘")).toBe("Closed");
    expect(parseState("pump", "가동")).toBe("On");
    expect(parseState("pump", "stop")).toBe("Off");
    expect(parseState("valve", "on")).toBe("on"); // not a valve state: kept as written
    expect(parseState("vessel", " Fill  to 200 L ")).toBe("Fill to 200 L");
  });

  it("guesses types from symbols and tags; times add up", () => {
    expect(typeForSymbol("dvalve")).toBe("valve");
    expect(typeForSymbol("peristaltic")).toBe("pump");
    expect(typeForSymbol("bag")).toBe("vessel");
    expect(typeForSymbol("my-own")).toBe("other");
    expect(typeForTag("XV-101")).toBe("valve");
    expect(typeForTag("P101")).toBe("pump");
    expect(typeForTag("AG-1")).toBe("agitator");
    expect(typeForTag("PI-101")).toBe("instrument");
    const t = templateSteps("bindelute");
    expect(t.map((s) => s.name).slice(0, 3)).toEqual(["Sanitize", "Equilibrate", "Load"]);
    const st = startTimes([{ ...t[0], minutes: 30 }, { ...t[1], minutes: undefined }, { ...t[2], minutes: 120 }]);
    expect(st).toEqual({ starts: [0, 30, 30], total: 150, missing: 1 });
  });

  it("table rows: used and own equipment, valves first", () => {
    const p = project();
    p.equipment.push({ id: "e4", tag: "XV-102", type: "valve" });
    const s = setCell(steps(2), 0, p.equipment[3], "Open");
    expect(tableEquipment(p, s, "u1").map((e) => e.tag)).toEqual(["XV-101", "XV-102", "P-101", "BAG-1"]);
  });

  it("deleting equipment removes its actions; deleting a unit operation drops its steps and own equipment", () => {
    const p = project();
    p.operations.u1 = setCell(setCell(steps(2), 0, valve, "Open"), 1, pump, "On");
    p.operations.u2 = setCell(steps(1), 0, pump, "On");
    const d = deleteEquipment(p, ["e1"]);
    expect(d.equipment.map((e) => e.id)).toEqual(["e2", "e3"]);
    expect(d.operations.u1[0].actions).toEqual([]);
    const g = dropUnitOperations(p, "u1");
    expect(g.operations.u1).toBeUndefined();
    // P-101 is used by CEX: kept, no longer belongs to PROA.
    expect(g.equipment.map((e) => [e.tag, e.uoId ?? null])).toEqual([["P-101", null]]);
  });
});

describe("operations: project file and link check", () => {
  it("round-trips; the file is v3 only when there are operations", () => {
    const p = project();
    p.operations.u1 = setCell(steps(2), 1, valve, "Open");
    p.operations.u1[0].streams = ["ST-PROA-001"];
    p.operations.u1[0].minutes = 20;
    const text = serializeProject(p);
    expect(JSON.parse(text).version).toBe(3);
    const back = parseProject(text).project;
    expect(back.equipment).toEqual(p.equipment);
    expect(back.operations).toEqual(p.operations);
    expect(JSON.parse(serializeProject(createProject())).version).toBe(2);
    // Actions on unknown equipment, steps of unknown unit operations, tags twice: left out, with notes.
    const raw = JSON.parse(text);
    raw.equipment.push({ id: "e9", tag: "xv-101", type: "valve" });
    raw.operations.u1[1].actions.push({ equipmentId: "nope", state: "Open" });
    raw.operations.zz = [{ id: "s", name: "x", actions: [] }];
    const r = parseProject(JSON.stringify(raw));
    expect(r.project.equipment).toHaveLength(3);
    expect(r.project.operations.u1[1].actions).toHaveLength(1);
    expect(r.project.operations.zz).toBeUndefined();
    expect(r.notes.join(" ")).toMatch(/tag used twice[\s\S]*not in the project[\s\S]*not in the list/);
  });

  it("flags a tag on two shapes and steps with a stream of another unit operation", () => {
    const p = project();
    const shape = (id: string) => ({ id, type: "rectangle", x: 0, y: 0, width: 10, height: 10, customData: { pcs: { equipmentId: "e1" } } });
    p.pfd.sheets.u1 = { elements: [shape("r1"), shape("r2")], files: {} };
    expect(equipmentShapes(p.pfd).get("e1")).toHaveLength(2);
    p.operations.u1 = [{ id: "s1", name: "Load", streams: ["ST-PROA-001", "ST-CEX-004"], actions: [] }];
    p.operations.u2 = [{ id: "s2", name: "Load", streams: ["ST-PROA-CEX"], actions: [] }];
    const f = linkCheck(p);
    expect(f.find((x) => x.id === "tag-twice")?.items[0].text).toBe("XV-101: 2 shapes (PROA)");
    expect(f.find((x) => x.id === "step-stream")?.items.map((i) => i.text)).toEqual(["PROA step 1 Load: ST-CEX-004"]);
  });
});

describe("operations: Excel", () => {
  const table = (rows: (string | number | boolean | null | undefined)[][]) => rows.map((r) => r.map((v) => (v == null ? "" : String(v))));
  const exported = (p: Project) => operationsSheets(p).map((s) => ({ name: s.name, table: table([s.header, ...s.rows]) }));

  it("exports and imports back the same steps and actions", () => {
    const p = project();
    let s: OpStep[] = [{ id: "a", name: "Equilibrate", minutes: 20, streams: ["ST-PROA-002"], actions: [] }, { id: "b", name: "Load", minutes: 120, streams: ["ST-PROA-001"], actions: [] }, { id: "c", name: "Stop", actions: [] }];
    s = setCell(s, 0, pump, "On");
    s = setCell(s, 0, valve, "Open");
    s = putAction(s, 1, { equipmentId: "e3", state: "Fill", note: "to 200 L" });
    s = setCell(s, 2, pump, "Off");
    s = setCell(s, 2, valve, "Closed");
    p.operations.u1 = s;
    const sheets = exported(p);
    expect(sheets.map((x) => x.name)).toEqual(["About", "Equipment", "Steps", "Actions", "States PROA"]);
    const states = sheets.find((x) => x.name === "States PROA")!.table;
    expect(states[0]).toEqual(["Tag", "Equipment", "Initial", "1. Equilibrate", "2. Load", "3. Stop"]);
    expect(states.find((r) => r[0] === "XV-101")).toEqual(["XV-101", "Valve", "Closed", "Open", "Open", "Closed"]);
    expect(sheets.find((x) => x.name === "Actions")!.table[1]).toEqual(["PROA", "1", "Equilibrate", "Start P-101", "P-101", "On", ""]);

    const plan = planOperationsImport(sheets, p) as OpsImportPlan;
    expect(plan.problems).toEqual([]);
    expect(plan.equipmentAdd).toEqual([]);
    expect(plan.uos.map((u) => [u.code, u.steps.length, u.before, u.actionsFrom])).toEqual([["PROA", 3, 3, "Actions"]]);
    const back = applyOperationsImport(p, plan).operations.u1;
    const strip = (x: OpStep[]) => x.map(({ id: _id, ...rest }) => rest);
    expect(strip(back)).toEqual(strip(s));
  });

  it("an edited States sheet wins over the Actions sheet; Korean words and new tags work", () => {
    const p = project();
    p.operations.u1 = setCell(steps(3), 0, valve, "Open");
    const sheets = exported(p);
    const st = sheets.find((x) => x.name === "States PROA")!.table;
    const row = st.findIndex((r) => r[0] === "XV-101");
    st[row][5] = "닫힘"; // close it in step 3
    st.push(["XV-102", "Outlet", "", "", "열림", ""]); // a new valve, opened in step 2
    const plan = planOperationsImport(sheets, p) as OpsImportPlan;
    expect(plan.equipmentAdd.map((e) => [e.tag, e.type])).toEqual([["XV-102", "valve"]]);
    expect(plan.problems.join(" | ")).toMatch(/XV-102 .*added as Valve[\s\S]*PROA: the States sheet and the Actions sheet say different things/);
    const after = applyOperationsImport(p, plan);
    const xv102 = after.equipment.find((e) => e.tag === "XV-102")!;
    expect(timeline(after.operations.u1, after.equipment[0]).map((c) => c.state)).toEqual(["Open", "Open", "Closed"]);
    expect(timeline(after.operations.u1, xv102).map((c) => c.state)).toEqual(["Closed", "Open", "Open"]);
  });

  it("builds steps from an Actions sheet alone (written by hand)", () => {
    const p = project();
    const plan = planOperationsImport([{ name: "Actions", table: [
      ["Unit operation", "No.", "Step", "Tag", "State", "Note"],
      ["PROA", "1", "Equilibrate", "XV-101", "open", ""],
      ["PROA", "1", "Equilibrate", "P-101", "start", ""],
      ["PROA", "2", "Load", "XV-103", "열기", "new"],
      ["XYZ", "1", "?", "XV-101", "open", ""],
    ] }], p) as OpsImportPlan;
    expect(plan.uos[0].steps.map((s) => [s.name, s.actions.map((a) => a.state).join()])).toEqual([["Equilibrate", "Open,On"], ["Load", "Open"]]);
    expect(plan.problems.join(" | ")).toMatch(/XV-103[\s\S]*XYZ is not in the project/);
    expect(planOperationsImport([{ name: "Sheet1", table: [["a"]] }], p)).toHaveProperty("error");
  });
});
