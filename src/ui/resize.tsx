/**
 * Sizes the user drags: the PFD side panel and table columns. Remembered in this browser only
 * (a viewer convenience, not project data); every storage access may fail and is guarded.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";

const PREFIX = "pcs.size.";
function load<T>(key: string): T | undefined {
  try { const v = localStorage.getItem(PREFIX + key); return v ? (JSON.parse(v) as T) : undefined; } catch { return undefined; }
}
function save(key: string, value: unknown) {
  try { if (value === undefined) localStorage.removeItem(PREFIX + key); else localStorage.setItem(PREFIX + key, JSON.stringify(value)); } catch { /* storage unavailable: keep it for this session */ }
}

/** Follow a pointer drag from `e`: `onMove(dx)` with the distance from the start, `onEnd` when released. */
function drag(e: ReactPointerEvent, onMove: (dx: number) => void, onEnd?: () => void) {
  e.preventDefault();
  const x0 = e.clientX;
  const move = (ev: PointerEvent) => onMove(ev.clientX - x0);
  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", up);
    document.body.classList.remove("resizing");
    onEnd?.();
  };
  document.body.classList.add("resizing");
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", up);
}

// ---- the PFD side panel -------------------------------------------------------------------------------------

export const PANEL_DEFAULT = 340;
const PANEL_MIN = 280;
const panelMax = () => Math.max(PANEL_MIN, Math.min(900, Math.round(window.innerWidth * 0.6)));
const clampPanel = (w: number) => Math.round(Math.min(panelMax(), Math.max(PANEL_MIN, w)));

/** Width of a side panel resized by dragging its left edge (it grows to the left). */
export function usePanelWidth(key: string) {
  const [width, setWidth] = useState(() => clampPanel(load<number>(key) ?? PANEL_DEFAULT));
  const widthRef = useRef(width);
  widthRef.current = width;
  const set = useCallback((w: number) => { const c = clampPanel(w); setWidth(c); save(key, c === PANEL_DEFAULT ? undefined : c); }, [key]);
  useEffect(() => {
    const onResize = () => setWidth((w) => clampPanel(w));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const handle = {
    role: "separator" as const,
    "aria-orientation": "vertical" as const,
    "aria-label": "Resize the side panel (double-click: default width)",
    "aria-valuenow": width,
    "aria-valuemin": PANEL_MIN,
    "aria-valuemax": panelMax(),
    tabIndex: 0,
    title: "Drag to resize · double-click for the default width",
    onPointerDown: (e: ReactPointerEvent) => { const w0 = widthRef.current; drag(e, (dx) => set(w0 - dx)); },
    onDoubleClick: () => set(PANEL_DEFAULT),
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") { e.preventDefault(); set(widthRef.current + 20); }
      if (e.key === "ArrowRight") { e.preventDefault(); set(widthRef.current - 20); }
    },
  };
  return { width, set, handle };
}

// ---- table columns ------------------------------------------------------------------------------------------

/** Column widths per table key, shared by every table with that key (e.g. all BOM unit sections). */
const store = new Map<string, Record<string, number>>();
const listeners = new Set<() => void>();
const empty: Record<string, number> = {};
function widthsOf(key: string): Record<string, number> {
  if (!store.has(key)) store.set(key, load<Record<string, number>>("cols." + key) ?? empty);
  return store.get(key)!;
}
function setWidths(key: string, next: Record<string, number>) {
  store.set(key, next);
  save("cols." + key, Object.keys(next).length ? next : undefined);
  listeners.forEach((l) => l());
}
const subscribe = (l: () => void) => { listeners.add(l); return () => listeners.delete(l); };

export interface ColumnDef {
  id: string;
  /** Starting width in px; not set = share the free space until the user sizes a column. */
  width?: number;
  /** Narrowest the user can make it (default 48). */
  min?: number;
}

/**
 * Columns a user can resize by dragging the right edge of their header. Before any drag the table
 * lays out as before; the first drag fixes every column at its current width (so the others keep
 * theirs), and the table grows or shrinks (it scrolls sideways in its .table-wrap). Double-click a
 * handle to go back to the automatic widths.
 */
export function useColumns(key: string, columns: ColumnDef[]) {
  const widths = useSyncExternalStore(subscribe, () => widthsOf(key), () => empty);
  const tableRef = useRef<HTMLTableElement>(null);
  const sized = columns.some((c) => widths[c.id] != null);
  const widthOf = (c: ColumnDef) => widths[c.id] ?? c.width;
  const total = sized ? columns.reduce((n, c) => n + (widthOf(c) ?? 120), 0) : undefined;

  const start = (i: number) => (e: ReactPointerEvent) => {
    e.stopPropagation();
    // Freeze the widths the columns have on screen now.
    const ths = [...(tableRef.current?.querySelectorAll<HTMLTableCellElement>(":scope > thead > tr:first-child > th") ?? [])];
    const now: Record<string, number> = {};
    columns.forEach((c, j) => { now[c.id] = Math.round(widths[c.id] ?? ths[j]?.getBoundingClientRect().width ?? c.width ?? 120); });
    const id = columns[i].id;
    const w0 = now[id];
    const min = columns[i].min ?? 48;
    drag(e, (dx) => setWidths(key, { ...now, [id]: Math.max(min, Math.round(w0 + dx)) }));
  };
  const reset = (e: ReactMouseEvent) => { e.stopPropagation(); setWidths(key, {}); };

  const colgroup = (
    <colgroup>{columns.map((c) => { const w = widthOf(c); return <col key={c.id} style={w != null ? { width: w } : undefined} />; })}</colgroup>
  );
  // Before any drag: never narrower than the starting widths (the table scrolls sideways instead of squeezing
  // a free column to nothing).
  const floor = columns.reduce((n, c) => n + (c.width ?? c.min ?? 120), 0);
  const tableStyle: CSSProperties = sized ? { tableLayout: "fixed", width: total, minWidth: total } : { minWidth: floor };
  /** The drag handle for column i: put it inside that column's <th>. */
  const handle = (i: number) => (
    <span className="col-resizer" role="separator" aria-orientation="vertical" aria-label={`Resize column ${i + 1}`}
      title="Drag to resize · double-click: automatic widths" onPointerDown={start(i)} onDoubleClick={reset} onClick={(e) => e.stopPropagation()} />
  );
  return { tableRef, colgroup, tableStyle, handle, sized, reset: () => setWidths(key, {}) };
}

/** A header cell of a resizable table. */
export interface Head extends ColumnDef {
  label?: ReactNode;
  className?: string;
  title?: string;
  ariaLabel?: string;
}

/** The <thead> of a table made with useColumns: one row, a drag handle at the right edge of each header. */
export function HeadRow(props: { heads: Head[]; cols: ReturnType<typeof useColumns> }) {
  return (
    <thead>
      <tr>
        {props.heads.map((h, i) => (
          <th key={h.id} className={h.className} title={h.title} aria-label={h.ariaLabel}>{h.label}{props.cols.handle(i)}</th>
        ))}
      </tr>
    </thead>
  );
}
