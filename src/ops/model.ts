/**
 * Operations: the steps of each unit operation and the actions in them (open or close a valve, start or
 * stop a pump). An action is a change of state at the start of a step; the state table (equipment ×
 * steps) is read from the actions, so both views always say the same thing.
 *
 * Linking keys: the equipment tag (a PFD shape carries the equipment id), and the Stream IDs a step uses.
 */
import { newId } from "../model/ids";
import type { Equipment, EquipmentType, OpAction, OpStep, PfdBoard, Project } from "../model/types";
import { MAP, pcsOf, type BoardElement } from "../pfd/sync";

export interface TypeInfo {
  label: string;
  /** The two states it switches between (first = active), or none: then actions are free text (events). */
  states: string[];
  initial: string;
  /** Words for switching to states[0] and states[1]. */
  verbs?: [string, string];
}

export const EQUIPMENT_TYPES: EquipmentType[] = ["valve", "pump", "agitator", "device", "vessel", "filter", "column", "instrument", "other"];

export const TYPE_INFO: Record<EquipmentType, TypeInfo> = {
  valve: { label: "Valve", states: ["Open", "Closed"], initial: "Closed", verbs: ["Open", "Close"] },
  pump: { label: "Pump", states: ["On", "Off"], initial: "Off", verbs: ["Start", "Stop"] },
  agitator: { label: "Agitator / mixer", states: ["On", "Off"], initial: "Off", verbs: ["Start", "Stop"] },
  device: { label: "Device (on/off)", states: ["On", "Off"], initial: "Off", verbs: ["Start", "Stop"] },
  vessel: { label: "Vessel / bag", states: [], initial: "" },
  filter: { label: "Filter", states: [], initial: "" },
  column: { label: "Column", states: [], initial: "" },
  instrument: { label: "Instrument", states: [], initial: "" },
  other: { label: "Other", states: [], initial: "" },
};

/** Equipment with two states keeps its state from step to step; for the others an action is an event in that step only. */
export const carries = (t: EquipmentType) => TYPE_INFO[t].states.length > 0;
export const initialOf = (e: Pick<Equipment, "type" | "initial">) => (carries(e.type) ? e.initial || TYPE_INFO[e.type].initial : "");
export const tagKey = (tag: string) => tag.trim().toUpperCase();

/** Words people write for the states, in English and Korean (Excel files, typing). */
const SYNONYMS: Record<string, string> = {
  open: "Open", opened: "Open", o: "Open", "열림": "Open", "열기": "Open", "개방": "Open",
  close: "Closed", closed: "Closed", c: "Closed", shut: "Closed", "닫힘": "Closed", "닫기": "Closed", "잠금": "Closed", "잠김": "Closed",
  on: "On", start: "On", started: "On", run: "On", running: "On", "켜기": "On", "켜짐": "On", "가동": "On", "운전": "On",
  off: "Off", stop: "Off", stopped: "Off", "끄기": "Off", "꺼짐": "Off", "정지": "Off",
};

/** A typed or imported state, in the type's own words when it is one of them (open → Open, 닫힘 → Closed). */
export function parseState(type: EquipmentType, raw: string): string {
  const s = raw.trim().replace(/\s+/g, " ");
  if (!s) return "";
  const canon = SYNONYMS[s.toLowerCase()];
  if (canon && TYPE_INFO[type].states.includes(canon)) return canon;
  const own = TYPE_INFO[type].states.find((x) => x.toLowerCase() === s.toLowerCase());
  return own ?? s;
}

/** "Open XV-101", "Stop P-101", or "XV-301: 50 %" for a value. */
export function actionText(eq: Pick<Equipment, "type" | "tag"> | undefined, state: string): string {
  if (!eq) return `(deleted equipment): ${state}`;
  const info = TYPE_INFO[eq.type];
  const i = info.states.indexOf(state);
  if (i >= 0 && info.verbs) return `${info.verbs[i]} ${eq.tag}`;
  return `${eq.tag}: ${state}`;
}

