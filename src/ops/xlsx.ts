/**
 * Operations in Excel: export (About, Equipment, Steps, Actions and a States sheet per unit operation)
 * and import (the same sheets, as exported or filled in by hand; Korean headers work too).
 */
import { newId } from "../model/ids";
import type { Equipment, EquipmentType, OpAction, OpStep, Project } from "../model/types";
import { streamNamesOf } from "../pfd/sync";
import type { SheetSpec } from "../xlsx/workbook";
import {
  EQUIPMENT_TYPES, TYPE_INFO, actionText, carries, equipmentShapes, initialOf, isActive, newStep, parseState,
  startTimes, tableEquipment, tagKey, timeline, typeForTag, uoStreams,
} from "./model";

const GREEN = "D9F2E0";
const sorted = (p: Project) => [...p.uos].sort((a, b) => a.order - b.order);

/** The Operations workbook: everything on the Operations screen, readable on its own and importable again. */
export function operationsSheets(p: Project, now = new Date()): SheetSpec[] {
  const uoCode = (id?: string) => p.uos.find((u) => u.id === id)?.code ?? "";
  const shapes = equipmentShapes(p.pfd);
  const names = streamNamesOf(p.pfd);
  const eqById = new Map(p.equipment.map((e) => [e.id, e]));
  const uos = sorted(p).filter((u) => (p.operations[u.id] ?? []).length);

  const sheets: SheetSpec[] = [{
    name: "About", header: ["Item", "Value"], widths: [18, 120],
    rows: [
      ["Project", p.meta.name],
      ["Exported", now.toISOString().slice(0, 16).replace("T", " ")],
      ["Sheets", "Equipment: the tags. Steps: the steps of each unit operation, with their streams. Actions: what is done at the start of each step, in order. States <code>: the state of each piece of equipment in each step."],
      ["Import", "Operations › Import from Excel reads Equipment and Steps, and the actions from each States sheet (or from Actions when a unit operation has no States sheet). Edit whichever you like: when the two disagree, the States sheet is used."],
      ["States", "Valves: Open / Closed. Pumps, agitators and devices: On / Off. A value (150 rpm, 50 %) works too. In a States sheet an empty cell keeps the state of the step before; for vessels, filters and others a cell is something done in that step only."],
    ],
  }];

  sheets.push({
    name: "Equipment", header: ["Tag", "Type", "Name", "Unit operation", "Initial state", "On PFD", "Note"], widths: [14, 18, 34, 16, 14, 10, 40],
    rows: [...p.equipment].sort((a, b) => a.tag.localeCompare(b.tag, undefined, { numeric: true })).map((e) => [
      e.tag, TYPE_INFO[e.type].label, e.name ?? "", uoCode(e.uoId), carries(e.type) ? initialOf(e) : "", shapes.has(e.id) ? "Yes" : "No", e.note ?? "",
    ]),
  });

  const stepRows: (string | number | null)[][] = [];
  const actionRows: (string | number | null)[][] = [];
  for (const u of uos) {
    const steps = p.operations[u.id];
    const { starts } = startTimes(steps);
    steps.forEach((s, i) => {
      stepRows.push([u.code, i + 1, s.name, s.minutes ?? null, starts[i], (s.streams ?? []).join(", "), (s.streams ?? []).map((id) => names.get(id) ?? "").join("; "), s.note ?? ""]);
      for (const a of s.actions) {
        const eq = eqById.get(a.equipmentId);
        actionRows.push([u.code, i + 1, s.name, actionText(eq, a.state), eq?.tag ?? "", a.state, a.note ?? ""]);
      }
    });
  }
  sheets.push({ name: "Steps", header: ["Unit operation", "No.", "Step", "Minutes", "Starts at (min)", "Streams", "Stream names", "Note"], widths: [16, 6, 30, 10, 15, 34, 44, 40], rows: stepRows });
  sheets.push({ name: "Actions", header: ["Unit operation", "No.", "Step", "Action", "Tag", "State", "Note"], widths: [16, 6, 30, 22, 14, 14, 40], rows: actionRows });

  for (const u of uos) {
    const steps = p.operations[u.id];
    const eqs = tableEquipment(p, steps, u.id);
    const cells = eqs.map((e) => timeline(steps, e));
    sheets.push({
      name: `States ${u.code}`.slice(0, 31),
      header: ["Tag", "Equipment", "Initial", ...steps.map((s, i) => `${i + 1}. ${s.name}`)],
      widths: [14, 30, 10, ...steps.map((s) => Math.max(12, Math.min(26, s.name.length + 5)))],
      rows: eqs.map((e, r) => [e.tag, e.name ?? TYPE_INFO[e.type].label, initialOf(e) || null, ...cells[r].map((c) => c.state || null)]),
      cellStyles: (r, c) => {
        if (c < 3) return undefined;
        const cell = cells[r][c - 3];
        if (!cell?.state) return undefined;
        return { ...(isActive(eqs[r].type, cell.state) ? { fill: GREEN } : {}), ...(cell.action ? { bold: true } : { muted: true }) };
      },
    });
  }
  return sheets;
}

