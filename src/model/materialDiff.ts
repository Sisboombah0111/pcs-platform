/**
 * What changed on a material, field by field, before → after (N5.6): the change log, the BOM comparison and
 * its "Changes (materials)" sheet use the same words. Pure: no React.
 */
import { STATUS_LABEL } from "./materials";
import type { Material, MaterialSnap } from "./types";

/** The details compared; the replacing material by its code. */
export type MaterialDetails = Omit<MaterialSnap, "mid"> & Pick<Material, "note" | "overagePct">;
export type DetailKey = keyof MaterialDetails;

interface Field { key: DetailKey; label: string; log: string; quote?: boolean }
const FIELDS: Field[] = [
  { key: "code", label: "Code", log: "code" },
  { key: "name", label: "Name", log: "name", quote: true },
  { key: "unit", label: "Unit", log: "unit" },
  { key: "category", label: "Category", log: "category" },
  { key: "spec", label: "Spec", log: "spec", quote: true },
  { key: "supplier", label: "Supplier", log: "supplier", quote: true },
  { key: "partNo", label: "Part no.", log: "part no." },
  { key: "packSize", label: "Pack size", log: "pack size" },
  { key: "overagePct", label: "Overage %", log: "overage %" },
  { key: "note", label: "Note", log: "note", quote: true },
  { key: "status", label: "Status", log: "status" },
  { key: "replacedBy", label: "Replaced by", log: "replaced by" },
];

/** Every detail a material has (the change log). */
export const ALL_DETAILS: DetailKey[] = FIELDS.map((f) => f.key);
/** What a BOM revision keeps (N5.6). */
export const SNAP_DETAILS: DetailKey[] = ["code", "name", "unit", "category", "spec", "supplier", "partNo", "packSize", "status", "replacedBy"];
/** What every revision has, older ones too. */
export const BASIC_DETAILS: DetailKey[] = ["code", "name", "unit", "category"];
/** What purchasing reads on the totals. */
export const PURCHASE_DETAILS: DetailKey[] = ["spec", "supplier", "partNo", "packSize"];

/** The details of a material, with the code of the one that replaced it (looked up in `all`). */
export function detailsOf(m: Material, all?: readonly Material[]): MaterialDetails {
  const d: MaterialDetails = { code: m.code, name: m.name, unit: m.unit };
  for (const k of ["category", "spec", "supplier", "partNo", "note"] as const) if (m[k]) d[k] = m[k];
  if (m.packSize != null) d.packSize = m.packSize;
  if (m.overagePct) d.overagePct = m.overagePct;
  if (m.status) d.status = m.status;
  const by = m.replacedBy ? all?.find((x) => x.id === m.replacedBy)?.code : undefined;
  if (by) d.replacedBy = by;
  return d;
}

/** A detail as text ("" when not set; the status by its label, In use when not set). */
export function detailText(d: Partial<MaterialDetails>, key: DetailKey): string {
  const v = d[key];
  if (key === "status") return STATUS_LABEL[(d.status ?? "active")];
  if (key === "overagePct") return String(v ?? 0);
  return v == null ? "" : String(v);
}

export interface DetailChange { key: DetailKey; label: string; before: string; after: string }

/** The details that differ, in the order of the Materials screen. */
export function detailChanges(a: Partial<MaterialDetails>, b: Partial<MaterialDetails>, keys: readonly DetailKey[] = ALL_DETAILS): DetailChange[] {
  const out: DetailChange[] = [];
  for (const f of FIELDS) {
    if (!keys.includes(f.key)) continue;
    const before = detailText(a, f.key), after = detailText(b, f.key);
    if (before !== after) out.push({ key: f.key, label: f.label, before, after });
  }
  return out;
}

const cut = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

/** `name “A” → “B”`, `part no. NS-100 → NS-100-CF`, `supplier – → “X”`, `replaced by CON-0011`. */
export function changeText(c: DetailChange, max = 60): string {
  const f = FIELDS.find((x) => x.key === c.key)!;
  const show = (v: string) => (v === "" ? "–" : f.quote ? `“${cut(v, max)}”` : cut(v, max));
  if (c.key === "replacedBy") return c.before === "" ? `replaced by ${c.after}` : c.after === "" ? `no longer replaced by ${c.before}` : `replaced by ${c.before} → ${c.after}`;
  return `${f.log} ${show(c.before)} → ${show(c.after)}`;
}
