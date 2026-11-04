/**
 * PFD → PowerPoint (.pptx): one slide per drawing (the process map, then each unit operation), and
 * optionally a stream table after each drawing with the applied Mass Balance values.
 *
 * Two ways to draw a slide:
 *   shapes    every Excalidraw element becomes a PowerPoint shape: rectangles, ellipses, diamonds,
 *             lines and arrows (as free-form paths with arrowheads), text boxes, pictures. Editable in
 *             PowerPoint; a symbol is several shapes (select them and Group if you want to move it as one).
 *   pictures  the drawing as one picture per slide, exactly as on screen (not editable).
 *
 * `drawingOps` is pure (no PptxGenJS, no browser) so it is unit tested; `buildPfdDeck` writes the file
 * with PptxGenJS (MIT), loaded only when someone exports.
 */
import type { Project, UnitOperation } from "../model/types";
import { flowValues, fmtQty, streamRoute } from "../mb/model";
import { streamNamesOf } from "./sync";

// ---- slide geometry (16:9, inches) ----------------------------------------------------------------------------
export const SLIDE_W = 13.333;
export const SLIDE_H = 7.5;
export const CONTENT = { x: 0.4, y: 0.95, w: 12.53, h: 6.0 };

interface El {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  angle?: number;
  strokeColor?: string;
  backgroundColor?: string;
  fillStyle?: string;
  strokeWidth?: number;
  strokeStyle?: string;
  opacity?: number;
  roundness?: { type: number; value?: number } | null;
  points?: [number, number][];
  startArrowhead?: string | null;
  endArrowhead?: string | null;
  text?: string;
  originalText?: string;
  fontSize?: number;
  fontFamily?: number;
  textAlign?: string;
  verticalAlign?: string;
  lineHeight?: number;
  containerId?: string | null;
  fileId?: string | null;
  isDeleted?: boolean;
  name?: string | null;
}

export type Arrowhead = "none" | "arrow" | "triangle" | "oval" | "diamond" | "stealth";
export interface LineStyle { color: string; width: number; dash?: "dash" | "sysDot"; transparency?: number }
export type Op =
  | { kind: "shape"; shape: "rect" | "roundRect" | "ellipse" | "diamond"; x: number; y: number; w: number; h: number; rotate: number; line?: LineStyle; fill?: { color: string; transparency: number }; radius?: number }
  | { kind: "path"; x: number; y: number; w: number; h: number; rotate: number; points: { x: number; y: number }[]; closed: boolean; line?: LineStyle; fill?: { color: string; transparency: number }; begin: Arrowhead; end: Arrowhead }
  | { kind: "text"; x: number; y: number; w: number; h: number; rotate: number; text: string; fontSize: number; fontFace: string; color: string; align: "left" | "center" | "right"; valign: "top" | "middle" | "bottom"; lineSpacing: number; fill?: string }
  | { kind: "image"; x: number; y: number; w: number; h: number; rotate: number; data: string };

/** Excalidraw font family id → a font every PowerPoint has. */
const FONTS: Record<number, string> = { 1: "Segoe Print", 2: "Arial", 3: "Consolas", 5: "Segoe Print", 6: "Arial", 7: "Arial Black", 8: "Comic Sans MS", 9: "Arial" };
const ARROWS: Record<string, Arrowhead> = {
  arrow: "arrow", triangle: "triangle", triangle_outline: "triangle", dot: "oval", circle: "oval", circle_outline: "oval",
  diamond: "diamond", diamond_outline: "diamond", bar: "none",
};

const hex = (c?: string): string | undefined => {
  if (!c || c === "transparent") return undefined;
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c.trim());
  if (!m) return undefined;
  const h = m[1].length === 3 ? m[1].split("").map((x) => x + x).join("") : m[1];
  return h.toUpperCase();
};

/** Bounds of what the drawing shows (lines by their points). */
export function drawingBounds(elements: readonly El[]) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const e of elements) {
    if (e.isDeleted) continue;
    if (e.points?.length) {
      for (const [px, py] of e.points) { x0 = Math.min(x0, e.x + px); y0 = Math.min(y0, e.y + py); x1 = Math.max(x1, e.x + px); y1 = Math.max(y1, e.y + py); }
    } else {
      x0 = Math.min(x0, e.x); y0 = Math.min(y0, e.y); x1 = Math.max(x1, e.x + e.width); y1 = Math.max(y1, e.y + e.height);
    }
  }
  return Number.isFinite(x0) ? { x: x0, y: y0, width: Math.max(1, x1 - x0), height: Math.max(1, y1 - y0) } : { x: 0, y: 0, width: 1, height: 1 };
}

