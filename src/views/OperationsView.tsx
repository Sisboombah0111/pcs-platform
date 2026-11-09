import { useEffect, useMemo, useState } from "react";
import { PageIntro } from "../ui/PageIntro";
import { RibbonButton, RibbonGroup, ScreenRibbon } from "../ui/Ribbon";
import { fmtQty } from "../mb/model";
import { newId } from "../model/ids";
import type { Equipment, EquipmentType, OpStep, Project, UnitOperation } from "../model/types";
import {
  EQUIPMENT_TYPES, TEMPLATES, TYPE_INFO, actionText, carries, deleteEquipment, duplicateStep, durationText, equipmentShapes, equipmentUse, hhmm,
  initialOf, isActive, moveAction, moveStep, newStep, parseState, putAction, removeAction, setCell, startTimes, streamFlow, tableEquipment, tagKey, templateSteps,
  timeline, toggleCell, typeForTag, uoStreams, type ShapeRef,
} from "../ops/model";
import { applyOperationsImport, operationsSheets, planOperationsImport, type OpsImportPlan } from "../ops/xlsx";
import { MAP, streamNamesOf } from "../pfd/sync";
import { downloadBlob, pickFile } from "../storage/files";
import { Dialog } from "../ui/Dialog";
import { RowMenu } from "../ui/RowMenu";
import { HeadRow, useColumns, type Head } from "../ui/resize";
import { readTables, writeWorkbook } from "../xlsx/workbook";
import type { GoPlace } from "./WhereUsed";

type Update = (fn: (p: Project) => Project, label?: string) => void;
type Confirm = (o: { title: string; body: string; confirmLabel: string; danger?: boolean }) => Promise<boolean>;
type View = "steps" | "table";
/** Where another screen sends the user: a piece of equipment (its state table), or a unit operation. */
export interface OpsFocus { uoId?: string; equipmentId?: string; n: number }

/** Per-viewer conveniences, remembered in this browser only; storage may be unavailable. */
const remember = (k: string, v: string) => { try { localStorage.setItem(`pcs.ops.${k}`, v); } catch { /* not remembered */ } };
const recall = (k: string) => { try { return localStorage.getItem(`pcs.ops.${k}`); } catch { return null; } };

const EQUIPMENT = "equipment";

/**
 * Operations: the steps of each unit operation and what happens to the equipment in each (open or close a
 * valve, start or stop a pump or an agitator), as a list of steps with their actions or as a state table.
 * Equipment tags come from the PFD shapes or are added here; steps name the Stream IDs that flow in them.
 */
