/**
 * Tables on the PFD board are SVG images, so they look the same on screen, in image export and in
 * print. The table's data rides on the image element (customData.pcs.table) and the picture is
 * redrawn from it: the stream table follows the streams automatically, a free table is edited in
 * the side panel.
 */

export interface TableData {
  kind: "stream" | "free";
  rows: string[][];
  /** Natural size of the last drawing; the element may be scaled from it. */
  size?: { w: number; h: number };
}

const FONT = 13;
const PAD_X = 8;
const ROW_H = 24;

const SANS = "Arial, 'Liberation Sans', 'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif";
const MONO = "Consolas, 'Cascadia Mono', 'Liberation Mono', monospace";

/** Rough text width: wide for CJK, narrow for Latin; used where the browser cannot measure. */
export function estimateWidth(s: string, size = FONT): number {
  let w = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 0;
    w += c > 0x2e80 ? size : c === 32 ? size * 0.28 : /[ilI.,:;|!'1]/.test(ch) ? size * 0.3 : /[A-Z0-9mwMW_]/.test(ch) ? size * 0.68 : size * 0.56;
  }
  return w;
}

let ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null | undefined;
/** Text width as the browser draws it (the table picture uses the same fonts), with a little slack. */
export function textWidth(s: string, size = FONT, mono = false): number {
  if (ctx === undefined) {
    try { ctx = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(1, 1).getContext("2d") : null; } catch { ctx = null; }
  }
  if (!ctx) return estimateWidth(s, size) * (mono ? 1.08 : 1);
  ctx.font = `${size}px ${mono ? MONO : SANS}`;
  return ctx.measureText(s).width * 1.06 + 2;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function tableSvg(rows: string[][], monoCols: number[] = []): { svg: string; w: number; h: number } {
  const cols = Math.max(1, ...rows.map((r) => r.length));
  const widths = Array.from({ length: cols }, (_, c) =>
    Math.max(48, ...rows.map((r, i) => textWidth(r[c] ?? "", FONT, monoCols.includes(c) && i > 0) * (i === 0 ? 1.08 : 1) + PAD_X * 2)));
  const w = Math.ceil(widths.reduce((a, b) => a + b, 0)) + 1;
  const h = rows.length * ROW_H + 1;
  const xs = widths.reduce<number[]>((acc, cw) => [...acc, acc[acc.length - 1] + cw], [0.5]);
  const texts: string[] = [];
  rows.forEach((r, i) => {
    const y = i * ROW_H;
    for (let c = 0; c < cols; c++) {
      const t = r[c] ?? "";
      if (!t) continue;
      const mono = monoCols.includes(c) && i > 0;
      texts.push(`<text x="${xs[c] + PAD_X}" y="${y + ROW_H / 2 + FONT * 0.36}"${i === 0 ? ' font-weight="700"' : ""}${mono ? ` font-family="${MONO.replace(/'/g, "")}"` : ""}>${esc(t)}</text>`);
    }
  });
  const lines: string[] = [];
  for (let i = 0; i <= rows.length; i++) lines.push(`<line x1="0" x2="${w}" y1="${i * ROW_H + 0.5}" y2="${i * ROW_H + 0.5}"/>`);
  for (const x of xs) lines.push(`<line x1="${x}" x2="${x}" y1="0" y2="${h}"/>`);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<rect width="${w}" height="${h}" fill="#ffffff"/>` +
    `<rect x="0" y="0" width="${w}" height="${ROW_H}" fill="#e8eef1"/>` +
    `<g stroke="#5a6b75" stroke-width="1">${lines.join("")}</g>` +
    `<g font-family="${SANS.replace(/'/g, "")}" font-size="${FONT}" fill="#1e1e1e">${texts.join("")}</g>` +
    `</svg>`;
  return { svg, w, h };
}

export function svgDataUrl(svg: string): string {
  const bytes = new TextEncoder().encode(svg);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:image/svg+xml;base64,${btoa(bin)}`;
}

export const STREAM_TABLE_HEADER = ["Stream ID", "From", "To", "Name"];

export interface TableFlow { unit: string; values: Record<string, number | null> }

/**
 * Rows of the stream table. With an applied Mass Balance (`flows`), it also shows each stream's
 * unit and its value per scenario.
 */
export function streamTableRows(
  streams: { streamId: string; kind: string; uoId?: string; fromUoId?: string; toUoId?: string; name?: string }[],
  codeOf: (id?: string) => string,
  mb?: { flows: ReadonlyMap<string, TableFlow>; scenarios: readonly { id: string; name: string }[]; format: (v: number | null | undefined) => string },
): string[][] {
  const header = mb ? [...STREAM_TABLE_HEADER, "Unit", ...mb.scenarios.map((s) => s.name)] : STREAM_TABLE_HEADER;
  return [header, ...streams.map((s) => {
    const base = [
      s.streamId,
      s.kind === "transfer" ? codeOf(s.fromUoId) : codeOf(s.uoId),
      s.kind === "transfer" ? codeOf(s.toUoId) : "",
      s.name ?? "",
    ];
    if (!mb) return base;
    const f = mb.flows.get(s.streamId);
    return [...base, f?.unit ?? "", ...mb.scenarios.map((sc) => (f ? mb.format(f.values[sc.id]) : ""))];
  })];
}

export function newFreeTable(): string[][] {
  return [["Item", "Value", "Note"], ["", "", ""], ["", "", ""]];
}