/** Whether a state is the "active" one (Open, On): shown in green. */
export const isActive = (type: EquipmentType, state: string) => carries(type) && state !== "" && state !== TYPE_INFO[type].states[1];

// ---- equipment from the PFD -------------------------------------------------------------------------------------------

const SYMBOL_TYPES: Record<string, EquipmentType> = {};
const put = (t: EquipmentType, ids: string) => { for (const id of ids.split(" ")) SYMBOL_TYPES[id] = t; };
put("valve", "valve valve3 pinch dvalve ballvalve bfvalve cvalve");
put("pump", "pump peristaltic diaphragm");
put("agitator", "agitator");
put("device", "centrifuge uvc chromskid cip tcu atf filling freezer lyo");
put("vessel", "bioreactor rocking flask tank jacketed mixtank bag bag3d sumixer bottle drum bagmanifold hopper vi bds");
put("filter", "filter depth sterile prefilter virus cartridge tff hollow madsorber ventfilter");
put("column", "column proa iex hic multicol");
put("instrument", "inst_p inst_f inst_t inst_ph inst_c inst_uv inst_l inst_do inst_w inst_mfc");

/** Type of the equipment a built-in symbol stands for ("other" for the rest and for the user's own symbols). */
export const typeForSymbol = (symbolId?: string): EquipmentType => (symbolId && SYMBOL_TYPES[symbolId]) || "other";

/** A guess from the tag's letters (XV-101 a valve, P-101 a pump …), for equipment typed in or imported. */
export function typeForTag(tag: string): EquipmentType {
  const m = /^([A-Za-z]+)/.exec(tag.trim());
  const p = m ? m[1].toUpperCase() : "";
  if (/^(XV|HV|FV|PV|CV|SV|AV|MV|BV|DV|PCV|FCV|LCV|TCV|VA|VLV)$/.test(p)) return "valve";
  if (/^(P|PU|PMP)$/.test(p)) return "pump";
  if (/^(AG|AGT|M|MX|MIX)$/.test(p)) return "agitator";
  if (/^(T|TK|TNK|BAG|BR|R|VES|SUB|SUM)$/.test(p)) return "vessel";
  if (/^(F|FLT|FIL|FT?R)$/.test(p)) return "filter";
  if (/^(C|COL|CL|K)$/.test(p)) return "column";
  if (/^(PI|PT|FI|FT|TI|TT|LI|LT|AI|AT|PH|CI|CT|UV|WI|WT|DO|FIC|TIC|PIC|LIC|QI)$/.test(p)) return "instrument";
  return "other";
}

export interface ShapeRef { scope: string; elementId: string }

/** Where each piece of equipment is drawn: equipment id → its shapes (more than one = a copy kept the tag). */
export function equipmentShapes(board: Pick<PfdBoard, "map" | "sheets">, live?: { scope: string; elements: readonly unknown[] }): Map<string, ShapeRef[]> {
  const out = new Map<string, ShapeRef[]>();
  const scan = (scope: string, els: readonly unknown[]) => {
    for (const raw of els) {
      const e = raw as BoardElement;
      if (e.isDeleted) continue;
      const id = pcsOf(e).equipmentId;
      if (id) out.set(id, [...(out.get(id) ?? []), { scope, elementId: e.id }]);
    }
  };
  const scopes: [string, readonly unknown[]][] = [[MAP, board.map.elements], ...Object.entries(board.sheets).map(([k, s]) => [k, s.elements] as [string, readonly unknown[]])];
  for (const [k, els] of scopes) scan(k, live && live.scope === k ? live.elements : els);
  return out;
}

// ---- the state table --------------------------------------------------------------------------------------------------

export interface Cell {
  /** State during the step ("" = nothing, for equipment without states). */
  state: string;
  /** The action at the start of this step, if any. */
  action?: OpAction;
  /** State before the step. */
  before: string;
  /** The action changes the state (an action to the state it already has is a check, not a change). */
  changed: boolean;
}

