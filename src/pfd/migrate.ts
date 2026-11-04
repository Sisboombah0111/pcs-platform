/**
 * Project file v1 → v2. In v1 the whole PFD was one scene with a frame per unit operation; v2 has a
 * process map (a box per UO, transfers between boxes) and a drawing per UO.
 *
 * Elements keep their ids, so every Stream ID keeps its owner in the registry: streams inside a
 * frame move to that UO's drawing as they are, transfers move to the map and are redrawn between
 * the two UO boxes. Everything outside the frames (notes, tables) goes to the map. Labels of moved
 * transfers are dropped; the sync draws them again. Pure: no Excalidraw needed (it fills in
 * missing element fields when it loads the scene).
 */
import type { PfdBoard, PfdBoardV1, PfdSheet, StreamRegistry, UnitOperation } from "../model/types";
import { BOX_GAP, BOX_H, BOX_W, PORT_H, PORT_W, arrowJson, boxJson, portJson } from "./shapes";
import { pcsOf, type BoardElement } from "./sync";

type El = BoardElement & Record<string, unknown>;

export function migrateBoardV1(v1: PfdBoardV1, uos: readonly UnitOperation[], registry: StreamRegistry): PfdBoard {
  const live = (v1.elements as El[]).filter((e) => e && !e.isDeleted && typeof e.id === "string");
  const byId = new Map(live.map((e) => [e.id, e]));
  const frames = live.filter((e) => e.type === "frame").sort((a, b) => a.x - b.x || a.y - b.y);
  // Frame → UO: its pcs.uoId (v1 wrote it on every frame); a frame without one keeps no UO.
  const uoIds = new Set(uos.map((u) => u.id));
  const frameUo = new Map<string, string>();
  for (const f of frames) { const id = pcsOf(f).uoId; if (id && uoIds.has(id) && ![...frameUo.values()].includes(id)) frameUo.set(f.id, id); }

  const ownerOf = (e: El) => {
    const id = pcsOf(e).streamId;
    const o = id ? registry.active[id] : undefined;
    return o && o.elementId === e.id ? o : undefined;
  };
  // Decide each element's drawing: "map" or a UO id; bound texts follow their container.
  const scopeOf = new Map<string, string>();
  for (const e of live) {
    if (e.type === "text" && e.containerId && byId.has(e.containerId)) continue;
    let scope = "map";
    const owner = e.type === "arrow" ? ownerOf(e) : undefined;
    if (e.type === "frame" && frameUo.has(e.id)) scope = frameUo.get(e.id)!;
    else if (owner?.kind === "transfer") scope = "map";
    else if (e.frameId && frameUo.has(e.frameId)) scope = frameUo.get(e.frameId)!;
    else if (owner?.kind === "pfd" && owner.uoId && uoIds.has(owner.uoId)) scope = owner.uoId;
    scopeOf.set(e.id, scope);
  }
  const transfers = live.filter((e) => e.type === "arrow" && ownerOf(e)?.kind === "transfer");
  const transferIds = new Set(transfers.map((t) => t.id));
  for (const e of live) {
    if (e.type !== "text" || !e.containerId || !byId.has(e.containerId)) continue;
    if (transferIds.has(e.containerId)) continue; // dropped: drawn again by the sync
    scopeOf.set(e.id, scopeOf.get(e.containerId) ?? "map");
  }

  // Process map: one box per UO that had a frame, left to right in the old frame order. A UO whose
  // frame was already deleted in v1 stays off the map (it can be put back from the Units list).
  const ordered = frames.filter((f) => frameUo.has(f.id)).map((f) => frameUo.get(f.id)!);
  const boxOf = new Map<string, El>();
  ordered.forEach((uoId, i) => boxOf.set(uoId, boxJson(`box-${uoId}`, uoId, 80 + i * (BOX_W + BOX_GAP), 80) as El));

  // Transfers become straight arrows from the source box to the destination box (parallel ones offset).
  const pairCount = new Map<string, number>();
  const mapArrows: El[] = [];
  for (const t of transfers) {
    const o = ownerOf(t)!;
    const a = boxOf.get(o.fromUoId ?? ""), b = boxOf.get(o.toUoId ?? "");
    if (!a || !b) continue;
    const key = `${o.fromUoId}>${o.toUoId}`;
    const n = pairCount.get(key) ?? 0;
    pairCount.set(key, n + 1);
    const dy = (n % 2 ? 1 : -1) * Math.ceil(n / 2) * 22;
    const forward = b.x >= a.x;
    const x0 = forward ? a.x + BOX_W + 6 : a.x - 6, y0 = a.y + BOX_H / 2 + dy;
    const x1 = forward ? b.x - 6 : b.x + BOX_W + 6, y1 = b.y + BOX_H / 2 + dy;
    const arrow: El = {
      ...t,
      x: x0, y: y0, width: Math.abs(x1 - x0), height: Math.abs(y1 - y0),
      points: [[0, 0], [x1 - x0, y1 - y0]],
      startBinding: { elementId: a.id, focus: 0, gap: 6 } as BoardElement["startBinding"],
      endBinding: { elementId: b.id, focus: 0, gap: 6 } as BoardElement["endBinding"],
      elbowed: false, roundness: null, frameId: null, groupIds: [], boundElements: [],
      startArrowhead: null, endArrowhead: (t as El).endArrowhead ?? "triangle",
      version: ((t as El).version as number ?? 1) + 1,
    };
    delete arrow.fixedSegments; delete arrow.startIsSpecial; delete arrow.endIsSpecial;
    mapArrows.push(arrow);
    (a.boundElements as { id: string; type: string }[]).push({ id: t.id, type: "arrow" });
    (b.boundElements as { id: string; type: string }[]).push({ id: t.id, type: "arrow" });
  }

  const sheetEls = new Map<string, El[]>();
  const mapEls: El[] = [...boxOf.values()];
  for (const e of live) {
    const scope = scopeOf.get(e.id);
    if (!scope || transferIds.has(e.id)) continue;
    if (scope === "map") mapEls.push(e);
    else sheetEls.set(scope, [...(sheetEls.get(scope) ?? []), e]);
  }
  mapEls.push(...mapArrows);

  // Where a v1 transfer left and entered equipment, keep that in the UO drawings: a connector at the
  // frame edge and an arrow from the equipment to it (or from it to the equipment).
  const frameOfUo = new Map([...frameUo].map(([fid, uoId]) => [uoId, byId.get(fid)!]));
  const portYs = new Map<string, number[]>();
  const freeY = (key: string, want: number) => {
    const used = portYs.get(key) ?? [];
    let y = want;
    while (used.some((u) => Math.abs(u - y) < PORT_H + 16)) y += PORT_H + 24;
    portYs.set(key, [...used, y]);
    return y;
  };
  for (const t of transfers) {
    const o = ownerOf(t)!;
    const streamId = pcsOf(t).streamId!;
    for (const dir of ["out", "in"] as const) {
      const uoId = dir === "out" ? o.fromUoId! : o.toUoId!;
      const els = sheetEls.get(uoId);
      const f = frameOfUo.get(uoId);
      if (!els || !f) continue;
      const binding = dir === "out" ? t.startBinding : t.endBinding;
      const eq = binding ? byId.get(binding.elementId) : undefined;
      const anchor = eq && scopeOf.get(eq.id) === uoId && eq.type !== "frame" ? eq : undefined;
      const cy = anchor ? anchor.y + anchor.height / 2 : f.y + 40 + PORT_H / 2;
      const px = dir === "out" ? f.x + f.width + 60 : f.x - 60 - PORT_W;
      const py = Math.round(freeY(`${uoId}|${dir}`, cy - PORT_H / 2));
      const port = portJson({ streamId, dir, x: Math.round(px), y: py, text: "" }, `port-${t.id}-${dir}`) as El;
      els.push(port);
      if (!anchor) continue;
      const segId = `seg-${t.id}-${dir}`;
      const seg = (dir === "out"
        ? arrowJson(segId, anchor.x + anchor.width + 4, cy, px - 4, py + PORT_H / 2, anchor.id, port.id, { streamId, segment: true })
        : arrowJson(segId, px + PORT_W + 4, py + PORT_H / 2, anchor.x - 4, cy, port.id, anchor.id, { streamId, segment: true })) as El;
      els.push(seg);
      (port.boundElements as { id: string; type: string }[]).push({ id: segId, type: "arrow" });
      const i = els.indexOf(anchor);
      els[i] = { ...anchor, boundElements: [...(anchor.boundElements ?? []), { id: segId, type: "arrow" }] };
    }
  }

  const files = v1.files ?? {};
  const toSheet = (els: El[]): PfdSheet => {
    const ids = new Set(els.map((e) => e.id));
    const cleaned = els.map((e) => {
      const out: El = { ...e };
      // Bindings to elements that went to another drawing are dropped.
      if (Array.isArray(e.boundElements)) out.boundElements = e.boundElements.filter((b) => ids.has(b.id));
      if (e.startBinding && !ids.has(e.startBinding.elementId)) out.startBinding = null;
      if (e.endBinding && !ids.has(e.endBinding.elementId)) out.endBinding = null;
      if (e.frameId && !ids.has(e.frameId)) out.frameId = null;
      return out;
    });
    const used: Record<string, unknown> = {};
    for (const e of cleaned) { const f = (e as { fileId?: string }).fileId; if (f && files[f]) used[f] = files[f]; }
    return { elements: cleaned, files: used };
  };
  const sheets: Record<string, PfdSheet> = {};
  for (const u of uos) if (sheetEls.has(u.id)) sheets[u.id] = toSheet(sheetEls.get(u.id)!);
  return { map: toSheet(mapEls), sheets, library: v1.library ?? [] };
}
