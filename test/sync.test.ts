import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  MAP, applyScope, pcsOf, pfdMaterialCounts, streamNamesOf, syncProject, textOf, uosOnMap,
  type BoardElement, type PcsData, type SyncResult,
} from "../src/pfd/sync";
import { boxJson, frameJson } from "../src/pfd/shapes";
import { migrateBoardV1 } from "../src/pfd/migrate";
import { parseProject } from "../src/model/project";
import type { StreamRegistry, UnitOperation } from "../src/model/types";

const NOW = "2026-10-30T08:00:00.000Z";
const emptyReg = (): StreamRegistry => ({ seq: {}, active: {}, retired: [] });

const shape = (id: string, x: number, y: number, frameId: string | null = null, pcs?: PcsData): BoardElement =>
  ({ id, type: "rectangle", x, y, width: 60, height: 60, frameId, customData: pcs ? { pcs } : undefined });
const arrow = (id: string, from: BoardElement | [number, number], to: BoardElement | [number, number], pcs?: PcsData): BoardElement => {
  const p0 = Array.isArray(from) ? from : [from.x + from.width, from.y + from.height / 2];
  const p1 = Array.isArray(to) ? to : [to.x, to.y + to.height / 2];
  return {
    id, type: "arrow", x: p0[0], y: p0[1], width: Math.abs(p1[0] - p0[0]), height: Math.abs(p1[1] - p0[1]),
    points: [[0, 0], [p1[0] - p0[0], p1[1] - p0[1]]],
    startBinding: Array.isArray(from) ? null : { elementId: from.id },
    endBinding: Array.isArray(to) ? null : { elementId: to.id },
    customData: pcs ? { pcs } : undefined,
  };
};

interface State { map: BoardElement[]; sheets: Record<string, BoardElement[]>; uos: UnitOperation[]; registry: StreamRegistry; r?: SyncResult }

/** Sync, apply to every drawing, and give each UO on the map a drawing (as the editor does). */
function step(s: State): State {
  const r = syncProject({ board: { map: s.map, sheets: s.sheets }, uos: s.uos, registry: s.registry, now: NOW });
  const map = applyScope(s.map, r.changes[MAP]).elements;
  const sheets: Record<string, BoardElement[]> = {};
  for (const [k, els] of Object.entries(s.sheets)) sheets[k] = applyScope(els, r.changes[k]).elements;
  for (const u of r.uos) if (r.onMap.has(u.id) && !sheets[u.id]) sheets[u.id] = [frameJson(u.id, `${u.code} · ${u.name}`)];
  return { map, sheets, uos: r.uos, registry: r.registry, r };
}
const settle = (s: State) => step(step(s));

/** Two UOs on the map (10L, 100L), each with a drawing that has a frame and two pieces of equipment. */
function start(): State {
  const uos: UnitOperation[] = [{ id: "u10", code: "10L", name: "Seed 10 L", order: 1 }, { id: "u100", code: "100L", name: "Seed 100 L", order: 2 }];
  const map = [boxJson("bx10", "u10", 80, 80), boxJson("bx100", "u100", 440, 80)];
  const sheet = (uoId: string, name: string) => {
    const f = { ...frameJson(uoId, name), id: `f_${uoId}` };
    return [f, shape(`${uoId}_a`, 100, 100, f.id), shape(`${uoId}_b`, 300, 100, f.id)];
  };
  return { map, sheets: { u10: sheet("u10", "10L · Seed 10 L"), u100: sheet("u100", "100L · Seed 100 L") }, uos, registry: emptyReg() };
}
const el = (els: BoardElement[], id: string) => els.find((e) => e.id === id)!;
const textIn = (els: BoardElement[], containerId: string) => els.find((e) => e.type === "text" && e.containerId === containerId && !e.isDeleted);
const ports = (els: BoardElement[]) => els.filter((e) => !e.isDeleted && e.type === "rectangle" && pcsOf(e).port);
const withTransfer = (s: State, id = "t1") => ({ ...s, map: [...s.map, arrow(id, el(s.map, "bx10"), el(s.map, "bx100"))] });

