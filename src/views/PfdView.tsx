import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  CaptureUpdateAction, Excalidraw, MainMenu, WelcomeScreen, convertToExcalidrawElements, exportToBlob, getCommonBounds, getLibraryItemsHash, getSceneVersion,
} from "@excalidraw/excalidraw";
import type {
  AppState, BinaryFileData, BinaryFiles, DataURL, ExcalidrawImperativeAPI, ExcalidrawInitialDataState, LibraryItems,
} from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement, FileId } from "@excalidraw/excalidraw/element/types";
import { workbookNotApplied, type Area } from "../link/check";
import "@excalidraw/excalidraw/index.css";
import { isUoCode, newId, suggestUoCode } from "../model/ids";
import type { CustomSymbol, Equipment, MbRow, OpStep, PfdBoard, PfdSheet, Project, StreamRegistry, UnitOperation } from "../model/types";
import { actionText, dropUnitOperations, equipmentShapes, equipmentUse, tagKey, typeForSymbol } from "../ops/model";
import { DRAW_FONT, customSymbolElements, isInteracting, measureTexts, normalizeScene, relabel, symbolElements, symbolLabel, viewCenter } from "../pfd/excalidraw";
import { IMAGE_TYPES, MAX_IMAGE_BYTES, imageSymbol, mergeSymbols, nameFromFile, shapesSymbol, symbolSetJson, symbolsFromJson } from "../pfd/customSymbols";
import { downloadText, pickFiles, readDataUrl } from "../storage/files";
import { boundsOf, freeSpot, type Box } from "../pfd/placement";
import { PfdPanel, type EquipmentInfo, type PanelActions, type Selection } from "../pfd/PfdPanel";
import { StepOverlay } from "../pfd/StepOverlay";
import { usePanelWidth } from "../ui/resize";
import { RibbonButton, RibbonGroup, RibbonStack, ScreenRibbon } from "../ui/Ribbon";
import { PptxExportDialog } from "./PptxExport";
import { BOX_GAP, BOX_W, boxJson, frameJson } from "../pfd/shapes";
import { copyDrawing, copyTag } from "../pfd/duplicate";
import { DuplicateUnitDialog, ownEquipment, type DuplicateOptions } from "./DuplicateUnit";
import { SYMBOLS, symbolById } from "../pfd/symbols";
import { buildPfdDeck } from "../pfd/pptx";
import {
  MAP, applyScope, boxText, frameLabel, pcsOf, syncProject, type BoardElement, type PcsData, type StreamInfo,
} from "../pfd/sync";
import { newFreeTable, streamTableRows, svgDataUrl, tableSvg, type TableData } from "../pfd/tables";
import { flowValues, fmtQty, valueLines } from "../mb/model";

type ConfirmOptions = { title: string; body: string; confirmLabel: string; danger?: boolean };
/** What other screens can ask of the PFD. */
export interface PfdControl {
  focusStream: (streamId: string) => void;
  openMap: () => void;
  focusElement: (scope: string, elementId: string) => void;
  /** Open a unit operation's drawing with the step view on step `index`. */
  showStep: (uoId: string, index: number) => void;
}

/** Defaults that make the board read as an engineering drawing: straight strokes, plain sans text, routed arrows. */
const DRAWING_DEFAULTS: Partial<AppState> = {
  currentItemRoughness: 0,
  currentItemStrokeWidth: 1,
  currentItemFontFamily: DRAW_FONT,
  currentItemFontSize: 16,
  currentItemArrowType: "elbow",
  currentItemEndArrowhead: "triangle",
  currentItemStartArrowhead: null,
  currentItemRoundness: "sharp",
  gridSize: 20,
  gridStep: 5,
  objectsSnapModeEnabled: true,
  // Show arrows that leave a unit operation frame in full (Excalidraw clips frame children by default).
  frameRendering: { enabled: true, name: true, outline: true, clip: false },
};

type Api = ExcalidrawImperativeAPI;
type Model = { uos: UnitOperation[]; streams: StreamRegistry; pfd: PfdBoard };
const asBoard = (els: readonly ExcalidrawElement[]) => els as unknown as BoardElement[];
const asExcal = (els: readonly BoardElement[]) => els as unknown as ExcalidrawElement[];
const emptySheet = (): PfdSheet => ({ elements: [], files: {} });

function bumped<T extends object>(el: T, patch: Partial<T>): T {
  const v = el as unknown as { version: number };
  return { ...el, ...patch, version: (v.version ?? 0) + 1, versionNonce: Math.floor(Math.random() * 2 ** 31), updated: Date.now() };
}

function sheetOf(board: PfdBoard, scope: string): PfdSheet {
  return scope === MAP ? board.map : board.sheets[scope] ?? emptySheet();
}
function withSheet(board: PfdBoard, scope: string, sheet: PfdSheet): PfdBoard {
  return scope === MAP ? { ...board, map: sheet } : { ...board, sheets: { ...board.sheets, [scope]: sheet } };
}

/** The drawing on screen as a stored sheet (deleted elements and unused images left out). */
function sheetFromScene(api: Api): PfdSheet {
  const live = api.getSceneElementsIncludingDeleted().filter((e) => !e.isDeleted);
  const files = api.getFiles();
  const used: Record<string, unknown> = {};
  for (const e of live) if (e.type === "image" && e.fileId && files[e.fileId]) used[e.fileId] = files[e.fileId];
  const st = api.getAppState();
  return {
    elements: live as unknown[],
    files: used,
    view: { viewBackgroundColor: st.viewBackgroundColor, gridModeEnabled: st.gridModeEnabled, scrollX: st.scrollX, scrollY: st.scrollY, zoom: st.zoom.value },
  };
}

/** What a drawing holds, cheaply: element ids with versions, and image ids. */
const sheetSig = (sh: PfdSheet) =>
  `${(sh.elements as { id: string; version?: number }[]).map((e) => `${e.id}:${e.version ?? 0}`).join("|")}#${Object.keys(sh.files).sort().join()}`;

/** What the stream table shows from the applied Mass Balance, or nothing before one is applied. */
function tableMb(p: Project) {
  const cur = p.mb.current;
  if (!cur) return undefined;
  return { flows: flowValues(cur), scenarios: p.mb.scenarios.filter((s) => cur.scenarios.includes(s.id)), format: fmtQty };
}

/** Streams a drawing's stream table lists: all of them on the process map, a UO's own and its transfers in a UO drawing. */
export const streamsForScope = (scope: string, list: StreamInfo[]) =>
  scope === MAP ? list : list.filter((s) => s.uoId === scope || s.fromUoId === scope || s.toUoId === scope);

const isShapeEl = (e: BoardElement) => !["text", "arrow", "line", "freedraw", "frame", "magicframe", "image"].includes(e.type);

function selectionOf(api: Api): Selection {
  const st = api.getAppState();
  const map = new Map(api.getSceneElements().map((e) => [e.id, e as unknown as BoardElement]));
  let els = Object.keys(st.selectedElementIds).filter((id) => st.selectedElementIds[id]).map((id) => map.get(id)).filter(Boolean) as BoardElement[];
  // A text the app wrote stands for its container.
  els = [...new Set(els.map((e) => (e.type === "text" && e.containerId && map.get(e.containerId) && (pcsOf(e).label || pcsOf(e).boxLabel || pcsOf(e).portLabel) ? map.get(e.containerId)! : e)))];
  if (els.length === 0) return { kind: "none" };
  const one = (e: BoardElement): Selection | null => {
    if (e.type === "arrow") return { kind: "arrow", el: e };
    if (e.type === "frame") return { kind: "frame", el: e };
    if (e.type === "image" && pcsOf(e).table) return { kind: "table", el: e };
    if (isShapeEl(e) && pcsOf(e).kind === "uo") return { kind: "box", el: e };
    if (isShapeEl(e) && pcsOf(e).port) return { kind: "port", el: e };
    return null;
  };
  if (els.length === 1) return one(els[0]) ?? { kind: "shape", el: els[0], count: 1 };
  // A container with its own bound text selected along with it.
  const containers = els.filter((e) => e.type !== "text");
  if (containers.length === 1 && els.every((e) => e === containers[0] || e.containerId === containers[0].id)) return one(containers[0]) ?? { kind: "shape", el: containers[0], count: 1 };
  const g = els[0].groupIds?.[els[0].groupIds.length - 1];
  if (g && els.every((e) => e.groupIds?.includes(g))) {
    const body = els.find((e) => pcsOf(e).symbol) ?? els.find((e) => e.type !== "text") ?? els[0];
    return { kind: "shape", el: body, count: els.length };
  }
  return { kind: "many", count: els.length };
}

