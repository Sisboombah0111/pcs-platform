/**
 * Duplicate a unit operation's drawing: every shape with a new id (groups, frames, bound texts and arrow
 * bindings follow), the frame given to the new unit operation, arrows without their Stream IDs (the sync
 * gives the copy its own), and the connectors of transfers left out (transfers belong to the original).
 * Pure: no Excalidraw at runtime.
 */
import { newId } from "../model/ids";
import { tagKey } from "../ops/model";
import { pcsOf, type BoardElement, type PcsData } from "./sync";

type Raw = BoardElement & Record<string, unknown>;

export interface CopiedDrawing {
  elements: BoardElement[];
  /** original element id → copy id */
  idMap: Map<string, string>;
}

/**
 * Copy the elements of a drawing for unit operation `uoId`. `equipment` maps original equipment ids to the
 * copies' ids; a tagged shape whose equipment is not in it loses its tag (a tag is on one shape only).
 */
export function copyDrawing(elements: readonly BoardElement[], opts: { uoId: string; frameName: string; equipment?: ReadonlyMap<string, string> }): CopiedDrawing {
  const live = elements.filter((e) => !e.isDeleted) as Raw[];
  // Left out: connectors (transfers), arrows drawn to them, and the texts inside those.
  const drop = new Set<string>(live.filter((e) => pcsOf(e).port).map((e) => e.id));
  for (const e of live) {
    if (e.type !== "arrow") continue;
    const ends = [e.startBinding?.elementId, e.endBinding?.elementId];
    if (pcsOf(e).segment || ends.some((x) => x && drop.has(x))) drop.add(e.id);
  }
  for (const e of live) if (e.containerId && drop.has(e.containerId)) drop.add(e.id);
  const kept = live.filter((e) => !drop.has(e.id));

  const idMap = new Map(kept.map((e) => [e.id, newId("el")]));
  const groups = new Map<string, string>();
  const gid = (g: string) => { if (!groups.has(g)) groups.set(g, newId("grp")); return groups.get(g)!; };
  const now = Date.now();
  const out = kept.map((e): BoardElement => {
    const c: Raw = {
      ...e,
      id: idMap.get(e.id)!,
      groupIds: (e.groupIds ?? []).map(gid),
      seed: Math.floor(Math.random() * 2 ** 31), version: 1, versionNonce: Math.floor(Math.random() * 2 ** 31), updated: now,
    };
    if (e.frameId) c.frameId = idMap.get(e.frameId) ?? null;
    if (e.containerId) c.containerId = idMap.get(e.containerId) ?? null;
    if (Array.isArray(e.boundElements)) c.boundElements = e.boundElements.filter((b) => idMap.has(b.id)).map((b) => ({ ...b, id: idMap.get(b.id)! }));
    for (const k of ["startBinding", "endBinding"] as const) {
      const b = e[k];
      if (b) c[k] = idMap.has(b.elementId) ? { ...b, elementId: idMap.get(b.elementId)! } : null;
    }
    const pcs = pcsOf(e);
    if (Object.keys(pcs).length) {
      const next: PcsData = { ...pcs };
      if (e.type === "frame" && pcs.kind === "uo") next.uoId = opts.uoId;
      if (e.type === "arrow") { delete next.streamId; delete next.segment; }
      if (pcs.equipmentId) {
        const to = opts.equipment?.get(pcs.equipmentId);
        if (to) next.equipmentId = to; else delete next.equipmentId;
      }
      c.customData = { ...(e.customData ?? {}), pcs: next };
    }
    if (e.type === "frame" && pcs.kind === "uo") c.name = opts.frameName;
    return c;
  });
  return { elements: out, idMap };
}

/**
 * The tag of a copy: `from` replaced by `to` (XV-101 → XV-201 with "-1" → "-2"), or `to` added when the tag
 * has no `from`; "-2", "-3" … added until it is not taken.
 */
export function copyTag(tag: string, from: string, to: string, taken: ReadonlySet<string>): string {
  let t = from && tag.includes(from) ? tag.replace(from, to) : `${tag}${to || "-B"}`;
  const base = t;
  for (let n = 2; taken.has(tagKey(t)); n++) t = `${base}-${n}`;
  return t;
}

/** The usual renumbering for copies of these tags: "-1" → "-2" when most numbers start with 1 (XV-101), and so on. */
export function suggestRetag(tags: readonly string[]): { from: string; to: string } {
  const firsts = tags.map((t) => /-(\d)\d*/.exec(t)?.[1]).filter((x): x is string => !!x);
  if (!firsts.length) return { from: "", to: "-B" };
  const count = new Map<string, number>();
  for (const d of firsts) count.set(d, (count.get(d) ?? 0) + 1);
  const d = [...count.entries()].sort((a, b) => b[1] - a[1])[0][0];
  return { from: `-${d}`, to: `-${(Number(d) + 1) % 10}` };
}