describe("process map", () => {
  it("UO boxes get their '<code>\\n<name>' text; UO frames their '<code> · <name>' title", () => {
    const s = step(start());
    expect(textOf(textIn(s.map, "bx10")!)).toBe("10L\nSeed 10 L");
    expect(pcsOf(textIn(s.map, "bx100"))).toEqual({ boxLabel: true });
    expect(s.r!.uosChanged).toBe(false);
    expect([...s.r!.onMap].sort()).toEqual(["u10", "u100"]);
  });

  it("is stable: a second sync changes nothing", () => {
    let s = settle(withTransfer(start()));
    s = step({ ...s, sheets: { ...s.sheets, u10: [...s.sheets.u10, arrow("x1", el(s.sheets.u10, "u10_a"), el(s.sheets.u10, "u10_b"))] } });
    s = step(s);
    const again = syncProject({ board: { map: s.map, sheets: s.sheets }, uos: s.uos, registry: s.registry, now: NOW });
    expect(again.changes).toEqual({});
    expect([again.registryChanged, again.uosChanged]).toEqual([false, false]);
  });

  it("renaming on the box or on the frame renames the UO; a free code changes the code", () => {
    let s = step(start());
    const t = textIn(s.map, "bx100")!;
    s.map = s.map.map((e) => (e.id === t.id ? { ...e, text: "100L\nN-1 Seed", originalText: "100L\nN-1 Seed" } : e));
    s = step(s);
    expect(s.uos[1]).toMatchObject({ code: "100L", name: "N-1 Seed" });
    expect(el(s.sheets.u100, "f_u100").name).toBe("100L · N-1 Seed");
    s.sheets.u10 = s.sheets.u10.map((e) => (e.id === "f_u10" ? { ...e, name: "S10 · Seed flask" } : e));
    s = step(s);
    expect(s.uos[0]).toMatchObject({ code: "S10", name: "Seed flask" });
    expect(textOf(textIn(s.map, "bx10")!)).toBe("S10\nSeed flask");
    s.sheets.u10 = s.sheets.u10.map((e) => (e.id === "f_u10" ? { ...e, name: "100L · Taken" } : e));
    s = step(s);
    expect(s.uos[0]).toMatchObject({ code: "S10", name: "Taken" }); // 100L is taken: only the name changes
  });

  it("UO order follows the boxes left to right", () => {
    let s = step(start());
    s.map = s.map.map((e) => (e.id === "bx10" ? { ...e, x: 900 } : e));
    s = step(s);
    expect(s.uos.map((u) => u.code)).toEqual(["100L", "10L"]);
  });

  it("a copied box becomes a new UO with its own code and drawing", () => {
    let s = step(start());
    const copy = { ...el(s.map, "bx100"), id: "bxCopy", x: 800, boundElements: [{ id: "tCopy", type: "text" }] };
    const copyText = { ...textIn(s.map, "bx100")!, id: "tCopy", containerId: "bxCopy" };
    s = step({ ...s, map: [...s.map, copy, copyText] });
    expect(s.uos).toHaveLength(3);
    expect(new Set(s.uos.map((u) => u.code)).size).toBe(3);
    const added = s.uos[2];
    expect(added.name).toBe("Seed 100 L");
    expect(pcsOf(el(s.map, "bxCopy")).uoId).toBe(added.id);
    expect(s.sheets[added.id]).toHaveLength(1);
  });

  it("a deleted box leaves the UO off the map; its transfer ends and is retired", () => {
    let s = settle(withTransfer(start()));
    s.map = s.map.map((e) => (e.id === "bx100" || e.containerId === "bx100" ? { ...e, isDeleted: true } : e));
    s = step(s);
    expect([...s.r!.onMap]).toEqual(["u10"]);
    expect(s.uos.map((u) => u.code)).toEqual(["10L", "100L"]);
    expect(s.r!.report.retired).toEqual(["ST-10L-100L"]);
  });
});

