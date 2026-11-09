import { EXAMPLE_FILES, EXAMPLE_PROJECTS, exampleUrl, type Example } from "../examples";
import { BUILD_DATE, RELEASES_URL, SITE_URL, versionLabel, whereRunning } from "../version";

/**
 * What a new, empty project shows on the process map: open a project file or start drawing; the example (it comes
 * with the app) only when wanted, as a view that is not saved (N5.5); the example workbooks; and how to bring work
 * from the other copy of the app (the site and the PC version keep separate autosaves).
 */
export function StartCard(props: { onOpenExample: (ex: Example) => void; onOpenFile: () => void; onAddUnit: () => void; onHide: () => void }) {
  const where = whereRunning();
  const [main, ...others] = EXAMPLE_PROJECTS;
  return (
    <section className="start-card" aria-label="Start here">
      <div className="start-head">
        <h2>Start here</h2>
        <button className="btn ghost small" aria-label="Hide the start card" title="Hide (it comes back for the next empty project)" onClick={props.onHide}>×</button>
      </div>
      <div className="start-actions">
        <button className="btn primary" onClick={props.onOpenFile}>Open a project file…</button>
        <button className="btn" onClick={props.onAddUnit}>Add a unit operation</button>
        <button className="btn" onClick={() => props.onOpenExample(main)} title={`${main.title}: ${main.about}`}>Open the example (view only)</button>
      </div>
      <p className="start-about">The example ({main.title}) opens as a view: it is not saved, and <b>Close example</b> brings this project back.</p>
      <details className="start-more">
        <summary>More examples and example workbooks</summary>
        <ul className="plain start-list">
          {others.map((ex) => (
            <li key={ex.file}><button className="linkish" onClick={() => props.onOpenExample(ex)}>{ex.title}</button> <span className="muted">— {ex.about}</span></li>
          ))}
          {EXAMPLE_FILES.map((ex) => (
            <li key={ex.file}><a href={exampleUrl(ex.file)} download={ex.file}>{ex.file}</a> <span className="muted">— {ex.title}. {ex.about}</span></li>
          ))}
        </ul>
      </details>
      <p className="start-note">
        {where === "site"
          ? <>Worked in the PC version before? Its autosave stays on the PC: there, <b>Save to file</b>; here, <b>Open</b>.</>
          : where === "pc"
            ? <>Worked on the site before (<a href={SITE_URL} target="_blank" rel="noreferrer">sisboombah0111.github.io</a>)? Its autosave stays there: there, <b>Save to file</b>; here, <b>Open</b>.</>
            : <>Each copy of the app (the site, the PC version) keeps its own autosave: <b>Save to file</b> in one and <b>Open</b> in the other to move a project.</>}
      </p>
      <p className="start-version">
        PCS Platform {versionLabel()}{BUILD_DATE ? ` · ${BUILD_DATE}` : ""} · <a href={RELEASES_URL} target="_blank" rel="noreferrer">PC version (zip)</a>
        {" · "}The <b>Guide</b> (top right) walks through the linking steps.
      </p>
    </section>
  );
}
