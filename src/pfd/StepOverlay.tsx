import { useEffect, useMemo, useRef, useState } from "react";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { Equipment, OpStep } from "../model/types";
import { TYPE_INFO, actionText, carries, isActive, timeline } from "../ops/model";
import { pcsOf, type BoardElement } from "./sync";

type Api = ExcalidrawImperativeAPI;
interface View { scrollX: number; scrollY: number; zoom: number; offsetLeft: number; offsetTop: number }
const viewOf = (api: Api): View => { const s = api.getAppState(); return { scrollX: s.scrollX, scrollY: s.scrollY, zoom: s.zoom.value, offsetLeft: s.offsetLeft, offsetTop: s.offsetTop }; };

/** Bounds of a shape with the parts drawn with it (its group), without its label text; line points count. */
function shapeBounds(all: readonly BoardElement[], el: BoardElement) {
  const g = el.groupIds?.[0];
  const parts = g ? all.filter((e) => !e.isDeleted && e.groupIds?.[0] === g && e.type !== "text") : [el];
  const xs: number[] = [], ys: number[] = [];
  for (const e of parts.length ? parts : [el]) {
    if (e.points?.length) for (const [px, py] of e.points) { xs.push(e.x + px); ys.push(e.y + py); }
    else { xs.push(e.x, e.x + e.width); ys.push(e.y, e.y + e.height); }
  }
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/**
 * Step view on a unit operation's drawing: pick a step and the tagged shapes show their state in it (green =
 * open / running, grey = closed / stopped, ▶ = changed at the start of this step), and the step's streams are
 * drawn over in blue. Nothing in the drawing changes; it is a layer on top.
 */
export function StepOverlay(props: {
  api: Api; steps: OpStep[]; equipment: Equipment[]; uoCode: string; at: number;
  onAt: (i: number) => void; onClose: () => void; onOpenOperations: () => void;
}) {
  const { api, steps } = props;
  const host = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>(() => viewOf(api));
  const [els, setEls] = useState<readonly BoardElement[]>(() => api.getSceneElements() as unknown as BoardElement[]);
  const [cardOpen, setCardOpen] = useState(true);
  useEffect(() => {
    let frame = 0;
    const offScroll = api.onScrollChange(() => setView(viewOf(api)));
    const offChange = api.onChange((elements) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => { setEls(elements as unknown as BoardElement[]); setView(viewOf(api)); });
    });
    return () => { cancelAnimationFrame(frame); offScroll(); offChange(); };
  }, [api]);
  const step = steps[props.at];
  const eqById = useMemo(() => new Map(props.equipment.map((e) => [e.id, e])), [props.equipment]);
  const cells = useMemo(() => new Map(props.equipment.map((e) => [e.id, timeline(steps, e)[props.at]])), [props.equipment, steps, props.at]);

  const rect = host.current?.getBoundingClientRect();
  const dx = rect ? view.offsetLeft - rect.left : 0, dy = rect ? view.offsetTop - rect.top : 0;
  const sx = (x: number) => (x + view.scrollX) * view.zoom + dx;
  const sy = (y: number) => (y + view.scrollY) * view.zoom + dy;

  const shapes = els.filter((e) => !e.isDeleted && pcsOf(e).equipmentId && eqById.has(pcsOf(e).equipmentId!)).map((e) => {
    const eq = eqById.get(pcsOf(e).equipmentId!)!;
    const cell = cells.get(eq.id);
    return { e, eq, cell, b: shapeBounds(els, e) };
  });
  const streamIds = new Set(step?.streams ?? []);
  const arrows = els.filter((e) => !e.isDeleted && e.type === "arrow" && pcsOf(e).streamId && streamIds.has(pcsOf(e).streamId!) && e.points?.length);
  const drawnTags = new Set(shapes.map((s) => s.eq.id));
  const notDrawn = (step?.actions ?? []).filter((a) => !drawnTags.has(a.equipmentId));

  return (
    <div className="step-layer" ref={host}>
      <svg className="step-svg" aria-hidden>
        {arrows.map((a) => (
          <polyline key={a.id} points={a.points!.map(([px, py]) => `${sx(a.x + px)},${sy(a.y + py)}`).join(" ")} className="step-flow" />
        ))}
        {shapes.map(({ e, eq, cell, b }) => {
          const on = !!cell && isActive(eq.type, cell.state);
          const event = !!cell?.action && !carries(eq.type);
          const cls = `step-box${on ? " on" : event ? " event" : cell?.state ? " off" : " idle"}${cell?.action ? " acted" : ""}`;
          return <rect key={e.id} className={cls} x={sx(b.x) - 6} y={sy(b.y) - 6} width={b.w * view.zoom + 12} height={b.h * view.zoom + 12} rx={6} />;
        })}
      </svg>
      {shapes.filter(({ cell }) => cell?.state).map(({ e, eq, cell, b }) => (
        <span key={e.id} className={`step-badge${isActive(eq.type, cell!.state) ? " on" : !carries(eq.type) ? " event" : " off"}${cell!.action ? " acted" : ""}`}
          style={{ left: sx(b.x) - 6, top: sy(b.y) - 26 }} title={cell!.action ? `${actionText(eq, cell!.state)} at the start of this step` : `${cell!.state}, from the step before`}>
          {cell!.action ? "▶ " : ""}{eq.tag} {carries(eq.type) ? cell!.state : cell!.state.length > 28 ? `${cell!.state.slice(0, 27)}…` : cell!.state}
        </span>
      ))}
      <div className="step-bar" role="toolbar" aria-label="Step view">
        <button className="btn small" aria-label="Previous step" disabled={props.at <= 0} onClick={() => props.onAt(props.at - 1)}>◀</button>
        <select className="search" value={props.at} aria-label="Step" onChange={(e) => props.onAt(Number(e.target.value))}>
          {steps.map((s, i) => <option key={s.id} value={i}>{i + 1} · {s.name}{s.minutes ? ` (${s.minutes} min)` : ""}</option>)}
        </select>
        <button className="btn small" aria-label="Next step" disabled={props.at >= steps.length - 1} onClick={() => props.onAt(props.at + 1)}>▶</button>
        <button className="btn small ghost" onClick={props.onOpenOperations} title={`Steps of ${props.uoCode} on Operations`}>Operations</button>
        <button className="btn small ghost" aria-label="Close step view" onClick={props.onClose}>✕</button>
      </div>
      {step && (
        <div className="step-card" aria-label="Actions in this step">
          <div className="step-card-title">
            <span><span className="mono">{props.uoCode} {props.at + 1}</span> {step.name}</span>
            <button className="btn ghost small" aria-expanded={cardOpen} aria-label={cardOpen ? "Hide the actions" : "Show the actions"} onClick={() => setCardOpen(!cardOpen)}>{cardOpen ? "▾" : "▸"}</button>
          </div>
          {!cardOpen ? null : step.actions.length ? (
            <ol className="step-actions">
              {step.actions.map((a) => {
                const eq = eqById.get(a.equipmentId);
                return <li key={a.equipmentId} className={eq && isActive(eq.type, a.state) ? "on" : ""}>{actionText(eq, a.state)}{a.note ? <span className="faint"> · {a.note}</span> : null}</li>;
              })}
            </ol>
          ) : <p className="panel-hint">No actions at the start of this step.</p>}
          {cardOpen && notDrawn.length > 0 && <p className="panel-hint">Not drawn here: {notDrawn.map((a) => eqById.get(a.equipmentId)?.tag ?? "?").join(", ")}</p>}
          {cardOpen && step.streams?.length ? <p className="panel-hint">Streams (blue): {step.streams.join(", ")}</p> : null}
          {cardOpen && <p className="panel-hint step-legend"><span className="step-key on" /> open / running <span className="step-key off" /> closed / stopped <span className="step-key event" /> done in this step · ▶ changed now · {TYPE_INFO.valve.label}s and pumps keep their state</p>}
        </div>
      )}
    </div>
  );
}