describe("transfers and connectors", () => {
  it("an arrow between two boxes is a transfer, with a connector in each UO drawing", () => {
    const s = step(withTransfer(start()));
    expect(s.r!.streams.map((x) => [x.streamId, x.kind, x.scope])).toEqual([["ST-10L-100L", "transfer", MAP]]);
    expect(textOf(textIn(s.map, "t1")!)).toBe("ST-10L-100L");
    const [out] = ports(s.sheets.u10), [inn] = ports(s.sheets.u100);
    expect(pcsOf(out)).toEqual({ port: "ST-10L-100L", dir: "out" });
    expect(pcsOf(inn)).toEqual({ port: "ST-10L-100L", dir: "in" });
    expect(textOf(textIn(s.sheets.u10, out.id)!)).toBe("To 100L\nST-10L-100L");
    expect(textOf(textIn(s.sheets.u100, inn.id)!)).toBe("From 10L\nST-10L-100L");
    const f = el(s.sheets.u10, "f_u10");
    expect(out.x).toBeGreaterThan(f.x + f.width); // outgoing: right of the frame
    expect(inn.x + inn.width).toBeLessThan(el(s.sheets.u100, "f_u100").x); // incoming: left of the frame
  });

  it("arrows to a connector carry the transfer's ID and name, and get no ID of their own", () => {
    let s = step(withTransfer(start()));
    s.map = s.map.map((e) => (e.id === "t1" ? { ...e, customData: { pcs: { ...pcsOf(e), name: "Inoculum" } } } : e));
    const port = ports(s.sheets.u10)[0];
    s.sheets.u10 = [...s.sheets.u10, arrow("seg", el(s.sheets.u10, "u10_b"), port)];
    s = step(s);
    expect(pcsOf(el(s.sheets.u10, "seg"))).toEqual({ streamId: "ST-10L-100L", segment: true });
    expect(textOf(textIn(s.sheets.u10, "seg")!)).toBe("ST-10L-100L\nInoculum");
    expect(Object.keys(s.registry.active)).toEqual(["ST-10L-100L"]);
    expect(s.r!.streams).toHaveLength(1);
    expect(streamNamesOf({ map: { elements: s.map }, sheets: { u10: { elements: s.sheets.u10 } } })).toEqual(new Map([["ST-10L-100L", "Inoculum"]]));
  });

  it("deleting a transfer removes unused connectors, keeps used ones as 'Not connected'; undo reconnects with the same ID", () => {
    let s = step(withTransfer(start()));
    const port = ports(s.sheets.u10)[0];
    s.sheets.u10 = [...s.sheets.u10, arrow("seg", el(s.sheets.u10, "u10_b"), port)];
    s = step(s);
    const del = (on: boolean) => s.map.map((e) => (e.id === "t1" || e.containerId === "t1" ? { ...e, isDeleted: on } : e));
    s = step({ ...s, map: del(true) });
    expect(s.r!.report.retired).toEqual(["ST-10L-100L"]);
    expect(ports(s.sheets.u100)).toHaveLength(0);
    expect(pcsOf(ports(s.sheets.u10)[0])).toMatchObject({ orphan: true });
    expect(textOf(textIn(s.sheets.u10, port.id)!)).toBe("Not connected\nST-10L-100L");
    expect(pcsOf(el(s.sheets.u10, "seg"))).toEqual({});
    expect(textIn(s.sheets.u10, "seg")).toBeUndefined();
    s = settle({ ...s, map: del(false) });
    expect(s.r!.report.restored).toEqual([]); // restored in the first of the two steps
    expect(Object.keys(s.registry.active)).toEqual(["ST-10L-100L"]);
    expect(pcsOf(ports(s.sheets.u10)[0])).toEqual({ port: "ST-10L-100L", dir: "out" });
    expect(ports(s.sheets.u100)).toHaveLength(1);
    expect(pcsOf(el(s.sheets.u10, "seg"))).toEqual({ streamId: "ST-10L-100L", segment: true });
  });

  it("a redrawn transfer gets its old ID back; a parallel one gets -2 and its own connectors", () => {
    let s = step(withTransfer(start()));
    s = step({ ...s, map: s.map.map((e) => (e.id === "t1" || e.containerId === "t1" ? { ...e, isDeleted: true } : e)) });
    s = step(withTransfer(s, "t2"));
    expect(s.r!.report.restored).toEqual(["ST-10L-100L"]);
    s = step(withTransfer(s, "t3"));
    expect(s.r!.report.issued).toEqual(["ST-10L-100L-2"]);
    expect(ports(s.sheets.u10).map((p) => pcsOf(p).port).sort()).toEqual(["ST-10L-100L", "ST-10L-100L-2"]);
    const [p1, p2] = ports(s.sheets.u10).sort((a, b) => a.y - b.y);
    expect(p2.y).toBeGreaterThanOrEqual(p1.y + p1.height); // stacked, not on top of each other
  });

  it("a deleted connector comes back while its transfer exists", () => {
    let s = step(withTransfer(start()));
    const port = ports(s.sheets.u100)[0];
    s.sheets.u100 = s.sheets.u100.map((e) => (e.id === port.id || e.containerId === port.id ? { ...e, isDeleted: true } : e));
    s = step(s);
    expect(ports(s.sheets.u100)).toHaveLength(1);
    expect(ports(s.sheets.u100)[0].id).not.toBe(port.id);
  });

  it("an arrow inside one box, or from a box to nowhere, is not a transfer", () => {
    const s = step({ ...start(), map: [...start().map, arrow("n1", el(start().map, "bx10"), [300, 400])] });
    expect(s.r!.streams).toEqual([]);
  });
});