const selectionKey = (s: Selection) => (s.kind === "none" ? "none" : s.kind === "many" ? `many:${s.count}` :
  `${s.kind}:${s.el.id}:${(s.el as unknown as { version: number }).version}:${s.kind === "shape" ? s.count : ""}`);

export function PfdView(props: {
  project: Project;
  update: (fn: (p: Project) => Project) => void;
  confirm: (o: ConfirmOptions) => Promise<boolean>;
  toast: (msg: string) => void;
  /** Gives the app a way to read the board right now (used when the page is closing). */
  registerFlush?: (flush: () => PfdBoard | null) => void;
  /** Gives the app a way to show a stream (from the link check). */
  registerControl?: (control: PfdControl) => void;
  /** Open another screen. */
  goTo?: (area: Area) => void;
  /** Show a piece of equipment (or the Operations screen) from a shape's panel. */
  openOperations?: (equipmentId?: string, uoId?: string) => void;
  /** What an empty project shows on the process map (the start card), given a way to add a unit operation. */
  renderStart?: (addUnit: () => void) => ReactNode;
}) {
  const { project } = props;
  const propsRef = useRef(props);
  propsRef.current = props;
  const projectRef = useRef(project);
  projectRef.current = project;

  // The PFD model this view works on. It runs ahead of `project` between a change and the next
  // render, so two syncs in a row never start from a stale board or registry.
  const local = useRef<Model>({ uos: project.uos, streams: project.streams, pfd: project.pfd });
  const sent = useRef<Model>({ uos: project.uos, streams: project.streams, pfd: project.pfd });
  for (const k of ["uos", "streams", "pfd"] as const) {
    if (project[k] !== sent.current[k]) { (sent.current as Record<string, unknown>)[k] = project[k]; (local.current as Record<string, unknown>)[k] = project[k]; }
  }
  const commitModel = useCallback((patch: Partial<Model>) => {
    Object.assign(local.current, patch);
    Object.assign(sent.current, patch);
    propsRef.current.update((p) => ({ ...p, ...patch }));
  }, []);

  const [scope, setScope] = useState<string>(MAP);
  /** The unit operation being duplicated (dialog open). */
  const [dupOf, setDupOf] = useState<string | null>(null);
  /** Step view on the drawing (null = off). */
  const [stepView, setStepView] = useState<{ at: number } | null>(null);
  const [api, setApi] = useState<Api | null>(null);
  const scopeRef = useRef(scope);
  const apiRef = useRef<Api | null>(null);
  const lastVersion = useRef(-1);
  const lastFiles = useRef(-1);
  const lastBg = useRef("");
  const lastGrid = useRef<boolean | null>(null);
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const libraryHash = useRef<number>(getLibraryItemsHash(project.pfd.library as LibraryItems));
  const pendingFocus = useRef<string | null>(null);
  const [streams, setStreams] = useState<StreamInfo[]>([]);
  const [onMap, setOnMap] = useState<Set<string>>(new Set());
  const [selection, setSelection] = useState<Selection>({ kind: "none" });
  const panel = usePanelWidth("pfdPanel");
  const [exporting, setExporting] = useState(false);
  const selKey = useRef("none");

  /** Redraw stream tables on screen whose rows no longer match the streams (or the applied MB values). */
  const refreshStreamTables = useCallback((api: Api, list: StreamInfo[], uos: UnitOperation[]) => {
    const codeOf = (id?: string) => uos.find((u) => u.id === id)?.code ?? "?";
    const rows = streamTableRows(streamsForScope(scopeRef.current, list), codeOf, tableMb(projectRef.current));
    const all = api.getSceneElementsIncludingDeleted();
    const stale = all.filter((e) => !e.isDeleted && e.type === "image" && (pcsOf(e as unknown as BoardElement).table as TableData | undefined)?.kind === "stream" &&
      JSON.stringify((pcsOf(e as unknown as BoardElement).table as TableData).rows) !== JSON.stringify(rows));
    if (!stale.length) return;
    const files: BinaryFileData[] = [];
    const replaced = new Map<string, ExcalidrawElement>();
    for (const e of stale) {
      const { svg, w, h } = tableSvg(rows, [0]);
      const fileId = newId("tbl") as FileId;
      files.push({ id: fileId, mimeType: "image/svg+xml", dataURL: svgDataUrl(svg) as DataURL, created: Date.now() });
      const old = (pcsOf(e as unknown as BoardElement).table as TableData).size;
      const scale = old ? e.width / old.w : 1;
      replaced.set(e.id, bumped(e, { fileId, width: w * scale, height: h * scale, customData: { ...(e.customData ?? {}), pcs: { ...pcsOf(e as unknown as BoardElement), table: { kind: "stream", rows, size: { w, h } } } } } as never));
    }
    api.addFiles(files);
    api.updateScene({ elements: all.map((e) => replaced.get(e.id) ?? e), captureUpdate: CaptureUpdateAction.NEVER });
    dirty.current = true;
  }, []);

  /** Bring every drawing in line with the rules (IDs, labels, connectors, UO names) and store the result. */
  const runSync = useCallback(() => {
    const api = apiRef.current;
    const cur = scopeRef.current;
    const m = local.current;
    const sceneEls = api ? asBoard(api.getSceneElementsIncludingDeleted()) : null;
    const elsOf = (k: string) => (k === cur && sceneEls ? sceneEls : (sheetOf(m.pfd, k).elements as BoardElement[]));
    const sheets: Record<string, BoardElement[]> = {};
    for (const k of Object.keys(m.pfd.sheets)) sheets[k] = elsOf(k);
    const r = syncProject({ board: { map: elsOf(MAP), sheets }, uos: m.uos, registry: m.streams, now: new Date().toISOString(), valueLine: valueLines(projectRef.current) });

    let board = m.pfd;
    let boardChanged = dirty.current;
    for (const [k, changes] of Object.entries(r.changes)) {
      if (k !== MAP && !board.sheets[k]) continue;
      const applied = applyScope(elsOf(k), changes);
      const els = measureTexts(applied.elements, applied.texts);
      if (k === cur && api) api.updateScene({ elements: asExcal(els), captureUpdate: CaptureUpdateAction.NEVER });
      else board = withSheet(board, k, { ...sheetOf(board, k), elements: normalizeScene(els.filter((e) => !e.isDeleted)) });
      boardChanged = true;
    }
    // Every UO on the map has a drawing; a new one starts with its frame.
    let again = false;
    for (const u of r.uos) {
      if (!r.onMap.has(u.id) || board.sheets[u.id]) continue;
      board = withSheet(board, u.id, { elements: normalizeScene([frameJson(u.id, frameLabel(u))]), files: {} });
      boardChanged = again = true;
    }
    if (api) {
      refreshStreamTables(api, r.streams, r.uos);
      if (dirty.current) boardChanged = true;
    }
    dirty.current = false;
    const patch: Partial<Model> = {};
    if (boardChanged) patch.pfd = api ? withSheet(board, cur, { ...sheetFromScene(api) }) : board;
    if (r.uosChanged) patch.uos = r.uos;
    if (r.registryChanged) patch.streams = r.registry;
    if (Object.keys(patch).length) commitModel(patch);
    setStreams(r.streams);
    setOnMap((prev) => ([...prev].sort().join() === [...r.onMap].sort().join() ? prev : r.onMap));
    if (r.report.warnings.length) propsRef.current.toast(r.report.warnings[0]);
    if (again) schedule(0);
    if (pendingFocus.current && api) { const id = pendingFocus.current; pendingFocus.current = null; focusEl(api, id); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshStreamTables, commitModel]);

  const settle = useCallback(() => {
    timer.current = null;
    const api = apiRef.current;
    if (api && isInteracting(api.getAppState())) { timer.current = setTimeout(settle, 250); return; }
    runSync();
  }, [runSync]);

  const schedule = useCallback((ms = 250) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(settle, ms);
  }, [settle]);

  /** Run a pending sync now and store the drawing on screen (before switching drawings, or when the page closes). */
  const flushNow = useCallback((): PfdBoard => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    const api = apiRef.current;
    if (api && !isInteracting(api.getAppState())) runSync();
    if (api) {
      const k = scopeRef.current;
      const sheet = sheetFromScene(api);
      const board = withSheet(local.current.pfd, k, sheet);
      // Only a new view (scroll, zoom) is kept without marking the project changed.
      if (sheetSig(sheet) !== sheetSig(sheetOf(local.current.pfd, k)) || dirty.current) { dirty.current = false; commitModel({ pfd: board }); }
      else local.current.pfd = board;
    }
    return local.current.pfd;
  }, [runSync, commitModel]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  // Applying a Mass Balance or changing the label settings rewrites the labels and stream tables.
  const mbKey = `${project.mb.current?.id ?? ""}|${project.settings.labelMode}|${project.mb.activeScenario}`;
  const lastMbKey = useRef(mbKey);
  useEffect(() => {
    if (lastMbKey.current === mbKey) return;
    lastMbKey.current = mbKey;
    schedule(0);
  }, [mbKey, schedule]);

  // A tag changed or equipment was deleted elsewhere (Operations, an import): the labels on the drawings follow
  // (the tag is the first line of a symbol's label), and shapes of deleted equipment lose their link.
  const tagsRef = useRef(new Map(project.equipment.map((e) => [e.id, e.tag])));
  useEffect(() => {
    const prev = tagsRef.current;
    const next = new Map(project.equipment.map((e) => [e.id, e.tag]));
    tagsRef.current = next;
    const renamed = new Map<string, { from: string; to: string }>();
    const gone = new Map<string, string>();
    for (const [id, t] of prev) {
      if (!next.has(id)) gone.set(id, t);
      else if (next.get(id) !== t) renamed.set(id, { from: t, to: next.get(id)! });
    }
    if (!renamed.size && !gone.size) return;
    const fix = (els: BoardElement[]) => {
      let out = els;
      for (const e of els) {
        const id = pcsOf(e).equipmentId;
        if (!id || e.isDeleted) continue;
        const r = renamed.get(id);
        if (r) out = relabel(out, e.id, (lines) => (tagKey(lines[0] ?? "") === tagKey(r.from) ? [r.to, ...lines.slice(1)] : null));
        else if (gone.has(id)) {
          out = relabel(out, e.id, (lines) => (tagKey(lines[0] ?? "") === tagKey(gone.get(id)!) ? lines.slice(1) : null));
          out = out.map((x) => { if (x.id !== e.id) return x; const pcs = { ...pcsOf(x) }; delete pcs.equipmentId; return bumped(x, { customData: { ...(x.customData ?? {}), pcs } }); });
        }
      }
      return out;
    };
    const touched = (els: readonly unknown[]) => (els as BoardElement[]).some((e) => { const id = pcsOf(e).equipmentId; return !!id && (renamed.has(id) || gone.has(id)); });
    for (const k of [MAP, ...Object.keys(local.current.pfd.sheets)]) if (touched(liveOf(k))) editScope(k, fix, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.equipment]);

  useEffect(() => {
    props.registerFlush?.(() => flushNow());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flushNow]);

  const handleChange = (elements: readonly ExcalidrawElement[], appState: AppState, files: BinaryFiles) => {
    const version = getSceneVersion(elements);
    const fileCount = Object.keys(files).length;
    const changed = version !== lastVersion.current || fileCount !== lastFiles.current ||
      appState.viewBackgroundColor !== lastBg.current || appState.gridModeEnabled !== lastGrid.current;
    if (changed) {
      const first = lastVersion.current === -1;
      lastVersion.current = version;
      lastFiles.current = fileCount;
      lastBg.current = appState.viewBackgroundColor;
      lastGrid.current = appState.gridModeEnabled;
      if (!first) dirty.current = true;
      schedule(first ? 0 : 250);
    }
    const api = apiRef.current;
    if (api) {
      const sel = selectionOf(api);
      const key = selectionKey(sel);
      if (key !== selKey.current) { selKey.current = key; setSelection(sel); }
    }
  };

  const handleLibraryChange = (items: LibraryItems) => {
    const hash = getLibraryItemsHash(items);
    if (hash === libraryHash.current) return; // the editor reports the initial library too
    libraryHash.current = hash;
    commitModel({ pfd: { ...local.current.pfd, library: items as unknown[] } });
  };

  // ---- switching drawings -------------------------------------------------------------------
  const openScope = useCallback((next: string, focusId?: string) => {
    if (next !== MAP && !local.current.pfd.sheets[next]) return;
    if (next === scopeRef.current) { if (focusId && apiRef.current) focusEl(apiRef.current, focusId); return; }
    flushNow();
    apiRef.current = null;
    lastVersion.current = -1;
    lastFiles.current = -1;
    selKey.current = "none";
    pendingFocus.current = focusId ?? null;
    scopeRef.current = next;
    setSelection({ kind: "none" });
    setStepView(null);
    setApi(null);
    setScope(next);
  }, [flushNow]);

  // ---- editing any drawing --------------------------------------------------------------------
  const commit = useCallback((elements: readonly ExcalidrawElement[], extra?: Partial<AppState>) => {
    apiRef.current?.updateScene({ elements, ...(extra ? { appState: extra as AppState } : {}), captureUpdate: CaptureUpdateAction.IMMEDIATELY });
  }, []);

  /** Change the elements of a drawing, on screen (undoable unless `quiet`) or stored. */
  const editScope = useCallback((k: string, fn: (els: BoardElement[]) => BoardElement[], quiet = false) => {
    const api = apiRef.current;
    if (k === scopeRef.current && api) {
      api.updateScene({ elements: asExcal(fn(asBoard(api.getSceneElementsIncludingDeleted()))), captureUpdate: quiet ? CaptureUpdateAction.NEVER : CaptureUpdateAction.IMMEDIATELY });
      dirty.current = true;
    } else {
      const sheet = sheetOf(local.current.pfd, k);
      commitModel({ pfd: withSheet(local.current.pfd, k, { ...sheet, elements: normalizeScene(fn(sheet.elements as BoardElement[]).filter((e) => !e.isDeleted)) }) });
    }
  }, [commitModel]);

  const liveOf = (k: string): BoardElement[] => {
    const api = apiRef.current;
    if (k === scopeRef.current && api) return asBoard(api.getSceneElements());
    return (sheetOf(local.current.pfd, k).elements as BoardElement[]).filter((e) => !e.isDeleted);
  };

  /** A free spot on the map for a new UO box: right of the last box, on its row. */
  const nextBoxSpot = () => {
    const boxes = liveOf(MAP).filter((e) => isShapeEl(e) && pcsOf(e).kind === "uo");
    if (!boxes.length) {
      const api = apiRef.current;
      if (api && scopeRef.current === MAP) { const c = viewCenter(api.getAppState()); return { x: Math.round(c.x - BOX_W / 2), y: Math.round(c.y - 60) }; }
      return { x: 80, y: 80 };
    }
    const right = boxes.reduce((a, b) => (b.x + b.width > a.x + a.width ? b : a));
    return { x: Math.round(right.x + right.width + BOX_GAP), y: Math.round(right.y) };
  };

  const occupiedBoxes = (api: Api): Box[] =>
    api.getSceneElements().filter((e) => e.type !== "frame" && e.type !== "magicframe").map((e) => ({ x: e.x, y: e.y, width: e.width, height: e.height }));
  const frameAt = (api: Api, x: number, y: number) =>
    asBoard(api.getSceneElements()).find((e) => e.type === "frame" && x >= e.x && x <= e.x + e.width && y >= e.y && y <= e.y + e.height);

  const actions: PanelActions = {
    insertSymbol: (id) => {
      const api = apiRef.current;
      const def = symbolById(id);
      if (!api || !def) return;
      const c = viewCenter(api.getAppState());
      const frame = frameAt(api, c.x, c.y);
      // Measure the symbol, then drop it on a free spot near the centre (inside the frame when there is one).
      const probe = boundsOf(symbolElements(def, 0, 0, null) as unknown as Box[])!;
      const spot = freeSpot(occupiedBoxes(api), c.x - probe.width / 2, c.y - probe.height / 2, probe.width, probe.height, frame);
      const els = symbolElements(def, spot.x - probe.x, spot.y - probe.y, frame?.id ?? null);
      const gid = els[0].groupIds[0];
      commit([...api.getSceneElementsIncludingDeleted(), ...els], {
        selectedElementIds: Object.fromEntries(els.map((e) => [e.id, true])) as AppState["selectedElementIds"],
        selectedGroupIds: { [gid]: true },
      });
    },
    insertCustomSymbol: (id) => {
      const api = apiRef.current;
      const sym = projectRef.current.symbols.find((x) => x.id === id);
      if (!api || !sym) return;
      const c = viewCenter(api.getAppState());
      const frame = frameAt(api, c.x, c.y);
      const probe = boundsOf(customSymbolElements(sym, 0, 0, null).elements as unknown as Box[])!;
      const spot = freeSpot(occupiedBoxes(api), c.x - probe.width / 2, c.y - probe.height / 2, probe.width, probe.height, frame);
      const { elements: els, files } = customSymbolElements(sym, spot.x - probe.x, spot.y - probe.y, frame?.id ?? null);
      if (files.length) api.addFiles(files);
      const gid = els[0].groupIds[els[0].groupIds.length - 1];
      commit([...api.getSceneElementsIncludingDeleted(), ...els], {
        selectedElementIds: Object.fromEntries(els.map((e) => [e.id, true])) as AppState["selectedElementIds"],
        selectedGroupIds: { [gid]: true },
      });
    },
    uploadSymbols: async () => {
      const files = await pickFiles(".svg,.png,.jpg,.jpeg,.webp,.gif,.excalidrawlib,.json,image/svg+xml,image/png,image/jpeg,image/webp,image/gif");
      if (!files.length) return;
      const added: CustomSymbol[] = [];
      const problems: string[] = [];
      for (const f of files) {
        try {
          const type = f.type || (/\.svg$/i.test(f.name) ? "image/svg+xml" : "");
          if (IMAGE_TYPES.includes(type)) {
            if (f.size > MAX_IMAGE_BYTES) { problems.push(`${f.name}: larger than 2 MB`); continue; }
            const dataURL = await readDataUrl(type === f.type ? f : new Blob([await f.arrayBuffer()], { type }));
            const size = await imageSize(dataURL, type === "image/svg+xml" ? await f.text() : undefined);
            added.push(imageSymbol(nameFromFile(f.name), type, dataURL, size.width, size.height));
          } else if (/\.(json|excalidrawlib)$/i.test(f.name)) {
            const r = symbolsFromJson(await f.text());
            if (!r.kind) problems.push(`${f.name}: not a symbol set or an Excalidraw library`);
            else if (!r.symbols.length) problems.push(`${f.name}: no symbols in it`);
            added.push(...r.symbols);
          } else problems.push(`${f.name}: not a picture (SVG, PNG, JPEG, WebP) or a library file`);
        } catch (e) {
          problems.push(`${f.name}: ${(e as Error).message}`);
        }
      }
      if (added.length) {
        let result = { added: 0, skipped: 0 };
        propsRef.current.update((p) => { const m = mergeSymbols(p.symbols, added); result = m; return { ...p, symbols: m.symbols }; });
        setTimeout(() => propsRef.current.toast(`${result.added || added.length} symbol(s) added to the palette${problems.length ? `; ${problems.length} file(s) skipped: ${problems[0]}` : ""}`), 0);
      } else propsRef.current.toast(problems[0] ?? "No symbols found in the file(s)");
    },
    saveSelectionAsSymbol: (name, category) => {
      const api = apiRef.current;
      if (!api) return;
      const st = api.getAppState();
      const all = api.getSceneElements();
      const picked = new Set(Object.keys(st.selectedElementIds).filter((k) => st.selectedElementIds[k]));
      // Whole groups, and the texts bound to picked shapes, come along.
      const groups = new Set(Object.keys(st.selectedGroupIds ?? {}).filter((g) => st.selectedGroupIds[g]));
      for (const e of all) if (e.groupIds?.some((g) => groups.has(g))) picked.add(e.id);
      for (const e of all) if (e.type === "text" && e.containerId && picked.has(e.containerId)) picked.add(e.id);
      const els = all.filter((e) => picked.has(e.id) && e.type !== "frame");
      const sym = shapesSymbol(name, els, api.getFiles() as unknown as Record<string, unknown>, category);
      if (!sym) { propsRef.current.toast("Select the shapes to keep as a symbol first"); return; }
      propsRef.current.update((p) => ({ ...p, symbols: [...p.symbols, sym] }));
      propsRef.current.toast(`Saved “${sym.name}” in ${sym.category}`);
    },
    updateSymbol: (id, patch) => propsRef.current.update((p) => ({ ...p, symbols: p.symbols.map((x) => (x.id === id ? { ...x, ...patch } : x)) })),
    deleteSymbol: async (id) => {
      const sym = projectRef.current.symbols.find((x) => x.id === id);
      if (!sym) return;
      const ok = await propsRef.current.confirm({
        title: `Remove “${sym.name}” from the palette?`,
        body: "Copies already placed on the drawings stay as they are. Export the symbol set first if you want to keep it for other projects.",
        confirmLabel: "Remove symbol",
        danger: true,
      });
      if (ok) propsRef.current.update((p) => ({ ...p, symbols: p.symbols.filter((x) => x.id !== id) }));
    },
    exportSymbols: () => {
      const p = projectRef.current;
      downloadText(symbolSetJson(p.symbols), `${p.meta.name} symbols.json`);
    },
    insertFreeTable: () => insertTable({ kind: "free", rows: newFreeTable() }),
    insertStreamTable: () => {
      const codeOf = (uid?: string) => local.current.uos.find((u) => u.id === uid)?.code ?? "?";
      insertTable({ kind: "stream", rows: streamTableRows(streamsForScope(scopeRef.current, streams), codeOf, tableMb(projectRef.current)) });
    },
    addUnit: (name, open) => {
      const m = local.current;
      const uo: UnitOperation = { id: newId("uo"), code: suggestUoCode(name, new Set(m.uos.map((u) => u.code)), m.uos.length + 1), name, order: m.uos.length + 1 };
      const spot = nextBoxSpot();
      const box = boxJson(newId("box"), uo.id, spot.x, spot.y);
      commitModel({ uos: [...m.uos, uo], pfd: withSheet(m.pfd, uo.id, { elements: normalizeScene([frameJson(uo.id, frameLabel(uo))]), files: {} }) });
      editScope(MAP, (els) => [...els, box]);
      runSync();
      if (open) openScope(uo.id);
      else if (scopeRef.current === MAP) focusEl(apiRef.current!, box.id);
      propsRef.current.toast(`Added ${uo.code} · ${uo.name}`);
    },
    renameUnit: (uoId, code, name) => {
      const m = local.current;
      const uo = m.uos.find((u) => u.id === uoId);
      const c = code.trim().toUpperCase(), n = name.trim();
      if (!uo || !n || !isUoCode(c) || m.uos.some((u) => u.id !== uoId && u.code === c)) return;
      const next = { ...uo, code: c, name: n };
      // Write the new title where the app shows it, so the sync sees no typed change to undo.
      commitModel({ uos: m.uos.map((u) => (u.id === uoId ? next : u)) });
      editScope(MAP, (els) => {
        const boxIds = new Set(els.filter((e) => isShapeEl(e) && pcsOf(e).uoId === uoId).map((e) => e.id));
        return els.map((e) => (e.type === "text" && e.containerId && boxIds.has(e.containerId) && pcsOf(e).boxLabel ? bumped(e, { text: boxText(next), originalText: boxText(next) }) : e));
      }, true);
      if (local.current.pfd.sheets[uoId]) editScope(uoId, (els) => els.map((e) => (e.type === "frame" && pcsOf(e).uoId === uoId ? bumped(e, { name: frameLabel(next) }) : e)), true);
      runSync();
    },
    duplicateUnit: (uoId) => setDupOf(uoId),
    deleteUnit: async (uoId) => {
      const m = local.current;
      const uo = m.uos.find((u) => u.id === uoId);
      if (!uo) return;
      const n = streams.filter((s) => s.uoId === uoId || s.fromUoId === uoId || s.toUoId === uoId).length;
      const ok = await propsRef.current.confirm({
        title: `Delete ${uo.code} · ${uo.name}?`,
        body: `Its drawing, its box on the process map, its BOM lines and its steps (Operations) are deleted. ${n ? `Its ${n} stream ID(s), transfers included, are retired (never reused).` : ""} This cannot be undone.`,
        confirmLabel: "Delete unit operation",
        danger: true,
      });
      if (!ok) return;
      if (scopeRef.current === uoId) openScope(MAP);
      const sheets = { ...local.current.pfd.sheets };
      delete sheets[uoId];
      commitModel({ uos: local.current.uos.filter((u) => u.id !== uoId), pfd: { ...local.current.pfd, sheets } });
      editScope(MAP, (els) => {
        const gone = new Set(els.filter((e) => isShapeEl(e) && pcsOf(e).uoId === uoId).map((e) => e.id));
        return els.map((e) => (gone.has(e.id) || (e.containerId && gone.has(e.containerId)) ? bumped(e, { isDeleted: true }) : e));
      }, true);
      propsRef.current.update((p) => {
        const lines = { ...p.bom.lines };
        delete lines[uoId];
        return dropUnitOperations({ ...p, bom: { ...p.bom, lines } }, uoId);
      });
      runSync();
      propsRef.current.toast(`Deleted ${uo.code}`);
    },
    putOnMap: (uoId) => {
      const spot = nextBoxSpot();
      const box = boxJson(newId("box"), uoId, spot.x, spot.y);
      editScope(MAP, (els) => [...els, box]);
      runSync();
      if (scopeRef.current === MAP && apiRef.current) focusEl(apiRef.current, box.id);
    },
    openScope: (k) => openScope(k),
    patchPcs: (elementId, next) => {
      const clean = Object.fromEntries(Object.entries(next).filter(([, v]) => v !== undefined)) as PcsData;
      editScope(scopeRef.current, (els) => els.map((e) => (e.id === elementId ? bumped(e, { customData: { ...(e.customData ?? {}), pcs: clean } }) : e)));
    },
    setTag: (elementId, raw) => {
      const tag = raw.trim().replace(/\s+/g, " ");
      const k = scopeRef.current;
      const live = liveOf(k);
      const el = live.find((e) => e.id === elementId);
      if (!el) return;
      const pcs = pcsOf(el);
      const p = projectRef.current;
      const toast = propsRef.current.toast;
      const cur = pcs.equipmentId ? p.equipment.find((e) => e.id === pcs.equipmentId) : undefined;
      const shapes = equipmentShapes(local.current.pfd, { scope: k, elements: live });
      const copy = !!cur && (shapes.get(cur.id)?.length ?? 0) > 1;
      const setPcs = (els: BoardElement[], next: PcsData) => els.map((e) => (e.id === elementId ? bumped(e, { customData: { ...(e.customData ?? {}), pcs: next } }) : e));
      const first = (lines: string[]) => tagKey(lines[0] ?? "");
      if (!tag) {
        if (!cur) return;
        const next = { ...pcs };
        delete next.equipmentId;
        editScope(k, (els) => relabel(setPcs(els, next), elementId, (lines) => (first(lines) === tagKey(cur.tag) ? lines.slice(1) : null)));
        // Equipment that was only this shape and is in no step leaves the list with it.
        if (!copy && !equipmentUse(p, cur.id).size) propsRef.current.update((q) => ({ ...q, equipment: q.equipment.filter((e) => e.id !== cur.id) }));
        return;
      }
      const clash = p.equipment.find((e) => tagKey(e.tag) === tagKey(tag) && e.id !== cur?.id);
      if (cur && copy && tagKey(tag) === tagKey(cur.tag)) { toast(`${cur.tag} is on another shape too (this one is a copy): type a tag of its own`); return; }
      if (cur && !copy) {
        if (clash) { toast(`${clash.tag} is already the tag of other equipment${shapes.has(clash.id) ? " drawn on the PFD" : ""}: each tag is used once`); return; }
        if (cur.tag !== tag) propsRef.current.update((q) => ({ ...q, equipment: q.equipment.map((e) => (e.id === cur.id ? { ...e, tag } : e)) }));
        return;
      }
      let target: Equipment;
      if (clash) {
        const other = (shapes.get(clash.id) ?? []).find((s) => s.elementId !== elementId);
        if (other) { toast(`${clash.tag} is already on another shape (${other.scope === MAP ? "process map" : p.uos.find((u) => u.id === other.scope)?.code ?? "?"}): each tag goes on one shape`); return; }
        target = clash;
      } else {
        const label = symbolLabel(live, el);
        const sid = pcs.symbol;
        const symName = sid ? symbolById(sid)?.name ?? p.symbols.find((c) => c.id === sid)?.name : undefined;
        const labelText = label ? (label.originalText ?? label.text ?? "").split("\n").filter((l) => cur ? tagKey(l) !== tagKey(cur.tag) : true).join(" · ").trim() : "";
        const name = labelText || symName;
        target = { id: newId("eq"), tag, type: typeForSymbol(sid), ...(name ? { name } : {}), ...(k !== MAP ? { uoId: k } : {}) };
        propsRef.current.update((q) => ({ ...q, equipment: [...q.equipment, target] }));
      }
      editScope(k, (els) => relabel(setPcs(els, { ...pcs, equipmentId: target.id }), elementId, (lines) => {
        if (cur && first(lines) === tagKey(cur.tag)) return [target.tag, ...lines.slice(1)];
        return first(lines) === tagKey(target.tag) ? null : [target.tag, ...lines];
      }));
      if (clash) toast(`Linked to ${clash.tag} from the equipment list`);
    },
    openOperations: (equipmentId) => propsRef.current.openOperations?.(equipmentId),
    renameStream: (streamId, name) => {
      const s = streams.find((x) => x.streamId === streamId);
      if (!s) return;
      editScope(s.scope, (els) => els.map((e) => {
        if (e.id !== s.elementId) return e;
        const pcs = { ...pcsOf(e), name: name || undefined };
        if (!pcs.name) delete pcs.name;
        return bumped(e, { customData: { ...(e.customData ?? {}), pcs } });
      }));
      runSync();
    },
    focus: (elementId) => { if (apiRef.current) focusEl(apiRef.current, elementId); },
    focusStream: (streamId) => {
      const s = streams.find((x) => x.streamId === streamId);
      if (s) openScope(s.scope, s.elementId);
    },
    copyText: (text, what) => {
      navigator.clipboard?.writeText(text).then(() => propsRef.current.toast(`${what} copied — paste it into Excel`), () => propsRef.current.toast("Copying is blocked in this browser"));
    },
  };

  /**
   * A copy of a unit operation: its drawing (new Stream IDs from the sync), a box on the process map, and if
   * asked its steps (streams moved to the copy's, actions on its new equipment) and its BOM lines.
   */
  function duplicate(srcId: string, o: DuplicateOptions) {
    flushNow();
    const m = local.current;
    const src = m.uos.find((u) => u.id === srcId);
    if (!src) return;
    const p = projectRef.current;
    const nu: UnitOperation = { id: newId("uo"), code: o.code, name: o.name, order: Math.max(0, ...m.uos.map((u) => u.order)) + 1 };
    const srcSheet = sheetOf(m.pfd, srcId);
    const srcEls = (srcSheet.elements as BoardElement[]).filter((e) => !e.isDeleted);
    // Equipment: copies with new tags, or none (the copy's shapes then carry no tag).
    const eqMap = new Map<string, Equipment>();
    if (o.tags) {
      const taken = new Set(p.equipment.map((e) => tagKey(e.tag)));
      for (const e of ownEquipment({ ...p, pfd: m.pfd }, srcId)) {
        const tag = copyTag(e.tag, o.from, o.to, taken);
        taken.add(tagKey(tag));
        eqMap.set(e.id, { ...e, id: newId("eq"), tag, uoId: nu.id });
      }
    }
    const copied = copyDrawing(srcEls, { uoId: nu.id, frameName: frameLabel(nu), equipment: new Map([...eqMap].map(([k, v]) => [k, v.id])) });
    let els = copied.elements;
    for (const e of srcEls) {
      const old = pcsOf(e).equipmentId ? p.equipment.find((q) => q.id === pcsOf(e).equipmentId) : undefined;
      const to = copied.idMap.get(e.id);
      if (!old || !to) continue;
      const ne = eqMap.get(old.id);
      els = relabel(els, to, (lines) => (tagKey(lines[0] ?? "") === tagKey(old.tag) ? (ne ? [ne.tag, ...lines.slice(1)] : lines.slice(1)) : null));
    }
    commitModel({ uos: [...m.uos, nu], pfd: withSheet(m.pfd, nu.id, { elements: normalizeScene(els), files: { ...srcSheet.files } }) });
    const spot = nextBoxSpot();
    editScope(MAP, (x) => [...x, boxJson(newId("box"), nu.id, spot.x, spot.y)], true);
    runSync();
    // The copy's Stream IDs, matched arrow by arrow.
    const newEls = sheetOf(local.current.pfd, nu.id).elements as BoardElement[];
    const streamMap = new Map<string, string>();
    for (const e of srcEls) {
      const sid = pcsOf(e).streamId;
      if (e.type !== "arrow" || !sid || pcsOf(e).segment) continue;
      const ne = newEls.find((x) => x.id === copied.idMap.get(e.id));
      const nsid = ne ? pcsOf(ne).streamId : undefined;
      if (nsid) streamMap.set(sid, nsid);
    }
    const steps = o.steps ? (p.operations[srcId] ?? []).map((s): OpStep => {
      const c: OpStep = { ...structuredClone(s), id: newId("step"), actions: s.actions.map((a) => ({ ...a, equipmentId: eqMap.get(a.equipmentId)?.id ?? a.equipmentId })) };
      const streams = (s.streams ?? []).map((x) => streamMap.get(x)).filter((x): x is string => !!x);
      if (streams.length) c.streams = streams; else delete c.streams;
      return c;
    }) : [];
    const lines = o.bom ? p.bom.lines[srcId] ?? [] : [];
    propsRef.current.update((q) => ({
      ...q,
      equipment: [...q.equipment, ...eqMap.values()],
      operations: steps.length ? { ...q.operations, [nu.id]: steps } : q.operations,
      bom: lines.length ? { ...q.bom, lines: { ...q.bom.lines, [nu.id]: structuredClone(lines) } } : q.bom,
    }));
    openScope(nu.id);
    propsRef.current.toast(`${nu.code} made from ${src.code}: drawing (${streamMap.size} streams)${steps.length ? `, ${steps.length} steps` : ""}${lines.length ? `, ${lines.length} BOM lines` : ""}${eqMap.size ? `, ${eqMap.size} new tags` : ""}. Draw its transfers on the process map.`);
  }

  function insertTable(data: TableData) {
    const api = apiRef.current;
    if (!api) return;
    const { svg, w, h } = tableSvg(data.rows, data.kind === "stream" ? [0] : []);
    const fileId = newId("tbl") as FileId;
    api.addFiles([{ id: fileId, mimeType: "image/svg+xml", dataURL: svgDataUrl(svg) as DataURL, created: Date.now() }]);
    // The stream table goes under the drawing, left-aligned; a free table near the centre of the view, on a free spot.
    const content = boundsOf(occupiedBoxes(api));
    const c = viewCenter(api.getAppState());
    const at = data.kind === "stream" && content
      ? { x: Math.round(content.x), y: Math.round(content.y + content.height + 60) }
      : freeSpot(occupiedBoxes(api), c.x - w / 2, c.y - h / 2, w, h);
    const [img] = convertToExcalidrawElements([{ type: "image", x: at.x, y: at.y, width: w, height: h, fileId }], { regenerateIds: true });
    const el = { ...img, customData: { pcs: { table: { ...data, size: { w, h } } } } } as ExcalidrawElement;
    commit([...api.getSceneElementsIncludingDeleted(), el], { selectedElementIds: { [el.id]: true } as AppState["selectedElementIds"] });
    api.scrollToContent(el, { fitToViewport: false, animate: true });
  }

  function updateTable(elementId: string, rows: string[][]) {
    const api = apiRef.current;
    if (!api) return;
    const e = api.getSceneElements().find((x) => x.id === elementId);
    if (!e) return;
    const table = pcsOf(e as unknown as BoardElement).table as TableData;
    const { svg, w, h } = tableSvg(rows);
    const fileId = newId("tbl") as FileId;
    api.addFiles([{ id: fileId, mimeType: "image/svg+xml", dataURL: svgDataUrl(svg) as DataURL, created: Date.now() }]);
    const scale = table.size ? e.width / table.size.w : 1;
    const next = bumped(e, { fileId, width: w * scale, height: h * scale, customData: { ...(e.customData ?? {}), pcs: { ...pcsOf(e as unknown as BoardElement), table: { kind: "free", rows, size: { w, h } } } } } as never);
    commit(api.getSceneElementsIncludingDeleted().map((x) => (x.id === elementId ? next : x)));
  }

  const panelMb = useMemo(() => {
    const cur = project.mb.current;
    if (!cur) return undefined;
    const byStream = new Map<string, MbRow[]>();
    for (const r of cur.rows) byStream.set(r.streamId, [...(byStream.get(r.streamId) ?? []), r]);
    for (const list of byStream.values()) list.sort((a, b) => (a.matCode ? 1 : 0) - (b.matCode ? 1 : 0));
    return { scenarios: project.mb.scenarios.filter((s) => cur.scenarios.includes(s.id)), rowsOf: (id: string) => byStream.get(id) ?? [], format: fmtQty };
  }, [project.mb.current, project.mb.scenarios]);

  // What the panel shows for a shape with an equipment tag: the equipment, its shapes, its actions in the steps.
  const equipmentOf = (el: BoardElement): EquipmentInfo => {
    const id = pcsOf(el).equipmentId;
    const eq = id ? project.equipment.find((e) => e.id === id) : undefined;
    if (!eq) return { shapes: 0, uses: [] };
    const shapes = equipmentShapes(project.pfd, { scope, elements: liveOf(scope) }).get(eq.id)?.length ?? 0;
    const uses = [...project.uos].sort((a, b) => a.order - b.order).map((u) => ({
      uo: u.code,
      steps: (project.operations[u.id] ?? []).flatMap((s, i) => s.actions.filter((a) => a.equipmentId === eq.id).map((a) => ({ no: i + 1, name: s.name, text: actionText(eq, a.state) }))),
    })).filter((x) => x.steps.length);
    return { equipment: eq, shapes, uses };
  };

  // The link check can ask for a stream, on whichever drawing it is.
  useEffect(() => {
    props.registerControl?.({
      focusStream: (id) => {
        const s = streams.find((x) => x.streamId === id);
        if (s) openScope(s.scope, s.elementId);
      },
      openMap: () => openScope(MAP),
      focusElement: (scope, elementId) => openScope(scope, elementId),
      showStep: (uoId, index) => { openScope(uoId); setStepView({ at: index }); },
    });
  });
  const notApplied = workbookNotApplied(project);

  const tableEditor = selection.kind === "table" ? (
    (pcsOf(selection.el).table as TableData).kind === "stream"
      ? <p className="panel-hint">Stream table: it follows the stream list of this drawing (IDs, route, names). Drag a corner to resize.</p>
      : <TableEditor key={selection.el.id} rows={(pcsOf(selection.el).table as TableData).rows} onChange={(rows) => updateTable(selection.el.id, rows)} />
  ) : undefined;

  // Tabs: the process map, then a drawing per UO (in map order; UOs taken off the map last).
  const uos = project.uos;
  const sheetTabs = uos.filter((u) => project.pfd.sheets[u.id]);
  const current = scope === MAP ? undefined : uos.find((u) => u.id === scope);
  const sheet = sheetOf(local.current.pfd, scope);

  return (
    <div className="pfd-host" style={{ "--pfd-panel-w": `${panel.width}px` } as CSSProperties}>
      <div className="pfd-main">
        <div className="sheet-bar">
        <div className="sheet-tabs" role="tablist" aria-label="PFD drawings">
          <button role="tab" className="sheet-tab map" aria-selected={scope === MAP} onClick={() => openScope(MAP)}>Process map</button>
          {sheetTabs.map((u) => (
            <button key={u.id} role="tab" className={`sheet-tab${onMap.has(u.id) ? "" : " off"}`} aria-selected={scope === u.id} onClick={() => openScope(u.id)}
              title={onMap.has(u.id) ? `${u.code} · ${u.name}` : `${u.code} · ${u.name} — not on the process map`}>
              {/* The code on every tab; the open one also shows the name (all names are in the tooltips). */}
              <span className="mono">{u.code}</span><span className="sheet-tab-name"> {u.name}</span>
            </button>
          ))}
          <button className="sheet-tab add" onClick={() => actions.addUnit(`Unit operation ${uos.length + 1}`, true)} title="Add a unit operation (a box on the process map and its own drawing)">+ Unit operation</button>
        </div>
        <ScreenRibbon screen="pfd">
          <RibbonGroup label="Insert">
            <RibbonButton big icon="add" onClick={() => actions.addUnit(`Unit operation ${uos.length + 1}`, true)}
              title="A box on the process map and its own drawing (the same as + Unit operation)" label="Unit operation" />
            <RibbonStack>
              <RibbonButton icon="table" onClick={actions.insertStreamTable} disabled={!streamsForScope(scope, streams).length}
                title="A table of this drawing's streams (IDs, route, names, MB values) that follows the stream list" label="Stream table" />
              <RibbonButton icon="sheet" onClick={actions.insertFreeTable} title="A table you fill in yourself" label="Table" />
            </RibbonStack>
          </RibbonGroup>
          <RibbonGroup label="View">
            <RibbonButton big icon="fit" onClick={() => { const a = apiRef.current; if (a) fitView(a, true); }}
              title="Show the whole drawing in the window (Shift+1)" label="Fit" />
            {current && (project.operations[current.id] ?? []).length > 0 && (
              <RibbonButton big icon="steps" pressed={!!stepView} onClick={() => setStepView(stepView ? null : { at: 0 })}
                title="Show what each step does on this drawing: valves open or closed, pumps running, the streams of the step" label="Step view" />
            )}
          </RibbonGroup>
          <RibbonGroup label="Export">
            <RibbonButton big primary icon="slides" onClick={() => { flushNow(); setExporting(true); }} title="The process map and each unit operation on their own slides" label="Export to PowerPoint…" />
          </RibbonGroup>
        </ScreenRibbon>
        </div>
        <div className="pfd-canvas">
          <SheetCanvas
            key={`${project.id}:${scope}`}
            sheet={sheet}
            library={local.current.pfd.library}
            isMap={scope === MAP}
            onApi={(a) => {
              apiRef.current = a;
              setApi(a);
              // ?debug exposes the editor for browser tests.
              if (new URLSearchParams(window.location.search).has("debug")) {
                (window as unknown as { __pcsPfd: unknown }).__pcsPfd = {
                  get api() { return apiRef.current; },
                  scope: () => scopeRef.current,
                  open: (k: string) => openScope(k),
                  board: () => local.current.pfd,
                  /** Elements of every drawing (the one on screen as it is now). */
                  all: () => [MAP, ...Object.keys(local.current.pfd.sheets)].flatMap((k) =>
                    (k === scopeRef.current && apiRef.current ? apiRef.current.getSceneElements() : sheetOf(local.current.pfd, k).elements) as unknown[]),
                  convert: convertToExcalidrawElements,
                  /** The built-in symbols as inserted (no name label), laid out 4 × 3 per sheet at their drawing size inside a
                   *  light frame, and ways to picture them as the editor does and as the PowerPoint export does:
                   *  tools/compare-symbols-pptx.mjs compares the two. */
                  symbolSheets: (perRow = 4, rows = 3, cell = 200) => {
                    const sheets: { ids: string[]; names: string[]; elements: ExcalidrawElement[] }[] = [];
                    SYMBOLS.forEach((d, i) => {
                      const k = Math.floor(i / (perRow * rows)), at = i % (perRow * rows);
                      if (!sheets[k]) {
                        const frame = convertToExcalidrawElements([{ type: "rectangle", x: 0, y: 0, width: perRow * cell, height: rows * cell, strokeColor: "#d0d0d0", strokeWidth: 1, roughness: 0, backgroundColor: "transparent" }], { regenerateIds: true });
                        sheets[k] = { ids: [], names: [], elements: [...frame] };
                      }
                      const els = symbolElements({ ...d, label: "" }, 0, 0, null);
                      const [x1, y1, x2, y2] = getCommonBounds(els);
                      const cx = (at % perRow) * cell + cell / 2, cy = Math.floor(at / perRow) * cell + cell / 2;
                      sheets[k].ids.push(d.id); sheets[k].names.push(d.name);
                      sheets[k].elements.push(...els.map((e) => ({ ...e, x: e.x + cx - (x1 + x2) / 2, y: e.y + cy - (y1 + y2) / 2 }) as ExcalidrawElement));
                    });
                    return sheets;
                  },
                  png: async (elements: readonly ExcalidrawElement[], scale = 2) => {
                    const blob = await exportToBlob({
                      elements, files: null, exportPadding: 0, mimeType: "image/png",
                      appState: { exportBackground: true, viewBackgroundColor: "#ffffff" },
                      getDimensions: (w: number, h: number) => ({ width: w * scale, height: h * scale, scale }),
                    });
                    return await new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.readAsDataURL(blob); });
                  },
                  /** A PowerPoint deck (base64), one slide per sheet of elements, made by the real exporter. */
                  deck: async (sheets: { elements: readonly ExcalidrawElement[] }[]) => {
                    const list = sheets.map((sh, i) => ({ id: `sheet_${i + 1}`, code: `S${i + 1}`, name: `Symbols ${i + 1}`, elements: sh.elements }));
                    const p = { ...propsRef.current.project, uos: list.map((u) => ({ id: u.id, code: u.code, name: u.name })) } as unknown as Project;
                    const blob = await buildPfdDeck(p, { slides: list.map((u) => u.id), mode: "shapes", streamTables: false, sheet: (k) => ({ elements: list.find((u) => u.id === k)!.elements, files: {} }) });
                    return await new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",").pop() ?? ""); r.readAsDataURL(blob as Blob); });
                  },
                };
              }
            }}
            onChange={handleChange}
            onLibraryChange={handleLibraryChange}
            onAddUnit={() => actions.addUnit("Unit operation", false)}
            starting={scope === MAP && uos.length === 0 && !!props.renderStart}
          />
          {scope === MAP && uos.length === 0 && props.renderStart?.(() => actions.addUnit("Unit operation", false))}
          {notApplied && props.goTo && (
            <div className="pfd-banner" role="status">
              <span>{project.mb.current ? "The Mass Balance workbook changed after its values were applied: labels show the values applied before." : "The Mass Balance workbook is not applied yet: labels show Stream IDs only."}</span>
              <button className="btn small primary" onClick={() => props.goTo!("mb")}>Review and apply</button>
            </div>
          )}
          {stepView && api && current && (project.operations[current.id] ?? []).length > 0 && (
            <StepOverlay api={api} steps={project.operations[current.id]} equipment={project.equipment} uoCode={current.code}
              at={Math.min(stepView.at, project.operations[current.id].length - 1)} onAt={(at) => setStepView({ at })} onClose={() => setStepView(null)}
              onOpenOperations={() => props.openOperations?.(undefined, current.id)} />
          )}
          {current && !onMap.has(current.id) && (
            <div className="sheet-note">This unit operation is not on the process map. <button className="btn small" onClick={() => actions.putOnMap(current.id)}>Put it back</button></div>
          )}
        </div>
      </div>
      {dupOf && project.uos.some((u) => u.id === dupOf) && (
        <DuplicateUnitDialog project={{ ...project, pfd: local.current.pfd }} uo={project.uos.find((u) => u.id === dupOf)!} onCancel={() => setDupOf(null)}
          onDuplicate={(o) => { setDupOf(null); duplicate(dupOf, o); }} />
      )}
      {exporting && (
        <PptxExportDialog
          project={{ ...project, pfd: local.current.pfd }}
          sheet={(k) => {
            const key = k === "map" ? MAP : k;
            if (key === scopeRef.current && apiRef.current) return { elements: apiRef.current.getSceneElements(), files: apiRef.current.getFiles() as Record<string, unknown> };
            const sh = sheetOf(local.current.pfd, key);
            return { elements: sh.elements, files: sh.files };
          }}
          onClose={() => setExporting(false)}
          toast={props.toast}
        />
      )}
      <div className="pfd-resizer" {...panel.handle} />
      <PfdPanel
        scope={scope}
        uos={uos}
        onMap={onMap}
        hasSheet={(id) => !!project.pfd.sheets[id]}
        streams={streams}
        materials={project.materials}
        customSymbols={project.symbols}
        selection={selection}
        actions={actions}
        tableEditor={tableEditor}
        mb={panelMb}
        equipmentOf={equipmentOf}
      />
    </div>
  );
}

