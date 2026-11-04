import { useMemo } from "react";
import { computeBom, type BomTotal } from "../bom/model";
import { fmtQty } from "../mb/model";
import { whereUsed } from "../model/whereUsed";
import type { Project, ScenarioValues } from "../model/types";
import { Dialog } from "../ui/Dialog";

/** Places the app can take the user to. */
export type GoPlace =
  | { kind: "bom"; uo: string; code: string }
  | { kind: "stream"; id: string }
  | { kind: "pfd"; scope: string; elementId: string }
  | { kind: "material"; code: string; open?: "recipe" | "backups" }
  | { kind: "step"; uoId: string; index: number };

/**
 * Everywhere a material is used, with a button to each place: BOM lines and the recipes that bring it
 * into the BOM, applied MB rows, PFD links, recipes, backup lists. "If this material changes, what
 * changes with it?"
 */
export function WhereUsedDialog(props: { project: Project; materialId: string; onClose: () => void; go: (place: GoPlace) => void; onReplace?: (materialId: string) => void }) {
  const { project } = props;
  const bom = useMemo(() => computeBom(project), [project]);
  const w = useMemo(() => whereUsed(project, props.materialId, bom), [project, props.materialId, bom]);
  if (!w) return null;
  const m = w.material;
  const scen = bom.scenarios;
  const vals = (v: ScenarioValues, unit = m.unit) => `${scen.map((s) => fmtQty(v[s.id]) || "–").join(" / ")} ${unit}`;
  const go = (p: GoPlace) => { props.onClose(); props.go(p); };

  return (
    <Dialog title={`Where used · ${m.code} ${m.name}`} wide onClose={props.onClose} actions={<>
      {props.onReplace && <button className="btn" onClick={() => props.onReplace!(m.id)} title={`Use another material instead of ${m.code} in all these places`}>Replace {m.code}…</button>}
      <span className="spacer" />
      <button className="btn primary" onClick={props.onClose}>Close</button>
    </>}>
      {(m.status || m.replacedBy) && (
        <div className={`notice ${m.status === "obsolete" ? "warn" : ""}`}>
          {m.status === "obsolete" ? "Obsolete" : m.status === "review" ? "Under review" : "In use"}
          {m.replacedBy ? ` · replaced by ${project.materials.find((x) => x.id === m.replacedBy)?.code ?? "?"}` : ""}
          {m.status === "obsolete" && w.count ? ": the places below still use it." : ""}
        </div>
      )}
      <MaterialFacts project={project} materialId={m.id} />
      <QuantityTable w={w} scen={scen} total={bom.totals.find((t) => t.material.id === m.id) ?? bom.prepared.find((t) => t.material.id === m.id)} />
      <p className="hint" style={{ marginTop: 0 }}>
        {w.count ? `${w.count} place(s). If ${m.code} changes (code, unit, replaced by another material), these are the places that change with it.` : `${m.code} is not used anywhere yet.`}
        {" "}Quantities: {scen.map((s) => s.name).join(" / ")}.
      </p>
      <div className="wu-grid">
        <WuSection title="BOM lines" empty="No BOM line of its own." items={w.bomLines.map((l) => ({
          key: `${l.uo}`, main: <><span className="mono">{l.uo}</span> {l.uoName}</>, sub: `${l.excluded ? "Not counted" : `Source ${l.source}`} · ${vals(l.qty)}`,
          action: { label: "Open in BOM", onClick: () => go({ kind: "bom", uo: l.uo, code: m.code }) },
        }))} />
        <WuSection title="In the BOM through a recipe" empty="Not part of a prepared material on the BOM." items={w.bomParts.map((x, i) => ({
          key: `${x.uo}-${x.parent}-${i}`, main: <><span className="mono">{x.uo}</span> · in <span className="mono">{x.parent}</span>{x.via !== x.parent ? <> (via <span className="mono">{x.via}</span>)</> : null}</>, sub: vals(x.qty),
          action: { label: "Open in BOM", onClick: () => go({ kind: "bom", uo: x.uo, code: x.parent }) },
        }))} />
        <WuSection title="Mass balance (PCS_LINK rows)" empty="No applied MB row with this code." items={w.mbRows.map((r, i) => ({
          key: `${r.streamId}-${i}`, main: <><span className="mono">{r.streamId}</span>{r.uo ? ` (${r.uo})` : ""}</>, sub: `${vals(r.values, r.unit)}${r.counted ? "" : " · not counted (see the link check)"}`,
          action: { label: "Show on PFD", onClick: () => go({ kind: "stream", id: r.streamId }) },
        }))} />
        <WuSection title="PFD links" empty="Not linked on any PFD shape or arrow." items={w.pfdLinks.map((l) => ({
          key: l.elementId, main: <><span className="mono">{l.uo}</span> · {l.what}</>, sub: `${fmtQty(l.qty)} ${m.unit}`,
          action: { label: "Show on PFD", onClick: () => go({ kind: "pfd", scope: l.scope, elementId: l.elementId }) },
        }))} />
        <WuSection title="In recipes" empty="Not a component of any recipe." items={w.inRecipes.map((r) => ({
          key: r.code, main: <><span className="mono">{r.code}</span> {r.name}</>, sub: `${fmtQty(r.qty)} ${m.unit} ${r.perBatch ? "per batch" : `per ${fmtQty(r.per)} ${r.unit}`}`,
          action: { label: "Open recipe", onClick: () => go({ kind: "material", code: r.code, open: "recipe" }) },
        }))} />
        <WuSection title="Backups" empty="No backup links." items={[
          ...w.backupFor.map((b) => ({ key: `for-${b.code}`, main: <>Backup for <span className="mono">{b.code}</span> {b.name}</>, sub: `ratio ${b.ratio}`, action: { label: "Open backups", onClick: () => go({ kind: "material", code: b.code, open: "backups" }) } })),
          ...w.backups.map((b) => ({ key: `has-${b.code}`, main: <>Its backup <span className="mono">{b.code}</span> {b.name}</>, sub: `ratio ${b.ratio}`, action: { label: "Open backups", onClick: () => go({ kind: "material", code: m.code, open: "backups" }) } })),
        ]} />
      </div>
    </Dialog>
  );
}

