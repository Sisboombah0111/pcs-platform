import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  MY_SYMBOLS, cleanSymbols, customPreviewUrl, fromExcalidrawLib, imageSymbol, insertSize, mergeSymbols, nameFromFile,
  normalizeShapes, shapesSymbol, symbolSetJson, symbolsFromJson,
} from "../src/pfd/customSymbols";
import { CATEGORIES, SYMBOLS, fitLine, partsBounds, symbolPreviewSvg } from "../src/pfd/symbols";
import { createProject, parseProject, serializeProject } from "../src/model/project";

const PNG = "data:image/png;base64,iVBORw0KGgo=";

describe("built-in symbols", () => {
  it("have unique ids, a known category, a body first and a label", () => {
    expect(new Set(SYMBOLS.map((s) => s.id)).size).toBe(SYMBOLS.length);
    for (const s of SYMBOLS) {
      expect(CATEGORIES).toContain(s.category);
      expect(s.parts[0].type).not.toBe("text");
      expect(s.label.trim()).not.toBe("");
      const b = partsBounds(s.parts);
      expect(b.width).toBeGreaterThan(0);
      expect(b.height).toBeGreaterThan(0);
      expect(symbolPreviewSvg(s)).toMatch(/^<svg /);
    }
  });

  it("cover downstream: filters by type, vessels, single-use bags, chromatography, valves, instruments", () => {
    const ids = new Set(SYMBOLS.map((s) => s.id));
    for (const id of ["sterile", "prefilter", "virus", "depth", "cartridge", "tff", "hollow", "madsorber", "tank", "jacketed", "mixtank",
      "bag", "bag3d", "sumixer", "column", "proa", "iex", "vi", "valve3", "check", "pinch", "inst_p", "inst_uv", "filling", "freezer"]) expect(ids).toContain(id);
    // The ids the example project and older drawings use are still there.
    for (const id of ["bioreactor", "rocking", "flask", "pump", "peristaltic", "filter", "centrifuge", "valve", "hx", "offpage"]) expect(ids).toContain(id);
    expect(SYMBOLS.length).toBeGreaterThanOrEqual(45);
  });
});

