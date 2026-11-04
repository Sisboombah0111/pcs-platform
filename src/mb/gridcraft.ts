/**
 * GridCraft (MIT OR Apache-2.0) runs inside the app in an iframe, from the official web build
 * deployed unmodified next to the app (`./gridcraft/`). Its host mode (`?host=parent`) talks to
 * this page with postMessage, same origin only:
 *
 *   gridcraft:ready  {version}       → the app sends the workbook: gridcraft:open {name, bytes}
 *   gridcraft:save   {name, bytes}   ← Save (.xlsx) and Export as PDF
 *   gridcraft:dirty  {dirty}         ← unsaved changes appear or go away
 *   gridcraft:failed {error}         ← GridCraft could not start
 *
 * Source: storytold/gridcraft apps/gridcraft-web/src/host.rs, packaging/web/README.md (v0.13.0).
 */

export const GRIDCRAFT_INDEX = "gridcraft/index.html";

export type GridCraftMessage =
  | { type: "gridcraft:ready"; version?: string }
  | { type: "gridcraft:save"; name: string; bytes: ArrayBuffer }
  | { type: "gridcraft:dirty"; dirty: boolean }
  | { type: "gridcraft:failed"; error?: string };

/** The iframe address. The File tab is hidden so the sheet's own Open/Save As can't swap the file. */
export function gridcraftUrl(author?: string): string {
  const q = new URLSearchParams({ host: "parent", chrome: "nofiletab" });
  if (author?.trim()) q.set("author", author.trim());
  return `${GRIDCRAFT_INDEX}?${q}`;
}

let available: Promise<boolean> | null = null;

/** Whether the GridCraft web build is deployed next to the app (it is not in the one-file preview). */
export function gridcraftAvailable(): Promise<boolean> {
  if (import.meta.env.MODE === "singlefile") return Promise.resolve(false);
  available ??= fetch(new URL(GRIDCRAFT_INDEX, window.location.href), { cache: "no-cache" })
    .then(async (r) => {
      if (!r.ok) return false;
      const html = await r.text();
      // A dev server answers a missing file with the app's own page: that is not GridCraft.
      return /gridcraft/i.test(html) && !/<div id="root">/.test(html);
    })
    .catch(() => false);
  return available;
}

export function asGridCraftMessage(data: unknown): GridCraftMessage | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  switch (d.type) {
    case "gridcraft:ready": return { type: d.type, version: typeof d.version === "string" ? d.version : undefined };
    case "gridcraft:save":
      return typeof d.name === "string" && d.bytes instanceof ArrayBuffer ? { type: d.type, name: d.name, bytes: d.bytes } : null;
    case "gridcraft:dirty": return { type: d.type, dirty: !!d.dirty };
    case "gridcraft:failed": return { type: d.type, error: typeof d.error === "string" ? d.error : undefined };
    default: return null;
  }
}
