import { useEffect, useMemo, useState } from "react";
import { ScenariosDialog } from "./ScenariosDialog";
import { setScenarios } from "../mb/scenarios";
import { gridcraftAvailable } from "../mb/gridcraft";
import { recipeOf } from "../model/recipes";
import { HeadRow, useColumns, type Head } from "../ui/resize";
import { appliedRows } from "../link/check";
import {
  diffRows, flowValues, fmtQty, linkContext, linkSheet, materialTotals, MAX_HISTORY, pfdStreamIds, streamNames, streamRoute, streamUoCode,
  type DiffEntry, type MaterialTotal,
} from "../mb/model";
import { checkLinkSheet, LINK_SHEET, snapshotRows, toSnapshot, type LinkIssue, type LinkResult, type Rule } from "../mb/pcsLink";
import { newId } from "../model/ids";
import type { LabelMode, MbHistoryEntry, MbWorkbook, Project, Scenario } from "../model/types";
import { base64ToBytes, bytesToBase64, downloadBlob, pickFile, sha256Hex } from "../storage/files";
import { readSavedBy, readWorkbook, writeWorkbook, type WorkbookData } from "../xlsx/workbook";
import { GridCraftEditor } from "./GridCraftEditor";

type Confirm = (o: { title: string; body: string; confirmLabel: string; danger?: boolean }) => Promise<boolean>;

const RULES: Record<Rule, string> = {
  V1: "PCS_LINK sheet, headers and required cells",
  V2: "Stream ID is a stream on the PFD",
  V3: "Every PFD stream has a flow row",
  V4: "One flow row per stream",
  V5: "Values are numbers ≥ 0; formulas have saved results",
  V6: "MatCode is in the material list",
  V7: "Material unit matches the material list",
  V8: "Not counted from both MB and PFD links",
  ID: "Stream ID format",
};

const LABEL_MODES: { id: LabelMode; label: string }[] = [
  { id: "id+both", label: "ID, name and all scenario values" },
  { id: "id+active", label: "ID, name and the active scenario value" },
  { id: "id", label: "ID and name only" },
];

// Parsed workbooks by content hash, so switching tabs doesn't read the file again.
const parsed = new Map<string, Promise<WorkbookData>>();
const readCached = (sha: string, bytes: () => Uint8Array) => {
  let p = parsed.get(sha);
  if (!p) { p = readWorkbook(bytes()); parsed.set(sha, p); p.catch(() => parsed.delete(sha)); }
  return p;
};

/** SHA-256 where the browser allows it (https or localhost); a short FNV-1a hash elsewhere. */
async function hashOf(bytes: Uint8Array): Promise<string> {
  const sha = await sha256Hex(bytes);
  if (sha) return sha;
  let h = 0x811c9dc5;
  for (const b of bytes) { h ^= b; h = Math.imul(h, 0x01000193) >>> 0; }
  return `fnv1a-${h.toString(16).padStart(8, "0")}-${bytes.length}`;
}

const timeOf = (iso?: string) => (iso ? new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "");
const short = (sha: string) => sha.replace(/^fnv1a-/, "").slice(0, 10);

const USER_KEY = "pcs.userName";
const readUser = () => { try { return localStorage.getItem(USER_KEY) ?? ""; } catch { return ""; } };
const writeUser = (v: string) => { try { localStorage.setItem(USER_KEY, v); } catch { /* storage blocked: name stays for this visit */ } };

interface Check { sha: string; result: LinkResult; modified?: string }

