import { newId } from "./ids";
import type { Material } from "./types";

/** Example material list (made-up codes) so a new user can try the screens. */
const SAMPLE: [code: string, name: string, unit: string, category: string, spec?: string][] = [
  ["MAT-0001", "Basal Medium (powder)", "kg", "Media", "Animal-free"],
  ["MAT-0002", "Feed Medium A (powder)", "kg", "Media", "Animal-free"],
  ["MAT-0003", "Feed Medium B (powder)", "kg", "Media", "Animal-free"],
  ["MAT-0004", "Glucose", "kg", "Media", "≥ 99.5 %"],
  ["MAT-0005", "L-Glutamine 200 mM", "L", "Media"],
  ["MAT-0006", "Antifoam C Emulsion", "L", "Media"],
  ["MAT-0007", "Sodium Bicarbonate 7.5 %", "L", "Media"],
  ["MAT-0008", "Sodium Chloride", "kg", "Buffer", "USP/EP"],
  ["MAT-0009", "Tris Base", "kg", "Buffer", "USP"],
  ["MAT-0010", "Sodium Hydroxide 1 N", "L", "Buffer"],
  ["MAT-0011", "Citrate Buffer 0.1 M pH 3.5", "L", "Buffer"],
  ["MAT-0012", "Water for Injection", "L", "Utility"],
  ["MAT-0013", "Protein A Resin", "L", "Resin"],
  ["MAT-0014", "Depth Filter Capsule", "EA", "Filter"],
  ["MAT-0015", "Sterile Filter 0.2 µm", "EA", "Filter"],
  ["MAT-0016", "Virus Filter", "EA", "Filter"],
  ["MAT-0017", "Single-use Bag 50 L", "EA", "Consumable"],
  ["MAT-0018", "Single-use Bag 500 L", "EA", "Consumable"],
  // Lines (hose / tubing assemblies) are linked on PFD arrows; the transfer panel on its symbol.
  ["MAT-0031", '1.5" Line 1 m', "EA", "Line", '1.5", 1 m'],
  ["MAT-0032", '1.5" Line 1.5 m', "EA", "Line", '1.5", 1.5 m'],
  ["MAT-0033", '1.5" Line 2 m', "EA", "Line", '1.5", 2 m'],
  ["MAT-0034", '1.5" Line 2.5 m', "EA", "Line", '1.5", 2.5 m'],
  ["MAT-0035", '2" Line 1 m', "EA", "Line", '2", 1 m'],
  ["MAT-0036", '2" Line 1.5 m', "EA", "Line", '2", 1.5 m'],
  ["MAT-0037", '2" Line 2 m', "EA", "Line", '2", 2 m'],
  ["MAT-0038", '2" Line 2.5 m', "EA", "Line", '2", 2.5 m'],
  ["MAT-0039", "Transfer Panel", "EA", "Equipment"],
  // Chemicals for the prepared solutions below, a prepared buffer, and two backup (alternate) materials.
  ["MAT-0040", "Sodium Bicarbonate (powder)", "kg", "Media", "USP"],
  ["MAT-0041", "Citric Acid Monohydrate", "kg", "Buffer", "USP/EP"],
  ["MAT-0042", "Trisodium Citrate Dihydrate", "kg", "Buffer", "USP/EP"],
  ["MAT-0043", "Equilibration Buffer (20 mM Tris, 150 mM NaCl)", "L", "Buffer", "pH 7.4"],
  ["MAT-0044", "Sodium Chloride (alternate supplier)", "kg", "Buffer", "USP/EP"],
  ["MAT-0045", "Sterile Filter 0.2 µm (alternate supplier)", "EA", "Filter"],
];

/**
 * Example recipes (made-up, rounded: check against your own SOP): quantities per 1000 L of the
 * prepared solution. WFI is counted as the full volume ("to volume").
 */