/** Fit a box of w × h (px) into the content area: scale in inches per px and the offset. */
export function fitBox(width: number, height: number, area = CONTENT) {
  const s = Math.min(area.w / width, area.h / height);
  return { s, ox: area.x + (area.w - width * s) / 2, oy: area.y + (area.h - height * s) / 2 };
}

/**
 * The shapes, paths, texts and pictures of one drawing, placed on a slide (inches, points for sizes).
 * `files` holds the drawing's pictures (Excalidraw BinaryFiles: id → { dataURL }).
 */
export function drawingOps(elements: readonly unknown[], files: Record<string, unknown> = {}, area = CONTENT): Op[] {
  const els = (elements as El[]).filter((e) => e && !e.isDeleted);
  const b = drawingBounds(els);
  const pad = 12;
  const { s, ox, oy } = fitBox(b.width + pad * 2, b.height + pad * 2, area);
  const X = (x: number) => ox + (x - b.x + pad) * s;
  const Y = (y: number) => oy + (y - b.y + pad) * s;
  const pt = (px: number) => px * s * 72;
  const byId = new Map(els.map((e) => [e.id, e]));
  const ops: Op[] = [];
  /** Stream labels go on top of everything. */
  const labels: Op[] = [];
  const labelOf = new Map(els.filter((t) => t.type === "text" && t.containerId && byId.get(t.containerId)?.type === "arrow").map((t) => [t.containerId!, t]));

  const lineOf = (e: El): LineStyle | undefined => {
    const color = hex(e.strokeColor);
    if (!color) return undefined;
    const l: LineStyle = { color, width: Math.max(0.25, Number(pt(e.strokeWidth ?? 1).toFixed(2))) };
    if (e.strokeStyle === "dashed") l.dash = "dash";
    if (e.strokeStyle === "dotted") l.dash = "sysDot";
    if (e.opacity != null && e.opacity < 100) l.transparency = 100 - e.opacity;
    return l;
  };
  const fillOf = (e: El) => {
    const color = hex(e.backgroundColor);
    if (!color) return undefined;
    // Hatch patterns have no PowerPoint equivalent: a lighter solid fill stands for them.
    const base = e.fillStyle && e.fillStyle !== "solid" ? 55 : 0;
    const op = e.opacity != null && e.opacity < 100 ? 100 - e.opacity : 0;
    return { color, transparency: Math.min(100, base + op) };
  };
  const deg = (e: El) => Math.round(((e.angle ?? 0) * 180) / Math.PI);

  for (const e of els) {
    switch (e.type) {
      case "rectangle":
      case "ellipse":
      case "diamond": {
        const w = Math.max(e.width * s, 0.01), h = Math.max(e.height * s, 0.01);
        const op: Op = { kind: "shape", shape: e.type === "ellipse" ? "ellipse" : e.type === "diamond" ? "diamond" : "rect", x: X(e.x), y: Y(e.y), w, h, rotate: deg(e) };
        if (e.type === "rectangle" && e.roundness) {
          const m = Math.min(e.width, e.height);
          const r = e.roundness.type === 3 ? Math.min(e.roundness.value ?? 32, m * 0.25) : m * 0.25;
          op.shape = "roundRect";
          op.radius = Math.max(0, Math.min(1, r / (m / 2)));
        }
        const line = lineOf(e); if (line) op.line = line;
        const fill = fillOf(e); if (fill) op.fill = fill;
        ops.push(op);
        break;
      }
      case "frame":
      case "magicframe": {
        ops.push({ kind: "shape", shape: "rect", x: X(e.x), y: Y(e.y), w: e.width * s, h: e.height * s, rotate: 0, line: { color: "BBBBBB", width: 0.75 } });
        break;
      }
      case "line":
      case "arrow":
      case "freedraw": {
        const pts = e.points ?? [];
        if (pts.length < 2) break;
        const last = pts[pts.length - 1];
        const closed = e.type !== "arrow" && pts.length > 2 && Math.hypot(last[0] - pts[0][0], last[1] - pts[0][1]) < 1;
        // As on screen, the line of an arrow stops around its own label: draw the pieces outside it.
        const label = e.type === "arrow" ? labelOf.get(e.id) : undefined;
        const abs = pts.map(([px, py]) => [e.x + px, e.y + py] as [number, number]);
        const cut = label && !e.angle ? cutAround(abs, { x: label.x - 4, y: label.y - 2, width: label.width + 8, height: label.height + 4 }) : [abs];
        const pieces = cut.length ? cut : [abs];
        pieces.forEach((piece, i) => {
          const minX = Math.min(...piece.map((p) => p[0])), minY = Math.min(...piece.map((p) => p[1]));
          const maxX = Math.max(...piece.map((p) => p[0])), maxY = Math.max(...piece.map((p) => p[1]));
          const op: Op = {
            kind: "path", x: X(minX), y: Y(minY), w: Math.max((maxX - minX) * s, 0.01), h: Math.max((maxY - minY) * s, 0.01), rotate: deg(e),
            points: piece.map(([px, py]) => ({ x: Number(((px - minX) * s).toFixed(4)), y: Number(((py - minY) * s).toFixed(4)) })),
            closed,
            begin: i === 0 ? ARROWS[e.startArrowhead ?? ""] ?? "none" : "none",
            end: i === pieces.length - 1 ? ARROWS[e.endArrowhead ?? ""] ?? "none" : "none",
          };
          const line = lineOf(e); if (line) op.line = line;
          if (closed) { const fill = fillOf(e); if (fill) op.fill = fill; }
          ops.push(op);
        });
        break;
      }
      case "text": {
        const text = String(e.text ?? e.originalText ?? "");
        if (!text.trim()) break;
        const container = e.containerId ? byId.get(e.containerId) : undefined;
        // PowerPoint's font metrics differ a little: widen the box around the same anchor so nothing clips.
        const onArrow = container?.type === "arrow";
        const w = e.width * s * 1.12 + 0.04, h = e.height * s;
        const align = (e.textAlign === "center" || e.textAlign === "right" ? e.textAlign : "left") as "left" | "center" | "right";
        const x = align === "center" ? X(e.x) - (w - e.width * s) / 2 : align === "right" ? X(e.x) - (w - e.width * s) : X(e.x);
        const op: Op = {
          kind: "text", x, y: Y(e.y), w, h, rotate: deg(e), text,
          fontSize: Math.max(1, Number(pt(e.fontSize ?? 16).toFixed(1))), fontFace: FONTS[e.fontFamily ?? 9] ?? "Arial",
          color: hex(e.strokeColor) ?? "1E1E1E", align, valign: e.verticalAlign === "middle" ? "middle" : e.verticalAlign === "bottom" ? "bottom" : "top",
          lineSpacing: e.lineHeight ?? 1.25,
        };
        // A label on an arrow sits on a white patch, as on screen.
        if (onArrow) labels.push(op); else ops.push(op);
        break;
      }
      case "image": {
        const f = e.fileId ? (files[e.fileId] as { dataURL?: string } | undefined) : undefined;
        if (f?.dataURL) ops.push({ kind: "image", x: X(e.x), y: Y(e.y), w: e.width * s, h: e.height * s, rotate: deg(e), data: f.dataURL });
        break;
      }
      default:
        break;
    }
  }
  return [...ops, ...labels];
}