export function OperationsView(props: {
  project: Project; update: Update; confirm: Confirm; toast: (msg: string) => void;
  go?: (place: GoPlace) => void; focus?: OpsFocus | null; onFocusDone?: () => void;
}) {
  const { project, update, toast } = props;
  const uos = useMemo(() => [...project.uos].sort((a, b) => a.order - b.order), [project.uos]);
  const [sel, setSelState] = useState<string>(() => {
    const last = recall("uo");
    if (last && (last === EQUIPMENT || project.uos.some((u) => u.id === last))) return last;
    return uos.find((u) => (project.operations[u.id] ?? []).length)?.id ?? uos[0]?.id ?? EQUIPMENT;
  });
  const setSel = (v: string) => { setSelState(v); remember("uo", v); };
  const [view, setViewState] = useState<View>(() => (recall("view") === "table" ? "table" : "steps"));
  const setView = (v: View) => { setViewState(v); remember("view", v); };
  const [flash, setFlash] = useState<string | null>(null);
  const [importing, setImporting] = useState<{ fileName: string; plan: OpsImportPlan } | null>(null);

  const shapes = useMemo(() => equipmentShapes(project.pfd), [project.pfd]);
  const current = uos.find((u) => u.id === sel);

  // Sent here from a PFD shape ("Show in Operations"): the state table of a unit operation that uses it.
  useEffect(() => {
    const f = props.focus;
    if (!f) return;
    if (f.equipmentId) {
      const eq = project.equipment.find((e) => e.id === f.equipmentId);
      const uo = [...equipmentUse(project, f.equipmentId).keys()][0] ?? eq?.uoId;
      if (uo && project.uos.some((u) => u.id === uo)) { setSel(uo); setView("table"); } else setSel(EQUIPMENT);
      setFlash(f.equipmentId);
      setTimeout(() => document.querySelector(`[data-eq="${f.equipmentId}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" }), 80);
      setTimeout(() => setFlash(null), 2400);
    } else if (f.uoId) setSel(f.uoId);
    props.onFocusDone?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.focus?.n]);

  const setSteps = (uoId: string, fn: (steps: OpStep[]) => OpStep[]) =>
    update((p) => ({ ...p, operations: { ...p.operations, [uoId]: fn(p.operations[uoId] ?? []) } }));
  const setEquipment = (fn: (list: Equipment[]) => Equipment[]) => update((p) => ({ ...p, equipment: fn(p.equipment) }));
  /** New equipment with a tag (unique); returns its id, or null with a message. */
  const addEquipment = (tag: string, type: EquipmentType, uoId?: string): string | null => {
    const t = tag.trim().replace(/\s+/g, " ");
    if (!t) return null;
    const clash = project.equipment.find((e) => tagKey(e.tag) === tagKey(t));
    if (clash) { toast(`${clash.tag} is already in the equipment list`); return null; }
    const id = newId("eq");
    setEquipment((list) => [...list, { id, tag: t, type, ...(uoId ? { uoId } : {}) }]);
    return id;
  };
  const showEquipmentRow = (equipmentId: string, uoId?: string) => {
    if (uoId) { setSel(uoId); setView("table"); } else setSel(EQUIPMENT);
    setFlash(equipmentId);
    setTimeout(() => document.querySelector(`[data-eq="${equipmentId}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" }), 80);
    setTimeout(() => setFlash(null), 2400);
  };

  const exportExcel = async () => {
    const blob = await writeWorkbook(operationsSheets(project));
    downloadBlob(blob, `${project.meta.name} Operations ${new Date().toISOString().slice(0, 10)}.xlsx`.replace(/[\\/:*?"<>|]/g, "-"));
  };
  const importExcel = async () => {
    const file = await pickFile(".xlsx");
    if (!file) return;
    try {
      const plan = planOperationsImport(await readTables(new Uint8Array(await file.arrayBuffer())), project);
      if ("error" in plan) { toast(plan.error); return; }
      setImporting({ fileName: file.name, plan });
    } catch (e) {
      toast(`Could not read ${file.name}: ${(e as Error).message}`);
    }
  };

  const stepCount = Object.values(project.operations).reduce((n, s) => n + s.length, 0);
  const actionCount = Object.values(project.operations).reduce((n, s) => n + s.reduce((m, x) => m + x.actions.length, 0), 0);

  return (
    <div className="page">
      <div className="page-inner wide">
        <div className="page-head">
          <div>
            <h1>Operations</h1>
            <PageIntro id="operations" lead="The steps of each unit operation and what is done to the equipment in each step.">
              <b>Open or close</b> a valve, <b>start or stop</b> a pump or an agitator. Give the PFD shapes their tags (select a shape › <b>Equipment tag</b>) or add equipment here; a step names the <b>Stream IDs</b> that flow in it.</PageIntro>
          </div>
          <div className="spacer" />
          <div className="toolbar">
            <span className="chip">{stepCount} steps · {actionCount} actions · {project.equipment.length} equipment</span>
          </div>
          <ScreenRibbon screen="operations">
            <RibbonGroup label="Excel">
              <RibbonButton big icon="import" onClick={importExcel} title="Equipment, Steps, Actions and States sheets (as exported, or filled in by hand)" label="Import from Excel…" />
              <RibbonButton big primary icon="excel" onClick={exportExcel} disabled={!stepCount && !project.equipment.length} title="Equipment, steps, actions and the state table as an Excel workbook" label="Export to Excel" />
            </RibbonGroup>
          </ScreenRibbon>
        </div>

        {uos.length === 0 ? (
          <div className="notice">Unit operations come from the PFD: add them on the process map first (PFD › + Unit operation). Their steps are written here.</div>
        ) : (
          <div className="ops-layout">
            <nav className="ops-nav panel" aria-label="Unit operations">
              <div className="ops-nav-head">Unit operations</div>
              {uos.map((u) => {
                const n = (project.operations[u.id] ?? []).length;
                return (
                  <button key={u.id} className={`ops-nav-item${sel === u.id ? " on" : ""}`} aria-current={sel === u.id ? "page" : undefined} onClick={() => setSel(u.id)}>
                    <span className="mono">{u.code}</span><span className="ops-nav-name">{u.name}</span>
                    <span className={`chip${n ? "" : " faint"}`}>{n ? `${n} step${n > 1 ? "s" : ""}` : "none"}</span>
                  </button>
                );
              })}
              <div className="ops-nav-sep" />
              <button className={`ops-nav-item${sel === EQUIPMENT || !current ? " on" : ""}`} onClick={() => setSel(EQUIPMENT)}>
                <span>Equipment</span><span className="ops-nav-name" /><span className="chip">{project.equipment.length}</span>
              </button>
            </nav>
            <div className="ops-main">
              {current ? (
                <UoOperations
                  key={current.id} project={project} uo={current} uos={uos} view={view} setView={setView} flash={flash} shapes={shapes}
                  setSteps={(fn) => setSteps(current.id, fn)} setEquipment={setEquipment} addEquipment={addEquipment} go={props.go} confirm={props.confirm} toast={toast}
                />
              ) : (
                <EquipmentList project={project} uos={uos} shapes={shapes} flash={flash} setEquipment={setEquipment} update={update} addEquipment={addEquipment}
                  go={props.go} confirm={props.confirm} showUse={showEquipmentRow} />
              )}
            </div>
          </div>
        )}
      </div>
      {importing && (
        <ImportOpsDialog fileName={importing.fileName} plan={importing.plan} onCancel={() => setImporting(null)}
          onApply={() => {
            const plan = importing.plan;
            update((p) => applyOperationsImport(p, plan), `Import ${importing.fileName}`);
            setImporting(null);
            toast(`Imported ${importing.fileName}: ${plan.uos.reduce((n, u) => n + u.steps.length, 0)} steps, ${plan.actionCount} actions, ${plan.equipmentAdd.length} new equipment`);
            if (plan.uos[0]) setSel(plan.uos[0].uoId);
          }} />
      )}
    </div>
  );
}

// ---- one unit operation ---------------------------------------------------------------------------------------------------

function UoOperations(props: {
  project: Project; uo: UnitOperation; uos: UnitOperation[]; view: View; setView: (v: View) => void; flash: string | null; shapes: Map<string, ShapeRef[]>;
  setSteps: (fn: (steps: OpStep[]) => OpStep[]) => void; setEquipment: (fn: (list: Equipment[]) => Equipment[]) => void;
  addEquipment: (tag: string, type: EquipmentType, uoId?: string) => string | null;
  go?: (place: GoPlace) => void; confirm: Confirm; toast: (msg: string) => void;
}) {
  const { project, uo, setSteps } = props;
  const steps = project.operations[uo.id] ?? [];
  const { total, missing } = startTimes(steps);
  const actions = steps.reduce((n, s) => n + s.actions.length, 0);
  const others = props.uos.filter((u) => u.id !== uo.id && (project.operations[u.id] ?? []).length);

  const addTemplate = (id: string) => {
    const add = templateSteps(id);
    if (!add.length) return;
    setSteps((s) => [...s, ...add]);
    props.toast(`${add.length} steps added from “${TEMPLATES.find((t) => t.id === id)?.name}”: name the streams and add the actions`);
  };
  const copyFrom = (uoId: string) => {
    const src = project.operations[uoId] ?? [];
    setSteps((s) => [...s, ...src.map((x) => newStep(x.name, { ...(x.minutes !== undefined ? { minutes: x.minutes } : {}), ...(x.note ? { note: x.note } : {}) }))]);
    props.toast(`${src.length} steps copied (names, minutes and notes; streams and actions belong to their own unit operation)`);
  };

  return (
    <div className="ops-uo">
      <div className="ops-head">
        <h2><span className="mono">{uo.code}</span> {uo.name}</h2>
        <span className="chip">{steps.length} steps{total ? ` · ${durationText(total)}` : ""}{missing && steps.length ? ` (${missing} without minutes)` : ""} · {actions} actions</span>
        <span className="spacer" />
        {steps.length > 0 && props.go && <button className="btn small" onClick={() => props.go!({ kind: "step", uoId: uo.id, index: 0 })} title="The drawing with the step view: valves open or closed, pumps running, the streams of each step">Show on PFD</button>}
        <div className="seg" role="tablist" aria-label="View">
          <button role="tab" aria-selected={props.view === "steps"} className={props.view === "steps" ? "on" : ""} onClick={() => props.setView("steps")}>Steps & actions</button>
          <button role="tab" aria-selected={props.view === "table"} className={props.view === "table" ? "on" : ""} onClick={() => props.setView("table")}>State table</button>
        </div>
      </div>
      <div className="ops-tools">
        <button className="btn small primary" onClick={() => setSteps((s) => [...s, newStep(`Step ${s.length + 1}`)])}>+ Step</button>
        <select className="search ops-select" value="" onChange={(e) => addTemplate(e.target.value)} aria-label="Add steps from a template">
          <option value="">Add steps from a template…</option>
          {TEMPLATES.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.steps.length} steps)</option>)}
        </select>
        {others.length > 0 && (
          <select className="search ops-select" value="" onChange={(e) => copyFrom(e.target.value)} aria-label="Copy steps from another unit operation">
            <option value="">Copy steps from…</option>
            {others.map((u) => <option key={u.id} value={u.id}>{u.code} · {u.name} ({(project.operations[u.id] ?? []).length} steps)</option>)}
          </select>
        )}
      </div>
      {steps.length === 0 ? (
        <div className="notice">No steps yet. Add a step, or start from a template (Chromatography, UF/DF, Buffer preparation …) and change it to fit.</div>
      ) : props.view === "steps" ? (
        <StepsTable {...props} steps={steps} />
      ) : (
        <StateTable {...props} steps={steps} />
      )}
    </div>
  );
}

const STEP_HEADS: Head[] = [
  { id: "no", label: "#", width: 44, className: "num" },
  { id: "name", label: "Step", width: 190, min: 120 },
  { id: "min", label: "Minutes", width: 86, className: "num", title: "Duration of the step" },
  { id: "start", label: "Starts", width: 70, className: "num", title: "Start time from the beginning of the unit operation (h:mm)" },
  { id: "streams", label: "Streams", width: 280, min: 160, title: "Stream IDs that flow in this step (from the PFD); the value is the applied mass balance" },
  { id: "actions", label: "Actions at the start of the step", width: 330, min: 200 },
  { id: "note", label: "Note", width: 170, min: 90 },
  { id: "menu", width: 52, ariaLabel: "More" },
];

function StepsTable(props: Parameters<typeof UoOperations>[0] & { steps: OpStep[] }) {
  const { project, uo, steps, setSteps } = props;
  const cols = useColumns("ops.steps", STEP_HEADS);
  const { starts } = startTimes(steps);
  const names = useMemo(() => streamNamesOf(project.pfd), [project.pfd]);
  const streams = uoStreams(project, uo.id);
  const known = new Set(streams.map((s) => s.id));
  const byId = new Map(project.equipment.map((e) => [e.id, e]));
  const scen = project.mb.scenarios.find((s) => s.id === project.mb.activeScenario);
  // Whether each action changes the state (or is a check of the state it already has).
  const changed = new Map<string, boolean>();
  for (const e of project.equipment) timeline(steps, e).forEach((c, i) => { if (c.action) changed.set(`${i}|${e.id}`, c.changed); });
  const mine = tableEquipment(project, steps, uo.id);
  const rest = project.equipment.filter((e) => !mine.includes(e)).sort((a, b) => a.tag.localeCompare(b.tag, undefined, { numeric: true }));
  const edit = (i: number, patch: Partial<OpStep>) => setSteps((s) => s.map((x, j) => {
    if (j !== i) return x;
    const n = { ...x, ...patch };
    for (const k of Object.keys(patch) as (keyof OpStep)[]) if (n[k] === undefined || n[k] === "") delete n[k];
    return n;
  }));

  return (
    <div className="table-wrap panel">
      <table className="grid ops-steps" ref={cols.tableRef} style={cols.tableStyle}>
        {cols.colgroup}
        <HeadRow heads={STEP_HEADS} cols={cols} />
        <tbody>
          {steps.map((s, i) => (
            <tr key={s.id} data-step={i + 1}>
              <td className="idx">{i + 1}</td>
              <td><input className="cell-input" value={s.name} aria-label={`Name of step ${i + 1}`} onChange={(e) => edit(i, { name: e.target.value })} /></td>
              <td><input className="cell-input num-input" inputMode="decimal" value={s.minutes ?? ""} aria-label={`Minutes of step ${i + 1}`}
                onChange={(e) => { const v = e.target.value.trim(); const n = Number(v); edit(i, { minutes: v === "" || !Number.isFinite(n) || n < 0 ? undefined : n }); }} /></td>
              <td className="num faint-num">{hhmm(starts[i])}</td>
              <td>
                <div className="op-chips">
                  {(s.streams ?? []).map((id) => {
                    const flow = streamFlow(project, id);
                    return (
                      <span key={id} className={`op-chip stream${known.has(id) ? "" : " bad"}`} title={known.has(id) ? `${id}${names.get(id) ? ` · ${names.get(id)}` : ""}${flow ? ` · ${scen?.name ?? ""} ${fmtQty(flow.value)} ${flow.unit}` : ""}` : `${id} is not a stream of ${uo.code} (deleted, or another unit operation)`}>
                        <button className="linkish mono" onClick={() => props.go?.({ kind: "stream", id })} title="Show on the PFD">{id}</button>
                        {(names.get(id) || flow) && <span className="op-chip-sub">{names.get(id) ?? ""}{flow ? `${names.get(id) ? " · " : ""}${fmtQty(flow.value)} ${flow.unit}` : ""}</span>}
                        <button className="op-x" aria-label={`Remove ${id} from step ${i + 1}`} onClick={() => edit(i, { streams: (s.streams ?? []).filter((x) => x !== id) })}>×</button>
                      </span>
                    );
                  })}
                  {streams.some((x) => !(s.streams ?? []).includes(x.id)) && (
                    <select className="op-add" value="" aria-label={`Add a stream to step ${i + 1}`} onChange={(e) => e.target.value && edit(i, { streams: [...(s.streams ?? []), e.target.value] })}>
                      <option value="">+ Stream</option>
                      {streams.filter((x) => !(s.streams ?? []).includes(x.id)).map((x) => (
                        <option key={x.id} value={x.id}>{x.id}{names.get(x.id) ? ` · ${names.get(x.id)}` : ""}{x.dir === "in" ? " (in)" : x.dir === "out" ? " (out)" : ""}</option>
                      ))}
                    </select>
                  )}
                </div>
              </td>
              <td>
                <div className="op-chips">
                  {s.actions.map((a, k) => {
                    const eq = byId.get(a.equipmentId);
                    const ch = changed.get(`${i}|${a.equipmentId}`) ?? true;
                    const text = actionText(eq, a.state);
                    return (
                      <span key={a.equipmentId} className={`op-chip act${eq && isActive(eq.type, a.state) ? " on" : ""}${ch ? "" : " check"}`}
                        title={`${eq?.name ? `${eq.name}. ` : ""}${ch ? "" : `Already ${a.state}: a check. `}${a.note ?? ""}`}>
                        {k > 0 && <button className="op-move" aria-label={`Move ${text} earlier in step ${i + 1}`} title="Do this earlier" onClick={() => setSteps((x) => moveAction(x, i, k, k - 1))}>‹</button>}
                        <span>{text}</span>
                        {a.note && <span className="op-chip-sub">{a.note}</span>}
                        {k < s.actions.length - 1 && <button className="op-move" aria-label={`Move ${text} later in step ${i + 1}`} title="Do this later" onClick={() => setSteps((x) => moveAction(x, i, k, k + 1))}>›</button>}
                        <button className="op-x" aria-label={`Remove ${text} from step ${i + 1}`} onClick={() => setSteps((x) => removeAction(x, i, a.equipmentId))}>×</button>
                      </span>
                    );
                  })}
                  <ActionAdder stepNo={i + 1} mine={mine} rest={rest} uoCode={uo.code}
                    onAdd={(equipmentId, state) => setSteps((x) => putAction(x, i, { equipmentId, state }))}
                    onNew={(tag, type) => props.addEquipment(tag, type, uo.id)} />
                </div>
              </td>
              <td><input className="cell-input" value={s.note ?? ""} aria-label={`Note of step ${i + 1}`} onChange={(e) => edit(i, { note: e.target.value })} /></td>
              <td>
                <RowMenu label={`More for step ${i + 1}`} items={[
                  ...(props.go ? [{ label: "Show on PFD", aria: `Show step ${i + 1} on the PFD`, onClick: () => props.go!({ kind: "step", uoId: uo.id, index: i }) }] : []),
                  { label: "Move up", onClick: () => setSteps((x) => moveStep(x, i, i - 1)) },
                  { label: "Move down", onClick: () => setSteps((x) => moveStep(x, i, i + 1)) },
                  { label: "Insert a step below", onClick: () => setSteps((x) => [...x.slice(0, i + 1), newStep("New step"), ...x.slice(i + 1)]) },
                  { label: "Duplicate", onClick: () => setSteps((x) => duplicateStep(x, i)) },
                  { label: "Delete", aria: `Delete step ${i + 1}`, danger: true, onClick: async () => {
                    if (s.actions.length && !(await props.confirm({ title: `Delete step ${i + 1} · ${s.name}?`, body: `Its ${s.actions.length} action(s) go with it; the steps after it keep their own actions (so the states that carried over may change).`, confirmLabel: "Delete step", danger: true }))) return;
                    setSteps((x) => x.filter((_, j) => j !== i));
                  } },
                ]} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** "+ Action" in a step: choose the equipment, then Open/Close (Start/Stop), or type a value or what is done. */
function ActionAdder(props: { stepNo: number; mine: Equipment[]; rest: Equipment[]; uoCode: string; onAdd: (equipmentId: string, state: string) => void; onNew: (tag: string, type: EquipmentType) => string | null }) {
  const [eqId, setEqId] = useState("");
  const [text, setText] = useState("");
  const [creating, setCreating] = useState(false);
  const [tag, setTag] = useState("");
  const [type, setType] = useState<EquipmentType | "">("");
  const all = [...props.mine, ...props.rest];
  const eq = all.find((e) => e.id === eqId);
  const reset = () => { setEqId(""); setText(""); setCreating(false); setTag(""); setType(""); };
  if (creating) {
    const t = type || typeForTag(tag);
    return (
      <span className="op-adder">
        <input className="cell-input mono" autoFocus placeholder="New tag, e.g. XV-120" value={tag} aria-label={`New tag for step ${props.stepNo}`} onChange={(e) => setTag(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Escape") reset(); }} />
        <select className="cell-input" value={t} aria-label="Type of the new equipment" onChange={(e) => setType(e.target.value as EquipmentType)}>
          {EQUIPMENT_TYPES.map((x) => <option key={x} value={x}>{TYPE_INFO[x].label}</option>)}
        </select>
        <button className="btn small primary" disabled={!tag.trim()} onClick={() => { const id = props.onNew(tag, t); if (id) { setCreating(false); setEqId(id); } }}>Add tag</button>
        <button className="btn ghost small" aria-label="Cancel" onClick={reset}>×</button>
      </span>
    );
  }
  if (!eq) {
    return (
      <select className="op-add" value="" aria-label={`Add an action to step ${props.stepNo}`} onChange={(e) => (e.target.value === "__new" ? setCreating(true) : setEqId(e.target.value))}>
        <option value="">+ Action</option>
        {props.mine.length > 0 && <optgroup label={`${props.uoCode} equipment`}>{props.mine.map((e) => <option key={e.id} value={e.id}>{e.tag}{e.name ? ` · ${e.name}` : ""}</option>)}</optgroup>}
        {props.rest.length > 0 && <optgroup label="Other equipment">{props.rest.map((e) => <option key={e.id} value={e.id}>{e.tag}{e.name ? ` · ${e.name}` : ""}</option>)}</optgroup>}
        <option value="__new">New tag…</option>
      </select>
    );
  }
  const info = TYPE_INFO[eq.type];
  const done = (state: string) => { props.onAdd(eq.id, state); reset(); };
  return (
    <span className="op-adder">
      <span className="mono op-adder-tag">{eq.tag}</span>
      {info.verbs && info.states.map((st, j) => <button key={st} className="btn small" aria-label={`${info.verbs![j]} ${eq.tag}`} onClick={() => done(st)}>{info.verbs![j]}</button>)}
      <input className="cell-input" placeholder={info.states.length ? "or a value, e.g. 50 %" : "what is done, e.g. Fill to 200 L"} value={text} aria-label={`Action on ${eq.tag}`}
        onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && text.trim()) done(text.trim()); if (e.key === "Escape") reset(); }} />
      <button className="btn small" disabled={!text.trim()} onClick={() => done(text.trim())}>Add</button>
      <button className="btn ghost small" aria-label="Cancel" onClick={reset}>×</button>
    </span>
  );
}

/** Equipment × steps: the state of each piece of equipment in each step. A click switches it (an action in that step). */
function StateTable(props: Parameters<typeof UoOperations>[0] & { steps: OpStep[] }) {
  const { project, uo, steps, setSteps } = props;
  const [extra, setExtra] = useState<string[]>([]);
  const [editing, setEditing] = useState<{ eq: string; i: number; v: string } | null>(null);
  const [creating, setCreating] = useState(false);
  const [tag, setTag] = useState("");
  const [type, setType] = useState<EquipmentType | "">("");
  const eqs = tableEquipment(project, steps, uo.id, extra);
  const addable = project.equipment.filter((e) => !eqs.includes(e)).sort((a, b) => a.tag.localeCompare(b.tag, undefined, { numeric: true }));
  const commit = () => {
    if (!editing) return;
    const e = project.equipment.find((x) => x.id === editing.eq);
    if (e) setSteps((s) => setCell(s, editing.i, e, parseState(e.type, editing.v)));
    setEditing(null);
  };
  const showShape = (e: Equipment) => { const at = props.shapes.get(e.id)?.[0]; if (at) props.go?.({ kind: "pfd", scope: at.scope, elementId: at.elementId }); };

  return (
    <>
      <div className="table-wrap panel">
        <table className="grid op-states">
          <thead>
            <tr>
              <th className="op-sticky">Tag</th>
              <th>Equipment</th>
              <th title="State before the first step">Initial</th>
              {steps.map((s, i) => <th key={s.id} className="op-stephead" title={`${s.name}${s.minutes ? ` · ${s.minutes} min` : ""}`}><span className="op-stepno">{i + 1}</span> {s.name}</th>)}
            </tr>
          </thead>
          <tbody>
            {eqs.length === 0 && <tr><td colSpan={3 + steps.length} className="empty">No equipment yet. Add it below, or give the PFD shapes their tags.</td></tr>}
            {eqs.map((e) => {
              const cells = timeline(steps, e);
              const info = TYPE_INFO[e.type];
              const drawn = props.shapes.get(e.id);
              return (
                <tr key={e.id} data-eq={e.id} data-tag={e.tag} className={props.flash === e.id ? "flash" : ""}>
                  <th scope="row" className="op-sticky op-tag">
                    {drawn ? <button className="linkish mono" onClick={() => showShape(e)} title="Show on the PFD">{e.tag}</button> : <span className="mono" title="Not drawn on the PFD">{e.tag}</span>}
                  </th>
                  <td className="op-eqname" title={info.label}>{e.name ?? info.label}</td>
                  <td>
                    {carries(e.type) ? (
                      <select className="cell-input op-initial" value={initialOf(e)} aria-label={`Initial state of ${e.tag}`}
                        onChange={(ev) => props.setEquipment((list) => list.map((x) => (x.id === e.id ? { ...x, initial: ev.target.value } : x)))}>
                        {[...new Set([...info.states, initialOf(e)])].map((st) => <option key={st} value={st}>{st}</option>)}
                      </select>
                    ) : <span className="faint">–</span>}
                  </td>
                  {cells.map((c, i) => (
                    <td key={steps[i].id} className="op-cellwrap">
                      {editing && editing.eq === e.id && editing.i === i ? (
                        <input className="cell-input op-cellinput" autoFocus value={editing.v} aria-label={`${e.tag} in step ${i + 1}`}
                          onChange={(ev) => setEditing({ ...editing, v: ev.target.value })} onBlur={commit}
                          onKeyDown={(ev) => { if (ev.key === "Enter") commit(); if (ev.key === "Escape") setEditing(null); }} />
                      ) : (
                        <button
                          className={`op-cell${c.action ? " set" : " kept"}${isActive(e.type, c.state) ? " on" : ""}${c.action && !c.changed ? " check" : ""}`}
                          aria-label={`${e.tag} in step ${i + 1}: ${c.state || "nothing"}${c.action ? " (action)" : ""}`}
                          title={c.action ? `${actionText(e, c.state)} at the start of step ${i + 1}${c.action.note ? `: ${c.action.note}` : ""}${c.changed ? "" : " (already in this state: a check)"}` : carries(e.type) ? `${c.state}, from the step before` : "Nothing in this step: click to type what is done"}
                          onClick={() => (carries(e.type) ? setSteps((s) => toggleCell(s, i, e)) : setEditing({ eq: e.id, i, v: c.state }))}
                          onDoubleClick={() => setEditing({ eq: e.id, i, v: c.state })}
                        >{c.state || ""}</button>
                      )}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="ops-tools">
        {addable.length > 0 && (
          <select className="search ops-select" value="" aria-label="Add equipment to this table" onChange={(e) => e.target.value && setExtra([...extra, e.target.value])}>
            <option value="">Add equipment to this table…</option>
            {addable.map((e) => <option key={e.id} value={e.id}>{e.tag}{e.name ? ` · ${e.name}` : ""}</option>)}
          </select>
        )}
        {creating ? (
          <span className="op-adder">
            <input className="cell-input mono" autoFocus placeholder="Tag, e.g. XV-120" value={tag} aria-label="New equipment tag" onChange={(e) => setTag(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") setCreating(false); }} />
            <select className="cell-input" value={type || typeForTag(tag)} aria-label="Type of the new equipment" onChange={(e) => setType(e.target.value as EquipmentType)}>
              {EQUIPMENT_TYPES.map((x) => <option key={x} value={x}>{TYPE_INFO[x].label}</option>)}
            </select>
            <button className="btn small primary" disabled={!tag.trim()} onClick={() => { if (props.addEquipment(tag, type || typeForTag(tag), uo.id)) { setCreating(false); setTag(""); setType(""); } }}>Add</button>
            <button className="btn ghost small" aria-label="Cancel" onClick={() => setCreating(false)}>×</button>
          </span>
        ) : <button className="btn small" onClick={() => setCreating(true)}>+ New equipment</button>}
      </div>
      <p className="hint ops-legend">
        <span className="op-cell set on">Open</span> an action (bold: done at the start of that step) · <span className="op-cell kept on">Open</span> kept from the step before ·
        Click a cell to switch Open/Closed or On/Off; double-click to type a value (50 %, 150 rpm). For vessels, filters and others, click to type what is done in that step.
      </p>
    </>
  );
}

// ---- the equipment list --------------------------------------------------------------------------------------------------

const EQ_HEADS: Head[] = [
  { id: "tag", label: "Tag", width: 120, min: 80 },
  { id: "type", label: "Type", width: 150 },
  { id: "name", label: "Name", width: 220, min: 120 },
  { id: "uo", label: "Unit operation", width: 140 },
  { id: "initial", label: "Initial", width: 100, title: "State before the first step" },
  { id: "pfd", label: "On PFD", width: 150 },
  { id: "used", label: "In steps", width: 200 },
  { id: "note", label: "Note", width: 180, min: 90 },
  { id: "menu", width: 52, ariaLabel: "More" },
];

function EquipmentList(props: {
  project: Project; uos: UnitOperation[]; shapes: Map<string, ShapeRef[]>; flash: string | null;
  setEquipment: (fn: (list: Equipment[]) => Equipment[]) => void; update: Update; addEquipment: (tag: string, type: EquipmentType, uoId?: string) => string | null;
  go?: (place: GoPlace) => void; confirm: Confirm; showUse: (equipmentId: string, uoId?: string) => void;
}) {
  const { project, uos, shapes } = props;
  const cols = useColumns("ops.equipment", EQ_HEADS);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<EquipmentType | "">("");
  const [tag, setTag] = useState("");
  const [type, setType] = useState<EquipmentType | "">("");
  const [uoId, setUoId] = useState("");
  const q = query.trim().toLowerCase();
  const list = [...project.equipment].sort((a, b) => a.tag.localeCompare(b.tag, undefined, { numeric: true }))
    .filter((e) => (!q || [e.tag, e.name ?? "", e.note ?? ""].some((v) => v.toLowerCase().includes(q))) && (!typeFilter || e.type === typeFilter));
  const codeOf = (id?: string) => uos.find((u) => u.id === id)?.code ?? "";
  const set = (id: string, patch: Partial<Equipment>) => props.setEquipment((l) => l.map((e) => {
    if (e.id !== id) return e;
    const n = { ...e, ...patch };
    for (const k of Object.keys(patch) as (keyof Equipment)[]) if (n[k] === undefined || n[k] === "") delete n[k];
    return n;
  }));
  const remove = async (e: Equipment) => {
    const use = equipmentUse(project, e.id);
    const n = [...use.values()].reduce((m, x) => m + x.length, 0);
    const drawn = shapes.get(e.id)?.length ?? 0;
    if ((n || drawn) && !(await props.confirm({
      title: `Delete ${e.tag}?`,
      body: `${n ? `Its actions in ${n} step(s) are deleted too. ` : ""}${drawn ? "The PFD shape stays, without its tag." : ""}`,
      confirmLabel: "Delete equipment", danger: true,
    }))) return;
    props.update((p) => deleteEquipment(p, [e.id]));
  };
  const add = () => { if (props.addEquipment(tag, type || typeForTag(tag), uoId || undefined)) { setTag(""); setType(""); } };

  return (
    <div className="ops-uo">
      <div className="ops-head">
        <h2>Equipment</h2>
        <span className="chip">{project.equipment.length} · {project.equipment.filter((e) => shapes.has(e.id)).length} on the PFD</span>
        <span className="spacer" />
        <input className="search" placeholder="Search tag, name, note" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search equipment" />
        <select className="search ops-select" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as EquipmentType | "")} aria-label="Type filter">
          <option value="">All types</option>
          {EQUIPMENT_TYPES.map((t) => <option key={t} value={t}>{TYPE_INFO[t].label}</option>)}
        </select>
      </div>
      <div className="table-wrap panel">
        <table className="grid ops-eq" ref={cols.tableRef} style={cols.tableStyle}>
          {cols.colgroup}
          <HeadRow heads={EQ_HEADS} cols={cols} />
          <tbody>
            {list.length === 0 && <tr><td colSpan={EQ_HEADS.length} className="empty">{project.equipment.length ? "No equipment matches." : "No equipment yet. Select a valve, pump or agitator on the PFD and give it a tag, or add one below."}</td></tr>}
            {list.map((e) => {
              const drawn = shapes.get(e.id) ?? [];
              const use = equipmentUse(project, e.id);
              const clash = project.equipment.some((x) => x.id !== e.id && tagKey(x.tag) === tagKey(e.tag));
              return (
                <tr key={e.id} data-eq={e.id} className={props.flash === e.id ? "flash" : ""}>
                  <td><TagCell value={e.tag} bad={clash || !e.tag.trim()} onCommit={(v) => {
                    if (!v.trim()) return;
                    if (project.equipment.some((x) => x.id !== e.id && tagKey(x.tag) === tagKey(v))) return;
                    set(e.id, { tag: v.trim() });
                  }} /></td>
                  <td>
                    <select className="cell-input" value={e.type} aria-label={`Type of ${e.tag}`} onChange={(ev) => set(e.id, { type: ev.target.value as EquipmentType, initial: undefined })}>
                      {EQUIPMENT_TYPES.map((t) => <option key={t} value={t}>{TYPE_INFO[t].label}</option>)}
                    </select>
                  </td>
                  <td><input className="cell-input" value={e.name ?? ""} aria-label={`Name of ${e.tag}`} onChange={(ev) => set(e.id, { name: ev.target.value })} /></td>
                  <td>
                    <select className="cell-input" value={e.uoId ?? ""} aria-label={`Unit operation of ${e.tag}`} onChange={(ev) => set(e.id, { uoId: ev.target.value || undefined })}>
                      <option value="">–</option>
                      {uos.map((u) => <option key={u.id} value={u.id}>{u.code}</option>)}
                    </select>
                  </td>
                  <td>
                    {carries(e.type) ? (
                      <select className="cell-input" value={initialOf(e)} aria-label={`Initial state of ${e.tag}`} onChange={(ev) => set(e.id, { initial: ev.target.value })}>
                        {[...new Set([...TYPE_INFO[e.type].states, initialOf(e)])].map((st) => <option key={st} value={st}>{st}</option>)}
                      </select>
                    ) : <span className="faint">–</span>}
                  </td>
                  <td>
                    {drawn.length ? (
                      <button className="linkish" onClick={() => props.go?.({ kind: "pfd", scope: drawn[0].scope, elementId: drawn[0].elementId })} title="Show on the PFD">
                        {drawn[0].scope === MAP ? "Process map" : `${codeOf(drawn[0].scope)} drawing`}
                      </button>
                    ) : <span className="faint">Not drawn</span>}
                    {drawn.length > 1 && <span className="chip warn" title="A copied shape kept the tag: give it its own tag on the PFD">{drawn.length} shapes</span>}
                  </td>
                  <td>
                    {use.size ? [...use.entries()].map(([u, nos]) => (
                      <button key={u} className="linkish op-use" onClick={() => props.showUse(e.id, u)} title="Show in the state table">{codeOf(u)} {nos.join(", ")}</button>
                    )) : <span className="faint">–</span>}
                  </td>
                  <td><input className="cell-input" value={e.note ?? ""} aria-label={`Note of ${e.tag}`} onChange={(ev) => set(e.id, { note: ev.target.value })} /></td>
                  <td><RowMenu label={`More for ${e.tag}`} items={[{ label: "Delete", aria: `Delete ${e.tag}`, danger: true, onClick: () => void remove(e) }]} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="ops-tools">
        <input className="search mono" style={{ width: 160 }} placeholder="New tag, e.g. XV-120" value={tag} aria-label="New equipment tag" onChange={(e) => setTag(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") add(); }} />
        <select className="search ops-select" value={type || typeForTag(tag)} aria-label="Type of the new equipment" onChange={(e) => setType(e.target.value as EquipmentType)}>
          {EQUIPMENT_TYPES.map((t) => <option key={t} value={t}>{TYPE_INFO[t].label}</option>)}
        </select>
        <select className="search ops-select" value={uoId} aria-label="Unit operation of the new equipment" onChange={(e) => setUoId(e.target.value)}>
          <option value="">No unit operation</option>
          {uos.map((u) => <option key={u.id} value={u.id}>{u.code} · {u.name}</option>)}
        </select>
        <button className="btn small primary" disabled={!tag.trim()} onClick={add}>Add equipment</button>
        <span className="hint" style={{ margin: 0 }}>Tags you give PFD shapes are added here by themselves.</span>
      </div>
    </div>
  );
}

function TagCell(props: { value: string; bad: boolean; onCommit: (v: string) => void }) {
  const [v, setV] = useState(props.value);
  const [prev, setPrev] = useState(props.value);
  if (prev !== props.value) { setPrev(props.value); setV(props.value); }
  return <input className={`cell-input mono${props.bad ? " bad" : ""}`} value={v} aria-label="Tag" title={props.bad ? "Tag used twice or empty" : undefined}
    onChange={(e) => setV(e.target.value)} onBlur={() => { if (v.trim() !== props.value) { props.onCommit(v); setV(props.value); } }}
    onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setV(props.value); }} />;
}

function ImportOpsDialog(props: { fileName: string; plan: OpsImportPlan; onCancel: () => void; onApply: () => void }) {
  const { plan } = props;
  const nothing = !plan.uos.length && !plan.equipmentAdd.length && !plan.equipmentUpdate.length;
  return (
    <Dialog title={`Import ${props.fileName}`} wide onClose={props.onCancel} actions={<>
      <button className="btn" onClick={props.onCancel}>Cancel</button>
      <button className="btn primary" disabled={nothing} onClick={props.onApply}>Apply</button>
    </>}>
      <ul className="plain ops-import">
        <li><b>Equipment</b>: {plan.equipmentAdd.length} new{plan.equipmentAdd.length ? ` (${plan.equipmentAdd.slice(0, 12).map((e) => e.tag).join(", ")}${plan.equipmentAdd.length > 12 ? " …" : ""})` : ""}, {plan.equipmentUpdate.length} changed</li>
        {plan.uos.map((u) => (
          <li key={u.uoId}><b className="mono">{u.code}</b>: {u.steps.length} steps, {u.steps.reduce((n, s) => n + s.actions.length, 0)} actions
            {u.actionsFrom !== "none" ? ` (actions from the ${u.actionsFrom} sheet)` : ""}{u.before ? ` · replaces its ${u.before} steps` : ""}</li>
        ))}
        {!plan.uos.length && <li>No steps in the file: unit operations keep their steps.</li>}
      </ul>
      {plan.problems.length > 0 && (
        <div className="notice warn"><ul className="plain">{plan.problems.slice(0, 20).map((x, i) => <li key={i}>{x}</li>)}{plan.problems.length > 20 && <li>and {plan.problems.length - 20} more</li>}</ul></div>
      )}
      <p className="hint">Unit operations in the file get the file's steps; the others keep theirs. Equipment is matched by tag.</p>
    </Dialog>
  );
}
