import { describe, expect, it } from "vitest";
import { valueLine } from "../src/mb/model";
import { newScenario, scenarioProblems, setScenarios, shortNames } from "../src/mb/scenarios";
import { createProject } from "../src/model/project";

describe("scenarios", () => {
  it("checks names and columns", () => {
    expect(scenarioProblems([{ name: "Sending", column: "Sending" }, { name: "Clinical", column: "Clinical" }])).toEqual([]);
    expect(scenarioProblems([])).toEqual(["Keep at least one scenario."]);
    expect(scenarioProblems([{ name: "A", column: "Unit" }, { name: "a", column: "X" }, { name: "B", column: "x " }, { name: "", column: "" }])).toEqual([
      "“Unit” is a fixed PCS_LINK column; use another name for scenario 1.",
      "Two scenarios are called “a”.",
      "Two scenarios read the column “x”.",
      "Scenario 4 has no name.",
      "Scenario 4 has no PCS_LINK column.",
    ]);
  });

  it("sets the list; the active one falls back when removed; labels use short names", () => {
    const p = createProject();
    const c = newScenario("Clinical 500 L");
    const q = setScenarios({ ...p, mb: { ...p.mb, activeScenario: "receiving" } }, [p.mb.scenarios[0], { ...c, name: " Clinical 500 L " }]);
    expect(q.mb.scenarios.map((s) => s.name)).toEqual(["Sending", "Clinical 500 L"]);
    expect(q.mb.activeScenario).toBe("sending");
    expect([...shortNames([{ id: "a", name: "Sending" }, { id: "b", name: "Receiving" }, { id: "c", name: "clinical" }]).values()]).toEqual(["S", "R", "C"]);
    expect([...shortNames([{ id: "a", name: "Sending" }, { id: "b", name: "Small scale" }]).values()]).toEqual(["Se", "Sm"]);
    const line = valueLine({ unit: "L", values: { sending: 2000, receiving: 15000, [c.id]: 500 } }, "id+both", [...p.mb.scenarios, c], "sending");
    expect(line).toBe("S 2,000 · R 15,000 · C 500 L");
  });
});
