import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { computeBom } from "../src/bom/model";
import { RULES, SCREENS, STEPS, UI } from "../src/guide/content";
import { STEP_ORDER, guideStatus, nextStep } from "../src/guide/status";
import { linkCheck } from "../src/link/check";
import { createProject, parseProject } from "../src/model/project";
import { sampleMaterials } from "../src/model/sampleData";

const states = (s: ReturnType<typeof guideStatus>) => s.map((x) => `${x.id}:${x.state}`);

describe("in-app guide: where the project is", () => {
  it("a new project: start with the materials; later steps wait for earlier ones", () => {
    const p = createProject("New");
    const s = guideStatus(p, linkCheck(p), computeBom(p));
    expect(states(s)).toEqual(["materials:todo", "map:todo", "drawings:wait", "workbook:wait", "apply:wait", "bom:wait", "linked:wait"]);
    expect(nextStep(s)).toBe("materials");
    expect(s[0].found).toEqual({ en: "No materials yet.", ko: "아직 자재가 없습니다." });
  });

  it("sample materials only: step 1 done, the process map is next", () => {
    const p = createProject("New");
    p.materials = sampleMaterials();
    const s = guideStatus(p, linkCheck(p), computeBom(p));
    expect(s[0].state).toBe("done");
    expect(s[0].found.en).toMatch(/^33 materials, 3 with a recipe\.$/);
    expect(nextStep(s)).toBe("map");
  });

  it("the downstream example: all seven steps done", () => {
    const { project } = parseProject(readFileSync(join(__dirname, "../examples/example-downstream.pcs.json"), "utf8"));
    const s = guideStatus(project, linkCheck(project), computeBom(project));
    expect(states(s).every((x) => x.endsWith(":done"))).toBe(true);
    expect(nextStep(s)).toBeNull();
    expect(s.find((x) => x.id === "materials")!.found.en).toBe("43 materials, 14 with a recipe (2 in batches).");
    expect(s.find((x) => x.id === "drawings")!.found.ko).toBe("단위공정 7개에 스트림 37개 (STOR: 이송만).");
    // A workbook changed after it was applied: step 5 asks to apply again.
    const changed = { ...project, mb: { ...project.mb, workbook: { ...project.mb.workbook!, sha256: "changed" } } };
    const s2 = guideStatus(changed, linkCheck(changed), computeBom(changed));
    expect(s2.find((x) => x.id === "apply")!.state).toBe("check");
    expect(s2.find((x) => x.id === "linked")!.state).toBe("check");
    expect(nextStep(s2)).toBe("apply");
  });

  it("every text is there in English and Korean", () => {
    const all = [
      ...Object.values(UI).map((x) => x as { en: string; ko: string }),
      ...STEP_ORDER.flatMap((id) => [STEPS[id].title, STEPS[id].why, STEPS[id].go.label, ...STEPS[id].how]),
      ...Object.values(SCREENS).flatMap((x) => [x.title, ...x.items]),
      ...RULES.flatMap((r) => [r.title, ...r.rows.flat()]),
    ];
    for (const x of all) {
      expect(x.en.trim().length).toBeGreaterThan(0);
      expect(x.ko.trim().length).toBeGreaterThan(0);
    }
    expect(STEP_ORDER.every((id) => STEPS[id].how.length >= 3)).toBe(true);
  });
});