// ---- import -------------------------------------------------------------------------------------------------------------

export interface OpsImportUo { uoId: string; code: string; steps: OpStep[]; before: number; actionsFrom: "States" | "Actions" | "none" }
export interface OpsImportPlan {
  equipmentAdd: Equipment[];
  equipmentUpdate: { id: string; tag: string; patch: Partial<Equipment> }[];
  uos: OpsImportUo[];
  problems: string[];
  actionCount: number;
}

const HEAD: Record<string, string[]> = {
  tag: ["tag", "태그", "equipment tag", "설비 태그"],
  type: ["type", "유형", "종류"],
  name: ["name", "equipment", "이름", "설비", "설비명"],
  uo: ["unit operation", "uo", "단위공정", "공정"],
  initial: ["initial state", "initial", "초기 상태", "초기상태", "초기"],
  note: ["note", "비고", "메모"],
  no: ["no.", "no", "#", "번호", "순서", "step no."],
  step: ["step", "단계", "단계명", "step name"],
  minutes: ["minutes", "min", "분", "시간(분)", "duration (min)"],
  streams: ["streams", "stream", "stream ids", "스트림"],
  state: ["state", "상태"],
};
const TYPE_WORDS: Record<string, EquipmentType> = {
  "밸브": "valve", "펌프": "pump", "교반기": "agitator", "임펠러": "agitator", "믹서": "agitator", "장치": "device", "용기": "vessel", "탱크": "vessel", "백": "vessel",
  "필터": "filter", "컬럼": "column", "칼럼": "column", "계기": "instrument", "센서": "instrument", "기타": "other",
};

