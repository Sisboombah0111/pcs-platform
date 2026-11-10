import { useEffect, useMemo, useState } from "react";
import { PageIntro } from "../ui/PageIntro";
import { RibbonButton, RibbonGroup, ScreenRibbon } from "../ui/Ribbon";
import { computeBom } from "../bom/model";
import { usageCounts } from "../model/whereUsed";
import { WhereUsedDialog, type GoPlace } from "./WhereUsed";
import { ReplaceDialog, runReplace, type Transform } from "./ReplaceMaterial";
import { changeCodesInMb, mbUsesOf } from "../mb/codeChanges";
import { STATUS_LABEL } from "../model/materials";
import type { MaterialStatus } from "../model/types";
import { newId } from "../model/ids";
import {
  BACKUP_EXPORT_HEADER, MATERIAL_EXPORT_HEADER, bulkEdit, type BulkPatch, RECIPE_EXPORT_HEADER, applyImport, applyRefsImport, backupRows, materialToRow, parseCsv,
  planMaterialImport, planRefsImport, recipeRows, type ImportPlan, type RefsPlan,
} from "../model/materials";
import { batchText, deleteMaterial, usedIn, withBackups, withRecipe } from "../model/recipes";
import { COMMON_UNITS, SAMPLE_COUNT, addMissingSamples, hasMissingSamples, sampleMaterials } from "../model/sampleData";
import type { Material, Project } from "../model/types";
import { downloadBlob, pickFile } from "../storage/files";
import { Dialog } from "../ui/Dialog";
import { RowMenu } from "../ui/RowMenu";
import { readTables, writeWorkbook } from "../xlsx/workbook";
import { BackupsDialog, RecipeDialog } from "./MaterialRefs";
import { HeadRow, useColumns, type Head } from "../ui/resize";
import { Workbook } from "../ui/Workbook";
import type { ReactNode } from "react";

type Field = "code" | "name" | "unit" | "category" | "spec" | "note" | "supplier" | "partNo";

