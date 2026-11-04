import { useEffect, useRef, useState } from "react";
import { asGridCraftMessage, gridcraftUrl } from "../mb/gridcraft";

export interface CheckSummary { errors: number; warnings: number; applied: boolean }

/**
 * The MB workbook open in GridCraft, over the whole app. Saving in GridCraft (Ctrl+S or the save
 * button in its top bar) hands the workbook to the app, which stores it in the project and checks
 * its PCS_LINK sheet. Export as PDF is downloaded.
 */
export function GridCraftEditor(props: {
  name: string;
  bytes: Uint8Array;
  author?: string;
  /** Result of the check of the workbook last saved, shown in the bar. */
  check?: CheckSummary | null;
  onSaved: (name: string, bytes: Uint8Array) => void;
  onOtherFile: (name: string, bytes: Uint8Array) => void;
  onClose: () => void;
  confirm: (o: { title: string; body: string; confirmLabel: string; danger?: boolean }) => Promise<boolean>;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "failed" | "slow">("loading");
  const [error, setError] = useState("");
  const [dirty, setDirty] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  // The file GridCraft gets when it (re)starts: the latest one it saved, else the one it was opened with.
  const file = useRef({ name: props.name, bytes: props.bytes });
  const propsRef = useRef(props);
  propsRef.current = props;
  const src = useRef(gridcraftUrl(props.author)).current;

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const win = frame.current?.contentWindow;
      if (!win || e.source !== win || e.origin !== window.location.origin) return;
      const m = asGridCraftMessage(e.data);
      if (!m) return;
      if (m.type === "gridcraft:ready") {
        const copy = file.current.bytes.slice();
        win.postMessage({ type: "gridcraft:open", name: file.current.name, bytes: copy.buffer }, window.location.origin, [copy.buffer]);
        setState("ready");
      } else if (m.type === "gridcraft:save") {
        const bytes = new Uint8Array(m.bytes);
        if (/\.xlsx$/i.test(m.name)) {
          file.current = { name: m.name, bytes };
          setSavedAt(new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
          propsRef.current.onSaved(m.name, bytes);
        } else {
          propsRef.current.onOtherFile(m.name, bytes);
        }
      } else if (m.type === "gridcraft:dirty") {
        setDirty(m.dirty);
      } else if (m.type === "gridcraft:failed") {
        setError(m.error ?? "");
        setState("failed");
      }
    };
    window.addEventListener("message", onMessage);
    const slow = setTimeout(() => setState((s) => (s === "loading" ? "slow" : s)), 30_000);
    return () => { window.removeEventListener("message", onMessage); clearTimeout(slow); };
  }, []);

  // Leaving the page with unsaved changes in the sheet asks first (GridCraft leaves this to the host).
  useEffect(() => {
    if (!dirty) return;
    const onLeave = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, [dirty]);

  const close = async () => {
    if (dirty && !(await props.confirm({
      title: "Close GridCraft without saving?",
      body: "The workbook has changes that are not saved to the project. Press Ctrl+S in the sheet to save them first.",
      confirmLabel: "Close without saving",
      danger: true,
    }))) return;
    props.onClose();
  };

  const c = props.check;
  return (
    <div className="gc-overlay" role="dialog" aria-modal="true" aria-label="GridCraft">
      <div className="gc-bar">
        <span className="gc-title">GridCraft</span>
        <span className="mono gc-file">{file.current.name}</span>
        {dirty ? <span className="chip warn">Unsaved changes</span> : savedAt ? <span className="chip ok">Saved to project {savedAt}</span> : null}
        {savedAt && c && (
          c.errors ? <span className="chip err">{c.errors} error{c.errors > 1 ? "s" : ""} in PCS_LINK</span>
            : <span className="chip ok">PCS_LINK OK{c.warnings ? ` · ${c.warnings} warning${c.warnings > 1 ? "s" : ""}` : ""}</span>
        )}
        <span className="spacer" />
        <span className="gc-hint">Ctrl+S in the sheet saves it to the project</span>
        <button className="btn primary" onClick={close}>{savedAt && !dirty ? "Done" : "Close"}</button>
      </div>
      {state === "failed" && <div className="notice err gc-notice">GridCraft could not start{error ? `: ${error}` : ""}. Close it and use Download, then edit in Excel and upload the file.</div>}
      {state === "slow" && <div className="notice warn gc-notice">GridCraft is taking long to start. It needs a browser with WebGPU or WebGL2. You can keep waiting, or close it and use Download + Excel.</div>}
      <iframe
        ref={frame}
        className="gc-frame"
        title="GridCraft spreadsheet"
        src={src}
        allow="clipboard-read; clipboard-write; fullscreen"
        allowFullScreen
      />
    </div>
  );
}
