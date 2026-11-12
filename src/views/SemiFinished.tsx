/**
 * The BOM screen's "Semi-finished (SAP)" sheet (N5.7): semi-finished products per unit operation (its run,
 * column packing, unpacking) with their SAP codes, the BOM each one gets from the BOM lines (and the
 * prepared materials' recipes), the checks SAP would trip on, and the SAP BOM workbook. Nothing here
 * changes the BOM lines or their quantities.
 */
import { useState } from "react";
import type { BomResult } from "../bom/model";
import { DATE_FORMATS, SEMI_KIND_LABEL, SMALLER_UNIT, addForEveryUo, addSemi, assignLine, checksOf as bomChecks, codeDigits, codeProblem, removeSemi, sapDate, sapScenario, setBomUnit, setSapSettings, setSemi, type SapBom, type SapIssue, type SapResult } from "../bom/sap";
import { sapWorkbook } from "../bom/sapExcel";
import { fmtQty } from "../mb/model";
import { newId } from "../model/ids";
import type { Project, SapDateFormat, SemiFinished, SemiKind } from "../model/types";
import { streamFlow, uoStreams } from "../ops/model";
import { downloadBlob } from "../storage/files";

type Confirm = (o: { title: string; body: string; confirmLabel: string; danger?: boolean }) => Promise<boolean>;
type Update = (fn: (p: Project) => Project) => void;

const localDay = () => new Date().toLocaleDateString("sv-SE");

