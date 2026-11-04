import { describe, expect, it } from "vitest";
import { copyDrawing, copyTag, suggestRetag } from "../src/pfd/duplicate";
import type { BoardElement } from "../src/pfd/sync";

const el = (id: string, type: string, extra: Partial<BoardElement> = {}): BoardElement => ({ id, type, x: 0, y: 0, width: 10, height: 10, ...extra });

describe("duplicate a unit operation's drawing", () => {
  const els: BoardElement[] = [
    el("frame", "frame", { name: "PROA · Protein A", customData: { pcs: { kind: "uo", uoId: "u1" } } }),
    el("valve", "line", { frameId: "frame", groupIds: ["g1"], customData: { pcs: { symbol: "valve", equipmentId: "e1" } } }),
    el("vlabel", "text", { frameId: "frame", groupIds: ["g1"], text: "XV-101" }),
    el("tank", "rectangle", { frameId: "frame", boundElements: [{ id: "a1", type: "arrow" }], customData: { pcs: { equipmentId: "e2" } } }),
    el("a1", "arrow", { frameId: "frame", startBinding: { elementId: "tank" }, endBinding: { elementId: "port" }, customData: { pcs: { streamId: "ST-PROA-CEX", segment: true } } }),
    el("a2", "arrow", { frameId: "frame", startBinding: { elementId: "valve" }, endBinding: { elementId: "tank" }, boundElements: [{ id: "lab", type: "text" }], customData: { pcs: { streamId: "ST-PROA-001", name: "Feed" } } }),
    el("lab", "text", { containerId: "a2", text: "ST-PROA-001\nFeed", customData: { pcs: { label: true } } }),
    el("port", "rectangle", { customData: { pcs: { port: "ST-PROA-CEX", dir: "out" } } }),
    el("ptext", "text", { containerId: "port", text: "To CEX" }),
    el("gone", "rectangle", { isDeleted: true }),
  ];

  it("copies with new ids, the frame for the new UO, arrows without IDs, connectors left out", () => {
    const { elements, idMap } = copyDrawing(els, { uoId: "u9", frameName: "PROA2 · Protein A (copy)", equipment: new Map([["e1", "e9"]]) });
    expect(elements.map((e) => (e as { text?: string }).text ?? e.type)).toEqual(["frame", "line", "XV-101", "rectangle", "arrow", "ST-PROA-001\nFeed"]);
    expect(idMap.has("port") || idMap.has("ptext") || idMap.has("a1") || idMap.has("gone")).toBe(false);
    const by = (old: string) => elements.find((e) => e.id === idMap.get(old))!;
    expect(by("frame").name).toBe("PROA2 · Protein A (copy)");
    expect(by("frame").customData).toEqual({ pcs: { kind: "uo", uoId: "u9" } });
    expect(by("valve").frameId).toBe(idMap.get("frame"));
    expect(by("valve").groupIds).toEqual(by("vlabel").groupIds);
    expect(by("valve").groupIds![0]).not.toBe("g1");
    expect(by("valve").customData).toEqual({ pcs: { symbol: "valve", equipmentId: "e9" } });
    expect(by("tank").customData).toEqual({ pcs: {} });
    expect(by("tank").boundElements).toEqual([]);
    expect(by("a2").customData).toEqual({ pcs: { name: "Feed" } });
    expect(by("a2").startBinding).toEqual({ elementId: idMap.get("valve") });
    expect(by("a2").boundElements).toEqual([{ id: idMap.get("lab"), type: "text" }]);
    expect(by("lab").containerId).toBe(idMap.get("a2"));
    expect(new Set(elements.map((e) => e.id)).size).toBe(6);
    expect(elements.some((e) => els.some((o) => o.id === e.id))).toBe(false);
  });

  it("renumbers tags for the copy", () => {
    const taken = new Set(["XV-101", "XV-201", "P-101"]);
    expect(copyTag("XV-101", "-1", "-2", taken)).toBe("XV-201-2");
    expect(copyTag("P-101", "-1", "-2", taken)).toBe("P-201");
    expect(copyTag("F101", "-1", "-2", taken)).toBe("F101-2");
    expect(copyTag("T-1", "", "-B", taken)).toBe("T-1-B");
    expect(suggestRetag(["XV-101", "XV-102", "P-101", "AG-201"])).toEqual({ from: "-1", to: "-2" });
    expect(suggestRetag(["XV-201", "P-202"])).toEqual({ from: "-2", to: "-3" });
    expect(suggestRetag(["PUMP"])).toEqual({ from: "", to: "-B" });
  });
});
