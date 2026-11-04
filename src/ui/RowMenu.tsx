import { useEffect, useState } from "react";

/** A small "⋯" menu for a table row (closes on a click elsewhere or Escape). */
export function RowMenu(props: { label: string; items: { label: string; aria?: string; danger?: boolean; onClick: () => void }[] }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => { if (!(e.target as Element)?.closest?.(".row-menu")) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", esc); };
  }, [open]);
  return (
    <span className="row-menu">
      <button className="btn ghost small" aria-label={props.label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>⋯</button>
      {open && (
        <span className="row-menu-list" role="menu">
          {props.items.map((it) => (
            <button key={it.label} role="menuitem" className={`row-menu-item${it.danger ? " danger" : ""}`} aria-label={it.aria ?? it.label} onClick={() => { setOpen(false); it.onClick(); }}>{it.label}</button>
          ))}
        </span>
      )}
    </span>
  );
}
