import { useState } from "react";
import { exportToBlob } from "@excalidraw/excalidraw";
import type { BinaryFiles } from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement, NonDeleted } from "@excalidraw/excalidraw/element/types";
import type { Project } from "../model/types";
import { buildPfdDeck } from "../pfd/pptx";
import { downloadBlob } from "../storage/files";
import { Dialog } from "../ui/Dialog";

const blobToDataUrl = (b: Blob) => new Promise<string>((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result));
  r.onerror = () => reject(r.error);
  r.readAsDataURL(b);
});

/**
 * Export the PFD to PowerPoint: the process map and each unit operation's drawing on their own slides,
 * as editable shapes or as pictures, with a stream table after each drawing if wanted.
 */
export function PptxExportDialog(props: {
  project: Project;
  /** Elements and files of a drawing ("map" or a UO id), the one on screen as it is now. */
  sheet: (scope: string) => { elements: readonly unknown[]; files: Record<string, unknown> };
  onClose: () => void;
  toast: (msg: string) => void;
}) {
  const { project } = props;
  const all = ["map", ...project.uos.filter((u) => project.pfd.sheets[u.id]).map((u) => u.id)];
  const [chosen, setChosen] = useState<Set<string>>(new Set(all));
  const [mode, setMode] = useState<"shapes" | "pictures">("shapes");
  const [tables, setTables] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const label = (k: string) => (k === "map" ? "Process map" : (() => { const u = project.uos.find((x) => x.id === k)!; return `${u.code} · ${u.name}`; })());
  const slides = all.filter((k) => chosen.has(k));
  const count = slides.length * (tables ? 2 : 1);

  const run = async () => {
    setBusy("Preparing…");
    try {
      const out = await buildPfdDeck(project, {
        slides, mode, streamTables: tables, sheet: props.sheet,
        picture: async (scope) => {
          const { elements, files } = props.sheet(scope);
          const live = (elements as ExcalidrawElement[]).filter((e) => !e.isDeleted) as NonDeleted<ExcalidrawElement>[];
          let size = { width: 0, height: 0 };
          const blob = await exportToBlob({
            elements: live, files: files as BinaryFiles, mimeType: "image/png", exportPadding: 24,
            // Frames: outline only, no clipping (labels of arrows to connectors reach past the frame) and no
            // name (the slide title says it).
            appState: { exportBackground: true, viewBackgroundColor: "#ffffff", exportWithDarkMode: false, frameRendering: { enabled: true, clip: false, name: false, outline: true } },
            // Sharp on a full-screen slide: about 2400 px across, never more than 4× the drawing.
            getDimensions: (w: number, h: number) => { const scale = Math.min(4, Math.max(1, 2400 / Math.max(w, h))); size = { width: w * scale, height: h * scale }; return { ...size, scale }; },
          });
          return { dataURL: await blobToDataUrl(blob), ...size };
        },
        onProgress: (done, total) => setBusy(`Slide ${done} of ${total}…`),
      });
      downloadBlob(out as Blob, `${project.meta.name} PFD.pptx`);
      props.toast(`Exported ${count} slide(s) to PowerPoint`);
      props.onClose();
    } catch (e) {
      props.toast(`Could not export: ${(e as Error).message}`);
      setBusy(null);
    }
  };

  const toggle = (k: string) => setChosen((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  return (
    <Dialog
      title="Export the PFD to PowerPoint"
      wide
      onClose={props.onClose}
      actions={<>
        <button className="btn" onClick={props.onClose} disabled={!!busy}>Cancel</button>
        <button className="btn primary" onClick={run} disabled={!slides.length || !!busy}>{busy ?? `Export ${count} slide${count === 1 ? "" : "s"}`}</button>
      </>}
    >
      <div className="export-grid">
        <fieldset className="export-box">
          <legend>Slides</legend>
          <div className="toolbar" style={{ marginBottom: 6 }}>
            <button className="btn small ghost" onClick={() => setChosen(new Set(all))}>All</button>
            <button className="btn small ghost" onClick={() => setChosen(new Set())}>None</button>
          </div>
          <ul className="export-list">
            {all.map((k) => (
              <li key={k}><label className="check"><input type="checkbox" checked={chosen.has(k)} onChange={() => toggle(k)} /> <span>{label(k)}</span></label></li>
            ))}
          </ul>
        </fieldset>
        <fieldset className="export-box">
          <legend>Drawings as</legend>
          <label className="check export-choice">
            <input type="radio" name="pptx-mode" checked={mode === "shapes"} onChange={() => setMode("shapes")} />
            <span><b>Editable shapes</b> (recommended)<br /><span className="hint">Every box, line, arrow and text becomes a PowerPoint shape you can move, recolor and retype. A symbol is several shapes: select them and Group to move it as one.</span></span>
          </label>
          <label className="check export-choice">
            <input type="radio" name="pptx-mode" checked={mode === "pictures"} onChange={() => setMode("pictures")} />
            <span><b>Pictures</b><br /><span className="hint">Each drawing exactly as on screen, as one image per slide. Not editable in PowerPoint.</span></span>
          </label>
          <label className="check" style={{ marginTop: 10 }}>
            <input type="checkbox" checked={tables} onChange={(e) => setTables(e.target.checked)} />
            <span>A stream table after each drawing{project.mb.current ? " (with the applied MB values)" : " (no MB applied: IDs, names and routes only)"}</span>
          </label>
        </fieldset>
      </div>
      <p className="hint" style={{ marginBottom: 0 }}>16:9 slides with the drawing's title and a footer (project, date, applied workbook). Opens in PowerPoint, Keynote, Google Slides and LibreOffice.</p>
    </Dialog>
  );
}
