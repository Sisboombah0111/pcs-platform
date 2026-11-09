import { useMemo, useState } from "react";
import type { Project } from "../model/types";
import { downloadBlob } from "../storage/files";
import { Dialog } from "../ui/Dialog";
import { writeWorkbook } from "../xlsx/workbook";

const USER_KEY = "pcs.userName";
/** The name written with changes (also set on Mass Balance and when saving a BOM revision); kept in this browser. */
export const readUserName = () => { try { return localStorage.getItem(USER_KEY) ?? ""; } catch { return ""; } };
const writeUserName = (v: string) => { try { localStorage.setItem(USER_KEY, v); } catch { /* not remembered */ } };

/** Local date and time, 2026-11-04 15:23. */
const when = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const two = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`;
};

/** The change log: who changed what, when; filter, search, export to Excel. */
export function ChangesDialog(props: { project: Project; onClose: () => void; onClear: () => void; confirm: (o: { title: string; body: string; confirmLabel: string; danger?: boolean }) => Promise<boolean> }) {
  const log = props.project.changeLog;
  const [screen, setScreen] = useState("");
  const [query, setQuery] = useState("");
  const [name, setName] = useState(readUserName);
  // Undo/redo lines and named actions (Replace …, Import …) are grouped under a short name for the filter.
  const group = (s: string) => (s.startsWith("Undo") ? "Undo" : s.startsWith("Redo") ? "Redo" : s.startsWith("Replace ") || s.startsWith("Code change") ? "Materials" : s.startsWith("Import ") ? "Operations" : s);
  const screens = useMemo(() => [...new Set(log.map((l) => group(l.screen)))].sort(), [log]);
  const q = query.trim().toLowerCase();
  const shown = log.filter((l) => (!screen || group(l.screen) === screen) && (!q || [l.screen, l.by ?? "", ...l.what].some((v) => v.toLowerCase().includes(q))));
  const exportExcel = async () => {
    const blob = await writeWorkbook([{
      name: "Changes", header: ["When", "By", "Where / what", "Change"], widths: [18, 16, 36, 100],
      rows: log.map((l) => [when(l.at), l.by ?? "", l.screen, l.what.join("\n")]),
    }]);
    downloadBlob(blob, `${props.project.meta.name} changes ${new Date().toISOString().slice(0, 10)}.xlsx`.replace(/[\\/:*?"<>|]/g, "-"));
  };
  return (
    <Dialog title="Changes" wide onClose={props.onClose} actions={<>
      <button className="btn ghost danger" disabled={!log.length} onClick={async () => {
        if (await props.confirm({ title: "Clear the change log?", body: "The log of this project is emptied (the project itself does not change).", confirmLabel: "Clear log", danger: true })) props.onClear();
      }}>Clear log</button>
      <span className="spacer" />
      <button className="btn" disabled={!log.length} onClick={exportExcel}>Export to Excel</button>
      <button className="btn primary" onClick={props.onClose}>Close</button>
    </>}>
      <p className="hint" style={{ marginTop: 0 }}>
        Changes on Materials, BOM, Operations and Mass Balance, unit operations added or renamed on the PFD, undo and redo. Saved with the project (newest 1000).
        ↶ Undo and ↷ Redo (top left) take back the last changes (not the drawing: it has its own undo).
      </p>
      <div className="toolbar" style={{ flexWrap: "wrap" }}>
        <label className="field-inline">Your name
          <input className="search" style={{ width: 160 }} value={name} placeholder="written with your changes" aria-label="Your name" onChange={(e) => { setName(e.target.value); writeUserName(e.target.value.trim()); }} />
        </label>
        <span className="spacer" />
        <input className="search" placeholder="Search" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search changes" />
        <select className="search" style={{ width: "auto" }} value={screen} onChange={(e) => setScreen(e.target.value)} aria-label="Where">
          <option value="">Everywhere</option>
          {screens.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
      {log.length === 0 ? <div className="notice">No changes logged yet.</div> : (
        <div className="table-wrap changes-wrap">
          <table className="grid changes-table">
            <thead><tr><th style={{ width: 150 }}>When</th><th style={{ width: 120 }}>By</th><th style={{ width: 220 }}>Where / what</th><th>Change</th></tr></thead>
            <tbody>
              {shown.map((l) => (
                <tr key={l.id}>
                  <td className="mono faint-num">{when(l.at)}</td>
                  <td>{l.by || <span className="faint">–</span>}</td>
                  <td>{l.screen}</td>
                  <td>{l.what.map((w, i) => <div key={i}>{w}</div>)}</td>
                </tr>
              ))}
              {!shown.length && <tr><td colSpan={4} className="faint">Nothing matches.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </Dialog>
  );
}
