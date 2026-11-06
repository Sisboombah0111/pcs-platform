import { useState, type ReactNode } from "react";

/**
 * A screen's explanation under its title: the first sentence always, the rest behind "More…" so the data starts
 * higher on a laptop screen. Open or closed is remembered per screen in this browser (the Guide › This screen
 * tab explains every screen in full).
 */
export function PageIntro(props: { id: string; lead: ReactNode; children?: ReactNode }) {
  const key = `pcs.intro.${props.id}`;
  const [open, setOpen] = useState(() => { try { return localStorage.getItem(key) === "1"; } catch { return false; } });
  const toggle = () => {
    const next = !open;
    setOpen(next);
    try { if (next) localStorage.setItem(key, "1"); else localStorage.removeItem(key); } catch { /* storage off: this visit only */ }
  };
  return (
    <p>
      {props.lead}
      {open && props.children && <> {props.children}</>}
      {props.children && <> <button className="intro-toggle" aria-expanded={open} onClick={toggle}>{open ? "Less" : "More…"}</button></>}
    </p>
  );
}