export function MaterialsView(props: {
  project: Project;
  /** `label` names the change for undo and the change log. */
  onChange: (materials: Material[], label?: string) => void;
  confirm: (o: { title: string; body: string; confirmLabel: string; danger?: boolean }) => Promise<boolean>;
  toast: (msg: string) => void;
  /** Where "Where used" sends the user (BOM line, PFD …). */
  go?: (place: GoPlace) => void;
  /** Whole-project changes (Replace, codes in the MB workbook). */
  transform?: Transform;
  /** Asked from elsewhere: show this material, and open its recipe or backups. */
  focus?: { code: string; open?: "recipe" | "backups"; n: number } | null;
  /** Called once the focus request is handled, so it does not come back when the screen opens again. */
  onFocusDone?: () => void;
}) {
  const { project, onChange, confirm, toast } = props;
  const [usedOf, setUsedOf] = useState<string | null>(null);
  const [replacing, setReplacing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [statusFilter, setStatusFilter] = useState<"" | "active" | MaterialStatus>("");
  // Rows ticked for a bulk edit or delete.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  // Purchasing columns (supplier, part no., pack size): shown on request, remembered in this browser.
  const [buying, setBuyingState] = useState(() => { try { return localStorage.getItem("pcs.materials.buying") === "1"; } catch { return false; } });
  const setBuying = (v: boolean) => { setBuyingState(v); try { localStorage.setItem("pcs.materials.buying", v ? "1" : "0"); } catch { /* not remembered */ } };
  // Code changes waiting to be carried into the MB workbook: old code → new code (chains are joined).
  const [renames, setRenames] = useState<Map<string, string>>(new Map());
  const [codeAtFocus, setCodeAtFocus] = useState<{ id: string; code: string } | null>(null);
  const noteRename = (from: string, to: string) => setRenames((prev) => {
    const next = new Map(prev);
    for (const [a, b] of next) if (b === from) next.set(a, to);
    if (![...prev.values()].includes(from)) next.set(from, to);
    for (const [a, b] of next) if (a === b) next.delete(a);
    return next;
  });
  const pendingMb = [...renames].filter(([a]) => mbUsesOf(project, [a]) > 0 || !!project.mb.workbook);
  const carryRenames = async () => {
    if (!props.transform) return;
    setBusy(true);
    const map = new Map(pendingMb);
    let msg = "";
    try {
      await props.transform(async (p) => {
        const r = await changeCodesInMb(p, map, { why: "Code changed", by: (() => { try { return localStorage.getItem("pcs.userName") ?? ""; } catch { return ""; } })() });
        msg = `${r.workbookRows} PCS_LINK row(s) changed in the MB workbook, ${r.appliedRows} applied row(s) follow.${r.skipped.length ? ` Rows ${r.skipped.map((x) => x.row).join(", ")} have a formula: change them in the workbook.` : ""}`;
        return r.project;
      }, { label: `Code change into the MB workbook: ${[...map].map(([a, b]) => `${a} → ${b}`).join(", ")}` });
      setRenames(new Map());
      toast(msg);
    } catch (e) {
      toast(`Could not change the workbook: ${(e as Error).message}`);
    } finally { setBusy(false); }
  };
  const counts = useMemo(() => usageCounts(project, computeBom(project)), [project]);
  const [query, setQuery] = useState("");
  const [plan, setPlan] = useState<{ plan: ImportPlan; refs: RefsPlan | null; fileName: string } | null>(null);
  const [editing, setEditing] = useState<{ id: string; what: "recipe" | "backups" } | null>(null);
  const materials = project.materials;

  const dupCodes = useMemo(() => {
    const count = new Map<string, number>();
    materials.forEach((m) => m.code && count.set(m.code, (count.get(m.code) ?? 0) + 1));
    return new Set([...count].filter(([, n]) => n > 1).map(([c]) => c));
  }, [materials]);

  const usedBy = useMemo(() => {
    const map = new Map<string, number>();
    for (const lines of Object.values(project.bom.lines)) for (const l of lines) map.set(l.materialId, (map.get(l.materialId) ?? 0) + 1);
    return map;
  }, [project.bom.lines]);

  // A material asked for from elsewhere (Where used › Open recipe): show it, open what was asked.
  useEffect(() => {
    if (!props.focus) return;
    const m = materials.find((x) => x.code === props.focus!.code);
    props.onFocusDone?.();
    if (!m) return;
    setQuery("");
    setSheet("materials");
    if (props.focus.open) setEditing({ id: m.id, what: props.focus.open });
    setTimeout(() => {
      const tr = document.querySelector(`tr[data-code="${CSS.escape(m.code)}"]`);
      tr?.scrollIntoView({ block: "center" });
      tr?.classList.add("flash");
      setTimeout(() => tr?.classList.remove("flash"), 1700);
    }, 60);
  }, [props.focus?.n]); // eslint-disable-line react-hooks/exhaustive-deps

  const q = query.trim().toLowerCase();
  const shown = materials.filter((m) => (!q || [m.code, m.name, m.category, m.spec, m.supplier, m.partNo].some((v) => v?.toLowerCase().includes(q)))
    && (!statusFilter || (m.status ?? "active") === statusFilter));

  const update = (id: string, field: Field, value: string) =>
    onChange(materials.map((m) => (m.id === id ? { ...m, [field]: field === "code" ? value.trim() : value } : m)));

  const add = () => {
    const n = materials.length + 1;
    let code = `MAT-${String(n).padStart(4, "0")}`;
    const codes = new Set(materials.map((m) => m.code));
    for (let i = n; codes.has(code); i++) code = `MAT-${String(i + 1).padStart(4, "0")}`;
    onChange([...materials, { id: newId("mat"), code, name: "", unit: "kg" }]);
  };

  const remove = async (m: Material) => {
    const uses = usedBy.get(m.id) ?? 0;
    const refs = usedIn(materials, m.id);
    const parts = [
      uses ? `is used in ${uses} BOM line(s); deleting it removes those lines too` : "",
      refs.recipes.length ? `is a component in the recipe of ${refs.recipes.map((x) => x.code).join(", ")}` : "",
      refs.backups.length ? `is a backup for ${refs.backups.map((x) => x.code).join(", ")}` : "",
    ].filter(Boolean);
    const ok = await confirm({
      title: "Delete material",
      body: parts.length ? `${m.code} ${m.name} ${parts.join("; it ")}. It is taken out of those as well.` : `Delete ${m.code} ${m.name}?`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (ok) onChange(deleteMaterial(materials, m.id));
  };

  // A list that uses the sample codes can take the samples added later (lines, transfer panel, buffers …).
  const missingSamples = hasMissingSamples(materials);
  const addSamples = () => {
    const r = addMissingSamples(materials);
    onChange(r.materials);
    const said = [
      r.added.length ? `Added ${r.added.length} sample material(s)` : "",
      r.completed.length ? `${r.added.length ? "g" : "G"}ave ${r.completed.map((m) => m.code).join(", ")} the sample recipe or backups` : "",
    ].filter(Boolean);
    toast(said.join("; "));
  };
  const missingCount = missingSamples ? addMissingSamples(materials).added.length : 0;

  const importFile = async () => {
    const file = await pickFile(".xlsx,.csv,.txt");
    if (!file) return;
    try {
      if (/\.(csv|txt)$/i.test(file.name)) {
        setPlan({ plan: planMaterialImport(parseCsv(await file.text()), materials), refs: null, fileName: file.name });
        return;
      }
      const sheets = await readTables(await file.arrayBuffer());
      const first = sheets.find((x) => !RECIPE_SHEET.test(x.name) && !BACKUP_SHEET.test(x.name)) ?? sheets[0];
      const matPlan = planMaterialImport(first?.table ?? [], materials);
      const rec = sheets.find((x) => RECIPE_SHEET.test(x.name.trim()))?.table ?? null;
      const bak = sheets.find((x) => BACKUP_SHEET.test(x.name.trim()))?.table ?? null;
      const refs = rec || bak ? planRefsImport(rec, bak, applyImport(materials, matPlan)) : null;
      setPlan({ plan: matPlan, refs, fileName: file.name });
    } catch (e) {
      toast(`Could not read the file: ${(e as Error).message}`);
    }
  };

  const exportFile = async () => {
    const blob = await writeWorkbook([
      { name: "Materials", header: MATERIAL_EXPORT_HEADER, rows: materials.map((m) => materialToRow(m, materials)), widths: [14, 36, 8, 14, 18, 10, 24, 13, 13, 22, 16, 10, 13] },
      { name: "Recipes", header: RECIPE_EXPORT_HEADER, rows: recipeRows(materials), widths: [14, 36, 8, 7, 16, 32, 10, 14, 11, 11, 13, 40] },
      { name: "Backups", header: BACKUP_EXPORT_HEADER, rows: backupRows(materials), widths: [14, 36, 14, 36, 8, 30] },
    ]);
    downloadBlob(blob, `${project.meta.name} materials.xlsx`);
  };
  const editingMat = editing ? materials.find((m) => m.id === editing.id) : undefined;
  const live = new Set(materials.map((m) => m.id));
  const picked = new Set([...selected].filter((id) => live.has(id)));
  const allShown = shown.length > 0 && shown.every((m) => picked.has(m.id));
  const rowHead: Head = { ...MATERIAL_HEADS[0], label: <input type="checkbox" aria-label="Select all shown" checked={allShown} onChange={(e) => setSelected(e.target.checked ? new Set([...picked, ...shown.map((m) => m.id)]) : new Set([...picked].filter((id) => !shown.some((m) => m.id === id))))} /> };
  const base = [rowHead, ...MATERIAL_HEADS.slice(1)];
  const heads = buying ? [...base.slice(0, 8), ...BUYING_HEADS, ...base.slice(8)] : base;
  const removeMany = async () => {
    const list = materials.filter((m) => picked.has(m.id));
    const lines = list.reduce((n, m) => n + (usedBy.get(m.id) ?? 0), 0);
    const ok = await confirm({
      title: `Delete ${list.length} material(s)?`,
      body: `${list.slice(0, 8).map((m) => m.code).join(", ")}${list.length > 8 ? " …" : ""}.${lines ? ` They are used in ${lines} BOM line(s), which go too.` : ""} They are also taken out of recipes and backup lists. Undo (↶) brings them back.`,
      confirmLabel: "Delete", danger: true,
    });
    if (!ok) return;
    let next = materials;
    for (const m of list) next = deleteMaterial(next, m.id);
    onChange(next, `Delete ${list.length} materials`);
    setSelected(new Set());
  };
  const cols = useColumns(buying ? "materials+buying" : "materials", heads);
  const replace = (next: Material) => onChange(materials.map((m) => (m.id === next.id ? next : m)));

  const [sheet, setSheetState] = useState<"materials" | "recipes" | "backups">(() => { try { const v = localStorage.getItem("pcs.materials.sheet"); return v === "recipes" || v === "backups" ? v : "materials"; } catch { return "materials"; } });
  const setSheet = (v: typeof sheet) => { setSheetState(v); try { localStorage.setItem("pcs.materials.sheet", v); } catch { /* not remembered */ } };
  const recipes = recipeRows(materials);
  const backups = backupRows(materials);
  const recipeCount = materials.filter((m) => m.recipe?.components.length).length;
  const backupCount = materials.filter((m) => m.backups?.length).length;
  const openRef = (code: unknown, what: "recipe" | "backups") => { const m = materials.find((x) => x.code === code); if (m) setEditing({ id: m.id, what }); };

  return (
    <div className="page wb-page">
      <div className="page-head">
        <div>
          <h1>Materials</h1>
          <PageIntro id="materials" lead="The material list used by the BOM and by MB workbooks (MatCode in PCS_LINK).">Codes must be unique in the project, and every quantity is counted in the unit given here. Recipes and Backups (sheets at the bottom) list what each material is made of and its alternates; edit them with the Recipe and Backup buttons.</PageIntro>
        </div>
      </div>
      <ScreenRibbon screen="materials">
        <RibbonGroup label="Materials">
          <RibbonButton big primary icon="add" onClick={add} title="A new row at the end of the list" label="Add material" />
          {missingSamples && (
            <RibbonButton big icon="samples" onClick={addSamples}
              title="This list uses the sample codes: add the samples it does not have yet (lines, transfer panel, buffer chemicals …) and the sample recipes and backups"
              label={missingCount ? `Add ${missingCount} missing sample(s)` : "Add sample recipes and backups"} />
          )}
        </RibbonGroup>
        <RibbonGroup label="Find and filter">
          <div className="rfields">
            <label className="rfield"><span>Find</span>
              <input className="search" type="search" placeholder="Code, name, category, supplier" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search materials" />
            </label>
            <label className="rfield"><span>Status</span>
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)} aria-label="Status filter">
                <option value="">All statuses</option>
                <option value="active">In use</option>
                <option value="review">Under review</option>
                <option value="obsolete">Obsolete</option>
              </select>
            </label>
          </div>
          <div className="rstack">
            <label className="rcheck" title="Supplier, part (catalogue) number and pack size; the BOM totals then say how many packs to order">
              <input type="checkbox" checked={buying} onChange={(e) => setBuying(e.target.checked)} /> <span>Purchasing</span>
            </label>
            {(query || statusFilter) && <button className="rbtn" onClick={() => { setQuery(""); setStatusFilter(""); }} title="Show every material">Clear filter</button>}
          </div>
        </RibbonGroup>
        <RibbonGroup label="Excel">
          <RibbonButton big icon="import" onClick={importFile} title="Materials, Recipes and Backups sheets, or a CSV file" label="Import Excel/CSV" />
          <RibbonButton big icon="excel" onClick={exportFile} disabled={!materials.length} title="The material list as an Excel workbook" label="Export to Excel" />
        </RibbonGroup>
      </ScreenRibbon>

      <Workbook
        bar={(pendingMb.length > 0 || picked.size > 0) ? (
          <div className="wb-bar">
            {pendingMb.length > 0 && (
              <div className="notice warn notice-row" role="status">
                <span>
                  Code changed: {pendingMb.map(([a, b]) => `${a} → ${b}`).join(", ")}. The mass balance still says {pendingMb.map(([a]) => a).join(", ")}
                  {project.mb.current ? ` (${mbUsesOf(project, pendingMb.map(([a]) => a))} applied row(s))` : ""}: those values are left out of the BOM until the workbook uses the new code.
                </span>
                <span className="spacer" />
                <button className="btn small primary" disabled={busy || !props.transform} onClick={carryRenames}>{busy ? "Updating…" : "Update the MB workbook too"}</button>
                <button className="btn small ghost" onClick={() => setRenames(new Map())}>Not now</button>
              </div>
            )}
            {picked.size > 0 && (
              <div className="notice notice-row bulk-bar" role="status">
                <span><b>{picked.size}</b> selected</span>
                <button className="btn small primary" onClick={() => setBulkOpen(true)}>Edit selected…</button>
                <button className="btn small danger" onClick={removeMany}>Delete selected</button>
                <span className="spacer" />
                <button className="btn small ghost" onClick={() => setSelected(new Set())}>Clear selection</button>
              </div>
            )}
          </div>
        ) : undefined}
        tabs={[
          { id: "materials", label: `Material list (${materials.length})`, ...(dupCodes.size ? { dot: "err" as const, title: `${dupCodes.size} duplicate code(s)` } : {}) },
          { id: "recipes", label: `Recipes (${recipeCount})`, title: "Materials made in-house and what they are made of" },
          { id: "backups", label: `Backups (${backupCount})`, title: "Alternate materials" },
        ]}
        active={sheet}
        onPick={(id) => setSheet(id as typeof sheet)}
        info={sheet === "materials" && materials.length > 0 ? <>{shown.length !== materials.length ? `${shown.length} of ${materials.length} materials shown` : `${materials.length} materials`}{dupCodes.size ? ` · ${dupCodes.size} duplicate code(s)` : ""}</> : undefined}
      >
        <section aria-label="Material list" hidden={sheet !== "materials"}>
          {materials.length === 0 ? (
            <div className="empty">
              <strong>No materials yet</strong>
              <span>Import an Excel or CSV file (headers: Code, Name, Unit, Category, Spec, Overage %; optional sheets Recipes and Backups) or add materials one by one.</span>
              <div className="toolbar">
                <button className="btn" onClick={importFile}>Import Excel/CSV</button>
                <button className="btn" onClick={() => onChange(sampleMaterials())}>Add {SAMPLE_COUNT} sample materials</button>
              </div>
            </div>
          ) : (
            <div className="table-wrap">
              <table className="grid" ref={cols.tableRef} style={cols.tableStyle}>
                {cols.colgroup}
                <HeadRow heads={heads} cols={cols} />
                <tbody>
                  {shown.map((m) => {
                    const badCode = !m.code || dupCodes.has(m.code);
                    const badUnit = !m.unit.trim();
                    return (
                      <tr key={m.id} className={badCode || badUnit ? "row-bad" : ""} data-code={m.code}>
                        <td className="idx"><label className="row-pick" title={`Material ${materials.indexOf(m) + 1}`}><input type="checkbox" aria-label={`Select ${m.code}`} checked={picked.has(m.id)}
                          onChange={(e) => { const n = new Set(picked); if (e.target.checked) n.add(m.id); else n.delete(m.id); setSelected(n); }} /></label></td>
                        <td><input className={`cell-input mono${badCode ? " bad" : ""}`} value={m.code} onChange={(e) => update(m.id, "code", e.target.value)} aria-label="Code" title={badCode ? (m.code ? "Duplicate code" : "Code is empty") : undefined}
                          onFocus={() => setCodeAtFocus({ id: m.id, code: m.code })}
                          onBlur={() => { if (codeAtFocus?.id === m.id && codeAtFocus.code && m.code && codeAtFocus.code !== m.code && !badCode) noteRename(codeAtFocus.code, m.code); setCodeAtFocus(null); }} /></td>
                        <td><input className="cell-input" value={m.name} title={m.name} onChange={(e) => update(m.id, "name", e.target.value)} aria-label="Name" placeholder="Material name" /></td>
                        <td><input className={`cell-input mono${badUnit ? " bad" : ""}`} value={m.unit} list="units" onChange={(e) => update(m.id, "unit", e.target.value)} aria-label="Unit" /></td>
                        <td><input className="cell-input" value={m.category ?? ""} title={m.category ?? ""} onChange={(e) => update(m.id, "category", e.target.value)} aria-label="Category" /></td>
                        <td><input className="cell-input" value={m.spec ?? ""} title={m.spec ?? ""} onChange={(e) => update(m.id, "spec", e.target.value)} aria-label="Spec" /></td>
                        <td><OverageInput value={m.overagePct} onChange={(v) => onChange(materials.map((x) => (x.id === m.id ? withOverage(x, v) : x)))} /></td>
                        <td><input className="cell-input" value={m.note ?? ""} title={m.note ?? ""} onChange={(e) => update(m.id, "note", e.target.value)} aria-label="Note" /></td>
                        {buying && <>
                          <td><input className="cell-input" value={m.supplier ?? ""} onChange={(e) => update(m.id, "supplier", e.target.value)} aria-label={`Supplier of ${m.code}`} /></td>
                          <td><input className="cell-input mono" value={m.partNo ?? ""} onChange={(e) => update(m.id, "partNo", e.target.value)} aria-label={`Part no. of ${m.code}`} /></td>
                          <td><PackInput value={m.packSize} unit={m.unit} code={m.code} onChange={(v) => onChange(materials.map((x) => { if (x.id !== m.id) return x; const n = { ...x }; if (v === undefined) delete n.packSize; else n.packSize = v; return n; }))} /></td>
                        </>}
                        <td className="refs-cell">
                          <button className={`btn small${m.recipe ? " on" : " ghost"}`} onClick={() => setEditing({ id: m.id, what: "recipe" })} aria-label={`Recipe of ${m.code}`}
                            title={m.recipe ? `Made in-house: ${m.recipe.components.map((c) => materials.find((x) => x.id === c.materialId)?.code).join(", ")} per ${m.recipe.per} ${m.unit}${m.recipe.batch ? `; ${batchText(m.recipe, m.unit)}` : ""}` : "Made in-house? Give its recipe"}>
                            {m.recipe ? `Recipe (${m.recipe.components.length})${m.recipe.batch ? ` · ${m.recipe.batch} ${m.unit}` : ""}` : "+ Recipe"}
                          </button>
                          <button className={`btn small${m.backups ? " on" : " ghost"}`} onClick={() => setEditing({ id: m.id, what: "backups" })} aria-label={`Backups of ${m.code}`}
                            title={m.backups ? `Backups: ${m.backups.map((b) => materials.find((x) => x.id === b.materialId)?.code).join(", ")}` : "Add an alternate material"}>
                            {m.backups ? `Backups (${m.backups.length})` : "+ Backup"}
                          </button>
                        </td>
                        <td>
                          <select className={`cell-input status-select ${m.status ?? "active"}`} value={m.status ?? "active"} aria-label={`Status of ${m.code}`}
                            onChange={(e) => onChange(materials.map((x) => { if (x.id !== m.id) return x; const n = { ...x }; if (e.target.value === "active") { delete n.status; delete n.replacedBy; } else n.status = e.target.value as MaterialStatus; return n; }))}>
                            <option value="active">{STATUS_LABEL.active}</option>
                            <option value="review">{STATUS_LABEL.review}</option>
                            <option value="obsolete">{STATUS_LABEL.obsolete}</option>
                          </select>
                          {m.replacedBy && <div className="hint">→ {materials.find((x) => x.id === m.replacedBy)?.code}</div>}
                        </td>
                        <td className="num">
                          <button className="btn small ghost used-btn" onClick={() => setUsedOf(m.id)} aria-label={`Where is ${m.code} used`}
                            title={`Where is ${m.code} used? (BOM lines, recipes, MB rows, PFD links, backups)${usedBy.get(m.id) ? ` · ${usedBy.get(m.id)} stored BOM line(s)` : ""}`}>{counts.get(m.id) ?? 0}</button>
                        </td>
                        <td>
                          <RowMenu label={`More for ${m.code}`} items={[
                            { label: "Where used", onClick: () => setUsedOf(m.id) },
                            ...(props.transform ? [{ label: "Replace…", aria: `Replace ${m.code}`, onClick: () => setReplacing(m.id) }] : []),
                            { label: "Delete", aria: `Delete ${m.code}`, danger: true, onClick: () => remove(m) },
                          ]} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <datalist id="units">{COMMON_UNITS.map((u) => <option key={u} value={u} />)}</datalist>
            </div>
          )}
        </section>
        {sheet === "recipes" && <section aria-label="Recipes">
          {recipes.length === 0 ? <p className="hint xl-empty">No recipes yet. A material made in-house (a buffer, a medium) gets its recipe with the <b>+ Recipe</b> button on the Materials sheet.</p>
            : <SheetTable header={RECIPE_EXPORT_HEADER} rows={recipes} widths={[12, 34, 7, 6, 14, 28, 9, 12, 9, 9, 12, 36]} numeric={[2, 6, 9]} mono={[0, 4]} label="Recipes"
                action={(row, i) => (i === 0 || recipes[i - 1][0] !== row[0]) ? <button className="btn small" onClick={() => openRef(row[0], "recipe")} aria-label={`${row[0]}: edit its recipe`}>Edit…</button> : null} />}
        </section>}
        {sheet === "backups" && <section aria-label="Backups">
          {backups.length === 0 ? <p className="hint xl-empty">No backups yet. An alternate material is added with the <b>+ Backup</b> button on the Materials sheet.</p>
            : <SheetTable header={BACKUP_EXPORT_HEADER} rows={backups} widths={[12, 36, 12, 36, 7, 30]} numeric={[4]} mono={[0, 2]} label="Backups"
                action={(row, i) => (i === 0 || backups[i - 1][0] !== row[0]) ? <button className="btn small" onClick={() => openRef(row[0], "backups")} aria-label={`${row[0]}: edit its backups`}>Edit…</button> : null} />}
        </section>}
      </Workbook>

      {plan && (
        <ImportDialog
          fileName={plan.fileName}
          plan={plan.plan}
          refs={plan.refs}
          onCancel={() => setPlan(null)}
          onApply={() => {
            const after = applyImport(materials, plan.plan);
            onChange(plan.refs ? applyRefsImport(after, plan.refs) : after);
            const r = plan.refs;
            toast(`${plan.plan.add.length} added, ${plan.plan.update.length} updated${r ? `, ${r.recipes.filter((x) => x.changed).length} recipe(s) and ${r.backups.filter((x) => x.changed).length} backup list(s) set` : ""}`);
            setPlan(null);
          }}
        />
      )}
      {bulkOpen && (
        <BulkEditDialog count={picked.size} onCancel={() => setBulkOpen(false)}
          onApply={(patch) => { onChange(bulkEdit(materials, picked, patch), `Edit ${picked.size} materials`); setBulkOpen(false); toast(`${picked.size} material(s) changed`); }} />
      )}
      {replacing && props.transform && (
        <ReplaceDialog project={project} materialId={replacing} busy={busy} onClose={() => setReplacing(null)}
          onReplace={async (c) => {
            setBusy(true);
            try { toast(await runReplace(props.transform!, project, replacing, c)); setReplacing(null); }
            catch (e) { toast(`Could not replace: ${(e as Error).message}`); }
            finally { setBusy(false); }
          }} />
      )}
      {usedOf && <WhereUsedDialog project={project} materialId={usedOf} onClose={() => setUsedOf(null)} onReplace={props.transform ? (id) => { setUsedOf(null); setReplacing(id); } : undefined}
        go={(place) => {
          if (place.kind === "material") {
            const m = materials.find((x) => x.code === place.code);
            if (m && place.open) setEditing({ id: m.id, what: place.open });
            return;
          }
          props.go?.(place);
        }} />}
      {editingMat && editing?.what === "recipe" && (
        <RecipeDialog material={editingMat} materials={materials} onClose={() => setEditing(null)}
          onSave={(recipe) => { replace(withRecipe(editingMat, recipe)); setEditing(null); toast(recipe ? `${editingMat.code}: recipe saved (${recipe.components.length} component${recipe.components.length === 1 ? "" : "s"})` : `${editingMat.code}: recipe removed`); }} />
      )}
      {editingMat && editing?.what === "backups" && (
        <BackupsDialog material={editingMat} materials={materials} onClose={() => setEditing(null)}
          onSave={(backups) => { replace(withBackups(editingMat, backups)); setEditing(null); toast(`${editingMat.code}: ${backups?.length ?? 0} backup material(s)`); }} />
      )}
    </div>
  );
}

function withOverage(m: Material, v: number | undefined): Material {
  const next = { ...m };
  if (v === undefined) delete next.overagePct; else next.overagePct = v;
  return next;
}

/** Overage % of a material: empty = 0 (not set); commits on blur or Enter. */
function OverageInput(props: { value?: number; onChange: (v: number | undefined) => void }) {
  const show = props.value === undefined ? "" : String(props.value);
  const [text, setText] = useState(show);
  const [prev, setPrev] = useState(show);
  if (prev !== show) { setPrev(show); setText(show); }
  const n = text.trim() === "" ? undefined : Number(text.replace(/%$/, ""));
  const bad = n !== undefined && (!Number.isFinite(n) || n < 0);
  return (
    <input className={`cell-input mono num-input${bad ? " bad" : ""}`} value={text} placeholder="0" aria-label="Overage %" inputMode="decimal"
      onChange={(e) => setText(e.target.value)}
      onBlur={() => { if (bad) setText(show); else if (n !== props.value) props.onChange(n); }}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
  );
}

/** Set fields on many materials at once; an empty field is left as it is. */
function BulkEditDialog(props: { count: number; onCancel: () => void; onApply: (p: BulkPatch) => void }) {
  const [f, setF] = useState<Record<string, string>>({});
  const [clear, setClear] = useState<Record<string, boolean>>({});
  const set = (k: string, v: string) => setF({ ...f, [k]: v });
  const num = (k: string) => { const t = (f[k] ?? "").replace(/[,%]/g, "").trim(); const n = Number(t); return t === "" ? undefined : Number.isFinite(n) && n >= 0 ? n : NaN; };
  const ovg = num("overage"), pack = num("pack");
  const bad = Number.isNaN(ovg) || Number.isNaN(pack);
  const patch = (): BulkPatch => {
    const p: BulkPatch = {};
    for (const k of ["category", "spec", "supplier", "note"] as const) if (clear[k]) p[k] = ""; else if ((f[k] ?? "").trim()) p[k] = f[k];
    if (clear.overage) p.overagePct = 0; else if (ovg !== undefined) p.overagePct = ovg;
    if (clear.pack) p.packSize = 0; else if (pack !== undefined) p.packSize = pack;
    if (f.status) p.status = f.status as BulkPatch["status"];
    return p;
  };
  const n = Object.keys(patch()).length;
  const row = (k: string, label: string, ph = "") => (
    <div className="bulk-row" key={k}>
      <span>{label}</span>
      <input className="cell-input" value={f[k] ?? ""} placeholder={clear[k] ? "(cleared)" : ph || "keep"} disabled={clear[k]} aria-label={`Bulk ${label}`} onChange={(e) => set(k, e.target.value)} />
      <label className="check"><input type="checkbox" checked={!!clear[k]} onChange={(e) => setClear({ ...clear, [k]: e.target.checked })} /> <span>clear</span></label>
    </div>
  );
  return (
    <Dialog title={`Edit ${props.count} selected material(s)`} onClose={props.onCancel} actions={<>
      <button className="btn" onClick={props.onCancel}>Cancel</button>
      <button className="btn primary" disabled={!n || bad} onClick={() => props.onApply(patch())}>Apply to {props.count}</button>
    </>}>
      <p className="hint" style={{ marginTop: 0 }}>Fill in only what should change; empty fields keep each material's own value. Undo (↶) takes it all back.</p>
      <div className="bulk-grid">
        {row("category", "Category")}
        {row("spec", "Spec")}
        {row("overage", "Overage %", "keep (e.g. 5)")}
        {row("supplier", "Supplier")}
        {row("pack", "Pack size", "keep (in each material's unit)")}
        {row("note", "Note", "keep (replaces the note)")}
        <div className="bulk-row">
          <span>Status</span>
          <select className="cell-input" value={f.status ?? ""} aria-label="Bulk Status" onChange={(e) => set("status", e.target.value)}>
            <option value="">keep</option><option value="active">In use</option><option value="review">Under review</option><option value="obsolete">Obsolete</option>
          </select>
          <span />
        </div>
      </div>
      {bad && <div className="notice warn">Overage and pack size are numbers (0 or more).</div>}
    </Dialog>
  );
}

const BUYING_HEADS: Head[] = [
  { id: "supplier", label: "Supplier", width: 150 }, { id: "partNo", label: "Part no.", width: 120 },
  { id: "pack", label: "Pack size", width: 110, title: "Size of one pack as bought, in the material's unit (25 for a 25 kg bag). The BOM totals round up to whole packs." },
];

/** Pack size in the material's unit; empty = not bought in packs. Bad input turns red and is not kept. */
function PackInput(props: { value?: number; unit: string; code: string; onChange: (v: number | undefined) => void }) {
  const show = props.value === undefined ? "" : String(props.value);
  const [text, setText] = useState(show);
  const [prev, setPrev] = useState(show);
  if (prev !== show) { setPrev(show); setText(show); }
  const n = Number(text.replace(/,/g, "").trim());
  const bad = text.trim() !== "" && !(Number.isFinite(n) && n > 0);
  return (
    <span className="pack-input">
      <input className={`cell-input num-input${bad ? " bad" : ""}`} value={text} inputMode="decimal" aria-label={`Pack size of ${props.code}`} placeholder="–"
        title={bad ? "A number above 0, in the material's unit" : undefined}
        onChange={(e) => setText(e.target.value)} onBlur={() => { if (!bad && text.trim() !== show) props.onChange(text.trim() === "" ? undefined : n); }}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
      <span className="muted mono">{props.unit}</span>
    </span>
  );
}

const MATERIAL_HEADS: Head[] = [
  // Widths that fit a 1366 px laptop without sideways scrolling, the name getting the most room (N5.1).
  { id: "row", width: 40, ariaLabel: "Select", className: "idx" }, { id: "code", label: "Code", width: 104 }, { id: "name", label: "Name", min: 220 }, { id: "unit", label: "Unit", width: 56 },
  { id: "category", label: "Category", width: 100 }, { id: "spec", label: "Spec", width: 110 },
  { id: "overage", label: "Overage %", width: 80, title: "Default overage for BOM lines of this material" }, { id: "note", label: "Note", width: 90 },
  { id: "refs", label: "Recipe · Backups", width: 176, title: "Recipe: the material is made in-house from components (a buffer, a medium …). Backups: alternate materials." },
  { id: "status", label: "Status", width: 120, title: "In use, Under review, or Obsolete (the BOM asks to replace an obsolete material)" },
  { id: "bom", label: "Used", width: 56, title: "Places that use the material: click for Where used" }, { id: "menu", width: 52, ariaLabel: "More" },
];

/** A read-only sheet of rows as the Excel export has them, with an action on the first row of each material. */
function SheetTable(props: { header: string[]; rows: (string | number | undefined)[][]; widths: number[]; numeric: number[]; mono: number[]; label: string; action: (row: (string | number | undefined)[], i: number) => ReactNode }) {
  return (
    <div className="table-wrap">
      <table className="grid sheet-fixed" aria-label={props.label}>
        {/* the column widths of the Excel export, in characters */}
        <colgroup>{props.widths.map((w, j) => <col key={j} style={{ width: Math.round(w * 7.2 + 12) }} />)}<col style={{ width: 76 }} /></colgroup>
        <thead><tr>{props.header.map((h, j) => <th key={h} className={props.numeric.includes(j) ? "num" : undefined}>{h}</th>)}<th aria-label="Edit" /></tr></thead>
        <tbody>
          {props.rows.map((r, i) => (
            <tr key={i}>
              {r.map((v, j) => <td key={j} className={[props.numeric.includes(j) ? "num" : "", props.mono.includes(j) ? "mono" : ""].join(" ").trim() || undefined}>{typeof v === "number" ? v.toLocaleString("en-US", { maximumFractionDigits: 6 }) : v ?? ""}</td>)}
              <td>{props.action(r, i)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const RECIPE_SHEET = /^(recipes?|레시피|제조\s*레시피|조성)$/i;
const BACKUP_SHEET = /^(backups?|alternates?|대체\s*자재|백업\s*자재)$/i;

function ImportDialog(props: { fileName: string; plan: ImportPlan; refs: RefsPlan | null; onCancel: () => void; onApply: () => void }) {
  const { plan, refs } = props;
  const recipeChanges = refs?.recipes.filter((r) => r.changed).length ?? 0;
  const backupChanges = refs?.backups.filter((b) => b.changed).length ?? 0;
  const changes = plan.add.length + plan.update.length + recipeChanges + backupChanges;
  const nothing = changes === 0;
  return (
    <Dialog
      title={`Import materials · ${props.fileName}`}
      wide
      onClose={props.onCancel}
      actions={<>
        <button className="btn" onClick={props.onCancel}>Cancel</button>
        <button className="btn primary" onClick={props.onApply} disabled={nothing}>
          {nothing ? "Nothing to change" : `Apply ${changes} change(s)`}
        </button>
      </>}
    >
      <div className="toolbar">
        <span className="chip ok">New {plan.add.length}</span>
        <span className="chip">Updated {plan.update.length}</span>
        <span className="chip">Unchanged {plan.unchanged.length}</span>
        {plan.errors.length > 0 && <span className="chip err">Skipped {plan.errors.length}</span>}
        {refs && <span className="chip">Recipes {refs.recipes.length}{recipeChanges !== refs.recipes.length ? ` (${recipeChanges} changed)` : ""}</span>}
        {refs && <span className="chip">Backups {refs.backups.length}{backupChanges !== refs.backups.length ? ` (${backupChanges} changed)` : ""}</span>}
        {refs && refs.errors.length > 0 && <span className="chip err">Skipped {refs.errors.length} recipe/backup row(s)</span>}
      </div>
      {refs && refs.errors.length > 0 && (
        <div className="notice err">
          <ul className="issues">{refs.errors.slice(0, 20).map((e, i) => <li key={i}><span className="mono">{e.sheet}{e.row ? ` row ${e.row}` : ""}</span><span>{e.message}</span></li>)}</ul>
          {refs.errors.length > 20 && <p>and {refs.errors.length - 20} more</p>}
        </div>
      )}
      {refs && (recipeChanges > 0 || backupChanges > 0) && (
        <p style={{ fontSize: "var(--fs-sm)", margin: 0 }}>
          {recipeChanges > 0 && <>Recipes set for <span className="mono">{refs.recipes.filter((r) => r.changed).map((r) => r.code).join(", ")}</span>. </>}
          {backupChanges > 0 && <>Backups set for <span className="mono">{refs.backups.filter((b) => b.changed).map((b) => b.code).join(", ")}</span>. </>}
          A material listed on the Recipes or Backups sheet gets exactly the rows the sheet has.
        </p>
      )}
      {plan.errors.length > 0 && (
        <div className="notice err">
          <ul className="issues">{plan.errors.slice(0, 20).map((e, i) => <li key={i}><span className="mono">Row {e.row}</span><span>{e.message}</span></li>)}</ul>
          {plan.errors.length > 20 && <p>and {plan.errors.length - 20} more</p>}
        </div>
      )}
      {(plan.add.length > 0 || plan.update.length > 0) && (
        <div className="table-wrap panel" style={{ maxHeight: 360 }}>
          <table className="grid">
            <thead><tr><th>Row</th><th>Action</th><th>Code</th><th>Name</th><th>Unit</th><th>Changes</th></tr></thead>
            <tbody>
              {plan.add.map((r) => (
                <tr key={`a${r.row}`}><td className="idx">{r.row}</td><td><span className="chip ok">New</span></td><td className="mono">{r.code}</td><td>{r.name}</td><td className="mono">{r.unit}</td><td /></tr>
              ))}
              {plan.update.map((u) => (
                <tr key={`u${u.row.row}`}><td className="idx">{u.row.row}</td><td><span className="chip">Update</span></td><td className="mono">{u.row.code}</td><td>{u.row.name}</td><td className="mono">{u.row.unit}</td><td style={{ fontSize: "var(--fs-xs)", color: "var(--muted)" }}>{u.changes.join(", ")}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p style={{ fontSize: "var(--fs-sm)", color: "var(--muted)" }}>Rows whose code already exists update that material with the file's name, unit and category. Changing a unit changes how its BOM quantities are read.</p>
    </Dialog>
  );
}
