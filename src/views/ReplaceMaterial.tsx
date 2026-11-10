import { useMemo, useState } from "react";
import { changeCodesInMb } from "../mb/codeChanges";
import { planReplace, replaceMaterial, type AfterReplace } from "../model/replace";
import type { Material, Project } from "../model/types";
import { Dialog } from "../ui/Dialog";

export interface ReplaceChoice { toId: string; factor: number; after: AfterReplace; mb: boolean }

const parseNum = (s: string) => (s.trim() === "" ? NaN : Number(s.replace(/,/g, "").trim()));

/**
 * Replace a material with another everywhere: shows what will change before anything does (BOM lines,
 * recipes, PFD links, backups, the MB workbook), then what to do with the old one.
 */
export function ReplaceDialog(props: { project: Project; materialId: string; onClose: () => void; onReplace: (c: ReplaceChoice) => void; busy?: boolean }) {
  const { project } = props;
  const from = project.materials.find((m) => m.id === props.materialId)!;
  // Its backups first, then the same unit, then the rest; never itself or obsolete ones.
  const options = useMemo(() => {
    const backupIds = new Set((from.backups ?? []).map((b) => b.materialId));
    const rank = (m: Material) => (backupIds.has(m.id) ? 0 : m.unit === from.unit ? 1 : 2);
    return project.materials.filter((m) => m.id !== from.id && m.status !== "obsolete").sort((a, b) => rank(a) - rank(b) || a.code.localeCompare(b.code));
  }, [project.materials, from]);
  const [toId, setToId] = useState(() => (from.replacedBy && options.some((o) => o.id === from.replacedBy) ? from.replacedBy : options.find((o) => (from.backups ?? []).some((b) => b.materialId === o.id))?.id ?? ""));
  const [factorText, setFactorText] = useState("1");
  const [after, setAfter] = useState<AfterReplace>("obsolete");
  const plan = toId ? planReplace(project, from.id, toId) : null;
  const to = plan?.to;
  const factor = plan?.sameUnit ? 1 : parseNum(factorText);
  const [mb, setMb] = useState(true);
  const mbPossible = !!plan && plan.sameUnit && (plan.mbRows > 0 || !!project.mb.workbook);
  const errors: string[] = [];
  if (plan?.blocked) errors.push(plan.blocked);
  if (plan && !plan.sameUnit && !(factor > 0)) errors.push(`Give how many ${to!.unit} of ${to!.code} replace 1 ${from.unit} of ${from.code}.`);

  const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  return (
    <Dialog title={`Replace ${from.code} ${from.name}`} wide onClose={props.onClose} actions={<>
      <button className="btn" onClick={props.onClose} disabled={props.busy}>Cancel</button>
      <button className="btn primary" disabled={!plan || !!errors.length || props.busy} onClick={() => props.onReplace({ toId, factor: plan!.sameUnit ? 1 : factor, after, mb: mbPossible && mb })}>
        {props.busy ? "Replacing…" : to ? `Replace with ${to.code}` : "Replace"}
      </button>
    </>}>
      <p className="hint" style={{ marginTop: 0 }}>
        Everything that uses {from.code} uses the material you choose instead: lines you changed on the BOM, recipes, PFD links, backup lists and,
        when the units match, the PCS_LINK rows of the MB workbook. Lines that come from the MB or the PFD follow by themselves.
      </p>
      <label className="field-block" style={{ marginTop: 0 }}>Replace with
        <select data-autofocus className="cell-input" value={toId} onChange={(e) => setToId(e.target.value)} aria-label="Replace with">
          <option value="">Choose a material…</option>
          {options.map((m) => <option key={m.id} value={m.id}>{m.code} · {m.name} ({m.unit}){(from.backups ?? []).some((b) => b.materialId === m.id) ? " · backup" : ""}{m.status === "review" ? " · under review" : ""}</option>)}
        </select>
      </label>
      {plan && !plan.sameUnit && (
        <label className="field-inline" style={{ marginTop: 8 }}>
          1 {from.unit} of {from.code} =
          <input className="cell-input num-input" style={{ width: 110 }} value={factorText} onChange={(e) => setFactorText(e.target.value)} aria-label="Factor" inputMode="decimal" />
          {to!.unit} of {to!.code}
        </label>
      )}
      {plan && (
        <div className="replace-plan">
          <h3>What changes</h3>
          <ul className="plain">
            <li>BOM: {plan.bomLines.length ? `${count(plan.bomLines.length, "line")} you set or added (${plan.bomLines.map((l) => l.uo).join(", ")})${plan.bomLines.some((l) => l.conflict) ? `; where ${to!.code} already has a line, that line is kept` : ""}` : "no line you set or added"}; lines from the MB and the PFD follow the changes below</li>
            <li>Recipes: {plan.recipes.filter((r) => !r.self).length ? plan.recipes.filter((r) => !r.self).map((r) => r.code + (r.merge ? ` (added to its ${to!.code})` : "")).join(", ") : "none"}{plan.recipes.some((r) => r.self) ? ` · the recipe of ${to!.code} itself is left alone` : ""}</li>
            <li>PFD links: {count(plan.pfdLinks, "shape or arrow", "shapes or arrows")}</li>
            <li>Backups: {plan.backupFor.length ? `backup for ${plan.backupFor.join(", ")}` : "not a backup of anything"}{plan.ownBackups ? `; its ${count(plan.ownBackups, "backup")} move to ${to!.code}` : ""}</li>
            <li>MB: {plan.mbRows ? `${count(plan.mbRows, "applied row")} with ${from.code}` : `no applied row with ${from.code}`}{!plan.sameUnit ? ` · different units: change the PCS_LINK rows in the workbook yourself` : ""}</li>
          </ul>
          {mbPossible && (
            <label className="check" style={{ marginTop: 6 }}>
              <input type="checkbox" checked={mb} onChange={(e) => setMb(e.target.checked)} />
              <span>Also change {from.code} to {to!.code} in the PCS_LINK sheet of {project.mb.workbook?.name ?? "the MB workbook"} (only those cells; the applied values follow)</span>
            </label>
          )}
          <fieldset className="export-box" style={{ marginTop: 10 }}>
            <legend>Then {from.code}</legend>
            <label className="check"><input type="radio" name="after" checked={after === "obsolete"} onChange={() => setAfter("obsolete")} /> <span><b>Mark obsolete</b>, replaced by {to?.code ?? "…"} (recommended: it stays in the list for reference, and BOM revisions show the change as replaced)</span></label>
            <label className="check"><input type="radio" name="after" checked={after === "delete"} onChange={() => setAfter("delete")} /> <span>Delete it</span></label>
            <label className="check"><input type="radio" name="after" checked={after === "keep"} onChange={() => setAfter("keep")} /> <span>Keep it as it is</span></label>
          </fieldset>
        </div>
      )}
      {errors.length > 0 && <div className="notice warn"><ul className="plain">{errors.map((e, i) => <li key={i}>{e}</li>)}</ul></div>}
    </Dialog>
  );
}

