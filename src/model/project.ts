import { migrateBoardV1 } from "../pfd/migrate";
import { cleanSymbols } from "../pfd/customSymbols";
import { isUoCode, newId } from "./ids";
import { cleanMaterialRefs, readMaterialRefs } from "./recipes";
import { EQUIPMENT_TYPES, hasOperations } from "../ops/model";
import {
  PROJECT_FORMAT,
  PROJECT_VERSION,
  type Equipment,
  type EquipmentType,
  type OpAction,
  type OpStep,
  type BomLine,
  type BomRevision,
  type ScenarioValues,
  type LabelMode,
  type MassBalance,
  type PfdBoard,
  type PfdSheet,
  type PfdView,
  type Material,
  type Project,
  type QtySource,
  type Scenario,
  type UnitOperation,
} from "./types";

export const DEFAULT_SCENARIOS: Scenario[] = [
  { id: "sending", name: "Sending", column: "Sending" },
  { id: "receiving", name: "Receiving", column: "Receiving" },
];

export function emptyMassBalance(): MassBalance {
  return { scenarios: structuredClone(DEFAULT_SCENARIOS), activeScenario: "sending", current: null, history: [], workbook: null };
}

export function emptyBoard(): PfdBoard {
  return { map: { elements: [], files: {} }, sheets: {}, library: [] };
}

export function createProject(name = "New process", now = new Date().toISOString()): Project {
  return {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    id: newId("prj"),
    meta: { name, createdAt: now, updatedAt: now },
    materials: [],
    uos: [],
    pfd: emptyBoard(),
    streams: { seq: {}, active: {}, retired: [] },
    mb: emptyMassBalance(),
    bom: { lines: {} },
    symbols: [],
    equipment: [],
    operations: {},
    changeLog: [],
    settings: { labelMode: "id+both" },
  };
}

/**
 * The project as a file. A project with equipment or steps is written as v3, so an older app says
 * "saved by a newer version" instead of dropping them; one without is still v2 and opens anywhere.
 */
export function serializeProject(p: Project): string {
  return JSON.stringify({ ...p, version: hasOperations(p) ? PROJECT_VERSION : 2 });
}

export interface ParseResult {
  project: Project;
  /** Things that were repaired or ignored while reading. */
  notes: string[];
}

export class ProjectFileError extends Error {}

const isObj = (x: unknown): x is Record<string, unknown> => x !== null && typeof x === "object" && !Array.isArray(x);
const str = (x: unknown, fallback = ""): string => (typeof x === "string" ? x : x == null ? fallback : String(x));
const arr = <T = unknown>(x: unknown): T[] => (Array.isArray(x) ? (x as T[]) : []);

/**
 * Read a project file. Rejects files that are not projects or come from a newer version; repairs
 * small gaps (missing lists, missing ids) and reports what it repaired in `notes`.
 */
