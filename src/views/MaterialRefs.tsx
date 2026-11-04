import { useState } from "react";
import { batchCount, loopWith, usesBatches } from "../model/recipes";
import type { BackupMaterial, Material, Recipe } from "../model/types";
import { Dialog } from "../ui/Dialog";

const parseNum = (s: string) => (s.trim() === "" ? NaN : Number(s.replace(/,/g, "").trim()));
const nf = new Intl.NumberFormat("en-US", { maximumFractionDigits: 6 });
const fmt = (v: number) => nf.format(v);

function MaterialSelect(props: { value: string; options: Material[]; onChange: (id: string) => void; label: string }) {
  return (
    <select className="cell-input" value={props.value} onChange={(e) => props.onChange(e.target.value)} aria-label={props.label}>
      <option value="">Choose a material…</option>
      {props.options.map((m) => <option key={m.id} value={m.id}>{m.code} · {m.name} ({m.unit})</option>)}
    </select>
  );
}

/**
 * Recipe of a prepared material (a buffer, a medium, a stock solution made in-house): its components
 * and their quantities for an amount of it, or per batch (a bag, a filter per preparation) when it is
 * made in batches. The BOM counts the components instead of the material.
 */
export function RecipeDialog(props: { material: Material; materials: Material[]; onSave: (recipe: Recipe | undefined) => void; onClose: () => void }) {
  const { material: m, materials } = props;
  const [per, setPer] = useState(String(m.recipe?.per ?? 1000));
  const [rows, setRows] = useState<{ materialId: string; qty: string; batch: boolean }[]>(
    m.recipe?.components.map((c) => ({ materialId: c.materialId, qty: String(c.qty), batch: c.basis === "batch" })) ?? [{ materialId: "", qty: "", batch: false }],
  );
  const [note, setNote] = useState(m.recipe?.note ?? "");
  const [batch, setBatch] = useState(m.recipe?.batch != null ? String(m.recipe.batch) : "");
  const [whole, setWhole] = useState(!!m.recipe?.wholeBatches);
  const [tryQty, setTryQty] = useState(String(m.recipe?.batch ? m.recipe.batch * 9.9 : m.recipe?.per ?? 1000));
  const byId = new Map(materials.map((x) => [x.id, x]));
  const options = materials.filter((x) => x.id !== m.id).sort((a, b) => a.code.localeCompare(b.code));
  const perN = parseNum(per);
  const batchN = parseNum(batch);
  const filled = rows.filter((r) => r.materialId || r.qty.trim());
  const errors: string[] = [];
  if (!(perN > 0)) errors.push("The amount the recipe is for must be a number > 0.");
  if (batch.trim() && !(batchN > 0)) errors.push("The batch size must be a number > 0 (or empty).");
  const seen = new Set<string>();
  for (const r of filled) {
    const c = byId.get(r.materialId);
    if (!c) { errors.push("Choose a material on every row (or remove the row)."); continue; }
    if (seen.has(r.materialId)) errors.push(`${c.code} appears twice.`);
    seen.add(r.materialId);
    if (!(parseNum(r.qty) > 0)) errors.push(`Quantity of ${c.code} must be a number > 0.`);
  }
  const recipe: Recipe | undefined = filled.length && !errors.length
    ? {
      per: perN,
      components: filled.map((r) => ({ materialId: r.materialId, qty: parseNum(r.qty), ...(r.batch ? { basis: "batch" as const } : {}) })),
      ...(note.trim() ? { note: note.trim() } : {}),
      ...(batchN > 0 ? { batch: batchN } : {}),
      ...(batchN > 0 && whole ? { wholeBatches: true } : {}),
    }
    : undefined;
  const loop = recipe ? loopWith(materials, m.id, recipe) : null;
  if (loop) errors.push(`This makes a loop (${loop.join(" → ")}): a material cannot be made of itself.`);
  const set = (i: number, patch: Partial<{ materialId: string; qty: string; batch: boolean }>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const perLabel = `per ${Number.isFinite(perN) && perN > 0 ? fmt(perN) : "…"} ${m.unit}`;
  const anyPerBatch = filled.some((r) => r.batch);

  // A quantity to try the recipe on: what the BOM would count for it.
  const tryN = parseNum(tryQty);
  const preview = recipe && tryN > 0 ? (() => {
    const n = batchCount(recipe, tryN);
    const amount = recipe.wholeBatches && recipe.batch ? n * recipe.batch : tryN;
    return {
      n,
      parts: recipe.components.map((c) => {
        const x = byId.get(c.materialId)!;
        const q = c.basis === "batch" ? n * c.qty : (amount * c.qty) / recipe.per;
        return `${x.code} ${fmt(Number(q.toPrecision(12)))} ${x.unit}${c.basis === "batch" ? ` (${fmt(n)} × ${fmt(c.qty)})` : ""}`;
      }),
    };
  })() : null;

  return (
    <Dialog
      title={`Recipe · ${m.code} ${m.name}`}
      wide
      onClose={props.onClose}
      actions={<>
        {m.recipe && <button className="btn ghost danger" onClick={() => props.onSave(undefined)}>Remove recipe</button>}
        <span className="spacer" />
        <button className="btn" onClick={props.onClose}>Cancel</button>
        <button className="btn primary" disabled={!!errors.length || !filled.length} onClick={() => props.onSave(recipe)}>Save recipe</button>
      </>}
    >
      <p className="hint" style={{ marginTop: 0 }}>
        {m.code} is made in-house. Wherever the BOM has a quantity of it (from the mass balance, the PFD or entered by hand), it adds its
        components below it: component quantity = BOM quantity × recipe quantity ÷ {Number.isFinite(perN) && perN > 0 ? fmt(perN) : "…"} {m.unit},
        or, for a component counted <b>per batch</b>, number of batches × its quantity. The totals then list the components to buy, and {m.code} as prepared in-house.
      </p>
      <label className="field-inline">
        Quantities for
        <input className="cell-input num-input" style={{ width: 110 }} value={per} onChange={(e) => setPer(e.target.value)} aria-label="Recipe amount" inputMode="decimal" />
        <span className="mono">{m.unit}</span> of {m.code}
      </label>
      <div className="recipe-batch">
        <label className="field-inline">
          Batch size (optional)
          <input className="cell-input num-input" style={{ width: 110 }} value={batch} onChange={(e) => setBatch(e.target.value)} placeholder="e.g. 200" aria-label="Batch size" inputMode="decimal" />
          <span className="mono">{m.unit}</span>
          <span className="hint">one preparation: a bag, a tank batch. Batches = quantity ÷ batch size, rounded up.</span>
        </label>
        <label className="check" title={batchN > 0 ? "" : "Set a batch size first"}>
          <input type="checkbox" checked={whole && batchN > 0} disabled={!(batchN > 0)} onChange={(e) => setWhole(e.target.checked)} aria-label="Make every batch in full" />
          <span>Make every batch in full: count the components {perLabel} for batches × batch size, not for the quantity needed</span>
        </label>
        {anyPerBatch && !(batchN > 0) && <span className="hint">No batch size: each BOM line is one batch.</span>}
      </div>
      <div className="table-wrap panel" style={{ marginTop: 10 }}>
        <table className="grid">
          <thead><tr><th>Component</th><th style={{ width: 130 }} className="num">Quantity</th><th style={{ width: 70 }}>Unit</th><th style={{ width: 170 }}>Counted</th><th style={{ width: 84 }} aria-label="Remove" /></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td><MaterialSelect value={r.materialId} options={options} onChange={(v) => set(i, { materialId: v })} label={`Component ${i + 1}`} /></td>
                <td><input className="cell-input num-input" value={r.qty} onChange={(e) => set(i, { qty: e.target.value })} aria-label={`Quantity ${i + 1}`} inputMode="decimal" /></td>
                <td className="mono">{byId.get(r.materialId)?.unit ?? ""}</td>
                <td>
                  <select className="cell-input" value={r.batch ? "batch" : "per"} onChange={(e) => set(i, { batch: e.target.value === "batch" })} aria-label={`Counted ${i + 1}`}>
                    <option value="per">{perLabel}</option>
                    <option value="batch">per batch</option>
                  </select>
                </td>
                <td><button className="btn ghost small danger" onClick={() => setRows(rows.filter((_, j) => j !== i))}>Remove</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="toolbar" style={{ marginTop: 8 }}>
        <button className="btn small" onClick={() => setRows([...rows, { materialId: "", qty: "", batch: false }])}>Add component</button>
      </div>
      <label className="field-block">
        Note
        <input className="cell-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. adjust to pH 7.4, WFI to volume" aria-label="Recipe note" />
      </label>
      {recipe && (
        <div className="recipe-try" aria-label="Try the recipe">
          <label className="field-inline">
            Try it: for
            <input className="cell-input num-input" style={{ width: 110 }} value={tryQty} onChange={(e) => setTryQty(e.target.value)} aria-label="Try quantity" inputMode="decimal" />
            <span className="mono">{m.unit}</span> the BOM counts
            {preview && usesBatches(recipe) ? <b>{fmt(preview.n)} batch{preview.n === 1 ? "" : "es"}{recipe.batch ? ` of ${fmt(recipe.batch)} ${m.unit}` : ""}</b> : null}
          </label>
          {preview && <ul>{preview.parts.map((t, i) => <li key={i} className="mono">{t}</li>)}</ul>}
          <span className="hint">Before each component's own default overage.</span>
        </div>
      )}
      {errors.length > 0 && filled.length > 0 && <div className="notice warn"><ul className="plain">{errors.map((e, i) => <li key={i}>{e}</li>)}</ul></div>}
    </Dialog>
  );
}

/** Backup (alternate) materials of a material: listed under its BOM lines, never added to the totals. */
export function BackupsDialog(props: { material: Material; materials: Material[]; onSave: (backups: BackupMaterial[] | undefined) => void; onClose: () => void }) {
  const { material: m, materials } = props;
  const [rows, setRows] = useState<{ materialId: string; ratio: string; note: string }[]>(
    m.backups?.map((b) => ({ materialId: b.materialId, ratio: b.ratio != null ? String(b.ratio) : "", note: b.note ?? "" })) ?? [{ materialId: "", ratio: "", note: "" }],
  );
  const byId = new Map(materials.map((x) => [x.id, x]));
  const options = materials.filter((x) => x.id !== m.id).sort((a, b) => a.code.localeCompare(b.code));
  const filled = rows.filter((r) => r.materialId || r.ratio.trim() || r.note.trim());
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const r of filled) {
    const b = byId.get(r.materialId);
    if (!b) { errors.push("Choose a material on every row (or remove the row)."); continue; }
    if (seen.has(r.materialId)) errors.push(`${b.code} appears twice.`);
    seen.add(r.materialId);
    if (r.ratio.trim() && !(parseNum(r.ratio) > 0)) errors.push(`Ratio of ${b.code} must be a number > 0 (empty = 1).`);
  }
  const list: BackupMaterial[] = filled.map((r) => ({
    materialId: r.materialId,
    ...(r.ratio.trim() && parseNum(r.ratio) !== 1 ? { ratio: parseNum(r.ratio) } : {}),
    ...(r.note.trim() ? { note: r.note.trim() } : {}),
  }));
  const set = (i: number, patch: Partial<{ materialId: string; ratio: string; note: string }>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <Dialog
      title={`Backup materials · ${m.code} ${m.name}`}
      wide
      onClose={props.onClose}
      actions={<>
        <button className="btn" onClick={props.onClose}>Cancel</button>
        <button className="btn primary" disabled={!!errors.length} onClick={() => props.onSave(list.length ? list : undefined)}>Save backups</button>
      </>}
    >
      <p className="hint" style={{ marginTop: 0 }}>
        Alternate materials for {m.code} (another supplier or part number) used when it is not available. The BOM lists them under
        every line of {m.code} in all unit operations, with quantity = {m.code} quantity × ratio, and sums them on their own:
        they are never added to the totals.
      </p>
      <div className="table-wrap panel">
        <table className="grid">
          <thead><tr><th>Backup material</th><th style={{ width: 170 }} className="num">Ratio (per 1 {m.unit})</th><th>Note</th><th style={{ width: 70 }} aria-label="Remove" /></tr></thead>
          <tbody>
            {rows.map((r, i) => {
              const b = byId.get(r.materialId);
              return (
                <tr key={i}>
                  <td><MaterialSelect value={r.materialId} options={options} onChange={(v) => set(i, { materialId: v })} label={`Backup ${i + 1}`} /></td>
                  <td>
                    <input className="cell-input num-input" value={r.ratio} placeholder="1" onChange={(e) => set(i, { ratio: e.target.value })} aria-label={`Ratio ${i + 1}`} inputMode="decimal" />
                    {b && b.unit !== m.unit && !r.ratio.trim() && <div className="bom-issue">{b.code} is in {b.unit}: give {b.unit} per 1 {m.unit}.</div>}
                  </td>
                  <td><input className="cell-input" value={r.note} onChange={(e) => set(i, { note: e.target.value })} placeholder="e.g. supplier B, qualified 2025" aria-label={`Backup note ${i + 1}`} /></td>
                  <td><button className="btn ghost small danger" onClick={() => setRows(rows.filter((_, j) => j !== i))}>Remove</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="toolbar" style={{ marginTop: 8 }}>
        <button className="btn small" onClick={() => setRows([...rows, { materialId: "", ratio: "", note: "" }])}>Add backup</button>
      </div>
      {errors.length > 0 && <div className="notice warn"><ul className="plain">{errors.map((e, i) => <li key={i}>{e}</li>)}</ul></div>}
    </Dialog>
  );
}
