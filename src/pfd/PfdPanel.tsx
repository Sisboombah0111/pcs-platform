import { useMemo, useState } from "react";
import { isUoCode } from "../model/ids";
import type { CustomSymbol, Equipment, Material, MbRow, UnitOperation } from "../model/types";
import { TYPE_INFO } from "../ops/model";
import { MY_SYMBOLS, customPreviewUrl } from "./customSymbols";
import { CATEGORIES, SYMBOLS, symbolById, symbolPreviewSvg } from "./symbols";
import { MAP, pcsOf, type BoardElement, type PcsData, type StreamInfo } from "./sync";

export type Selection =
  | { kind: "none" }
  | { kind: "arrow"; el: BoardElement }
  | { kind: "frame"; el: BoardElement }
  | { kind: "box"; el: BoardElement }
  | { kind: "port"; el: BoardElement }
  | { kind: "shape"; el: BoardElement; count: number }
  | { kind: "table"; el: BoardElement }
  | { kind: "many"; count: number };

export interface PanelActions {
  insertSymbol: (id: string) => void;
  insertCustomSymbol: (id: string) => void;
  /** Add symbols from files: pictures, Excalidraw library files, symbol sets. */
  uploadSymbols: () => void;
  saveSelectionAsSymbol: (name: string, category: string) => void;
  updateSymbol: (id: string, patch: Partial<Pick<CustomSymbol, "name" | "category">>) => void;
  deleteSymbol: (id: string) => void;
  exportSymbols: () => void;
  insertFreeTable: () => void;
  insertStreamTable: () => void;
  /** Add a UO (a box on the map and its drawing); `open` switches to its drawing. */
  addUnit: (name: string, open?: boolean) => void;
  renameUnit: (uoId: string, code: string, name: string) => void;
  deleteUnit: (uoId: string) => void;
  /** Copy a unit operation (drawing, and if wanted its steps, BOM lines and equipment with new tags). */
  duplicateUnit: (uoId: string) => void;
  putOnMap: (uoId: string) => void;
  openScope: (scope: string) => void;
  patchPcs: (elementId: string, next: PcsData) => void;
  /** Give a shape an equipment tag (new equipment, or one in the list not drawn yet); "" takes it off. */
  setTag: (elementId: string, tag: string) => void;
  openOperations: (equipmentId?: string) => void;
  renameStream: (streamId: string, name: string) => void;
  focus: (elementId: string) => void;
  /** Show a stream's arrow, switching drawings when it is on another one. */
  focusStream: (streamId: string) => void;
  copyText: (text: string, what: string) => void;
}

type Tab = "symbols" | "units" | "streams";

/** A shape's equipment: the list entry, how many shapes carry it, and its actions in the steps. */
export interface EquipmentInfo {
  equipment?: Equipment;
  shapes: number;
  uses: { uo: string; steps: { no: number; name: string; text: string }[] }[];
}