export function MbView(props: {
  project: Project;
  update: (fn: (p: Project) => Project, label?: string) => void;
  confirm: Confirm;
  toast: (msg: string) => void;
}) {
  const { project, update, confirm, toast } = props;
  const mb = project.mb;
  const wb = mb.workbook;
  const [check, setCheck] = useState<Check | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [gc, setGc] = useState<{ name: string; bytes: Uint8Array } | null>(null);
  const [gcOk, setGcOk] = useState<boolean | null>(null);
  const [user, setUser] = useState(readUser);
  const [showSame, setShowSame] = useState(false);

  useEffect(() => { gridcraftAvailable().then(setGcOk); }, []);

  // Check the project's workbook whenever it, the PFD streams, the PFD links or the materials change.
  const ctx = useMemo(() => linkContext(project),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [project.materials, project.streams, project.uos, project.pfd, project.mb.scenarios]);
  useEffect(() => {
    if (!wb) { setCheck(null); setReadError(null); return; }
    let alive = true;
    readCached(wb.sha256, () => base64ToBytes(wb.dataBase64)).then(
      (data) => { if (alive) { setCheck({ sha: wb.sha256, result: checkLinkSheet(data, ctx), modified: data.modified }); setReadError(null); } },
      (e: Error) => { if (alive) { setCheck(null); setReadError(e.message); } },
    );
    return () => { alive = false; };
  }, [wb, ctx]);

  const result = check && wb && check.sha === wb.sha256 ? check.result : null;
  const diff = useMemo(() => (result ? diffRows(mb.current, snapshotRows(result), result.scenarios) : []), [result, mb.current]);
  const changes = diff.filter((d) => d.status !== "same").length;
  const applied = !!(wb && mb.current?.sha256 === wb.sha256 && changes === 0);

  // ---- workbook in, workbook out ------------------------------------------------------------
  const store = async (name: string, bytes: Uint8Array, source: MbWorkbook["source"], savedBy?: string) => {
    const sha = await hashOf(bytes);
    const rec: MbWorkbook = { name, dataBase64: bytesToBase64(bytes), sha256: sha, savedBy, source, updatedAt: new Date().toISOString() };
    update((p) => ({ ...p, mb: { ...p.mb, workbook: rec } }));
    return rec;
  };

  const upload = async () => {
    const f = await pickFile(".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    if (!f) return;
    const bytes = new Uint8Array(await f.arrayBuffer());
    try { await readWorkbook(bytes); } catch { toast(`${f.name} is not an .xlsx workbook that can be read.`); return; }
    const sha = await hashOf(bytes);
    if (wb?.sha256 === sha) { toast("This is the workbook the project already has."); return; }
    if (wb && !(await confirm({
      title: "Replace the MB workbook?",
      body: `The project keeps one MB workbook. ${f.name} replaces ${wb.name}. Values already applied stay on the PFD and in the BOM until you apply again.`,
      confirmLabel: "Replace",
    }))) return;
    await store(f.name, bytes, "file", await readSavedBy(bytes));
    toast(`${f.name} added. Its PCS_LINK sheet is checked below.`);
  };

  const download = () => {
    if (!wb) return;
    downloadBlob(new Blob([base64ToBytes(wb.dataBase64) as BlobPart], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), wb.name);
  };

  const linkSheetSpec = () => {
    const { header, rows } = linkSheet(project);
    return { name: LINK_SHEET, header, rows, widths: [16, 12, 8, ...mb.scenarios.map(() => 12), 36] };
  };
  const bytesOf = async (blob: Blob) => new Uint8Array(await blob.arrayBuffer());
  /** A new workbook: an empty MB sheet to calculate in, and PCS_LINK with the PFD's Stream IDs. */
  const starterBytes = async () => bytesOf(await writeWorkbook([
    { name: "MB", header: ["Mass balance"], rows: [["Calculate here in any layout (add sheets as you like)."], [`In ${LINK_SHEET}, point each value at a cell here, e.g. =MB!C5.`]], widths: [70] },
    linkSheetSpec(),
  ]));
  const downloadLinkSheet = async () => {
    downloadBlob(await writeWorkbook([linkSheetSpec()]), `${project.meta.name} ${LINK_SHEET}.xlsx`);
  };

  const editInGridCraft = async () => {
    if (wb) setGc({ name: wb.name, bytes: base64ToBytes(wb.dataBase64) });
    else setGc({ name: `${project.meta.name} MB.xlsx`, bytes: await starterBytes() });
  };

  const remove = async () => {
    if (!wb || !(await confirm({
      title: "Remove the MB workbook?",
      body: `${wb.name} is removed from the project. Values already applied stay until you clear them. Download it first if you have no other copy.`,
      confirmLabel: "Remove", danger: true,
    }))) return;
    update((p) => ({ ...p, mb: { ...p.mb, workbook: null } }));
  };

  // ---- apply ----------------------------------------------------------------------------------
  const apply = () => {
    if (!wb || !result?.ok) return;
    const now = new Date().toISOString();
    const snap = toSnapshot(result, {
      id: newId("mb"), source: wb.source ?? "file", fileName: wb.name, sha256: wb.sha256, savedBy: wb.savedBy,
      fileModifiedAt: check?.modified, importedAt: now, importedBy: user.trim() || undefined,
    });
    const entry: MbHistoryEntry = {
      id: snap.id, source: snap.source, fileName: wb.name, sha256: wb.sha256, savedBy: wb.savedBy,
      importedAt: now, importedBy: snap.importedBy, rowCount: snap.rows.length,
    };
    update((p) => ({ ...p, mb: { ...p.mb, current: snap, history: [entry, ...p.mb.history].slice(0, MAX_HISTORY) } }));
    toast(`Applied ${snap.rows.length} rows: PFD labels and BOM quantities are updated.`);
  };

  const clearApplied = async () => {
    if (!(await confirm({ title: "Clear applied values?", body: "PFD labels lose their values and the BOM loses its MB quantities. The workbook and the history stay.", confirmLabel: "Clear", danger: true }))) return;
    update((p) => ({ ...p, mb: { ...p.mb, current: null } }));
  };

  const setLabelMode = (labelMode: LabelMode) => update((p) => ({ ...p, settings: { ...p.settings, labelMode } }));
  const setActive = (activeScenario: string) => update((p) => ({ ...p, mb: { ...p.mb, activeScenario } }));
  const [scenOpen, setScenOpen] = useState(false);

  const totals = useMemo(() => materialTotals(mb.current, (id) => streamUoCode(project, id)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mb.current, project.streams, project.uos]);
  const names = useMemo(() => streamNames(project), [project.pfd]); // eslint-disable-line react-hooks/exhaustive-deps

  const exportApplied = async () => {
    const cur = mb.current;
    if (!cur) return;
    const scen = mb.scenarios.filter((s) => cur.scenarios.includes(s.id));
    const flows = flowValues(cur);
    const blob = await writeWorkbook([
      {
        name: "Streams",
        header: ["StreamID", "Name", "Route", "Unit", ...scen.map((s) => s.name), "Note"],
        rows: [...flows].map(([id, f]) => [id, names.get(id) ?? "", streamRoute(project, id), f.unit, ...scen.map((s) => f.values[s.id] ?? null), f.note ?? ""]),
        widths: [16, 26, 14, 8, ...scen.map(() => 12), 30],
      },
      {
        name: "Materials by UO",
        header: ["UO", "MatCode", "Material", "Unit", ...scen.map((s) => s.name), "Streams"],
        rows: totals.map((t) => [t.uo, t.matCode, project.materials.find((m) => m.code === t.matCode)?.name ?? "", t.unit, ...scen.map((s) => t.values[s.id] ?? null), t.streams.join(", ")]),
        widths: [10, 12, 30, 8, ...scen.map(() => 12), 30],
      },
    ]);
    downloadBlob(blob, `${project.meta.name} MB values.xlsx`);
  };

  const missingFlow = result?.issues.filter((i) => i.rule === "V3" && i.streamId).map((i) => i.streamId!) ?? [];
  const copyMissing = () => {
    const text = [["StreamID", "MatCode", "Unit", ...mb.scenarios.map((s) => s.column), "Note"].join("\t"),
      ...missingFlow.map((id) => [id, "", "", ...mb.scenarios.map(() => ""), names.get(id) ?? streamRoute(project, id)].join("\t"))].join("\n");
    navigator.clipboard?.writeText(text).then(() => toast(`${missingFlow.length} stream rows copied: paste them into PCS_LINK`), () => toast("Copying is blocked in this browser"));
  };

  const gcTitle = gcOk === false
    ? (import.meta.env.MODE === "singlefile"
      ? "GridCraft (about 21 MB) cannot be packed into this one-page preview. It opens inside the app on your PC (start-windows.cmd) and on GitHub Pages."
      : "GridCraft is not installed next to the app. On your PC, run start-windows.cmd again or 'npm run gridcraft'.")
    : undefined;

  return (
    <div className="page">
      <div className="page-inner">
        <div className="page-head">
          <div>
            <h1>Mass Balance</h1>
            <p>Your own MB workbook, with a sheet named <span className="mono">PCS_LINK</span> that lists values per Stream ID. The app reads only that sheet: flow rows go on the PFD labels, material rows go to the BOM.</p>
          </div>
        </div>

        {/* ---- workbook ---- */}
        <section className="panel panel-pad mb-card" aria-label="Workbook">
          {!wb ? (
            <div className="mb-empty">
              <strong>No MB workbook in this project yet</strong>
              <span>Write the mass balance right here in <b>GridCraft</b>, a free spreadsheet that runs inside this app (formulas, several sheets, opens and saves .xlsx), or upload one you made in Excel. Either way, a <span className="mono">{LINK_SHEET}</span> sheet lists the values per stream: headers <span className="mono">StreamID, MatCode, Unit, {mb.scenarios.map((s) => s.column).join(", ")}, Note</span>, one row per value (formulas are fine). A new GridCraft workbook starts with an empty <span className="mono">MB</span> sheet and a <span className="mono">{LINK_SHEET}</span> sheet with the PFD's Stream IDs filled in.</span>
              <div className="toolbar">
                <button className="btn primary" onClick={editInGridCraft} disabled={!gcOk} title={gcTitle}>New workbook in GridCraft</button>
                <button className="btn" onClick={upload}>Upload Excel workbook…</button>
                <button className="btn" onClick={downloadLinkSheet} disabled={!pfdStreamIds(project).length} title="A PCS_LINK sheet with the PFD's Stream IDs filled in, to copy into your workbook">Download {LINK_SHEET} sheet</button>
              </div>
              {gcOk === false && <span className="hint">{gcTitle}</span>}
            </div>
          ) : (
            <div className="mb-file">
              <div className="mb-file-main">
                <span className="mono mb-file-name">{wb.name}</span>
                <span className="chip">{wb.source === "gridcraft" ? "Saved in GridCraft" : "Uploaded"} {timeOf(wb.updatedAt)}</span>
                {wb.savedBy && <span className="chip" title="Application that last saved the file">Saved by {wb.savedBy}</span>}
                <span className="chip mono" title={`SHA-256 ${wb.sha256}`}>{short(wb.sha256)}</span>
                {applied ? <span className="chip ok">Applied</span> : mb.current ? <span className="chip warn">Not applied yet</span> : <span className="chip warn">Never applied</span>}
              </div>
              <div className="toolbar">
                <button className="btn primary" onClick={editInGridCraft} disabled={!gcOk} title={gcTitle}>Edit in GridCraft</button>
                <button className="btn" onClick={download}>Download</button>
                <button className="btn" onClick={upload}>Replace…</button>
                <button className="btn" onClick={downloadLinkSheet} disabled={!pfdStreamIds(project).length}>Download {LINK_SHEET} sheet</button>
                <button className="btn ghost danger" onClick={remove}>Remove</button>
              </div>
              {gcOk === false && <span className="hint">{gcTitle} To edit in Excel: Download, edit and save, then Replace.</span>}
            </div>
          )}
        </section>

        {/* ---- check and apply ---- */}
        {wb && (
          <section className="panel" aria-label="Check">
            <div className="section-head">
              <h2>Check of {LINK_SHEET}</h2>
              {result && (
                <div className="toolbar">
                  <span className={`chip ${result.summary.errors ? "err" : "ok"}`}>{result.summary.errors} error{result.summary.errors === 1 ? "" : "s"}</span>
                  <span className={`chip ${result.summary.warnings ? "warn" : ""}`}>{result.summary.warnings} warning{result.summary.warnings === 1 ? "" : "s"}</span>
                  <span className="chip">{result.summary.flowRows} flow rows · {result.summary.materialRows} material rows</span>
                </div>
              )}
              <span className="spacer" />
              {result && (
                <button className="btn primary" onClick={apply} disabled={!result.ok || applied}
                  title={!result.ok ? "Fix the errors first" : applied ? "These values are applied" : undefined}>
                  {applied ? "Applied" : "Apply to PFD and BOM"}
                </button>
              )}
            </div>
            <div className="panel-pad mb-check">
              {readError && <div className="notice err">The workbook could not be read: {readError}</div>}
              {!result && !readError && <p className="hint">Reading the workbook…</p>}
              {result && result.issues.length > 0 && (
                <>
                  {!result.ok && <div className="notice err">Nothing is applied while there are errors. Fix them in the workbook (Edit in GridCraft, or Download → Excel → Replace) and the check runs again.</div>}
                  <IssueTable issues={result.issues} />
                  {missingFlow.length > 0 && (
                    <div className="toolbar">
                      <button className="btn small" onClick={copyMissing}>Copy rows for the {missingFlow.length} stream{missingFlow.length > 1 ? "s" : ""} without values</button>
                      <span className="hint">Paste them into {LINK_SHEET} and fill in Unit and values.</span>
                    </div>
                  )}
                </>
              )}
              {result && result.issues.length === 0 && <p className="hint ok-text">No problems found.</p>}
              {result && !result.ok && result.rows.length > 0 && <p className="hint">The change preview appears once the errors are fixed.</p>}
              {result && result.ok && result.rows.length > 0 && (
                <DiffTable diff={diff} scenarios={mb.scenarios.filter((s) => result.scenarios.includes(s.id))} names={names} showSame={showSame} setShowSame={setShowSame} hasApplied={!!mb.current} />
              )}
            </div>
          </section>
        )}

        {/* ---- applied values ---- */}
        <section className="panel" aria-label="Applied values">
          <div className="section-head">
            <h2>Applied values</h2>
            {mb.current && <span className="hint">From {mb.current.fileName} · {timeOf(mb.current.importedAt)}{mb.current.importedBy ? ` · ${mb.current.importedBy}` : ""}</span>}
            <span className="spacer" />
            {mb.current && <button className="btn small" onClick={exportApplied}>Export to Excel</button>}
            {mb.current && <button className="btn small ghost danger" onClick={clearApplied}>Clear</button>}
          </div>
          <div className="panel-pad mb-applied">
            <div className="toolbar mb-labels">
              <label className="inline-field">
                <span>PFD labels show</span>
                <select className="search" value={project.settings.labelMode} onChange={(e) => setLabelMode(e.target.value as LabelMode)} aria-label="PFD labels show">
                  {LABEL_MODES.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                </select>
              </label>
              <button className="btn small" onClick={() => setScenOpen(true)} title="The value columns of PCS_LINK: add a scenario (e.g. a clinical batch), rename one, change its column">
                Scenarios ({mb.scenarios.length})…
              </button>
              {project.settings.labelMode === "id+active" && (
                <label className="inline-field">
                  <span>Active scenario</span>
                  <select className="search" value={mb.activeScenario} onChange={(e) => setActive(e.target.value)} aria-label="Active scenario">
                    {mb.scenarios.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </label>
              )}
            </div>
            {!mb.current ? (
              <p className="hint">Nothing applied yet. Values appear here, on the PFD labels and in the BOM after you apply a checked workbook.</p>
            ) : (
              <>
                <h3>Streams</h3>
                <StreamValues project={project} names={names} />
                <h3>Materials per unit operation <span className="hint">(what the BOM takes from the MB)</span></h3>
                <MaterialTotalsTable totals={totals} project={project} />
              </>
            )}
          </div>
        </section>

        {/* ---- history ---- */}
        <section className="panel" aria-label="History">
          <div className="section-head">
            <h2>History</h2>
            <span className="spacer" />
            <label className="inline-field">
              <span>Your name</span>
              <input className="search" value={user} placeholder="for history and GridCraft notes" onChange={(e) => { setUser(e.target.value); writeUser(e.target.value); }} aria-label="Your name" />
            </label>
          </div>
          <div className="panel-pad">
            {mb.history.length === 0 ? <p className="hint">Every apply is recorded here: when, which file, saved by which application, by whom, and the file's SHA-256.</p> : (
              <div className="table-wrap">
                <table className="grid">
                  <thead><tr><th>Applied</th><th>File</th><th>From</th><th>Saved by</th><th>Applied by</th><th>Rows</th><th>SHA-256</th></tr></thead>
                  <tbody>
                    {mb.history.map((h) => (
                      <tr key={h.id} className={h.id === mb.current?.id ? "row-current" : ""}>
                        <td>{timeOf(h.importedAt)}{h.id === mb.current?.id && <span className="chip ok" style={{ marginLeft: 6 }}>current</span>}</td>
                        <td className="mono">{h.fileName}{h.note && <div className="hint" style={{ fontFamily: "var(--font)" }}>{h.note}</div>}</td>
                        <td>{h.source === "gridcraft" ? "GridCraft" : h.source === "app" ? "This app" : "File"}</td>
                        <td>{h.savedBy ?? ""}</td>
                        <td>{h.importedBy ?? ""}</td>
                        <td className="num">{h.rowCount}</td>
                        <td className="mono" title={h.sha256}>{h.sha256 ? short(h.sha256) : ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>
      </div>

      {gc && (
        <GridCraftEditor
          name={gc.name}
          bytes={gc.bytes}
          author={user}
          check={result ? { errors: result.summary.errors, warnings: result.summary.warnings, applied } : null}
          onSaved={(name, bytes) => { void readSavedBy(bytes).then((by) => store(name, bytes, "gridcraft", by ?? "GridCraft")); }}
          onOtherFile={(name, bytes) => { downloadBlob(new Blob([bytes as BlobPart]), name); toast(`${name} downloaded`); }}
          onClose={() => setGc(null)}
          confirm={confirm}
        />
      )}
      {scenOpen && <ScenariosDialog scenarios={mb.scenarios} applied={mb.current?.scenarios ?? []} onCancel={() => setScenOpen(false)}
        onSave={(list) => { update((p) => setScenarios(p, list), "Scenarios"); setScenOpen(false); toast(`${list.length} scenario(s): ${list.map((x) => x.name.trim()).join(", ")}`); }} />}
    </div>
  );
}

function IssueTable({ issues }: { issues: LinkIssue[] }) {
  const sorted = [...issues].sort((a, b) => (a.level === b.level ? 0 : a.level === "error" ? -1 : 1) || (a.row ?? 0) - (b.row ?? 0));
  return (
    <div className="table-wrap issue-table">
      <table className="grid">
        <thead><tr><th style={{ width: 100 }}>Level</th><th style={{ width: 64 }}>Rule</th><th style={{ width: 96 }}>Cell</th><th>Problem</th></tr></thead>
        <tbody>
          {sorted.map((i, n) => (
            <tr key={n}>
              <td><span className={`chip ${i.level === "error" ? "err" : "warn"}`}>{i.level === "error" ? "Error" : "Warning"}</span></td>
              <td className="mono" title={RULES[i.rule]}>{i.rule}</td>
              <td className="mono">{i.row ? `${i.col ?? ""}${i.row}` : i.rule === "V3" ? "—" : "sheet"}</td>
              <td>{i.message}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DiffTable(props: { diff: DiffEntry[]; scenarios: Scenario[]; names: Map<string, string>; showSame: boolean; setShowSame: (v: boolean) => void; hasApplied: boolean }) {
  const { diff, scenarios } = props;
  const changed = diff.filter((d) => d.status !== "same");
  const rows = props.showSame ? diff : changed;
  const cell = (d: DiffEntry, s: string) => {
    const a = d.before?.[s] ?? null, b = d.after?.[s] ?? null;
    if (d.status === "changed" && fmtQty(a) !== fmtQty(b)) return <><span className="was">{fmtQty(a) || "–"}</span> → <strong>{fmtQty(b) || "–"}</strong></>;
    return fmtQty(d.status === "removed" ? a : b);
  };
  const STATUS = { added: "New", changed: "Changed", removed: "Removed", same: "Same" } as const;
  const heads: Head[] = [{ id: "stream", label: "Stream ID" }, { id: "name", label: "Name" }, { id: "mat", label: "MatCode" }, { id: "unit", label: "Unit" },
    ...scenarios.map((s): Head => ({ id: `v:${s.id}`, label: s.name, className: "num" })), { id: "status", label: "Status" }];
  const cols = useColumns("mb-diff", heads);
  return (
    <div className="mb-diff">
      <div className="toolbar">
        <h3 style={{ margin: 0 }}>{props.hasApplied ? "Changes against the applied values" : "Values to apply"}</h3>
        <span className="chip">{changed.length} change{changed.length === 1 ? "" : "s"}</span>
        <label className="check"><input type="checkbox" checked={props.showSame} onChange={(e) => props.setShowSame(e.target.checked)} /> <span>Show unchanged rows</span></label>
      </div>
      {rows.length === 0 ? <p className="hint">No changes: the workbook has the values that are applied.</p> : (
        <div className="table-wrap">
          <table className="grid" ref={cols.tableRef} style={cols.tableStyle}>
            {cols.colgroup}
            <HeadRow heads={heads} cols={cols} />
            <tbody>
              {rows.map((d) => (
                <tr key={d.key} className={`diff-${d.status}`}>
                  <td className="mono">{d.streamId}</td>
                  <td>{props.names.get(d.streamId) ?? ""}</td>
                  <td className="mono">{d.matCode ?? <span className="hint">flow</span>}</td>
                  <td className="mono">{d.beforeUnit ? <><span className="was">{d.beforeUnit}</span> → {d.unit}</> : d.unit}</td>
                  {scenarios.map((s) => <td key={s.id} className="num">{cell(d, s.id)}</td>)}
                  <td><span className={`chip ${d.status === "added" ? "ok" : d.status === "changed" ? "warn" : d.status === "removed" ? "err" : ""}`}>{STATUS[d.status]}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function StreamValues({ project, names }: { project: Project; names: Map<string, string> }) {
  const cur = project.mb.current!;
  const scen = project.mb.scenarios.filter((s) => cur.scenarios.includes(s.id));
  const flows = flowValues(cur);
  const onPfd = pfdStreamIds(project);
  const ids = [...onPfd, ...[...flows.keys()].filter((id) => !onPfd.includes(id))];
  const heads: Head[] = [{ id: "stream", label: "Stream ID" }, { id: "name", label: "Name" }, { id: "route", label: "Route" }, { id: "unit", label: "Unit" },
    ...scen.map((s): Head => ({ id: `v:${s.id}`, label: s.name, className: "num" })), { id: "note", label: "Note" }];
  const cols = useColumns("mb-streams", heads);
  return (
    <div className="table-wrap">
      <table className="grid" ref={cols.tableRef} style={cols.tableStyle}>
        {cols.colgroup}
        <HeadRow heads={heads} cols={cols} />
        <tbody>
          {ids.map((id) => {
            const f = flows.get(id);
            const gone = !onPfd.includes(id);
            return (
              <tr key={id} className={!f || gone ? "row-muted" : ""}>
                <td className="mono">{id}</td>
                <td>{names.get(id) ?? ""}</td>
                <td>{gone ? <span className="chip warn">not on the PFD</span> : streamRoute(project, id)}</td>
                <td className="mono">{f?.unit ?? ""}</td>
                {scen.map((s) => <td key={s.id} className="num">{f ? fmtQty(f.values[s.id]) : ""}</td>)}
                <td>{f ? f.note ?? "" : <span className="hint">No flow row</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function MaterialTotalsTable({ totals, project }: { totals: MaterialTotal[]; project: Project }) {
  const cur = project.mb.current;
  const scen = project.mb.scenarios.filter((s) => cur?.scenarios.includes(s.id));
  const heads: Head[] = [{ id: "uo", label: "UO" }, { id: "mat", label: "MatCode" }, { id: "name", label: "Material" }, { id: "unit", label: "Unit" },
    ...scen.map((s): Head => ({ id: `v:${s.id}`, label: s.name, className: "num" })), { id: "streams", label: "From streams" }, { id: "bom", label: "In the BOM" }];
  const cols = useColumns("mb-materials", heads);
  if (!cur || totals.length === 0) return <p className="hint">No material rows in the applied mass balance.</p>;
  const order = (code: string) => project.uos.find((u) => u.code === code)?.order ?? 9999;
  const sorted = [...totals].sort((a, b) => order(a.uo) - order(b.uo) || a.matCode.localeCompare(b.matCode));
  const status = appliedRows(project);
  const inBom = (t: MaterialTotal) => {
    const bad = status.filter((a) => a.row.matCode === t.matCode && t.streams.includes(a.row.streamId) && a.status !== "ok");
    if (!bad.length) {
      const m = project.materials.find((x) => x.code === t.matCode);
      const r = recipeOf(m);
      if (!r) return <span className="chip ok">Counted</span>;
      const comps = r.components.map((c) => project.materials.find((x) => x.id === c.materialId)?.code).filter(Boolean);
      return <span className="chip ok" title={`Made in-house: the BOM counts its components (${comps.join(", ")}) per its recipe`}>Counted · recipe: {comps.length} component{comps.length === 1 ? "" : "s"}</span>;
    }
    const why = { "stream-gone": "stream not on the PFD", "unknown-material": "not in the material list", "unit-mismatch": "unit differs from the material list", ok: "" };
    return <span className="chip warn" title={bad.map((b) => `${b.row.streamId}: ${why[b.status]}`).join("\n")}>Left out: {[...new Set(bad.map((b) => why[b.status]))].join(", ")}</span>;
  };
  return (
    <div className="table-wrap">
      <table className="grid" ref={cols.tableRef} style={cols.tableStyle}>
        {cols.colgroup}
        <HeadRow heads={heads} cols={cols} />
        <tbody>
          {sorted.map((t) => (
            <tr key={`${t.uo}/${t.matCode}`}>
              <td className="mono">{t.uo}</td>
              <td className="mono">{t.matCode}</td>
              <td>{project.materials.find((m) => m.code === t.matCode)?.name ?? <span className="hint">not in the material list</span>}</td>
              <td className="mono">{t.unit}</td>
              {scen.map((s) => <td key={s.id} className="num">{fmtQty(t.values[s.id])}</td>)}
              <td className="mono" style={{ fontSize: "var(--fs-xs)" }}>{t.streams.join(", ")}</td>
              <td>{inBom(t)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
