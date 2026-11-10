import { useState } from "react";
import type { BomResult } from "../bom/model";
import { countText, nextLabel, snapshotBom, type Change, type Comparison, type MaterialChange } from "../bom/revisions";
import { fmtQty } from "../mb/model";
import type { BomRevision, Material, Project, ScenarioValues } from "../model/types";
import { downloadBlob } from "../storage/files";
import { Dialog } from "../ui/Dialog";
import { writeWorkbook } from "../xlsx/workbook";

const USER_KEY = "pcs.userName";
const readUser = () => { try { return localStorage.getItem(USER_KEY) ?? ""; } catch { return ""; } };
const writeUser = (v: string) => { try { localStorage.setItem(USER_KEY, v); } catch { /* not remembered */ } };
export const when = (iso: string) => (iso ? new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "");
const NOW = "Now";

/** The BOM as it is now, as a comparison side (`materials`: the project's, for "replaced by"). */
export const nowState = (bom: BomResult, materials?: readonly Material[]) => ({ label: NOW, ...snapshotBom(bom, materials) });

const CHANGE_LABEL: Record<Change["kind"], string> = { added: "Added", removed: "Removed", replaced: "Replaced", changed: "Changed", same: "Same" };
const MAT_LABEL: Record<MaterialChange["kind"], string> = { replaced: "Replaced", edited: "Edited", added: "Added", removed: "Removed" };
/** "CON-0010 → CON-0011" for a replaced material, else its code. */
export const changeCode = (c: { code: string; was?: { code: string } }) => (c.was ? `${c.was.code} → ${c.code}` : c.code);
/** What a line mark says: "New since Rev A", "Replaces CON-0010 since Rev A", "▲ +90 / +660 since Rev A" … */
export function changeMark(c: Change, base: string | null, scen: { id: string }[]): string {
  if (c.kind === "added") return `New since ${base}`;
  if (c.kind === "removed") return `Not counted since ${base}`;
  if (c.kind === "replaced") {
    const moved = c.was && c.was.unit === c.unit && scen.some((s) => (c.delta[s.id] ?? 0) !== 0);
    return `Replaces ${c.was?.code} since ${base}${moved ? ` (${deltaText(c, scen)})` : ""}`;
  }
  return `${deltaText(c, scen)} since ${base}`;
}
const sign = (v: number | null) => (v == null ? "" : v > 0 ? `+${fmtQty(v)}` : v < 0 ? `−${fmtQty(-v)}` : "±0");

/** "900 → 990 (+90)" for one scenario. */
export function beforeAfter(c: Change, s: string): string {
  const b = c.before?.[s] ?? null, a = c.after?.[s] ?? null;
  if (c.kind === "added") return fmtQty(a) || "–";
  if (c.kind === "removed") return fmtQty(b) || "–";
  if (c.kind === "replaced" && c.was && c.was.unit !== c.unit) return `${fmtQty(b) || "–"} ${c.was.unit} → ${fmtQty(a) || "–"} ${c.unit}`;
  if ((b ?? null) === (a ?? null)) return fmtQty(a) || "–";
  return `${fmtQty(b) || "–"} → ${fmtQty(a) || "–"} (${sign(c.delta[s])})`;
}

