import { useState } from "react";
import { newScenario, scenarioProblems } from "../mb/scenarios";
import type { Scenario } from "../model/types";
import { Dialog } from "../ui/Dialog";

/**
 * The scenarios (value columns of PCS_LINK): add one (e.g. a 500 L clinical batch), rename it, point it to
 * another column, or remove it. The BOM, the PFD labels and the exports show every scenario in this order.
 */
export function ScenariosDialog(props: { scenarios: Scenario[]; applied: string[]; onCancel: () => void; onSave: (list: Scenario[]) => void }) {
  const [list, setList] = useState<Scenario[]>(() => props.scenarios.map((s) => ({ ...s })));
  const problems = scenarioProblems(list);
  const set = (i: number, patch: Partial<Scenario>) => setList(list.map((s, j) => (j === i ? { ...s, ...patch, ...(patch.name !== undefined && s.column === s.name ? { column: patch.name } : {}) } : s)));
  const removed = props.scenarios.filter((s) => !list.some((x) => x.id === s.id));
  const added = list.filter((s) => !props.scenarios.some((x) => x.id === s.id));
  const moved = list.filter((s) => props.scenarios.some((x) => x.id === s.id && x.column !== s.column.trim()));
  return (
    <Dialog title="Scenarios" onClose={props.onCancel} actions={<>
      <button className="btn" onClick={props.onCancel}>Cancel</button>
      <button className="btn primary" disabled={problems.length > 0} onClick={() => props.onSave(list)}>Save</button>
    </>}>
      <p className="hint" style={{ marginTop: 0 }}>
        Each scenario is a value column in the PCS_LINK sheet. The BOM, the PFD labels and the exports show all of them, in this order.
      </p>
      <table className="grid scen-table">
        <thead><tr><th>Name</th><th>PCS_LINK column</th><th aria-label="Order and remove" /></tr></thead>
        <tbody>
          {list.map((s, i) => (
            <tr key={s.id}>
              <td><input className="cell-input" value={s.name} aria-label={`Name of scenario ${i + 1}`} onChange={(e) => set(i, { name: e.target.value })} /></td>
              <td><input className="cell-input mono" value={s.column} aria-label={`Column of scenario ${i + 1}`} onChange={(e) => set(i, { column: e.target.value })} /></td>
              <td className="nowrap">
                <button className="btn ghost small" aria-label={`Move scenario ${i + 1} up`} disabled={i === 0} onClick={() => { const a = [...list]; [a[i - 1], a[i]] = [a[i], a[i - 1]]; setList(a); }}>↑</button>
                <button className="btn ghost small danger" aria-label={`Remove scenario ${i + 1}`} disabled={list.length <= 1} onClick={() => setList(list.filter((_, j) => j !== i))}>×</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="panel-actions" style={{ marginTop: 8 }}>
        <button className="btn small" onClick={() => setList([...list, newScenario(`Scenario ${list.length + 1}`)])}>+ Scenario</button>
      </div>
      {problems.length > 0 && <div className="notice warn"><ul className="plain">{problems.map((p, i) => <li key={i}>{p}</li>)}</ul></div>}
      {(added.length > 0 || moved.length > 0) && (
        <p className="hint">Add the column{added.length + moved.length > 1 ? "s" : ""} {[...added, ...moved].map((s) => `“${s.column.trim() || "?"}”`).join(", ")} to PCS_LINK, then apply the workbook again: its values are read on the next apply.</p>
      )}
      {removed.length > 0 && (
        <p className="hint warn-text">Removed: {removed.map((s) => s.name).join(", ")}. {removed.some((s) => props.applied.includes(s.id)) ? "Its applied values and manual BOM quantities stay in the project but are no longer shown." : ""} ↶ takes it back.</p>
      )}
    </Dialog>
  );
}
