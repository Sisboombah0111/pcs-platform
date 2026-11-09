import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { CELL_EVENT, cellText } from "./cellSelection";
import { columnLetter } from "./resize";

/**
 * A screen drawn as an Excel workbook (N5.3): a bar for the screen's state, a formula bar, the sheet (its tables get
 * column letters and row numbers from CSS, `.xl-auto` in styles.css) and the sheet tabs at the bottom. The tables
 * stay the screens' own (same rows, cells and handlers); this only lays them out and shows the active cell.
 */
export interface SheetTab { id: string; label: ReactNode; dot?: "ok" | "warn" | "err"; title?: string; className?: string }

export function Workbook(props: {
  /** Above the formula bar: the screen's state and notices. */
  bar?: ReactNode;
  tabs: SheetTab[];
  active: string;
  onPick: (id: string) => void;
  /** After the tabs (e.g. a link that opens the workbook elsewhere). */
  tabsEnd?: ReactNode;
  /** At the right of the tab bar (counts), like Excel's status text. */
  info?: ReactNode;
  children: ReactNode;
}) {
  const sheet = useRef<HTMLDivElement>(null);
  // Row numbers and column letters of the sheet's tables (drawn by CSS from data-rn / data-col), kept up to date
  // when rows come and go inside the screens' own components.
  useLayoutEffect(() => {
    const root = sheet.current;
    if (!root) return;
    let raf = 0;
    const number = () => { raf = 0; numberSheet(root); };
    number();
    const mo = new MutationObserver(() => { if (!raf) raf = requestAnimationFrame(number); });
    mo.observe(root, { childList: true, subtree: true });
    return () => { mo.disconnect(); cancelAnimationFrame(raf); };
  });
  return (
    <>
      {props.bar}
      <FormulaBar sheet={sheet} resetKey={props.active} />
      <div className="xl-sheet xl-auto" ref={sheet}>{props.children}</div>
      <div className="xl-tabbar">
        <nav className="xl-tabs" role="tablist" aria-label="Sheets">
          {props.tabs.map((t) => (
            <button key={t.id} role="tab" aria-selected={props.active === t.id} className={`xl-tab${t.className ? ` ${t.className}` : ""}`} title={t.title} onClick={() => props.onPick(t.id)}>
              {t.dot && <span className={`dot ${t.dot}`} aria-hidden="true" />}{t.label}
            </button>
          ))}
          {props.tabsEnd}
        </nav>
        {props.info && <span className="xl-info">{props.info}</span>}
      </div>
    </>
  );
}

const skipCol = (c: HTMLTableCellElement) => c.classList.contains("rn") || c.classList.contains("idx");

/** Number the visible rows of a sheet's tables in order (header rows too, as Excel's row 1) and letter the columns. */
export function numberSheet(root: HTMLElement) {
  let n = 0;
  for (const table of root.querySelectorAll<HTMLTableElement>("table.grid:not(.xl)")) {
    if (table.offsetParent === null) continue;
    const head = table.tHead?.rows[table.tHead.rows.length - 1];
    if (head) {
      let c = 0;
      for (const th of head.cells) {
        if (skipCol(th)) { delete th.dataset.col; continue; }
        const letter = columnLetter(c);
        if (th.dataset.col !== letter) th.dataset.col = letter;
        c += th.colSpan || 1;
      }
    }
    for (const tr of table.rows) {
      if (tr.classList.contains("xl-letters")) continue;
      n++;
      const first = tr.cells[0];
      if (first && first.dataset.rn !== String(n)) first.dataset.rn = String(n);
    }
  }
}

/** Where a cell is, as Excel names it: its column letter among the data columns and its row number in the sheet. */
export function cellRef(td: HTMLTableCellElement, sheet: HTMLElement): string {
  const tr = td.parentElement as HTMLTableRowElement;
  let col = 0;
  for (const c of tr.cells) {
    if (c === td) break;
    if (!skipCol(c)) col += c.colSpan || 1;
  }
  const rn = tr.cells[0]?.dataset.rn;
  if (rn) return `${columnLetter(col)}${rn}`;
  const rows = [...sheet.querySelectorAll<HTMLTableRowElement>("table.grid tr")].filter((r) => r.offsetParent !== null && !r.classList.contains("xl-letters"));
  return `${columnLetter(col)}${rows.indexOf(tr) + 1}`;
}