export function SaveRevisionDialog(props: { project: Project; bom: BomResult; cmp: Comparison | null; onSave: (meta: { label: string; note: string; by: string }) => void; onClose: () => void }) {
  const revs = props.project.bom.revisions ?? [];
  const [label, setLabel] = useState(nextLabel(revs));
  const [note, setNote] = useState("");
  const [by, setBy] = useState(readUser);
  const taken = revs.some((r) => r.label === label.trim());
  const lines = props.bom.uos.reduce((n, u) => n + u.rows.filter((r) => !r.line.excluded).length, 0);
  return (
    <Dialog title="Save a BOM revision" onClose={props.onClose} actions={<>
      <button className="btn" onClick={props.onClose}>Cancel</button>
      <button className="btn primary" disabled={!label.trim() || taken} onClick={() => { writeUser(by); props.onSave({ label: label.trim(), note, by }); }}>Save revision</button>
    </>}>
      <p className="hint" style={{ marginTop: 0 }}>
        Keeps what the BOM says now ({lines} counted lines and the totals) in the project file, so you can see later what changed: the BOM marks the lines changed since the newest revision, and any two revisions can be compared.
        {props.cmp ? ` Since ${props.cmp.from}: ${countText(props.cmp.count, ", ")}.` : ""}
      </p>
      <label className="field-block" style={{ marginTop: 0 }}>Label
        <input data-autofocus className="cell-input" value={label} onChange={(e) => setLabel(e.target.value)} aria-label="Revision label" />
        {taken && <span className="bom-issue">{label.trim()} is already used.</span>}
      </label>
      <label className="field-block">What changed, or why (optional)
        <input className="cell-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Sent to purchasing; Receiving titer 3 → 4 g/L" aria-label="Revision note" />
      </label>
      <label className="field-block">Your name (optional)
        <input className="cell-input" value={by} onChange={(e) => setBy(e.target.value)} aria-label="Your name" />
      </label>
    </Dialog>
  );
}

