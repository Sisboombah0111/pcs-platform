/**
 * UO codes and Stream IDs.
 *
 *   UO code      100L, FLASK, CHROM1      A–Z/0–9, at least one letter, ≤ 10 chars
 *   Stream ID    ST-<UO>-<nnn>            an arrow inside one UO (nnn = 001…999)
 *                ST-<fromUO>-<toUO>       a transfer between two UOs
 *                ST-<fromUO>-<toUO>-<n>   the 2nd, 3rd … parallel transfer between the same two UOs
 *
 * A UO code always has a letter, so ST-10L-100L (transfer) and ST-10L-100 (arrow 100 in 10L)
 * cannot be confused. Stream IDs are unique within one project.
 */

export const UO_CODE_RE = /^(?=[A-Z0-9]*[A-Z])[A-Z0-9]{1,10}$/;
const STREAM_RE = /^ST-([A-Z0-9]+)-([A-Z0-9]+)(?:-([1-9]\d*))?$/;
export const MAX_SEQ = 999;

export function isUoCode(s: unknown): s is string {
  return typeof s === "string" && UO_CODE_RE.test(s);
}

export type ParsedStreamId =
  | { kind: "pfd"; uo: string; seq: number }
  | { kind: "transfer"; from: string; to: string; n: number };

export function parseStreamId(id: unknown): ParsedStreamId | null {
  const m = STREAM_RE.exec(String(id ?? ""));
  if (!m) return null;
  const [, a, b, n] = m;
  if (!isUoCode(a)) return null;
  if (n === undefined && /^\d{3}$/.test(b)) return { kind: "pfd", uo: a, seq: Number(b) };
  if (!isUoCode(b)) return null;
  return { kind: "transfer", from: a, to: b, n: n === undefined ? 1 : Number(n) };
}

export function pfdStreamId(uo: string, seq: number): string {
  if (!isUoCode(uo)) throw new Error(`Not a UO code: ${uo}`);
  if (!Number.isInteger(seq) || seq < 1 || seq > MAX_SEQ) throw new Error(`Stream number out of range for ${uo}: ${seq}`);
  return `ST-${uo}-${String(seq).padStart(3, "0")}`;
}

export function transferStreamId(from: string, to: string, n = 1): string {
  if (!isUoCode(from) || !isUoCode(to)) throw new Error(`Not a UO code: ${from}, ${to}`);
  return n > 1 ? `ST-${from}-${to}-${n}` : `ST-${from}-${to}`;
}

/** The UO whose BOM a stream's materials count toward: its own UO, or a transfer's destination. */
export function bomUoCodeOf(streamId: string): string | null {
  const p = parseStreamId(streamId);
  if (!p) return null;
  return p.kind === "pfd" ? p.uo : p.to;
}

/**
 * Suggest a UO code from a name: "100L Bioreactor" → 100L, "125 mL Shake Flask" → 125ML,
 * "1st Chromatography" → CHROM1, "Depth Filtration" → DEPTH, a name without Latin letters → UO<n>.
 * A clash with `taken` gets a numeric suffix.
 */
export function suggestUoCode(name: string, taken: Set<string>, fallbackIndex = 1): string {
  const text = String(name || "");
  let base = "";
  const vol = /(\d+(?:\.\d+)?)\s*(mL|L|kL)\b/i.exec(text);
  if (vol) {
    base = (vol[1].replace(".", "P") + vol[2]).toUpperCase();
  } else {
    const ord = /\b(\d+)(?:st|nd|rd|th)\b/i.exec(text);
    const word = text.replace(/\b\d+(?:st|nd|rd|th)\b/gi, " ").split(/[^A-Za-z]+/).find((w) => w.length >= 2) ?? "";
    if (word) base = word.slice(0, 5).toUpperCase() + (ord ? ord[1] : "");
  }
  if (!base) base = "UO" + fallbackIndex;
  base = base.slice(0, 10);
  if (!isUoCode(base)) base = ("UO" + base).replace(/[^A-Z0-9]/g, "").slice(0, 10);
  let code = base;
  for (let i = 2; taken.has(code); i++) {
    const suffix = String(i);
    code = base.slice(0, 10 - suffix.length) + suffix;
  }
  return code;
}

let counter = 0;
/** Short unique id for project records (materials, UOs, snapshots). */
export function newId(prefix: string): string {
  counter = (counter + 1) % 1296;
  const rand = Math.floor(Math.random() * 36 ** 4).toString(36).padStart(4, "0");
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36).padStart(2, "0")}${rand}`;
}
