import { useEffect, useMemo, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { PageIntro } from "../ui/PageIntro";
import { RibbonButton, RibbonGroup, RibbonStack, ScreenRibbon } from "../ui/Ribbon";
import { ScenariosDialog } from "./ScenariosDialog";
import { setScenarios } from "../mb/scenarios";
import { gridcraftAvailable } from "../mb/gridcraft";
import { recipeOf } from "../model/recipes";
import { HeadRow, columnLetter, sheetTableStyle, useColumns, type Head } from "../ui/resize";
import { Icon } from "../ui/icons";
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
    toast(`${f.name} added and its PCS_LINK sheet checked: see the bar and the Check sheet.`);
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

  // ---- the workbook view (N5.2): sheets at the bottom as in Excel, a formula bar, the status in one bar ----------------
  type Sheet = "streams" | "materials" | "check" | "changes" | "history";
  const [picked, setPicked] = useState<{ sheet: Sheet; sha?: string } | null>(null);
  // Until a sheet is picked (and again for a new workbook): problems first, then changes, then the values.
  const autoSheet: Sheet = wb && result && !result.ok ? "check" : wb && result && changes > 0 ? "changes" : wb && !mb.current ? "check" : "streams";
  const sheet: Sheet = picked && (picked.sha === undefined || picked.sha === wb?.sha256) ? picked.sheet : autoSheet;
  const pick = (s: Sheet) => setPicked({ sheet: s, sha: wb?.sha256 });
  const [cellInfo, setCellInfo] = useState<{ ref: string; text: string; formula?: string; source?: string } | null>(null);
  useEffect(() => setCellInfo(null), [sheet]);
  const onSheetClick = (e: ReactMouseEvent) => {
    if (e.shiftKey) return; // Shift+click extends the selection; the formula bar keeps the first cell, as in Excel
    const td = (e.target as HTMLElement).closest("td");
    const tr = td?.parentElement as HTMLTableRowElement | null;
    if (!td || !tr || td.classList.contains("rn") || tr.parentElement?.tagName !== "TBODY") return;
    const row = [...(tr.parentElement as HTMLTableSectionElement).rows].indexOf(tr) + 2;
    const hasRn = !!tr.querySelector(":scope > td.rn");
    setCellInfo({ ref: `${columnLetter(td.cellIndex - (hasRn ? 1 : 0))}${row}`, text: (td.innerText ?? "").trim(), formula: td.dataset.f, source: td.dataset.src });
  };

  // Where an applied value came from: its PCS_LINK cell, and that cell's formula when the applied file is the one here.
  const sameFile = !!(wb && mb.current && result && mb.current.sha256 === wb.sha256);
  const linkByRow = useMemo(() => new Map((sameFile && result ? result.rows : []).map((r) => [r.row, r])), [sameFile, result]);
  const sourceOf = (rows: { sourceRow?: number }[], scenario: string): { f?: string; src?: string } => {
    const nums = rows.map((r) => r.sourceRow).filter((n): n is number => typeof n === "number");
    if (!nums.length) return {};
    const col = sameFile ? result?.columns[scenario] : undefined;
    if (!col) return { src: `PCS_LINK row${nums.length > 1 ? "s" : ""} ${nums.join(", ")} of ${mb.current?.fileName ?? "the applied workbook"}` };
    const cells = nums.map((n) => `${LINK_SHEET}!${col}${n}`);
    if (nums.length === 1) return { f: linkByRow.get(nums[0])?.formulas[scenario] ?? undefined, src: `from ${cells[0]}` };
    return { f: `=${cells.join("+")}`, src: `sum of ${nums.length} PCS_LINK rows` };
  };

  const errs = result?.summary.errors ?? 0;
  const warns = result?.summary.warnings ?? 0;
  const bar: { kind: "ok" | "warn" | "err" | "info"; text: ReactNode; go?: { label: string; sheet: Sheet } } | null = !wb ? null
    : readError ? { kind: "err", text: <>The workbook could not be read: {readError}</> }
    : !result ? { kind: "info", text: "Reading the workbook…" }
    : !result.ok ? { kind: "err", text: <><b>{errs} error{errs === 1 ? "" : "s"} in {LINK_SHEET}:</b> nothing is applied until they are fixed in the workbook (Edit in GridCraft, or Download → Excel → Replace).</>, go: { label: "Show the problems", sheet: "check" } }
    : changes > 0 ? { kind: "warn", text: <><b>{mb.current ? `The workbook differs from the applied values: ${changes} change${changes === 1 ? "" : "s"}.` : `Not applied yet: ${changes} value${changes === 1 ? "" : "s"} to apply.`}</b> {mb.current ? "The PFD labels and the BOM keep the applied values until you apply." : "Check the values, then Apply to PFD and BOM."}</>, go: { label: "See the changes", sheet: "changes" } }
    : { kind: "ok", text: <><b>{LINK_SHEET} check: {errs} errors · {warns} warning{warns === 1 ? "" : "s"}</b> · {result.summary.flowRows} flow rows · {result.summary.materialRows} material rows{mb.current ? ` · Applied ${timeOf(mb.current.importedAt)} to the PFD labels and the BOM` : ""}</>, ...(warns ? { go: { label: "See the warnings", sheet: "check" as Sheet } } : {}) };

  const flowCount = mb.current ? flowValues(mb.current).size : 0;
  const tabs: { id: Sheet; label: string; dot?: "ok" | "warn" | "err" }[] = [
    { id: "streams", label: `Streams${mb.current ? ` (${flowCount})` : ""}` },
    { id: "materials", label: `Material totals${mb.current ? ` (${totals.length})` : ""}` },
    ...(wb ? [
      { id: "check" as Sheet, label: "Check", dot: (!result ? undefined : !result.ok ? "err" : warns ? "warn" : "ok") as "ok" | "warn" | "err" | undefined },
      { id: "changes" as Sheet, label: `Changes${result?.ok ? ` (${changes})` : ""}`, dot: (result?.ok && changes > 0 ? "warn" : undefined) as "warn" | undefined },
    ] : []),
    { id: "history", label: `History (${mb.history.length})` },
  ];

  return (
    <div className="page mb-page">
      <div className="page-head">
        <div>
          <h1>Mass Balance</h1>
          <PageIntro id="mb" lead={<>Your own MB workbook, with a sheet named <span className="mono">PCS_LINK</span> that lists values per Stream ID.</>}>The app reads only that sheet: flow rows go on the PFD labels, material rows go to the BOM. The sheets below show what the app read and applied; the workbook itself is edited in GridCraft or Excel.</PageIntro>
        </div>
      </div>

      {/* ---- workbook: the file and its state in one bar ---- */}
      <section className={`mb-card${wb ? ` mb-bar ${bar?.kind ?? "info"}` : " panel panel-pad"}`} aria-label="Workbook">
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
          <>
            <div className="mb-file-main">
              {/* The file's fingerprint and the saving application's full build string are in the tooltips. */}
              <span className="mono mb-file-name" title={`SHA-256 ${wb.sha256} (the file's fingerprint: the applied values record which file they came from)`}>{wb.name}</span>
              <span className="chip">{wb.source === "gridcraft" ? "Saved in GridCraft" : "Uploaded"} {timeOf(wb.updatedAt)}</span>
              {wb.savedBy && <span className="chip" title={`Application that last saved the file: ${wb.savedBy}`}>Saved by {appName(wb.savedBy)}</span>}
              {applied ? <span className="chip ok">Applied</span> : mb.current ? <span className="chip warn">Not applied yet</span> : <span className="chip warn">Never applied</span>}
            </div>
            {bar && (
              <div className="mb-bar-msg" role="status">
                <Icon name={bar.kind === "ok" ? "check" : bar.kind === "info" ? "sheet" : "warning"} />
                <span>{bar.text}</span>
                {bar.go && sheet !== bar.go.sheet && <button className="btn small" onClick={() => pick(bar.go!.sheet)}>{bar.go.label}</button>}
              </div>
            )}
            {gcOk === false && <span className="hint">{gcTitle} To edit in Excel: Download, edit and save, then Replace.</span>}
          </>
        )}
      </section>

      <ScreenRibbon screen="mb">
        {wb && (
          <RibbonGroup label={`Workbook · ${wb.name}`}>
            <RibbonButton big primary icon="gridcraft" onClick={editInGridCraft} disabled={!gcOk} title={gcTitle ?? "Open the workbook in GridCraft, a spreadsheet inside this app"} label="Edit in GridCraft" />
            <RibbonStack>
              <RibbonButton icon="replace" onClick={upload} title="Upload the workbook again (e.g. after editing it in Excel)" label="Replace…" />
              <RibbonButton icon="download" onClick={download} title="The workbook as an .xlsx file, to edit in Excel" label="Download" />
              <RibbonButton icon="sheet" onClick={downloadLinkSheet} disabled={!pfdStreamIds(project).length} title="A PCS_LINK sheet with the PFD's Stream IDs filled in, to copy into your workbook" label={`Download ${LINK_SHEET} sheet`} />
            </RibbonStack>
            <RibbonStack>
              <RibbonButton icon="delete" className="danger" onClick={remove} title="Take the workbook out of the project (the applied values stay until cleared)" label="Remove" />
              <RibbonButton icon="options" onClick={() => setScenOpen(true)} title="The value columns of PCS_LINK: add a scenario (e.g. a clinical batch), rename one, change its column" label={`Scenarios (${mb.scenarios.length})…`} />
            </RibbonStack>
          </RibbonGroup>
        )}
        <RibbonGroup label="Apply to PFD and BOM">
          {wb && result && (
            <RibbonButton big primary icon="check" onClick={apply} disabled={!result.ok || applied}
              title={!result.ok ? "Fix the errors first" : applied ? "These values are applied" : "Put the checked values on the PFD labels and into the BOM"}
              label={applied ? "Applied" : "Apply to PFD and BOM"} />
          )}
          <div className="rfields">
            <label className="rfield"><span>PFD labels</span>
              <select value={project.settings.labelMode} onChange={(e) => setLabelMode(e.target.value as LabelMode)} aria-label="PFD labels show">
                {LABEL_MODES.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
              </select>
            </label>
            {project.settings.labelMode === "id+active" && (
              <label className="rfield"><span>Active</span>
                <select value={mb.activeScenario} onChange={(e) => setActive(e.target.value)} aria-label="Active scenario">
                  {mb.scenarios.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </label>
            )}
            <label className="rfield" title="Written in the history with every apply, and into GridCraft notes"><span>Your name</span>
              <input value={user} placeholder="for history and notes" onChange={(e) => { setUser(e.target.value); writeUser(e.target.value); }} aria-label="Your name" />
            </label>
          </div>
          {!wb && (
            <RibbonStack>
              <RibbonButton icon="options" onClick={() => setScenOpen(true)} title="The value columns of PCS_LINK: add a scenario (e.g. a clinical batch), rename one, change its column" label={`Scenarios (${mb.scenarios.length})…`} />
            </RibbonStack>
          )}
        </RibbonGroup>
        {mb.current && (
          <RibbonGroup label="Applied values">
            <RibbonStack>
              <RibbonButton icon="excel" onClick={exportApplied} title="The applied values per stream and per unit operation as an Excel workbook" label="Export to Excel" />
              <RibbonButton icon="delete" className="danger" onClick={clearApplied} title="Take the applied values off the PFD labels and out of the BOM (the workbook and the history stay)" label="Clear" />
            </RibbonStack>
          </RibbonGroup>
        )}
      </ScreenRibbon>

      {/* ---- formula bar: the cell clicked in a sheet, and where its value came from ---- */}
      <div className="xl-fbar" aria-label="Formula bar">
        <span className="xl-namebox" aria-label="Cell">{cellInfo?.ref ?? ""}</span>
        <span className="xl-fx" aria-hidden="true">fx</span>
        <span className="xl-formula">
          {cellInfo ? <>{cellInfo.formula ?? cellInfo.text}{cellInfo.source && <span className="xl-src">{cellInfo.source}{cellInfo.formula ? ` · value ${cellInfo.text}` : ""}</span>}</>
            : <span className="xl-src">Click a cell to see where its value comes from in the workbook.</span>}
        </span>
      </div>

      {/* ---- the sheets ---- */}
      <div className="xl-sheet" onClick={onSheetClick}>
        <section aria-label="Streams" hidden={sheet !== "streams"}>
          {!mb.current ? <p className="hint xl-empty">Nothing applied yet. Values appear here, on the PFD labels and in the BOM after you apply a checked workbook.</p>
            : <StreamValues project={project} names={names} sourceOf={sourceOf} />}
        </section>
        <section aria-label="Material totals" hidden={sheet !== "materials"}>
          {!mb.current ? <p className="hint xl-empty">Nothing applied yet. Material rows of PCS_LINK appear here per unit operation: what the BOM takes from the MB.</p>
            : <MaterialTotalsTable totals={totals} project={project} sheet sourceOf={sourceOf} />}
        </section>
        {wb && (
          <section aria-label="Check" hidden={sheet !== "check"}>
            <div className="section-head">
              <h2>Check of {LINK_SHEET}</h2>
              {result && (
                <div className="toolbar">
                  <span className={`chip ${result.summary.errors ? "err" : "ok"}`}>{result.summary.errors} error{result.summary.errors === 1 ? "" : "s"}</span>
                  <span className={`chip ${result.summary.warnings ? "warn" : ""}`}>{result.summary.warnings} warning{result.summary.warnings === 1 ? "" : "s"}</span>
                  <span className="chip">{result.summary.flowRows} flow rows · {result.summary.materialRows} material rows</span>
                  {result.headerRow > 1 && <span className="chip" title={`Rows above row ${result.headerRow} are read as a title and left out`}>Headers in row {result.headerRow}</span>}
                </div>
              )}
            </div>
            <div className="mb-check">
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
              <ul className="plain mb-rules">{(Object.keys(RULES) as Rule[]).filter((r) => r !== "ID").map((r) => <li key={r}><span className="mono">{r}</span> {RULES[r]}</li>)}</ul>
            </div>
          </section>
        )}
        {wb && (
          <section aria-label="Changes" hidden={sheet !== "changes"}>
            {!result ? <p className="hint xl-empty">Reading the workbook…</p>
              : !result.ok ? <p className="hint xl-empty">The change preview appears once the errors are fixed (Check sheet).</p>
              : result.rows.length === 0 ? <p className="hint xl-empty">{LINK_SHEET} has no value rows yet.</p>
              : <DiffTable diff={diff} scenarios={mb.scenarios.filter((s) => result.scenarios.includes(s.id))} names={names} showSame={showSame} setShowSame={setShowSame} hasApplied={!!mb.current} />}
          </section>
        )}
        <section aria-label="History" hidden={sheet !== "history"}>
          {mb.history.length === 0 ? <p className="hint xl-empty">Every apply is recorded here: when, which file, saved by which application, by whom (Your name, in the ribbon), and the file's SHA-256.</p> : (
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
        </section>
      </div>

      <nav className="xl-tabs" role="tablist" aria-label="Sheets">
        {tabs.map((t) => (
          <button key={t.id} role="tab" aria-selected={sheet === t.id} className="xl-tab" onClick={() => pick(t.id)}>
            {t.dot && <span className={`dot ${t.dot}`} aria-hidden="true" />}{t.label}
          </button>
        ))}
        {wb && <button className="xl-tab ext" onClick={editInGridCraft} disabled={!gcOk} title="The workbook itself (every sheet, the formulas) opens in GridCraft">{wb.name} in GridCraft ↗</button>}
      </nav>

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

type SourceOf = (rows: { sourceRow?: number }[], scenario: string) => { f?: string; src?: string };
const cellData = (x: { f?: string; src?: string }) => ({ ...(x.f ? { "data-f": x.f } : {}), ...(x.src ? { "data-src": x.src } : {}) });

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
          <table className="grid xl" ref={cols.tableRef} style={sheetTableStyle(cols.tableStyle)}>
            <colgroup><col className="rn-col" /></colgroup>
            {cols.colgroup}
            <HeadRow heads={heads} cols={cols} sheet />
            <tbody>
              {rows.map((d, n) => (
                <tr key={d.key} className={`diff-${d.status}`}>
                  <td className="rn">{n + 2}</td>
                  <td className="mono">{d.streamId}</td>
                  <td>{props.names.get(d.streamId) ?? ""}</td>
                  <td className="mono">{d.matCode ?? <span className="hint">flow</span>}</td>
                  <td className="mono">{d.beforeUnit ? <><span className="was">{d.beforeUnit}</span> → {d.unit}</> : d.unit}</td>
                  {scenarios.map((s) => <td key={s.id} className={`num${d.status === "changed" && fmtQty(d.before?.[s.id] ?? null) !== fmtQty(d.after?.[s.id] ?? null) ? " chg" : d.status === "added" ? " chg" : ""}`}>{cell(d, s.id)}</td>)}
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

function StreamValues({ project, names, sourceOf }: { project: Project; names: Map<string, string>; sourceOf: SourceOf }) {
  const cur = project.mb.current!;
  const scen = project.mb.scenarios.filter((s) => cur.scenarios.includes(s.id));
  const flows = flowValues(cur);
  const onPfd = pfdStreamIds(project);
  const ids = [...onPfd, ...[...flows.keys()].filter((id) => !onPfd.includes(id))];
  const heads: Head[] = [{ id: "stream", label: "Stream ID" }, { id: "name", label: "Name" }, { id: "route", label: "Route" }, { id: "unit", label: "Unit" },
    ...scen.map((s): Head => ({ id: `v:${s.id}`, label: s.name, className: "num" })), { id: "note", label: "Note" }];
  const cols = useColumns("mb-streams", heads);
  const rowOf = (id: string) => cur.rows.filter((r) => r.streamId === id && !r.matCode).slice(0, 1);
  return (
    <div className="table-wrap">
      <table className="grid xl" ref={cols.tableRef} style={sheetTableStyle(cols.tableStyle)}>
        <colgroup><col className="rn-col" /></colgroup>
        {cols.colgroup}
        <HeadRow heads={heads} cols={cols} sheet />
        <tbody>
          {ids.map((id, n) => {
            const f = flows.get(id);
            const gone = !onPfd.includes(id);
            return (
              <tr key={id} className={!f || gone ? "row-muted" : ""}>
                <td className="rn">{n + 2}</td>
                <td className="mono">{id}</td>
                <td>{names.get(id) ?? ""}</td>
                <td>{gone ? <span className="chip warn">not on the PFD</span> : streamRoute(project, id)}</td>
                <td className="mono">{f?.unit ?? ""}</td>
                {scen.map((s) => <td key={s.id} className="num" {...(f ? cellData(sourceOf(rowOf(id), s.id)) : {})}>{f ? fmtQty(f.values[s.id]) : ""}</td>)}
                <td>{f ? f.note ?? "" : <span className="hint">No flow row</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function MaterialTotalsTable({ totals, project, sheet, sourceOf }: { totals: MaterialTotal[]; project: Project; sheet?: boolean; sourceOf?: SourceOf }) {
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
  const rowsOf = (t: MaterialTotal) => cur.rows.filter((r) => r.matCode === t.matCode && t.streams.includes(r.streamId));
  return (
    <div className="table-wrap">
      <table className={`grid${sheet ? " xl" : ""}`} ref={cols.tableRef} style={sheet ? sheetTableStyle(cols.tableStyle) : cols.tableStyle}>
        {sheet && <colgroup><col className="rn-col" /></colgroup>}
        {cols.colgroup}
        <HeadRow heads={heads} cols={cols} sheet={sheet} />
        <tbody>
          {sorted.map((t, n) => (
            <tr key={`${t.uo}/${t.matCode}`}>
              {sheet && <td className="rn">{n + 2}</td>}
              <td className="mono">{t.uo}</td>
              <td className="mono">{t.matCode}</td>
              <td>{project.materials.find((m) => m.code === t.matCode)?.name ?? <span className="hint">not in the material list</span>}</td>
              <td className="mono">{t.unit}</td>
              {scen.map((s) => <td key={s.id} className="num" {...(sourceOf ? cellData(sourceOf(rowsOf(t), s.id)) : {})}>{fmtQty(t.values[s.id])}</td>)}
              <td className="mono" style={{ fontSize: "var(--fs-xs)" }}>{t.streams.join(", ")}</td>
              <td>{inBom(t)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** "LibreOffice/24.2.7.2$Linux_X86_64 LibreOffice_project/…" → "LibreOffice"; "Microsoft Excel" stays as it is. */
function appName(savedBy: string): string {
  const name = savedBy.split(/[/$]/)[0].trim();
  return name || savedBy;
}
