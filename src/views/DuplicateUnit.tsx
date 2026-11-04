import { useMemo, useState } from "react";
import { isUoCode } from "../model/ids";
import type { Project, UnitOperation } from "../model/types";
import { pcsOf, type BoardElement } from "../pfd/sync";
import { copyTag, suggestRetag } from "../pfd/duplicate";
import { tagKey } from "../ops/model";
import { Dialog } from "../ui/Dialog";

export interface DuplicateOptions {
  code: string;
  name: string;
  steps: boolean;
  bom: boolean;
  /** New tags for the copy's equipment (from → to); otherwise the copy uses the same equipment. */
  tags: boolean;
  from: string;
  to: string;
}

/** The equipment a copy of the unit operation would get its own of: drawn in its drawing, or set to it. */
export function ownEquipment(p: Project, uoId: string) {
  const drawn = new Set(((p.pfd.sheets[uoId]?.elements ?? []) as BoardElement[]).filter((e) => !e.isDeleted).map((e) => pcsOf(e).equipmentId).filter(Boolean));
  return p.equipment.filter((e) => drawn.has(e.id) || e.uoId === uoId);
}

/** A free code for the copy: CEX → CEX2, CEX3 … (at most 10 characters). */
function freeCode(code: string, taken: Set<string>) {
  for (let n = 2; n < 100; n++) {
    const c = `${code.slice(0, 10 - String(n).length)}${n}`;
    if (!taken.has(c)) return c;
  }
  return "";
}

/** Duplicate a unit operation: its drawing, and if wanted its steps and BOM lines, its equipment with new tags. */
export function DuplicateUnitDialog(props: { project: Project; uo: UnitOperation; onCancel: () => void; onDuplicate: (o: DuplicateOptions) => void }) {
  const { project, uo } = props;
  const taken = useMemo(() => new Set(project.uos.map((u) => u.code)), [project.uos]);
  const own = useMemo(() => ownEquipment(project, uo.id), [project, uo.id]);
  const steps = project.operations[uo.id] ?? [];
  const lines = project.bom.lines[uo.id] ?? [];
  const sug = useMemo(() => suggestRetag(own.map((e) => e.tag)), [own]);
  const [o, setO] = useState<DuplicateOptions>({ code: freeCode(uo.code, taken), name: `${uo.name} (copy)`, steps: steps.length > 0, bom: lines.length > 0, tags: own.length > 0, from: sug.from, to: sug.to });
  const code = o.code.trim().toUpperCase();
  const codeError = !isUoCode(code) ? "1–10 capital letters or digits, with a letter" : taken.has(code) ? "Another unit operation uses this code" : "";
  const preview = useMemo(() => {
    const t = new Set(project.equipment.map((e) => tagKey(e.tag)));
    return own.map((e) => { const n = copyTag(e.tag, o.from, o.to, t); t.add(tagKey(n)); return `${e.tag} → ${n}`; });
  }, [own, o.from, o.to, project.equipment]);
  const set = (patch: Partial<DuplicateOptions>) => setO({ ...o, ...patch });

  return (
    <Dialog title={`Duplicate ${uo.code} · ${uo.name}`} onClose={props.onCancel} actions={<>
      <button className="btn" onClick={props.onCancel}>Cancel</button>
      <button className="btn primary" disabled={!!codeError || !o.name.trim()} onClick={() => props.onDuplicate({ ...o, code, name: o.name.trim() })}>Duplicate</button>
    </>}>
      <p className="hint" style={{ marginTop: 0 }}>
        A new unit operation with a copy of the drawing (its arrows get new Stream IDs, e.g. ST-{code || "NEW"}-001). Transfers on the process map are not copied: draw them for the copy.
      </p>
      <div className="dup-grid">
        <label className="field-block">Code
          <input className={`cell-input mono${codeError ? " bad" : ""}`} value={o.code} aria-label="Code of the copy" title={codeError || undefined} onChange={(e) => set({ code: e.target.value })} />
          {codeError && <span className="hint warn-text">{codeError}</span>}
        </label>
        <label className="field-block">Name
          <input className="cell-input" value={o.name} aria-label="Name of the copy" onChange={(e) => set({ name: e.target.value })} />
        </label>
      </div>
      <label className="check"><input type="checkbox" checked={o.steps} disabled={!steps.length} onChange={(e) => set({ steps: e.target.checked })} /> <span>Steps on Operations ({steps.length}), with their streams moved to the copy's</span></label>
      <label className="check"><input type="checkbox" checked={o.bom} disabled={!lines.length} onChange={(e) => set({ bom: e.target.checked })} /> <span>BOM lines you set or added ({lines.length})</span></label>
      {own.length > 0 && (
        <fieldset className="export-box">
          <legend>Equipment ({own.length} tag{own.length > 1 ? "s" : ""})</legend>
          <label className="check"><input type="radio" name="dup-tags" checked={o.tags} onChange={() => set({ tags: true })} /> <span><b>New tags</b> for the copy: change
            <input className="cell-input mono dup-tag" value={o.from} aria-label="Change in the tags" onChange={(e) => set({ from: e.target.value })} /> to
            <input className="cell-input mono dup-tag" value={o.to} aria-label="Change it to" onChange={(e) => set({ to: e.target.value })} /></span></label>
          {o.tags && <p className="hint" style={{ margin: "2px 0 6px 26px" }}>{preview.slice(0, 6).join(", ")}{preview.length > 6 ? ` … (${preview.length})` : ""}</p>}
          <label className="check"><input type="radio" name="dup-tags" checked={!o.tags} onChange={() => set({ tags: false })} /> <span><b>The same equipment</b> (a second cycle on the same skid): the steps use the same tags; the copied shapes have no tag</span></label>
        </fieldset>
      )}
    </Dialog>
  );
}