export function parseProject(text: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ProjectFileError("This is not JSON. Choose a PCS project file (.pcs.json).");
  }
  if (!isObj(raw) || raw.format !== PROJECT_FORMAT) {
    throw new ProjectFileError("This is not a PCS project file (format is not pcs-project).");
  }
  const version = Number(raw.version);
  if (!Number.isInteger(version) || version < 1) throw new ProjectFileError("Cannot read the project file version.");
  if (version > PROJECT_VERSION) {
    throw new ProjectFileError(`This file was saved by a newer version (v${version}). Update the app, then open it again.`);
  }

  const notes: string[] = [];
  const base = createProject();
  const meta = isObj(raw.meta) ? raw.meta : {};
  const p: Project = {
    ...base,
    id: str(raw.id) || base.id,
    meta: {
      name: str(meta.name) || "Untitled process",
      description: meta.description === undefined ? undefined : str(meta.description),
      createdAt: str(meta.createdAt) || base.meta.createdAt,
      updatedAt: str(meta.updatedAt) || base.meta.updatedAt,
    },
  };

  const seenIds = new Set<string>();
  const uniqueId = (id: unknown, prefix: string) => {
    let v = str(id);
    if (!v || seenIds.has(v)) v = newId(prefix);
    seenIds.add(v);
    return v;
  };

  p.materials = arr(raw.materials).filter(isObj).map((m) => {
    const out: Material = { id: uniqueId(m.id, "mat"), code: str(m.code).trim(), name: str(m.name).trim(), unit: str(m.unit).trim() };
    for (const k of ["category", "spec", "note", "supplier", "partNo"] as const) if (m[k] != null && m[k] !== "") out[k] = str(m[k]);
    if (typeof m.packSize === "number" && Number.isFinite(m.packSize) && m.packSize > 0) out.packSize = m.packSize;
    if (typeof m.overagePct === "number" && Number.isFinite(m.overagePct)) out.overagePct = m.overagePct;
    if (m.status === "review" || m.status === "obsolete") out.status = m.status;
    if (typeof m.replacedBy === "string" && m.replacedBy) out.replacedBy = m.replacedBy;
    Object.assign(out, readMaterialRefs(m));
    return out;
  });
  for (const m of p.materials) if (m.replacedBy && !p.materials.some((x) => x.id === m.replacedBy && x.id !== m.id)) delete m.replacedBy;
  const droppedRefs = cleanMaterialRefs(p.materials);
  if (droppedRefs) notes.push(`${droppedRefs} recipe component(s) or backup material(s) named a material that is not in the list (or had no quantity) and were left out.`);

  p.uos = arr(raw.uos).filter(isObj).map((u, i): UnitOperation => ({
    id: uniqueId(u.id, "uo"),
    code: str(u.code).trim().toUpperCase(),
    name: str(u.name).trim(),
    order: Number.isFinite(Number(u.order)) ? Number(u.order) : i + 1,
  }));

  const pfd = isObj(raw.pfd) ? raw.pfd : {};
  const sheetOf = (x: unknown): PfdSheet => {
    const o = isObj(x) ? x : {};
    return { elements: arr(o.elements), files: isObj(o.files) ? o.files : {}, ...(isObj(o.view) ? { view: o.view as PfdView } : {}) };
  };

  const streams = isObj(raw.streams) ? raw.streams : {};
  p.streams = {
    seq: isObj(streams.seq) ? (streams.seq as Record<string, number>) : {},
    active: isObj(streams.active) ? (streams.active as Project["streams"]["active"]) : {},
    retired: arr(streams.retired) as Project["streams"]["retired"],
  };

  if (version === 1) {
    // v1: one scene with a frame per unit operation. Convert it to a process map + one drawing per UO.
    p.pfd = migrateBoardV1({ elements: arr(pfd.elements), files: isObj(pfd.files) ? pfd.files : {}, library: arr(pfd.library) }, p.uos, p.streams);
    if (arr(pfd.elements).length) notes.push("Converted from project file v1: each unit operation now has its own drawing, and transfers are on the process map.");
  } else {
    const sheets: Record<string, PfdSheet> = {};
    const known = new Set(p.uos.map((u) => u.id));
    if (isObj(pfd.sheets)) {
      for (const [id, sh] of Object.entries(pfd.sheets)) {
        if (known.has(id)) sheets[id] = sheetOf(sh);
        else notes.push(`A PFD drawing without a unit operation (${id}) was left out.`);
      }
    }
    p.pfd = { map: sheetOf(pfd.map), sheets, library: arr(pfd.library) };
  }

  const mb = isObj(raw.mb) ? raw.mb : {};
  const scenarios = arr<Scenario>(mb.scenarios).filter((s) => isObj(s) && s.id && s.column);
  p.mb = {
    scenarios: scenarios.length ? scenarios : structuredClone(DEFAULT_SCENARIOS),
    activeScenario: str(mb.activeScenario) || "sending",
    current: isObj(mb.current) ? (mb.current as unknown as MassBalance["current"]) : null,
    history: arr(mb.history) as MassBalance["history"],
    workbook: isObj(mb.workbook) ? (mb.workbook as unknown as MassBalance["workbook"]) : null,
  };
  if (!p.mb.scenarios.some((s) => s.id === p.mb.activeScenario)) p.mb.activeScenario = p.mb.scenarios[0].id;

  const bom = isObj(raw.bom) ? raw.bom : {};
  p.bom = { lines: {} };
  if (isObj(bom.lines)) {
    for (const [uoId, list] of Object.entries(bom.lines)) {
      const lines = arr(list).filter(isObj).filter((l) => typeof l.materialId === "string").map((l) => {
        const line: BomLine = {
          materialId: l.materialId as string,
          qtySource: (["MB", "PFD", "manual"] as const).includes(l.qtySource as QtySource) ? (l.qtySource as QtySource) : "manual",
          manualQty: isObj(l.manualQty) ? Object.fromEntries(Object.entries(l.manualQty).map(([k, v]) => [k, typeof v === "number" && Number.isFinite(v) ? v : null])) : {},
        };
        if (typeof l.overagePct === "number" && Number.isFinite(l.overagePct)) line.overagePct = l.overagePct;
        if (typeof l.note === "string" && l.note) line.note = l.note;
        if (l.excluded === true) line.excluded = true;
        return line;
      });
      if (lines.length) p.bom.lines[uoId] = lines;
    }
  }
  const revisions = readRevisions(arr(bom.revisions));
  if (revisions.length) p.bom.revisions = revisions;

  const { symbols, dropped } = cleanSymbols(arr(raw.symbols));
  p.symbols = symbols;
  if (dropped) notes.push(`${dropped} PFD symbol(s) could not be read and were left out.`);

  const ops = readOperations(raw.equipment, raw.operations, new Set(p.uos.map((u) => u.id)));
  p.equipment = ops.equipment;
  p.operations = ops.operations;
  notes.push(...ops.notes);
  p.changeLog = arr(raw.changeLog).filter(isObj).filter((c) => typeof c.id === "string" && typeof c.at === "string" && Array.isArray(c.what))
    .map((c) => ({ id: c.id as string, at: c.at as string, screen: str(c.screen), what: (c.what as unknown[]).map((w) => str(w)), ...(typeof c.by === "string" && c.by ? { by: c.by } : {}) }))
    .slice(0, 1000);

  const settings = isObj(raw.settings) ? raw.settings : {};
  const labelMode = str(settings.labelMode) as LabelMode;
  p.settings = { labelMode: ["id", "id+active", "id+both"].includes(labelMode) ? labelMode : "id+both" };

  const issues = validateProject(p);
  if (issues.length) notes.push(...issues.map((i) => i.message));
  return { project: p, notes };
}

