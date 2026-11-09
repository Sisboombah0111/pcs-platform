import { describe, expect, it } from "vitest";
import { boundsOf, extentOf, freeSpot } from "../src/pfd/placement";

describe("freeSpot", () => {
  it("keeps the spot when it is free", () => {
    expect(freeSpot([], 100, 100, 50, 50)).toEqual({ x: 100, y: 100 });
  });
  it("moves right of something already there, inside the frame", () => {
    const frame = { x: 0, y: 0, width: 400, height: 300 };
    const p = freeSpot([{ x: 100, y: 100, width: 50, height: 50 }], 100, 100, 50, 50, frame);
    expect(p).toEqual({ x: 180, y: 100 });
  });
  it("stays inside the frame when the right side is full", () => {
    const frame = { x: 0, y: 0, width: 260, height: 300 };
    const p = freeSpot([{ x: 100, y: 100, width: 50, height: 50 }], 100, 100, 50, 50, frame);
    expect(p.x).toBeGreaterThanOrEqual(10);
    expect(p.x + 50).toBeLessThanOrEqual(250);
    expect(p).not.toEqual({ x: 100, y: 100 });
  });
});

describe("freeSpot when the coarse grid is full", () => {
  it("finds the free corner of a crowded frame instead of covering a shape", () => {
    const frame = { x: 0, y: 0, width: 640, height: 420 };
    // Shapes of another size block every spot of the 110 × 150 grid around the centre, but not the bottom-right corner.
    const occupied = [{ x: 260, y: 140, width: 120, height: 140 }, { x: 30, y: 20, width: 560, height: 110 }, { x: 30, y: 140, width: 200, height: 260 }, { x: 400, y: 140, width: 60, height: 260 }];
    const p = freeSpot(occupied, 260, 140, 80, 120, frame);
    const hit = occupied.some((o) => p.x < o.x + o.width && p.x + 80 > o.x && p.y < o.y + o.height && p.y + 120 > o.y);
    expect(hit).toBe(false);
    expect(p.x + 80).toBeLessThanOrEqual(630);
    expect(p.y + 120).toBeLessThanOrEqual(410);
  });
});

describe("boundsOf", () => {
  it("covers all boxes", () => {
    expect(boundsOf([{ x: 0, y: 10, width: 5, height: 5 }, { x: -5, y: 0, width: 5, height: 40 }])).toEqual({ x: -5, y: 0, width: 10, height: 40 });
    expect(boundsOf([])).toBeNull();
  });
  it("a line counts where its points are (the filter's diagonal runs up from x, y)", () => {
    const diag = { x: 0, y: 72, width: 44, height: 72, points: [[0, 0], [44, -72]] as [number, number][] };
    expect(extentOf(diag)).toEqual({ x: 0, y: 0, width: 44, height: 72 });
    expect(boundsOf([{ x: 0, y: 0, width: 44, height: 72 }, diag])).toEqual({ x: 0, y: 0, width: 44, height: 72 });
  });
});