/** Download the SAP BOM workbook (asks first when there are errors). The toast text, or null when nothing was exported. */
export async function exportSapBom(project: Project, sap: SapResult, confirm: Confirm): Promise<string | null> {
  if (!sap.boms.length) return null;
  if (sap.errors > 0 && !(await confirm({
    title: `Export with ${sap.errors} error${sap.errors === 1 ? "" : "s"}?`,
    body: "SAP would refuse those BOMs or items, or take a rounded quantity. They are listed on the Checks sheet of the workbook and on this screen. Export anyway?",
    confirmLabel: "Export anyway",
  }))) return null;
  const today = localDay();
  const blob = await sapWorkbook(sap, { project: project.meta.name, mbFile: project.mb.current?.fileName, today });
  downloadBlob(blob, `${project.meta.name} SAP BOM ${today}.xlsx`.replace(/[\\/:*?"<>|]/g, "-"));
  const items = sap.boms.reduce((n, b) => n + b.items.length, 0);
  return `SAP BOM workbook: ${sap.boms.length} BOMs, ${items} items${sap.errors ? `, ${sap.errors} errors (Checks sheet)` : ""}`;
}

export function SemiFinishedSheet(props: { project: Project; bom: BomResult; sap: SapResult; update: Update; confirm: Confirm; toast: (m: string) => void }) {
  const { project, bom, sap, update } = props;
  const setup = project.bom.sap;
  const semis = setup?.semi ?? [];
  const [pick, setPickState] = useState<string | null>(null);
  /** Show a BOM's items: the panel below the list comes into view. */
  const setPick = (key: string) => {
    setPickState(key);
    requestAnimationFrame(() => document.querySelector(".sf-items-panel")?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
  };
  const selected = sap.boms.find((b) => b.key === pick) ?? sap.boms[0] ?? null;
  const [addKind, setAddKind] = useState<SemiKind>("packing");
  const [addUo, setAddUo] = useState<string>("");
  const uos = [...project.uos].sort((a, b) => a.order - b.order);
  const checksOf = (key: string) => bomChecks(sap, key);
  const own = sap.boms.filter((b) => b.kind !== "prep");
  const prep = sap.boms.filter((b) => b.kind === "prep");

  const addEvery = () => {
    const added = uos.filter((u) => !semis.some((s) => s.kind === "uo" && s.uoId === u.id)).length;
    update((p) => addForEveryUo(p).project);
    props.toast(added ? `Added ${added} semi-finished product(s), one per unit operation: enter their SAP codes.` : "Every unit operation has one already.");
  };
  const addOne = () => {
    const uo = project.uos.find((u) => u.id === (addUo || uos[0]?.id));
    if (!uo) return;
    const id = newId("sf");
    update((p) => addSemi(p, { kind: addKind, uoId: uo.id, code: "", name: `${uo.code} ${SEMI_KIND_LABEL[addKind].toLowerCase()}` }, id).project);
    setPickState(id);
  };
  const remove = async (s: SemiFinished) => {
    if (!(await props.confirm({ title: `Remove ${s.code || s.name}?`, body: `The ${SEMI_KIND_LABEL[s.kind].toLowerCase()} semi-finished product is removed${s.kind === "uo" ? "" : "; its lines go back to the unit operation's"}. The BOM lines do not change.`, confirmLabel: "Remove", danger: true }))) return;
    update((p) => removeSemi(p, s.id));
  };
  const doExport = async () => {
    try { const msg = await exportSapBom(project, sap, props.confirm); if (msg) props.toast(msg); }
    catch (e) { props.toast(`Could not export: ${(e as Error).message}`); }
  };

  return (
    <>
      <SettingsPanel project={project} sap={sap} update={update} />

      <section className="panel" aria-label="Semi-finished products">
        <div className="section-head">
          <h2>Semi-finished products</h2>
          <span className="chip">{sap.boms.length} BOM{sap.boms.length === 1 ? "" : "s"}</span>
          {sap.errors > 0 && <span className="chip err">{sap.errors} error{sap.errors === 1 ? "" : "s"}</span>}
          {sap.warnings > 0 && <span className="chip warn">{sap.warnings} warning{sap.warnings === 1 ? "" : "s"}</span>}
          {sap.boms.length > 0 && !sap.errors && !sap.warnings && <span className="chip ok">Ready for SAP</span>}
          <span className="spacer" />
          <button className="btn small" onClick={addEvery} disabled={!uos.length} title="A semi-finished product for each unit operation that has none (its run)">Add for every unit operation</button>
          <span className="sf-add">
            <select className="search" value={addKind} onChange={(e) => setAddKind(e.target.value as SemiKind)} aria-label="Kind of semi-finished product to add">
              <option value="packing">Column packing</option>
              <option value="unpacking">Unpacking</option>
              <option value="uo">Unit operation</option>
            </select>
            <select className="search" value={addUo || uos[0]?.id || ""} onChange={(e) => setAddUo(e.target.value)} aria-label="Unit operation of the semi-finished product to add">
              {uos.map((u) => <option key={u.id} value={u.id}>{u.code} · {u.name}</option>)}
            </select>
            <button className="btn small" onClick={addOne} disabled={!uos.length}>Add</button>
          </span>
          <button className="btn small primary" onClick={doExport} disabled={!sap.boms.length} title="Header, items, materials, units and checks, with SAP field names">SAP BOM Excel…</button>
        </div>
        {!semis.length && (
          <div className="panel-pad sf-intro">
            <p><b>Split the BOM into semi-finished products for SAP.</b> Each unit operation's run becomes one (its buffers, filters and consumables, plus the semi-finished product before it); its column packing and unpacking can have their own. Buffers and media made from a recipe are semi-finished products under their own MatCode, listed below.</p>
            <p className="hint">Quantities: {sap.scenario?.name ?? "—"} scenario, per batch, before overage (the overage goes to SAP as component scrap). The BOM lines themselves do not change.</p>
            {uos.length > 0 && <div><button className="btn primary" onClick={addEvery}>Add one for every unit operation</button></div>}
          </div>
        )}
        {(own.length > 0 || prep.length > 0) && (
          <div className="table-wrap">
            <table className="grid bom-table sf-table">
              <thead>
                <tr>
                  <th>Kind</th><th>Unit operation</th><th>SAP code (MATNR)</th><th>Name (BOM text)</th><th>Base quantity (one batch)</th><th className="num">Items</th><th>Checks</th><th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {own.map((b) => <SemiRow key={b.key} b={b} project={project} sap={sap} selected={selected?.key === b.key} checks={checksOf(b.key)} update={update} onPick={() => setPick(b.key)} onRemove={() => remove(b.semi!)} />)}
                {prep.length > 0 && own.length > 0 && <tr className="sf-band"><td colSpan={8}>Prepared in-house: the recipe is the BOM (code = MatCode, Materials screen)</td></tr>}
                {prep.map((b) => {
                  const n = checksOf(b.key);
                  return (
                    <tr key={b.key} className={selected?.key === b.key ? "row-current" : n.some((i) => i.level === "error") ? "row-attn" : ""}>
                      <td>Prepared (recipe)</td>
                      <td className="mono hint" title="Used in these unit operations">{b.usedIn?.join(", ") ?? ""}</td>
                      <td className={`mono${codeProblem(sap.setup, b.code) ? " warn-text" : ""}`}>{b.code}</td>
                      <td>{b.name}</td>
                      <td><span className="mono">{fmtQty(b.baseQty)} {b.baseUnit}</span> <span className="hint">· {b.baseFrom}</span></td>
                      <td className="num"><button className="linkish" onClick={() => setPick(b.key)}>{b.items.length}</button></td>
                      <td><CheckChips list={n} /></td>
                      <td />
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {selected && <ItemsPanel key={selected.key} b={selected} project={project} bom={bom} sap={sap} update={update} />}

      <ChecksPanel sap={sap} update={update} onShow={(key) => setPick(key)} />
    </>
  );
}

function CheckChips({ list }: { list: SapIssue[] }) {
  const e = list.filter((i) => i.level === "error").length, w = list.filter((i) => i.level === "warning").length;
  if (!e && !w) return <span className="chip ok">OK</span>;
  return <>{e > 0 && <span className="chip err">{e} error{e === 1 ? "" : "s"}</span>} {w > 0 && <span className="chip warn">{w}</span>}</>;
}

function SemiRow(props: { b: SapBom; project: Project; sap: SapResult; selected: boolean; checks: SapIssue[]; update: Update; onPick: () => void; onRemove: () => void }) {
  const { b, project, sap, update } = props;
  const s = b.semi!;
  const set = (patch: Partial<Omit<SemiFinished, "id">>) => update((p) => setSemi(p, s.id, patch));
  const scen = sapScenario(project);
  const streams = b.uo ? uoStreams(project, b.uo.id) : [];
  const typed = s.baseQty != null;
  const streamValue = typed ? "__typed" : (s.stream && streams.some((x) => x.id === s.stream) ? s.stream : streams.find((x) => x.dir === "out")?.id ?? "");
  const flow = (id: string) => { const f = scen ? streamFlow(project, id, scen.id) : null; return f ? `${fmtQty(f.value)} ${f.unit}` : "no MB value"; };
  const bad = codeProblem(sap.setup, s.code);
  return (
    <tr className={props.selected ? "row-current" : props.checks.some((i) => i.level === "error") ? "row-attn" : ""}>
      <td>{SEMI_KIND_LABEL[s.kind]}</td>
      <td className="mono">{b.uo?.code ?? <span className="warn-text">deleted</span>}</td>
      <td><input className={`cell-input mono${bad ? " bad" : ""}`} value={s.code} placeholder={codeDigits(sap.setup) ? `${codeDigits(sap.setup)} digits` : "code"} onChange={(e) => set({ code: e.target.value.trim() })} aria-label={`SAP code of ${s.name}`} title={bad ? `The code is ${bad}` : "SAP material number of the semi-finished product"} /></td>
      <td><input className="cell-input" value={s.name} maxLength={80} onChange={(e) => set({ name: e.target.value })} aria-label={`Name of ${s.code || s.name}`} /></td>
      <td>
        {s.kind === "uo" ? (
          <div className="sf-base">
            <select className="cell-input" value={streamValue} aria-label={`Base quantity of ${s.code || s.name}`}
              onChange={(e) => (e.target.value === "__typed" ? set({ baseQty: b.baseQty ?? 1, baseUnit: b.appBaseUnit || "L", stream: undefined }) : set({ stream: e.target.value || undefined, baseQty: undefined, baseUnit: undefined }))}>
              {!streamValue && <option value="">{streams.length ? "Choose the output stream…" : "(no streams)"}</option>}
              {streams.map((x) => <option key={x.id} value={x.id}>{x.id} · {flow(x.id)}{x.dir === "out" ? " (out)" : x.dir === "in" ? " (in)" : ""}</option>)}
              <option value="__typed">Type a quantity…</option>
            </select>
            {typed && <BaseInputs s={s} set={set} />}
          </div>
        ) : <div className="sf-base"><BaseInputs s={{ ...s, baseQty: s.baseQty ?? 1, baseUnit: s.baseUnit ?? "EA" }} set={set} /></div>}
      </td>
      <td className="num"><button className="linkish" onClick={props.onPick} title="Show its items">{b.items.length}</button></td>
      <td><CheckChips list={props.checks} /></td>
      <td className="actions-cell"><button className="btn small" onClick={props.onRemove} aria-label={`Remove ${s.code || s.name}`}>Remove</button></td>
    </tr>
  );
}

function BaseInputs({ s, set }: { s: SemiFinished; set: (patch: Partial<Omit<SemiFinished, "id">>) => void }) {
  const [text, setText] = useState(String(s.baseQty ?? ""));
  return (
    <span className="sf-base-typed">
      <input className="cell-input num-input" inputMode="decimal" value={text} aria-label="Base quantity"
        onChange={(e) => { setText(e.target.value); const v = Number(e.target.value.replace(/,/g, "")); if (Number.isFinite(v) && v > 0) set({ baseQty: v }); }} />
      <input className="cell-input mono sf-unit" value={s.baseUnit ?? ""} aria-label="Base unit" onChange={(e) => set({ baseUnit: e.target.value.trim() || undefined })} />
    </span>
  );
}

function ItemsPanel(props: { b: SapBom; project: Project; bom: BomResult; sap: SapResult; update: Update }) {
  const { b, project, bom, sap, update } = props;
  const semis = project.bom.sap?.semi ?? [];
  const siblings = b.uo ? semis.filter((s) => s.uoId === b.uo!.id) : [];
  const runSemi = siblings.find((s) => s.kind === "uo");
  const others = siblings.filter((s) => s.kind !== "uo");
  const canMove = b.kind !== "prep" && others.length > 0;
  const rows = b.uo ? bom.uos.find((u) => u.uo.id === b.uo!.id)?.rows ?? [] : [];
  const notHere = b.semi && b.kind !== "uo" ? rows.filter((r) => !r.line.excluded && !(b.semi!.materials ?? []).includes(r.material.id)) : [];
  const [add, setAdd] = useState("");
  const bomUnits = project.bom.sap?.bomUnits ?? {};
  const label = (s: SemiFinished) => `${s.code || "(no code)"} · ${SEMI_KIND_LABEL[s.kind]}`;
  return (
    <section className="panel sf-items-panel" aria-label={`Items of ${b.code || b.name}`}>
      <div className="section-head">
        <h2>Items of <span className="mono">{b.code || "(no code)"}</span> · {b.name}</h2>
        <span className="chip">for {fmtQty(b.baseQty) || "—"} {b.baseUnit}</span>
        <span className="hint">{b.kind === "prep" ? "From its recipe (Materials screen)." : `From the counted lines of ${b.uo?.code ?? "?"}, ${sap.scenario?.name ?? ""}, before overage.`}</span>
        <span className="spacer" />
        {notHere.length > 0 && (
          <>
            <select className="search" value={add} onChange={(e) => setAdd(e.target.value)} aria-label={`Line of ${b.uo?.code} to add to ${b.code || b.name}`}>
              <option value="">Add a line of {b.uo?.code}…</option>
              {notHere.map((r) => <option key={r.material.id} value={r.material.id}>{r.material.code} · {r.material.name}</option>)}
            </select>
            <button className="btn small" disabled={!add} onClick={() => { update((p) => assignLine(p, b.uo!.id, add, b.semi!.id)); setAdd(""); }}>Add</button>
          </>
        )}
      </div>
      {!b.items.length ? (
        <p className="hint panel-pad" style={{ margin: 0 }}>{b.kind === "uo" ? "No items: the unit operation has no counted lines (or all are on its packing or unpacking)." : b.kind === "prep" ? "No items." : `No items yet: add the lines of ${b.uo?.code ?? "its unit operation"} it takes (resin, packing buffer …), or move them here from the unit operation's list.`}</p>
      ) : (
        <div className="table-wrap">
          <table className="grid bom-table sf-items">
            <thead>
              <tr>
                <th>POSNR</th><th>Component (IDNRK)</th><th>Name</th><th className="num">Quantity (MENGE)</th><th>Unit</th><th>Fixed</th><th className="num">Scrap %</th><th>Source</th>
                {canMove && <th>Semi-finished</th>}<th>Unit in SAP BOMs</th>
              </tr>
            </thead>
            <tbody>
              {b.items.map((it) => {
                const m = it.materialId ? project.materials.find((x) => x.id === it.materialId) : undefined;
                const smaller = m ? SMALLER_UNIT[m.unit.trim().toLowerCase()] : undefined;
                const conv = m ? bomUnits[m.id] : undefined;
                const rounded = it.qty != null && it.sapQty !== it.qty;
                const bad = codeProblem(sap.setup, it.code);
                return (
                  <tr key={it.pos} className={rounded || bad ? "row-attn" : ""}>
                    <td className="mono">{it.pos}</td>
                    <td className={`mono${bad ? " warn-text" : ""}`} title={bad ? `The code is ${bad}` : undefined}>{it.code}</td>
                    <td>{it.name}</td>
                    <td className="num" title={rounded ? `Exact: ${it.qty} ${it.unit}` : undefined}>{it.sapQty == null ? <span className="warn-text">–</span> : it.sapQty.toFixed(3)}{rounded && <span className="warn-text"> *</span>}</td>
                    <td className="mono">{it.unit}</td>
                    <td>{it.fixed ? "X" : ""}</td>
                    <td className="num">{it.scrapPct ?? ""}</td>
                    <td className="hint">{it.source}</td>
                    {canMove && (
                      <td>{m && !it.semiId ? (
                        <select className="cell-input" value={b.kind === "uo" ? runSemi?.id ?? "" : b.semi!.id} aria-label={`Semi-finished product of ${it.code}`}
                          onChange={(e) => update((p) => assignLine(p, b.uo!.id, m.id, e.target.value && e.target.value !== runSemi?.id ? e.target.value : null))}>
                          <option value={runSemi?.id ?? ""}>{runSemi ? label(runSemi) : `${b.uo!.code} run`}</option>
                          {others.map((s) => <option key={s.id} value={s.id}>{label(s)}</option>)}
                        </select>
                      ) : null}</td>
                    )}
                    <td>{m && (conv || (smaller && rounded)) ? (
                      <select className="cell-input" value={conv ? "1" : ""} aria-label={`Unit of ${it.code} in SAP BOMs`}
                        onChange={(e) => update((p) => setBomUnit(p, m.id, e.target.value ? { unit: smaller ?? conv!.unit, factor: conv?.factor ?? 1000 } : null))}>
                        <option value="">{m.unit} (its unit)</option>
                        <option value="1">{conv ? `${conv.unit} (1 ${m.unit} = ${fmtQty(conv.factor)} ${conv.unit})` : `${smaller} (1 ${m.unit} = 1,000 ${smaller})`}</option>
                      </select>
                    ) : <span className="hint">{it.appUnit}</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function ChecksPanel({ sap, update, onShow }: { sap: SapResult; update: Update; onShow: (key: string) => void }) {
  const [openCodes, setOpenCodes] = useState(false);
  const [openNotes, setOpenNotes] = useState(false);
  if (!sap.issues.length) return sap.boms.length ? <div className="notice ok">No checks: every code, quantity and unit is as SAP expects it.</div> : null;
  const codes = sap.issues.filter((i) => i.group === "codes");
  const notes = sap.issues.filter((i) => i.level === "note");
  const rest = sap.issues.filter((i) => i.group !== "codes" && i.level !== "note");
  const n = codeDigits(sap.setup);
  const li = (i: SapIssue, k: number) => (
    <li key={k} className={`sf-issue ${i.level}`}>
      <span className={`chip ${i.level === "error" ? "err" : i.level === "warning" ? "warn" : ""}`}>{i.level}</span>
      <span>{i.message}</span>
      {i.fix && <button className="btn small" onClick={() => update((p) => setBomUnit(p, i.fix!.materialId, { unit: i.fix!.unit, factor: i.fix!.factor }))} title="Count it in the smaller unit in the SAP BOMs (an alternative unit of the material, listed on the Units sheet)">{i.fix.label}</button>}
      {i.key && <button className="linkish" onClick={() => onShow(i.key!)}>Show</button>}
    </li>
  );
  return (
    <section className="panel" aria-label="SAP checks">
      <div className="section-head">
        <h2>Checks</h2>
        {sap.errors > 0 && <span className="chip err">{sap.errors} error{sap.errors === 1 ? "" : "s"}</span>}
        {sap.warnings > 0 && <span className="chip warn">{sap.warnings} warning{sap.warnings === 1 ? "" : "s"}</span>}
        <span className="hint">Errors: SAP would refuse the BOM or item, or keep a rounded quantity. The workbook lists the same on its Checks sheet.</span>
      </div>
      <div className="panel-pad">
        <ul className="issues sf-issues">
          {codes.length > 0 && (
            <li className="sf-issue error">
              <span className="chip err">error</span>
              <span>{codes.length} material{codes.length === 1 ? " has a code" : "s have codes"} that {codes.length === 1 ? "is" : "are"} not {n > 0 ? `a ${n}-digit number` : "a SAP number"}. MatCode is the SAP material number: change {codes.length === 1 ? "it" : "them"} on the Materials screen{n > 0 ? ", or the code rule in the settings above" : ""}.</span>
              <button className="linkish" onClick={() => setOpenCodes(!openCodes)} aria-expanded={openCodes}>{openCodes ? "Hide" : "Show"} the list</button>
            </li>
          )}
          {openCodes && codes.map((i, k) => <li key={`c${k}`} className="sf-issue sub" title={i.message}>{i.short ?? i.message}</li>)}
          {rest.map(li)}
          {notes.length > 0 && (
            <li className="sf-issue note">
              <span className="chip">note</span>
              <span>{notes.length} item{notes.length === 1 ? " is" : "s are"} 0 in {sap.scenario?.name ?? "this scenario"} and left out.</span>
              <button className="linkish" onClick={() => setOpenNotes(!openNotes)} aria-expanded={openNotes}>{openNotes ? "Hide" : "Show"}</button>
            </li>
          )}
          {openNotes && notes.map((i, k) => <li key={`n${k}`} className="sf-issue sub">{i.message}</li>)}
        </ul>
      </div>
    </section>
  );
}

function SettingsPanel({ project, sap, update }: { project: Project; sap: SapResult; update: Update }) {
  const s = project.bom.sap ?? { semi: [] };
  const set = (patch: Parameters<typeof setSapSettings>[1]) => update((p) => setSapSettings(p, patch));
  const unitsText = Object.entries(s.units ?? {}).map(([k, v]) => `${k}=${v}`).join(", ");
  const [units, setUnits] = useState(unitsText);
  const [digits, setDigits] = useState(String(codeDigits(s)));
  const scen = sapScenario(project);
  const [open, setOpenState] = useState<boolean>(() => { try { const v = localStorage.getItem("pcs.bom.sapSettings"); return v ? v === "1" : !s.plant; } catch { return !s.plant; } });
  const setOpen = (v: boolean) => { setOpenState(v); try { localStorage.setItem("pcs.bom.sapSettings", v ? "1" : "0"); } catch { /* not remembered */ } };
  const summary = [
    s.plant ? `Plant ${s.plant}` : "No plant yet",
    `${scen?.name ?? "—"} quantities`,
    `valid from ${s.validFrom ? sapDate(s.validFrom, sap.setup.dateFormat) : "the export day"} (${sap.setup.dateFormat})`,
    `usage ${sap.setup.usage} · alternative ${sap.setup.alternative} · status ${sap.setup.status}`,
    codeDigits(s) ? `${codeDigits(s)}-digit codes` : "any code",
  ].join(" · ");
  return (
    <section className="panel" aria-label="SAP settings">
      <div className="section-head">
        <button className="fold-btn" onClick={() => setOpen(!open)} aria-expanded={open} aria-label={`${open ? "Hide" : "Show"} the SAP settings`}>{open ? "▾" : "▸"}</button>
        <h2>SAP settings</h2>
        {open ? <span className="hint">Written on every BOM header. Ask your SAP key user for the plant and the date format of your SAP profile.</span>
          : <span className={s.plant ? "hint" : "hint warn-text"}>{summary}</span>}
        {!open && <button className="linkish" onClick={() => setOpen(true)}>Change</button>}
      </div>
      {open && <div className="panel-pad sf-settings">
        <label className="field">Plant (WERKS)
          <input value={s.plant ?? ""} placeholder="e.g. 1000" onChange={(e) => set({ plant: e.target.value.trim() })} className={s.plant ? "" : "bad-soft"} />
        </label>
        <label className="field">Quantities of
          <select value={scen?.id ?? ""} onChange={(e) => set({ scenarioId: e.target.value })}>
            {project.mb.scenarios.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        </label>
        <label className="field">Valid from (DATUV)
          <input type="date" value={s.validFrom ?? ""} onChange={(e) => set({ validFrom: e.target.value || undefined })} title="Empty: the day of the export" />
        </label>
        <label className="field">Date format
          <select value={sap.setup.dateFormat} onChange={(e) => set({ dateFormat: e.target.value as SapDateFormat })}>
            {DATE_FORMATS.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </label>
        <label className="field">BOM usage (STLAN)
          <input value={s.usage ?? ""} placeholder="1" onChange={(e) => set({ usage: e.target.value.trim() })} />
        </label>
        <label className="field">Alternative (STLAL)
          <input value={s.alternative ?? ""} placeholder="1" onChange={(e) => set({ alternative: e.target.value.trim() })} />
        </label>
        <label className="field">Status (STLST)
          <input value={s.status ?? ""} placeholder="1" onChange={(e) => set({ status: e.target.value.trim() })} />
        </label>
        <label className="field">Codes: digits
          <input inputMode="numeric" value={digits} title="Material numbers are numbers of this many digits; 0 = any code" onChange={(e) => {
            setDigits(e.target.value);
            const v = Number(e.target.value);
            if (Number.isInteger(v) && v >= 0 && v <= 18) set({ codeDigits: v === 7 ? undefined : v });
          }} />
        </label>
        <label className="field">Other units (app=SAP)
          <input value={units} placeholder="pcs=PC, set=SET" title="L, mL, kg, g, mg and EA are known. Add others as unit=SAP unit, separated by commas."
            onChange={(e) => setUnits(e.target.value)}
            onBlur={() => {
              const map = Object.fromEntries(units.split(/[,;]/).map((x) => x.split("=").map((y) => y.trim())).filter((x) => x.length === 2 && x[0] && x[1]).map(([k, v]) => [k.toLowerCase(), v]));
              update((p) => setSapSettings(p, { units: Object.keys(map).length ? map : undefined }));
            }} />
        </label>
        <label className="check sf-chain">
          <input type="checkbox" checked={s.chain !== false} onChange={(e) => set({ chain: e.target.checked ? undefined : false })} />
          A unit operation's BOM takes the semi-finished product before it (the transfer in)
        </label>
      </div>}
    </section>
  );
}
