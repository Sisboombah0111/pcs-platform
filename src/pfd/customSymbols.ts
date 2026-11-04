/**
 * Symbols the user adds to the PFD palette: pictures (SVG, PNG, JPEG, WebP), shapes saved from a
 * drawing, items of an Excalidraw library file, and symbol set files to share between projects.
 * Pure: the editor-side insertion lives in excalidraw.ts, file reading in the view.
 */
import { newId } from "../model/ids";
import type { CustomSymbol } from "../model/types";

export const SYMBOL_SET_FORMAT = "pcs-symbols";
export const MY_SYMBOLS = "My symbols";
/** Largest picture accepted, in bytes (kept in the project file as a data URL). */
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
export const IMAGE_TYPES = ["image/svg+xml", "image/png", "image/jpeg", "image/webp", "image/gif"];

const isObj = (x: unknown): x is Record<string, unknown> => x !== null && typeof x === "object" && !Array.isArray(x);
const str = (x: unknown) => (typeof x === "string" ? x : "");

interface El {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  isDeleted?: boolean;
  points?: [number, number][];
  text?: string;
  fontSize?: number;
  fileId?: string | null;
  strokeStyle?: string;
  backgroundColor?: string;
  containerId?: string | null;
  frameId?: string | null;
  customData?: Record<string, unknown>;
  [k: string]: unknown;
}

/** Keep the symbols that can be used; count the rest. */
export function cleanSymbols(list: unknown[]): { symbols: CustomSymbol[]; dropped: number } {
  const out: CustomSymbol[] = [];
  const seen = new Set<string>();
  let dropped = 0;
  for (const raw of list) {
    const s = cleanSymbol(raw);
    if (!s) { dropped++; continue; }
    if (seen.has(s.id)) s.id = newId("sym");
    seen.add(s.id);
    out.push(s);
  }
  return { symbols: out, dropped };
}

function cleanSymbol(raw: unknown): CustomSymbol | null {
  if (!isObj(raw)) return null;
  const name = str(raw.name).trim();
  const base = { id: str(raw.id) || newId("sym"), name: name || "Symbol", category: str(raw.category).trim() || MY_SYMBOLS, createdAt: str(raw.createdAt) || new Date().toISOString() };
  if (raw.kind === "image" && isObj(raw.image)) {
    const im = raw.image;
    const mimeType = str(im.mimeType), dataURL = str(im.dataURL);
    const width = Number(im.width), height = Number(im.height);
    if (!IMAGE_TYPES.includes(mimeType) || !dataURL.startsWith(`data:${mimeType}`) || !(width > 0) || !(height > 0)) return null;
    return { ...base, kind: "image", image: { mimeType, dataURL, width, height } };
  }
  if (raw.kind === "shapes" && Array.isArray(raw.elements)) {
    const els = (raw.elements as El[]).filter((e) => isObj(e) && typeof e.id === "string" && typeof e.type === "string" && !e.isDeleted);
    if (!els.length) return null;
    return { ...base, kind: "shapes", elements: els, files: isObj(raw.files) ? raw.files : {} };
  }
  return null;
}

/** Shapes from a drawing, ready to keep as a symbol: moved to (0, 0), without app data or frame. */
export function normalizeShapes(elements: readonly unknown[]): El[] {
  const els = (elements as El[]).filter((e) => isObj(e) && !e.isDeleted && e.type !== "frame" && e.type !== "magicframe");
  if (!els.length) return [];
  const x0 = Math.min(...els.map((e) => e.x)), y0 = Math.min(...els.map((e) => e.y));
  const ids = new Set(els.map((e) => e.id));
  return els.map((e) => {
    const out: El = { ...e, x: e.x - x0, y: e.y - y0, frameId: null };
    const pcs = isObj(e.customData?.pcs) ? (e.customData!.pcs as Record<string, unknown>) : null;
    if (pcs) {
      // Stream IDs, material links and app labels belong to the drawing, not to the symbol.
      const rest = { ...e.customData };
      delete rest.pcs;
      out.customData = Object.keys(rest).length ? rest : undefined;
    }
    if (out.containerId && !ids.has(out.containerId)) out.containerId = null;
    if (Array.isArray(out.boundElements)) out.boundElements = (out.boundElements as { id: string }[]).filter((b) => ids.has(b.id));
    for (const k of ["startBinding", "endBinding"] as const) {
      const b = out[k] as { elementId?: string } | null | undefined;
      if (b && !ids.has(b.elementId ?? "")) out[k] = null;
    }
    return out;
  });
}

