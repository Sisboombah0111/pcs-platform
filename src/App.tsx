import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ProjectFileError, createProject, parseProject, projectFileName, serializeProject, touch } from "./model/project";
import { SAMPLE_COUNT, sampleMaterials } from "./model/sampleData";
import type { Material, PfdBoard, Project } from "./model/types";
import { debouncer, holdConnection, loadCurrent, saveCurrent, saveCurrentNow } from "./storage/autosave";
import { downloadText, pickFile } from "./storage/files";
import { Dialog, useConfirm, useToast } from "./ui/Dialog";
import { MaterialsView } from "./views/MaterialsView";
import { PfdView, type PfdControl } from "./views/PfdView";
import { MbView } from "./views/MbView";
import { BomView } from "./views/BomView";
import { OperationsView, type OpsFocus } from "./views/OperationsView";
import { ChangesDialog, readUserName } from "./views/Changes";
import { addLog, changedKeys, describeChange, describeUos, emptyHistory, logLine, record, redo, undo, updateLog, type History } from "./model/history";
import { LinkChip, LinkDialog } from "./views/LinkCheck";
import { linkCheck, type Area } from "./link/check";
import { GuidePanel, guideOpenAtStart, rememberGuideOpen } from "./views/Guide";
import type { GoTarget } from "./guide/content";
import type { GoPlace } from "./views/WhereUsed";

type Tab = "pfd" | "operations" | "mb" | "bom" | "materials";
type SaveState = { kind: "idle" } | { kind: "saving" } | { kind: "saved"; at: string } | { kind: "error"; message: string };

const TABS: { id: Tab; label: string }[] = [
  { id: "pfd", label: "PFD" },
  { id: "operations", label: "Operations" },
  { id: "mb", label: "Mass Balance" },
  { id: "bom", label: "BOM" },
  { id: "materials", label: "Materials" },
];

const timeOf = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

