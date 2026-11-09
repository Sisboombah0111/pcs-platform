import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

/**
 * A cell that reads as one line of text and opens a list below it to change it, as an Excel cell with a drop-down
 * list (N5.4): click the cell's value or its ▾, or select the cell and press Alt+↓ or F2. The list holds the screen's
 * own editor (the same buttons and choices as before), so what is saved does not change. Esc or a click elsewhere
 * closes it. Near the bottom of the sheet the list opens upwards, as Excel's does.
 */
export function CellDropdown(props: { label: string; summary: ReactNode; empty?: string; title?: string; bad?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [up, setUp] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const cell = box.current;
    const pop = cell?.querySelector<HTMLElement>(".cell-pop");
    if (!open || !cell || !pop) { setUp(false); return; }
    const view = scrollView(cell);
    const c = cell.getBoundingClientRect();
    const below = view.bottom - c.bottom, above = c.top - view.top;
    setUp(pop.getBoundingClientRect().height > below && above > below);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Esc in a field of the list (a new tag being typed) is that field's own cancel. The path is the one at the
      // key press: the field may be gone by now (its cancel removed it).
      if (e.target instanceof HTMLInputElement && e.composedPath().some((n) => n instanceof HTMLElement && n.classList.contains("cell-pop"))) return;
      setOpen(false);
      box.current?.querySelector<HTMLButtonElement>(".cell-dd-value")?.focus();
    };
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", down); document.removeEventListener("keydown", key); };
  }, [open]);
  return (
    <div className={`cell-dd${open ? " open" : ""}${props.bad ? " bad" : ""}`} ref={box}>
      <button type="button" className="cell-dd-value" data-dropdown="" aria-haspopup="dialog" aria-expanded={open} aria-label={props.label} title={props.title}
        onClick={() => setOpen(!open)}>
        <span className="cell-dd-text">{props.summary || <span className="faint">{props.empty ?? ""}</span>}</span>
      </button>
      {open && <div className={`cell-pop${up ? " up" : ""}`} role="dialog" aria-label={props.label}>{props.children}</div>}
    </div>
  );
}

/** The visible part of the nearest scrolling box around an element (the sheet), or the window. */
function scrollView(el: HTMLElement): { top: number; bottom: number } {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY;
    if (o === "auto" || o === "scroll") { const r = p.getBoundingClientRect(); return { top: r.top, bottom: r.top + p.clientHeight }; }
  }
  return { top: 0, bottom: window.innerHeight };
}
