/**
 * PFD ↔ project sync. Pure: reads every drawing (the process map and one drawing per unit
 * operation) with the project's UOs and stream registry, and says what must change. The editor
 * adapter (PfdView) applies the changes to the drawing on screen; stored drawings are changed as JSON.
 *
 * Process map
 *   UO box (rectangle with pcs.kind "uo")  = one unit operation; its text reads "<code>\n<name>"
 *   arrow from one box to another          = transfer ST-<from>-<to>[-n]
 *   any other arrow                        = drawing only
 * UO drawing (one per UO)
 *   UO frame                               = titled "<code> · <name>"
 *   arrow with an end in the frame         = stream ST-<UO>-<nnn>   (no frame: every arrow)
 *   connector (port)                       = drawn by the app for each transfer in or out of the UO
 *   arrow to or from a connector           = drawn part of that transfer: labelled with its ID, no ID of its own
 * Any arrow can be marked "not a stream".
 *
 * Stream IDs never change for the same arrow, are never reused after the arrow is deleted, come
 * back when the arrow comes back (undo), and copies get new IDs.
 */
import { isUoCode, newId, parseStreamId, pfdStreamId, suggestUoCode, transferStreamId, MAX_SEQ } from "../model/ids";
import type { StreamOwner, StreamRegistry, UnitOperation } from "../model/types";
import { FRAME_H, FRAME_W, PORT_H, PORT_W, placeText, portJson, textJson, type PortSpec, type TextRole } from "./shapes";

export type { PortSpec, TextRole } from "./shapes";

export interface BoardElement {
  id: string;
  type: string;
  isDeleted?: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  frameId?: string | null;
  name?: string | null;
  points?: readonly (readonly [number, number])[];
  startBinding?: { elementId: string } | null;
  endBinding?: { elementId: string } | null;
  boundElements?: readonly { id: string; type: string }[] | null;
  containerId?: string | null;
  text?: string;
  originalText?: string;
  locked?: boolean;
  groupIds?: readonly string[];
  customData?: Record<string, unknown>;
}

export interface PcsData {
  /** UO box on the map, or the UO frame of a drawing. */
  kind?: "uo";
  uoId?: string;
  streamId?: string;
  name?: string;
  ignore?: boolean;
  /** Texts written by the app: stream label, UO box text, connector text. */
  label?: boolean;
  boxLabel?: boolean;
  portLabel?: boolean;
  /** Connector: the transfer it stands for, and whether it leaves (out) or enters (in) this UO. */
  port?: string;
  dir?: "in" | "out";
  /** Connector whose transfer is gone (kept because arrows still point at it). */
  orphan?: boolean;
  /** Arrow drawn to or from a connector: part of the transfer pcs.streamId. */
  segment?: boolean;
  symbol?: string;
  /** The equipment (tag) this shape stands for: project.equipment id. */
  equipmentId?: string;
  materials?: { materialId: string; qty: number }[];
  table?: unknown;
}

export const pcsOf = (el: BoardElement | undefined): PcsData => ((el?.customData?.pcs as PcsData | undefined) ?? {});
/** The text as typed (Excalidraw wraps long text inside shapes; `text` then has extra line breaks). */
export const textOf = (t: BoardElement) => t.originalText ?? t.text ?? "";

/** Scope key of the process map; a UO drawing's scope key is its UO id. */
export const MAP = "map";

export interface StreamInfo {
  streamId: string;
  kind: "pfd" | "transfer";
  elementId: string;
  /** Drawing the arrow is on: MAP for transfers, the UO id for streams in a UO drawing. */
  scope: string;
  uoId?: string;
  fromUoId?: string;
  toUoId?: string;
  name?: string;
}

export interface TextChange {
  containerId: string;
  action: "create" | "update" | "remove";
  role: TextRole;
  text?: string;
  textId?: string;
}

export interface ScopeChanges {
  /** element id → new customData.pcs (whole object) */
  pcsPatches: Map<string, PcsData>;
  /** frame id → new name */
  namePatches: Map<string, string>;
  texts: TextChange[];
  /** elements to delete (with their bound texts): app texts left without a container, unused connectors */
  remove: string[];
  /** connectors to add */
  ports: PortSpec[];
}

export interface BoardScenes {
  map: readonly BoardElement[];
  /** UO id → its drawing */
  sheets: Readonly<Record<string, readonly BoardElement[]>>;
}

export interface SyncInput {
  board: BoardScenes;
  uos: readonly UnitOperation[];
  registry: StreamRegistry;
  now: string;
  /** The MB value line for a stream's label (from the applied Mass Balance), if any. */
  valueLine?: (streamId: string) => string | undefined;
}

