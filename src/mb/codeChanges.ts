/**
 * Material codes changed (renamed, or one material replaced by another): bring the mass balance along.
 * The MB workbook's PCS_LINK MatCode cells are rewritten (rewrite.ts, nothing else in the file changes),
 * the applied values follow, and History says what the app did. When the applied values came from that
 * workbook, they stay "applied": only the codes changed, not the values.
 */
import { newId } from "../model/ids";
import type { MbHistoryEntry, Project } from "../model/types";
import { base64ToBytes, bytesToBase64, contentHash } from "../storage/files";
import { MAX_HISTORY } from "./model";
import { rewriteMatCodes, type RewriteResult } from "./rewrite";

export const APP_NAME = "PCS Platform";

export interface CodeChangeOutcome {
  project: Project;
  /** PCS_LINK rows changed in the workbook. */
  workbookRows: number;
  /** Applied MB rows that now carry the new code. */
  appliedRows: number;
  skipped: RewriteResult["skipped"];
}

/** Old code → new code, in the workbook and the applied values. */
export async function changeCodesInMb(p: Project, map: ReadonlyMap<string, string>, meta: { now?: string; by?: string; why: string }): Promise<CodeChangeOutcome> {
  const now = meta.now ?? new Date().toISOString();
  let next: Project = p;
  let workbookRows = 0;
  let skipped: RewriteResult["skipped"] = [];
  const wb = p.mb.workbook;
  let newSha: string | null = null;
  if (wb) {
    const r = await rewriteMatCodes(base64ToBytes(wb.dataBase64), map);
    workbookRows = r.changed.length;
    skipped = r.skipped;
    if (r.changed.length) {
      newSha = await contentHash(r.bytes);
      next = { ...next, mb: { ...next.mb, workbook: { ...wb, dataBase64: bytesToBase64(r.bytes), sha256: newSha, savedBy: APP_NAME, updatedAt: now } } };
    }
  }
  const cur = next.mb.current;
  let appliedRows = 0;
  if (cur) {
    const rows = cur.rows.map((r) => {
      const to = r.matCode ? map.get(r.matCode) : undefined;
      if (to === undefined) return r;
      appliedRows++;
      return { ...r, matCode: to };
    });
    const stillApplied = !!wb && !!newSha && cur.sha256 === wb.sha256;
    if (appliedRows || stillApplied) next = { ...next, mb: { ...next.mb, current: { ...cur, rows, ...(stillApplied ? { sha256: newSha! } : {}) } } };
  }
  if (workbookRows || appliedRows) {
    const entry: MbHistoryEntry = {
      id: newId("mb"), source: "app", importedAt: now, rowCount: next.mb.current?.rows.length ?? 0, savedBy: APP_NAME,
      note: `${meta.why}: ${[...map].map(([a, b]) => `${a} → ${b}`).join(", ")} (${workbookRows} PCS_LINK row(s) in the workbook, ${appliedRows} applied row(s))`,
      ...(next.mb.workbook ? { fileName: next.mb.workbook.name, sha256: next.mb.workbook.sha256 } : {}),
      ...(meta.by ? { importedBy: meta.by } : {}),
    };
    next = { ...next, mb: { ...next.mb, history: [entry, ...next.mb.history].slice(0, MAX_HISTORY) } };
  }
  return { project: next, workbookRows, appliedRows, skipped };
}

/** How many applied rows and (roughly) workbook rows use these codes, before changing anything. */
export function mbUsesOf(p: Pick<Project, "mb">, codes: Iterable<string>): number {
  const set = new Set(codes);
  return p.mb.current?.rows.filter((r) => r.matCode && set.has(r.matCode)).length ?? 0;
}