/**
 * The parts of a polyline outside a rectangle (each part a polyline). A segment that crosses the
 * rectangle is cut where it enters and leaves it (Liang–Barsky).
 */
export function cutAround(points: [number, number][], r: { x: number; y: number; width: number; height: number }): [number, number][][] {
  const out: [number, number][][] = [];
  let cur: [number, number][] = [];
  const x0 = r.x, x1 = r.x + r.width, y0 = r.y, y1 = r.y + r.height;
  const inside = ([x, y]: [number, number]) => x > x0 && x < x1 && y > y0 && y < y1;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    let t0 = 0, t1 = 1;
    let hit = true;
    for (const [p, q] of [[-dx, a[0] - x0], [dx, x1 - a[0]], [-dy, a[1] - y0], [dy, y1 - a[1]]] as [number, number][]) {
      if (p === 0) { if (q < 0) { hit = false; break; } continue; }
      const t = q / p;
      if (p < 0) { if (t > t1) { hit = false; break; } if (t > t0) t0 = t; }
      else { if (t < t0) { hit = false; break; } if (t < t1) t1 = t; }
    }
    const at = (t: number): [number, number] => [a[0] + dx * t, a[1] + dy * t];
    if (!cur.length && !inside(a)) cur.push(a);
    if (!hit || t1 - t0 < 1e-9) { cur.push(b); continue; }
    if (t0 > 0) cur.push(at(t0));
    if (cur.length >= 2) out.push(cur);
    cur = t1 < 1 ? [at(t1), b] : [];
  }
  if (cur.length >= 2) out.push(cur);
  return out.length ? out : [];
}