export function RevisionsDialog(props: {
  project: Project; bom: BomResult; onClose: () => void;
  onCompare: (fromId: string, toId: string) => void; onDelete: (r: BomRevision) => void;
}) {
  const revs = props.project.bom.revisions ?? [];
  const [from, setFrom] = useState(revs[Math.max(0, revs.length - 2)]?.id ?? "");
  const [to, setTo] = useState(NOW);
  return (
    <Dialog title="BOM revisions" wide onClose={props.onClose} actions={<button className="btn primary" onClick={props.onClose}>Close</button>}>
      {revs.length === 0 ? <p className="hint" style={{ margin: 0 }}>No revisions yet. Use “Save revision…” when the BOM is ready to hand over (e.g. to purchasing); later changes are then marked against it.</p> : (
        <>
          <div className="table-wrap panel">
            <table className="grid">
              <thead><tr><th>Revision</th><th>Saved</th><th>By</th><th>MB workbook</th><th className="num">Lines</th><th>Note</th><th aria-label="Actions" /></tr></thead>
              <tbody>
                {[...revs].reverse().map((r) => (
                  <tr key={r.id}>
                    <td><b>{r.label}</b></td>
                    <td className="nowrap">{when(r.createdAt)}</td>
                    <td>{r.createdBy ?? ""}</td>
                    <td className="mono" style={{ fontSize: "var(--fs-xs)" }}>{r.mbFile ?? ""}</td>
                    <td className="num">{r.lines.length}</td>
                    <td>{r.note ?? ""}</td>
                    <td className="nowrap">
                      <button className="btn small" onClick={() => props.onCompare(r.id, NOW)}>Compare with now</button>{" "}
                      <button className="btn ghost small danger" onClick={() => props.onDelete(r)}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="toolbar" style={{ marginTop: 10 }}>
            <span>Compare</span>
            <select className="search" style={{ width: "auto" }} value={from} onChange={(e) => setFrom(e.target.value)} aria-label="Compare from">
              {revs.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
            </select>
            <span>with</span>
            <select className="search" style={{ width: "auto" }} value={to} onChange={(e) => setTo(e.target.value)} aria-label="Compare with">
              <option value={NOW}>Now (the BOM as it is)</option>
              {revs.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
            </select>
            <button className="btn primary small" disabled={!from || from === to} onClick={() => props.onCompare(from, to)}>Compare</button>
          </div>
        </>
      )}
    </Dialog>
  );
}

/** A replaced row's note: what it was, then the rest. */
const noteOf = (c: Change) => [...(c.was ? [`was ${c.was.code} “${c.was.name}”`] : []), ...c.notes].join("; ");
/** Said under the materials' changes when one side was saved before N5.6. */
export const partialNote = (cmp: Comparison) => `${cmp.from} was saved before v5.6: spec, supplier, part no., pack size and status are compared only between revisions saved since (and the BOM now).`;

/**
 * Sheets for a comparison: the lines and the totals that changed, before → after per scenario, and what
 * changed on the materials themselves (replaced, details before → after).
 */
export function comparisonSheets(cmp: Comparison, all = false) {
  const scen = cmp.scenarios;
  const rows = (list: Change[], withUo: boolean) => list.filter((c) => all || c.kind !== "same").map((c) => [
    CHANGE_LABEL[c.kind], ...(withUo ? [c.uo ?? ""] : []), changeCode(c), c.name, c.unit,
    ...scen.flatMap((s) => [c.before?.[s.id] ?? null, c.after?.[s.id] ?? null, c.delta[s.id] ?? null]), noteOf(c),
  ]);
  const head = (withUo: boolean) => ["Change", ...(withUo ? ["UO"] : []), "Code", "Material", "Unit", ...scen.flatMap((s) => [`${s.name} ${cmp.from}`, `${s.name} ${cmp.to}`, `${s.name} change`]), "Note"];
  const widths = (withUo: boolean) => [10, ...(withUo ? [8] : []), 12, 34, 7, ...scen.flatMap(() => [12, 12, 11]), 30];
  const matRows: (string | null)[][] = cmp.materials.map((m) => [MAT_LABEL[m.kind], changeCode(m), m.name, m.what, m.before, m.after, m.uos]);
  if (cmp.materialsPartial) matRows.push([null, null, null, null, null, null, null], ["Note", null, partialNote(cmp), null, null, null, null]);
  return [
    { name: "Changes (lines)", header: head(true), rows: rows(cmp.lines, true), widths: widths(true) },
    { name: "Changes (totals)", header: head(false), rows: rows(cmp.totals, false), widths: widths(false) },
    { name: "Changes (materials)", header: ["Change", "Code", "Material", "What changed", cmp.from, cmp.to, "Unit operations"], rows: matRows, widths: [10, 22, 36, 14, 40, 40, 22] },
  ];
}

export function CompareDialog(props: { project: Project; cmp: Comparison; onClose: () => void }) {
  const { cmp } = props;
  const [view, setView] = useState<"lines" | "totals" | "materials">("totals");
  const [all, setAll] = useState(false);
  const list = (view === "lines" ? cmp.lines : view === "totals" ? cmp.totals : []).filter((c) => all || c.kind !== "same");
  const totalsChanged = cmp.totals.filter((c) => c.kind !== "same").length;
  const matChanged = new Set(cmp.materials.map((m) => m.code)).size;
  const exportIt = async () => {
    const blob = await writeWorkbook(comparisonSheets(cmp, all));
    downloadBlob(blob, `${props.project.meta.name} BOM ${cmp.from} vs ${cmp.to}.xlsx`.replace(/[\\/:*?"<>|]/g, "-"));
  };
  return (
    <Dialog title={`BOM changes · ${cmp.from} → ${cmp.to}`} wide onClose={props.onClose} actions={<>
      <button className="btn" onClick={exportIt}>Export to Excel</button>
      <span className="spacer" />
      <button className="btn primary" onClick={props.onClose}>Close</button>
    </>}>
      <div className="toolbar">
        <span className="chip ok">{cmp.count.added} added</span>
        <span className="chip err">{cmp.count.removed} removed</span>
        {cmp.count.replaced > 0 && <span className="chip chg replaced">{cmp.count.replaced} replaced</span>}
        <span className="chip warn">{cmp.count.changed} changed</span>
        <span className="hint">lines (unit operation × material); {totalsChanged} material total(s) changed; {matChanged} material(s) with changes</span>
      </div>
      <div className="toolbar">
        <div className="seg" role="group" aria-label="View">
          <button className={view === "totals" ? "on" : ""} aria-pressed={view === "totals"} onClick={() => setView("totals")}>Totals (what to buy)</button>
          <button className={view === "lines" ? "on" : ""} aria-pressed={view === "lines"} onClick={() => setView("lines")}>Lines per unit operation</button>
          <button className={view === "materials" ? "on" : ""} aria-pressed={view === "materials"} onClick={() => setView("materials")}>Materials ({matChanged})</button>
        </div>
        {view !== "materials" && <label className="check"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> Show unchanged too</label>}
      </div>
      {view === "materials" ? <MaterialChanges cmp={cmp} /> : list.length === 0 ? <div className="notice ok">No changes{view === "totals" ? " in the totals" : " in the lines"}.</div> : (
        <div className="table-wrap panel" style={{ maxHeight: "52vh" }}>
          <table className="grid compare-table">
            <thead><tr>
              <th>Change</th>{view === "lines" && <th>UO</th>}<th>Code</th><th>Material</th><th>Unit</th>
              {cmp.scenarios.map((s) => <th key={s.id} className="num">{s.name}</th>)}<th>Note</th>
            </tr></thead>
            <tbody>
              {list.map((c) => (
                <tr key={c.key} className={`chg-${c.kind}`}>
                  <td><span className={`chip chg ${c.kind}`}>{CHANGE_LABEL[c.kind]}</span></td>
                  {view === "lines" && <td className="mono">{c.uo}</td>}
                  <td className="mono nowrap">{changeCode(c)}</td>
                  <td style={{ minWidth: 240 }}>{c.name}{c.category ? <span className="muted"> · {c.category}</span> : null}{c.was && <div className="muted" style={{ fontSize: "var(--fs-xs)" }}>was {c.was.name}</div>}</td>
                  <td className="mono">{c.unit}</td>
                  {cmp.scenarios.map((s) => <td key={s.id} className="num nowrap">{beforeAfter(c, s.id)}</td>)}
                  <td style={{ fontSize: "var(--fs-xs)" }}>{c.notes.join("; ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="hint" style={{ margin: 0 }}>
        A material replaced with Materials › Replace… (old one marked obsolete) shows as <b>Replaced</b>; a code change, as changed (code A → B).
        Quantities include overage; totals include recipe components.
      </p>
    </Dialog>
  );
}

/** What changed on the materials: replaced, each detail before → after, added to or gone from the BOM. */
function MaterialChanges(props: { cmp: Comparison }) {
  const { cmp } = props;
  return (
    <>
      {cmp.materials.length === 0 ? <div className="notice ok">No material changed.</div> : (
        <div className="table-wrap panel" style={{ maxHeight: "52vh" }}>
          <table className="grid compare-table">
            <thead><tr><th>Change</th><th>Material</th><th>What changed</th><th>{cmp.from}</th><th>{cmp.to}</th><th>Unit operations</th></tr></thead>
            <tbody>
              {cmp.materials.map((m, i) => (
                <tr key={i} className={`chg-${m.kind}`}>
                  <td><span className={`chip chg ${m.kind === "edited" ? "changed" : m.kind}`}>{MAT_LABEL[m.kind]}</span></td>
                  <td style={{ minWidth: 220 }}><div className="mono nowrap">{changeCode(m)}</div><div className="muted" style={{ fontSize: "var(--fs-xs)" }}>{m.name}</div></td>
                  <td className="nowrap">{m.what}</td>
                  <td>{m.before || <span className="faint">–</span>}</td>
                  <td>{m.after || <span className="faint">–</span>}</td>
                  <td className="mono">{m.uos}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {cmp.materialsPartial && <p className="hint" style={{ margin: 0 }}>{partialNote(cmp)}</p>}
    </>
  );
}

/** "▲ +90 / +660" style badge text for a changed line. */
export function deltaText(c: Change, scen: { id: string }[]): string {
  const ds = scen.map((s) => c.delta[s.id]);
  const up = ds.some((d) => (d ?? 0) > 0), down = ds.some((d) => (d ?? 0) < 0);
  return `${up && !down ? "▲" : down && !up ? "▼" : "◆"} ${ds.map((d) => sign(d)).join(" / ")}`;
}
export type { ScenarioValues };
