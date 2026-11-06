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
/**
 * A line as PowerPoint draws it. `pattern`: the editor's own dash or dot lengths (in line widths), written as a
 * custom dash with round ends after PptxGenJS (which only knows preset dashes, shorter than the editor's); `dash`
 * is the preset that stands in for it where the custom one is not read.
 */
export interface LineStyle { color: string; width: number; dash?: "dash" | "sysDot"; pattern?: { dash: number; gap: number }; transparency?: number }
export type Op =
  | { kind: "shape"; shape: "rect" | "roundRect" | "ellipse" | "diamond"; x: number; y: number; w: number; h: number; rotate: number; line?: LineStyle; fill?: { color: string; transparency: number }; radius?: number }
  | { kind: "path"; x: number; y: number; w: number; h: number; rotate: number; points: { x: number; y: number; move?: boolean }[]; closed: boolean; line?: LineStyle; fill?: { color: string; transparency: number }; begin: Arrowhead; end: Arrowhead }
  | { kind: "text"; x: number; y: number; w: number; h: number; rotate: number; text: string; fontSize: number; fontFace: string; color: string; align: "left" | "center" | "right"; valign: "top" | "middle" | "bottom"; lineSpacing: number; fill?: string }
  | { kind: "image"; x: number; y: number; w: number; h: number; rotate: number; data: string; px: { w: number; h: number } };

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
    const sw = Math.max(0.1, e.strokeWidth ?? 1);
    const l: LineStyle = { color, width: Math.max(0.25, Number(pt(sw).toFixed(2))) };
    // The editor's dashes are [8, 8 + width] px and dots [1.5, 6 + width] px, with round ends (Excalidraw 0.18).
    if (e.strokeStyle === "dashed") { l.dash = "dash"; l.pattern = { dash: 8 / sw, gap: (8 + sw) / sw }; }
    if (e.strokeStyle === "dotted") { l.dash = "sysDot"; l.pattern = { dash: 1.5 / sw, gap: (6 + sw) / sw }; }
    if (e.opacity != null && e.opacity < 100) l.transparency = 100 - e.opacity;
    return l;
  };
  const hatched = (e: El) => !!hex(e.backgroundColor) && !!e.fillStyle && e.fillStyle !== "solid";
  /** A solid fill (a hatched one is drawn as lines by `hatchOp`). */
  const fillOf = (e: El) => {
    const color = hex(e.backgroundColor);
    if (!color || hatched(e)) return undefined;
    const op = e.opacity != null && e.opacity < 100 ? 100 - e.opacity : 0;
    return { color, transparency: op };
  };
  /**
   * The editor's hatching as one path of lines, in the shape's own box (so it turns with it): lines at -41°,
   * 4 × the stroke width apart and half as thick, in the fill colour; cross-hatch adds the other direction.
   */
  const hatchOp = (e: El, outline: [number, number][]): Op | undefined => {
    const color = hex(e.backgroundColor);
    if (!color || !hatched(e)) return undefined;
    const sw = Math.max(0.1, e.strokeWidth ?? 1);
    const angles = e.fillStyle === "cross-hatch" ? [-41, 49] : [-41];
    const segs = angles.flatMap((a) => hatchLines(outline, a, sw * 4));
    if (!segs.length) return undefined;
    const points = segs.flatMap(([p, q]) => [{ x: Number((p[0] * s).toFixed(4)), y: Number((p[1] * s).toFixed(4)), move: true }, { x: Number((q[0] * s).toFixed(4)), y: Number((q[1] * s).toFixed(4)) }]);
    const transparency = e.opacity != null && e.opacity < 100 ? 100 - e.opacity : undefined;
    return {
      kind: "path", x: X(e.x), y: Y(e.y), w: Math.max(e.width * s, 0.01), h: Math.max(e.height * s, 0.01), rotate: deg(e), points, closed: false,
      line: { color, width: Math.max(0.25, Number(pt(sw / 2).toFixed(2))), ...(transparency ? { transparency } : {}) }, begin: "none", end: "none",
    };
  };
  const deg = (e: El) => Math.round(((e.angle ?? 0) * 180) / Math.PI);

  for (const e of els) {
    switch (e.type) {
      case "rectangle":
      case "ellipse":
      case "diamond": {
        const w = Math.max(e.width * s, 0.01), h = Math.max(e.height * s, 0.01);
        const op: Op = { kind: "shape", shape: e.type === "ellipse" ? "ellipse" : e.type === "diamond" ? "diamond" : "rect", x: X(e.x), y: Y(e.y), w, h, rotate: deg(e) };
        let r = 0;
        if (e.type === "rectangle" && e.roundness) {
          // The editor's corner: a quarter of the shorter side, at most 32 px (adaptive) — Excalidraw getCornerRadius.
          const m = Math.min(e.width, e.height);
          r = e.roundness.type === 3 ? Math.min(e.roundness.value ?? 32, m * 0.25) : m * 0.25;
          op.shape = "roundRect";
          // In inches: PptxGenJS writes rectRadius / shorter side (its docs say 0–1, its code reads inches). A
          // 0–1 value made small rounded boxes (a single-use bag) come out as ovals.
          op.radius = Number((Math.max(0, Math.min(r, m / 2)) * s).toFixed(4));
        }
        const line = lineOf(e);
        const fill = fillOf(e); if (fill) op.fill = fill;
        const hatch = hatchOp(e, outlineOf(e.type, e.width, e.height, r));
        if (hatch) ops.push(hatch);
        // A dashed outline starts its dashes where the editor's do: on a box or diamond at every corner (rough.js
        // draws the sides one by one), on an ellipse at its rightmost point, going clockwise. So it becomes a path
        // over the filled (outline-less) shape. A rounded box keeps its own outline.
        if (line?.pattern && !(e.type === "rectangle" && e.roundness)) {
          if (op.fill) ops.push(op);
          const o = outlineOf(e.type, e.width, e.height, 0);
          const at = (p: [number, number], move?: boolean) => ({ x: Number((p[0] * s).toFixed(4)), y: Number((p[1] * s).toFixed(4)), ...(move ? { move: true } : {}) });
          const points = e.type === "ellipse" ? [...o, o[0]].map((p, i) => at(p, i === 0)) : o.flatMap((p, i) => [at(p, true), at(o[(i + 1) % o.length])]);
          ops.push({ kind: "path", x: op.x, y: op.y, w: op.w, h: op.h, rotate: op.rotate, points, closed: false, line, begin: "none", end: "none" });
          break;
        }
        if (line) op.line = line;
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
          if (closed && i === 0 && pieces.length === 1) {
            const hatch = hatchOp({ ...e, x: minX, y: minY, width: maxX - minX, height: maxY - minY, angle: 0 }, piece.map(([px, py]) => [px - minX, py - minY] as [number, number]));
            if (hatch) ops.push(hatch);
          }
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
        if (f?.dataURL) ops.push({ kind: "image", x: X(e.x), y: Y(e.y), w: e.width * s, h: e.height * s, rotate: deg(e), data: f.dataURL, px: { w: e.width, h: e.height } });
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
  /** A picture that could not be read was left out (the rest of the deck is made): where it was. */
  onSkip?: (where: string) => void;
  /** "blob" in the browser, "nodebuffer" in tests. */
  output?: "blob" | "nodebuffer";
}

// ---- dashes, hatching and outlines as the editor draws them -------------------------------------------------------------

const DASH_MARK = "PCSDASH";
/** A shape with the editor's dash pattern is named so that `withEditorDashes` finds it in the slide XML. */
const dashName = (line?: LineStyle) =>
  line?.pattern ? { objectName: `${DASH_MARK}-${Math.round(line.pattern.dash * 100000)}-${Math.round(line.pattern.gap * 100000)}` } : {};

/**
 * Slide XML with lines as the editor draws them: round ends and round corners on every line, and on each marked
 * shape the editor's dash instead of the preset one (a custom dash, lengths in line widths, 100000 = 1); that
 * shape gets a plain name back.
 */
export function withEditorDashes(xml: string): string {
  return xml.replace(/<p:sp>[\s\S]*?<\/p:sp>/g, (sp) => {
    const m = new RegExp(`name="${DASH_MARK}-(\\d+)-(\\d+)"`).exec(sp);
    let out = sp;
    if (m) {
      out = out.replace(m[0], 'name="Dashed line"').replace(/<a:prstDash val="[^"]*"\/>/, `<a:custDash><a:ds d="${m[1]}" sp="${m[2]}"/></a:custDash>`);
    }
    // Inside <a:ln>: fill, dash, then the corner style (schema order), then the arrowheads.
    return out.replace(/<a:ln w="(\d+)">((?:<a:solidFill>[\s\S]*?<\/a:solidFill>|<a:noFill\/>)?)((?:<a:prstDash val="[^"]*"\/>|<a:custDash>[\s\S]*?<\/a:custDash>)?)/,
      '<a:ln w="$1" cap="rnd">$2$3<a:round/>');
  });
}

/** The outline of a rectangle (corner radius r), ellipse or diamond of w × h, as a polygon in its own box. */
export function outlineOf(type: string, w: number, h: number, r = 0): [number, number][] {
  if (type === "ellipse") return Array.from({ length: 64 }, (_, i) => { const a = (i / 64) * Math.PI * 2; return [w / 2 + (w / 2) * Math.cos(a), h / 2 + (h / 2) * Math.sin(a)] as [number, number]; });
  if (type === "diamond") return [[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]];
  if (r <= 0) return [[0, 0], [w, 0], [w, h], [0, h]];
  const pts: [number, number][] = [];
  const corner = (cx: number, cy: number, from: number) => { for (let i = 0; i <= 8; i++) { const a = ((from + (i / 8) * 90) * Math.PI) / 180; pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); } };
  corner(w - r, r, -90); corner(w - r, h - r, 0); corner(r, h - r, 90); corner(r, r, 180);
  return pts;
}

/** Hatch lines inside a polygon: parallel lines at `angle` degrees (y down), `gap` apart, cut to the polygon. */
export function hatchLines(poly: [number, number][], angle: number, gap: number): [[number, number], [number, number]][] {
  if (poly.length < 3 || gap <= 0) return [];
  const a = (angle * Math.PI) / 180;
  const d: [number, number] = [Math.cos(a), Math.sin(a)];
  const n: [number, number] = [-d[1], d[0]];
  const dot = (p: [number, number], v: [number, number]) => p[0] * v[0] + p[1] * v[1];
  const ts = poly.map((p) => dot(p, n));
  const lo = Math.min(...ts), hi = Math.max(...ts);
  const out: [[number, number], [number, number]][] = [];
  for (let t = lo + gap / 2; t < hi; t += gap) {
    const hits: [number, number][] = [];
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i], q = poly[(i + 1) % poly.length];
      const vp = dot(p, n) - t, vq = dot(q, n) - t;
      if ((vp < 0 && vq >= 0) || (vp >= 0 && vq < 0)) {
        const k = vp / (vp - vq);
        hits.push([p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k]);
      }
    }
    hits.sort((u, v) => dot(u, d) - dot(v, d));
    for (let i = 0; i + 1 < hits.length; i += 2) out.push([hits[i], hits[i + 1]]);
  }
  return out;
}