/** A picture's size: as the browser lays it out, else an SVG's width/height or viewBox, else 100 × 100. */
function imageSize(dataURL: string, svgText?: string): Promise<{ width: number; height: number }> {
  const fromSvg = () => {
    const tag = /<svg\b[^>]*>/i.exec(svgText ?? "")?.[0] ?? "";
    const num = (k: string) => Number(new RegExp(`\\b${k}\\s*=\\s*["']\\s*([\\d.]+)`).exec(tag)?.[1]);
    const vb = /viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(tag);
    const w = num("width") || Number(vb?.[1]), h = num("height") || Number(vb?.[2]);
    return w > 0 && h > 0 ? { width: w, height: h } : { width: 100, height: 100 };
  };
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(svgText ? fromSvg() : img.naturalWidth > 0 ? { width: img.naturalWidth, height: img.naturalHeight } : { width: 100, height: 100 });
    img.onerror = () => resolve(svgText ? fromSvg() : { width: 100, height: 100 });
    img.src = dataURL;
  });
}

/**
 * Show the drawing. `whole` (the Fit button): all of it in the window, not zoomed in past 100 %. Otherwise (a
 * drawing opened from a file): all of it if that keeps the text readable (zoom ≥ 50 %), else readable size from
 * its left edge, where a process starts — a long process map is then scrolled, not shrunk to unreadable boxes.
 */
