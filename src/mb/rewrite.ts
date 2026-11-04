/**
 * Change material codes in the PCS_LINK sheet of an MB workbook, and nothing else.
 *
 * Only the MatCode cells that hold one of the old codes are rewritten (as inline strings). Every other
 * part of the .xlsx stays as it was, byte for byte: the other sheets, formulas, styles, charts, the
 * shared strings. A MatCode cell with a formula is left alone and reported, since its result comes
 * from somewhere else in the workbook.
 */
import JSZip from "jszip";
import { LINK_SHEET } from "./pcsLink";

export interface RewriteResult {
  bytes: Uint8Array;
  changed: { row: number; from: string; to: string }[];
  /** Cells with an old code that could not be changed here (a formula), with the reason. */
  skipped: { row: number; code: string; why: string }[];
}

const decode = (s: string) => s
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const encode = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const attr = (tag: string, name: string) => new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1];
const norm = (s: string) => s.trim().toLowerCase().replace(/[\s_-]/g, "");
/** Text of all <t> elements (a shared string item or an inline string). */
const texts = (xml: string) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => decode(m[1])).join("");

function cellText(attrs: string, body: string, shared: string[]): string {
  const t = attr(attrs, "t");
  if (t === "inlineStr") return texts(body);
  const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
  if (v === undefined) return "";
  if (t === "s") return shared[Number(v)] ?? "";
  return decode(v);
}

/** Resolve a relationship target against the folder of the part that owns it. */
const resolvePath = (base: string, target: string) => {
  if (target.startsWith("/")) return target.slice(1);
  const parts = base.split("/").slice(0, -1);
  for (const seg of target.split("/")) { if (seg === "..") parts.pop(); else if (seg !== ".") parts.push(seg); }
  return parts.join("/");
};

export async function rewriteMatCodes(bytes: Uint8Array, map: ReadonlyMap<string, string>): Promise<RewriteResult> {
  const out: RewriteResult = { bytes, changed: [], skipped: [] };
  if (!map.size) return out;
  const zip = await JSZip.loadAsync(bytes);
  const workbook = await zip.file("xl/workbook.xml")?.async("string");
  if (!workbook) throw new Error("Not an .xlsx workbook (no xl/workbook.xml).");
  const sheetTag = [...workbook.matchAll(/<sheet\b[^>]*\/?>/g)].map((m) => m[0]).find((tag) => decode(attr(tag, "name") ?? "") === LINK_SHEET);
  if (!sheetTag) throw new Error(`The workbook has no '${LINK_SHEET}' sheet.`);
  const rid = attr(sheetTag, "r:id");
  const rels = (await zip.file("xl/_rels/workbook.xml.rels")?.async("string")) ?? "";
  const rel = [...rels.matchAll(/<Relationship\b[^>]*\/?>/g)].map((m) => m[0]).find((tag) => attr(tag, "Id") === rid);
  const target = rel ? attr(rel, "Target") : undefined;
  if (!target) throw new Error(`Cannot find the '${LINK_SHEET}' sheet in the workbook file.`);
  const path = resolvePath("xl/workbook.xml", target);
  const sheet = await zip.file(path)?.async("string");
  if (sheet === undefined) throw new Error(`Cannot read ${path}.`);
  const sharedXml = (await zip.file("xl/sharedStrings.xml")?.async("string")) ?? "";
  const shared = [...sharedXml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => texts(m[1]));

  // The MatCode column, from the headers in row 1.
  const cellRe = /<c\b([^>]*?)(\/>|>([\s\S]*?)<\/c>)/g;
  const row1 = /<row\b[^>]*\br="1"[^>]*>([\s\S]*?)<\/row>/.exec(sheet)?.[1] ?? "";
  let col: string | null = null;
  for (const m of row1.matchAll(cellRe)) {
    const ref = attr(m[1], "r") ?? "";
    if (norm(cellText(m[1], m[3] ?? "", shared)) === "matcode") { col = /^[A-Z]+/.exec(ref)?.[0] ?? null; break; }
  }
  if (!col) throw new Error(`The '${LINK_SHEET}' sheet has no MatCode header in row 1.`);

  const next = sheet.replace(cellRe, (whole, attrs: string, _end: string, body: string | undefined) => {
    const ref = attr(attrs, "r") ?? "";
    const m = /^([A-Z]+)(\d+)$/.exec(ref);
    if (!m || m[1] !== col || m[2] === "1" || body === undefined) return whole;
    const code = cellText(attrs, body, shared).trim();
    const to = map.get(code);
    if (to === undefined) return whole;
    if (/<f[\s>/]/.test(body)) { out.skipped.push({ row: Number(m[2]), code, why: "MatCode is a formula: change it in the workbook" }); return whole; }
    out.changed.push({ row: Number(m[2]), from: code, to });
    const style = attr(attrs, "s");
    return `<c r="${ref}"${style !== undefined ? ` s="${style}"` : ""} t="inlineStr"><is><t>${encode(to)}</t></is></c>`;
  });
  if (!out.changed.length) return out;
  zip.file(path, next);
  out.bytes = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 6 } });
  return out;
}
