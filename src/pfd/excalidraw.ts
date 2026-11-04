/**
 * Everything that needs Excalidraw at runtime: building symbol elements, measuring the texts the
 * app writes, and the check for "the user is in the middle of an edit". The rules live in sync.ts.
 */
import { FONT_FAMILY, ROUNDNESS, convertToExcalidrawElements, restoreElements } from "@excalidraw/excalidraw";
import type { AppState, BinaryFileData, DataURL } from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement, FileId } from "@excalidraw/excalidraw/element/types";
import { newId } from "../model/ids";
import type { CustomSymbol } from "../model/types";
import { insertSize } from "./customSymbols";
import type { BoardElement } from "./sync";
import { placeText } from "./shapes";
import { partsBounds, type SymbolDef } from "./symbols";

export const LABEL_COLOR = "#0b6585";
export const DRAW_FONT = FONT_FAMILY["Liberation Sans"];
const STROKE = "#1e1e1e";

type Skeleton = Parameters<typeof convertToExcalidrawElements>[0] extends readonly (infer T)[] | null | undefined ? T : never;

/** The name label under a symbol, centred on the shapes' bounds (measured by Excalidraw). */
function labelUnder(text: string, b: { x: number; y: number; width: number; height: number }): ExcalidrawElement {
  const [t] = convertToExcalidrawElements([{ type: "text", x: b.x, y: b.y + b.height + 8, text, fontSize: 14, fontFamily: DRAW_FONT, strokeColor: STROKE } as Skeleton], { regenerateIds: true });
  return { ...t, x: b.x + b.width / 2 - t.width / 2 } as ExcalidrawElement;
}

/** Elements for one symbol, grouped, with its top-left at (x, y). The body carries customData.pcs.symbol. */
export function symbolElements(def: Pick<SymbolDef, "id" | "parts" | "label">, x: number, y: number, frameId: string | null): ExcalidrawElement[] {
  const skeletons: Skeleton[] = def.parts.map((p) => {
    const common = { strokeColor: STROKE, strokeWidth: 1.5, roughness: 0 } as const;
    if (p.type === "text") {
      return { type: "text", x: x + p.x, y: y + p.y, text: p.text, fontSize: p.size ?? 14, fontFamily: DRAW_FONT, strokeColor: STROKE } as Skeleton;
    }
    if (p.type === "line") {
      return {
        ...common, type: "line", x: x + p.x, y: y + p.y, points: p.pts,
        backgroundColor: p.fill ?? "transparent", fillStyle: "solid", strokeStyle: p.dashed ? "dashed" : "solid",
      } as unknown as Skeleton;
    }
    return {
      ...common, type: p.type, x: x + p.x, y: y + p.y, width: p.w, height: p.h,
      backgroundColor: p.fill ?? "transparent", fillStyle: p.hatch ? "hachure" : "solid",
      strokeStyle: p.dashed ? "dashed" : "solid",
      roundness: p.round ? { type: ROUNDNESS.ADAPTIVE_RADIUS } : null,
    } as Skeleton;
  });
  const els = convertToExcalidrawElements(skeletons, { regenerateIds: true });
  const b = partsBounds(def.parts);
  const all = def.label ? [...els, labelUnder(def.label, { ...b, x: x + b.x, y: y + b.y })] : els;
  const groupId = newId("grp");
  return all.map((e, i) => ({
    ...e,
    groupIds: [groupId],
    frameId,
    customData: i === 0 ? { pcs: { symbol: def.id } } : e.customData,
  })) as ExcalidrawElement[];
}

/**
 * Elements for a symbol the user added, grouped, with its top-left at (x, y), and the images it needs.
 * A picture gets its name label underneath; saved shapes come back exactly as they were saved.
 */
export function customSymbolElements(sym: CustomSymbol, x: number, y: number, frameId: string | null): { elements: ExcalidrawElement[]; files: BinaryFileData[] } {
  const groupId = newId("grp");
  if (sym.kind === "image" && sym.image) {
    const fileId = `sym_${sym.id}` as FileId;
    const size = insertSize(sym.image.width, sym.image.height);
    const [img] = convertToExcalidrawElements([{ type: "image", x, y, width: size.width, height: size.height, fileId }], { regenerateIds: true });
    const label = labelUnder(sym.name, { x, y, width: size.width, height: size.height });
    const elements = [{ ...img, customData: { pcs: { symbol: sym.id } } }, label].map((e) => ({ ...e, groupIds: [groupId], frameId })) as ExcalidrawElement[];
    return { elements, files: [{ id: fileId, mimeType: sym.image.mimeType as BinaryFileData["mimeType"], dataURL: sym.image.dataURL as DataURL, created: Date.now() }] };
  }
  // Saved shapes: new ids everywhere (groups, bound texts, arrow bindings), moved into place.
  const src = (sym.elements ?? []) as (ExcalidrawElement & Record<string, unknown>)[];
  const idMap = new Map(src.map((e) => [e.id, newId("el")]));
  const groupMap = new Map<string, string>();
  const gid = (g: string) => { if (!groupMap.has(g)) groupMap.set(g, newId("grp")); return groupMap.get(g)!; };
  const bodyIndex = Math.max(0, src.findIndex((e) => e.type !== "text"));
  const copies = src.map((e, i) => {
    const out: Record<string, unknown> = {
      ...e, id: idMap.get(e.id), x: e.x + x, y: e.y + y, frameId,
      groupIds: [...(e.groupIds ?? []).map(gid), groupId],
      seed: Math.floor(Math.random() * 2 ** 31), version: 1, versionNonce: Math.floor(Math.random() * 2 ** 31), index: null, updated: Date.now(),
    };
    if (e.type === "text" && (e as { containerId?: string | null }).containerId) out.containerId = idMap.get((e as { containerId: string }).containerId) ?? null;
    if (Array.isArray(e.boundElements)) out.boundElements = e.boundElements.filter((b) => idMap.has(b.id)).map((b) => ({ ...b, id: idMap.get(b.id)! }));
    for (const k of ["startBinding", "endBinding"] as const) {
      const bnd = e[k] as { elementId: string } | null | undefined;
      if (bnd) out[k] = idMap.has(bnd.elementId) ? { ...bnd, elementId: idMap.get(bnd.elementId) } : null;
    }
    if (i === bodyIndex) out.customData = { ...((e.customData as Record<string, unknown>) ?? {}), pcs: { symbol: sym.id } };
    return out;
  });
  const elements = restoreElements(copies as unknown as ExcalidrawElement[], null, { refreshDimensions: true, repairBindings: true });
  const files = Object.values(sym.files ?? {}).filter((f) => f && typeof f === "object" && "id" in (f as object)) as BinaryFileData[];
  return { elements: elements as ExcalidrawElement[], files };
}

