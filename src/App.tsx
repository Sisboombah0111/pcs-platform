import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ProjectFileError, createProject, parseProject, projectFileName, serializeProject, touch, withoutViewPositions } from "./model/project";
import { EXAMPLE_PROJECTS, exampleUrl, isUntouchedExample, type Example } from "./examples";
import { StartCard } from "./views/StartCard";
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
import { Icon } from "./ui/icons";
import { RibbonButton, RibbonContext, RibbonGroup } from "./ui/Ribbon";
import { useCellSelection } from "./ui/cellSelection";

type Tab = "pfd" | "operations" | "mb" | "bom" | "materials";
type SaveState = { kind: "idle" } | { kind: "saving" } | { kind: "saved"; at: string } | { kind: "error"; message: string };
/**
 * An example open as a view (N5.5): it is not autosaved, and your own project waits here as it was (with its undo
 * history) until Close example. A reload also brings it back, since the autosave still holds it.
 */
interface ExampleView { title: string; back: Project; backFileSaved?: string; backSave: SaveState; backHistory: History; openedAt: string }

const TABS: { id: Tab; label: string }[] = [
  { id: "pfd", label: "PFD" },
  { id: "operations", label: "Operations" },
  { id: "mb", label: "Mass Balance" },
  { id: "bom", label: "BOM" },
  { id: "materials", label: "Materials" },
];

