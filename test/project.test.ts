import { describe, expect, it } from "vitest";
import { ProjectFileError, createProject, parseProject, projectFileName, serializeProject, validateProject } from "../src/model/project";
import { sampleMaterials } from "../src/model/sampleData";

describe("project file", () => {
  it("reads back exactly what was saved", () => {
    const p = createProject("mAb USP", "2026-10-29T06:00:00.000Z");
    p.materials = sampleMaterials();
    p.uos = [{ id: "uo_a", code: "100L", name: "100L Bioreactor", order: 1 }];
    p.pfd.map.elements = [{ id: "box1", type: "rectangle", customData: { pcs: { kind: "uo", uoId: "uo_a" } } }];
    p.pfd.sheets.uo_a = { elements: [{ id: "el1", type: "rectangle" }], files: {}, view: { zoom: 1.2, scrollX: 10, scrollY: -4 } };
    const { project, notes } = parseProject(serializeProject(p));
    expect(notes).toEqual([]);
    expect(project).toEqual(p);
  });

  it("rejects other files and newer versions", () => {
    expect(() => parseProject("not json")).toThrow(ProjectFileError);
    expect(() => parseProject(JSON.stringify({ format: "excalidraw" }))).toThrow(/not a PCS project file/);
    expect(() => parseProject(JSON.stringify({ format: "pcs-project", version: 5 }))).toThrow(/newer version/);
  });

  it("repairs missing lists and duplicate ids, and reports them", () => {
    const text = JSON.stringify({
      format: "pcs-project", version: 1, meta: { name: "x" },
      materials: [{ id: "m1", code: "A", name: "a", unit: "kg" }, { id: "m1", code: "A", name: "b", unit: "" }],
      uos: [{ id: "u1", code: "bad code", name: "?" }],
    });
    const { project, notes } = parseProject(text);
    expect(project.materials[0].id).not.toBe(project.materials[1].id);
    expect(project.pfd).toEqual({ map: { elements: [], files: {} }, sheets: {}, library: [] });
    expect(notes.join("\n")).not.toMatch(/Converted from project file v1/);
    expect(project.mb.scenarios.map((s) => s.id)).toEqual(["sending", "receiving"]);
    expect(notes.join("\n")).toMatch(/Material code A appears twice/);
    expect(notes.join("\n")).toMatch(/has no unit/);
    expect(notes.join("\n")).toMatch(/UO '\?': code 'BAD CODE'/);
  });

  it("validation: duplicate material code, missing unit, UO code format", () => {
    const p = createProject();
    p.materials = [{ id: "a", code: "X", name: "", unit: "kg" }, { id: "b", code: "X", name: "", unit: "" }];
    p.uos = [{ id: "u", code: "100", name: "n", order: 1 }];
    expect(validateProject(p).map((i) => i.where)).toEqual(["materials", "materials", "uos"]);
  });

  it("file name drops characters Windows rejects", () => {
    const p = createProject('mAb: USP/DSP "v1"');
    expect(projectFileName(p)).toBe("mAb USP DSP v1.pcs.json");
  });
});