// ---- stream tables ---------------------------------------------------------------------------------------------

export interface StreamRow { id: string; name: string; route: string; unit: string; values: string[] }

/** Streams of one drawing (MAP = the transfers), with the applied MB flow values per scenario. */
export function streamRows(p: Pick<Project, "pfd" | "streams" | "uos" | "mb">, scope: string): StreamRow[] {
  const names = streamNamesOf(p.pfd);
  const flows = flowValues(p.mb.current);
  const scen = p.mb.scenarios;
  const ids = Object.entries(p.streams.active)
    .filter(([, o]) => (scope === "map" ? o.kind === "transfer" : o.kind === "pfd" ? o.uoId === scope : o.fromUoId === scope || o.toUoId === scope))
    .map(([id]) => id)
    .sort((a, b) => {
      // Incoming transfers first, the drawing's own streams, then outgoing transfers.
      const rank = (id: string) => { const o = p.streams.active[id]; return o.kind === "pfd" ? 1 : o.toUoId === scope ? 0 : 2; };
      return scope === "map" ? (p.uos.find((u) => u.id === p.streams.active[a].fromUoId)?.order ?? 0) - (p.uos.find((u) => u.id === p.streams.active[b].fromUoId)?.order ?? 0) : rank(a) - rank(b) || a.localeCompare(b);
    });
  return ids.map((id) => {
    const f = flows.get(id);
    return { id, name: names.get(id) ?? "", route: streamRoute(p, id), unit: f?.unit ?? "", values: scen.map((s) => (f ? fmtQty(f.values[s.id]) : "")) };
  });
}

// ---- the deck -------------------------------------------------------------------------------------------------

export interface DeckOptions {
  /** "map" and UO ids, in slide order. */
  slides: string[];
  mode: "shapes" | "pictures";
  /** A stream table slide after each drawing. */
  streamTables: boolean;
  /** pictures mode: the drawing as a PNG data URL with its pixel size. */
  picture?: (scope: string) => Promise<{ dataURL: string; width: number; height: number }>;
  /** Drawing elements and files per scope (the one on screen may be newer than the project). */
  sheet: (scope: string) => { elements: readonly unknown[]; files: Record<string, unknown> };
  onProgress?: (done: number, total: number) => void;
  /** "blob" in the browser, "nodebuffer" in tests. */
  output?: "blob" | "nodebuffer";
}

const INK = "1F3A5F";
const MUTED = "6B7780";