/** One piece of equipment through the steps. */
export function timeline(steps: readonly OpStep[], eq: Equipment): Cell[] {
  const carry = carries(eq.type);
  let cur = initialOf(eq);
  return steps.map((s) => {
    const a = s.actions.find((x) => x.equipmentId === eq.id);
    const before = cur;
    if (!a) return { state: carry ? cur : "", before, changed: false };
    if (carry) cur = a.state;
    return { state: a.state, action: a, before, changed: !carry || a.state !== before };
  });
}

/**
 * Equipment shown in a unit operation's state table: what its actions use, then what belongs to it
 * (drawn in its drawing or set to it), valves first, then pumps, agitators … and by tag.
 */
export function tableEquipment(p: Pick<Project, "equipment">, steps: readonly OpStep[], uoId: string, extra: readonly string[] = []): Equipment[] {
  const used = new Set(steps.flatMap((s) => s.actions.map((a) => a.equipmentId)));
  const list = p.equipment.filter((e) => used.has(e.id) || e.uoId === uoId || extra.includes(e.id));
  return list.sort((a, b) => EQUIPMENT_TYPES.indexOf(a.type) - EQUIPMENT_TYPES.indexOf(b.type) || a.tag.localeCompare(b.tag, undefined, { numeric: true }));
}

/**
 * Set what a piece of equipment does in step `i`: `state` "" removes the action. For equipment that keeps
 * its state, setting the state it already has removes the action too (unless the action has a note).
 */
export function setCell(steps: readonly OpStep[], i: number, eq: Equipment, state: string): OpStep[] {
  const cell = timeline(steps, eq)[i];
  if (!cell) return [...steps];
  const s = steps[i];
  const has = s.actions.findIndex((a) => a.equipmentId === eq.id);
  const remove = state === "" || (carries(eq.type) && state === cell.before && !s.actions[has]?.note);
  let actions: OpAction[];
  if (remove) actions = s.actions.filter((a) => a.equipmentId !== eq.id);
  else if (has >= 0) actions = s.actions.map((a, j) => (j === has ? { ...a, state } : a));
  else actions = [...s.actions, { equipmentId: eq.id, state }];
  return steps.map((x, j) => (j === i ? { ...x, actions } : x));
}

/** A click on a cell: switch to the other state (equipment without two states is not switched). */
export function toggleCell(steps: readonly OpStep[], i: number, eq: Equipment): OpStep[] {
  const info = TYPE_INFO[eq.type];
  if (!info.states.length) return [...steps];
  const cell = timeline(steps, eq)[i];
  if (!cell) return [...steps];
  return setCell(steps, i, eq, cell.state === info.states[0] ? info.states[1] : info.states[0]);
}

/** Add or change an action from the step list (kept even when the state does not change: "Close XV-101" as a check). */
export function putAction(steps: readonly OpStep[], i: number, action: OpAction): OpStep[] {
  return steps.map((s, j) => {
    if (j !== i) return s;
    const has = s.actions.findIndex((a) => a.equipmentId === action.equipmentId);
    return { ...s, actions: has >= 0 ? s.actions.map((a, k) => (k === has ? { ...a, ...action } : a)) : [...s.actions, action] };
  });
}

export const removeAction = (steps: readonly OpStep[], i: number, equipmentId: string): OpStep[] =>
  steps.map((s, j) => (j === i ? { ...s, actions: s.actions.filter((a) => a.equipmentId !== equipmentId) } : s));

export const moveAction = (steps: readonly OpStep[], i: number, from: number, to: number): OpStep[] =>
  steps.map((s, j) => {
    if (j !== i || to < 0 || to >= s.actions.length) return s;
    const a = [...s.actions];
    const [x] = a.splice(from, 1);
    a.splice(to, 0, x);
    return { ...s, actions: a };
  });