export function PfdPanel(props: {
  /** Drawing on screen: MAP or a UO id. */
  scope: string;
  uos: UnitOperation[];
  onMap: Set<string>;
  hasSheet: (uoId: string) => boolean;
  streams: StreamInfo[];
  materials: Material[];
  /** Symbols the user added (project.symbols). */
  customSymbols: CustomSymbol[];
  selection: Selection;
  actions: PanelActions;
  tableEditor?: React.ReactNode;
  /** Applied Mass Balance, when there is one: its rows per stream. */
  mb?: { scenarios: { id: string; name: string }[]; rowsOf: (streamId: string) => MbRow[]; format: (v: number | null | undefined) => string };
  equipmentOf?: (el: BoardElement) => EquipmentInfo;
}) {
  const [tab, setTab] = useState<Tab>("symbols");
  const { uos, streams, selection, actions } = props;
  const codeOf = (id?: string) => uos.find((u) => u.id === id)?.code ?? "?";

  return (
    <aside className="pfd-panel" aria-label="PFD panel">
      {selection.kind !== "none" && (
        <section className="inspector">
          <Inspector {...props} codeOf={codeOf} />
        </section>
      )}
      <div className="panel-tabs" role="tablist">
        {(["symbols", "units", "streams"] as Tab[]).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className="panel-tab" onClick={() => setTab(t)}>
            {t === "symbols" ? "Symbols" : t === "units" ? `Units ${uos.length}` : `Streams ${streams.length}`}
          </button>
        ))}
      </div>
      <div className="panel-body">
        {tab === "symbols" && <SymbolPalette scope={props.scope} custom={props.customSymbols} actions={actions} />}
        {tab === "units" && <Units uos={uos} streams={streams} onMap={props.onMap} hasSheet={props.hasSheet} scope={props.scope} actions={actions} />}
        {tab === "streams" && (
          <>
            {streams.length === 0 ? (
              <p className="panel-hint">No streams yet. In a unit operation drawing, an arrow is a stream when an end is inside the frame. On the process map, an arrow from one box to another is a transfer.</p>
            ) : (
              <ul className="stream-list">
                {streams.map((s) => (
                  <li key={s.streamId}>
                    <button className="stream-row" onClick={() => actions.focusStream(s.streamId)} title={s.scope === props.scope ? "Show on this drawing" : s.scope === MAP ? "Show on the process map" : `Show in the ${codeOf(s.scope)} drawing`}>
                      <span className="mono sid">{s.streamId}</span>
                      <span className="route">{s.kind === "transfer" ? `${codeOf(s.fromUoId)} → ${codeOf(s.toUoId)}` : codeOf(s.uoId)}</span>
                      {s.name && <span className="sname">{s.name}</span>}
                      {props.mb && <StreamValue rows={props.mb.rowsOf(s.streamId)} mb={props.mb} />}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="panel-actions">
              <button className="btn small" disabled={!streams.length} onClick={actions.insertStreamTable}>Insert stream table</button>
              <button className="btn small" disabled={!streams.length} onClick={() => actions.copyText(
                ["StreamID\tType\tFrom\tTo\tName", ...streams.map((s) => [s.streamId, s.kind === "transfer" ? "transfer" : "in UO",
                  s.kind === "transfer" ? codeOf(s.fromUoId) : codeOf(s.uoId), s.kind === "transfer" ? codeOf(s.toUoId) : codeOf(s.uoId), s.name ?? ""].join("\t"))].join("\n"),
                "Stream list")}>Copy list</button>
            </div>
          </>
        )}
      </div>
    </aside>
  );
}

function Units(props: { uos: UnitOperation[]; streams: StreamInfo[]; onMap: Set<string>; hasSheet: (id: string) => boolean; scope: string; actions: PanelActions }) {
  const [name, setName] = useState("");
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of props.streams) { const k = s.uoId ?? s.toUoId ?? ""; m.set(k, (m.get(k) ?? 0) + 1); }
    return m;
  }, [props.streams]);
  const add = () => { props.actions.addUnit(name.trim() || "Unit operation"); setName(""); };
  const off = props.uos.filter((u) => !props.onMap.has(u.id));
  return (
    <>
      {props.uos.length === 0 && <p className="panel-hint">A unit operation is a box on the process map, with its own drawing. Add one here.</p>}
      <ul className="unit-list">
        {props.uos.filter((u) => props.onMap.has(u.id)).map((u) => (
          <UnitRow key={u.id} uo={u} others={props.uos.filter((x) => x.id !== u.id).map((x) => x.code)} streams={counts.get(u.id) ?? 0}
            current={props.scope === u.id} actions={props.actions} canOpen={props.hasSheet(u.id)} />
        ))}
      </ul>
      {off.length > 0 && (
        <>
          <div className="field"><span>Not on the process map</span></div>
          <ul className="unit-list">
            {off.map((u) => (
              <UnitRow key={u.id} uo={u} others={props.uos.filter((x) => x.id !== u.id).map((x) => x.code)} streams={counts.get(u.id) ?? 0}
                current={props.scope === u.id} actions={props.actions} canOpen={props.hasSheet(u.id)} off />
            ))}
          </ul>
        </>
      )}
      <div className="panel-add">
        <input className="search" placeholder="New unit operation, e.g. 500L Bioreactor" value={name} onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") add(); }} aria-label="New unit operation name" />
        <button className="btn small primary" onClick={add}>Add</button>
      </div>
      <p className="panel-hint">Each unit operation has a box on the process map and its own drawing (tabs above the board). Rename one here, on its box, or on its frame title.</p>
    </>
  );
}