const textField = (el: Element | null): el is HTMLInputElement =>
  el instanceof HTMLInputElement && ["text", "search", ""].includes(el.getAttribute("type") ?? "") && !el.disabled && !el.readOnly;
const setValue = (el: HTMLInputElement, v: string) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, v);
  el.dispatchEvent(new Event("input", { bubbles: true }));
};

/**
 * The formula bar: the active cell's name, and what it holds — the whole text (a long name cut off in the table),
 * where a value comes from (`data-f`, `data-src` on the cell), or, for a cell with a text field, the text to edit
 * (typed here, it goes into the cell's own field, which saves it as typing in the cell does).
 */
function FormulaBar(props: { sheet: RefObject<HTMLDivElement | null>; resetKey: string }) {
  const [cell, setCell] = useState<HTMLTableCellElement | null>(null);
  const [, setTick] = useState(0);
  const editing = useRef<{ field: HTMLInputElement; before: string } | null>(null);

  useEffect(() => {
    const on = (e: Event) => {
      const td = (e as CustomEvent<HTMLTableCellElement | null>).detail;
      setCell(td && props.sheet.current?.contains(td) ? td : null);
    };
    window.addEventListener(CELL_EVENT, on);
    return () => window.removeEventListener(CELL_EVENT, on);
  }, [props.sheet]);
  useEffect(() => setCell(null), [props.resetKey]);
  // What is typed in the cell shows here at once.
  useEffect(() => {
    const root = props.sheet.current;
    if (!root || !cell) return;
    const on = () => setTick((t) => t + 1);
    root.addEventListener("input", on);
    root.addEventListener("change", on);
    return () => { root.removeEventListener("input", on); root.removeEventListener("change", on); };
  }, [cell, props.sheet]);

  const live = cell && cell.isConnected && props.sheet.current ? cell : null;
  const fields = live ? [...live.querySelectorAll("input, select, textarea")].filter((x) => !(x instanceof HTMLInputElement && (x.type === "checkbox" || x.type === "radio"))) : [];
  const field = fields.length === 1 && textField(fields[0]) ? fields[0] : null;

  const commit = () => {
    const e = editing.current;
    if (!e) return;
    editing.current = null;
    e.field.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  };
  const onKey = (ev: KeyboardEvent<HTMLInputElement>) => {
    if (ev.key === "Enter") { ev.preventDefault(); commit(); (ev.target as HTMLInputElement).blur(); }
    if (ev.key === "Escape" && editing.current) { ev.preventDefault(); setValue(editing.current.field, editing.current.before); commit(); (ev.target as HTMLInputElement).blur(); }
  };

  return (
    <div className="xl-fbar" aria-label="Formula bar">
      <span className="xl-namebox" aria-label="Cell">{live ? cellRef(live, props.sheet.current!) : ""}</span>
      <span className="xl-fx" aria-hidden="true">fx</span>
      {field ? (
        <input className="xl-formula-input" aria-label="Contents of the cell" value={field.value} spellCheck={false}
          onFocus={() => { editing.current = { field, before: field.value }; field.dispatchEvent(new FocusEvent("focusin", { bubbles: true })); }}
          onChange={(e) => { setValue(field, e.target.value); setTick((t) => t + 1); }}
          onBlur={commit} onKeyDown={onKey} />
      ) : (
        <span className="xl-formula">
          {live ? <>{live.dataset.f ?? cellText(live)}{live.dataset.src && <span className="xl-src">{live.dataset.src}{live.dataset.f ? ` · value ${cellText(live)}` : ""}</span>}</>
            : <span className="xl-src">Click a cell: its whole contents show here, and a text cell can be edited here too.</span>}
        </span>
      )}
    </div>
  );
}
