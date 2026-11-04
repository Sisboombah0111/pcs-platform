/** Where new things go on the board (pure geometry, no Excalidraw). */
export interface Box { x: number; y: number; width: number; height: number }

/**
 * Where to drop a new w×h item near (x, y) without covering what is already there: tries the spot
 * itself, then neighbouring spots in widening rings (right and below first), keeping inside `within`
 * (the UO frame) when one is given, then a finer search for the closest free spot (in the frame,
 * else anywhere near). Falls back to the original spot.
 */
export function freeSpot(occupied: Box[], x: number, y: number, w: number, h: number, within?: Box | null, gap = 30): { x: number; y: number } {
  const hits = (cx: number, cy: number) => occupied.some((o) =>
    cx < o.x + o.width + gap / 2 && cx + w + gap / 2 > o.x && cy < o.y + o.height + gap / 2 && cy + h + gap / 2 > o.y);
  const inside = (cx: number, cy: number) => !within || (cx >= within.x + 10 && cy >= within.y + 10 && cx + w <= within.x + within.width - 10 && cy + h <= within.y + within.height - 10);
  const sx = w + gap, sy = h + gap;
  for (let r = 0; r <= 6; r++) {
    const ring: [number, number][] = [];
    for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) if (Math.max(Math.abs(i), Math.abs(j)) === r) ring.push([i, j]);
    ring.sort((a, b) => (Math.abs(a[1]) - Math.abs(b[1])) || (b[0] - a[0]) || (b[1] - a[1])); // same row first, rightwards first
    for (const [i, j] of ring) {
      const cx = Math.round(x + i * sx), cy = Math.round(y + j * sy);
      if (inside(cx, cy) && !hits(cx, cy)) return { x: cx, y: cy };
    }
  }
  // No spot on that coarse grid: look finer, the closest free spot first (in the frame, else anywhere near).
  const scan = (area: Box, keepInside: boolean, step: number) => {
    let best: { x: number; y: number } | null = null, bestD = Infinity;
    for (let cy = area.y; cy <= area.y + area.height - h; cy += step) {
      for (let cx = area.x; cx <= area.x + area.width - w; cx += step) {
        if ((keepInside && !inside(cx, cy)) || hits(cx, cy)) continue;
        const d = Math.hypot(cx - x, cy - y);
        if (d < bestD) { bestD = d; best = { x: Math.round(cx), y: Math.round(cy) }; }
      }
    }
    return best;
  };
  const near = { x: x - 6 * sx, y: y - 6 * sy, width: 12 * sx + w, height: 12 * sy + h };
  return (within ? scan(within, true, 10) : null) ?? scan(near, false, 20) ?? { x: Math.round(x), y: Math.round(y) };
}

/** Bounding box of a set of elements, or null when empty. */
export function boundsOf(els: Box[]): Box | null {
  if (!els.length) return null;
  const x0 = Math.min(...els.map((e) => e.x)), y0 = Math.min(...els.map((e) => e.y));
  const x1 = Math.max(...els.map((e) => e.x + e.width)), y1 = Math.max(...els.map((e) => e.y + e.height));
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}