function UnitRow(props: { uo: UnitOperation; others: string[]; streams: number; current: boolean; canOpen: boolean; off?: boolean; actions: PanelActions }) {
  const { uo, actions } = props;
  return (
    <li className={`unit-row${props.off ? " off" : ""}`}>
      <span className="unit-order mono">{props.off ? "–" : uo.order}</span>
      <UnitTitle uo={uo} others={props.others} onRename={(c, n) => actions.renameUnit(uo.id, c, n)} />
      {props.off
        ? <button className="btn ghost small" onClick={() => actions.putOnMap(uo.id)} title="Put its box back on the process map">Put back</button>
        : <button className="btn ghost small" disabled={!props.canOpen || props.current} onClick={() => actions.openScope(uo.id)} title={`Open its drawing (${props.streams} stream(s))`}>Open</button>}
      <button className="btn ghost small" disabled={!props.canOpen} onClick={() => actions.duplicateUnit(uo.id)} aria-label={`Duplicate ${uo.code}`} title="Duplicate: its drawing, steps, BOM lines and equipment (new tags)">⧉</button>
      <button className="btn ghost small danger" onClick={() => actions.deleteUnit(uo.id)} aria-label={`Delete ${uo.code}`} title="Delete this unit operation">×</button>
    </li>
  );
}

/** Code and name inputs; a change is committed when the input loses focus. */
function UnitTitle(props: { uo: UnitOperation; others: string[]; onRename: (code: string, name: string) => void }) {
  const [code, setCode] = useState(props.uo.code);
  const [name, setName] = useState(props.uo.name);
  const [prev, setPrev] = useState(props.uo);
  if (prev !== props.uo) { setPrev(props.uo); setCode(props.uo.code); setName(props.uo.name); }
  const c = code.trim().toUpperCase();
  const codeError = !isUoCode(c) ? "1–10 capital letters or digits, with a letter" : props.others.includes(c) ? "Another unit uses this code" : "";
  const commit = () => {
    if (codeError || !name.trim()) { setCode(props.uo.code); setName(props.uo.name); return; }
    if (c !== props.uo.code || name.trim() !== props.uo.name) props.onRename(c, name.trim());
  };
  return (
    <>
      <input className={`cell-input mono unit-code${codeError ? " bad" : ""}`} value={code} title={codeError || "UO code used in Stream IDs"}
        onChange={(e) => setCode(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} aria-label="UO code" />
      <input className="cell-input" value={name} onChange={(e) => setName(e.target.value)} onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} aria-label="UO name" />
    </>
  );
}

