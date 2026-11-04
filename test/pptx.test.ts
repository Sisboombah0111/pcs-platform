import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { parseProject } from "../src/model/project";
import { CONTENT, buildPfdDeck, cutAround, drawingOps, streamRows } from "../src/pfd/pptx";

const el = (o: Record<string, unknown>) => ({ id: String(o.id ?? Math.random()), x: 0, y: 0, width: 100, height: 50, strokeColor: "#1e1e1e", backgroundColor: "transparent", strokeWidth: 2, ...o });

describe("PFD drawing → PowerPoint shapes", () => {
  it("fits the drawing into the content area and keeps proportions", () => {
    const ops = drawingOps([el({ id: "a", type: "rectangle", x: 0, y: 0, width: 200, height: 100 }), el({ id: "b", type: "ellipse", x: 400, y: 200, width: 100, height: 100 })]);
    const [a, b] = ops as Extract<(typeof ops)[number], { kind: "shape" }>[];
    expect([a.shape, b.shape]).toEqual(["rect", "ellipse"]);
    // 500 × 300 px (+ 12 px padding each side) into 12.53 × 6 in: the height limits the scale.
    const s = CONTENT.h / 324;
    expect(a.w).toBeCloseTo(200 * s, 6);
    expect(b.x - a.x).toBeCloseTo(400 * s, 6);
    expect(a.line).toEqual({ color: "1E1E1E", width: Number((2 * s * 72).toFixed(2)) });
    expect(a.fill).toBeUndefined();
  });

  it("arrows become paths with arrowheads, cut around their own label as on screen; rounded boxes keep their corners", () => {
    const ops = drawingOps([
      el({ id: "box", type: "rectangle", width: 220, height: 110, roundness: { type: 3 }, backgroundColor: "#e7f1fb", fillStyle: "solid" }),
      el({ id: "arr", type: "arrow", x: 220, y: 55, width: 200, height: 40, points: [[0, 0], [100, 0], [100, 40], [200, 40]], endArrowhead: "triangle" }),
      el({ id: "lbl", type: "text", x: 280, y: 40, width: 80, height: 20, text: "ST-A-001\nFeed", fontSize: 14, fontFamily: 9, textAlign: "center", verticalAlign: "middle", containerId: "arr" }),
    ]);
    const box = ops[0] as Extract<(typeof ops)[number], { kind: "shape" }>;
    expect(box.shape).toBe("roundRect");
    // Excalidraw adaptive corners: a quarter of the shorter side up to 128 px, then 32 px.
    expect(box.radius).toBeCloseTo(27.5 / 55, 6);
    expect(box.fill).toEqual({ color: "E7F1FB", transparency: 0 });
    const paths = ops.filter((o) => o.kind === "path") as Extract<(typeof ops)[number], { kind: "path" }>[];
    expect(paths.map((p) => [p.points.length, p.begin, p.end])).toEqual([[2, "none", "none"], [3, "none", "triangle"]]);
    const lbl = ops[ops.length - 1] as Extract<(typeof ops)[number], { kind: "text" }>;
    expect([lbl.text, lbl.align, lbl.valign, lbl.fontFace, lbl.fill]).toEqual(["ST-A-001\nFeed", "center", "middle", "Arial", undefined]);
  });

  it("cutAround keeps the parts of a polyline outside a box", () => {
    const box = { x: 276, y: 38, width: 88, height: 24 };
    expect(cutAround([[220, 55], [320, 55], [320, 95], [420, 95]], box)).toEqual([[[220, 55], [276, 55]], [[320, 62], [320, 95], [420, 95]]]);
    expect(cutAround([[0, 0], [100, 0]], { x: 40, y: -5, width: 20, height: 10 })).toEqual([[[0, 0], [40, 0]], [[60, 0], [100, 0]]]);
    expect(cutAround([[0, 0], [100, 0]], { x: 40, y: 10, width: 20, height: 10 })).toEqual([[[0, 0], [100, 0]]]);
  });

  it("a closed line with a fill (a symbol body) is a filled closed path", () => {
    const [op] = drawingOps([el({ type: "line", points: [[0, 0], [40, 0], [40, 80], [0, 80], [0, 0]], backgroundColor: "#ffffff", fillStyle: "solid" })]);
    expect(op).toMatchObject({ kind: "path", closed: true, fill: { color: "FFFFFF", transparency: 0 } });
  });
});

describe("the downstream example as a deck", () => {
  const { project } = parseProject(readFileSync(join(__dirname, "../examples/example-downstream.pcs.json"), "utf8"));
  const sheet = (scope: string) => (scope === "map" ? project.pfd.map : project.pfd.sheets[scope]);
  const slides = ["map", ...project.uos.map((u) => u.id)];

  it("stream tables: the drawing's streams with their applied values, transfers in and out", () => {
    const proa = project.uos.find((u) => u.code === "PROA")!.id;
    const rows = streamRows(project, proa);
    expect(rows.map((r) => r.id)).toEqual([...Array.from({ length: 12 }, (_, i) => `ST-PROA-${String(i + 1).padStart(3, "0")}`), "ST-PROA-CEX"]);
    expect(rows[0]).toEqual({ id: "ST-PROA-001", name: "HCCF load", route: "PROA", unit: "L", values: ["1,900", "14,250"] });
    const cex = project.uos.find((u) => u.code === "CEX")!.id;
    expect(streamRows(project, cex)[0].id).toBe("ST-PROA-CEX");
    expect(streamRows(project, "map").map((r) => r.id)).toEqual(["ST-PROA-CEX", "ST-CEX-MMC", "ST-MMC-VF", "ST-VF-UFDF", "ST-UFDF-FILL", "ST-FILL-STOR"]);
  });

  it("editable shapes: a slide per drawing and per stream table, with paths, arrowheads and the labels", async () => {
    const buf = (await buildPfdDeck(project, { slides, mode: "shapes", streamTables: true, sheet: (k) => sheet(k), output: "nodebuffer" })) as Uint8Array;
    if (process.env.PPTX_OUT) writeFileSync(process.env.PPTX_OUT, buf);
    const zip = await JSZip.loadAsync(buf);
    const names = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
    expect(names).toHaveLength(16);
    const s1 = await zip.file("ppt/slides/slide1.xml")!.async("string");
    expect(s1).toContain("Process map");
    expect(s1).toContain("ST-PROA-CEX");
    const s3 = await zip.file("ppt/slides/slide3.xml")!.async("string");
    expect(s3).toContain("PROA · Protein A, VI, depth filtration");
    expect(s3).toContain("<a:custGeom>");
    expect(s3).toMatch(/<a:tailEnd type="(triangle|arrow)"/);
    expect(s3).toContain("BUF-1001");
    const s4 = await zip.file("ppt/slides/slide4.xml")!.async("string");
    expect(s4).toContain("<a:tbl>");
    expect(s4).toContain("14,250");
  }, 30000);
});
