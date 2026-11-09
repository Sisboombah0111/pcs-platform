import { describe, expect, it } from "vitest";
import { cellNumber } from "../src/ui/cellSelection";

// The status bar sums what the cells show, as Excel does: only real numbers count.
describe("cellNumber", () => {
  it("reads numbers as the tables show them", () => {
    expect(cellNumber("1,980")).toBe(1980);
    expect(cellNumber("14,520")).toBe(14520);
    expect(cellNumber("4.7975")).toBe(4.7975);
    expect(cellNumber("-0.25")).toBe(-0.25);
    expect(cellNumber(".5")).toBe(0.5);
    expect(cellNumber("5 %")).toBe(5);
    expect(cellNumber("0")).toBe(0);
  });
  it("leaves codes, text and mixed values out", () => {
    for (const t of ["", "BUF-1001-B", "CHM-0001", "ST-PROA-002", "L", "MB (S 1,980 · R 0)", "1,98", "12 L", "Note", "1.2.3"]) expect(cellNumber(t)).toBeNull();
  });
});
