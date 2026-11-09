import { useEffect, useRef, useState } from "react";

/**
 * Excel-like cell selection on the screens' tables (N5.2): click a cell, Shift+click or drag to a second one, and
 * the status bar shows Average, Count and Sum of the selected cells; Ctrl+C copies them as tab-separated text that
 * pastes into Excel as cells. Only looks at what the table shows (never changes project data).
 */
export interface SelectionStats { cells: number; count: number; numbers: number; sum: number; rows: number; cols: number }

type Pos = { table: HTMLTableElement; row: number; col: number };

const NUMBER = /^[-+]?(\d{1,3}(,\d{3})+|\d+)?(\.\d+)?([eE][-+]?\d+)?$/;
/** A number as shown in a cell ("1,980", "-0.25", "5 %" → 5), or null. */
export function cellNumber(text: string): number | null {
  const t = text.replace(/\s*%$/, "").trim();
  if (!t || !/\d/.test(t) || !NUMBER.test(t)) return null;
  const n = Number(t.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** What a cell shows: the value of its only input or select, otherwise its text. */
export function cellText(td: HTMLTableCellElement): string {
  const controls = td.querySelectorAll<HTMLInputElement | HTMLSelectElement>("input:not([type=checkbox]):not([type=radio]), select");
  if (controls.length === 1) {
    const c = controls[0];
    return (c instanceof HTMLSelectElement ? c.selectedOptions[0]?.textContent ?? "" : c.value).trim();
  }
  const box = td.querySelector<HTMLInputElement>("input[type=checkbox]");
  if (box && !td.textContent?.trim()) return box.checked ? "TRUE" : "FALSE";
  return (td.innerText ?? td.textContent ?? "").replace(/\s+/g, " ").trim();
}

const bodyRows = (table: HTMLTableElement) => [...table.tBodies].flatMap((b) => [...b.rows]);
/** The visual column where each cell of a row starts (colspans counted). */
function columnsOf(tr: HTMLTableRowElement): { td: HTMLTableCellElement; from: number; to: number }[] {
  let c = 0;
  return [...tr.cells].map((td) => { const from = c; c += td.colSpan || 1; return { td, from, to: c - 1 }; });
}
function posOf(td: HTMLTableCellElement): Pos | null {
  const table = td.closest("table");
  const tr = td.parentElement as HTMLTableRowElement | null;
  if (!table || !tr || tr.parentElement?.tagName !== "TBODY" || !table.classList.contains("grid")) return null;
  const row = bodyRows(table).indexOf(tr);
  const col = columnsOf(tr).find((x) => x.td === td)?.from ?? 0;
  return row < 0 ? null : { table, row, col };
}

/** The active cell, for the formula bar (Workbook.tsx): sent on every change of the selection. */
export const CELL_EVENT = "pcs:cell";
function announce(td: HTMLTableCellElement | null) {
  window.dispatchEvent(new CustomEvent<HTMLTableCellElement | null>(CELL_EVENT, { detail: td }));
}

export function useCellSelection(root: HTMLElement | null, resetKey: unknown, onCopied?: (rows: number, cols: number) => void): SelectionStats | null {
  const [stats, setStats] = useState<SelectionStats | null>(null);
  const sel = useRef<{ anchor: Pos; focus: Pos } | null>(null);
  const painted = useRef<HTMLTableCellElement[]>([]);
  const copied = useRef(onCopied);
  copied.current = onCopied;

  useEffect(() => {
    const clear = () => {
      for (const td of painted.current) td.classList.remove("cell-sel", "cell-cur");
      painted.current = [];
      sel.current = null;
      setStats(null);
      announce(null);
    };
    clear();
    if (!root) return;

    /** The selected cells, row by row. */
    const cellsOf = (): HTMLTableCellElement[][] => {
      const s = sel.current;
      if (!s || !s.anchor.table.isConnected) return [];
      const [r0, r1] = [Math.min(s.anchor.row, s.focus.row), Math.max(s.anchor.row, s.focus.row)];
      const [c0, c1] = [Math.min(s.anchor.col, s.focus.col), Math.max(s.anchor.col, s.focus.col)];
      return bodyRows(s.anchor.table).slice(r0, r1 + 1).map((tr) => columnsOf(tr).filter((x) => x.to >= c0 && x.from <= c1).map((x) => x.td));
    };
    const paint = () => {
      for (const td of painted.current) td.classList.remove("cell-sel", "cell-cur");
      const s = sel.current;
      if (!s) { painted.current = []; setStats(null); return; }
      const rows = cellsOf();
      const flat = rows.flat();
      const many = flat.length > 1;
      for (const td of flat) if (many) td.classList.add("cell-sel");
      const cur = bodyRows(s.anchor.table)[s.anchor.row] && columnsOf(bodyRows(s.anchor.table)[s.anchor.row]).find((x) => x.from <= s.anchor.col && x.to >= s.anchor.col)?.td;
      cur?.classList.add("cell-cur");
      painted.current = cur ? [...flat, cur] : flat;
      announce(cur ?? null);
      let count = 0, numbers = 0, sum = 0;
      for (const td of flat) {
        const t = cellText(td);
        if (!t) continue;
        count++;
        const n = cellNumber(t);
        if (n !== null) { numbers++; sum += n; }
      }
      setStats({ cells: flat.length, count, numbers, sum, rows: rows.length, cols: Math.max(0, ...rows.map((r) => r.length)) });
    };

    const onDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      const target = e.target as HTMLElement;
      if (!root.contains(target)) return;
      if (target.closest(".dialog, .gc-overlay, .scrim, .xl-fbar")) return; // the formula bar edits the active cell
      const td = target.closest("td") as HTMLTableCellElement | null;
      const pos = td ? posOf(td) : null;
      if (!pos) { if (sel.current) clear(); return; }
      // The row header (a sheet's row number, or the select box of a Materials row): the whole row, as in Excel.
      if (td && (td.classList.contains("rn") || (td.classList.contains("idx") && (e.target as HTMLElement).tagName !== "INPUT")) && !e.shiftKey) {
        const tr = td.parentElement as HTMLTableRowElement;
        const cols = columnsOf(tr);
        const first = cols.find((c) => !c.td.classList.contains("rn") && !c.td.classList.contains("idx")) ?? cols[0];
        sel.current = { anchor: { ...pos, col: first.from }, focus: { ...pos, col: cols[cols.length - 1].to } };
        paint();
        return;
      }
      if (e.shiftKey && sel.current && sel.current.anchor.table === pos.table) {
        sel.current = { anchor: sel.current.anchor, focus: pos };
        window.getSelection()?.removeAllRanges();
      } else sel.current = { anchor: pos, focus: pos };
      paint();
      const move = (ev: MouseEvent) => {
        const over = (document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null)?.closest("td") as HTMLTableCellElement | null;
        const p = over ? posOf(over) : null;
        const s = sel.current;
        if (!p || !s || p.table !== s.anchor.table || (p.row === s.focus.row && p.col === s.focus.col)) return;
        sel.current = { anchor: s.anchor, focus: p };
        // dragging over several cells selects cells, not the text in them
        if (p.row !== s.anchor.row || p.col !== s.anchor.col) window.getSelection()?.removeAllRanges();
        paint();
      };
      const up = () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
      window.addEventListener("mousemove", move);
      window.addEventListener("mouseup", up);
    };

    const editing = (el: Element | null) => !!el && (el.matches("input:not([type=checkbox]):not([type=radio]), textarea, select, [contenteditable='true']"));
    const onCopy = (e: ClipboardEvent) => {
      const rows = cellsOf();
      const n = rows.flat().length;
      if (!n || !e.clipboardData) return;
      // One cell while typing in it: the browser copies the selected text as usual.
      if (n === 1 && editing(document.activeElement)) return;
      const text = window.getSelection()?.toString() ?? "";
      if (n === 1 && text && !editing(document.activeElement)) return;
      e.clipboardData.setData("text/plain", rows.map((r) => r.map((td) => cellText(td).replace(/[\t\n]/g, " ")).join("\t")).join("\r\n"));
      e.preventDefault();
      copied.current?.(rows.length, Math.max(...rows.map((r) => r.length)));
    };
    // ---- the keyboard, as in Excel: arrows, Tab and Enter move; Shift+arrows extend; F2 or typing edits ----
    const cellAt = (table: HTMLTableElement, row: number, col: number) => {
      const tr = bodyRows(table)[row];
      return tr ? columnsOf(tr).find((x) => x.from <= col && x.to >= col)?.td ?? null : null;
    };
    const editorOf = (td: HTMLTableCellElement | null) =>
      td?.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("input:not([type=checkbox]):not([type=radio]):not([disabled]):not([readonly]), select:not([disabled]), textarea:not([disabled])") ?? null;
    const textEditor = (el: Element | null): el is HTMLInputElement =>
      el instanceof HTMLInputElement && ["text", "search", ""].includes(el.getAttribute("type") ?? "");
    /** Move the active cell by (dr, dc); extend keeps the anchor. Returns the new cell. */
    const move = (dr: number, dc: number, extend: boolean): HTMLTableCellElement | null => {
      const s = sel.current;
      if (!s) return null;
      const from = extend ? s.focus : s.anchor;
      const rows = bodyRows(s.anchor.table).length;
      const width = Math.max(...bodyRows(s.anchor.table).map((tr) => columnsOf(tr).at(-1)?.to ?? 0)) + 1;
      const row = Math.min(rows - 1, Math.max(0, from.row + dr));
      // sideways from a cell that spans columns: from its edge
      const here = cellAt(s.anchor.table, from.row, from.col);
      const span = here ? columnsOf(here.parentElement as HTMLTableRowElement).find((c) => c.td === here) : undefined;
      const start = dc > 0 ? span?.to ?? from.col : dc < 0 ? span?.from ?? from.col : from.col;
      const col = Math.min(width - 1, Math.max(0, start + dc));
      const td = cellAt(s.anchor.table, row, col);
      if (!td) return null;
      const pos = { table: s.anchor.table, row, col };
      sel.current = extend ? { anchor: s.anchor, focus: pos } : { anchor: pos, focus: pos };
      paint();
      td.scrollIntoView({ block: "nearest", inline: "nearest" });
      return td;
    };
    const inThisTable = (el: Element | null) => !!el && !!sel.current && sel.current.anchor.table.contains(el);
    const onKey = (e: KeyboardEvent) => {
      const s = sel.current;
      if (!s || e.isComposing || e.key === "Process" || e.altKey) return;
      if (!s.anchor.table.isConnected) { clear(); return; }
      const active = document.activeElement;
      if (active && active.closest(".dialog, .gc-overlay, .scrim")) return;
      const free = !active || active === document.body;
      const ctrl = e.ctrlKey || e.metaKey;
      const arrows: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
      if (free) {
        if (e.key === "Escape") { clear(); return; }
        if (ctrl) return;
        if (arrows[e.key]) { e.preventDefault(); move(arrows[e.key][0], arrows[e.key][1], e.shiftKey); return; }
        if (e.key === "Tab") { e.preventDefault(); move(0, e.shiftKey ? -1 : 1, false); return; }
        if (e.key === "Enter") { e.preventDefault(); move(e.shiftKey ? -1 : 1, 0, false); return; }
        const cur = cellAt(s.anchor.table, s.anchor.row, s.anchor.col);
        const ed = editorOf(cur);
        if (e.key === "F2" && ed) { e.preventDefault(); ed.focus(); if (textEditor(ed)) ed.setSelectionRange(ed.value.length, ed.value.length); return; }
        // Typing on a selected cell starts editing it with what is typed, as in Excel.
        if (e.key.length === 1 && textEditor(ed)) {
          e.preventDefault();
          ed.focus();
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(ed, e.key);
          ed.dispatchEvent(new Event("input", { bubbles: true }));
          ed.setSelectionRange(1, 1);
        }
        return;
      }
      // In a cell's text field: ↑ ↓ go to the cell above or below (into its field), Enter commits and goes down.
      if (textEditor(active) && inThisTable(active) && !ctrl && !e.shiftKey && active.closest("td") && !active.closest(".op-adder")) {
        if (e.key === "ArrowUp" || e.key === "ArrowDown") {
          e.preventDefault();
          const td = move(e.key === "ArrowUp" ? -1 : 1, 0, false);
          const ed = editorOf(td);
          if (ed) { ed.focus(); if (textEditor(ed)) ed.select(); } else (active as HTMLElement).blur();
          return;
        }
        if (e.key === "Enter" && active.classList.contains("cell-input")) {
          // the field's own Enter (commit, blur) has run; then the cell below is selected
          requestAnimationFrame(() => { if (document.activeElement === active) (active as HTMLElement).blur(); move(1, 0, false); });
        }
      }
    };

    // A value typed into a selected cell: the sums follow.
    const onEdit = () => { if (sel.current) requestAnimationFrame(paint); };

    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("copy", onCopy);
    document.addEventListener("keydown", onKey);
    root.addEventListener("input", onEdit);
    root.addEventListener("change", onEdit);
    return () => {
      root.removeEventListener("input", onEdit);
      root.removeEventListener("change", onEdit);
      document.removeEventListener("mousedown", onDown, true);
      document.removeEventListener("copy", onCopy);
      document.removeEventListener("keydown", onKey);
      clear();
    };
  }, [root, resetKey]);

  return stats;
}