export interface SyncResult {
  uos: UnitOperation[];
  uosChanged: boolean;
  registry: StreamRegistry;
  registryChanged: boolean;
  streams: StreamInfo[];
  /** scope → changes (only scopes with something to change) */
  changes: Record<string, ScopeChanges>;
  /** UO ids that have a box on the process map */
  onMap: Set<string>;
  report: { issued: string[]; restored: string[]; retired: string[]; adopted: string[]; addedUos: string[]; warnings: string[] };
}

export const frameLabel = (u: Pick<UnitOperation, "code" | "name">) => `${u.code} · ${u.name}`;
export const boxText = (u: Pick<UnitOperation, "code" | "name">) => `${u.code}\n${u.name}`;
// "<code> · <name>" (also ":" or "|"). Hyphens are not separators: names like "N-1 Seed" are common.
const FRAME_NAME_RE = /^\s*([A-Za-z0-9]{1,10})\s*[·:|]\s*(.+?)\s*$/;

/** Read a UO title typed by the user: "CODE\nName", "CODE · Name", or just a name. */
export function parseUoTitle(t: string): { code?: string; name: string } | null {
  const lines = t.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  if (!lines.length) return null;
  if (lines.length >= 2 && isUoCode(lines[0].toUpperCase())) return { code: lines[0].toUpperCase(), name: lines.slice(1).join(" ") };
  const m = FRAME_NAME_RE.exec(lines.join(" "));
  if (m && isUoCode(m[1].toUpperCase())) return { code: m[1].toUpperCase(), name: m[2] };
  return { name: lines.join(" ") };
}

export const portText = (dir: "in" | "out", otherCode: string, streamId: string) => `${dir === "out" ? "To" : "From"} ${otherCode}\n${streamId}`;
export const orphanPortText = (streamId: string) => `Not connected\n${streamId}`;

/** Label on a stream arrow: its ID, then its name and its MB values when there are any. */
export function labelText(s: Pick<StreamInfo, "streamId" | "name">, value?: string): string {
  return [s.streamId, s.name, value].filter(Boolean).join("\n");
}

function sameOwner(a: StreamOwner | undefined, b: StreamOwner): boolean {
  if (!a || a.kind !== b.kind || a.elementId !== b.elementId) return false;
  return a.kind === "pfd" ? a.uoId === b.uoId : a.fromUoId === b.fromUoId && a.toUoId === b.toUoId;
}

const byXY = (a: BoardElement, b: BoardElement) => a.x - b.x || a.y - b.y;
const inside = (el: BoardElement, x: number, y: number) => x >= el.x && x <= el.x + el.width && y >= el.y && y <= el.y + el.height;
const isShape = (e: BoardElement) => e.type !== "text" && e.type !== "arrow" && e.type !== "line" && e.type !== "freedraw" && e.type !== "frame" && e.type !== "magicframe";
const MANAGED_ROLES: TextRole[] = ["label", "boxLabel", "portLabel"];
const roleOf = (t: BoardElement): TextRole | undefined => MANAGED_ROLES.find((r) => pcsOf(t)[r]);

function endPoint(arrow: BoardElement, which: "start" | "end"): [number, number] | null {
  const pts = arrow.points ?? [];
  const p = which === "start" ? pts[0] : pts[pts.length - 1];
  return p ? [arrow.x + p[0], arrow.y + p[1]] : null;
}

/** One drawing, with lookups. */
class Scene {
  readonly live: BoardElement[];
  readonly byId: Map<string, BoardElement>;
  constructor(readonly key: string, all: readonly BoardElement[]) {
    this.live = all.filter((e) => !e.isDeleted);
    this.byId = new Map(this.live.map((e) => [e.id, e]));
  }
  /** The text bound to a container, if any. */
  boundText(container: BoardElement): BoardElement | undefined {
    const ref = container.boundElements?.find((b) => b.type === "text");
    const t = ref ? this.byId.get(ref.id) : undefined;
    if (t && t.containerId === container.id) return t;
    return this.live.find((e) => e.type === "text" && e.containerId === container.id);
  }
  /** The element an arrow end is bound to, or else the first of `candidates` its end point lies in. */
  endTarget(arrow: BoardElement, which: "start" | "end", candidates: readonly BoardElement[]): BoardElement | undefined {
    const binding = which === "start" ? arrow.startBinding : arrow.endBinding;
    const bound = binding ? this.byId.get(binding.elementId) : undefined;
    if (bound && candidates.includes(bound)) return bound;
    if (bound) return undefined;
    const p = endPoint(arrow, which);
    return p ? candidates.find((c) => inside(c, p[0], p[1])) : undefined;
  }
}