/** Set on the first start of N5.5 in a browser (the one-time check for an untouched example in the autosave). */
const EXAMPLE_CHECK_KEY = "pcs.n55.exampleCheck";
const timeOf = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
const ZOOMS = [70, 80, 90, 100, 110, 125, 150, 175];
/** A sum or average in the status bar: thousands separated, at most 4 decimals (as Excel shows them). */
const fmtStat = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: Math.abs(n) >= 1000 ? 2 : 4 });

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
  // The start card of an empty project, hidden for that project in this browser once its × is clicked.
  const [startHidden, setStartHidden] = useState<string | null>(() => { try { return localStorage.getItem("pcs.start.hidden"); } catch { return null; } });
  const hideStart = (id: string) => { setStartHidden(id); try { localStorage.setItem("pcs.start.hidden", id); } catch { /* storage off: hidden until reload */ } };
  const [guideOpen, setGuideOpenState] = useState(guideOpenAtStart);
  const setGuideOpen = (open: boolean) => { setGuideOpenState(open); rememberGuideOpen(open); };
  const { confirm, element: confirmEl } = useConfirm();
  const { show: toast, element: toastEl } = useToast();
  // The ribbon: full (big buttons, group names) or one line; remembered in this browser. On a short window
  // (a laptop at 125–150 % scaling) it starts as one line.
  const [ribbonCompact, setRibbonCompactState] = useState(() => {
    try { const v = localStorage.getItem("pcs.ribbon.compact"); if (v !== null) return v === "1"; } catch { /* storage off */ }
    return typeof window !== "undefined" && window.innerHeight < 700;
  });
  const setRibbonCompact = (v: boolean) => { setRibbonCompactState(v); try { localStorage.setItem("pcs.ribbon.compact", v ? "1" : "0"); } catch { /* storage off: this visit only */ } };
  const [ribbonEl, setRibbonEl] = useState<HTMLElement | null>(null);
  const [screenEl, setScreenEl] = useState<HTMLElement | null>(null);
  // Zoom of the table screens (the status bar slider, as in Excel); the PFD drawing has its own zoom.
  const [zoom, setZoomState] = useState(() => { try { const z = Number(localStorage.getItem("pcs.zoom")); return ZOOMS.includes(z) ? z : 100; } catch { return 100; } });
  const setZoom = (z: number) => { setZoomState(z); try { localStorage.setItem("pcs.zoom", String(z)); } catch { /* storage off */ } };
  const selStats = useCellSelection(screenEl, `${tab}:${project?.id ?? ""}`, (r, c) => toast(`Copied ${r} × ${c} cell${r * c > 1 ? "s" : ""}: paste into Excel`));

  const [example, setExample] = useState<ExampleView | null>(null);
  const latest = useRef<{ project: Project | null; fileSavedVersion?: string; example?: boolean }>({ project: null });
  latest.current = { project, fileSavedVersion, example: !!example };

  const autosave = useMemo(() => debouncer(() => {
    const { project: p, fileSavedVersion: v } = latest.current;
    // An example on view is never autosaved: the autosave keeps your own project.
    if (!p || latest.current.example) return;
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
        // Once, on the first start of N5.5 in this browser: an example autosaved as it came (before N5.5 an
        // opened example became the project) gives way to an empty project; the example opens again when asked.
        // After that an example opened on purpose (Open, a file) stays, changed or not.
        let firstStart = false;
        try { firstStart = localStorage.getItem(EXAMPLE_CHECK_KEY) === null; localStorage.setItem(EXAMPLE_CHECK_KEY, "1"); } catch { /* storage off: leave it */ }
        if (rec && firstStart && isUntouchedExample(rec.project)) {
          setProject(createProject());
          toast("The example now opens only when you ask: Start here › Open the example (view only)");
        } else if (rec) {
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
    if (project && !example) autosave.schedule();
  }, [project, fileSavedVersion, example, autosave]);

  // When the page is hidden or closed, write the very latest board straight away.
  const flushBoard = useRef<(() => PfdBoard | null) | null>(null);
  useEffect(() => {
    holdConnection();
    const flush = () => {
      const p = latest.current.project;
      if (!p || latest.current.example) return;
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
  /** The undo history to use with the next project set (an example opened or closed, a file opened). */
  const swapHistory = useRef<History | null>(null);

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
    if (swapHistory.current) { history.current = swapHistory.current; swapHistory.current = null; pending.current = null; applying.current = null; setHistoryTick((t) => t + 1); return; }
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
      const k = e.key.toLowerCase();
      // Ctrl+F on a screen with a search box: that box (as Find in Office); elsewhere the browser's own find.
      if ((e.ctrlKey || e.metaKey) && k === "f" && !e.altKey && !e.shiftKey && tabRef.current !== "pfd" && !document.querySelector(".dialog")) {
        const box = [...document.querySelectorAll<HTMLInputElement>(".ribbon input.search, .screen-layer input.search[type='search'], .screen-layer input.search[aria-label^='Search']")].find((x) => x.offsetParent !== null);
        if (box) { e.preventDefault(); box.focus(); box.select(); return; }
      }
      // Ctrl+Z / Ctrl+Y outside the drawing and outside text fields (they keep their own undo while typing).
      if (!(e.ctrlKey || e.metaKey) || (k !== "z" && k !== "y") || e.altKey || tabRef.current === "pfd") return;
      const t = e.target as HTMLElement | null;
      if (t && (t.closest("input, textarea, select, [contenteditable='true']") || t.closest(".dialog, .gc-overlay"))) return;
      e.preventDefault();
      applyHistory(k === "y" || e.shiftKey ? "redo" : "undo");
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [saveFile, applyHistory]);

  const guardUnsaved = async (action: "open" | "new" | "keep") => {
    // With an example on view, what Open or New replaces is your own project waiting behind it.
    const own = example ? { p: example.back, v: example.backFileSaved } : { p: project, v: fileSavedVersion };
    if (!own.p || own.p.meta.updatedAt === own.v) return true;
    return confirm({
      title: "Changes not saved to a file",
      body: `${example ? `Your project (${own.p.meta.name})` : "This project"} has changes that are not in a project file yet. ${action === "open" ? "Opening a file" : action === "keep" ? "Keeping the example" : "Starting a new project"} replaces the copy autosaved in this browser. Use "Save to file" first to keep them.`,
      confirmLabel: action === "open" ? "Open without saving" : action === "keep" ? "Keep the example without saving" : "Start new without saving",
      danger: true,
    });
  };

  const openFile = async () => {
    if (!(await guardUnsaved("open"))) return;
    const file = await pickFile(".json,application/json");
    if (!file) return;
    openText(await file.text(), file.name);
  };

  /** A project file's text read, or null (and a message) when it is not one. */
  const parseText = (text: string): { p: Project; notes: string[] } | null => {
    try {
      const { project: p, notes } = parseProject(text);
      // The zoom and scroll saved in the file were for the screen it was saved on: each drawing fits this one.
      return { p: withoutViewPositions(p), notes };
    } catch (e) {
      toast(e instanceof ProjectFileError ? e.message : `Could not open the file: ${(e as Error).message}`);
      return null;
    }
  };
  /** The project from now on (Open, New, Keep the example): a fresh drawing and undo history, autosaved. */
  const becomeProject = (p: Project, fileSaved: string | undefined) => {
    swapHistory.current = emptyHistory();
    setExample(null);
    setProject(p);
    setFileSavedVersion(fileSaved);
    setPfdEpoch((e) => e + 1);
    setTab("pfd");
  };

  /** A project file opened like Open does. */
  const openText = (text: string, name: string) => {
    const r = parseText(text);
    if (!r) return;
    becomeProject(r.p, r.p.meta.updatedAt);
    toast(r.notes.length ? `Opened ${name} · ${r.notes.length} note(s): ${r.notes[0]}` : `Opened ${name}`);
  };

  /** An example that comes with the app, opened as a view: your own project is kept (autosaved) behind it. */
  const openExample = async (ex: Example) => {
    let text: string;
    try {
      const res = await fetch(exampleUrl(ex.file));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      text = await res.text();
    } catch (e) {
      toast(`Could not load the example (${(e as Error).message}). It is also in the examples folder on GitHub.`);
      return;
    }
    const r = parseText(text);
    const cur = latest.current.project;
    if (!r || !cur) return;
    let view: ExampleView;
    if (example) view = { ...example, title: ex.title, openedAt: r.p.meta.updatedAt };
    else {
      // Your project as it is now, the drawing's last strokes included, written to the autosave straight away.
      const board = flushBoard.current?.();
      const back = board ? { ...cur, pfd: board } : cur;
      if (!saveCurrentNow(back, fileSavedVersion)) void saveCurrent(back, fileSavedVersion).catch(() => { /* kept here until Close example */ });
      view = { title: ex.title, back, backFileSaved: fileSavedVersion, backSave: saveState, backHistory: history.current, openedAt: r.p.meta.updatedAt };
    }
    swapHistory.current = emptyHistory();
    setExample(view);
    setProject(r.p);
    setFileSavedVersion(r.p.meta.updatedAt);
    setPfdEpoch((e) => e + 1);
    setTab("pfd");
    toast(`Opened the example as a view: not saved. Close example brings back ${view.back.meta.name}.`);
  };

  /** Back to your own project, as it was; the example and what was changed in it go. */
  const closeExample = async () => {
    if (!example) return;
    const edited = latest.current.project?.meta.updatedAt !== example.openedAt;
    if (edited && !(await confirm({
      title: "Close the example?",
      body: `What you changed in the example is not saved (Save to file keeps a copy). ${example.back.meta.name} comes back as it was.`,
      confirmLabel: "Close example",
    }))) return;
    swapHistory.current = example.backHistory;
    setProject(example.back);
    setFileSavedVersion(example.backFileSaved);
    setSaveState(example.backSave);
    setExample(null);
    setPfdEpoch((e) => e + 1);
    toast(`Back to ${example.back.meta.name}`);
  };

  /** The example becomes your project (autosaved from now on), in place of the one behind it. */
  const keepExample = async () => {
    if (!example) return;
    if (!(await guardUnsaved("keep"))) return;
    if (example.back.meta.updatedAt === example.backFileSaved && !(await confirm({
      title: "Keep the example as your project?",
      body: `It takes the place of ${example.back.meta.name} in this browser's autosave (your project file, if you saved one, stays as it is).`,
      confirmLabel: "Keep the example",
    }))) return;
    setExample(null);
    // Marked as changed, so it is the user's project from now on (an untouched example is not restored).
    setProject((p) => (p ? touch(p) : p));
    toast("The example is your project now: autosaved in this browser");
  };

  const startNew = async (name: string, withSamples: boolean) => {
    setNewDialog(false);
    if (!(await guardUnsaved("new"))) return;
    const p = createProject(name.trim() || "New process");
    if (withSamples) p.materials = sampleMaterials();
    becomeProject(p, undefined);
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
    if (example) return { dot: "warn", text: "Example · not saved", title: `A view of the example: changes are not autosaved. Close example brings back ${example.back.meta.name}.` };
    switch (saveState.kind) {
      case "saving": return { dot: "", text: "Saving…" };
      case "saved": return { dot: "ok", text: `Autosaved ${timeOf(saveState.at)}` };
      case "error": return { dot: "err", text: "Autosave off", title: saveState.message };
      default: return { dot: "", text: "" };
    }
  })();

  const saveTitle = unsavedToFile ? "Not saved to a file yet: autosaved in this browser only. Save to a file to open it on another PC or share it (Ctrl+S)." : "Saved to a file (Ctrl+S)";
  const lastUndo = history.current.past[history.current.past.length - 1];
  const lastRedo = history.current.future[history.current.future.length - 1];

  return (
    <div className="app" data-office={tab === "pfd" ? "ppt" : "xl"}>
      {/* Office look (N5.2): a title bar with the quick buttons, the screens as ribbon tabs, the ribbon, and a
          status bar at the bottom. Excel green on the table screens, PowerPoint orange on the PFD. */}
      <header className="titlebar">
        <div className="qat" role="group" aria-label="Quick access">
          <button className={`qat-btn${unsavedToFile ? " unsaved" : ""}`} aria-label="Save (Ctrl+S)" title={saveTitle} onClick={saveFile}>
            <Icon name="save" />{unsavedToFile && <span className="unsaved-dot" aria-hidden />}
          </button>
          <button className="qat-btn" aria-label="Undo change" disabled={!lastUndo} onClick={() => applyHistory("undo")}
            title={lastUndo ? `Undo: ${lastUndo.label} (Ctrl+Z outside the drawing). Materials, BOM, Operations and Mass Balance; the PFD drawing has its own undo.` : "Nothing to undo (the PFD drawing has its own undo)"}><Icon name="undo" /></button>
          <button className="qat-btn" aria-label="Redo change" disabled={!lastRedo} onClick={() => applyHistory("redo")}
            title={lastRedo ? `Redo: ${lastRedo.label} (Ctrl+Y)` : "Nothing to redo"}><Icon name="redo" /></button>
        </div>
        <div className="title-center">
          <input
            className="project-name"
            value={project.meta.name}
            onChange={(e) => update((p) => ({ ...p, meta: { ...p.meta, name: e.target.value } }))}
            aria-label="Project name"
            spellCheck={false}
            size={Math.max(8, Math.min(40, project.meta.name.length + 1))}
          />
          <span className="title-app">PCS Platform</span>
          <span className="status" title={"title" in status ? status.title : status.text}>
            <span className={`dot ${status.dot}`} /><span className="label">{status.text}</span>
          </span>
        </div>
        <div className="title-right">
          <LinkChip findings={findings} onOpen={() => setLinkOpen(true)} />
          <button className={`title-btn guide-btn${guideOpen ? " on" : ""}`} aria-pressed={guideOpen} onClick={() => setGuideOpen(!guideOpen)}
            title="Step-by-step guide to linking the PFD, the Mass Balance and the BOM (English / 한국어)">
            <Icon name="help" /> Guide
          </button>
        </div>
      </header>
      <div className="ribbon-tabs">
        <nav className="tabs" role="tablist" aria-label="Screens">
          {TABS.map((t) => (
            <button key={t.id} role="tab" className="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}>
              {t.label}
              {t.id === "materials" && project.materials.length > 0 && <span className="count">{project.materials.length}</span>}
            </button>
          ))}
        </nav>
        <button className="ribbon-size" onClick={() => setRibbonCompact(!ribbonCompact)} aria-pressed={!ribbonCompact}
          aria-label={ribbonCompact ? "Show the full ribbon" : "Show a one-line ribbon"} title={ribbonCompact ? "Full ribbon: big buttons with group names" : "One-line ribbon: more room for the work"}>
          <Icon name={ribbonCompact ? "down" : "up"} />
        </button>
      </div>
      <div className={`ribbon${ribbonCompact ? " compact" : ""}`}>
        <RibbonGroup label="File">
          <RibbonButton big icon="new" label="New" onClick={() => setNewDialog(true)} title="Start a new project" />
          <RibbonButton big icon="open" label="Open" onClick={openFile} title="Open a project file (.pcs.json)" />
          <RibbonButton big primary icon="save" className={unsavedToFile ? "unsaved" : ""} onClick={saveFile} title={saveTitle}
            label={<>{unsavedToFile && <span className="unsaved-dot" aria-hidden />}Save to file</>} />
        </RibbonGroup>
        <div className="ribbon-screen" ref={setRibbonEl} />
        <RibbonGroup label="History">
          <RibbonButton big icon="history" label="Changes" onClick={() => setLogOpen(true)} title="Who changed what, when (saved with the project)" />
        </RibbonGroup>
      </div>

      <div className="app-notices">
        {import.meta.env.MODE === "singlefile" && (
          <div className="preview-banner">
            Preview build. Downloads (Save to file, Excel export) may be blocked here, and autosave stays in this browser only. Everything works in the GitHub Pages deployment.
          </div>
        )}
        {example && (
          <div className="example-bar" role="status" aria-label="Example">
            <Icon name="samples" size={16} />
            <span><b>Example: {example.title}</b> — a view only: changes are not saved, and your project ({example.back.meta.name}) is kept as it was.</span>
            <button className="btn small primary" onClick={() => void closeExample()}>Close example</button>
            <button className="btn small" onClick={() => void keepExample()} title="Work on in the example: it becomes your project, autosaved in this browser">Keep as my project…</button>
          </div>
        )}
      </div>
      <RibbonContext.Provider value={{ el: ribbonEl, screen: tab }}>
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
            renderStart={startHidden === project.id ? undefined : (addUnit) => (
              <StartCard onOpenExample={openExample} onOpenFile={openFile} onAddUnit={addUnit} onHide={() => hideStart(project.id)} />
            )}
          />
        </div>
        {tab !== "pfd" && (
          <div className="screen-layer" ref={setScreenEl} style={zoom !== 100 ? { zoom: zoom / 100 } : undefined}>
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
      </RibbonContext.Provider>

      <footer className="statusbar">
        <span className="sb-ready">{saveState.kind === "saving" ? "Saving…" : "Ready"}</span>
        <span className="sb-where">{example ? "Example: not saved · Close example brings back your project" : unsavedToFile ? "Autosaved in this browser · not saved to a file yet" : "Saved to a file"}</span>
        <span className="sb-stats" aria-live="polite">
          {selStats && selStats.count > 1 && (selStats.numbers > 0
            ? <><span>Average: {fmtStat(selStats.sum / selStats.numbers)}</span><span>Count: {selStats.count}</span><span>Sum: {fmtStat(selStats.sum)}</span></>
            : <span>Count: {selStats.count}</span>)}
        </span>
        {tab !== "pfd" && (
          <span className="sb-zoom" role="group" aria-label="Zoom">
            <button className="sb-btn" aria-label="Zoom out" disabled={zoom <= ZOOMS[0]} onClick={() => setZoom(ZOOMS[Math.max(0, ZOOMS.indexOf(zoom) - 1)])}><Icon name="minus" size={16} /></button>
            <input type="range" className="sb-range" min={0} max={ZOOMS.length - 1} step={1} value={Math.max(0, ZOOMS.indexOf(zoom))}
              onChange={(e) => setZoom(ZOOMS[Number(e.target.value)])} aria-label="Zoom level" aria-valuetext={`${zoom}%`} />
            <button className="sb-btn" aria-label="Zoom in" disabled={zoom >= ZOOMS[ZOOMS.length - 1]} onClick={() => setZoom(ZOOMS[Math.min(ZOOMS.length - 1, ZOOMS.indexOf(zoom) + 1)])}><Icon name="plus" size={16} /></button>
            <button className="sb-pct" onClick={() => setZoom(100)} title="Back to 100%">{zoom}%</button>
          </span>
        )}
      </footer>

      {linkOpen && <LinkDialog findings={findings} onClose={() => setLinkOpen(false)} goTo={goTo}
        showStream={(id) => { setLinkOpen(false); setTab("pfd"); setTimeout(() => pfdControl.current?.focusStream(id), 50); }} />}
      {newDialog && <NewProjectDialog onCancel={() => setNewDialog(false)} onCreate={startNew} onExample={() => { setNewDialog(false); void openExample(EXAMPLE_PROJECTS[0]); }} />}
      {logOpen && <ChangesDialog project={project} onClose={() => setLogOpen(false)} onClear={() => update((p) => ({ ...p, changeLog: [] }), null)} confirm={confirm} />}
      {confirmEl}
      {toastEl}
    </div>
  );
}

function NewProjectDialog(props: { onCancel: () => void; onCreate: (name: string, withSamples: boolean) => void; onExample: () => void }) {
  const [name, setName] = useState("New process");
  const [samples, setSamples] = useState(false);
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
        <input data-autofocus className="search" style={{ width: "100%" }} value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input type="checkbox" checked={samples} onChange={(e) => setSamples(e.target.checked)} />
        <span>Add {SAMPLE_COUNT} sample materials (made-up codes)</span>
      </label>
      <p className="muted new-example">
        Want to look around first? <button className="linkish" onClick={props.onExample}>Open the example (view only)</button>: the downstream mAb process, not saved; your project stays as it is.
      </p>
    </Dialog>
  );
}
