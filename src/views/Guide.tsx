import { useMemo, useState } from "react";
import { computeBom } from "../bom/model";
import { RULES, SCREENS, STATE_LABEL, STEPS, UI, t, type GoTarget, type Lang, type Screen } from "../guide/content";
import { guideStatus, nextStep, type StepId } from "../guide/status";
import type { LinkFinding } from "../link/check";
import type { Project } from "../model/types";

/** Per-viewer conveniences, remembered in this browser only; storage may be unavailable. */
const KEY = "pcs.guide.";
function load(k: string): string | null { try { return localStorage.getItem(KEY + k); } catch { return null; } }
function save(k: string, v: string) { try { localStorage.setItem(KEY + k, v); } catch { /* not remembered */ } }
const defaultLang = (): Lang => {
  const stored = load("lang");
  if (stored === "en" || stored === "ko") return stored;
  try { return navigator.language?.toLowerCase().startsWith("ko") ? "ko" : "en"; } catch { return "en"; }
};

/** Open on the first visit in this browser (nothing stored yet); after that as the user left it. */
export function guideOpenAtStart(): boolean {
  const v = load("open");
  return v === null ? true : v === "1";
}
export const rememberGuideOpen = (open: boolean) => save("open", open ? "1" : "0");

type View = "steps" | "screen" | "rules";

/**
 * The guide, docked at the right of the work area (the app stays usable next to it): the seven linking
 * steps with what the project has now and a button to the right place, help for the screen on view,
 * and the rules on one page. English or Korean.
 */
export function GuidePanel(props: {
  project: Project;
  findings: LinkFinding[];
  screen: Screen;
  onGo: (to: GoTarget) => void;
  onClose: () => void;
}) {
  const [lang, setLangState] = useState<Lang>(defaultLang);
  const [view, setViewState] = useState<View>(() => { const v = load("view"); return v === "screen" || v === "rules" ? v : "steps"; });
  const setLang = (l: Lang) => { setLangState(l); save("lang", l); };
  const setView = (v: View) => { setViewState(v); save("view", v); };
  const { project } = props;
  const bom = useMemo(() => computeBom(project), [project]);
  const status = useMemo(() => guideStatus(project, props.findings, bom), [project, props.findings, bom]);
  const next = nextStep(status);
  const [open, setOpen] = useState<StepId | null>(next);
  const done = status.filter((s) => s.state === "done").length;
  const L = (x: { en: string; ko: string }) => t(x, lang);

  return (
    <aside className="guide" aria-label="Guide" lang={lang}>
      <div className="guide-head">
        <strong className="guide-title">{L(UI.title)}</strong>
        <div className="seg" role="group" aria-label="Language">
          <button className={lang === "en" ? "on" : ""} aria-pressed={lang === "en"} onClick={() => setLang("en")}>EN</button>
          <button className={lang === "ko" ? "on" : ""} aria-pressed={lang === "ko"} onClick={() => setLang("ko")}>한국어</button>
        </div>
        <span className="spacer" />
        <button className="btn ghost small" onClick={props.onClose} aria-label={L(UI.close)} title={L(UI.close)}>✕</button>
      </div>
      <div className="guide-tabs" role="tablist" aria-label="Guide sections">
        {(["steps", "screen", "rules"] as View[]).map((v) => (
          <button key={v} role="tab" aria-selected={view === v} className="guide-tab" onClick={() => setView(v)}>
            {L(v === "steps" ? UI.steps : v === "screen" ? UI.screen : UI.rules)}
          </button>
        ))}
      </div>
      <div className="guide-body">
        {view === "steps" && (
          <>
            <p className="guide-intro">{L(UI.intro)}</p>
            <div className="guide-progress" aria-label={L(UI.progress).replace("{n}", String(done))}>
              <div className="guide-progress-bar"><span style={{ width: `${(done / 7) * 100}%` }} /></div>
              <span>{L(UI.progress).replace("{n}", String(done))}</span>
            </div>
            {next === null && <div className="notice ok">{L(UI.allDone)}</div>}
            <ol className="guide-steps">
              {status.map((s, i) => {
                const text = STEPS[s.id];
                const expanded = open === s.id;
                return (
                  <li key={s.id} className={`guide-step ${s.state}${s.id === next ? " next" : ""}${expanded ? " open" : ""}`} data-step={s.id}>
                    <button className="guide-step-head" onClick={() => setOpen(expanded ? null : s.id)} aria-expanded={expanded}>
                      <span className="guide-num" aria-hidden>{s.state === "done" ? "✓" : i + 1}</span>
                      <span className="guide-step-title">{L(text.title)}</span>
                      {s.id === next && <span className="chip guide-next">{L(UI.next)}</span>}
                      <span className={`chip guide-state ${s.state}`}>{L(STATE_LABEL[s.state])}</span>
                    </button>
                    <div className="guide-found">{L(s.found)}</div>
                    {expanded && (
                      <div className="guide-detail">
                        <p>{L(text.why)}</p>
                        <ol className="guide-how">{text.how.map((h, j) => <li key={j}>{L(h)}</li>)}</ol>
                        <button className="btn small primary" onClick={() => props.onGo(text.go.to)}>{L(text.go.label)}</button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
          </>
        )}
        {view === "screen" && (
          <div className="guide-screen">
            <h3>{L(SCREENS[props.screen].title)}</h3>
            <ul>{SCREENS[props.screen].items.map((x, i) => <li key={i}>{L(x)}</li>)}</ul>
          </div>
        )}
        {view === "rules" && (
          <div className="guide-rules">
            {RULES.map((r, i) => (
              <section key={i}>
                <h3>{L(r.title)}</h3>
                <table className="grid guide-rule-table">
                  <tbody>{r.rows.map(([k, v], j) => <tr key={j}><th scope="row">{L(k)}</th><td>{L(v)}</td></tr>)}</tbody>
                </table>
              </section>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}