/** Saved BOM revisions as stored in a file: keep the well-formed ones, values as numbers or null. */
function readRevisions(list: unknown[]): BomRevision[] {
  const vals = (v: unknown): ScenarioValues => (isObj(v) ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, typeof x === "number" && Number.isFinite(x) ? x : null])) : {});
  const s = (v: unknown) => (typeof v === "string" ? v : "");
  return list.filter(isObj).filter((r) => typeof r.id === "string" && typeof r.label === "string" && Array.isArray(r.lines)).map((r) => {
    const rev: BomRevision = {
      id: r.id as string, label: r.label as string, createdAt: s(r.createdAt),
      scenarios: arr(r.scenarios).filter(isObj).map((x) => ({ id: s(x.id), name: s(x.name) })).filter((x) => x.id),
      lines: arr(r.lines).filter(isObj).filter((l) => typeof l.code === "string" && typeof l.uo === "string").map((l) => ({
        uo: l.uo as string, uoName: s(l.uoName), code: l.code as string, name: s(l.name), unit: s(l.unit), source: s(l.source), qty: vals(l.qty),
        ...(typeof l.category === "string" && l.category ? { category: l.category } : {}),
        ...(isObj(l.batches) ? { batches: vals(l.batches) } : {}),
        ...(typeof l.mid === "string" ? { mid: l.mid } : {}),
        ...(typeof l.uoId === "string" ? { uoId: l.uoId } : {}),
      })),
      totals: arr(r.totals).filter(isObj).filter((t) => typeof t.code === "string").map((t) => ({
        code: t.code as string, name: s(t.name), unit: s(t.unit), kind: t.kind === "prep" ? "prep" as const : "buy" as const, qty: vals(t.qty),
        ...(typeof t.mid === "string" ? { mid: t.mid } : {}),
        ...(typeof t.category === "string" && t.category ? { category: t.category } : {}),
      })),
    };
    if (typeof r.note === "string" && r.note) rev.note = r.note;
    if (typeof r.createdBy === "string" && r.createdBy) rev.createdBy = r.createdBy;
    if (typeof r.mbFile === "string" && r.mbFile) rev.mbFile = r.mbFile;
    return rev;
  });
}

