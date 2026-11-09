import { useEffect, useMemo, useState } from "react";
import { PageIntro } from "../ui/PageIntro";
import { RibbonButton, RibbonGroup, RibbonStack, ScreenRibbon } from "../ui/Ribbon";
import { addManualLine, batchesFor, computeBom, removeLine, setLine, type Values, type BomBackup, type BomPart, type BomResult, type BomRow, type BomTotal, type BomUo } from "../bom/model";
import { fmtQty } from "../mb/model";
import { batchSize, componentText, recipeOf, withBackups } from "../model/recipes";
import type { Material, Project, QtySource, Scenario } from "../model/types";
import { workbookNotApplied, type Area } from "../link/check";
import { downloadBlob } from "../storage/files";
import { writeWorkbook } from "../xlsx/workbook";
import { BackupsDialog } from "./MaterialRefs";
import { HeadRow, useColumns, type Head } from "../ui/resize";
import { Workbook } from "../ui/Workbook";
import { addRevision, changesByLine, compareBom, deleteRevision, latestRevision, makeRevision, type Change, type Comparison } from "../bom/revisions";
import { CompareDialog, RevisionsDialog, SaveRevisionDialog, beforeAfter, comparisonSheets, deltaText, nowState, when } from "./BomRevisions";
import { WhereUsedDialog, type GoPlace } from "./WhereUsed";
import { ReplaceDialog, runReplace, type Transform } from "./ReplaceMaterial";