export function syncProject(input: SyncInput): SyncResult {
  const { now } = input;
  const report: SyncResult["report"] = { issued: [], restored: [], retired: [], adopted: [], addedUos: [], warnings: [] };
  const changes: Record<string, ScopeChanges> = {};
  const ch = (scope: string) => (changes[scope] ??= { pcsPatches: new Map(), namePatches: new Map(), texts: [], remove: [], ports: [] });
  /** pcs as it will be after the patches so far */
  const pcsNow = (scope: string, el: BoardElement) => changes[scope]?.pcsPatches.get(el.id) ?? pcsOf(el);
  const patchPcs = (scope: string, el: BoardElement, next: PcsData) => {
    if (JSON.stringify(pcsOf(el)) !== JSON.stringify(next)) ch(scope).pcsPatches.set(el.id, next);
    else changes[scope]?.pcsPatches.delete(el.id);
  };

  const map = new Scene(MAP, input.board.map);
  const uos = input.uos.map((u) => ({ ...u }));
  const uoById = new Map(uos.map((u) => [u.id, u]));
  let uosChanged = false;
  const sheets = Object.entries(input.board.sheets).filter(([k]) => uoById.has(k)).map(([k, els]) => new Scene(k, els));

  // ---- UOs from the boxes on the map -------------------------------------------------------
  const boxes = map.live.filter((e) => isShape(e) && pcsOf(e).kind === "uo").sort(byXY);
  const boxUo = new Map<string, string>();
  const claimed = new Set<string>();
  for (const b of boxes) {
    const pcs = pcsOf(b);
    let uo = pcs.uoId && !claimed.has(pcs.uoId) ? uoById.get(pcs.uoId) : undefined;
    if (!uo) {
      // A copied box, or a box whose UO is missing from the project: a new UO, named from its text.
      const t = map.boundText(b);
      const parsed = t ? parseUoTitle(textOf(t)) : null;
      const src = pcs.uoId ? uoById.get(pcs.uoId) : undefined;
      const name = parsed?.name || src?.name || `Unit operation ${uos.length + 1}`;
      const taken = new Set(uos.map((u) => u.code));
      const want = parsed?.code;
      const code = want && isUoCode(want) && !taken.has(want) ? want : suggestUoCode(name, taken, uos.length + 1);
      uo = { id: pcs.uoId && !uoById.has(pcs.uoId) ? pcs.uoId : newId("uo"), code, name, order: 0 };
      uos.push(uo);
      uoById.set(uo.id, uo);
      uosChanged = true;
      report.addedUos.push(uo.id);
    }
    claimed.add(uo.id);
    boxUo.set(b.id, uo.id);
    if (pcs.kind !== "uo" || pcs.uoId !== uo.id) patchPcs(MAP, b, { ...pcs, kind: "uo", uoId: uo.id });
  }
  // A frame on the map is only a drawing aid (a UO frame pasted here loses its UO).
  for (const f of map.live) if (f.type === "frame" && pcsOf(f).kind === "uo") { const n = { ...pcsOf(f) }; delete n.kind; delete n.uoId; patchPcs(MAP, f, n); }

  // ---- the frame of each UO drawing ----------------------------------------------------------
  const frameOf = new Map<string, BoardElement | undefined>();
  const ownFrame = new Set<string>();
  for (const s of sheets) {
    const frames = s.live.filter((e) => e.type === "frame").sort(byXY);
    const own = frames.find((f) => pcsOf(f).kind === "uo" && pcsOf(f).uoId === s.key);
    // No frame of its own (deleted, or the drawing is new): the first frame there becomes the UO frame.
    const f = own ?? frames[0];
    frameOf.set(s.key, f);
    if (own) ownFrame.add(own.id);
    for (const other of frames) {
      if (other === f) continue;
      if (pcsOf(other).kind === "uo") { const n = { ...pcsOf(other) }; delete n.kind; delete n.uoId; patchPcs(s.key, other, n); }
    }
    if (f && (pcsOf(f).kind !== "uo" || pcsOf(f).uoId !== s.key)) patchPcs(s.key, f, { ...pcsOf(f), kind: "uo", uoId: s.key });
  }

  // ---- names typed on the board: the box text, then the frame title ------------------------
  const applyTitle = (uo: UnitOperation, typed: string) => {
    const parsed = parseUoTitle(typed);
    if (!parsed) return;
    if (parsed.code && parsed.code !== uo.code && !uos.some((u) => u.id !== uo.id && u.code === parsed.code)) { uo.code = parsed.code; uosChanged = true; }
    if (parsed.name !== uo.name) { uo.name = parsed.name; uosChanged = true; }
  };
  // A text counts as typed when it differs from what the app wrote for the UO as it was.
  const wrote = new Map(input.uos.map((u) => [u.id, u]));
  for (const b of boxes) {
    const t = map.boundText(b);
    const uo = uoById.get(boxUo.get(b.id)!)!;
    if (t && pcsOf(t).boxLabel && textOf(t) !== boxText(wrote.get(uo.id) ?? uo)) applyTitle(uo, textOf(t));
  }
  for (const s of sheets) {
    const f = frameOf.get(s.key);
    const uo = uoById.get(s.key)!;
    if (f && ownFrame.has(f.id) && f.name && f.name.trim() && f.name !== frameLabel(wrote.get(uo.id) ?? uo)) applyTitle(uo, f.name);
  }

  // Order follows the map, left to right; UOs without a box keep their place after them.
  boxes.forEach((b, i) => {
    const u = uoById.get(boxUo.get(b.id)!)!;
    if (u.order !== i + 1) { u.order = i + 1; uosChanged = true; }
  });
  uos.forEach((u) => {
    if (!claimed.has(u.id) && u.order <= boxes.length) { u.order = boxes.length + u.order + 1000; uosChanged = true; }
  });
  uos.sort((a, b) => a.order - b.order);
  const codeOf = (uoId?: string) => (uoId ? uoById.get(uoId)?.code ?? "" : "");

  // Canonical texts: box text and frame titles.
  const managed = new Map<string, Set<string>>(); // scope → containers that keep an app text
  const keep = (scope: string, id: string) => { const s = managed.get(scope) ?? new Set(); s.add(id); managed.set(scope, s); };
  const wantText = (scene: Scene, container: BoardElement, role: TextRole, want: string) => {
    keep(scene.key, container.id);
    const t = scene.boundText(container);
    if (!t) ch(scene.key).texts.push({ containerId: container.id, action: "create", role, text: want });
    else if (textOf(t) !== want || !pcsOf(t)[role] || (role !== "boxLabel" && !t.locked) || roleOf(t) !== role)
      ch(scene.key).texts.push({ containerId: container.id, action: "update", role, text: want, textId: t.id });
  };
  for (const b of boxes) wantText(map, b, "boxLabel", boxText(uoById.get(boxUo.get(b.id)!)!));
  for (const s of sheets) {
    const f = frameOf.get(s.key);
    const want = frameLabel(uoById.get(s.key)!);
    if (f && f.name !== want) ch(s.key).namePatches.set(f.id, want);
  }

  // ---- arrows ---------------------------------------------------------------------------------
  type Work = { scene: Scene; arrow: BoardElement; owner: StreamOwner };
  const work: Work[] = [];
  const notStreams: { scene: Scene; arrow: BoardElement }[] = [];
  const segments: { scene: Scene; arrow: BoardElement; port: BoardElement }[] = [];

  for (const arrow of map.live.filter((e) => e.type === "arrow")) {
    if (pcsOf(arrow).ignore) { notStreams.push({ scene: map, arrow }); continue; }
    const a = map.endTarget(arrow, "start", boxes), b = map.endTarget(arrow, "end", boxes);
    const from = a ? boxUo.get(a.id) : undefined, to = b ? boxUo.get(b.id) : undefined;
    if (from && to && from !== to) work.push({ scene: map, arrow, owner: { kind: "transfer", elementId: arrow.id, fromUoId: from, toUoId: to } });
    else notStreams.push({ scene: map, arrow });
  }
  const portsOf = new Map<string, BoardElement[]>();
  for (const s of sheets) {
    const ports = s.live.filter((e) => isShape(e) && pcsOf(e).port);
    portsOf.set(s.key, ports);
    const f = frameOf.get(s.key);
    const fArr = f ? [f] : [];
    const inFrame = (arrow: BoardElement, which: "start" | "end") => {
      if (!f) return true;
      const binding = which === "start" ? arrow.startBinding : arrow.endBinding;
      const bound = binding ? s.byId.get(binding.elementId) : undefined;
      if (bound && (bound.id === f.id || bound.frameId === f.id)) return true;
      if (bound) return !!s.endTarget({ ...arrow, startBinding: null, endBinding: null }, which, fArr);
      return !!s.endTarget(arrow, which, fArr);
    };
    for (const arrow of s.live.filter((e) => e.type === "arrow")) {
      if (pcsOf(arrow).ignore) { notStreams.push({ scene: s, arrow }); continue; }
      const pS = s.endTarget(arrow, "start", ports), pE = s.endTarget(arrow, "end", ports);
      if (pS || pE) {
        // To or from a connector: part of that transfer (an arrow joining two connectors follows the outgoing one).
        const port = pE && pcsOf(pE).dir === "out" ? pE : (pS ?? pE)!;
        segments.push({ scene: s, arrow, port });
        continue;
      }
      if (inFrame(arrow, "start") || inFrame(arrow, "end")) work.push({ scene: s, arrow, owner: { kind: "pfd", elementId: arrow.id, uoId: s.key } });
      else notStreams.push({ scene: s, arrow });
    }
  }

  // ---- Stream IDs -------------------------------------------------------------------------------
  const reg: StreamRegistry = {
    seq: { ...input.registry.seq },
    active: { ...input.registry.active },
    retired: input.registry.retired.map((r) => ({ ...r })),
  };
  const before = JSON.stringify(input.registry);
  const retiredIds = new Set(reg.retired.map((r) => r.streamId));
  const seen = new Map<string, StreamOwner>();
  const mapArrowIds = new Set(map.live.filter((e) => e.type === "arrow").map((e) => e.id));
  const assigned = new Map<Work, string>();
  // Pass 1: arrows that still own their ID keep it, so a copy can never take it.
  const rest: Work[] = [];
  for (const w of work) {
    const id = pcsOf(w.arrow).streamId;
    if (id && !seen.has(id) && sameOwner(reg.active[id], w.owner)) { seen.set(id, w.owner); assigned.set(w, id); }
    else rest.push(w);
  }
  // Pass 2: restore, adopt, or issue.
  for (const w of rest) {
    const { arrow, owner } = w;
    const current = pcsOf(arrow).streamId;
    const restoreIdx = reg.retired.findIndex((r) => !seen.has(r.streamId) && (sameOwner(r, owner) ||
      // A transfer redrawn between the same two UOs gets its old ID back (the old arrow is gone).
      (owner.kind === "transfer" && r.kind === "transfer" && r.fromUoId === owner.fromUoId && r.toUoId === owner.toUoId && r.elementId !== owner.elementId && !mapArrowIds.has(r.elementId))));
    if (restoreIdx >= 0) {
      const r = reg.retired.splice(restoreIdx, 1)[0];
      retiredIds.delete(r.streamId);
      seen.set(r.streamId, owner);
      assigned.set(w, r.streamId);
      report.restored.push(r.streamId);
      continue;
    }
    if (current && !pcsOf(arrow).segment && !seen.has(current) && !retiredIds.has(current) && !reg.active[current]) {
      const p = parseStreamId(current);
      const fits = p && (owner.kind === "pfd"
        ? p.kind === "pfd" && p.uo === codeOf(owner.uoId)
        : p.kind === "transfer" && p.from === codeOf(owner.fromUoId) && p.to === codeOf(owner.toUoId));
      if (fits && p) {
        if (p.kind === "pfd") reg.seq[p.uo] = Math.max(reg.seq[p.uo] ?? 0, p.seq);
        seen.set(current, owner);
        assigned.set(w, current);
        report.adopted.push(current);
        continue;
      }
    }
    const free = (id: string) => !seen.has(id) && !retiredIds.has(id) && !reg.active[id];
    let id: string | null = null;
    if (owner.kind === "pfd") {
      const code = codeOf(owner.uoId);
      if (!isUoCode(code)) { report.warnings.push(`Arrow ${arrow.id}: its UO has no valid code.`); continue; }
      let seq = reg.seq[code] ?? 0;
      while (seq < MAX_SEQ) { seq += 1; const c = pfdStreamId(code, seq); if (free(c)) { id = c; break; } }
      if (!id) { report.warnings.push(`${code}: more than ${MAX_SEQ} streams.`); continue; }
      reg.seq[code] = seq;
    } else {
      const from = codeOf(owner.fromUoId), to = codeOf(owner.toUoId);
      if (!isUoCode(from) || !isUoCode(to)) { report.warnings.push(`Arrow ${arrow.id}: a UO has no valid code.`); continue; }
      let n = 1;
      id = transferStreamId(from, to, n);
      while (!free(id)) id = transferStreamId(from, to, ++n);
    }
    seen.set(id, owner);
    assigned.set(w, id);
    report.issued.push(id);
  }
  for (const [id, owner] of Object.entries(reg.active)) {
    if (seen.has(id)) continue;
    reg.retired.push({ ...owner, streamId: id, retiredAt: now, reason: "arrow removed or moved" });
    report.retired.push(id);
  }
  reg.active = Object.fromEntries(seen);

  // ---- stream data and labels -------------------------------------------------------------------
  const streams: StreamInfo[] = [];
  const nameOf = new Map<string, string | undefined>();
  for (const w of work) {
    const id = assigned.get(w);
    const { scene, arrow, owner } = w;
    if (!id) { notStreams.push({ scene, arrow }); continue; }
    const pcs = pcsOf(arrow);
    const text = scene.boundText(arrow);
    let name = pcs.name;
    // A label the user typed before the arrow became a stream becomes the stream's name.
    if (text && !roleOf(text) && !name && textOf(text).trim()) name = textOf(text).trim();
    const next: PcsData = { ...pcs, streamId: id };
    delete next.segment;
    if (name) next.name = name; else delete next.name;
    patchPcs(scene.key, arrow, next);
    nameOf.set(id, name);
    const info: StreamInfo = { streamId: id, kind: owner.kind, elementId: arrow.id, scope: scene.key, name };
    if (owner.kind === "pfd") info.uoId = owner.uoId; else { info.fromUoId = owner.fromUoId; info.toUoId = owner.toUoId; }
    streams.push(info);
    wantText(scene, arrow, "label", labelText(info, input.valueLine?.(id)));
  }

  // ---- connectors ---------------------------------------------------------------------------------
  const transfers = streams.filter((s) => s.kind === "transfer");
  const segmentCount = new Map<string, number>();
  for (const sg of segments) segmentCount.set(sg.port.id, (segmentCount.get(sg.port.id) ?? 0) + 1);
  const validPort = new Set<string>();
  for (const s of sheets) {
    const ports = portsOf.get(s.key)!;
    const needed = [
      ...transfers.filter((t) => t.fromUoId === s.key).map((t) => ({ id: t.streamId, dir: "out" as const, other: t.toUoId })),
      ...transfers.filter((t) => t.toUoId === s.key).map((t) => ({ id: t.streamId, dir: "in" as const, other: t.fromUoId })),
    ];
    const neededKey = new Map(needed.map((n) => [`${n.id}|${n.dir}`, n]));
    const kept = new Map<string, BoardElement[]>();
    const stays: BoardElement[] = [];
    const removeEl = (e: BoardElement) => ch(s.key).remove.push(e.id);
    // Busy connectors (with arrows) first, so they are the ones kept.
    for (const p of [...ports].sort((a, b) => (segmentCount.get(b.id) ?? 0) - (segmentCount.get(a.id) ?? 0) || byXY(a, b))) {
      const pcs = pcsOf(p);
      const key = `${pcs.port}|${pcs.dir}`;
      const n = neededKey.get(key);
      const busy = (segmentCount.get(p.id) ?? 0) > 0;
      if (n) {
        if (kept.has(key) && !busy) { removeEl(p); continue; }
        kept.set(key, [...(kept.get(key) ?? []), p]);
        validPort.add(p.id);
        stays.push(p);
        if (pcs.orphan) { const nx = { ...pcs }; delete nx.orphan; patchPcs(s.key, p, nx); }
        wantText(s, p, "portLabel", portText(n.dir, codeOf(n.other), n.id));
      } else if (busy) {
        stays.push(p);
        if (!pcs.orphan) patchPcs(s.key, p, { ...pcs, orphan: true });
        wantText(s, p, "portLabel", orphanPortText(pcs.port!));
      } else removeEl(p);
    }
    // Missing connectors: outgoing ones to the right of the frame, incoming ones to the left, stacked.
    const missing = needed.filter((n) => !kept.has(`${n.id}|${n.dir}`));
    if (missing.length) {
      const f = frameOf.get(s.key);
      const content = s.live.filter((e) => e.type !== "text" && !pcsOf(e).port);
      const area = f ?? (content.length ? boundsOfEls(content) : { x: 0, y: 0, width: FRAME_W, height: FRAME_H });
      const stackTop = (dir: "in" | "out") => {
        const same = stays.filter((p) => pcsOf(p).dir === dir);
        return same.length ? Math.max(...same.map((p) => p.y + p.height)) + 24 : area.y + Math.max(40, area.height / 2 - PORT_H / 2);
      };
      const next = { in: stackTop("in"), out: stackTop("out") };
      for (const n of missing) {
        const x = n.dir === "out" ? area.x + area.width + 60 : area.x - 60 - PORT_W;
        ch(s.key).ports.push({ streamId: n.id, dir: n.dir, x: Math.round(x), y: Math.round(next[n.dir]), text: portText(n.dir, codeOf(n.other), n.id) });
        next[n.dir] += PORT_H + 24;
      }
    }
  }

  // Arrows to or from a connector carry the transfer's label.
  const transferById = new Map(transfers.map((t) => [t.streamId, t]));
  for (const { scene, arrow, port } of segments) {
    const t = validPort.has(port.id) ? transferById.get(pcsOf(port).port!) : undefined;
    if (!t) { notStreams.push({ scene, arrow }); continue; }
    const pcs = pcsOf(arrow);
    if (pcs.streamId !== t.streamId || !pcs.segment) patchPcs(scene.key, arrow, { ...pcs, streamId: t.streamId, segment: true });
    wantText(scene, arrow, "label", labelText({ streamId: t.streamId, name: nameOf.get(t.streamId) }, input.valueLine?.(t.streamId)));
  }
  for (const { scene, arrow } of notStreams) {
    const pcs = pcsNow(scene.key, arrow);
    if (pcs.streamId || pcs.segment) { const next = { ...pcs }; delete next.streamId; delete next.segment; patchPcs(scene.key, arrow, next); }
  }

  // App texts whose container no longer wants one (a deleted arrow, an arrow that is no longer a stream …).
  for (const scene of [map, ...sheets]) {
    const keepIds = managed.get(scene.key) ?? new Set<string>();
    const removing = new Set(changes[scene.key]?.remove ?? []);
    for (const t of scene.live) {
      if (t.type !== "text" || !roleOf(t)) continue;
      const c = t.containerId ? scene.byId.get(t.containerId) : undefined;
      if (c && removing.has(c.id)) continue; // goes with its container
      if (!c || !keepIds.has(c.id)) ch(scene.key).texts.push({ containerId: t.containerId ?? "", action: "remove", role: roleOf(t)!, textId: t.id });
    }
  }

  // Streams in reading order: by UO order, then ID.
  const orderOf = (s: StreamInfo) => uoById.get(s.uoId ?? s.fromUoId ?? "")?.order ?? 9999;
  streams.sort((a, b) => orderOf(a) - orderOf(b) || a.streamId.localeCompare(b.streamId));
  for (const [k, c] of Object.entries(changes)) if (!c.pcsPatches.size && !c.namePatches.size && !c.texts.length && !c.remove.length && !c.ports.length) delete changes[k];

  return {
    uos, uosChanged,
    registry: reg, registryChanged: JSON.stringify(reg) !== before,
    streams, changes, onMap: claimed, report,
  };
}