/** Change the project as a whole (PFD included) and maybe asynchronously; App provides it. */
export type Transform = (fn: (p: Project) => Project | Promise<Project>, opts?: { pfd?: boolean; label?: string; note?: string }) => Promise<void>;

const readUser = () => { try { return localStorage.getItem("pcs.userName") ?? ""; } catch { return ""; } };

/** Run a replacement chosen in the dialog; returns a sentence for the toast. */
export async function runReplace(transform: Transform, project: Project, fromId: string, c: ReplaceChoice): Promise<string> {
  const from = project.materials.find((m) => m.id === fromId)!;
  const to = project.materials.find((m) => m.id === c.toId)!;
  let mbRows = 0;
  let skipped: { row: number }[] = [];
  await transform(async (p) => {
    let q = replaceMaterial(p, from.id, to.id, { factor: c.factor, after: c.after });
    if (c.mb) {
      const r = await changeCodesInMb(q, new Map([[from.code, to.code]]), { why: `Replaced ${from.code} with ${to.code}`, by: readUser() });
      q = r.project; mbRows = r.workbookRows; skipped = r.skipped;
    }
    return q;
  }, { pfd: true, label: `Replace ${from.code} with ${to.code}`, note: "the PFD links stay on the new material" });
  const then = c.after === "obsolete" ? `${from.code} is marked obsolete` : c.after === "delete" ? `${from.code} is deleted` : `${from.code} is kept`;
  return `Replaced ${from.code} with ${to.code}${c.mb ? `; ${mbRows} PCS_LINK row(s) changed in the MB workbook` : ""}${skipped.length ? `; rows ${skipped.map((s) => s.row).join(", ")} have a formula: change them in the workbook` : ""}. ${then}.`;
}
