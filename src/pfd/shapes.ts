/**
 * Plain element builders for the shapes the app manages: UO boxes on the process map, UO frames,
 * connectors (ports) and the texts bound to them. Pure JSON, so the rules can run without the
 * editor; the editor re-measures texts when it loads or changes them (see excalidraw.ts).
 */
import { newId } from "../model/ids";
import type { BoardElement, PcsData } from "./sync";

/** Excalidraw font family id of Liberation Sans (an Arial-compatible sans), and its line height. */
export const DRAW_FONT_ID = 9;
export const LINE_HEIGHT = 1.15;
export const INK = "#0b6585";

export const BOX_W = 220;
export const BOX_H = 110;
export const BOX_GAP = 200;
export const PORT_W = 150;
export const PORT_H = 44;
export const FRAME_W = 640;
export const FRAME_H = 420;

export type TextRole = "label" | "boxLabel" | "portLabel";
const FONT: Record<TextRole, number> = { label: 13, boxLabel: 16, portLabel: 12 };

const rand = () => Math.floor(Math.random() * 2 ** 31);

function base(id: string, type: string, x: number, y: number, width: number, height: number): Record<string, unknown> {
  return {
    id, type, x, y, width, height, angle: 0,
    strokeColor: "#1e1e1e", backgroundColor: "transparent", fillStyle: "solid", strokeWidth: 1, strokeStyle: "solid",
    roughness: 0, opacity: 100, groupIds: [], frameId: null, index: null, roundness: null,
    seed: rand(), version: 1, versionNonce: rand(), isDeleted: false, boundElements: [], updated: Date.now(), link: null, locked: false,
  };
}

/** Where Excalidraw puts an arrow's label: the middle point, or the middle of the middle segment. */
export function arrowMidpoint(arrow: BoardElement): { x: number; y: number } {
  const pts = arrow.points ?? [[0, 0]];
  const n = pts.length;
  if (n % 2 === 1) {
    const p = pts[(n - 1) / 2];
    return { x: arrow.x + p[0], y: arrow.y + p[1] };
  }
  const a = pts[n / 2 - 1], b = pts[n / 2];
  return { x: arrow.x + (a[0] + b[0]) / 2, y: arrow.y + (a[1] + b[1]) / 2 };
}

/** Centre a bound text on its container (an arrow's middle, or the middle of a shape). */
export function placeText<T extends BoardElement>(text: T, container: BoardElement): T {
  const c = container.type === "arrow" ? arrowMidpoint(container) : { x: container.x + container.width / 2, y: container.y + container.height / 2 };
  return { ...text, x: c.x - text.width / 2, y: c.y - text.height / 2 };
}

/** A rough size for text before the editor measures it. */
export function roughSize(text: string, fontSize: number): { width: number; height: number } {
  const lines = text.split("\n");
  return { width: Math.max(...lines.map((l) => l.length)) * fontSize * 0.56, height: lines.length * fontSize * LINE_HEIGHT };
}

/** A text bound to a container, flagged with its role (customData.pcs[role] = true). */
export function textJson(container: BoardElement, text: string, role: TextRole): BoardElement {
  const fontSize = FONT[role];
  const { width, height } = roughSize(text, fontSize);
  const el = {
    ...base(newId("txt"), "text", 0, 0, width, height),
    strokeColor: INK, fontSize, fontFamily: DRAW_FONT_ID, text, originalText: text,
    textAlign: "center", verticalAlign: "middle", containerId: container.id, autoResize: true, lineHeight: LINE_HEIGHT,
    frameId: container.frameId ?? null,
    // UO box names can be edited by double-clicking the box; the other texts are written by the app.
    locked: role !== "boxLabel",
    customData: { pcs: { [role]: true } },
  } as unknown as BoardElement;
  return placeText(el, container);
}

/** A UO box for the process map (the sync adds its text). */
export function boxJson(id: string, uoId: string, x: number, y: number): BoardElement {
  return {
    ...base(id, "rectangle", x, y, BOX_W, BOX_H),
    strokeColor: INK, backgroundColor: "#e7f1fb", strokeWidth: 1.5, roundness: { type: 3 },
    customData: { pcs: { kind: "uo", uoId } satisfies PcsData },
  } as unknown as BoardElement;
}

/** The frame of a UO drawing. */
export function frameJson(uoId: string, name: string, x = 0, y = 0): BoardElement {
  return {
    ...base(newId("frm"), "frame", x, y, FRAME_W, FRAME_H),
    strokeColor: "#bbb", strokeWidth: 2, name,
    customData: { pcs: { kind: "uo", uoId } satisfies PcsData },
  } as unknown as BoardElement;
}

export interface PortSpec {
  streamId: string;
  dir: "in" | "out";
  x: number;
  y: number;
  text: string;
}

/** A connector on a UO drawing: where a transfer leaves (out) or enters (in) this unit operation. */
export function portJson(spec: PortSpec, id = newId("port")): BoardElement {
  return {
    ...base(id, "rectangle", spec.x, spec.y, PORT_W, PORT_H),
    strokeColor: INK, backgroundColor: "#fff4e6", strokeWidth: 1.5, roundness: { type: 3 },
    customData: { pcs: { port: spec.streamId, dir: spec.dir } satisfies PcsData },
  } as unknown as BoardElement;
}

/** A straight arrow from (x0, y0) to (x1, y1), bound at either end when an element id is given. */
export function arrowJson(id: string, x0: number, y0: number, x1: number, y1: number, startId: string | null, endId: string | null, pcs?: PcsData): BoardElement {
  return {
    ...base(id, "arrow", x0, y0, Math.abs(x1 - x0), Math.abs(y1 - y0)),
    points: [[0, 0], [x1 - x0, y1 - y0]],
    startBinding: startId ? { elementId: startId, focus: 0, gap: 4 } : null,
    endBinding: endId ? { elementId: endId, focus: 0, gap: 4 } : null,
    startArrowhead: null, endArrowhead: "triangle", elbowed: false, lastCommittedPoint: null,
    ...(pcs ? { customData: { pcs } } : {}),
  } as unknown as BoardElement;
}