export async function buildPfdDeck(p: Project, opts: DeckOptions): Promise<Blob | Uint8Array> {
  const { default: PptxGenJS } = await import("pptxgenjs");
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.title = `${p.meta.name} PFD`;
  pptx.company = "PCS Platform";
  const date = new Date().toISOString().slice(0, 10);
  const scen = p.mb.scenarios;
  const mbNote = p.mb.current ? `MB: ${p.mb.current.fileName ?? "applied"} (${p.mb.current.importedAt.slice(0, 10)})` : "No mass balance applied";
  const uoOf = (id: string): UnitOperation | undefined => p.uos.find((u) => u.id === id);
  const titleOf = (scope: string) => (scope === "map" ? "Process map" : `${uoOf(scope)?.code ?? "?"} · ${uoOf(scope)?.name ?? ""}`);
  const S = pptx.ShapeType;

  const frame = (slide: ReturnType<typeof pptx.addSlide>, title: string, sub?: string) => {
    slide.background = { color: "FFFFFF" };
    slide.addText(title, { x: 0.4, y: 0.22, w: 10.5, h: 0.55, fontFace: "Arial", fontSize: 22, bold: true, color: INK, margin: 0 });
    if (sub) slide.addText(sub, { x: 10.9, y: 0.3, w: 2.03, h: 0.4, fontFace: "Arial", fontSize: 10, color: MUTED, align: "right", margin: 0 });
    slide.addShape(S.line, { x: 0.4, y: 0.82, w: 12.53, h: 0, line: { color: "D5DDE2", width: 0.75 } });
    slide.addText(`${p.meta.name} · PFD · ${date} · ${mbNote}`, { x: 0.4, y: 7.08, w: 12.53, h: 0.3, fontFace: "Arial", fontSize: 8, color: MUTED, margin: 0 });
  };

  const total = opts.slides.length * (opts.streamTables ? 2 : 1);
  let done = 0;
  for (const scope of opts.slides) {
    const slide = pptx.addSlide();
    frame(slide, titleOf(scope), scope === "map" ? `${p.uos.length} unit operations` : "Drawing");
    if (opts.mode === "pictures" && opts.picture) {
      const pic = await opts.picture(scope);
      const { s, ox, oy } = fitBox(pic.width, pic.height);
      slide.addImage({ data: pic.dataURL.replace(/^data:/, ""), x: ox, y: oy, w: pic.width * s, h: pic.height * s });
    } else {
      const { elements, files } = opts.sheet(scope);
      for (const op of drawingOps(elements, files)) {
        if (op.kind === "shape") {
          const shape = { rect: S.rect, roundRect: S.roundRect, ellipse: S.ellipse, diamond: S.diamond }[op.shape];
          slide.addShape(shape, {
            x: op.x, y: op.y, w: op.w, h: op.h, rotate: op.rotate || undefined,
            line: op.line ? { color: op.line.color, width: op.line.width, dashType: op.line.dash, transparency: op.line.transparency } : { type: "none" },
            fill: op.fill ? { color: op.fill.color, transparency: op.fill.transparency } : { type: "none" },
            ...(op.radius != null ? { rectRadius: op.radius } : {}),
          });
        } else if (op.kind === "path") {
          // Free-form path: in PptxGenJS at run time, not in its type list.
          slide.addShape("custGeom" as unknown as typeof S.rect, {
            x: op.x, y: op.y, w: op.w, h: op.h, rotate: op.rotate || undefined,
            points: [...op.points.map((pt, i) => (i === 0 ? { ...pt, moveTo: true } : pt)), ...(op.closed ? [{ close: true as const }] : [])],
            line: op.line ? { color: op.line.color, width: op.line.width, dashType: op.line.dash, transparency: op.line.transparency, beginArrowType: op.begin, endArrowType: op.end } : { type: "none" },
            fill: op.fill ? { color: op.fill.color, transparency: op.fill.transparency } : { type: "none" },
          });
        } else if (op.kind === "text") {
          slide.addText(op.text, {
            x: op.x, y: op.y, w: op.w, h: op.h, rotate: op.rotate || undefined, fontFace: op.fontFace, fontSize: op.fontSize, color: op.color,
            align: op.align, valign: op.valign, margin: 0, lineSpacingMultiple: op.lineSpacing, wrap: false, fit: "none",
            ...(op.fill ? { fill: { color: op.fill } } : {}),
          });
        } else {
          slide.addImage({ data: op.data.replace(/^data:/, ""), x: op.x, y: op.y, w: op.w, h: op.h, rotate: op.rotate || undefined });
        }
      }
    }
    opts.onProgress?.(++done, total);

    if (opts.streamTables) {
      const rows = streamRows(p, scope);
      const t = pptx.addSlide();
      frame(t, `${titleOf(scope)} · streams`, `${rows.length} stream${rows.length === 1 ? "" : "s"}`);
      const head = ["Stream ID", "Name", "Route", "Unit", ...scen.map((s) => s.name)].map((text) => ({ text, options: { bold: true, color: "FFFFFF", fill: { color: INK } } }));
      const body = rows.length
        ? rows.map((r) => [r.id, r.name, r.route, r.unit, ...r.values].map((text, i) => ({ text, options: i >= 4 ? { align: "right" as const } : {} })))
        : [[{ text: "No streams in this drawing.", options: { colspan: 4 + scen.length, color: MUTED } }]];
      const widths = [1.9, 4.2, 1.9, 0.8, ...scen.map(() => (12.53 - 8.8) / Math.max(1, scen.length))];
      t.addTable([head, ...body], {
        x: 0.4, y: 1.0, w: 12.53, colW: widths, fontFace: "Arial", fontSize: 10, color: "1E1E1E",
        border: { type: "solid", color: "D5DDE2", pt: 0.5 }, rowH: 0.28, valign: "middle",
        autoPage: true, autoPageRepeatHeader: true, autoPageSlideStartY: 1.0, newSlideStartY: 1.0,
      });
      opts.onProgress?.(++done, total);
    }
  }
  // PptxGenJS 4.0.1 ignores `compression` when an output type is given: zip it again, compressed.
  const raw = (await pptx.write({ outputType: "arraybuffer" })) as ArrayBuffer;
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(raw);
  if (opts.output === "nodebuffer") return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  return zip.generateAsync({ type: "blob", compression: "DEFLATE", mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation" });
}