// ---- pictures for PptxGenJS ------------------------------------------------------------------------------------------

const toBase64 = (bytes: Uint8Array) => {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};
const fromBase64 = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

/**
 * A drawing's picture (a data URL) as PptxGenJS takes it, or null when it cannot be read.
 * - Most pictures: "image/png;base64,…" (PptxGenJS wants the header without "data:").
 * - SVG (the stream tables on a drawing, uploaded SVG symbols): PptxGenJS draws it into an <img> to make the PNG copy
 *   PowerPoint also needs, using the text it was given as the image address. Without "data:" the browser takes it
 *   for a file path, the request fails (404) and so did the whole export. An SVG therefore keeps "data:", is base64
 *   (also when it came as plain text), and gets a width and height (the picture's size on the drawing) when it has
 *   none, since an <img> of an SVG without a size has nothing to draw.
 */
export function pptxImageData(dataURL: string, width: number, height: number): string | null {
  const m = /^data:([^;,]+)((?:;[^,]*)?),([\s\S]*)$/.exec(dataURL.trim());
  if (!m) return null;
  const mime = m[1].trim().toLowerCase();
  const isBase64 = /;base64/i.test(m[2]);
  const payload = isBase64 ? m[3].replace(/\s+/g, "") : m[3];
  let bytes: Uint8Array;
  try { bytes = isBase64 ? fromBase64(payload) : new TextEncoder().encode(decodeURIComponent(payload)); } catch { return null; }
  if (!bytes.length) return null;
  if (mime !== "image/svg+xml") return `${mime};base64,${isBase64 ? payload : toBase64(bytes)}`;
  const svg = withSvgSize(new TextDecoder().decode(bytes), width, height);
  return svg === null ? null : `data:image/svg+xml;base64,${toBase64(new TextEncoder().encode(svg))}`;
}