describe("streams in a UO drawing", () => {
  const withArrows = (s: State, ...extra: BoardElement[]) => ({ ...s, sheets: { ...s.sheets, u100: [...s.sheets.u100, ...extra] } });
  const a = () => shape("u100_a", 100, 100, "f_u100"), b = () => shape("u100_b", 300, 100, "f_u100");

  it("inside the frame, half outside, and outside", () => {
    const s = step(withArrows(start(),
      arrow("x1", a(), b()), arrow("x2", b(), a()), arrow("in", [-200, 130], a()), arrow("note", [-300, 900], [-100, 900])));
    const ids = Object.fromEntries(s.r!.streams.map((x) => [x.elementId, x.streamId]));
    expect(ids).toEqual({ x1: "ST-100L-001", x2: "ST-100L-002", in: "ST-100L-003" });
    expect(s.r!.streams.every((x) => x.scope === "u100" && x.uoId === "u100")).toBe(true);
    expect(textOf(textIn(s.sheets.u100, "x1")!)).toBe("ST-100L-001");
  });

  it("delete → retired, never reissued; undo → same ID back", () => {
    let s = step(withArrows(start(), arrow("x1", a(), b()), arrow("x2", b(), a())));
    const del = (id: string, on: boolean) => s.sheets.u100.map((e) => (e.id === id || e.containerId === id ? { ...e, isDeleted: on } : e));
    s = step({ ...s, sheets: { ...s.sheets, u100: del("x1", true) } });
    expect(s.r!.report.retired).toEqual(["ST-100L-001"]);
    s = step(withArrows(s, arrow("x3", a(), b())));
    expect(s.r!.report.issued).toEqual(["ST-100L-003"]);
    s = step({ ...s, sheets: { ...s.sheets, u100: del("x1", false) } });
    expect(s.r!.report.restored).toEqual(["ST-100L-001"]);
  });

  it("a copied arrow gets a new ID; the original keeps its own", () => {
    let s = step(withArrows(start(), arrow("x1", a(), b())));
    const x1 = el(s.sheets.u100, "x1");
    s = step(withArrows(s, { ...x1, id: "x1copy", boundElements: null }));
    expect(s.r!.streams.find((x) => x.elementId === "x1")!.streamId).toBe("ST-100L-001");
    expect(s.r!.streams.find((x) => x.elementId === "x1copy")!.streamId).toBe("ST-100L-002");
  });

  it("a label typed by the user becomes the stream name", () => {
    const x1 = { ...arrow("x1", a(), b()), boundElements: [{ id: "t", type: "text" }] };
    const typed: BoardElement = { id: "t", type: "text", x: 0, y: 0, width: 1, height: 1, text: "Basal media", containerId: "x1" };
    const s = step(withArrows(start(), x1, typed));
    expect(pcsOf(el(s.sheets.u100, "x1"))).toMatchObject({ streamId: "ST-100L-001", name: "Basal media" });
    expect(el(s.sheets.u100, "t")).toMatchObject({ text: "ST-100L-001\nBasal media", locked: true });
  });

  it("'not a stream' removes the ID and the label; the ID is retired", () => {
    let s = step(withArrows(start(), arrow("x1", a(), b())));
    s.sheets.u100 = s.sheets.u100.map((e) => (e.id === "x1" ? { ...e, customData: { pcs: { ...pcsOf(e), ignore: true } } } : e));
    s = step(s);
    expect(pcsOf(el(s.sheets.u100, "x1")).streamId).toBeUndefined();
    expect(textIn(s.sheets.u100, "x1")).toBeUndefined();
    expect(s.r!.report.retired).toEqual(["ST-100L-001"]);
  });

  it("an ID from a pasted drawing is kept when it fits and is free", () => {
    const s = step(withArrows(start(), arrow("x1", a(), b(), { streamId: "ST-100L-007" })));
    expect(s.r!.report.adopted).toEqual(["ST-100L-007"]);
    expect(s.registry.seq["100L"]).toBe(7);
  });

  it("without a frame every arrow in the drawing counts; a new frame there becomes the UO frame", () => {
    let s = step(start());
    s.sheets.u10 = s.sheets.u10.filter((e) => e.id !== "f_u10").map((e) => ({ ...e, frameId: null }));
    s = step({ ...s, sheets: { ...s.sheets, u10: [...s.sheets.u10, arrow("x1", el(s.sheets.u10, "u10_a"), [900, 900])] } });
    expect(s.r!.streams.map((x) => x.streamId)).toEqual(["ST-10L-001"]);
    s = step({ ...s, sheets: { ...s.sheets, u10: [...s.sheets.u10, { id: "fNew", type: "frame", x: 0, y: 0, width: 500, height: 400, name: "Frame" }] } });
    expect(pcsOf(el(s.sheets.u10, "fNew"))).toEqual({ kind: "uo", uoId: "u10" });
    expect(el(s.sheets.u10, "fNew").name).toBe("10L · Seed 10 L");
    expect(s.uos[0].name).toBe("Seed 10 L");
  });
});

