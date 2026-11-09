import { useState } from "react";
import type { Area, LinkFinding } from "../link/check";
import { Dialog } from "../ui/Dialog";

const SCREEN: Record<Area, string> = { pfd: "PFD", operations: "Operations", mb: "Mass Balance", bom: "BOM", materials: "Materials" };
const SHOWN = 8;

/** The link status in the title bar: green when the PFD, the Mass Balance, the BOM and the material list line up. */
export function LinkChip(props: { findings: LinkFinding[]; onOpen: () => void }) {
  const warn = props.findings.filter((f) => f.level === "warn").length;
  const info = props.findings.length - warn;
  return (
    <button className={`link-chip ${warn ? "warn" : "ok"}`} onClick={props.onOpen}
      title={warn ? "Something does not line up between the PFD, the Mass Balance, the BOM and the material list" : "PFD, Mass Balance, BOM and materials line up"}>
      <span className={`dot ${warn ? "warn" : "ok"}`} />
      {warn ? `Link check: ${warn} to fix` : info ? `Linked · ${info} note${info > 1 ? "s" : ""}` : "Linked"}
    </button>
  );
}

/** Everything that does not line up, with where to fix it. */
export function LinkDialog(props: {
  findings: LinkFinding[];
  onClose: () => void;
  goTo: (area: Area) => void;
  showStream: (streamId: string) => void;
}) {
  const { findings } = props;
  const [all, setAll] = useState<Record<string, boolean>>({});
  return (
    <Dialog title="Link check" wide onClose={props.onClose} actions={<button className="btn primary" onClick={props.onClose}>Close</button>}>
      <p className="hint" style={{ marginTop: 0 }}>
        The PFD makes the Stream IDs and unit operations, the Mass Balance gives values per Stream ID, the material list gives codes and units, and the BOM adds them up.
        Applied MB values are checked against the current PFD and material list all the time; values that no longer match are left out of the BOM.
      </p>
      {findings.length === 0 && <div className="notice ok">Everything lines up: every applied MB value belongs to a stream on the PFD and a material in the list, in the same unit.</div>}
      <ul className="link-list-findings">
        {findings.map((f) => {
          const items = all[f.id] ? f.items : f.items.slice(0, SHOWN);
          return (
            <li key={f.id} className={`link-finding ${f.level}`}>
              <div className="link-finding-head">
                <span className={`chip ${f.level === "warn" ? "warn" : ""}`}>{f.level === "warn" ? "To fix" : "Note"}</span>
                <strong>{f.title}</strong>
                <span className="spacer" />
                <button className="btn small" onClick={() => props.goTo(f.area)}>Open {SCREEN[f.area]}</button>
              </div>
              <ul className="link-items">
                {items.map((it, i) => (
                  <li key={i}>
                    {it.streamId ? <button className="linkish mono" onClick={() => props.showStream(it.streamId!)} title="Show on the PFD">{it.text}</button> : <span className="mono">{it.text}</span>}
                  </li>
                ))}
                {f.items.length > SHOWN && !all[f.id] && <li><button className="linkish" onClick={() => setAll({ ...all, [f.id]: true })}>and {f.items.length - SHOWN} more</button></li>}
              </ul>
              <p className="hint">{f.fix}</p>
            </li>
          );
        })}
      </ul>
    </Dialog>
  );
}