/** The SVG with a width and height in pixels on its root element: kept when it has them, else `width` × `height`. */
export function withSvgSize(svg: string, width: number, height: number): string | null {
  const open = /<svg\b[^>]*>/i.exec(svg);
  if (!open) return null;
  const tag = open[0];
  const attr = (k: string) => new RegExp(`\\s${k}\\s*=\\s*(["'])([^"']*)\\1`, "i").exec(tag)?.[2];
  const absolute = (v?: string) => v !== undefined && /^\s*\d+(\.\d+)?\s*(px)?\s*$/i.test(v);
  if (absolute(attr("width")) && absolute(attr("height"))) return svg;
  const w = Math.max(1, Math.round(width)), h = Math.max(1, Math.round(height));
  const fixed = tag.replace(/\s(width|height)\s*=\s*(["'])[^"']*\2/gi, "").replace(/^<svg\b/i, `<svg width="${w}" height="${h}"`);
  return svg.slice(0, open.index) + fixed + svg.slice(open.index + tag.length);
}

/** In the browser: the data only when an <img> can show it (PptxGenJS fails the whole deck otherwise). */
async function placeable(data: string | null): Promise<string | null> {
  if (!data || !data.startsWith("data:image/svg+xml") || typeof Image === "undefined") return data;
  return new Promise((resolve) => {
    const img = new Image();
    const done = (ok: boolean) => { clearTimeout(timer); resolve(ok ? data : null); };
    const timer = setTimeout(() => done(false), 8000);
    img.onload = () => done(img.width + img.height > 0);
    img.onerror = () => done(false);
    img.src = data;
  });
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
      const data = await placeable(pptxImageData(pic.dataURL, pic.width, pic.height));
      if (data) slide.addImage({ data, x: ox, y: oy, w: pic.width * s, h: pic.height * s });
      else opts.onSkip?.(titleOf(scope));
    } else {
      const { elements, files } = opts.sheet(scope);
      for (const op of drawingOps(elements, files)) {
        if (op.kind === "shape") {
          const shape = { rect: S.rect, roundRect: S.roundRect, ellipse: S.ellipse, diamond: S.diamond }[op.shape];
          slide.addShape(shape, {
            x: op.x, y: op.y, w: op.w, h: op.h, rotate: op.rotate || undefined, ...dashName(op.line),
            line: op.line ? { color: op.line.color, width: op.line.width, dashType: op.line.dash, transparency: op.line.transparency } : { type: "none" },
            fill: op.fill ? { color: op.fill.color, transparency: op.fill.transparency } : { type: "none" },
            ...(op.radius != null ? { rectRadius: op.radius } : {}),
          });
        } else if (op.kind === "path") {
          // Free-form path: in PptxGenJS at run time, not in its type list.
          slide.addShape("custGeom" as unknown as typeof S.rect, {
            x: op.x, y: op.y, w: op.w, h: op.h, rotate: op.rotate || undefined, ...dashName(op.line),
            points: [...op.points.map((pt, i) => (i === 0 || pt.move ? { x: pt.x, y: pt.y, moveTo: true } : { x: pt.x, y: pt.y })), ...(op.closed ? [{ close: true as const }] : [])],
            line: op.line ? { color: op.line.color, width: op.line.width, dashType: op.line.dash, transparency: op.line.transparency, beginArrowType: op.begin, endArrowType: op.end } : { type: "none" },
            fill: op.fill ? { color: op.fill.color, transparency: op.fill.transparency } : { type: "none" },
          });
        } else if (op.kind === "text") {
          slide.addText(op.text, {
            x: op.x, y: op.y, w: op.w, h: op.h, rotate: op.rotate || undefined, fontFace: op.fontFace, fontSize: op.fontSize, color: op.color,
            // Exact line spacing (font size × the editor's line height) puts every line where the editor has it;
            // a multiple adds its extra space above the first line and moved all text down.
            align: op.align, valign: op.valign, margin: 0, lineSpacing: Number((op.fontSize * op.lineSpacing).toFixed(2)), wrap: false, fit: "none",
            ...(op.fill ? { fill: { color: op.fill } } : {}),
          });
        } else {
          // One unreadable picture leaves only itself out, not the whole deck.
          const data = await placeable(pptxImageData(op.data, op.px.w, op.px.h));
          if (data) slide.addImage({ data, x: op.x, y: op.y, w: op.w, h: op.h, rotate: op.rotate || undefined });
          else opts.onSkip?.(titleOf(scope));
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
  for (const name of Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))) {
    const xml = await zip.file(name)!.async("string");
    const fixed = withEditorDashes(xml);
    if (fixed !== xml) zip.file(name, fixed);
  }
  if (opts.output === "nodebuffer") return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  return zip.generateAsync({ type: "blob", compression: "DEFLATE", mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation" });
}