/** Equipment and steps as stored: well-formed entries only, tags unique, actions on known equipment. */
function readOperations(rawEquipment: unknown, rawOps: unknown, uoIds: ReadonlySet<string>): { equipment: Equipment[]; operations: Record<string, OpStep[]>; notes: string[] } {
  const notes: string[] = [];
  const s = (v: unknown) => (typeof v === "string" ? v : "");
  const tags = new Set<string>();
  const ids = new Set<string>();
  const equipment: Equipment[] = [];
  let dupTags = 0;
  for (const e of arr(rawEquipment).filter(isObj)) {
    const tag = s(e.tag).trim();
    if (!tag || typeof e.id !== "string" || ids.has(e.id)) continue;
    if (tags.has(tag.toUpperCase())) { dupTags++; continue; }
    tags.add(tag.toUpperCase());
    ids.add(e.id);
    const out: Equipment = { id: e.id, tag, type: EQUIPMENT_TYPES.includes(e.type as EquipmentType) ? (e.type as EquipmentType) : "other" };
    for (const k of ["name", "initial", "note"] as const) if (typeof e[k] === "string" && e[k]) out[k] = e[k] as string;
    if (typeof e.uoId === "string" && uoIds.has(e.uoId)) out.uoId = e.uoId;
    equipment.push(out);
  }
  if (dupTags) notes.push(`${dupTags} piece(s) of equipment with a tag used twice were left out.`);
  const operations: Record<string, OpStep[]> = {};
  let dropped = 0;
  if (isObj(rawOps)) {
    for (const [uo, list] of Object.entries(rawOps)) {
      if (!uoIds.has(uo)) { if (arr(list).length) notes.push(`Steps of a unit operation that is not in the project (${uo}) were left out.`); continue; }
      const steps = arr(list).filter(isObj).filter((x) => typeof x.id === "string").map((x): OpStep => {
        const seen = new Set<string>();
        const actions = arr(x.actions).filter(isObj).filter((a) => {
          const ok = typeof a.equipmentId === "string" && ids.has(a.equipmentId) && typeof a.state === "string" && !seen.has(a.equipmentId);
          if (ok) seen.add(a.equipmentId as string); else dropped++;
          return ok;
        }).map((a): OpAction => ({ equipmentId: a.equipmentId as string, state: a.state as string, ...(typeof a.note === "string" && a.note ? { note: a.note } : {}) }));
        const step: OpStep = { id: x.id as string, name: s(x.name), actions };
        if (typeof x.minutes === "number" && Number.isFinite(x.minutes) && x.minutes >= 0) step.minutes = x.minutes;
        const streams = arr(x.streams).filter((v): v is string => typeof v === "string" && !!v);
        if (streams.length) step.streams = [...new Set(streams)];
        if (typeof x.note === "string" && x.note) step.note = x.note;
        return step;
      });
      if (steps.length) operations[uo] = steps;
    }
  }
  if (dropped) notes.push(`${dropped} action(s) on equipment that is not in the list were left out.`);
  return { equipment, operations, notes };
}

export interface ProjectIssue {
  level: "error" | "warning";
  where: "materials" | "uos" | "pfd" | "mb" | "bom";
  message: string;
}

/** Checks that hold for the whole project, independent of which screen is open. */
export function validateProject(p: Project): ProjectIssue[] {
  const issues: ProjectIssue[] = [];
  const codes = new Map<string, string>();
  for (const m of p.materials) {
    if (!m.code) issues.push({ level: "error", where: "materials", message: `Material '${m.name || m.id}' has no code.` });
    else if (codes.has(m.code)) issues.push({ level: "error", where: "materials", message: `Material code ${m.code} appears twice.` });
    else codes.set(m.code, m.id);
    if (!m.unit) issues.push({ level: "error", where: "materials", message: `Material ${m.code || m.name} has no unit.` });
  }
  const uoCodes = new Set<string>();
  for (const u of p.uos) {
    if (!isUoCode(u.code)) issues.push({ level: "error", where: "uos", message: `UO '${u.name}': code '${u.code}' must be 1–10 capital letters/digits with at least one letter.` });
    else if (uoCodes.has(u.code)) issues.push({ level: "error", where: "uos", message: `UO code ${u.code} appears twice.` });
    uoCodes.add(u.code);
  }
  return issues;
}

/**
 * The project without the zoom and scroll position saved with each drawing (background and grid stay): they were
 * right for the screen the file was saved on. Drawings without one fit the window they open in. Nothing else
 * changes: elements, Stream IDs, tags and every other part of the project are the same objects.
 */
export function withoutViewPositions(p: Project): Project {
  const strip = (sh: PfdSheet): PfdSheet => {
    if (!sh.view) return sh;
    const view: PfdView = {};
    if (sh.view.viewBackgroundColor !== undefined) view.viewBackgroundColor = sh.view.viewBackgroundColor;
    if (sh.view.gridModeEnabled !== undefined) view.gridModeEnabled = sh.view.gridModeEnabled;
    return { ...sh, view };
  };
  return { ...p, pfd: { ...p.pfd, map: strip(p.pfd.map), sheets: Object.fromEntries(Object.entries(p.pfd.sheets).map(([k, sh]) => [k, strip(sh)])) } };
}

/** Stamp the modification time (call on every user change). */
export function touch(p: Project, now = new Date().toISOString()): Project {
  return { ...p, meta: { ...p.meta, updatedAt: now } };
}

/** File name for saving: "<name>.pcs.json" with characters Windows rejects removed. */
export function projectFileName(p: Project): string {
  const safe = p.meta.name.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim() || "project";
  return `${safe}.pcs.json`;
}