function parseType(s: string): EquipmentType | null {
  const v = s.trim().toLowerCase();
  if (!v) return null;
  const byId = EQUIPMENT_TYPES.find((t) => t === v || TYPE_INFO[t].label.toLowerCase() === v || TYPE_INFO[t].label.toLowerCase().split(/\s*[/(]\s*/)[0] === v);
  return byId ?? TYPE_WORDS[s.trim()] ?? null;
}

/** Column index of each known header in a sheet's first row. */
function columns(head: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  head.forEach((h, i) => {
    const v = h.trim().toLowerCase();
    for (const [k, words] of Object.entries(HEAD)) if (out[k] === undefined && words.includes(v)) out[k] = i;
  });
  return out;
}

const num = (s: string) => { const v = Number(s.replace(/,/g, "").trim()); return s.trim() !== "" && Number.isFinite(v) ? v : undefined; };

/** What importing the workbook would change. `error` when the file has none of the sheets. */
export function planOperationsImport(tables: { name: string; table: string[][] }[], p: Project): OpsImportPlan | { error: string } {
  const sheet = (...names: string[]) => tables.find((t) => names.includes(t.name.trim().toLowerCase()));
  const eqSheet = sheet("equipment", "설비");
  const stepSheet = sheet("steps", "단계");
  const actSheet = sheet("actions", "동작");
  const stateSheets = tables.map((t) => ({ t, m: /^(?:states|상태)\s+(.+)$/i.exec(t.name.trim()) })).filter((x) => x.m).map((x) => ({ table: x.t.table, code: x.m![1].trim().toUpperCase(), name: x.t.name }));
  if (!eqSheet && !stepSheet && !actSheet && !stateSheets.length) return { error: "No Equipment, Steps, Actions or States sheet in this file. Export from Operations first to see the layout." };

  const problems: string[] = [];
  const uoByCode = new Map(p.uos.map((u) => [u.code.toUpperCase(), u]));

  // ---- equipment
  const eqs = new Map<string, Equipment>(p.equipment.map((e) => [tagKey(e.tag), { ...e }]));
  const added = new Set<string>();
  const changed = new Set<string>();
  const before = new Map(p.equipment.map((e) => [e.id, e]));
  if (eqSheet && eqSheet.table.length) {
    const c = columns(eqSheet.table[0]);
    if (c.tag === undefined) problems.push(`${eqSheet.name}: no Tag column.`);
    else eqSheet.table.slice(1).forEach((row, i) => {
      const tag = (row[c.tag] ?? "").trim();
      if (!tag) return;
      const cell = (k: string) => (c[k] !== undefined ? (row[c[k]] ?? "").trim() : "");
      const typeText = cell("type");
      const type = parseType(typeText);
      if (typeText && !type) problems.push(`${eqSheet.name} row ${i + 2}: type "${typeText}" is not known; ${tag} is set to ${TYPE_INFO[typeForTag(tag)].label}.`);
      const key = tagKey(tag);
      const cur = eqs.get(key);
      const e: Equipment = cur ?? { id: newId("eq"), tag, type: type ?? typeForTag(tag) };
      if (!cur) added.add(e.id);
      if (type) e.type = type;
      const name = cell("name"), uoText = cell("uo"), initial = cell("initial"), note = cell("note");
      if (name) e.name = name;
      if (uoText) { const u = uoByCode.get(uoText.toUpperCase()); if (u) e.uoId = u.id; else problems.push(`${eqSheet.name} row ${i + 2}: unit operation ${uoText} is not in the project.`); }
      if (initial && carries(e.type)) { const v = parseState(e.type, initial); if (v !== initialOf(e)) e.initial = v; }
      if (note) e.note = note;
      if (e.tag !== tag) e.tag = tag;
      eqs.set(key, e);
      if (cur) changed.add(e.id);
    });
  }
  const ensure = (tag: string, where: string): Equipment => {
    const key = tagKey(tag);
    let e = eqs.get(key);
    if (!e) {
      e = { id: newId("eq"), tag: tag.trim(), type: typeForTag(tag) };
      eqs.set(key, e);
      added.add(e.id);
      problems.push(`${tag.trim()} (${where}) is not in the Equipment list: added as ${TYPE_INFO[e.type].label}.`);
    }
    return e;
  };

  // ---- steps
  const stepsOf = new Map<string, OpStep[]>();
  const uoOf = (code: string, where: string) => {
    const u = uoByCode.get(code.trim().toUpperCase());
    if (!u && code.trim()) problems.push(`${where}: unit operation ${code.trim()} is not in the project; left out.`);
    return u;
  };
  if (stepSheet && stepSheet.table.length) {
    const c = columns(stepSheet.table[0]);
    if (c.uo === undefined || c.step === undefined) problems.push(`${stepSheet.name}: needs the columns Unit operation and Step.`);
    else {
      const rows: { uo: string; no?: number; idx: number; step: OpStep }[] = [];
      const warned = new Set<string>();
      stepSheet.table.slice(1).forEach((row, i) => {
        const code = (row[c.uo] ?? "").trim();
        const name = (row[c.step] ?? "").trim();
        if (!code && !name) return;
        const u = warned.has(code.toUpperCase()) ? undefined : uoOf(code, `${stepSheet.name} row ${i + 2}`);
        if (!u) { warned.add(code.toUpperCase()); return; }
        const s = newStep(name || `Step ${i + 1}`);
        const minutes = c.minutes !== undefined ? num(row[c.minutes] ?? "") : undefined;
        if (minutes !== undefined && minutes >= 0) s.minutes = minutes;
        const streams = c.streams !== undefined ? (row[c.streams] ?? "").split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean) : [];
        if (streams.length) {
          s.streams = [...new Set(streams)];
          const known = new Set(uoStreams(p, u.id).map((x) => x.id));
          const odd = s.streams.filter((x) => !known.has(x));
          if (odd.length) problems.push(`${u.code} step "${s.name}": ${odd.join(", ")} ${odd.length > 1 ? "are" : "is"} not a stream of ${u.code} (kept; see the link check).`);
        }
        const note = c.note !== undefined ? (row[c.note] ?? "").trim() : "";
        if (note) s.note = note;
        rows.push({ uo: u.id, no: c.no !== undefined ? num(row[c.no] ?? "") : undefined, idx: i, step: s });
      });
      for (const r of rows) stepsOf.set(r.uo, [...(stepsOf.get(r.uo) ?? []), r.step]);
      // Order by No. when the sheet numbers them (rows may be sorted differently).
      for (const [uo, list] of stepsOf) {
        const mine = rows.filter((r) => r.uo === uo);
        if (mine.every((r) => r.no !== undefined)) stepsOf.set(uo, [...mine].sort((a, b) => a.no! - b.no! || a.idx - b.idx).map((r) => r.step));
        else stepsOf.set(uo, list);
      }
    }
  }
  const stepIndex = (uo: string, no: number | undefined, name: string): number => {
    const list = stepsOf.get(uo) ?? [];
    if (no !== undefined && no >= 1 && no <= list.length && Number.isInteger(no)) return no - 1;
    return list.findIndex((s) => s.name.trim().toLowerCase() === name.trim().toLowerCase());
  };

  // ---- actions from the Actions sheet
  const fromList = new Map<string, OpAction[][]>();
  if (actSheet && actSheet.table.length) {
    const c = columns(actSheet.table[0]);
    if (c.uo === undefined || c.tag === undefined || c.state === undefined) problems.push(`${actSheet.name}: needs the columns Unit operation, Tag and State.`);
    else {
      const warned = new Set<string>();
      actSheet.table.slice(1).forEach((row, i) => {
        const code = (row[c.uo] ?? "").trim(), tag = (row[c.tag] ?? "").trim(), stateText = (row[c.state] ?? "").trim();
        if (!code && !tag) return;
        const where = `${actSheet.name} row ${i + 2}`;
        const u = warned.has(code.toUpperCase()) ? undefined : uoOf(code, where);
        if (!u) { warned.add(code.toUpperCase()); return; }
        if (!tag || !stateText) { problems.push(`${where}: needs a tag and a state; left out.`); return; }
        const no = c.no !== undefined ? num(row[c.no] ?? "") : undefined;
        const stepName = c.step !== undefined ? (row[c.step] ?? "").trim() : "";
        let at = stepIndex(u.id, no, stepName);
        if (at < 0 && !stepSheet) {
          // No Steps sheet: the steps come from the Actions sheet (No. and Step).
          const list = stepsOf.get(u.id) ?? [];
          list.push(newStep(stepName || `Step ${list.length + 1}`));
          stepsOf.set(u.id, list);
          at = list.length - 1;
        }
        if (at < 0) { problems.push(`${where}: step ${no ?? ""} ${stepName} is not in the Steps sheet for ${u.code}; left out.`); return; }
        const e = ensure(tag, where);
        const lists = fromList.get(u.id) ?? [];
        const here = (lists[at] ??= []);
        const note = c.note !== undefined ? (row[c.note] ?? "").trim() : "";
        const a: OpAction = { equipmentId: e.id, state: parseState(e.type, stateText), ...(note ? { note } : {}) };
        const dup = here.findIndex((x) => x.equipmentId === e.id);
        if (dup >= 0) { problems.push(`${where}: ${e.tag} has two actions in step ${at + 1}; the last one is kept.`); here[dup] = a; } else here.push(a);
        fromList.set(u.id, lists);
      });
    }
  }

  // ---- actions from the States sheets
  const fromStates = new Map<string, OpAction[][]>();
  for (const st of stateSheets) {
    const u = uoOf(st.code, st.name);
    if (!u || !st.table.length) continue;
    const head = st.table[0].map((h) => h.trim());
    const c = columns(head);
    if (c.tag === undefined) { problems.push(`${st.name}: no Tag column.`); continue; }
    const fixed = new Set([c.tag, c.name, c.initial, c.type].filter((x) => x !== undefined));
    const stepCols = head.map((h, i) => ({ h, i })).filter((x) => x.h && !fixed.has(x.i));
    let list = stepsOf.get(u.id);
    if (!list) { list = stepCols.map((x) => newStep(x.h.replace(/^\d+\s*[.)]\s*/, ""))); stepsOf.set(u.id, list); }
    // A column "3. Load" is step 3; otherwise columns are steps in order.
    const colStep = stepCols.map((x, k) => { const m = /^(\d+)\s*[.)]/.exec(x.h); const n = m ? Number(m[1]) - 1 : k; return n >= 0 && n < list!.length ? n : -1; });
    if (stepCols.length !== list.length) problems.push(`${st.name}: ${stepCols.length} step column(s) for ${list.length} step(s) of ${u.code}.`);
    const lists: OpAction[][] = list.map(() => []);
    st.table.slice(1).forEach((row, r) => {
      const tag = (row[c.tag] ?? "").trim();
      if (!tag) return;
      const e = ensure(tag, `${st.name} row ${r + 2}`);
      if (c.initial !== undefined && (row[c.initial] ?? "").trim() && carries(e.type)) {
        const init = parseState(e.type, row[c.initial]);
        if (init !== initialOf(e)) { e.initial = init; if (!added.has(e.id)) changed.add(e.id); }
      }
      let cur = initialOf(e);
      stepCols.forEach((x, k) => {
        const at = colStep[k];
        const v = parseState(e.type, row[x.i] ?? "");
        if (at < 0 || !v) return;
        if (carries(e.type)) { if (v !== cur) lists[at].push({ equipmentId: e.id, state: v }); cur = v; }
        else lists[at].push({ equipmentId: e.id, state: v });
      });
    });
    fromStates.set(u.id, lists);
  }

  // ---- put the actions into the steps
  const finalEq = new Map([...eqs.values()].map((e) => [e.id, e]));
  const same = (steps: OpStep[], a: OpAction[][], b: OpAction[][]) => {
    const ids = new Set([...a.flat(), ...b.flat()].map((x) => x.equipmentId));
    const withA = steps.map((s, i) => ({ ...s, actions: a[i] ?? [] }));
    const withB = steps.map((s, i) => ({ ...s, actions: b[i] ?? [] }));
    return [...ids].every((id) => { const e = finalEq.get(id)!; return JSON.stringify(timeline(withA, e).map((x) => x.state)) === JSON.stringify(timeline(withB, e).map((x) => x.state)); });
  };
  const uos: OpsImportUo[] = [];
  let actionCount = 0;
  for (const u of sorted(p)) {
    const steps = stepsOf.get(u.id);
    if (!steps) continue;
    const list = fromList.get(u.id), states = fromStates.get(u.id);
    let use: OpAction[][] = [];
    let from: OpsImportUo["actionsFrom"] = "none";
    if (list && states) {
      if (same(steps, list, states)) { use = list; from = "Actions"; }
      else {
        use = states.map((acts, i) => acts.map((a) => list[i]?.find((x) => x.equipmentId === a.equipmentId && x.state === a.state) ?? a));
        from = "States";
        problems.push(`${u.code}: the States sheet and the Actions sheet say different things; the States sheet was used.`);
      }
    } else if (states) { use = states; from = "States"; } else if (list) { use = list; from = "Actions"; }
    const out = steps.map((s, i) => ({ ...s, actions: use[i] ?? [] }));
    actionCount += out.reduce((n, s) => n + s.actions.length, 0);
    uos.push({ uoId: u.id, code: u.code, steps: out, before: (p.operations[u.id] ?? []).length, actionsFrom: from });
  }

  const equipmentAdd = [...eqs.values()].filter((e) => added.has(e.id));
  const equipmentUpdate = [...eqs.values()].filter((e) => changed.has(e.id) && JSON.stringify(e) !== JSON.stringify(before.get(e.id)))
    .map((e) => ({ id: e.id, tag: e.tag, patch: e }));
  return { equipmentAdd, equipmentUpdate, uos, problems, actionCount };
}

/** Apply an import: equipment added or updated; the steps of each unit operation in the file replaced. */
export function applyOperationsImport(p: Project, plan: OpsImportPlan): Project {
  const patches = new Map(plan.equipmentUpdate.map((x) => [x.id, x.patch]));
  const equipment = [...p.equipment.map((e) => (patches.has(e.id) ? { ...e, ...patches.get(e.id) } : e)), ...plan.equipmentAdd];
  const operations = { ...p.operations };
  for (const u of plan.uos) operations[u.uoId] = u.steps;
  return { ...p, equipment, operations };
}