function Inspector(props: Parameters<typeof PfdPanel>[0] & { codeOf: (id?: string) => string }) {
  const { selection, actions, streams, materials, codeOf } = props;
  if (selection.kind === "many") return <div className="insp"><p className="panel-hint">{selection.count} items selected.</p><SaveAsSymbol key={`many${selection.count}`} custom={props.customSymbols} actions={actions} /></div>;
  if (selection.kind === "arrow") {
    const pcs = pcsOf(selection.el);
    const own = streams.find((x) => x.elementId === selection.el.id);
    const s = own ?? (pcs.segment ? streams.find((x) => x.streamId === pcs.streamId) : undefined);
    const route = s ? (s.kind === "transfer" ? `${codeOf(s.fromUoId)} → ${codeOf(s.toUoId)} (transfer)` : `inside ${codeOf(s.uoId)}`) : "";
    const why = props.scope === MAP
      ? "Not a stream: on the process map, an arrow is a transfer when it runs from one unit operation box to another."
      : "Not a stream: neither end is inside the unit operation frame.";
    return (
      <div className="insp">
        <div className="insp-title">{s && !own ? "Arrow · part of a transfer" : "Arrow"}</div>
        {s ? (
          <dl className="kv">
            <dt>Stream ID</dt><dd className="mono">{s.streamId}</dd>
            <dt>Route</dt><dd>{route}</dd>
          </dl>
        ) : (
          <p className="panel-hint">{pcs.ignore ? "Marked as not a stream." : why}</p>
        )}
        {s && !own && <p className="panel-hint">This arrow runs to a connector, so it carries the transfer's ID; the transfer itself is the arrow on the process map.</p>}
        {s && props.mb && <MbRows rows={props.mb.rowsOf(s.streamId)} mb={props.mb} />}
        {s && (
          <label className="field">
            <span>Stream name</span>
            <NameInput value={s.name ?? ""} onCommit={(v) => actions.renameStream(s.streamId, v)} />
          </label>
        )}
        {s && !own && <div className="panel-actions"><button className="btn small" onClick={() => actions.focusStream(s.streamId)}>Show on the process map</button></div>}
        {(own || !s) && (
          <label className="check">
            <input type="checkbox" checked={!!pcs.ignore} onChange={(e) => actions.patchPcs(selection.el.id, { ...pcs, ignore: e.target.checked || undefined })} />
            <span>Not a process stream (drawing only)</span>
          </label>
        )}
        <MaterialLinks el={selection.el} grouped={false} materials={materials} onMap={props.scope === MAP}
          line={props.scope !== MAP
            ? { counted: true, hint: `Link the line used here, e.g. 1 × 1.5" Line 2 m: it counts in the BOM of ${codeOf(props.scope)}.` }
            : own?.kind === "transfer"
              ? { counted: true, hint: `Link the line used for this transfer, e.g. 1 × 2" Line 2.5 m: it counts in the BOM of ${codeOf(own.toUoId)}, the destination.` }
              : { counted: false, hint: "On the process map only transfer arrows (box to box) count in the BOM." }}
          onChange={(next) => actions.patchPcs(selection.el.id, next)} />
      </div>
    );
  }
  if (selection.kind === "box" || (selection.kind === "frame" && pcsOf(selection.el).kind === "uo")) {
    const uo = props.uos.find((u) => u.id === pcsOf(selection.el).uoId);
    const n = uo ? streams.filter((s) => s.uoId === uo.id || s.toUoId === uo.id || s.fromUoId === uo.id).length : 0;
    return (
      <div className="insp">
        <div className="insp-title">Unit operation</div>
        {uo ? (
          <>
            <div className="unit-row insp-unit"><UnitTitle uo={uo} others={props.uos.filter((x) => x.id !== uo.id).map((x) => x.code)} onRename={(c, nm) => actions.renameUnit(uo.id, c, nm)} /></div>
            <dl className="kv"><dt>Streams</dt><dd>{n} (transfers included)</dd></dl>
            <div className="panel-actions">
              {selection.kind === "box"
                ? <button className="btn small primary" disabled={!props.hasSheet(uo.id)} onClick={() => actions.openScope(uo.id)}>Open its drawing</button>
                : <button className="btn small" onClick={() => actions.openScope(MAP)}>Show the process map</button>}
              <button className="btn small" disabled={!props.hasSheet(uo.id)} onClick={() => actions.duplicateUnit(uo.id)} title="A copy of this unit operation: its drawing, steps, BOM lines and equipment (new tags)">Duplicate…</button>
            </div>
          </>
        ) : <p className="panel-hint">Being registered…</p>}
        <p className="panel-hint">{selection.kind === "box" ? "Double-click the box to rename it (first line the code, then the name)." : "Double-click the frame title to rename it (\"CODE · Name\")."}</p>
      </div>
    );
  }
  if (selection.kind === "frame") return <div className="insp"><div className="insp-title">Frame</div><p className="panel-hint">{props.scope === MAP ? "A frame on the process map is only a drawing aid." : "Only the unit operation frame counts for streams."}</p></div>;
  if (selection.kind === "port") {
    const pcs = pcsOf(selection.el);
    const t = streams.find((x) => x.streamId === pcs.port && x.kind === "transfer");
    const other = t ? (pcs.dir === "out" ? t.toUoId : t.fromUoId) : undefined;
    return (
      <div className="insp">
        <div className="insp-title">Connector · {pcs.dir === "out" ? "transfer out" : "transfer in"}</div>
        {t && !pcs.orphan ? (
          <>
            <dl className="kv">
              <dt>Stream ID</dt><dd className="mono">{t.streamId}</dd>
              <dt>Route</dt><dd>{codeOf(t.fromUoId)} → {codeOf(t.toUoId)}</dd>
              {t.name && <><dt>Name</dt><dd>{t.name}</dd></>}
            </dl>
            {props.mb && <MbRows rows={props.mb.rowsOf(t.streamId)} mb={props.mb} />}
            <div className="panel-actions">
              {other && props.hasSheet(other) && <button className="btn small" onClick={() => actions.openScope(other)}>Open {codeOf(other)}</button>}
              <button className="btn small" onClick={() => actions.focusStream(t.streamId)}>Show on the process map</button>
            </div>
            <p className="panel-hint">The app draws a connector for each transfer on the process map. Draw an arrow from your equipment to it; move it where it suits the drawing.</p>
          </>
        ) : (
          <p className="panel-hint">Not connected: transfer {pcs.port} is no longer on the process map. Draw it again between the two boxes there (it gets its ID back), or delete this connector.</p>
        )}
      </div>
    );
  }
  if (selection.kind === "table") return <div className="insp"><div className="insp-title">Table</div>{props.tableEditor}</div>;
  if (selection.kind === "shape") {
    const sid = pcsOf(selection.el).symbol;
    const symName = sid ? symbolById(sid)?.name ?? props.customSymbols.find((c) => c.id === sid)?.name : undefined;
    return (
      <>
        <div className="insp">
          <div className="insp-title">{pcsOf(selection.el).symbol ? `Equipment · ${symName ?? "symbol"}` : selection.count > 1 ? "Group" : "Shape"}</div>
          {props.equipmentOf && <EquipmentField key={selection.el.id} el={selection.el} info={props.equipmentOf(selection.el)} actions={actions} />}
        </div>
        <MaterialLinks el={selection.el} grouped={selection.count > 1} symbolName={symName} materials={materials} onMap={props.scope === MAP} onChange={(next) => actions.patchPcs(selection.el.id, next)} noTitle />
        <SaveAsSymbol key={selection.el.id} custom={props.customSymbols} actions={actions} defaultName={symName ? `${symName} (custom)` : ""} />
      </>
    );
  }
  return null;
}

type MbProp = NonNullable<Parameters<typeof PfdPanel>[0]["mb"]>;

/** One stream's applied MB values: the flow row, then its material rows. */
function MbRows(props: { rows: MbRow[]; mb: MbProp }) {
  const { rows, mb } = props;
  const vals = (r: MbRow) => mb.scenarios.filter((sc) => r.values[sc.id] != null).map((sc) => `${sc.name} ${mb.format(r.values[sc.id])}`).join(" · ");
  if (!rows.length) return <p className="panel-hint">No value for this stream in the applied mass balance.</p>;
  return (
    <div className="mb-rows">
      <div className="field"><span>Mass balance</span></div>
      <ul>
        {rows.map((r) => (
          <li key={`${r.matCode ?? ""}${r.sourceRow ?? ""}`}>
            <span className="mono">{r.matCode ?? "Flow"}</span>
            <span>{vals(r)} {r.unit}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function StreamValue(props: { rows: MbRow[]; mb: MbProp }) {
  const flow = props.rows.find((r) => !r.matCode);
  if (!flow) return <span className="sval missing" title="No flow row in the applied mass balance">no MB value</span>;
  const first = props.mb.scenarios.find((sc) => flow.values[sc.id] != null);
  return <span className="sval">{first ? `${props.mb.format(flow.values[first.id])} ${flow.unit}` : ""}</span>;
}

function NameInput(props: { value: string; onCommit: (v: string) => void }) {
  const [v, setV] = useState(props.value);
  const [prev, setPrev] = useState(props.value);
  if (prev !== props.value) { setPrev(props.value); setV(props.value); }
  return <input className="search" style={{ width: "100%" }} value={v} placeholder="e.g. Basal media feed" onChange={(e) => setV(e.target.value)}
    onBlur={() => v.trim() !== props.value && props.onCommit(v.trim())} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />;
}

/** The equipment tag of a shape (the key to the steps on Operations) and what the steps do with it. */
function EquipmentField(props: { el: BoardElement; info: EquipmentInfo; actions: PanelActions }) {
  const { info, actions } = props;
  const eq = info.equipment;
  const [v, setV] = useState(eq?.tag ?? "");
  const [prev, setPrev] = useState(eq?.tag ?? "");
  if (prev !== (eq?.tag ?? "")) { setPrev(eq?.tag ?? ""); setV(eq?.tag ?? ""); }
  const commit = () => { if (v.trim() !== (eq?.tag ?? "")) actions.setTag(props.el.id, v); };
  const shown = info.uses.flatMap((u) => u.steps.map((s) => ({ ...s, uo: u.uo })));
  return (
    <div className="eq-field">
      <label className="field">
        <span>Equipment tag</span>
        <input className="search mono" style={{ width: "100%" }} value={v} placeholder="e.g. XV-101, P-101" aria-label="Equipment tag"
          onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setV(eq?.tag ?? ""); }} />
      </label>
      {eq && info.shapes > 1 && <p className="panel-hint warn-text">{eq.tag} is on {info.shapes} shapes: this may be a copy. Type a tag of its own here.</p>}
      {eq ? (
        <>
          <p className="panel-hint">{TYPE_INFO[eq.type].label}{eq.name ? ` · ${eq.name}` : ""}. {shown.length ? `In ${shown.length} step(s):` : "Not in any step yet."}</p>
          {shown.length > 0 && (
            <ul className="eq-uses">
              {shown.slice(0, 6).map((s, i) => <li key={i}><span className="mono">{s.uo} {s.no}</span> {s.name}: <b>{s.text}</b></li>)}
              {shown.length > 6 && <li className="panel-hint">and {shown.length - 6} more</li>}
            </ul>
          )}
          <div className="panel-actions"><button className="btn small" onClick={() => actions.openOperations(eq.id)}>Show in Operations</button></div>
        </>
      ) : (
        <p className="panel-hint">Give a valve, pump or agitator a tag to use it in the steps (Operations). The tag becomes the first line of its label.</p>
      )}
    </div>
  );
}

function MaterialLinks(props: {
  el: BoardElement; grouped: boolean; symbolName?: string; materials: Material[]; onMap: boolean; onChange: (next: PcsData) => void;
  /** The title is shown above (by the equipment field). */
  noTitle?: boolean;
  /** For an arrow: shown in place of the shape title and hints. */
  line?: { counted: boolean; hint: string };
}) {
  const pcs = pcsOf(props.el);
  const links = pcs.materials ?? [];
  const [pick, setPick] = useState("");
  const byId = new Map(props.materials.map((m) => [m.id, m]));
  const set = (next: { materialId: string; qty: number }[]) => props.onChange({ ...pcs, materials: next.length ? next : undefined });
  const available = props.materials.filter((m) => !links.some((l) => l.materialId === m.id));
  return (
    <div className="insp">
      {!props.line && !props.noTitle && <div className="insp-title">{pcs.symbol ? `Equipment · ${props.symbolName ?? "symbol"}` : props.grouped ? "Group" : "Shape"}</div>}
      <div className="field"><span>{props.line ? "Lines and parts on this arrow (count, for BOM “from PFD”)" : "Linked materials (count, for BOM “from PFD”)"}</span></div>
      {props.line && <p className="panel-hint">{props.line.hint}</p>}
      {!props.line && props.onMap && <p className="panel-hint">Links on the process map are not counted in the BOM: link materials on shapes in the unit operation's own drawing (or on a transfer arrow).</p>}
      {!props.line && links.length === 0 && !props.onMap && <p className="panel-hint">None. Link consumables counted in pieces here, e.g. filters or bags.</p>}
      <ul className="link-list">
        {links.map((l, i) => {
          const m = byId.get(l.materialId);
          return (
            <li key={l.materialId}>
              <span className="link-name">{m ? <><span className="mono">{m.code}</span> {m.name}</> : <em>deleted material</em>}</span>
              <input className="cell-input num-input" type="number" min={0} step={1} value={l.qty} aria-label="Count"
                onChange={(e) => set(links.map((x, j) => (j === i ? { ...x, qty: Math.max(0, Number(e.target.value) || 0) } : x)))} />
              <span className="mono unit">{m?.unit ?? ""}</span>
              <button className="btn ghost small danger" onClick={() => set(links.filter((_, j) => j !== i))} aria-label="Remove link">×</button>
            </li>
          );
        })}
      </ul>
      {props.materials.length === 0 ? <p className="panel-hint">Add materials in the Materials tab first.</p> : (
        <div className="panel-add">
          <select className="search" value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Material to link">
            <option value="">Choose a material…</option>
            {available.map((m) => <option key={m.id} value={m.id}>{m.code} · {m.name} ({m.unit})</option>)}
          </select>
          <button className="btn small primary" disabled={!pick} onClick={() => { set([...links, { materialId: pick, qty: 1 }]); setPick(""); }}>Link</button>
        </div>
      )}
    </div>
  );
}

/** All categories in palette order: the built-in ones, then the ones users made up. */
function categoriesOf(custom: CustomSymbol[]): string[] {
  const extra = [...new Set(custom.map((c) => c.category))].filter((c) => !(CATEGORIES as readonly string[]).includes(c) && c !== MY_SYMBOLS).sort((a, b) => a.localeCompare(b));
  return [...(custom.some((c) => c.category === MY_SYMBOLS) ? [MY_SYMBOLS] : []), ...CATEGORIES, ...extra];
}

function SymbolPalette(props: { scope: string; custom: CustomSymbol[]; actions: PanelActions }) {
  const { custom, actions } = props;
  const [query, setQuery] = useState("");
  const [manage, setManage] = useState(false);
  const previews = useMemo(() => new Map(custom.map((c) => [c.id, customPreviewUrl(c)])), [custom]);
  const q = query.trim().toLowerCase();
  const hit = (name: string, cat: string) => !q || name.toLowerCase().includes(q) || cat.toLowerCase().includes(q);
  const groups = categoriesOf(custom).map((cat) => ({
    cat,
    builtIn: SYMBOLS.filter((d) => d.category === cat && hit(d.name, cat)),
    mine: custom.filter((c) => c.category === cat && hit(c.name, cat)),
  })).filter((g) => g.builtIn.length || g.mine.length);
  return (
    <>
      <input className="search" placeholder="Search symbols, e.g. filter, bag, column" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search symbols" />
      {groups.length === 0 && <p className="panel-hint">No symbol matches “{query}”.</p>}
      {groups.map((g) => (
        <section key={g.cat} className="symbol-group" aria-label={g.cat}>
          <div className="symbol-cat">{g.cat}</div>
          <div className="symbol-grid">
            {g.builtIn.map((d) => (
              <button key={d.id} className="symbol" onClick={() => actions.insertSymbol(d.id)} title={`Insert ${d.name}`}>
                <span className="symbol-icon" dangerouslySetInnerHTML={{ __html: symbolPreviewSvg(d) }} />
                <span className="symbol-name">{d.name}</span>
              </button>
            ))}
            {g.mine.map((c) => (
              <button key={c.id} className="symbol mine" onClick={() => actions.insertCustomSymbol(c.id)} title={`Insert ${c.name} (added by you)`}>
                <span className="symbol-icon"><img src={previews.get(c.id)} alt="" /></span>
                <span className="symbol-name">{c.name}</span>
              </button>
            ))}
          </div>
        </section>
      ))}
      <div className="panel-actions">
        <button className="btn small primary" onClick={actions.uploadSymbols} title="SVG, PNG, JPEG or WebP pictures, Excalidraw library files (.excalidrawlib) or a symbol set (.json)">Upload symbols…</button>
        <button className="btn small" disabled={!custom.length} onClick={() => setManage(!manage)} aria-pressed={manage}>{manage ? "Done" : `My symbols ${custom.length}`}</button>
        <button className="btn small" disabled={!custom.length} onClick={actions.exportSymbols} title="Download your symbols as one file, to upload in another project">Export set</button>
        <button className="btn small" onClick={actions.insertFreeTable}>Insert table</button>
      </div>
      {manage && <ManageSymbols custom={custom} previews={previews} actions={actions} />}
      <p className="panel-hint">{props.scope === MAP
        ? "This is the process map: one box per unit operation, and an arrow from box to box for each transfer. Draw equipment in each unit operation's own drawing (tabs above)."
        : "Symbols land in the middle of the view, inside the unit operation frame. Draw arrows between them with the arrow tool (A). An arrow to a connector (orange box) is part of that transfer."}{" "}
        Your own symbols: upload pictures or a library file, or select shapes you drew and use “Save as symbol”. They are saved with the project.</p>
    </>
  );
}

function ManageSymbols(props: { custom: CustomSymbol[]; previews: Map<string, string>; actions: PanelActions }) {
  const cats = categoriesOf(props.custom);
  return (
    <div className="symbol-manage">
      <datalist id="symbol-categories">{cats.map((c) => <option key={c} value={c} />)}</datalist>
      <ul className="unit-list">
        {props.custom.map((c) => (
          <li key={c.id} className="symbol-row">
            <img src={props.previews.get(c.id)} alt="" />
            <CommitInput value={c.name} label="Symbol name" onCommit={(v) => v && props.actions.updateSymbol(c.id, { name: v })} />
            <CommitInput value={c.category} label="Symbol category" list="symbol-categories" onCommit={(v) => props.actions.updateSymbol(c.id, { category: v || MY_SYMBOLS })} />
            <button className="btn ghost small danger" onClick={() => props.actions.deleteSymbol(c.id)} aria-label={`Delete symbol ${c.name}`} title="Remove from the palette">×</button>
          </li>
        ))}
      </ul>
      <p className="panel-hint">Pick a built-in category to put a symbol next to the built-in ones. Removing a symbol keeps the copies already on the drawings.</p>
    </div>
  );
}

function CommitInput(props: { value: string; label: string; list?: string; onCommit: (v: string) => void }) {
  const [v, setV] = useState(props.value);
  const [prev, setPrev] = useState(props.value);
  if (prev !== props.value) { setPrev(props.value); setV(props.value); }
  return <input className="cell-input" value={v} list={props.list} aria-label={props.label} onChange={(e) => setV(e.target.value)}
    onBlur={() => { if (v.trim() !== props.value) props.onCommit(v.trim()); }} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />;
}

function SaveAsSymbol(props: { custom: CustomSymbol[]; actions: PanelActions; defaultName?: string }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(props.defaultName ?? "");
  const [cat, setCat] = useState(MY_SYMBOLS);
  if (!open) return <div className="panel-actions"><button className="btn small" onClick={() => setOpen(true)} title="Keep the selected shapes as a symbol in the palette">Save as symbol…</button></div>;
  const save = () => { props.actions.saveSelectionAsSymbol(name.trim() || "Symbol", cat.trim() || MY_SYMBOLS); setOpen(false); };
  return (
    <div className="save-symbol">
      <datalist id="symbol-categories-save">{categoriesOf(props.custom).map((c) => <option key={c} value={c} />)}</datalist>
      <input className="search" autoFocus placeholder="Symbol name, e.g. Capsule filter 10 inch" value={name} onChange={(e) => setName(e.target.value)} aria-label="New symbol name"
        onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") setOpen(false); }} />
      <input className="search" placeholder="Category" list="symbol-categories-save" value={cat} onChange={(e) => setCat(e.target.value)} aria-label="New symbol category" />
      <div className="panel-actions">
        <button className="btn small primary" onClick={save}>Save symbol</button>
        <button className="btn small" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </div>
  );
}