const SAMPLE_RECIPES: Record<string, { per: number; components: [code: string, qty: number][]; note: string }> = {
  "MAT-0007": { per: 1000, components: [["MAT-0040", 75], ["MAT-0012", 1000]], note: "Example: 75 g/L sodium bicarbonate, WFI to volume" },
  "MAT-0011": { per: 1000, components: [["MAT-0041", 15.8], ["MAT-0042", 7.3], ["MAT-0012", 1000]], note: "Example: 0.1 M citrate, adjust to pH 3.5, WFI to volume" },
  "MAT-0043": { per: 1000, components: [["MAT-0009", 2.423], ["MAT-0008", 8.766], ["MAT-0012", 1000]], note: "Example: 20 mM Tris, 150 mM NaCl, adjust to pH 7.4, WFI to volume" },
};

/** Example backups: primary code → backup codes (same quantity). */
const SAMPLE_BACKUPS: Record<string, string[]> = {
  "MAT-0008": ["MAT-0044"],
  "MAT-0015": ["MAT-0045"],
};

export const SAMPLE_COUNT = SAMPLE.length;
export const SAMPLE_CODES: ReadonlySet<string> = new Set(SAMPLE.map((r) => r[0]));

export function sampleMaterials(): Material[] {
  const list = SAMPLE.map(([code, name, unit, category, spec]) => {
    const m: Material = { id: newId("mat"), code, name, unit, category };
    if (spec) m.spec = spec;
    return m;
  });
  return withSampleRefs(list, new Set(list.map((m) => m.code)));
}

/**
 * Give the materials whose code is in `codes` the sample recipe and backups (components and backups
 * are found by code in `list`; the ones that are missing are skipped).
 */
function withSampleRefs(list: Material[], codes: ReadonlySet<string>): Material[] {
  const byCode = new Map(list.map((m) => [m.code, m]));
  return list.map((m) => {
    if (!codes.has(m.code)) return m;
    const next = { ...m };
    const r = SAMPLE_RECIPES[m.code];
    if (r) {
      const components = r.components.flatMap(([c, qty]) => (byCode.has(c) ? [{ materialId: byCode.get(c)!.id, qty }] : []));
      if (components.length) next.recipe = { per: r.per, components, note: r.note };
    }
    const b = (SAMPLE_BACKUPS[m.code] ?? []).flatMap((c) => (byCode.has(c) ? [{ materialId: byCode.get(c)!.id }] : []));
    if (b.length) next.backups = b;
    return next;
  });
}

/**
 * Add the samples a list that uses the sample codes does not have yet. Sample materials of the list
 * that have no recipe or backups yet (same code and name) get the sample ones.
 */
export function addMissingSamples(materials: readonly Material[]): { materials: Material[]; added: Material[]; completed: Material[] } {
  const have = new Set(materials.map((m) => m.code));
  // Fresh samples without their references (those point at the fresh list); set again below.
  const added = sampleMaterials().filter((m) => !have.has(m.code)).map((m) => {
    const x = { ...m };
    delete x.recipe;
    delete x.backups;
    return x;
  });
  const list = [...materials, ...added];
  const names = new Map(SAMPLE.map((r) => [r[0], r[1]]));
  const codes = new Set(list.filter((m) => names.get(m.code) === m.name && !m.recipe && !m.backups && (SAMPLE_RECIPES[m.code] || SAMPLE_BACKUPS[m.code])).map((m) => m.code));
  const out = withSampleRefs(list, codes);
  const completed = out.filter((m, i) => i < materials.length && m !== list[i]);
  return { materials: out, added: out.slice(materials.length), completed };
}

/** True when `addMissingSamples` would change something. */
export function hasMissingSamples(materials: readonly Material[]): boolean {
  if (!materials.some((m) => SAMPLE_CODES.has(m.code))) return false;
  const r = addMissingSamples(materials);
  return r.added.length > 0 || r.completed.length > 0;
}

export const COMMON_UNITS = ["kg", "g", "mg", "L", "mL", "EA", "m²", "m³", "mol", "set"];