/** Per-viewer conveniences, remembered in this browser only. */
const store = {
  get: (k: string) => { try { return localStorage.getItem("pcs.bom." + k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem("pcs.bom." + k, v); } catch { /* not remembered */ } },
};
interface Filter { q: string; cat: string; attn: boolean; manual: boolean; changed: boolean }
const NO_FILTER: Filter = { q: "", cat: "", attn: false, manual: false, changed: false };
const isFiltered = (f: Filter) => !!(f.q.trim() || f.cat || f.attn || f.manual || f.changed);

type Confirm = (o: { title: string; body: string; confirmLabel: string; danger?: boolean }) => Promise<boolean>;
type Update = (fn: (p: Project) => Project) => void;

const SOURCE_LABEL: Record<QtySource, string> = { MB: "MB", PFD: "PFD", manual: "Manual" };

export function BomView(props: { project: Project; update: Update; confirm: Confirm; toast: (msg: string) => void; goTo?: (area: Area) => void; go?: (place: GoPlace) => void; transform?: Transform }) {
  const { project, update } = props;
  const bom = useMemo(() => computeBom(project),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [project.uos, project.materials, project.bom, project.mb, project.pfd, project.streams]);
  const lineCount = bom.uos.reduce((n, u) => n + u.rows.length, 0);
  const [backupsOf, setBackupsOf] = useState<Material | null>(null);
  const [usedOf, setUsedOf] = useState<string | null>(null);
  const [replacing, setReplacing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Revisions: the BOM marks what changed since one of them (the newest by default).
  const revisions = project.bom.revisions ?? [];
  const [baseId, setBaseId] = useState<string>(() => store.get("base") ?? "latest");
  const base = baseId === "none" ? null : (revisions.find((r) => r.id === baseId) ?? latestRevision(project));
  const cmp = useMemo(() => (base ? compareBom(base, nowState(bom)) : null), [base, bom]);
  const changes = useMemo(() => (cmp ? changesByLine(cmp) : null), [cmp]);
  const [dialog, setDialog] = useState<null | { kind: "save" } | { kind: "list" } | { kind: "compare"; cmp: Comparison }>(null);
  const chooseBase = (id: string) => { setBaseId(id); store.set("base", id); };

  // Search, filters and folded sections.
  const [filter, setFilterState] = useState<Filter>(() => { try { return { ...NO_FILTER, ...JSON.parse(store.get("filter") ?? "{}"), q: "" }; } catch { return NO_FILTER; } });
  const setFilter = (f: Filter) => { setFilterState(f); store.set("filter", JSON.stringify({ ...f, q: "" })); };
  const [folded, setFolded] = useState<Set<string>>(() => { try { return new Set(JSON.parse(store.get("folded") ?? "[]") as string[]); } catch { return new Set(); } });
  const fold = (next: Set<string>) => { setFolded(next); store.set("folded", JSON.stringify([...next])); };
  const categories = useMemo(() => [...new Set(project.materials.map((m) => m.category).filter((c): c is string => !!c))].sort(), [project.materials]);
  const q = filter.q.trim().toLowerCase();
  const hit = (m: Material) => !q || m.code.toLowerCase().includes(q) || m.name.toLowerCase().includes(q);
  const shows = (u: BomUo, r: BomRow) =>
    (!q || hit(r.material) || r.parts.some((x) => hit(x.material)))
    && (!filter.cat || r.material.category === filter.cat || r.parts.some((x) => x.material.category === filter.cat))
    && (!filter.attn || r.issues.length > 0)
    && (!filter.manual || r.line.qtySource === "manual")
    && (!filter.changed || !!changes?.has(`${u.uo.code}|${r.material.code}`));
  const filtered = isFiltered(filter);
  const shownCount = bom.uos.reduce((n, u) => n + u.rows.filter((r) => shows(u, r)).length, 0);
  useEffect(() => { if (filter.changed && !base) setFilter({ ...filter, changed: false }); }); // eslint-disable-line react-hooks/exhaustive-deps

  // Asked from elsewhere (Where used › Open in BOM): clear the filters, unfold the section, show the line.
  const [focusLine, setFocusLine] = useState<{ uo: string; code: string; n: number } | null>(null);
  useEffect(() => {
    const on = (e: Event) => {
      const { uo, code } = (e as CustomEvent<{ uo: string; code: string }>).detail;
      setFilterState(NO_FILTER);
      const u = bom.uos.find((x) => x.uo.code === uo);
      if (u && folded.has(u.uo.id)) { const n = new Set(folded); n.delete(u.uo.id); fold(n); }
      setFocusLine({ uo, code, n: Date.now() });
    };
    window.addEventListener("pcs:bom-focus", on);
    return () => window.removeEventListener("pcs:bom-focus", on);
  });
  useEffect(() => {
    if (!focusLine) return;
    const tr = document.querySelector(`tr[data-bom-line="${CSS.escape(`${focusLine.uo}|${focusLine.code}`)}"]`);
    tr?.scrollIntoView({ block: "center" });
    tr?.classList.add("flash");
    const t = setTimeout(() => tr?.classList.remove("flash"), 1700);
    return () => clearTimeout(t);
  }, [focusLine]);

  const exportExcel = async () => {
    const blob = await writeWorkbook([...bomSheets(bom, project, cmp ? { label: cmp.from, at: base!.createdAt, count: cmp.count } : null), ...(cmp ? comparisonSheets(cmp) : [])]);
    const date = new Date().toISOString().slice(0, 10);
    const unchanged = !!cmp && !cmp.count.added && !cmp.count.removed && !cmp.count.changed && !cmp.totals.some((c) => c.kind !== "same");
    const rev = unchanged ? ` ${cmp!.from}` : base ? ` after ${base.label}` : "";
    downloadBlob(blob, `${project.meta.name} BOM${rev} ${date}.xlsx`.replace(/[\\/:*?"<>|]/g, "-"));
  };

  // The sheets at the bottom: everything, one per unit operation, the totals (remembered in this browser).
  const [sheetPick, setSheetPick] = useState<string>(() => store.get("sheet") ?? "all");
  const pickSheet = (id: string) => { setSheetPick(id); store.set("sheet", id); };
  const sheet = sheetPick === "all" || sheetPick === "totals" || bom.uos.some((u) => `uo:${u.uo.id}` === sheetPick) ? sheetPick : "all";
  const showUo = (id: string) => sheet === "all" || sheet === `uo:${id}`;
  const showTotals = sheet === "all" || sheet === "totals";
  const totalCount = bom.totals.length + bom.prepared.length + bom.backupTotals.length;

  return (
    <div className="page wb-page">
      <div className="page-head">
        <div>
          <h1>BOM</h1>
          <PageIntro id="bom" lead="Material quantities per unit operation, for each scenario.">Every line takes its quantity from one source: the applied mass balance (<b>MB</b>), counts linked on PFD shapes (<b>PFD</b>), or a number entered here (<b>Manual</b>, with a reason). Quantity = source value × (1 + overage). A material made in-house (a buffer with a recipe) is followed by its components (<b>Recipe</b>); alternate materials are listed as <b>Backup</b> and kept out of the totals. The sheets at the bottom show all of it, one unit operation, or the totals.</PageIntro>
        </div>
      </div>
      <ScreenRibbon screen="bom">
        {lineCount > 0 && (
          <RibbonGroup label="Find and filter">
            <div className="rfields">
              <label className="rfield"><span>Find</span>
                <input className="search" type="search" value={filter.q} onChange={(e) => setFilter({ ...filter, q: e.target.value })} placeholder="Code or name (also recipe parts)" aria-label="Search the BOM" />
              </label>
              <label className="rfield"><span>Category</span>
                <select value={filter.cat} onChange={(e) => setFilter({ ...filter, cat: e.target.value })} aria-label="Category">
                  <option value="">All categories</option>
                  {categories.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>
            </div>
            <div className="rstack">
              <label className="rcheck"><input type="checkbox" checked={filter.attn} onChange={(e) => setFilter({ ...filter, attn: e.target.checked })} /> To check</label>
              <label className="rcheck"><input type="checkbox" checked={filter.manual} onChange={(e) => setFilter({ ...filter, manual: e.target.checked })} /> Manual lines</label>
              {base && <label className="rcheck"><input type="checkbox" checked={filter.changed} onChange={(e) => setFilter({ ...filter, changed: e.target.checked })} /> Changed since {base.label}</label>}
            </div>
            {filtered && <div className="rstack"><button className="rbtn" onClick={() => setFilter(NO_FILTER)} title="Show every line">Clear</button></div>}
          </RibbonGroup>
        )}
        <RibbonGroup label="Revisions">
          <RibbonStack>
            <RibbonButton icon="revisions" onClick={() => setDialog({ kind: "list" })} title="Saved revisions: compare any two" label={`Revisions (${revisions.length})`} />
            <RibbonButton icon="bookmark" onClick={() => setDialog({ kind: "save" })} disabled={!lineCount} title="Keep what the BOM says now, to see later what changed" label="Save revision…" />
          </RibbonStack>
          {lineCount > 0 && (
            <div className="rfields">
              <label className="rfield"><span>Changes since</span>
                <select value={base ? (baseId === "latest" || !revisions.some((r) => r.id === baseId) ? "latest" : base.id) : "none"} onChange={(e) => chooseBase(e.target.value)} aria-label="Changes since">
                  <option value="none">— (no marks)</option>
                  {revisions.length > 0 && <option value="latest">Newest revision ({latestRevision(project)!.label})</option>}
                  {[...revisions].reverse().map((r) => <option key={r.id} value={r.id}>{r.label} · {when(r.createdAt)}</option>)}
                </select>
              </label>
            </div>
          )}
        </RibbonGroup>
        {lineCount > 0 && sheet === "all" && (
          <RibbonGroup label="Outline">
            <div className="rstack">
              <RibbonButton icon="up" onClick={() => fold(new Set(bom.uos.map((u) => u.uo.id)))} title="Show only the unit operation bands" label="Fold all" />
              <RibbonButton icon="down" onClick={() => fold(new Set())} title="Show every line" label="Unfold all" />
            </div>
          </RibbonGroup>
        )}
        <RibbonGroup label="Export">
          <RibbonButton big primary icon="excel" onClick={exportExcel} disabled={!lineCount} title="The BOM of every scenario as an Excel workbook" label="Export to Excel" />
        </RibbonGroup>
      </ScreenRibbon>

      <Workbook
        bar={
          <div className="wb-bar">
            {!project.mb.current && (
              <div className="notice">No mass balance is applied yet. Materials from the MB appear here after you apply a workbook on the Mass Balance screen; PFD links and lines you add work already.</div>
            )}
            {workbookNotApplied(project) && (
              <div className="notice warn notice-row">
                <span>{project.mb.current ? "The Mass Balance workbook changed after its values were applied. The MB quantities here are the ones applied before." : "The Mass Balance workbook is not applied yet."}</span>
                {props.goTo && <button className="btn small primary" onClick={() => props.goTo!("mb")}>Review and apply</button>}
              </div>
            )}
            {bom.leftOutCount > 0 && (
              <div className="notice warn">
                {bom.leftOutCount} applied MB material value(s) are left out because they no longer match the PFD or the material list (a stream that is gone, a material that is not in the list, or another unit). The lines concerned say why. The BOM always follows the current PFD and material list.
              </div>
            )}
            {bom.orphans.length > 0 && (
              <div className="notice warn">These MB rows cannot become BOM lines (their material or unit operation is not there any more): {bom.orphans.join("; ")}</div>
            )}
            {lineCount > 0 && (
              <div className="bom-tools" aria-label="Find in the BOM" role="status">
                <span>{filtered ? `${shownCount} of ${lineCount} lines match the filter` : `${lineCount} lines`}</span>
                {filtered && <button className="linkish" onClick={() => setFilter(NO_FILTER)}>Clear the filter</button>}
                <span className="spacer" />
                {!revisions.length && <span className="hint">No revision yet: “Save revision…” keeps the BOM as it is now; later changes are marked against it.</span>}
                {cmp && (
                  <button className="linkish" onClick={() => setDialog({ kind: "compare", cmp })} title="See every change">
                    {cmp.count.added + cmp.count.removed + cmp.count.changed === 0 ? `No line changed since ${cmp.from}` : `${cmp.count.added} added · ${cmp.count.removed} removed · ${cmp.count.changed} changed since ${cmp.from}`}
                  </button>
                )}
              </div>
            )}
          </div>
        }
        tabs={[
          { id: "all", label: `All (${lineCount})`, title: "Every unit operation and the totals" },
          ...bom.uos.map((u) => {
            const issues = u.rows.reduce((n, r) => n + r.issues.length, 0);
            return { id: `uo:${u.uo.id}`, label: `${u.uo.code} (${u.rows.length})`, title: `${u.uo.code} · ${u.uo.name}${issues ? ` · ${issues} to check` : ""}`, ...(issues ? { dot: "warn" as const } : {}) };
          }),
          ...(totalCount ? [{ id: "totals", label: `Totals (${bom.totals.length})`, title: "What to buy, what is made in-house, backups" }] : []),
        ]}
        active={sheet}
        onPick={pickSheet}
        info={<>{lineCount} lines · {bom.uos.length} unit operations{bom.issueCount > 0 ? <> · <span className="warn-text">{bom.issueCount} to check</span></> : lineCount > 0 ? " · Complete" : ""}</>}
      >
        {bom.uos.length === 0 && (
          <div className="empty"><strong>No unit operations yet</strong><span>Draw unit operations on the PFD (Units tab). Their materials appear here.</span></div>
        )}
        {bom.uos.map((u) => {
          if (!showUo(u.uo.id)) return null;
          const rows = u.rows.filter((r) => shows(u, r));
          const removed = cmp ? cmp.lines.filter((c) => c.kind === "removed" && c.uo === u.uo.code && (!q || c.code.toLowerCase().includes(q) || c.name.toLowerCase().includes(q))) : [];
          if (filtered && !rows.length && !(filter.changed && removed.length)) return null;
          // A line that is still listed but not counted any more is marked on its own row, not shown twice.
          const gone = removed.filter((c) => !u.rows.some((r) => r.material.code === c.code));
          return <UoSection key={u.uo.id} u={u} rows={rows} removed={filter.attn || filter.manual || filter.cat ? [] : gone} base={base?.label ?? null} changes={changes}
            folded={sheet === "all" && folded.has(u.uo.id)} onFold={() => { const n = new Set(folded); if (n.has(u.uo.id)) n.delete(u.uo.id); else n.add(u.uo.id); fold(n); }}
            bom={bom} project={project} update={update} confirm={props.confirm} onBackups={setBackupsOf} onWhereUsed={(m) => setUsedOf(m.id)} onReplace={props.transform ? (m) => setReplacing(m.id) : undefined} />;
        })}
        {filtered && shownCount === 0 && sheet !== "totals" && <div className="notice xl-empty">No line matches. <button className="linkish" onClick={() => setFilter(NO_FILTER)}>Clear the filters</button></div>}

        {showTotals && bom.totals.length > 0 && (
          <TotalsTable label="Totals" title="Totals per material" scen={bom.scenarios} list={bom.totals}
            hint={bom.prepared.length ? "What to buy, over all unit operations, with overage. Materials made in-house are replaced by their components (listed below); lines marked \"Not counted\" are left out." : "Over all unit operations, with overage. Lines marked \"Not counted\" are left out."} showVia={bom.totals.some((t) => t.via.length > 0)} />
        )}
        {showTotals && bom.prepared.length > 0 && (
          <TotalsTable label="Prepared in-house" title="Prepared in-house" scen={bom.scenarios} list={bom.prepared}
            hint="Made from their recipe (Materials screen), not bought: their components are counted in the totals above." showVia={bom.prepared.some((t) => t.via.length > 0)} />
        )}
        {showTotals && bom.backupTotals.length > 0 && <BackupTotalsTable bom={bom} />}
      </Workbook>
      {usedOf && <WhereUsedDialog project={project} materialId={usedOf} onClose={() => setUsedOf(null)} go={(place) => props.go?.(place)} onReplace={props.transform ? (id) => { setUsedOf(null); setReplacing(id); } : undefined} />}
      {replacing && props.transform && (
        <ReplaceDialog project={project} materialId={replacing} busy={busy} onClose={() => setReplacing(null)}
          onReplace={async (c) => {
            setBusy(true);
            try { props.toast(await runReplace(props.transform!, project, replacing, c)); setReplacing(null); }
            catch (e) { props.toast(`Could not replace: ${(e as Error).message}`); }
            finally { setBusy(false); }
          }} />
      )}
      {dialog?.kind === "save" && (
        <SaveRevisionDialog project={project} bom={bom} cmp={cmp} onClose={() => setDialog(null)} onSave={(meta) => {
          const r = makeRevision(project, bom, meta);
          update((p) => addRevision(p, r));
          chooseBase("latest");
          setDialog(null);
          props.toast(`Saved ${r.label}. Changes from now on are marked against it.`);
        }} />
      )}
      {dialog?.kind === "list" && (
        <RevisionsDialog project={project} bom={bom} onClose={() => setDialog(null)}
          onCompare={(fromId, toId) => {
            const a = revisions.find((r) => r.id === fromId)!;
            const b = toId === "Now" ? nowState(bom) : revisions.find((r) => r.id === toId)!;
            setDialog({ kind: "compare", cmp: compareBom(a, b) });
          }}
          onDelete={async (r) => {
            if (!(await props.confirm({ title: `Delete ${r.label}?`, body: `The saved state of the BOM from ${when(r.createdAt)} is removed from the project. The BOM itself does not change.`, confirmLabel: "Delete revision", danger: true }))) return;
            update((p) => deleteRevision(p, r.id));
            if (baseId === r.id) chooseBase("latest");
          }} />
      )}
      {dialog?.kind === "compare" && <CompareDialog project={project} cmp={dialog.cmp} onClose={() => setDialog(null)} />}
      {backupsOf && (
        <BackupsDialog material={backupsOf} materials={project.materials} onClose={() => setBackupsOf(null)}
          onSave={(backups) => {
            const id = backupsOf.id;
            update((p) => ({ ...p, materials: p.materials.map((m) => (m.id === id ? withBackups(m, backups) : m)) }));
            setBackupsOf(null);
            props.toast(`${backupsOf.code}: ${backups?.length ?? 0} backup material(s), shown wherever it is used`);
          }} />
      )}
    </div>
  );
}

function BackupTotalsTable({ bom }: { bom: BomResult }) {
  const heads: Head[] = [
    { id: "code", label: "Code" }, { id: "material", label: "Backup material" }, { id: "category", label: "Category" }, { id: "unit", label: "Unit" },
    ...bom.scenarios.map((s): Head => ({ id: `q:${s.id}`, label: s.name, className: "num" })),
    { id: "for", label: "Backup for" }, { id: "uos", label: "Unit operations" },
  ];
  const cols = useColumns("bom-backups", heads);
  return (
    <section className="panel" aria-label="Backup materials">
      <div className="section-head">
        <h2>Backup materials</h2>
        <span className="hint">Alternates for the materials above, with the quantity needed if each one replaces its primary. Not added to the totals.</span>
      </div>
      <div className="panel-pad">
        <div className="table-wrap">
          <table className="grid bom-table" ref={cols.tableRef} style={cols.tableStyle}>
            {cols.colgroup}
            <HeadRow heads={heads} cols={cols} />
            <tbody>
              {bom.backupTotals.map((t) => (
                <tr key={t.material.id}>
                  <td className="mono">{t.material.code}</td>
                  <td>{t.material.name}</td>
                  <td>{t.material.category ?? ""}</td>
                  <td className="mono">{t.material.unit}</td>
                  {bom.scenarios.map((s) => <td key={s.id} className="num">{t.incomplete[s.id] ? <span className="warn-text">≥ </span> : null}{fmtQty(t.qty[s.id]) || "–"}</td>)}
                  <td className="mono" style={{ fontSize: "var(--fs-xs)" }}>{t.forCodes.join(", ")}</td>
                  <td className="mono" style={{ fontSize: "var(--fs-xs)" }}>{t.uos.join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function TotalsTable(props: { label: string; title: string; hint: string; scen: Scenario[]; list: BomTotal[]; showVia: boolean }) {
  const { scen } = props;
  const showBatches = props.list.some((t) => t.batches);
  const showPacks = props.list.some((t) => t.packs);
  const heads: Head[] = [
    { id: "code", label: "Code" }, { id: "material", label: "Material" }, { id: "category", label: "Category" }, { id: "unit", label: "Unit" },
    ...scen.map((s): Head => ({ id: `q:${s.id}`, label: s.name, className: "num" })),
    ...(showPacks ? [{ id: "packs", label: "To order", title: "Packs to order (total ÷ pack size, rounded up) and what that comes to, per scenario; pack size is set on Materials" }] : []),
    ...(showBatches ? [{ id: "batches", label: "Batches", title: "Batches to prepare (rounded up per BOM line), per scenario" }] : []),
    ...(props.showVia ? [{ id: "via", label: "From recipes", title: "Part of the total that comes from recipes of materials made in-house" }] : []),
    { id: "uos", label: "Unit operations" },
  ];
  const cols = useColumns(`bom-totals:${props.label}`, heads);
  return (
    <section className="panel" aria-label={props.label}>
      <div className="section-head">
        <h2>{props.title}</h2>
        <span className="hint">{props.hint}</span>
      </div>
      <div className="panel-pad">
        <div className="table-wrap">
          <table className="grid bom-table" ref={cols.tableRef} style={cols.tableStyle}>
            {cols.colgroup}
            <HeadRow heads={heads} cols={cols} />
            <tbody>
              {props.list.map((t) => (
                <tr key={t.material.id}>
                  <td className="mono">{t.material.code}</td>
                  <td>{t.material.name}</td>
                  <td>{t.material.category ?? ""}</td>
                  <td className="mono">{t.material.unit}</td>
                  {scen.map((s) => (
                    <td key={s.id} className="num strong" title={t.incomplete[s.id] ? "Some lines have no quantity yet: the total is at least this" : undefined}>
                      {t.incomplete[s.id] ? <span className="warn-text">≥ </span> : null}{fmtQty(t.qty[s.id]) || "–"}
                    </td>
                  ))}
                  {showPacks && (
                    <td className="nowrap" style={{ fontSize: "var(--fs-xs)" }} title={t.material.supplier || t.material.partNo ? [t.material.supplier, t.material.partNo].filter(Boolean).join(" · ") : undefined}>
                      {t.packs ? <><span className="mono">{scen.map((s) => fmtQty(t.packs![s.id]) || "–").join(" / ")}</span> × {fmtQty(t.material.packSize!)} {t.material.unit}
                        <span className="muted"> = {scen.map((s) => (t.packs![s.id] != null ? fmtQty(Number((t.packs![s.id]! * t.material.packSize!).toPrecision(12))) : "–")).join(" / ")}</span></> : ""}
                    </td>
                  )}
                  {showBatches && <td className="mono nowrap">{t.batches ? `${scen.map((s) => fmtQty(t.batches![s.id]) || "–").join(" / ")} × ${fmtQty(batchSize(recipeOf(t.material)) ?? 0) || "1"} ${batchSize(recipeOf(t.material)) ? t.material.unit : "line"}` : ""}</td>}
                  {props.showVia && (
                    <td style={{ fontSize: "var(--fs-xs)" }}>
                      {t.fromRecipes ? <>{scen.map((s) => fmtQty(t.fromRecipes![s.id]) || "–").join(" / ")} <span className="muted">via <span className="mono">{t.via.join(", ")}</span></span></> : ""}
                    </td>
                  )}
                  <td className="mono" style={{ fontSize: "var(--fs-xs)" }}>{t.uos.join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function UoSection(props: {
  u: BomUo; rows: BomRow[]; removed: Change[]; base: string | null; changes: Map<string, Change> | null; folded: boolean; onFold: () => void;
  bom: BomResult; project: Project; update: Update; confirm: Confirm; onBackups: (m: Material) => void; onWhereUsed: (m: Material) => void; onReplace?: (m: Material) => void;
}) {
  const { u, bom, project, update } = props;
  const [pick, setPick] = useState("");
  const inUse = new Set(u.rows.map((r) => r.material.id));
  const available = project.materials.filter((m) => !inUse.has(m.id)).sort((a, b) => a.code.localeCompare(b.code));
  const issues = u.rows.reduce((n, r) => n + r.issues.length, 0);
  const scen = bom.scenarios;
  // The same column widths in every unit operation's table.
  const heads: Head[] = [
    // The material name gets the room (it wrapped to three lines on a 1366 px laptop before N5.1).
    { id: "code", label: "Code", width: 116 }, { id: "material", label: "Material", min: 200 }, { id: "unit", label: "Unit", width: 56 }, { id: "source", label: "Source", width: 190 },
    ...scen.map((s): Head => ({ id: `base:${s.id}`, label: s.name, width: 100, className: "num", title: "Value from the source, before overage" })),
    { id: "overage", label: "Overage %", width: 92, className: "num", title: "Empty: the material's default" },
    ...scen.map((s): Head => ({ id: `total:${s.id}`, label: `${s.name} total`, width: 112, className: "num" })),
    { id: "note", label: "Reason / note", width: 140 }, { id: "actions", width: 84, ariaLabel: "Actions" },
  ];
  const cols = useColumns("bom-lines", heads);

  return (
    <section className="panel" aria-label={`BOM ${u.uo.code}`}>
      <div className="section-head">
        <button className="fold-btn" onClick={props.onFold} aria-expanded={!props.folded} aria-label={`${props.folded ? "Unfold" : "Fold"} ${u.uo.code}`} title={props.folded ? "Show the lines" : "Hide the lines"}>{props.folded ? "▸" : "▾"}</button>
        <h2><span className="mono">{u.uo.code}</span> · {u.uo.name}</h2>
        {!u.onMap && <span className="chip warn" title="Its box was removed from the PFD process map">not on the process map</span>}
        <span className="chip">{props.rows.length === u.rows.length ? "" : `${props.rows.length} of `}{u.rows.length} line{u.rows.length === 1 ? "" : "s"}</span>
        {props.changes && (() => { const n = u.rows.filter((r) => props.changes!.has(`${u.uo.code}|${r.material.code}`)).length + props.removed.length; return n ? <span className="chip chg changed">{n} changed since {props.base}</span> : null; })()}
        {issues > 0 && <span className="chip warn">{issues} to check</span>}
        <span className="spacer" />
        <select className="search" value={pick} onChange={(e) => setPick(e.target.value)} aria-label={`Material to add to ${u.uo.code}`}>
          <option value="">Add a material…</option>
          {available.map((m) => <option key={m.id} value={m.id}>{m.code} · {m.name} ({m.unit})</option>)}
        </select>
        <button className="btn small" disabled={!pick} onClick={() => { update((p) => addManualLine(p, u.uo.id, pick)); setPick(""); }}>Add</button>
      </div>
      {props.folded ? null : u.rows.length === 0 && !props.removed.length ? (
        <p className="hint panel-pad" style={{ margin: 0 }}>No materials yet: apply a mass balance, link materials on PFD shapes, or add one here.</p>
      ) : (
        <div className="table-wrap">
          <table className="grid bom-table bom-lines" ref={cols.tableRef} style={cols.tableStyle}>
            {cols.colgroup}
            <HeadRow heads={heads} cols={cols} />
            <tbody>
              {props.rows.map((r) => <BomLineRow key={r.material.id} r={r} uo={u.uo.code} scen={scen} update={update} confirm={props.confirm} onBackups={props.onBackups} onWhereUsed={props.onWhereUsed} onReplace={props.onReplace}
                change={props.changes?.get(`${u.uo.code}|${r.material.code}`)} base={props.base} />)}
              {props.removed.map((c) => (
                <tr key={`gone-${c.code}`} className="bom-removed" title={`On ${props.base}, not on the BOM now`}>
                  <td className="mono">{c.code}</td>
                  <td><div>{c.name}</div><div className="bom-change removed">Removed since {props.base}</div></td>
                  <td className="mono">{c.unit}</td>
                  <td><span className="src-tag">{props.base}</span></td>
                  {scen.map((s) => <td key={s.id} />)}
                  <td />
                  {scen.map((s) => <td key={s.id} className="num was">{beforeAfter(c, s.id)}</td>)}
                  <td /><td />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function BomLineRow(props: { r: BomRow; uo: string; scen: Scenario[]; update: Update; confirm: Confirm; onBackups: (m: Material) => void; onWhereUsed: (m: Material) => void; onReplace?: (m: Material) => void; change?: Change; base: string | null }) {
  const { r, scen, update } = props;
  const set = (patch: Parameters<typeof setLine>[2]) => update((p) => setLine(p, r, patch));
  const manual = r.line.qtySource === "manual" && !r.line.excluded;
  const value = r.line.excluded ? "excluded" : r.line.qtySource;
  const onSource = (v: string) => {
    if (v === "excluded") set({ excluded: true });
    else set({ qtySource: v as QtySource, excluded: undefined });
  };
  const remove = async () => {
    const hasData = Object.values(r.line.manualQty).some((v) => v != null) || !!r.line.note;
    if (hasData && !(await props.confirm({ title: "Remove this line?", body: `${r.material.code} ${r.material.name} and its quantities are removed from this unit operation.`, confirmLabel: "Remove", danger: true }))) return;
    update((p) => removeLine(p, r.uoId, r.material.id));
  };
  const offer = (src: "MB" | "PFD") => {
    if (src === "MB") return r.mb ? scen.filter((s) => r.mb![s.id] != null).map((s) => `${s.name.charAt(0)} ${fmtQty(r.mb![s.id])}`).join(" · ") : "";
    return r.pfd != null ? fmtQty(r.pfd) : "";
  };
  const removeBackup = async (b: BomBackup) => {
    if (!(await props.confirm({ title: "Remove this backup?", body: `${b.material.code} is no longer a backup for ${b.primary.code} (in every unit operation). The material itself stays in the list.`, confirmLabel: "Remove backup", danger: true }))) return;
    update((p) => ({ ...p, materials: p.materials.map((m) => (m.id === b.primary.id ? withBackups(m, m.backups?.filter((x) => x.materialId !== b.material.id)) : m)) }));
  };
  return (
    <>
    <tr className={r.line.excluded ? "row-muted" : r.issues.length ? "row-attn" : ""} data-bom-line={`${props.uo}|${r.material.code}`}>
      <td className="mono"><button className="linkish code-link" onClick={() => props.onWhereUsed(r.material)} title={`Where is ${r.material.code} used?`}>{r.material.code}</button></td>
      <td>
        <div>
          {r.material.name}
          {r.parts.length > 0 && <span className="chip prep" title="Made in-house from its recipe: its components are listed below and counted in the totals">Prepared</span>}
          {!r.line.excluded && <BackupLink m={r.material} onClick={() => props.onBackups(r.material)} />}
        </div>
        {r.batches && <div className="bom-batches">{batchesNote(r.material, r.batches, scen)}</div>}
        {props.change && (
          <div className={`bom-change ${props.change.kind}`} title={props.change.kind === "changed" ? `${props.base} → now: ${scen.map((s) => `${s.name} ${beforeAfter(props.change!, s.id)}`).join("; ")}` : undefined}>
            {props.change.kind === "added" ? `New since ${props.base}` : props.change.kind === "removed" ? `Not counted since ${props.base} (was ${scen.map((s) => fmtQty(props.change!.before?.[s.id]) || "–").join(" / ")})` : `${deltaText(props.change, scen)} since ${props.base}`}{props.change.notes.length ? ` · ${props.change.notes.join("; ")}` : ""}
          </div>
        )}
        {r.issues.map((t, i) => <div key={i} className="bom-issue">{t}</div>)}
        {props.onReplace && !r.line.excluded && (() => {
          const old = [r.material, ...r.parts.filter((x) => !x.loop).map((x) => x.material)].filter((m, i, a) => m.status === "obsolete" && a.findIndex((y) => y.id === m.id) === i);
          return old.length ? <div className="bom-actions">{old.map((m) => <button key={m.id} className="btn small" onClick={() => props.onReplace!(m)}>Replace {m.code}…</button>)}</div> : null;
        })()}
        {r.notes.map((t, i) => <div key={`n${i}`} className="bom-note">{t}</div>)}
      </td>
      <td className="mono">{r.material.unit}</td>
      <td>
        <select className="cell-input" value={value} onChange={(e) => onSource(e.target.value)} aria-label={`Source of ${r.material.code}`}>
          <option value="MB" disabled={!r.mb && r.line.qtySource !== "MB"}>MB{offer("MB") ? ` (${offer("MB")})` : ""}</option>
          <option value="PFD" disabled={r.pfd == null && r.line.qtySource !== "PFD"}>PFD{offer("PFD") ? ` (${offer("PFD")})` : ""}</option>
          <option value="manual">Manual</option>
          <option value="excluded">Not counted</option>
        </select>
      </td>
      {scen.map((s) => (
        <td key={s.id} className="num">
          {manual ? (
            <NumberCell value={r.line.manualQty[s.id] ?? null} label={`${s.name} of ${r.material.code}`}
              onCommit={(v) => set({ manualQty: { ...r.line.manualQty, [s.id]: v } })} />
          ) : r.line.excluded ? "" : (fmtQty(r.base[s.id]) || "–")}
        </td>
      ))}
      <td className="num">
        <NumberCell value={r.line.overagePct ?? null} placeholder={String(r.material.overagePct ?? 0)} label={`Overage of ${r.material.code}`}
          onCommit={(v) => set({ overagePct: v ?? undefined })} />
      </td>
      {scen.map((s) => <td key={s.id} className="num strong" title={r.qty[s.id] != null ? String(r.qty[s.id]) : undefined}>{fmtQty(r.qty[s.id]) || (r.line.excluded ? "" : "–")}</td>)}
      <td>
        <TextCell value={r.line.note ?? ""} placeholder={manual ? "Reason (required)" : "Note"} label={`Note for ${r.material.code}`}
          onCommit={(v) => set({ note: v || undefined })} />
      </td>
      <td className="actions-cell">
        {r.manualOnly ? <button className="btn ghost small danger" onClick={remove}>Remove</button>
          : r.stored ? <button className="btn ghost small" onClick={() => update((p) => removeLine(p, r.uoId, r.material.id))} title={`Back to the automatic source (${SOURCE_LABEL[defaultLabel(r)]}) and default overage`}>Reset</button> : null}
      </td>
    </tr>
    {r.backups.map((b) => <BackupRow key={`b${b.material.id}`} b={b} depth={0} scen={scen} onRemove={() => removeBackup(b)} />)}
    {r.parts.map((part, i) => (
      <PartRows key={`p${i}`} part={part} scen={scen} onBackups={props.onBackups} onRemoveBackup={removeBackup} onWhereUsed={props.onWhereUsed} />
    ))}
    </>
  );
}

/** "1 EA per batch of 200 L × 10 batches", "1,000 L per 1,000 L, for whole batches" … */
function partText(part: BomPart): string {
  const t = componentText(part.recipeQty, part.material, part.per, part.parent, part.basis, part.batch);
  if (part.basis === "batch") return t;
  return recipeOf(part.parent)?.wholeBatches && part.batch ? `${t}, for whole batches` : t;
}

/** "Batches of 200 L: Sending 10 · Receiving 73" under a prepared material counted in batches. */
export function batchesNote(m: Material, b: Values, scen: Scenario[]): string {
  const r = recipeOf(m);
  const size = batchSize(r);
  const counts = scen.map((s) => `${s.name} ${b[s.id] == null ? "–" : fmtQty(b[s.id])}`).join(" · ");
  return `${size ? `Batches of ${fmtQty(size)} ${m.unit}` : "One batch per line"}${r?.wholeBatches && size ? ", made in full" : ""}: ${counts}`;
}

/** "+ Backup" next to a material name (shown on hover or focus); "Backups" when it has some. */
function BackupLink(props: { m: Material; onClick: () => void }) {
  const has = !!props.m.backups?.length;
  return (
    <button className={`linkish small-link${has ? " has" : ""}`} onClick={props.onClick} title={`Backup (alternate) materials of ${props.m.code}, wherever it is used`}>
      {has ? "Backups" : "+ Backup"}
    </button>
  );
}

/** A component of a prepared material (recipe explosion), and its backups. */
function PartRows(props: { part: BomPart; scen: Scenario[]; onBackups: (m: Material) => void; onRemoveBackup: (b: BomBackup) => void; onWhereUsed: (m: Material) => void }) {
  const { part, scen } = props;
  const own = part.loop ? null : batchesFor(part.material, part.qty, scen);
  return (
    <>
      <tr className={`bom-sub bom-part${part.loop ? " row-attn" : ""}`}>
        <td className="mono"><span className="sub-code" style={{ paddingLeft: (part.depth - 1) * 10 }}>↳ <button className="linkish code-link" onClick={() => props.onWhereUsed(part.material)} title={`Where is ${part.material.code} used?`}>{part.material.code}</button></span></td>
        <td>
          <div>{part.material.name}{!part.loop && <BackupLink m={part.material} onClick={() => props.onBackups(part.material)} />}</div>
          <div className="bom-note">Recipe of <span className="mono">{part.parent.code}</span>: {partText(part)}</div>
          {own && <div className="bom-batches">{batchesNote(part.material, own, scen)}</div>}
          {part.loop && <div className="bom-issue">{part.loop}</div>}
        </td>
        <td className="mono">{part.material.unit}</td>
        <td><span className="src-tag">Recipe</span></td>
        {scen.map((s) => <td key={s.id} className="num">{fmtQty(part.base[s.id]) || "–"}</td>)}
        <td className="num muted" title="The component's default overage (Materials screen)">{part.overagePct ? part.overagePct : ""}</td>
        {scen.map((s) => <td key={s.id} className="num strong">{part.loop ? "" : fmtQty(part.qty[s.id]) || "–"}</td>)}
        <td />
        <td />
      </tr>
      {part.backups.map((b) => <BackupRow key={`b${b.material.id}`} b={b} depth={part.depth} scen={scen} onRemove={() => props.onRemoveBackup(b)} />)}
    </>
  );
}

/** An alternate material under the line (or part) of its primary: its quantity is never in the totals. */
function BackupRow(props: { b: BomBackup; depth: number; scen: Scenario[]; onRemove: () => void }) {
  const { b, scen } = props;
  return (
    <tr className="bom-sub bom-backup">
      <td className="mono"><span className="sub-code" style={{ paddingLeft: props.depth * 12 }}>⇄ {b.material.code}</span></td>
      <td>
        <div>{b.material.name}</div>
        <div className="bom-note">Backup for <span className="mono">{b.primary.code}</span>{b.ratio !== 1 ? ` · ${fmtQty(b.ratio)} ${b.material.unit} per ${b.primary.unit}` : ""} · not in the totals</div>
        {b.unitHint && <div className="bom-issue">{b.unitHint}</div>}
      </td>
      <td className="mono">{b.material.unit}</td>
      <td><span className="src-tag backup">Backup</span></td>
      {scen.map((s) => <td key={s.id} />)}
      <td />
      {scen.map((s) => <td key={s.id} className="num backup-qty">{fmtQty(b.qty[s.id]) || "–"}</td>)}
      <td className="bom-note">{b.note ?? ""}</td>
      <td className="actions-cell"><button className="btn ghost small" onClick={props.onRemove} aria-label={`Remove backup ${b.material.code} for ${b.primary.code}`}>Remove</button></td>
    </tr>
  );
}

const defaultLabel = (r: BomRow): QtySource => (r.mb ? "MB" : r.pfd != null ? "PFD" : "manual");

/** A number cell that commits on Enter or when it loses focus; empty means "not set". */
function NumberCell(props: { value: number | null; onCommit: (v: number | null) => void; label: string; placeholder?: string }) {
  const show = props.value == null ? "" : String(props.value);
  const [text, setText] = useState(show);
  const [prev, setPrev] = useState(show);
  if (prev !== show) { setPrev(show); setText(show); }
  const parsed = text.trim() === "" ? null : Number(text.replace(/,/g, ""));
  const bad = parsed !== null && (!Number.isFinite(parsed) || parsed < 0);
  return (
    <input className={`cell-input num-input${bad ? " bad" : ""}`} value={text} placeholder={props.placeholder} aria-label={props.label} inputMode="decimal"
      onChange={(e) => setText(e.target.value)}
      onBlur={() => { if (bad) { setText(show); return; } if (parsed !== props.value) props.onCommit(parsed); }}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") { setText(show); } }} />
  );
}

function TextCell(props: { value: string; onCommit: (v: string) => void; label: string; placeholder?: string }) {
  const [text, setText] = useState(props.value);
  const [prev, setPrev] = useState(props.value);
  if (prev !== props.value) { setPrev(props.value); setText(props.value); }
  return (
    <input className="cell-input" value={text} placeholder={props.placeholder} aria-label={props.label}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => { if (text.trim() !== props.value) props.onCommit(text.trim()); }}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
  );
}

/**
 * The BOM as sheets: every line (with the components of prepared materials and the backups under it),
 * the totals to buy, what is prepared in-house, and the backup materials.
 */
export function bomSheets(bom: BomResult, project: Project, since: { label: string; at: string; count: { added: number; removed: number; changed: number } } | null = null) {
  const scen = bom.scenarios;
  const lines: (string | number | null)[][] = [];
  // Batches: per-scenario columns at the end of the BOM sheet (and of Prepared) when a recipe counts in batches.
  const anyBatches = bom.prepared.some((t) => t.batches);
  const backupLine = (u: BomUo, b: BomBackup): (string | number | null)[] => [
    u.uo.code, u.uo.name, `Backup for ${b.primary.code}`, b.material.code, b.material.name, b.material.category ?? "", b.material.unit,
    "Backup", ...scen.map(() => null), null, ...scen.map((s) => b.qty[s.id]), b.note ?? "", [b.ratio !== 1 ? `ratio ${b.ratio}` : "", "not in the totals", b.unitHint ?? ""].filter(Boolean).join("; "),
  ];
  for (const u of bom.uos) {
    for (const r of u.rows) {
      lines.push([
        u.uo.code, u.uo.name, r.parts.length ? "Line (prepared)" : "Line", r.material.code, r.material.name, r.material.category ?? "", r.material.unit,
        r.line.excluded ? "Not counted" : SOURCE_LABEL[r.line.qtySource],
        ...scen.map((s) => (r.line.excluded ? null : r.base[s.id])),
        r.overagePct,
        ...scen.map((s) => r.qty[s.id]),
        r.line.note ?? "",
        r.issues.join(" "),
        ...(anyBatches ? scen.map((s) => r.batches?.[s.id] ?? null) : []),
      ]);
      for (const b of r.backups) lines.push(backupLine(u, b));
      for (const part of r.parts) {
        lines.push([
          u.uo.code, u.uo.name, `${"  ".repeat(part.depth - 1)}Recipe of ${part.parent.code}`, part.material.code, part.material.name, part.material.category ?? "", part.material.unit,
          "Recipe", ...scen.map((s) => part.base[s.id]), part.overagePct, ...scen.map((s) => (part.loop ? null : part.qty[s.id])),
          partText(part), part.loop ?? "",
          ...(anyBatches ? scen.map((s) => (part.loop ? null : batchesFor(part.material, part.qty, scen)?.[s.id] ?? null)) : []),
        ]);
        for (const b of part.backups) lines.push(backupLine(u, b));
      }
    }
  }
  const anyPacks = bom.totals.some((t) => t.packs);
  const totalRows = (list: BomTotal[], batches = false, packs = false) => list.map((t) => [t.material.code, t.material.name, t.material.category ?? "", t.material.unit, ...scen.map((s) => t.qty[s.id]),
    scen.some((s) => t.incomplete[s.id]) ? "No: some lines have no quantity" : "Yes", t.uos.join(", "),
    ...scen.map((s) => t.fromRecipes?.[s.id] ?? null), t.via.join(", "),
    ...(batches ? [batchSize(recipeOf(t.material)), ...scen.map((s) => t.batches?.[s.id] ?? null)] : []),
    ...(packs ? [t.material.supplier ?? "", t.material.partNo ?? "", t.material.packSize ?? null, ...scen.map((s) => t.packs?.[s.id] ?? null),
      ...scen.map((s) => (t.packs?.[s.id] != null ? Number((t.packs[s.id]! * t.material.packSize!).toPrecision(12)) : null))] : [])]);
  const totalHeader = ["Code", "Material", "Category", "Unit", ...scen.map((s) => s.name), "Complete", "Unit operations", ...scen.map((s) => `${s.name} from recipes`), "Via recipes of"];
  const totalWidths = [11, 30, 12, 7, ...scen.map(() => 12), 14, 20, ...scen.map(() => 14), 18];
  const batchHeader = ["Batch size", ...scen.map((s) => `${s.name} batches`)];
  return [
    {
      name: "BOM",
      header: ["UO", "Unit operation", "Row", "Code", "Material", "Category", "Unit", "Source", ...scen.map((s) => `${s.name} (source)`), "Overage %", ...scen.map((s) => s.name), "Reason / note", "To check", ...(anyBatches ? scen.map((s) => `${s.name} batches`) : [])],
      rows: lines,
      widths: [8, 22, 20, 11, 30, 12, 7, 11, ...scen.map(() => 14), 10, ...scen.map(() => 12), 30, 40, ...(anyBatches ? scen.map(() => 13) : [])],
    },
    { name: "Totals", header: anyPacks ? [...totalHeader, "Supplier", "Part no.", "Pack size", ...scen.map((s) => `${s.name} packs`), ...scen.map((s) => `${s.name} to order`)] : totalHeader,
      rows: totalRows(bom.totals, false, anyPacks), widths: anyPacks ? [...totalWidths, 20, 14, 10, ...scen.map(() => 12), ...scen.map(() => 14)] : totalWidths },
    ...(bom.prepared.length ? [{ name: "Prepared", header: anyBatches ? [...totalHeader, ...batchHeader] : totalHeader, rows: totalRows(bom.prepared, anyBatches), widths: anyBatches ? [...totalWidths, 11, ...scen.map(() => 13)] : totalWidths }] : []),
    ...(bom.backupTotals.length ? [{
      name: "Backups",
      header: ["Code", "Backup material", "Category", "Unit", ...scen.map((s) => s.name), "Backup for", "Unit operations"],
      rows: bom.backupTotals.map((t) => [t.material.code, t.material.name, t.material.category ?? "", t.material.unit, ...scen.map((s) => t.qty[s.id]), t.forCodes.join(", "), t.uos.join(", ")]),
      widths: [11, 30, 12, 7, ...scen.map(() => 12), 18, 20],
    }] : []),
    {
      name: "About",
      header: ["Item", "Value"],
      rows: [
        ["Project", project.meta.name],
        ["Exported", new Date().toISOString().slice(0, 16).replace("T", " ")],
        ["Revisions", (project.bom.revisions ?? []).map((r) => `${r.label} (${r.createdAt.slice(0, 10)})`).join(", ") || "none saved"],
        ...(since ? [["Changes since", `${since.label} (${since.at.slice(0, 16).replace("T", " ")}): ${since.count.added} added, ${since.count.removed} removed, ${since.count.changed} changed lines; see the Changes sheets`]] : []),
        ["Mass balance", project.mb.current ? `${project.mb.current.fileName ?? ""} (applied ${project.mb.current.importedAt.slice(0, 16).replace("T", " ")})` : "none applied"],
        ["Quantity", "source value × (1 + overage / 100); MB = Σ PCS_LINK material rows of the UO, PFD = Σ counts linked on its shapes"],
        ["Recipe rows", "components of a material made in-house: line quantity × recipe quantity ÷ recipe amount, + the component's default overage; counted in Totals, the prepared material in Prepared"],
        ["Batches", "a recipe with a batch size: batches = ⌈line quantity ÷ batch size⌉ per line (rounded up); components per batch (a bag, a filter) = batches × their quantity; whole batches: proportional components for batches × batch size"],
        ["Backup rows", "alternate materials: primary quantity × ratio; summed in Backups, never in Totals"],
      ],
      widths: [16, 110],
    },
  ];
}