/** Unit, category, spec, purchasing: the material at a glance. */
function MaterialFacts(props: { project: Project; materialId: string }) {
  const m = props.project.materials.find((x) => x.id === props.materialId);
  if (!m) return null;
  const facts = [
    ["Unit", m.unit], ["Category", m.category], ["Spec", m.spec], ["Overage", m.overagePct ? `${m.overagePct} %` : undefined],
    ["Supplier", m.supplier], ["Part no.", m.partNo], ["Pack", m.packSize ? `${fmtQty(m.packSize)} ${m.unit}` : undefined],
    ["Recipe", m.recipe ? `${m.recipe.components.length} component(s) per ${fmtQty(m.recipe.per)} ${m.unit}` : undefined], ["Note", m.note],
  ].filter((f): f is [string, string] => !!f[1]);
  return <dl className="wu-facts">{facts.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>;
}

/** How much of it each unit operation takes, per scenario: its own lines and as part of prepared materials; the total and packs. */
function QuantityTable(props: { w: NonNullable<ReturnType<typeof whereUsed>>; scen: { id: string; name: string }[]; total?: BomTotal }) {
  const { w, scen, total } = props;
  const rows = [
    ...w.bomLines.filter((l) => !l.excluded).map((l) => ({ key: `l-${l.uo}`, uo: l.uo, how: `Line (${l.source})`, qty: l.qty })),
    ...w.bomParts.map((x, i) => ({ key: `p-${x.uo}-${i}`, uo: x.uo, how: `In ${x.parent}${x.via !== x.parent ? ` via ${x.via}` : ""}`, qty: x.qty })),
  ].sort((a, b) => a.uo.localeCompare(b.uo));
  if (!rows.length) return null;
  const unit = w.material.unit;
  return (
    <section className="wu-qty" aria-label="Quantities">
      <h3>Quantities ({unit})</h3>
      <table className="grid">
        <thead><tr><th>Unit operation</th><th>How</th>{scen.map((s) => <th key={s.id} className="num">{s.name}</th>)}</tr></thead>
        <tbody>
          {rows.map((r) => <tr key={r.key}><td className="mono">{r.uo}</td><td>{r.how}</td>{scen.map((s) => <td key={s.id} className="num">{fmtQty(r.qty[s.id]) || "–"}</td>)}</tr>)}
          {total && <tr className="wu-total"><td colSpan={2}>Total</td>{scen.map((s) => <td key={s.id} className="num">{fmtQty(total.qty[s.id]) || "–"}</td>)}</tr>}
          {total?.packs && <tr className="wu-total"><td colSpan={2}>To order ({fmtQty(w.material.packSize!)} {unit} packs)</td>{scen.map((s) => <td key={s.id} className="num">{fmtQty(total.packs![s.id]) || "–"}</td>)}</tr>}
          {total?.batches && <tr className="wu-total"><td colSpan={2}>Batches</td>{scen.map((s) => <td key={s.id} className="num">{fmtQty(total.batches![s.id]) || "–"}</td>)}</tr>}
        </tbody>
      </table>
    </section>
  );
}

function WuSection(props: { title: string; empty: string; items: { key: string; main: React.ReactNode; sub: string; action: { label: string; onClick: () => void } }[] }) {
  return (
    <section className={`wu-section${props.items.length ? "" : " none"}`} aria-label={props.title}>
      <h3>{props.title} <span className="chip">{props.items.length}</span></h3>
      {props.items.length === 0 ? <p className="hint" style={{ margin: 0 }}>{props.empty}</p> : (
        <ul className="wu-list">
          {props.items.map((it) => (
            <li key={it.key}>
              <div><div>{it.main}</div><div className="hint">{it.sub}</div></div>
              <button className="btn small" onClick={it.action.onClick}>{it.action.label}</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