export default function App() {
  const [project, setProject] = useState<Project | null>(null);
  const [tab, setTab] = useState<Tab>("pfd");
  const [saveState, setSaveState] = useState<SaveState>({ kind: "idle" });
  const [fileSavedVersion, setFileSavedVersion] = useState<string | undefined>(undefined);
  const [newDialog, setNewDialog] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const pfdControl = useRef<PfdControl | null>(null);
  const [materialFocus, setMaterialFocus] = useState<{ code: string; open?: "recipe" | "backups"; n: number } | null>(null);
  const [opsFocus, setOpsFocus] = useState<OpsFocus | null>(null);
  const [guideOpen, setGuideOpenState] = useState(guideOpenAtStart);
  const setGuideOpen = (open: boolean) => { setGuideOpenState(open); rememberGuideOpen(open); };
  const { confirm, element: confirmEl } = useConfirm();
  const { show: toast, element: toastEl } = useToast();

  const latest = useRef<{ project: Project | null; fileSavedVersion?: string }>({ project: null });
  latest.current = { project, fileSavedVersion };

  const autosave = useMemo(() => debouncer(() => {
    const { project: p, fileSavedVersion: v } = latest.current;
    if (!p) return;
    setSaveState({ kind: "saving" });
    saveCurrent(p, v).then(
      (at) => setSaveState({ kind: "saved", at }),
      (e: Error) => setSaveState({ kind: "error", message: e.message }),
    );
  }, 700), []);

  // Restore the last session, or start a new project.
  useEffect(() => {
    let alive = true;
    loadCurrent().then(
      (rec) => {
        if (!alive) return;
        if (rec) {
          setProject(rec.project);
          setFileSavedVersion(rec.fileSavedVersion);
          setSaveState({ kind: "saved", at: rec.savedAt });
          if (rec.notes.length) toast(`Restored with ${rec.notes.length} note(s): ${rec.notes[0]}`);
        } else {
          setProject(createProject());
        }
      },
      (e: Error) => {
        if (!alive) return;
        setProject(createProject());
        setSaveState({ kind: "error", message: e.message });
      },
    );
    return () => { alive = false; };
  }, [toast]);

  useEffect(() => {
    if (project) autosave.schedule();
  }, [project, fileSavedVersion, autosave]);

  // When the page is hidden or closed, write the very latest board straight away.
  const flushBoard = useRef<(() => PfdBoard | null) | null>(null);
  useEffect(() => {
    holdConnection();
    const flush = () => {
      const p = latest.current.project;
      if (!p) return;
      const board = flushBoard.current?.();
      const next = board ? { ...p, pfd: board } : p;
      latest.current = { ...latest.current, project: next };
      if (!saveCurrentNow(next, latest.current.fileSavedVersion)) void saveCurrent(next, latest.current.fileSavedVersion);
    };
    const onVis = () => { if (document.visibilityState === "hidden") flush(); };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVis);
    return () => { window.removeEventListener("pagehide", flush); document.removeEventListener("visibilitychange", onVis); };
  }, [autosave]);

  // ---- undo / redo and the change log (Materials, BOM, Operations, Mass Balance; the drawing has its own undo) ----
  const history = useRef<History>(emptyHistory());
  const [, setHistoryTick] = useState(0);
  /** The label of the change being made (null: not recorded, e.g. drawing on the PFD). */
  const pending = useRef<{ label: string; note?: string } | null>(null);
  /** Set while an undo or redo is applied: its log label. */
  const applying = useRef<string | null>(null);
  const [logOpen, setLogOpen] = useState(false);

  /** Change the project; `label` names the change for undo and the change log (null: not recorded). */
  const update = useCallback((fn: (p: Project) => Project, label: string | null = "Change") => {
    if (label !== null) pending.current = { label };
    setProject((p) => (p ? touch(fn(p)) : p));
  }, []);
  const quietUpdate = useCallback((fn: (p: Project) => Project) => update(fn, null), [update]);
  const updateFrom = useCallback((screen: string) => (fn: (p: Project) => Project, label?: string | null) => update(fn, label === undefined ? screen : label), [update]);

  const prevProject = useRef<Project | null>(null);
  useEffect(() => {
    const prev = prevProject.current;
    prevProject.current = project;
    if (!project) return;
    if (!prev || prev.id !== project.id) { history.current = emptyHistory(); pending.current = null; applying.current = null; setHistoryTick((t) => t + 1); return; }
    const by = readUserName();
    const code = (id: string) => project.uos.find((u) => u.id === id)?.code ?? prev.uos.find((u) => u.id === id)?.code ?? "?";
    let log = project.changeLog;
    const uoLines = describeUos(prev.uos, project.uos);
    if (uoLines.length) log = addLog(log, logLine("PFD", uoLines, by));
    if (applying.current) {
      const label = applying.current;
      applying.current = null;
      pending.current = null;
      const keys = changedKeys(prev, project);
      if (keys.length) {
        const parts = (q: Project) => Object.fromEntries(keys.map((k) => [k, q[k]]));
        log = addLog(log, logLine(label, describeChange(parts(prev), parts(project), code), by));
      }
    } else if (pending.current) {
      const meta = pending.current;
      pending.current = null;
      const r = record(history.current, prev, project, meta.label, Date.now(), meta.note);
      if (r) {
        const what = describeChange(r.entry.before, r.entry.after, code);
        if (r.merged && r.entry.logId) log = updateLog(log, r.entry.logId, what, new Date().toISOString());
        else { const line = logLine(meta.label, what, by); log = addLog(log, line); r.entry.logId = line.id; }
        history.current = r.history;
        setHistoryTick((t) => t + 1);
      }
    } else {
      // Not recorded for undo (made on the PFD, e.g. a tag given to a shape), but still logged.
      const keys = changedKeys(prev, project);
      if (keys.length) {
        const parts = (q: Project) => Object.fromEntries(keys.map((k) => [k, q[k]]));
        log = addLog(log, logLine("PFD", describeChange(parts(prev), parts(project), code), by));
      }
    }
    if (log !== project.changeLog) setProject((p) => (p ? { ...p, changeLog: log } : p));
  }, [project]);


  // A change to the project as a whole, PFD drawings included (Replace material) and maybe async (the MB
  // workbook is rewritten): the PFD editor hands over its latest drawing first and opens again after.
  const [pfdEpoch, setPfdEpoch] = useState(0);
  const transform = useCallback(async (fn: (p: Project) => Project | Promise<Project>, opts?: { pfd?: boolean; label?: string; note?: string }) => {
    const board = opts?.pfd ? flushBoard.current?.() ?? null : null;
    const base = latest.current.project;
    if (!base) return;
    const next = await fn(board ? { ...base, pfd: board } : base);
    pending.current = { label: opts?.label ?? "Change", ...(opts?.note ? { note: opts.note } : {}) };
    setProject((prev) => touch({ ...next, uos: prev?.uos ?? next.uos, streams: prev?.streams ?? next.streams }));
    if (opts?.pfd) setPfdEpoch((e) => e + 1);
  }, []);

  const unsavedToFile = !!project && project.meta.updatedAt !== fileSavedVersion;

  const saveFile = useCallback(() => {
    const p = latest.current.project;
    if (!p) return;
    downloadText(serializeProject(p), projectFileName(p));
    setFileSavedVersion(p.meta.updatedAt);
    toast(`Saved as ${projectFileName(p)}`);
  }, [toast]);

  const applyHistory = useCallback((dir: "undo" | "redo") => {
    const p = latest.current.project;
    if (!p) return;
    const r = dir === "undo" ? undo(history.current, p) : redo(history.current, p);
    if (!r) return;
    history.current = r.history;
    setHistoryTick((t) => t + 1);
    if ("error" in r) { toast(r.error); return; }
    applying.current = `${dir === "undo" ? "Undo" : "Redo"}: ${r.entry.label}`;
    setProject((q) => (q ? touch({ ...q, ...r.patch }) : q));
    toast(`${dir === "undo" ? "Undone" : "Redone"}: ${r.entry.label}${r.entry.note ? ` (${r.entry.note})` : ""}`);
  }, [toast]);
  const tabRef = useRef(tab);
  tabRef.current = tab;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        e.stopPropagation();
        saveFile();
        return;
      }
      // Ctrl+Z / Ctrl+Y outside the drawing and outside text fields (they keep their own undo while typing).
      const k = e.key.toLowerCase();
      if (!(e.ctrlKey || e.metaKey) || (k !== "z" && k !== "y") || e.altKey || tabRef.current === "pfd") return;
      const t = e.target as HTMLElement | null;
      if (t && (t.closest("input, textarea, select, [contenteditable='true']") || t.closest(".dialog, .gc-overlay"))) return;
      e.preventDefault();
      applyHistory(k === "y" || e.shiftKey ? "redo" : "undo");
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [saveFile, applyHistory]);

  const guardUnsaved = async (action: "open" | "new") => {
    if (!unsavedToFile) return true;
    return confirm({
      title: "Changes not saved to a file",
      body: `This project has changes that are not in a project file yet. ${action === "open" ? "Opening a file" : "Starting a new project"} replaces the copy autosaved in this browser. Use "Save to file" first to keep them.`,
      confirmLabel: action === "open" ? "Open without saving" : "Start new without saving",
      danger: true,
    });
  };

  const openFile = async () => {
    if (!(await guardUnsaved("open"))) return;
    const file = await pickFile(".json,application/json");
    if (!file) return;
    try {
      const { project: p, notes } = parseProject(await file.text());
      setProject(p);
      setFileSavedVersion(p.meta.updatedAt);
      setTab("pfd");
      toast(notes.length ? `Opened ${file.name} · ${notes.length} note(s): ${notes[0]}` : `Opened ${file.name}`);
    } catch (e) {
      toast(e instanceof ProjectFileError ? e.message : `Could not open the file: ${(e as Error).message}`);
    }
  };

  const startNew = async (name: string, withSamples: boolean) => {
    setNewDialog(false);
    if (!(await guardUnsaved("new"))) return;
    const p = createProject(name.trim() || "New process");
    if (withSamples) p.materials = sampleMaterials();
    setProject(p);
    setFileSavedVersion(undefined);
    setTab("pfd");
  };

  // The PFD, Mass Balance, BOM and material list checked against each other on every change.
  const findings = useMemo(() => (project ? linkCheck(project) : []), [project?.mb, project?.streams, project?.uos, project?.materials, project?.pfd, project?.bom, project?.equipment, project?.operations]); // eslint-disable-line react-hooks/exhaustive-deps
  const goTo = (area: Area) => { setLinkOpen(false); setTab(area === "pfd" ? "pfd" : area); };
  /** Where "Where used" sends the user. */
  const goPlace = (place: GoPlace) => {
    if (place.kind === "bom") { setTab("bom"); setTimeout(() => window.dispatchEvent(new CustomEvent("pcs:bom-focus", { detail: { uo: place.uo, code: place.code } })), 60); return; }
    if (place.kind === "stream") { setTab("pfd"); setTimeout(() => pfdControl.current?.focusStream(place.id), 50); return; }
    if (place.kind === "pfd") { setTab("pfd"); setTimeout(() => pfdControl.current?.focusElement(place.scope, place.elementId), 50); return; }
    if (place.kind === "step") { setTab("pfd"); setTimeout(() => pfdControl.current?.showStep(place.uoId, place.index), 50); return; }
    setTab("materials");
    setMaterialFocus({ code: place.code, ...(place.open ? { open: place.open } : {}), n: Date.now() });
  };
  /** Where a guide step sends the user. */
  const guideGo = (to: GoTarget) => {
    if (to === "link") { setLinkOpen(true); return; }
    if (to === "map") { setTab("pfd"); setTimeout(() => pfdControl.current?.openMap(), 50); return; }
    setTab(to);
  };

  if (!project) return <div className="loading">Loading…</div>;

  const status = (() => {
    switch (saveState.kind) {
      case "saving": return { dot: "", text: "Saving…" };
      case "saved": return { dot: "ok", text: `Autosaved ${timeOf(saveState.at)}` };
      case "error": return { dot: "err", text: "Autosave off", title: saveState.message };
      default: return { dot: "", text: "" };
    }
  })();

  return (
    <div className="app">
      <header className="bar">
        <input
          className="project-name"
          value={project.meta.name}
          onChange={(e) => update((p) => ({ ...p, meta: { ...p.meta, name: e.target.value } }))}
          aria-label="Project name"
          spellCheck={false}
        />
        <nav className="tabs" role="tablist" aria-label="Screens">
          {TABS.map((t) => (
            <button key={t.id} role="tab" className="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}>
              {t.label}
              {t.id === "materials" && project.materials.length > 0 && <span className="count">{project.materials.length}</span>}
            </button>
          ))}
        </nav>
        <div className="undo-group" role="group" aria-label="Undo and redo">
          <button className="btn icon-btn" aria-label="Undo change" disabled={!history.current.past.length} onClick={() => applyHistory("undo")}
            title={history.current.past.length ? `Undo: ${history.current.past[history.current.past.length - 1].label} (Ctrl+Z outside the drawing). Materials, BOM, Operations and Mass Balance; the PFD drawing has its own undo.` : "Nothing to undo (the PFD drawing has its own undo)"}>↶</button>
          <button className="btn icon-btn" aria-label="Redo change" disabled={!history.current.future.length} onClick={() => applyHistory("redo")}
            title={history.current.future.length ? `Redo: ${history.current.future[history.current.future.length - 1].label} (Ctrl+Y)` : "Nothing to redo"}>↷</button>
          <button className="btn changes-btn" onClick={() => setLogOpen(true)} title="Who changed what, when (saved with the project)">Changes</button>
        </div>
        <button className={`btn guide-btn${guideOpen ? " on" : ""}`} aria-pressed={guideOpen} onClick={() => setGuideOpen(!guideOpen)}
          title="Step-by-step guide to linking the PFD, the Mass Balance and the BOM (English / 한국어)">
          <span className="guide-q" aria-hidden>?</span> Guide
        </button>
        <div className="spacer" />
        <div className="status" title={"title" in status ? status.title : status.text}>
          <span className={`dot ${status.dot}`} /><span className="label">{status.text}</span>
        </div>
        <LinkChip findings={findings} onOpen={() => setLinkOpen(true)} />
        <div className="actions">
          <button className="btn" onClick={() => setNewDialog(true)}>New</button>
          <button className="btn" onClick={openFile}>Open</button>
          <button className={`btn primary${unsavedToFile ? " unsaved" : ""}`} onClick={saveFile}
            title={unsavedToFile ? "Not saved to a file yet: autosaved in this browser only. Save to a file to open it on another PC or share it (Ctrl+S)." : "Saved to a file (Ctrl+S)"}>
            {unsavedToFile && <span className="unsaved-dot" aria-hidden />}Save to file
          </button>
        </div>
      </header>

      {import.meta.env.MODE === "singlefile" ? (
        <div className="preview-banner">
          Preview build. Downloads (Save to file, Excel export) may be blocked here, and autosave stays in this browser only. Everything works in the GitHub Pages deployment.
        </div>
      ) : <div />}
      <div className="workspace">
      <main className="work">
        {/* The PFD editor stays mounted (keeps its undo history); other screens cover it. */}
        <div className="pfd-layer" style={{ visibility: tab === "pfd" ? "visible" : "hidden" }} aria-hidden={tab !== "pfd"} inert={tab !== "pfd"}>
          <PfdView
            key={`${project.id}:${pfdEpoch}`}
            project={project}
            update={quietUpdate}
            confirm={confirm}
            toast={toast}
            goTo={goTo}
            registerControl={(c) => { pfdControl.current = c; }}
            registerFlush={(f) => { flushBoard.current = f; }}
            openOperations={(equipmentId, uoId) => { setTab("operations"); setOpsFocus({ ...(equipmentId ? { equipmentId } : {}), ...(uoId ? { uoId } : {}), n: Date.now() }); }}
          />
        </div>
        {tab !== "pfd" && (
          <div className="screen-layer">
            {tab === "materials" && (
              <MaterialsView
                project={project}
                onChange={(materials: Material[], label?: string) => update((p) => ({
                  ...p,
                  materials,
                  bom: { ...p.bom, lines: Object.fromEntries(Object.entries(p.bom.lines).map(([uo, ls]) => [uo, ls.filter((l) => materials.some((m) => m.id === l.materialId))])) },
                }), label ?? "Materials")}
                confirm={confirm}
                toast={toast}
                go={goPlace}
                transform={transform}
                focus={materialFocus}
                onFocusDone={() => setMaterialFocus(null)}
              />
            )}
            {tab === "operations" && <OperationsView project={project} update={updateFrom("Operations")} confirm={confirm} toast={toast} go={goPlace} focus={opsFocus} onFocusDone={() => setOpsFocus(null)} />}
            {tab === "mb" && <MbView project={project} update={updateFrom("Mass Balance")} confirm={confirm} toast={toast} />}
            {tab === "bom" && <BomView project={project} update={updateFrom("BOM")} confirm={confirm} toast={toast} goTo={goTo} go={goPlace} transform={transform} />}
          </div>
        )}
      </main>
      {guideOpen && <GuidePanel project={project} findings={findings} screen={tab} onGo={guideGo} onClose={() => setGuideOpen(false)} />}
      </div>

      {linkOpen && <LinkDialog findings={findings} onClose={() => setLinkOpen(false)} goTo={goTo}
        showStream={(id) => { setLinkOpen(false); setTab("pfd"); setTimeout(() => pfdControl.current?.focusStream(id), 50); }} />}
      {newDialog && <NewProjectDialog onCancel={() => setNewDialog(false)} onCreate={startNew} />}
      {logOpen && <ChangesDialog project={project} onClose={() => setLogOpen(false)} onClear={() => update((p) => ({ ...p, changeLog: [] }), null)} confirm={confirm} />}
      {confirmEl}
      {toastEl}
    </div>
  );
}

function NewProjectDialog(props: { onCancel: () => void; onCreate: (name: string, withSamples: boolean) => void }) {
  const [name, setName] = useState("New process");
  const [samples, setSamples] = useState(true);
  return (
    <Dialog
      title="New project"
      onClose={props.onCancel}
      actions={<>
        <button className="btn" onClick={props.onCancel}>Cancel</button>
        <button className="btn primary" onClick={() => props.onCreate(name, samples)}>Create</button>
      </>}
    >
      <label style={{ display: "grid", gap: 4 }}>
        <span>Process name</span>
        <input data-autofocus className="search" style={{ width: "100%" }} value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") props.onCreate(name, samples); }} />
      </label>
      <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input type="checkbox" checked={samples} onChange={(e) => setSamples(e.target.checked)} />
        <span>Add {SAMPLE_COUNT} sample materials (made-up codes)</span>
      </label>
    </Dialog>
  );
}