describe("PFD links and lookups", () => {
  it("material counts sum the links on shapes in each UO drawing; the map does not count", () => {
    const s = step(start());
    const link = (e: BoardElement, materials: PcsData["materials"]) => ({ ...e, customData: { pcs: { materials } } });
    const board = {
      map: { elements: [link(shape("m", 0, 0), [{ materialId: "m1", qty: 9 }])] },
      sheets: {
        u10: { elements: s.sheets.u10.map((e) => (e.id === "u10_a" ? link(e, [{ materialId: "m1", qty: 2 }]) : e)) },
        u100: { elements: s.sheets.u100.map((e) => (e.id === "u100_a" ? link(e, [{ materialId: "m1", qty: 1 }, { materialId: "m2", qty: 3 }]) : e.id === "u100_b" ? link(e, [{ materialId: "m1", qty: 5 }]) : e)) },
      },
    };
    const counts = pfdMaterialCounts(board, s.uos);
    expect(Object.fromEntries(counts.get("u10")!)).toEqual({ m1: 2 });
    expect(Object.fromEntries(counts.get("u100")!)).toEqual({ m1: 6, m2: 3 });
    expect([...uosOnMap({ map: { elements: s.map } })].sort()).toEqual(["u10", "u100"]);
  });
});

describe("line materials on arrows", () => {
  it("links on arrows count in their drawing's UO; on the map, only transfers count, toward the destination", () => {
    let s = step(withTransfer(start()));
    const line = (e: BoardElement, qty: number) => ({ ...e, customData: { pcs: { ...pcsOf(e), materials: [{ materialId: "line15", qty }] } } });
    s.sheets.u10 = [...s.sheets.u10, line(arrow("x1", el(s.sheets.u10, "u10_a"), el(s.sheets.u10, "u10_b")), 2)];
    s.map = s.map.map((e) => (e.id === "t1" ? line(e, 1) : e));
    s.map = [...s.map, line(arrow("note", [0, 600], [200, 600]), 5)];
    s = step(s);
    expect(pcsOf(el(s.sheets.u10, "x1"))).toMatchObject({ streamId: "ST-10L-001", materials: [{ materialId: "line15", qty: 2 }] });
    const counts = pfdMaterialCounts({ map: { elements: s.map }, sheets: { u10: { elements: s.sheets.u10 }, u100: { elements: s.sheets.u100 } } }, s.uos, s.registry);
    expect(Object.fromEntries(counts.get("u10")!)).toEqual({ line15: 2 });
    expect(Object.fromEntries(counts.get("u100")!)).toEqual({ line15: 1 }); // the transfer's line, at its destination
    // Without the registry (older callers) the map is not read.
    expect(pfdMaterialCounts({ map: { elements: s.map }, sheets: {} }, s.uos).size).toBe(0);
  });
});