/** A symbol made of shapes (from a selection, or an Excalidraw library item). */
export function shapesSymbol(name: string, elements: readonly unknown[], files: Record<string, unknown> = {}, category = MY_SYMBOLS, now = new Date().toISOString()): CustomSymbol | null {
  const els = normalizeShapes(elements);
  if (!els.length) return null;
  const used: Record<string, unknown> = {};
  for (const e of els) if (e.type === "image" && e.fileId && files[e.fileId]) used[e.fileId] = files[e.fileId];
  return { id: newId("sym"), name: name.trim() || "Symbol", category, kind: "shapes", elements: els, files: used, createdAt: now };
}

/** A symbol from a picture already read as a data URL. */
export function imageSymbol(name: string, mimeType: string, dataURL: string, width: number, height: number, category = MY_SYMBOLS, now = new Date().toISOString()): CustomSymbol {
  return { id: newId("sym"), name: name.trim() || "Symbol", category, kind: "image", image: { mimeType, dataURL, width, height }, createdAt: now };
}

/** A file name without its extension, tidied: "sterile-filter_0.2um.svg" → "sterile filter 0.2um". */
export function nameFromFile(file: string): string {
  return file.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim() || "Symbol";
}

/** Symbols in an Excalidraw library file (.excalidrawlib, version 1 or 2). */
export function fromExcalidrawLib(json: unknown, now = new Date().toISOString()): CustomSymbol[] {
  if (!isObj(json)) return [];
  const items: { name?: string; elements: unknown[] }[] = [];
  if (Array.isArray(json.libraryItems)) {
    for (const it of json.libraryItems) if (isObj(it) && Array.isArray(it.elements)) items.push({ name: str(it.name), elements: it.elements });
  } else if (Array.isArray(json.library)) {
    for (const els of json.library) if (Array.isArray(els)) items.push({ elements: els });
  }
  const out: CustomSymbol[] = [];
  items.forEach((it, i) => {
    const s = shapesSymbol(it.name || `Library item ${i + 1}`, it.elements, isObj(json.files) ? json.files : {}, MY_SYMBOLS, now);
    if (s) out.push(s);
  });
  return out;
}

/** A symbol set file, to share symbols between projects. */
export function symbolSetJson(symbols: readonly CustomSymbol[]): string {
  return JSON.stringify({ format: SYMBOL_SET_FORMAT, version: 1, symbols }, null, 1);
}

/** What a dropped or chosen JSON file holds: a symbol set, an Excalidraw library, or nothing usable. */
export function symbolsFromJson(text: string): { symbols: CustomSymbol[]; kind: "set" | "library" | null; dropped: number } {
  let json: unknown;
  try { json = JSON.parse(text); } catch { return { symbols: [], kind: null, dropped: 0 }; }
  if (isObj(json) && json.format === SYMBOL_SET_FORMAT) {
    const { symbols, dropped } = cleanSymbols(Array.isArray(json.symbols) ? json.symbols : []);
    return { symbols, kind: "set", dropped };
  }
  if (isObj(json) && (json.type === "excalidrawlib" || Array.isArray(json.libraryItems) || Array.isArray(json.library))) {
    return { symbols: fromExcalidrawLib(json), kind: "library", dropped: 0 };
  }
  return { symbols: [], kind: null, dropped: 0 };
}