function boundsOfEls(els: readonly BoardElement[]) {
  const x0 = Math.min(...els.map((e) => e.x)), y0 = Math.min(...els.map((e) => e.y));
  const x1 = Math.max(...els.map((e) => e.x + e.width)), y1 = Math.max(...els.map((e) => e.y + e.height));
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/**
 * PFD-linked material counts per UO: Σ qty of material links on anything in each UO's drawing
 * (equipment, lines and arrows alike), plus links on transfer arrows of the process map, which count
 * toward the transfer's destination (as an MB transfer row does). Other things on the map do not count.
 */
export function pfdMaterialCounts(
  board: { map?: { elements: readonly unknown[] }; sheets: Readonly<Record<string, { elements: readonly unknown[] }>> },
  uos: readonly UnitOperation[],
  registry?: Pick<StreamRegistry, "active">,
): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>();
  const add = (uoId: string, links: { materialId: string; qty: number }[]) => {
    const m = out.get(uoId) ?? new Map<string, number>();
    for (const l of links) m.set(l.materialId, (m.get(l.materialId) ?? 0) + (Number.isFinite(l.qty) ? l.qty : 0));
    out.set(uoId, m);
  };
  const known = new Set(uos.map((u) => u.id));
  for (const u of uos) {
    const sheet = board.sheets[u.id];
    if (!sheet) continue;
    for (const e of sheet.elements as BoardElement[]) {
      const links = !e.isDeleted ? pcsOf(e).materials : undefined;
      if (links?.length) add(u.id, links);
    }
  }
  if (board.map && registry) {
    for (const e of board.map.elements as BoardElement[]) {
      const pcs = pcsOf(e);
      if (e.isDeleted || e.type !== "arrow" || !pcs.materials?.length || !pcs.streamId) continue;
      const o = registry.active[pcs.streamId];
      if (o?.kind === "transfer" && o.elementId === e.id && o.toUoId && known.has(o.toUoId)) add(o.toUoId, pcs.materials);
    }
  }
  return out;
}