describe("symbols the user adds", () => {
  it("shapes from a drawing are moved to (0, 0) and lose app data and bindings to shapes left out", () => {
    const els = [
      { id: "a", type: "rectangle", x: 100, y: 50, width: 40, height: 30, frameId: "f1", customData: { pcs: { symbol: "bag", materials: [{ materialId: "m", qty: 1 }] } }, boundElements: [{ id: "t", type: "text" }, { id: "x", type: "arrow" }] },
      { id: "t", type: "text", x: 110, y: 60, width: 20, height: 10, text: "A", containerId: "a", customData: { pcs: { label: true }, other: 1 } },
      { id: "gone", type: "rectangle", x: 0, y: 0, width: 1, height: 1, isDeleted: true },
    ];
    const out = normalizeShapes(els);
    expect(out.map((e) => [e.id, e.x, e.y, e.frameId])).toEqual([["a", 0, 0, null], ["t", 10, 10, null]]);
    expect(out[0].customData).toBeUndefined();
    expect(out[1].customData).toEqual({ other: 1 });
    expect(out[0].boundElements).toEqual([{ id: "t", type: "text" }]);
    const sym = shapesSymbol("  Capsule  ", els, {}, "Filtration & clarification")!;
    expect(sym).toMatchObject({ name: "Capsule", kind: "shapes", category: "Filtration & clarification" });
    expect(shapesSymbol("x", [])).toBeNull();
  });

  it("reads an Excalidraw library file (the example in examples/symbols)", () => {
    const lib = JSON.parse(readFileSync(new URL("../examples/symbols/example-library.excalidrawlib", import.meta.url), "utf8"));
    const syms = fromExcalidrawLib(lib);
    expect(syms.map((s) => [s.name, s.kind, s.category, s.elements!.length])).toEqual([["Tube welder", "shapes", MY_SYMBOLS, 4], ["Inline flow cell", "shapes", MY_SYMBOLS, 4]]);
    expect(Math.min(...syms[0].elements!.map((e) => (e as { x: number }).x))).toBe(0);
    expect(customPreviewUrl(syms[0])).toMatch(/^data:image\/svg\+xml/);
    // Version 1 libraries are a list of element lists.
    expect(fromExcalidrawLib({ type: "excalidrawlib", version: 1, library: [lib.libraryItems[0].elements] })[0].name).toBe("Library item 1");
  });

  it("a symbol set file round-trips; JSON that is neither a set nor a library is refused", () => {
    const set = [imageSymbol("sterile filter", "image/png", PNG, 120, 60), fromExcalidrawLib(JSON.parse(readFileSync(new URL("../examples/symbols/example-library.excalidrawlib", import.meta.url), "utf8")))[0]];
    const back = symbolsFromJson(symbolSetJson(set));
    expect(back.kind).toBe("set");
    expect(back.symbols).toEqual(set);
    expect(symbolsFromJson('{"hello":1}').kind).toBeNull();
    expect(symbolsFromJson("not json").kind).toBeNull();
  });

  it("bad entries are left out; a picture must be one of the allowed types", () => {
    const { symbols, dropped } = cleanSymbols([
      imageSymbol("ok", "image/png", PNG, 10, 10),
      { kind: "image", name: "script", image: { mimeType: "text/html", dataURL: "data:text/html,<script>", width: 1, height: 1 } },
      { kind: "image", name: "lying", image: { mimeType: "image/png", dataURL: "data:text/html,x", width: 1, height: 1 } },
      { kind: "shapes", name: "empty", elements: [] },
      "nonsense",
    ]);
    expect(symbols.map((s) => s.name)).toEqual(["ok"]);
    expect(dropped).toBe(4);
  });

  it("merging skips the same symbol and renames a clashing id", () => {
    const a = imageSymbol("a", "image/png", PNG, 10, 10);
    const b = { ...imageSymbol("b", "image/png", PNG, 20, 20), id: a.id };
    const m = mergeSymbols([a], [a, b]);
    expect([m.added, m.skipped, m.symbols.length]).toEqual([1, 1, 2]);
    expect(m.symbols[1].id).not.toBe(a.id);
  });

  it("are saved in the project file", () => {
    const p = createProject("x");
    p.symbols = [imageSymbol("Sensor", "image/png", PNG, 10, 10, "Instruments")];
    const back = parseProject(serializeProject(p));
    expect(back.project.symbols).toEqual(p.symbols);
    expect(back.notes).toEqual([]);
    const raw = JSON.parse(serializeProject(p));
    raw.symbols.push({ kind: "image", name: "bad" });
    expect(parseProject(JSON.stringify(raw)).notes.join()).toMatch(/1 PFD symbol/);
    delete raw.symbols;
    expect(parseProject(JSON.stringify(raw)).project.symbols).toEqual([]);
  });

  it("sizes and names", () => {
    expect(insertSize(400, 200)).toEqual({ width: 96, height: 48 });
    expect(insertSize(10, 10)).toEqual({ width: 32, height: 32 });
    expect(insertSize(60, 40)).toEqual({ width: 60, height: 40 });
    expect(nameFromFile("sterile-filter_0.2um.svg")).toBe("sterile filter 0.2um");
  });
});

// N5.5.1: a symbol's lines are measured from their points (Excalidraw sizes a line skeleton 100 × 0, and a resize
// scales the points to that box, so the lines inside a symbol fell flat when it was made bigger).
describe("fitLine", () => {
  const base = { x: 10, y: 20, width: 100, height: 0 };
  it("measures a line from its points (the filter's diagonal)", () => {
    expect(fitLine({ ...base, points: [[0, 0], [44, -72]] })).toEqual({ x: 10, y: 20, width: 44, height: 72, points: [[0, 0], [44, -72]] });
  });
  it("moves the first point to (0, 0), keeping the line where it was", () => {
    const f = fitLine({ ...base, points: [[16, 0], [16, 30], [0, 30]] });
    expect(f).toEqual({ x: 26, y: 20, width: 16, height: 30, points: [[0, 0], [0, 30], [-16, 30]] });
  });
  it("a vertical line is 0 wide (not the 100 Excalidraw gives a line skeleton)", () => {
    expect(fitLine({ ...base, points: [[0, 0], [0, 40]] })).toMatchObject({ width: 0, height: 40 });
  });
  it("every line of every built-in symbol has a size to scale (no zero box for a line that has an extent)", () => {
    for (const d of SYMBOLS) for (const p of d.parts) if (p.type === "line") {
      const f = fitLine({ x: p.x, y: p.y, width: 100, height: 0, points: p.pts });
      const xs = p.pts.map((q) => q[0]), ys = p.pts.map((q) => q[1]);
      expect([f.width, f.height], `${d.id}`).toEqual([Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)]);
    }
  });
});