const READABLE_ZOOM = 0.5;
function fitView(api: Api, whole: boolean) {
  const els = api.getSceneElements();
  if (!els.length) return;
  const st = api.getAppState();
  const [x1, y1, x2, y2] = getCommonBounds(els);
  const pad = 40;
  const fits = Math.min((st.width - 2 * pad) / Math.max(1, x2 - x1), (st.height - 2 * pad) / Math.max(1, y2 - y1), 1);
  if (whole || fits >= READABLE_ZOOM) {
    api.scrollToContent(els, { fitToViewport: true, viewportZoomFactor: 0.9, maxZoom: 1, minZoom: 0.1, animate: whole });
    return;
  }
  const z = READABLE_ZOOM;
  const tallFits = (y2 - y1) * z <= st.height - 2 * pad;
  api.updateScene({
    appState: { zoom: { value: z as AppState["zoom"]["value"] }, scrollX: pad / z - x1, scrollY: tallFits ? st.height / (2 * z) - (y1 + y2) / 2 : pad / z - y1 } as AppState,
    captureUpdate: CaptureUpdateAction.NEVER,
  });
}

function focusEl(api: Api, elementId: string) {
  const el = api.getSceneElements().find((e) => e.id === elementId);
  if (!el) return;
  api.updateScene({ appState: { selectedElementIds: { [el.id]: true } } as AppState, captureUpdate: CaptureUpdateAction.NEVER });
  api.scrollToContent(el, { fitToViewport: el.type === "frame", viewportZoomFactor: 0.8, animate: true });
}