/** UO ids that have a box on the process map. */
export function uosOnMap(board: { map: { elements: readonly unknown[] } }): Set<string> {
  const out = new Set<string>();
  for (const e of board.map.elements as BoardElement[]) if (!e.isDeleted && isShape(e) && pcsOf(e).kind === "uo" && pcsOf(e).uoId) out.add(pcsOf(e).uoId!);
  return out;
}

/** Stream ID → name typed on the PFD (from the arrow that owns the ID, in any drawing). */
export function streamNamesOf(board: { map: { elements: readonly unknown[] }; sheets: Readonly<Record<string, { elements: readonly unknown[] }>> }): Map<string, string> {
  const out = new Map<string, string>();
  for (const sheet of [board.map, ...Object.values(board.sheets)]) {
    for (const e of sheet.elements as BoardElement[]) {
      if (e.isDeleted || e.type !== "arrow") continue;
      const pcs = pcsOf(e);
      if (pcs.streamId && !pcs.segment && pcs.name) out.set(pcs.streamId, pcs.name);
    }
  }
  return out;
}

export interface Factories {
  /** A new text bound to the container. */
  text: (container: BoardElement, text: string, role: TextRole) => BoardElement;
  /** A new connector shape (without its text). */
  port: (spec: PortSpec) => BoardElement;
}
export const jsonFactories: Factories = { text: textJson, port: portJson };