/** Add symbols to a list: the same symbol again is skipped; a different one with a taken id gets a new id. */
export function mergeSymbols(existing: readonly CustomSymbol[], incoming: readonly CustomSymbol[]): { symbols: CustomSymbol[]; added: number; skipped: number } {
  const out = [...existing];
  const byId = new Map(out.map((s) => [s.id, s]));
  const same = (a: CustomSymbol, b: CustomSymbol) => JSON.stringify({ ...a, createdAt: "" }) === JSON.stringify({ ...b, createdAt: "" });
  let added = 0, skipped = 0;
  for (const s of incoming) {
    const have = byId.get(s.id);
    if (have && same(have, s)) { skipped++; continue; }
    const next = have ? { ...s, id: newId("sym") } : s;
    out.push(next);
    byId.set(next.id, next);
    added++;
  }
  return { symbols: out, added, skipped };
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** A small SVG of shapes for the palette (rectangles, ellipses, diamonds, lines, arrows, pen strokes, text, pictures). */
export function shapesPreviewSvg(elements: readonly unknown[], files: Record<string, unknown> = {}, size = 44): string {
  const els = (elements as El[]).filter((e) => isObj(e) && !e.isDeleted);
  if (!els.length) return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"></svg>`;
  const x0 = Math.min(...els.map((e) => e.x)), y0 = Math.min(...els.map((e) => e.y));
  const x1 = Math.max(...els.map((e) => e.x + Math.max(e.width, 1))), y1 = Math.max(...els.map((e) => e.y + Math.max(e.height, 1)));
  const w = x1 - x0, h = y1 - y0, pad = Math.max(w, h) * 0.04 + 1;
  const fill = (e: El) => (e.backgroundColor && e.backgroundColor !== "transparent" ? esc(e.backgroundColor) : "none");
  const dash = (e: El) => (e.strokeStyle === "dashed" ? ' stroke-dasharray="5 4"' : e.strokeStyle === "dotted" ? ' stroke-dasharray="1 3"' : "");
  const body = els.map((e) => {
    if (e.type === "rectangle") return `<rect x="${e.x}" y="${e.y}" width="${e.width}" height="${e.height}" fill="${fill(e)}"${dash(e)}/>`;
    if (e.type === "ellipse") return `<ellipse cx="${e.x + e.width / 2}" cy="${e.y + e.height / 2}" rx="${e.width / 2}" ry="${e.height / 2}" fill="${fill(e)}"${dash(e)}/>`;
    if (e.type === "diamond") return `<polygon points="${e.x + e.width / 2},${e.y} ${e.x + e.width},${e.y + e.height / 2} ${e.x + e.width / 2},${e.y + e.height} ${e.x},${e.y + e.height / 2}" fill="${fill(e)}"${dash(e)}/>`;
    if ((e.type === "line" || e.type === "arrow" || e.type === "freedraw") && Array.isArray(e.points)) {
      return `<polyline points="${e.points.map(([a, b]) => `${e.x + a},${e.y + b}`).join(" ")}" fill="${e.type === "line" ? fill(e) : "none"}"${dash(e)}/>`;
    }
    if (e.type === "text" && e.text) {
      const s = Number(e.fontSize) || 16;
      return e.text.split("\n").map((t, i) => `<text x="${e.x}" y="${e.y + s * (i + 0.9)}" font-size="${s}" font-family="Arial, sans-serif" fill="currentColor" stroke="none">${esc(t)}</text>`).join("");
    }
    if (e.type === "image" && e.fileId && isObj(files[e.fileId])) {
      const url = str((files[e.fileId] as Record<string, unknown>).dataURL);
      if (/^data:image\/(png|jpeg|webp|gif|svg\+xml)[;,]/.test(url)) return `<image href="${esc(url)}" x="${e.x}" y="${e.y}" width="${e.width}" height="${e.height}"/>`;
    }
    return "";
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="${x0 - pad} ${y0 - pad} ${w + pad * 2} ${h + pad * 2}" stroke="currentColor" stroke-width="${Math.max(w, h) / size * 1.6}" stroke-linejoin="round" stroke-linecap="round">${body}</svg>`;
}

/** The palette picture of a custom symbol, as an image URL (never inserted as markup). */
export function customPreviewUrl(s: CustomSymbol): string {
  if (s.kind === "image" && s.image) return s.image.dataURL;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(shapesPreviewSvg(s.elements ?? [], s.files ?? {}).replace(/currentColor/g, "#1e1e1e"))}`;
}

/** Size to insert a picture at: its own size, scaled to fit 96 px on the longer side (at least 32). */
export function insertSize(width: number, height: number, max = 96): { width: number; height: number } {
  const k = Math.min(1, max / Math.max(width, height));
  const w = Math.max(8, width * k), hh = Math.max(8, height * k);
  const up = Math.max(1, 32 / Math.max(w, hh));
  return { width: Math.round(w * up), height: Math.round(hh * up) };
}