// ---- steps ------------------------------------------------------------------------------------------------------------

export const newStep = (name = "", extra: Partial<OpStep> = {}): OpStep => ({ id: newId("step"), name, actions: [], ...extra });

export function moveStep(steps: readonly OpStep[], from: number, to: number): OpStep[] {
  if (to < 0 || to >= steps.length) return [...steps];
  const a = [...steps];
  const [x] = a.splice(from, 1);
  a.splice(to, 0, x);
  return a;
}

/** A copy of step i right after it (actions included). */
export function duplicateStep(steps: readonly OpStep[], i: number): OpStep[] {
  const s = steps[i];
  if (!s) return [...steps];
  const copy: OpStep = { ...structuredClone(s), id: newId("step"), name: `${s.name} (copy)` };
  return [...steps.slice(0, i + 1), copy, ...steps.slice(i + 1)];
}

/** Start time of each step and the total, in minutes (steps without a duration count 0). */
export function startTimes(steps: readonly OpStep[]): { starts: number[]; total: number; missing: number } {
  let t = 0;
  let missing = 0;
  const starts = steps.map((s) => { const at = t; if (typeof s.minutes === "number" && s.minutes > 0) t += s.minutes; else missing++; return at; });
  return { starts, total: t, missing };
}

/** 0:00 style (hours:minutes). */
export const hhmm = (min: number) => `${Math.floor(min / 60)}:${String(Math.round(min % 60)).padStart(2, "0")}`;
/** "4 h 30 min", "45 min". */
export const durationText = (min: number) => (min >= 60 ? `${Math.floor(min / 60)} h${min % 60 ? ` ${Math.round(min % 60)} min` : ""}` : `${Math.round(min)} min`);

/** Steps people start from (names only: equipment differs from plant to plant). */
export const TEMPLATES: { id: string; name: string; steps: [string, number?][] }[] = [
  { id: "bindelute", name: "Chromatography, bind and elute", steps: [["Sanitize", 30], ["Equilibrate", 20], ["Load", 120], ["Wash 1", 20], ["Wash 2", 20], ["Elute", 30], ["Strip", 20], ["Sanitize", 30], ["Store", 15]] },
  { id: "flowthrough", name: "Chromatography, flow-through", steps: [["Sanitize", 30], ["Equilibrate", 20], ["Load and collect", 120], ["Chase", 20], ["Strip", 20], ["Sanitize", 30], ["Store", 15]] },
  { id: "ufdf", name: "UF/DF (TFF)", steps: [["Flush", 30], ["Equilibrate", 15], ["Concentrate 1", 60], ["Diafilter", 120], ["Concentrate 2", 30], ["Recover", 20], ["Clean", 45], ["Store", 15]] },
  { id: "vf", name: "Virus filtration", steps: [["Flush", 20], ["Pre-use integrity test", 30], ["Equilibrate", 10], ["Filter", 180], ["Buffer chase", 15], ["Post-use integrity test", 30]] },
  { id: "depth", name: "Depth or sterile filtration", steps: [["Flush", 20], ["Equilibrate", 10], ["Filter", 60], ["Chase", 10], ["Blow down", 5]] },
  { id: "prep", name: "Buffer or media preparation", steps: [["Fill WFI", 30], ["Add components", 30], ["Mix", 30], ["Adjust pH and conductivity", 20], ["Sample and release", 30], ["Transfer through filter", 30]] },
  { id: "vi", name: "Low-pH viral inactivation", steps: [["Titrate to low pH", 20], ["Hold", 60], ["Neutralize", 20], ["Sample", 10]] },
  { id: "transfer", name: "Hold and transfer", steps: [["Transfer in", 30], ["Mix", 15], ["Hold", 60], ["Transfer out", 30]] },
  { id: "bioreactor", name: "Bioreactor", steps: [["Media fill", 60], ["Condition", 240], ["Inoculate", 30], ["Culture", 20160], ["Harvest", 240]] },
];