/** One Excalidraw editor for one drawing. Mounted again (from the stored sheet) when the drawing changes. */
function SheetCanvas(props: {
  sheet: PfdSheet;
  library: unknown[];
  isMap: boolean;
  onApi: (api: Api) => void;
  onChange: (elements: readonly ExcalidrawElement[], appState: AppState, files: BinaryFiles) => void;
  onLibraryChange: (items: LibraryItems) => void;
  onAddUnit: () => void;
  /** The start card covers the middle of the empty process map: leave out the editor's own welcome text. */
  starting?: boolean;
}) {
  // A drawing without a saved position (opened from a file, or new) fits the window once it is on screen.
  const fitOnOpen = useRef(props.sheet.view?.scrollX === undefined && props.sheet.elements.length > 0);
  const onApi = (api: Api) => {
    props.onApi(api);
    if (!fitOnOpen.current) return;
    fitOnOpen.current = false;
    let tries = 0;
    const tryFit = () => {
      // The scene and the canvas size arrive a few frames after the editor.
      if (api.getSceneElements().length && api.getAppState().width > 0) fitView(api, false);
      else if (++tries < 60) requestAnimationFrame(tryFit);
    };
    requestAnimationFrame(tryFit);
  };
  const initialData = useMemo<ExcalidrawInitialDataState>(() => {
    const v = props.sheet.view ?? {};
    return {
      elements: props.sheet.elements as ExcalidrawElement[],
      files: props.sheet.files as BinaryFiles,
      libraryItems: props.library as LibraryItems,
      appState: {
        ...DRAWING_DEFAULTS,
        viewBackgroundColor: v.viewBackgroundColor ?? "#ffffff",
        gridModeEnabled: v.gridModeEnabled ?? true,
        ...(v.scrollX !== undefined ? { scrollX: v.scrollX, scrollY: v.scrollY } : {}),
        ...(v.zoom ? { zoom: { value: v.zoom as AppState["zoom"]["value"] } } : {}),
      },
      scrollToContent: v.scrollX === undefined,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <Excalidraw
      excalidrawAPI={onApi}
      initialData={initialData}
      onChange={props.onChange}
      onLibraryChange={props.onLibraryChange}
      langCode="en"
      theme="light"
      UIOptions={{ canvasActions: { loadScene: false, saveToActiveFile: false, export: false, toggleTheme: false } }}
    >
      <MainMenu>
        <MainMenu.DefaultItems.SaveAsImage />
        <MainMenu.DefaultItems.ChangeCanvasBackground />
        <MainMenu.DefaultItems.ToggleTheme />
        <MainMenu.Separator />
        <MainMenu.DefaultItems.Help />
      </MainMenu>
      {props.isMap && props.starting ? (
        <WelcomeScreen><WelcomeScreen.Hints.ToolbarHint>Draw an arrow from one unit operation box to another for a transfer</WelcomeScreen.Hints.ToolbarHint></WelcomeScreen>
      ) : props.isMap ? (
        <WelcomeScreen>
          <WelcomeScreen.Center>
            <WelcomeScreen.Center.Heading>Process map</WelcomeScreen.Center.Heading>
            <WelcomeScreen.Center.Menu>
              <WelcomeScreen.Center.MenuItem onSelect={props.onAddUnit}>Add a unit operation</WelcomeScreen.Center.MenuItem>
              <WelcomeScreen.Center.MenuItemHelp />
            </WelcomeScreen.Center.Menu>
          </WelcomeScreen.Center>
          <WelcomeScreen.Hints.ToolbarHint>Draw an arrow from one unit operation box to another for a transfer</WelcomeScreen.Hints.ToolbarHint>
          <WelcomeScreen.Hints.MenuHint>Export image, background color</WelcomeScreen.Hints.MenuHint>
          <WelcomeScreen.Hints.HelpHint>Shortcuts</WelcomeScreen.Hints.HelpHint>
        </WelcomeScreen>
      ) : <WelcomeScreen><WelcomeScreen.Hints.ToolbarHint>Shapes, arrows, pen, text and images</WelcomeScreen.Hints.ToolbarHint></WelcomeScreen>}
    </Excalidraw>
  );
}

function TableEditor(props: { rows: string[][]; onChange: (rows: string[][]) => void }) {
  const [rows, setRows] = useState(props.rows);
  const cols = Math.max(1, ...rows.map((r) => r.length));
  const norm = (rs: string[][]) => rs.map((r) => Array.from({ length: cols }, (_, i) => r[i] ?? ""));
  const save = (rs: string[][]) => { setRows(rs); props.onChange(rs); };
  return (
    <div className="table-editor">
      <div className="te-grid" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
        {norm(rows).map((r, i) => r.map((v, j) => (
          <input key={`${i}-${j}`} className={`cell-input${i === 0 ? " te-head" : ""}`} defaultValue={v} aria-label={`Row ${i + 1}, column ${j + 1}`}
            onBlur={(e) => { if (e.target.value !== v) { const next = norm(rows); next[i][j] = e.target.value; save(next); } }} />
        )))}
      </div>
      <div className="panel-actions">
        <button className="btn small" onClick={() => save([...norm(rows), Array(cols).fill("")])}>+ Row</button>
        <button className="btn small" disabled={rows.length <= 1} onClick={() => save(norm(rows).slice(0, -1))}>− Row</button>
        <button className="btn small" onClick={() => save(norm(rows).map((r) => [...r, ""]))}>+ Column</button>
        <button className="btn small" disabled={cols <= 1} onClick={() => save(norm(rows).map((r) => r.slice(0, -1)))}>− Column</button>
      </div>
      <p className="panel-hint">The first row is the header. Changes are drawn when a cell loses focus.</p>
    </div>
  );
}

