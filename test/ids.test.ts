import { describe, expect, it } from "vitest";
import { bomUoCodeOf, isUoCode, newId, parseStreamId, pfdStreamId, suggestUoCode, transferStreamId } from "../src/model/ids";

describe("UO code", () => {
  it("suggested from the name", () => {
    const taken = new Set<string>();
    const names = ["Flask Culture", "10L Bioreactor", "Wave Bioreactor", "100L Bioreactor", "1st Chromatography", "Depth Filtration", "2nd Chromatography", "Viral Filtration"];
    const codes = names.map((n, i) => { const c = suggestUoCode(n, taken, i + 1); taken.add(c); return c; });
    expect(codes).toEqual(["FLASK", "10L", "WAVE", "100L", "CHROM1", "DEPTH", "CHROM2", "VIRAL"]);
  });
  it("volumes, non-Latin names, clashes", () => {
    expect(suggestUoCode("125 mL Shake Flask", new Set())).toBe("125ML");
    expect(suggestUoCode("0.5L Spinner", new Set())).toBe("0P5L");
    expect(suggestUoCode("배지 준비", new Set(), 3)).toBe("UO3");
    expect(suggestUoCode("Depth Filtration", new Set(["DEPTH"]))).toBe("DEPTH2");
    expect(isUoCode(suggestUoCode("2000L Single-Use Bioreactor", new Set()))).toBe(true);
    expect(isUoCode("100")).toBe(false);
  });
});

describe("Stream ID", () => {
  it("format and parse", () => {
    expect(pfdStreamId("100L", 1)).toBe("ST-100L-001");
    expect(transferStreamId("10L", "100L")).toBe("ST-10L-100L");
    expect(transferStreamId("10L", "100L", 2)).toBe("ST-10L-100L-2");
    expect(parseStreamId("ST-100L-001")).toEqual({ kind: "pfd", uo: "100L", seq: 1 });
    expect(parseStreamId("ST-10L-100L-2")).toEqual({ kind: "transfer", from: "10L", to: "100L", n: 2 });
    expect(parseStreamId("st-100l-001")).toBeNull();
    expect(bomUoCodeOf("ST-10L-100L")).toBe("100L");
    expect(() => pfdStreamId("100L", 1000)).toThrow();
  });
  it("newId does not repeat", () => {
    const ids = new Set(Array.from({ length: 2000 }, () => newId("x")));
    expect(ids.size).toBe(2000);
  });
});