describe("project file v1 → v2", () => {
  it("each UO gets its own drawing; Stream IDs stay with their arrows", () => {
    const text = readFileSync(new URL("./fixtures/example-v1.pcs.json", import.meta.url), "utf8");
    const raw = JSON.parse(text);
    expect(raw.version).toBe(1);
    const { project: p, notes } = parseProject(text);
    expect(notes.some((n) => n.includes("Converted from project file v1"))).toBe(true);
    expect(Object.keys(p.pfd.sheets).sort()).toEqual(p.uos.map((u) => u.id).sort());
    const before = { ...p.streams.active };
    const r = syncProject({
      board: { map: p.pfd.map.elements as BoardElement[], sheets: Object.fromEntries(Object.entries(p.pfd.sheets).map(([k, v]) => [k, v.elements as BoardElement[]])) },
      uos: p.uos, registry: p.streams, now: NOW,
    });
    expect(r.report).toMatchObject({ issued: [], retired: [], restored: [], adopted: [] });
    expect(Object.keys(r.registry.active).sort()).toEqual(Object.keys(before).sort());
    for (const [id, o] of Object.entries(r.registry.active)) expect(o.elementId).toBe(before[id].elementId);
    // Transfers are on the map; each has a connector in both UO drawings, with an arrow from or to
    // the equipment the v1 arrow was bound to. The sync only adds their texts.
    const transfers = Object.entries(before).filter(([, o]) => o.kind === "transfer");
    expect(transfers.length).toBeGreaterThan(0);
    for (const [id, o] of transfers) {
      expect(r.streams.find((x) => x.streamId === id)?.scope).toBe(MAP);
      for (const [uoId, dir] of [[o.fromUoId!, "out"], [o.toUoId!, "in"]] as const) {
        const els = p.pfd.sheets[uoId].elements as BoardElement[];
        const port = els.find((e) => pcsOf(e).port === id && pcsOf(e).dir === dir)!;
        expect(port).toBeTruthy();
        const seg = els.find((e) => e.type === "arrow" && pcsOf(e).segment && (e.startBinding?.elementId === port.id || e.endBinding?.elementId === port.id));
        expect(seg && pcsOf(seg).streamId).toBe(id);
        expect(r.changes[uoId].ports).toEqual([]);
        expect(r.changes[uoId].texts.filter((x) => x.action === "create").map((x) => x.containerId)).toEqual(expect.arrayContaining([port.id, seg!.id]));
      }
    }
    // migrateBoardV1 is pure: running it twice gives the same element ids.
    const again = migrateBoardV1(raw.pfd, p.uos, raw.streams);
    expect(again.map.elements.map((e) => (e as BoardElement).id)).toEqual(p.pfd.map.elements.map((e) => (e as BoardElement).id));
  });
});