/**
 * Apply one drawing's changes to its elements: returns the new element list, the ids that changed,
 * and the texts that were written (the editor re-measures those).
 */
export function applyScope(
  elements: readonly BoardElement[],
  changes: ScopeChanges | undefined,
  f: Factories = jsonFactories,
  now = Date.now(),
): { elements: BoardElement[]; changed: Set<string>; texts: Set<string> } {
  const changed = new Set<string>();
  const texts = new Set<string>();
  if (!changes) return { elements: [...elements], changed, texts };
  const next = new Map<string, BoardElement>(elements.map((e) => [e.id, e]));
  const order = elements.map((e) => e.id);
  const bump = (el: BoardElement, patch: Partial<BoardElement>): BoardElement => {
    const n = { ...el, ...patch } as BoardElement & { version?: number; versionNonce?: number; updated?: number };
    n.version = ((el as { version?: number }).version ?? 0) + 1;
    n.versionNonce = Math.floor(Math.random() * 2 ** 31);
    n.updated = now;
    changed.add(el.id);
    next.set(el.id, n);
    return n;
  };
  const add = (el: BoardElement, after?: string) => {
    next.set(el.id, el);
    changed.add(el.id);
    const i = after ? order.indexOf(after) : -1;
    if (i >= 0) order.splice(i + 1, 0, el.id); else order.push(el.id);
  };
  const removeText = (textId: string) => {
    const t = next.get(textId);
    if (!t || t.isDeleted) return;
    bump(t, { isDeleted: true });
    const c = t.containerId ? next.get(t.containerId) : undefined;
    if (c?.boundElements?.some((b) => b.id === textId)) bump(c, { boundElements: c.boundElements.filter((b) => b.id !== textId) });
  };
  for (const [id, pcs] of changes.pcsPatches) {
    const el = next.get(id);
    if (el) bump(el, { customData: { ...(el.customData ?? {}), pcs } });
  }
  for (const [id, name] of changes.namePatches) {
    const el = next.get(id);
    if (el) bump(el, { name });
  }
  for (const id of changes.remove) {
    const el = next.get(id);
    if (!el || el.isDeleted) continue;
    for (const b of el.boundElements ?? []) if (b.type === "text") removeText(b.id);
    for (const e of next.values()) if (e.type === "text" && e.containerId === id && !e.isDeleted) removeText(e.id);
    bump(next.get(id)!, { isDeleted: true, boundElements: [] });
  }
  for (const c of changes.texts) {
    if (c.action === "remove" && c.textId) { removeText(c.textId); continue; }
    const container = next.get(c.containerId);
    if (!container || !c.text) continue;
    if (c.action === "update" && c.textId) {
      const t = next.get(c.textId);
      if (!t) continue;
      const pcs = { ...pcsOf(t) };
      for (const r of MANAGED_ROLES) delete pcs[r];
      bump(t, { text: c.text, originalText: c.text, locked: c.role !== "boxLabel", customData: { ...(t.customData ?? {}), pcs: { ...pcs, [c.role]: true } } });
      texts.add(t.id);
    } else if (c.action === "create") {
      const label = f.text(container, c.text, c.role);
      add(label, container.id);
      texts.add(label.id);
      const cur = next.get(container.id)!;
      bump(cur, { boundElements: [...(cur.boundElements ?? []), { id: label.id, type: "text" }] });
    }
  }
  for (const spec of changes.ports) {
    const rect = f.port(spec);
    const label = f.text(rect, spec.text, "portLabel");
    add({ ...rect, boundElements: [{ id: label.id, type: "text" }] });
    add(label);
    texts.add(label.id);
  }
  return { elements: order.map((id) => next.get(id)!), changed, texts };
}

/** Re-centre a text on its container (pure; the editor also re-measures it first). */
export const centreText = placeText;
