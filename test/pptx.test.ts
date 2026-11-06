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
    // In inches (PptxGenJS reads rectRadius as inches): the editor's corner, a quarter of the shorter side here.
    expect(box.radius! / box.h).toBeCloseTo(27.5 / 110, 4);
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

describe("pictures for PowerPoint (N5.1.1: SVG stream tables on a drawing made the export fail)", () => {
  const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");
  const svgOf = (data: string) => Buffer.from(data.replace(/^data:image\/svg\+xml;base64,/, ""), "base64").toString("utf8");

  it("a PNG goes as before: the header without data:", async () => {
    const { pptxImageData } = await import("../src/pfd/pptx");
    expect(pptxImageData("data:image/png;base64,iVBORw0KGgo=", 10, 10)).toBe("image/png;base64,iVBORw0KGgo=");
  });

  it("an SVG keeps data: (PptxGenJS loads it as the image address) and its own size", async () => {
    const { pptxImageData } = await import("../src/pfd/pptx");
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="336" height="121" viewBox="0 0 336 121"><text>ST-10L-001</text></svg>';
    const out = pptxImageData(`data:image/svg+xml;base64,${b64(svg)}`, 500, 200)!;
    expect(out.startsWith("data:image/svg+xml;base64,")).toBe(true);
    expect(svgOf(out)).toBe(svg);
  });

  it("an SVG without a size (or a size in %) gets the picture's size on the drawing", async () => {
    const { pptxImageData } = await import("../src/pfd/pptx");
    const noSize = svgOf(pptxImageData(`data:image/svg+xml;base64,${b64('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 20"><rect/></svg>')}`, 160.4, 80)!);
    expect(noSize).toBe('<svg width="160" height="80" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 20"><rect/></svg>');
    const percent = svgOf(pptxImageData(`data:image/svg+xml;base64,${b64('<?xml version="1.0"?><svg width="100%" height="100%" viewBox="0 0 4 2"/>')}`, 40, 20)!);
    expect(percent).toBe('<?xml version="1.0"?><svg width="40" height="20" viewBox="0 0 4 2"/>');
  });

  it("an SVG written as plain text becomes base64; Korean text survives", async () => {
    const { pptxImageData } = await import("../src/pfd/pptx");
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><text>완충액 ±5 °C</text></svg>';
    const out = pptxImageData(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`, 10, 10)!;
    expect(out.startsWith("data:image/svg+xml;base64,")).toBe(true);
    expect(svgOf(out)).toBe(svg);
  });

  it("data that is not a picture is left out (null), not passed on", async () => {
    const { pptxImageData } = await import("../src/pfd/pptx");
    expect(pptxImageData("image/png;base64,AAAA", 1, 1)).toBeNull();
    expect(pptxImageData("data:image/svg+xml;base64,", 1, 1)).toBeNull();
    expect(pptxImageData(`data:image/svg+xml;base64,${b64("<html>not svg</html>")}`, 1, 1)).toBeNull();
    expect(pptxImageData("data:image/png;base64,%%%", 1, 1)).toBeNull();
  });

  it("the small example (a stream table on its process map) makes a deck with the table as SVG", async () => {
    const { project: p } = parseProject(readFileSync(join(__dirname, "../examples/example-process.pcs.json"), "utf8"));
    const skipped: string[] = [];
    const out = await buildPfdDeck(p, {
      slides: ["map", ...p.uos.map((u) => u.id)], mode: "shapes", streamTables: true, output: "nodebuffer",
      sheet: (k) => (k === "map" ? p.pfd.map : p.pfd.sheets[k]), onSkip: (w) => skipped.push(w),
    });
    const zip = await JSZip.loadAsync(out as Uint8Array);
    const svgs = Object.keys(zip.files).filter((f) => /^ppt\/media\/.*\.svg$/.test(f));
    expect(skipped).toEqual([]);
    expect(svgs.length).toBe(1);
    const table = await zip.file(svgs[0])!.async("string");
    expect(table).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" width="\d+" height="\d+"/);
    expect(table).toContain("ST-10L-");
  });
});

describe("symbols look the same in PowerPoint (N5.1.2)", () => {
  it("a small rounded box keeps its corner: the radius goes in inches (PptxGenJS divides it by the shorter side)", async () => {
    const { drawingOps } = await import("../src/pfd/pptx");
    // The single-use bag body: 64 × 84 px, adaptive corners = 16 px. Alone it would fill the slide, so add a far
    // point to keep the bag at its drawing size (≈ 0.6 in), where a 0–1 value had made it an oval.
    const ops = drawingOps([el({ id: "bag", type: "rectangle", x: 0, y: 12, width: 64, height: 84, roundness: { type: 3 } }), el({ id: "far", type: "line", x: 1200, y: 600, width: 1, height: 1, points: [[0, 0], [1, 1]] })]);
    const bag = ops.find((o) => o.kind === "shape") as Extract<(typeof ops)[number], { kind: "shape" }>;
    expect(bag.shape).toBe("roundRect");
    expect(bag.radius! / bag.w).toBeCloseTo(16 / 64, 3);
    // What PptxGenJS writes: adj = radius / shorter side × 100000 → 25000, a quarter, as in the app (50000 = oval ends).
    expect(Math.abs((bag.radius! / Math.min(bag.w, bag.h)) * 100000 - 25000)).toBeLessThan(20);
  });

  it("dashes are the editor's ([8, 8 + width] px, dots [1.5, 6 + width]) in line widths", async () => {
    const { drawingOps } = await import("../src/pfd/pptx");
    const [dash] = drawingOps([el({ id: "d", type: "line", strokeWidth: 1.5, strokeStyle: "dashed", points: [[0, 0], [100, 0]] })]) as Extract<ReturnType<typeof drawingOps>[number], { kind: "path" }>[];
    expect(dash.line!.pattern!.dash).toBeCloseTo(8 / 1.5, 6);
    expect(dash.line!.pattern!.gap).toBeCloseTo(9.5 / 1.5, 6);
    const [dot] = drawingOps([el({ id: "o", type: "line", strokeWidth: 2, strokeStyle: "dotted", points: [[0, 0], [100, 0]] })]) as Extract<ReturnType<typeof drawingOps>[number], { kind: "path" }>[];
    expect([dot.line!.pattern!.dash, dot.line!.pattern!.gap]).toEqual([0.75, 4]);
  });

  it("a dashed box becomes four sides (dashes start at every corner, as in the editor) over its fill", async () => {
    const { drawingOps } = await import("../src/pfd/pptx");
    const ops = drawingOps([el({ id: "j", type: "rectangle", width: 100, height: 60, strokeStyle: "dashed", backgroundColor: "#ffffff", fillStyle: "solid" })]);
    expect(ops.map((o) => o.kind)).toEqual(["shape", "path"]);
    const fill = ops[0] as Extract<(typeof ops)[number], { kind: "shape" }>;
    const sides = ops[1] as Extract<(typeof ops)[number], { kind: "path" }>;
    expect(fill.line).toBeUndefined();
    expect(fill.fill?.color).toBe("FFFFFF");
    expect(sides.points.filter((p) => p.move).length).toBe(4);
    expect([sides.x, sides.y, sides.w, sides.h]).toEqual([fill.x, fill.y, fill.w, fill.h]);
  });

  it("hatching is drawn as lines at -41° in the fill colour, under the outline, with no solid fill", async () => {
    const { drawingOps } = await import("../src/pfd/pptx");
    const ops = drawingOps([el({ id: "bed", type: "rectangle", width: 40, height: 108, strokeWidth: 1.5, backgroundColor: "#c7d7de", fillStyle: "hachure" })]);
    expect(ops.map((o) => o.kind)).toEqual(["path", "shape"]);
    const hatch = ops[0] as Extract<(typeof ops)[number], { kind: "path" }>;
    const box = ops[1] as Extract<(typeof ops)[number], { kind: "shape" }>;
    expect(box.fill).toBeUndefined();
    expect(hatch.line!.color).toBe("C7D7DE");
    const moves = hatch.points.filter((p) => p.move).length;
    expect(moves).toBeGreaterThan(15);
    // Every line rises to the right at 41°.
    const [a, b] = [hatch.points[0], hatch.points[1]];
    expect(Math.round((Math.atan2(a.y - b.y, b.x - a.x) * 180) / Math.PI)).toBe(41);
  });

  it("hatch lines stay inside the shape", async () => {
    const { hatchLines, outlineOf } = await import("../src/pfd/pptx");
    const square = hatchLines(outlineOf("rectangle", 10, 10), 0, 2);
    expect(square.length).toBe(5);
    for (const [p, q] of square) expect([p[0], q[0]]).toEqual([0, 10]);
    for (const [p, q] of hatchLines(outlineOf("ellipse", 40, 20), -41, 3)) {
      for (const [x, y] of [p, q]) expect(((x - 20) / 20) ** 2 + ((y - 10) / 10) ** 2).toBeLessThan(1.01);
    }
  });

  it("the slide XML gets the editor's custom dash and round ends and corners", async () => {
    const { withEditorDashes } = await import("../src/pfd/pptx");
    const sp = (name: string, dash = "") => `<p:sp><p:nvSpPr><p:cNvPr id="3" name="${name}"></p:cNvPr></p:nvSpPr><p:spPr><a:ln w="13208"><a:solidFill><a:srgbClr val="1E1E1E"/></a:solidFill>${dash}<a:headEnd type="none"/></a:ln></p:spPr></p:sp>`;
    const out = withEditorDashes(sp("PCSDASH-533333-633333", '<a:prstDash val="dash"/>') + sp("Shape 4") + "<p:sp><p:txBody><a:p/></p:txBody></p:sp>");
    expect(out).toContain('name="Dashed line"');
    expect(out).toContain('<a:custDash><a:ds d="533333" sp="633333"/></a:custDash><a:round/><a:headEnd');
    expect(out).not.toContain("prstDash");
    expect(out.match(/<a:ln w="13208" cap="rnd">/g)?.length).toBe(2);
    expect(out).toContain('</a:solidFill><a:round/><a:headEnd type="none"/>');
    expect(out).toContain("<p:sp><p:txBody><a:p/></p:txBody></p:sp>");
  });
});