/**
 * Measure texts the app wrote (labels, UO box texts, connector texts) the way the editor does, and
 * centre them on their containers again. Text inside a shape is wrapped to fit, and the shape grows
 * when the text needs more height. Works on any element list, shown or stored.
 */
export function measureTexts(elements: readonly BoardElement[], ids: ReadonlySet<string>): BoardElement[] {
  if (!ids.size) return [...elements];
  const byId = new Map(elements.map((e) => [e.id, e]));
  const grown = new Map<string, BoardElement>();
  const out = elements.map((e) => {
    if (!ids.has(e.id) || e.isDeleted) return e;
    const c = e.containerId ? grown.get(e.containerId) ?? byId.get(e.containerId) : undefined;
    if (!c) return e;
    const [fresh] = restoreElements([e as unknown as ExcalidrawElement, c as unknown as ExcalidrawElement], null, { refreshDimensions: true, repairBindings: true }) as unknown as BoardElement[];
    const measured = { ...e, width: fresh.width, height: fresh.height, ...(c.type !== "arrow" && fresh.text ? { text: fresh.text } : {}) };
    if (c.type !== "arrow" && fresh.height + 16 > c.height) {
      const v = c as unknown as { version?: number };
      grown.set(c.id, { ...c, height: Math.ceil(fresh.height + 24), version: (v.version ?? 0) + 1, versionNonce: Math.floor(Math.random() * 2 ** 31) } as BoardElement);
    }
    return placeText(measured, grown.get(c.id) ?? c);
  });
  return grown.size ? out.map((e) => grown.get(e.id) ?? e) : out;
}

/** The name label of a symbol: the plain text in the body's own group, lowest one (texts the app writes are not it). */
export function symbolLabel(elements: readonly BoardElement[], body: BoardElement): BoardElement | undefined {
  const g = body.groupIds?.[0];
  if (!g) return undefined;
  const isAppText = (e: BoardElement) => { const pcs = (e.customData?.pcs ?? {}) as Record<string, unknown>; return !!(pcs.label || pcs.boxLabel || pcs.portLabel); };
  return elements.filter((e) => !e.isDeleted && e.type === "text" && !e.containerId && e.groupIds?.[0] === g && !isAppText(e)).sort((a, b) => b.y - a.y)[0];
}

/**
 * Change the lines of a symbol's name label (the equipment tag is its first line), measured again and kept
 * centred where it was. `fn` returns the new lines, or null for no change. Shapes without a label are left alone.
 */
export function relabel(elements: readonly BoardElement[], bodyId: string, fn: (lines: string[]) => string[] | null): BoardElement[] {
  const body = elements.find((e) => e.id === bodyId);
  const label = body && symbolLabel(elements, body);
  if (!label) return [...elements];
  const lines = (label.originalText ?? label.text ?? "").split("\n");
  const next = fn(lines);
  if (!next || !next.join("").trim() || next.join("\n") === lines.join("\n")) return [...elements];
  const text = next.join("\n");
  const draft = { ...label, text, originalText: text, textAlign: "center" } as unknown as ExcalidrawElement;
  const [fresh] = restoreElements([draft], null, { refreshDimensions: true, repairBindings: true }) as unknown as BoardElement[];
  const cx = label.x + label.width / 2;
  const v = label as unknown as { version?: number };
  const out = { ...label, text, originalText: text, textAlign: "center", width: fresh.width, height: fresh.height, x: cx - fresh.width / 2,
    version: (v.version ?? 0) + 1, versionNonce: Math.floor(Math.random() * 2 ** 31), updated: Date.now() } as BoardElement;
  return elements.map((e) => (e.id === label.id ? out : e));
}

/**
 * A stored drawing as the editor will load it (element defaults filled in, drawing order indices
 * set), so opening it later changes nothing by itself.
 */
export function normalizeScene(elements: readonly BoardElement[]): BoardElement[] {
  return restoreElements(elements as unknown as ExcalidrawElement[], null) as unknown as BoardElement[];
}

/** True while the user is drawing, dragging, resizing or typing — sync waits until they finish. */
export function isInteracting(s: AppState): boolean {
  return !!(s.newElement || s.multiElement || s.editingTextElement || s.resizingElement || s.selectedElementsAreBeingDragged ||
    s.isResizing || s.isRotating || s.cursorButton === "down" || s.editingFrame);
}

/** The scene point at the centre of the visible canvas. */
export function viewCenter(s: AppState): { x: number; y: number } {
  return { x: -s.scrollX + s.width / 2 / s.zoom.value, y: -s.scrollY + s.height / 2 / s.zoom.value };
}