export const templateSteps = (id: string): OpStep[] =>
  (TEMPLATES.find((t) => t.id === id)?.steps ?? []).map(([name, minutes]) => newStep(name, minutes ? { minutes } : {}));

// ---- streams of a unit operation ----------------------------------------------------------------------------------------

export interface UoStream { id: string; dir: "inside" | "in" | "out" }

/** The Stream IDs a step of this unit operation can use: its own streams and its transfers in and out. */
export function uoStreams(p: Pick<Project, "streams">, uoId: string): UoStream[] {
  const out: UoStream[] = [];
  for (const [id, o] of Object.entries(p.streams.active)) {
    if (o.kind === "pfd" && o.uoId === uoId) out.push({ id, dir: "inside" });
    else if (o.kind === "transfer" && o.toUoId === uoId) out.push({ id, dir: "in" });
    else if (o.kind === "transfer" && o.fromUoId === uoId) out.push({ id, dir: "out" });
  }
  const rank = { in: 0, inside: 1, out: 2 };
  return out.sort((a, b) => rank[a.dir] - rank[b.dir] || a.id.localeCompare(b.id, undefined, { numeric: true }));
}

/** The flow of a stream in the applied mass balance, for one scenario: "1,900 L" (null when it has none). */
export function streamFlow(p: Pick<Project, "mb">, streamId: string, scenarioId = p.mb.activeScenario): { value: number; unit: string } | null {
  const row = p.mb.current?.rows.find((r) => r.streamId === streamId && !r.matCode);
  const v = row?.values[scenarioId];
  return row && typeof v === "number" ? { value: v, unit: row.unit } : null;
}

// ---- equipment edits that reach the rest of the project ---------------------------------------------------------------------

/** Where a piece of equipment is used: unit operation id → step numbers (1-based). */
export function equipmentUse(p: Pick<Project, "operations">, equipmentId: string): Map<string, number[]> {
  const out = new Map<string, number[]>();
  for (const [uo, steps] of Object.entries(p.operations)) {
    steps.forEach((s, i) => { if (s.actions.some((a) => a.equipmentId === equipmentId)) out.set(uo, [...(out.get(uo) ?? []), i + 1]); });
  }
  return out;
}

/** Remove equipment and its actions (the PFD shapes keep their drawing; their link is dropped when they are next seen). */
export function deleteEquipment<P extends Pick<Project, "equipment" | "operations">>(p: P, ids: readonly string[]): P {
  const gone = new Set(ids);
  return {
    ...p,
    equipment: p.equipment.filter((e) => !gone.has(e.id)),
    operations: Object.fromEntries(Object.entries(p.operations).map(([uo, steps]) => [uo, steps.map((s) => (s.actions.some((a) => gone.has(a.equipmentId)) ? { ...s, actions: s.actions.filter((a) => !gone.has(a.equipmentId)) } : s))])),
  };
}

/** A unit operation was deleted: its steps go; its own equipment goes unless another unit operation uses it. */
export function dropUnitOperations<P extends Pick<Project, "equipment" | "operations">>(p: P, uoId: string): P {
  const operations = { ...p.operations };
  delete operations[uoId];
  const usedElsewhere = new Set(Object.values(operations).flatMap((steps) => steps.flatMap((s) => s.actions.map((a) => a.equipmentId))));
  const own = p.equipment.filter((e) => e.uoId === uoId);
  const next = deleteEquipment({ ...p, operations }, own.filter((e) => !usedElsewhere.has(e.id)).map((e) => e.id));
  return { ...next, equipment: next.equipment.map((e) => { if (e.uoId !== uoId) return e; const c = { ...e }; delete c.uoId; return c; }) };
}

/** True when the project has anything for the Operations screen (the file is then written as v3). */
export const hasOperations = (p: Pick<Project, "equipment" | "operations">) => p.equipment.length > 0 || Object.values(p.operations).some((s) => s.length > 0);
