/**
 * Bioprocess equipment symbols, drawn from plain shapes so they stay editable on the board.
 * Original drawings for this project (MIT). Coordinates are relative to the symbol's top-left;
 * the first part is the body (material links attach to it). The name label is added under the
 * shapes, centred, when the symbol is inserted.
 */

export type Part =
  | { type: "rectangle" | "ellipse"; x: number; y: number; w: number; h: number; round?: boolean; fill?: string; hatch?: boolean; dashed?: boolean }
  | { type: "line"; x: number; y: number; pts: [number, number][]; fill?: string; dashed?: boolean }
  /** Text inside the symbol (e.g. "PI" in an instrument bubble), top-left at (x, y). */
  | { type: "text"; x: number; y: number; text: string; size?: number };

export interface SymbolDef {
  id: string;
  name: string;
  category: string;
  /** Name label under the symbol. */
  label: string;
  parts: Part[];
}

export const CATEGORIES = [
  "Upstream",
  "Vessels & bags",
  "Filtration & clarification",
  "Chromatography & purification",
  "Pumps, valves & lines",
  "Connections & transfer",
  "Instruments",
  "Utilities & CIP",
  "Fill & storage",
  "Other",
] as const;

const W = "#ffffff";
const INK = "#1e1e1e";
const RESIN = "#c7d7de";
type R = Extract<Part, { type: "rectangle" | "ellipse" }>;
type L = Extract<Part, { type: "line" }>;
const rect = (x: number, y: number, w: number, h: number, o: Partial<R> = {}): Part => ({ type: "rectangle", x, y, w, h, fill: W, ...o });
const oval = (x: number, y: number, w: number, h: number, o: Partial<R> = {}): Part => ({ type: "ellipse", x, y, w, h, fill: W, ...o });
const line = (x: number, y: number, pts: [number, number][], o: Partial<L> = {}): Part => ({ type: "line", x, y, pts, ...o });
const text = (x: number, y: number, t: string, size = 14): Part => ({ type: "text", x, y, text: t, size });

/** A cylinder standing up: body, top and bottom ellipses. */
const cylinder = (x: number, y: number, w: number, h: number): Part[] => [rect(x, y + 10, w, h - 20), oval(x, y, w, 20), oval(x, y + h - 20, w, 20)];
/** A filter capsule with inlet and outlet. */
const capsule = (x: number, y: number, w: number, h: number): Part[] => [
  rect(x, y + 8, w, h - 16, { round: true }), line(x + w / 2, y, [[0, 0], [0, 8]]), line(x + w / 2, y + h - 8, [[0, 0], [0, 8]]),
];
/** A packed column with end plates; `mark` is written in the bed. */
const column = (x: number, w: number, mark?: string): Part[] => [
  rect(x + 4, 10, w - 8, 108, { fill: RESIN, hatch: true }), rect(x, 0, w, 10), rect(x, 118, w, 10),
  ...(mark ? [text(x + w / 2 - mark.length * 4.2, 56, mark, 14)] : []),
];
/** ISA-style instrument bubble with its letters. */
const bubble = (letters: string): Part[] => [oval(0, 0, 44, 44), text(22 - letters.length * 4.4, 14, letters, 14), line(22, 44, [[0, 0], [0, 14]], { dashed: true })];
/** A valve body (two triangles tip to tip), w × h, top-left at (x, y). */
const bowtie = (x: number, y: number, w = 56, h = 28, fill = W): Part => line(x, y, [[0, 0], [w, h], [w, 0], [0, h], [0, 0]], { fill });
/** A labelled utility box with a connection below. */
const utility = (tag: string): Part[] => [rect(0, 0, 56, 28, { round: true }), text(28 - tag.length * 4.6, 6, tag, 14), line(28, 28, [[0, 0], [0, 14]])];

export const SYMBOLS: SymbolDef[] = [
  // ---- Upstream ----------------------------------------------------------------------------------
  { id: "bioreactor", name: "Bioreactor", category: "Upstream", label: "Bioreactor", parts: [
    rect(0, 20, 72, 104, { round: true }), rect(26, 0, 20, 12), line(36, 12, [[0, 0], [0, 80]]), line(20, 92, [[0, 0], [32, 0]]), line(20, 70, [[0, 0], [32, 0]]),
  ] },
  { id: "rocking", name: "Rocking bioreactor", category: "Upstream", label: "Rocking bioreactor", parts: [
    rect(0, 0, 110, 42, { round: true }), line(0, 54, [[0, 0], [110, 0]]), line(55, 54, [[0, 0], [-12, 18], [12, 18], [0, 0]], { fill: W }),
  ] },
  { id: "flask", name: "Shake flask", category: "Upstream", label: "Flask", parts: [
    line(0, 0, [[16, 0], [28, 0], [28, 24], [44, 66], [0, 66], [16, 24], [16, 0]], { fill: W }), line(6, 50, [[0, 0], [32, 0]]),
  ] },
  { id: "vial", name: "Cell bank vial", category: "Upstream", label: "Cell bank", parts: [
    rect(2, 12, 24, 48, { round: true }), rect(0, 0, 28, 12), line(6, 44, [[0, 0], [16, 0]]),
  ] },
  { id: "atf", name: "ATF / perfusion device", category: "Upstream", label: "ATF", parts: [
    rect(10, 0, 28, 76, { round: true }), line(18, 8, [[0, 0], [0, 60]], { dashed: true }), line(30, 8, [[0, 0], [0, 60]], { dashed: true }), oval(4, 80, 40, 24),
  ] },
  { id: "sparger", name: "Sparger", category: "Upstream", label: "Sparger", parts: [
    line(0, 20, [[0, 0], [60, 0]]), oval(8, 8, 6, 6), oval(22, 4, 6, 6), oval(36, 8, 6, 6), oval(50, 4, 6, 6), line(30, 20, [[0, 0], [0, 16]]),
  ] },
  { id: "agitator", name: "Agitator", category: "Upstream", label: "Agitator", parts: [
    rect(14, 0, 24, 16), line(26, 16, [[0, 0], [0, 54]]), line(10, 70, [[0, 0], [32, 0]]), line(10, 64, [[0, 0], [0, 12]]), line(42, 64, [[0, 0], [0, 12]]),
  ] },
  { id: "ventfilter", name: "Vent / exhaust gas filter", category: "Upstream", label: "Vent filter", parts: [
    rect(0, 10, 36, 50, { round: true }), line(0, 60, [[0, 0], [36, -50]], { dashed: true }), line(18, 0, [[0, 0], [0, 10]]), line(12, 6, [[0, 0], [6, -6], [12, 0]]), line(18, 60, [[0, 0], [0, 10]]),
  ] },
  { id: "condenser", name: "Exhaust condenser", category: "Upstream", label: "Condenser", parts: [
    rect(0, 0, 36, 72), line(8, 10, [[0, 0], [20, 6], [0, 12], [20, 18], [0, 24], [20, 30], [0, 36], [20, 42], [0, 48], [20, 52]]),
  ] },
  { id: "gascyl", name: "Gas cylinder", category: "Upstream", label: "Gas", parts: [
    rect(0, 14, 28, 70, { round: true }), rect(8, 4, 12, 10), line(14, 0, [[0, 0], [0, 4]]),
  ] },

  // ---- Vessels & bags ------------------------------------------------------------------------------
  { id: "tank", name: "Hold vessel", category: "Vessels & bags", label: "Hold vessel", parts: cylinder(0, 0, 72, 112) },
  { id: "jacketed", name: "Jacketed vessel", category: "Vessels & bags", label: "Jacketed vessel", parts: [
    ...cylinder(8, 0, 72, 112), rect(0, 34, 88, 62, { fill: undefined, dashed: true }),
  ] },
  { id: "mixtank", name: "Mixing vessel", category: "Vessels & bags", label: "Mixing vessel", parts: [
    ...cylinder(0, 24, 72, 112), rect(28, 0, 16, 14), line(36, 14, [[0, 0], [0, 84]]), line(20, 98, [[0, 0], [32, 0]]),
  ] },
  { id: "bag", name: "Single-use bag", category: "Vessels & bags", label: "Bag", parts: [
    rect(0, 12, 64, 84, { round: true }), line(20, 0, [[0, 0], [0, 12]]), line(44, 0, [[0, 0], [0, 12]]),
  ] },
  { id: "bag3d", name: "3D bag in tote", category: "Vessels & bags", label: "3D bag", parts: [
    rect(8, 8, 64, 64, { round: true }), rect(0, 0, 80, 80, { fill: undefined }), line(4, 80, [[0, 0], [0, 10]]), line(76, 80, [[0, 0], [0, 10]]), line(40, -10, [[0, 0], [0, 18]]),
  ] },
  { id: "sumixer", name: "Single-use mixer", category: "Vessels & bags", label: "SU mixer", parts: [
    rect(6, 6, 68, 72, { round: true }), rect(0, 0, 80, 84, { fill: undefined }), oval(30, 62, 20, 10), rect(28, 86, 24, 10),
  ] },
  { id: "bottle", name: "Bottle / carboy", category: "Vessels & bags", label: "Bottle", parts: [
    line(0, 0, [[14, 0], [30, 0], [30, 10], [44, 22], [44, 80], [0, 80], [0, 22], [14, 10], [14, 0]], { fill: W }), line(0, 50, [[0, 0], [44, 0]]),
  ] },
  { id: "drum", name: "Waste container", category: "Vessels & bags", label: "Waste", parts: [
    ...cylinder(0, 0, 60, 72), line(10, 46, [[0, 0], [40, 0]], { dashed: true }),
  ] },
  { id: "bagmanifold", name: "Bag manifold", category: "Vessels & bags", label: "Bag manifold", parts: [
    rect(0, 18, 22, 36, { round: true }), rect(30, 18, 22, 36, { round: true }), rect(60, 18, 22, 36, { round: true }),
    line(11, 8, [[0, 0], [60, 0], [80, 0]]), line(11, 8, [[0, 0], [0, 10]]), line(41, 8, [[0, 0], [0, 10]]), line(71, 8, [[0, 0], [0, 10]]),
  ] },
  { id: "hopper", name: "Hopper / powder addition", category: "Vessels & bags", label: "Hopper", parts: [
    line(0, 0, [[0, 0], [60, 0], [38, 40], [38, 56], [22, 56], [22, 40], [0, 0]], { fill: W }),
  ] },

  // ---- Filtration & clarification ------------------------------------------------------------------
  { id: "filter", name: "Filter", category: "Filtration & clarification", label: "Filter", parts: [
    rect(0, 0, 44, 72), line(0, 72, [[0, 0], [44, -72]], { dashed: true }),
  ] },
  { id: "depth", name: "Depth filter", category: "Filtration & clarification", label: "Depth filter", parts: [
    rect(0, 0, 64, 72), line(8, 18, [[0, 0], [48, 0]], { dashed: true }), line(8, 36, [[0, 0], [48, 0]], { dashed: true }), line(8, 54, [[0, 0], [48, 0]], { dashed: true }),
  ] },
  { id: "sterile", name: "Sterile filter (0.2 µm)", category: "Filtration & clarification", label: "0.2 µm filter", parts: [
    ...capsule(0, 0, 40, 80), line(8, 18, [[0, 0], [24, 7], [0, 14], [24, 21], [0, 28], [24, 35], [0, 42]]),
  ] },
  { id: "prefilter", name: "Prefilter", category: "Filtration & clarification", label: "Prefilter", parts: [
    ...capsule(0, 0, 40, 80), line(8, 20, [[0, 0], [24, 10], [0, 20], [24, 30], [0, 40]]),
  ] },
  { id: "virus", name: "Virus filter", category: "Filtration & clarification", label: "Virus filter", parts: [
    ...capsule(0, 0, 44, 80), text(12, 32, "VF", 14), line(6, 60, [[0, 0], [32, 0]], { dashed: true }),
  ] },
  { id: "cartridge", name: "Cartridge filter in housing", category: "Filtration & clarification", label: "Cartridge filter", parts: [
    rect(0, 10, 48, 72, { round: true }), rect(-6, 0, 60, 10), rect(12, 18, 24, 56, { fill: undefined, dashed: true }),
  ] },
  { id: "tff", name: "TFF / UF-DF", category: "Filtration & clarification", label: "TFF", parts: [
    rect(0, 0, 116, 48), line(0, 24, [[0, 0], [116, 0]], { dashed: true }),
  ] },
  { id: "hollow", name: "Hollow fiber module", category: "Filtration & clarification", label: "Hollow fiber", parts: [
    rect(6, 0, 108, 32), oval(0, 0, 12, 32), oval(108, 0, 12, 32),
    line(12, 9, [[0, 0], [96, 0]], { dashed: true }), line(12, 16, [[0, 0], [96, 0]], { dashed: true }), line(12, 23, [[0, 0], [96, 0]], { dashed: true }),
  ] },
  { id: "madsorber", name: "Membrane adsorber", category: "Filtration & clarification", label: "Membrane adsorber", parts: [
    ...capsule(0, 0, 48, 80), line(8, 24, [[0, 0], [32, 0]]), line(8, 32, [[0, 0], [32, 0]]), line(8, 40, [[0, 0], [32, 0]]), line(8, 48, [[0, 0], [32, 0]]), line(8, 56, [[0, 0], [32, 0]]),
  ] },
  { id: "centrifuge", name: "Centrifuge", category: "Filtration & clarification", label: "Centrifuge", parts: [
    oval(0, 0, 72, 72), oval(20, 20, 32, 32, { fill: undefined }), line(36, 20, [[0, 0], [0, 32]]),
  ] },

  // ---- Chromatography & purification ------------------------------------------------------------------
  { id: "column", name: "Chromatography column", category: "Chromatography & purification", label: "Column", parts: column(0, 48) },
  { id: "proa", name: "Protein A column", category: "Chromatography & purification", label: "Protein A", parts: column(0, 48, "A") },
  { id: "iex", name: "Ion exchange column (AEX / CEX)", category: "Chromatography & purification", label: "IEX column", parts: column(0, 48, "IEX") },
  { id: "hic", name: "HIC / mixed-mode column", category: "Chromatography & purification", label: "HIC column", parts: column(0, 48, "HIC") },
  { id: "multicol", name: "Multi-column (continuous)", category: "Chromatography & purification", label: "Multi-column", parts: [
    ...column(0, 36), ...column(48, 36), line(18, -12, [[0, 0], [48, 0], [48, 12]]), line(18, -12, [[0, 0], [0, 12]]),
  ] },
  { id: "vi", name: "Low-pH viral inactivation", category: "Chromatography & purification", label: "Viral inactivation", parts: [
    ...cylinder(0, 0, 72, 104), text(25, 44, "pH", 16),
  ] },
  { id: "uvc", name: "UV-C reactor", category: "Chromatography & purification", label: "UV-C", parts: [
    rect(0, 0, 100, 30, { round: true }), line(10, 15, [[0, 0], [10, -8], [20, 8], [30, -8], [40, 8], [50, -8], [60, 8], [70, -8], [80, 0]]),
  ] },
  { id: "chromskid", name: "Chromatography system (skid)", category: "Chromatography & purification", label: "Chromatography system", parts: [
    rect(0, 0, 120, 76, { round: true }), rect(12, 10, 18, 54, { fill: RESIN, hatch: true }), oval(46, 18, 24, 24), line(52, 24, [[0, 0], [14, 6], [0, 12], [0, 0]]),
    rect(84, 14, 26, 20), text(88, 17, "UV", 12), line(30, 30, [[0, 0], [16, 0]]), line(70, 30, [[0, 0], [14, 0]]), line(97, 34, [[0, 0], [0, 30], [-76, 30], [-76, 30]]),
  ] },

  // ---- Pumps, valves & lines -----------------------------------------------------------------------------
  { id: "pump", name: "Pump", category: "Pumps, valves & lines", label: "Pump", parts: [
    oval(0, 0, 52, 52), line(16, 12, [[0, 0], [26, 14], [0, 28], [0, 0]]),
  ] },
  { id: "peristaltic", name: "Peristaltic pump", category: "Pumps, valves & lines", label: "Peristaltic pump", parts: [
    oval(0, 0, 52, 52), oval(14, 14, 24, 24, { fill: undefined }),
  ] },
  { id: "diaphragm", name: "Diaphragm pump", category: "Pumps, valves & lines", label: "Diaphragm pump", parts: [
    oval(0, 0, 52, 52), line(10, 28, [[0, 0], [6, -10], [16, -14], [26, -10], [32, 0], [0, 0]]),
  ] },
  { id: "valve", name: "Valve", category: "Pumps, valves & lines", label: "Valve", parts: [
    line(0, 0, [[0, 0], [56, 28], [56, 0], [0, 28], [0, 0]], { fill: W }),
  ] },
  { id: "valve3", name: "Three-way valve", category: "Pumps, valves & lines", label: "3-way valve", parts: [
    line(0, 0, [[0, 0], [28, 14], [0, 28], [0, 0]], { fill: W }), line(28, 0, [[28, 0], [0, 14], [28, 28], [28, 0]], { fill: W }), line(14, 14, [[14, 0], [0, 28], [28, 28], [14, 0]], { fill: W }),
  ] },
  { id: "check", name: "Check valve", category: "Pumps, valves & lines", label: "Check valve", parts: [
    line(0, 0, [[0, 0], [56, 28], [56, 0], [0, 28], [0, 0]], { fill: W }), line(28, 0, [[28, 0], [0, 14], [28, 28], [28, 0]], { fill: INK }),
  ] },
  { id: "pinch", name: "Pinch valve (single-use)", category: "Pumps, valves & lines", label: "Pinch valve", parts: [
    rect(0, 12, 64, 12, { round: true }), line(24, 0, [[0, 0], [16, 0], [8, 10], [0, 0]], { fill: INK }), line(24, 26, [[0, 10], [16, 10], [8, 0], [0, 10]], { fill: INK }),
  ] },
  { id: "hx", name: "Heat exchanger", category: "Pumps, valves & lines", label: "Heat exchanger", parts: [
    oval(0, 0, 56, 56), line(6, 34, [[0, 0], [10, -14], [22, 12], [34, -14], [44, 0]]),
  ] },
  { id: "staticmixer", name: "Static mixer", category: "Pumps, valves & lines", label: "Static mixer", parts: [
    rect(0, 0, 96, 24), line(8, 12, [[0, 0], [10, -8], [20, 8], [30, -8], [40, 8], [50, -8], [60, 8], [70, -8], [80, 0]]),
  ] },
  { id: "sample", name: "Sampling point", category: "Pumps, valves & lines", label: "Sample", parts: [
    oval(0, 0, 28, 28), text(9, 6, "S", 14), line(14, 28, [[0, 0], [0, 14]]),
  ] },
  { id: "dvalve", name: "Diaphragm valve", category: "Pumps, valves & lines", label: "Diaphragm valve", parts: [
    bowtie(0, 12), line(18, 12, [[0, 14], [2, 6], [10, 0], [18, 6], [20, 14]]),
  ] },
  { id: "ballvalve", name: "Ball valve", category: "Pumps, valves & lines", label: "Ball valve", parts: [
    bowtie(0, 0), oval(21, 7, 14, 14, { fill: INK }),
  ] },
  { id: "bfvalve", name: "Butterfly valve", category: "Pumps, valves & lines", label: "Butterfly valve", parts: [
    line(0, 0, [[0, 0], [0, 32]]), line(40, 0, [[0, 0], [0, 32]]), line(8, 28, [[0, 0], [24, -24]]), oval(17, 13, 6, 6, { fill: INK }), line(-12, 16, [[0, 0], [12, 0]]), line(40, 16, [[0, 0], [12, 0]]),
  ] },
  { id: "cvalve", name: "Control valve", category: "Pumps, valves & lines", label: "Control valve", parts: [
    bowtie(0, 26), line(28, 12, [[0, 0], [0, 28]]), line(12, 12, [[0, 0], [4, -9], [16, -12], [28, -9], [32, 0], [0, 0]], { fill: W }),
  ] },
  { id: "psv", name: "Pressure relief valve (PSV)", category: "Pumps, valves & lines", label: "Relief valve", parts: [
    line(0, 28, [[0, 28], [28, 28], [14, 0], [0, 28]], { fill: W }), line(14, 14, [[28, 0], [28, 28], [0, 14], [28, 0]], { fill: W }),
    line(14, 28, [[0, 0], [0, -6], [-6, -10], [6, -14], [-6, -18], [6, -22], [0, -26]]),
  ] },
  { id: "steamtrap", name: "Steam trap", category: "Pumps, valves & lines", label: "Steam trap", parts: [
    oval(12, 0, 32, 32), text(23, 7, "T", 14), line(0, 16, [[0, 0], [12, 0]]), line(44, 16, [[0, 0], [12, 0]]),
  ] },
  { id: "rupture", name: "Rupture disc", category: "Pumps, valves & lines", label: "Rupture disc", parts: [
    line(0, 30, [[0, 0], [40, 0]]), line(0, 30, [[0, 0], [10, -10], [30, -10], [40, 0]]), line(20, 30, [[0, 0], [0, 20]]),
  ] },
  { id: "sightglass", name: "Sight glass", category: "Pumps, valves & lines", label: "Sight glass", parts: [
    oval(16, 0, 32, 32), oval(24, 8, 16, 16, { fill: undefined }), line(0, 16, [[0, 0], [16, 0]]), line(48, 16, [[0, 0], [16, 0]]),
  ] },

  // ---- Connections & transfer ----------------------------------------------------------------------------
  { id: "transferpanel", name: "Transfer panel", category: "Connections & transfer", label: "Transfer panel", parts: [
    rect(0, 0, 110, 80, { round: true }),
    oval(14, 24, 14, 14), oval(48, 24, 14, 14), oval(82, 24, 14, 14), oval(14, 54, 14, 14), oval(48, 54, 14, 14), oval(82, 54, 14, 14),
    line(21, 24, [[0, 0], [0, -14], [34, -14], [34, 0]]),
  ] },
  { id: "ubend", name: "U-bend (jumper)", category: "Connections & transfer", label: "U-bend", parts: [
    line(0, 0, [[0, 0], [0, 24], [6, 32], [30, 32], [36, 24], [36, 0]]), line(-4, 0, [[0, 0], [8, 0]]), line(32, 0, [[0, 0], [8, 0]]),
  ] },
  { id: "aseptic", name: "Aseptic connector", category: "Connections & transfer", label: "Aseptic connector", parts: [
    rect(12, 6, 22, 24, { round: true }), rect(38, 6, 22, 24, { round: true }), line(36, 2, [[0, 0], [0, 32]], { dashed: true }), line(0, 18, [[0, 0], [12, 0]]), line(60, 18, [[0, 0], [12, 0]]),
  ] },
  { id: "triclamp", name: "Tri-clamp connection", category: "Connections & transfer", label: "Tri-clamp", parts: [
    rect(20, 0, 6, 36), rect(30, 0, 6, 36), oval(14, -4, 28, 44, { fill: undefined, dashed: true }), line(0, 18, [[0, 0], [20, 0]]), line(36, 18, [[0, 0], [20, 0]]),
  ] },
  { id: "tubeweld", name: "Tube weld", category: "Connections & transfer", label: "Tube weld", parts: [
    rect(0, 9, 64, 10, { round: true }), line(26, 4, [[6, 0], [12, 10], [6, 20], [0, 10], [6, 0]], { fill: INK }),
  ] },
  { id: "tubeseal", name: "Tube seal / disconnect", category: "Connections & transfer", label: "Tube seal", parts: [
    rect(0, 9, 44, 10, { round: true }), rect(44, 4, 4, 20, { fill: INK }), rect(54, 4, 4, 20, { fill: INK }), rect(58, 9, 24, 10, { round: true }),
  ] },
  { id: "hose", name: "Flexible hose / tubing", category: "Connections & transfer", label: "Flexible hose", parts: [
    line(0, 10, [[0, 0], [8, -10], [16, 0], [24, 10], [32, 0], [40, -10], [48, 0], [56, 10], [64, 0]]), line(0, 4, [[0, 0], [0, 12]]), line(64, 4, [[0, 0], [0, 12]]),
  ] },

  // ---- Instruments ------------------------------------------------------------------------------------
  { id: "inst_p", name: "Pressure indicator (PI)", category: "Instruments", label: "Pressure", parts: bubble("PI") },
  { id: "inst_f", name: "Flow indicator (FI)", category: "Instruments", label: "Flow", parts: bubble("FI") },
  { id: "inst_t", name: "Temperature indicator (TI)", category: "Instruments", label: "Temperature", parts: bubble("TI") },
  { id: "inst_ph", name: "pH sensor", category: "Instruments", label: "pH", parts: bubble("pH") },
  { id: "inst_c", name: "Conductivity sensor", category: "Instruments", label: "Conductivity", parts: bubble("CI") },
  { id: "inst_uv", name: "UV detector", category: "Instruments", label: "UV", parts: bubble("UV") },
  { id: "inst_l", name: "Level indicator (LI)", category: "Instruments", label: "Level", parts: bubble("LI") },
  { id: "inst_do", name: "Dissolved oxygen (DO)", category: "Instruments", label: "DO", parts: bubble("DO") },
  { id: "inst_w", name: "Weight / load cell (WI)", category: "Instruments", label: "Weight", parts: bubble("WI") },
  { id: "inst_mfc", name: "Gas flow controller (FIC)", category: "Instruments", label: "Gas flow", parts: bubble("FIC") },

  // ---- Utilities & CIP ----------------------------------------------------------------------------------
  { id: "cip", name: "CIP skid", category: "Utilities & CIP", label: "CIP skid", parts: [
    rect(0, 0, 92, 56, { round: true }), text(12, 18, "CIP", 16), oval(58, 16, 24, 24), line(64, 22, [[0, 0], [14, 6], [0, 12], [0, 0]]),
  ] },
  { id: "wfi", name: "WFI point of use", category: "Utilities & CIP", label: "WFI", parts: utility("WFI") },
  { id: "cleansteam", name: "Clean steam", category: "Utilities & CIP", label: "Clean steam", parts: utility("CS") },
  { id: "air", name: "Process air / gas supply", category: "Utilities & CIP", label: "Process gas", parts: utility("AIR") },
  { id: "tcu", name: "Temperature control unit", category: "Utilities & CIP", label: "TCU", parts: [
    rect(0, 0, 64, 48), text(16, 15, "TCU", 14), line(-12, 14, [[0, 0], [12, 0]]), line(-12, 34, [[0, 0], [12, 0]]),
  ] },
  { id: "drain", name: "Drain", category: "Utilities & CIP", label: "Drain", parts: [
    line(0, 0, [[0, 0], [32, 0], [20, 14], [20, 26], [12, 26], [12, 14], [0, 0]], { fill: W }), line(4, 32, [[0, 0], [24, 0]]), line(9, 37, [[0, 0], [14, 0]]),
  ] },
  { id: "vent", name: "Vent", category: "Utilities & CIP", label: "Vent", parts: [
    line(12, 10, [[0, 0], [0, 34]]), line(0, 16, [[0, 0], [0, -12], [24, -12], [24, 0]]),
  ] },

  // ---- Fill & storage --------------------------------------------------------------------------------------
  { id: "filling", name: "Filling (fill-finish)", category: "Fill & storage", label: "Filling", parts: [
    rect(0, 24, 20, 36, { round: true }), rect(28, 24, 20, 36, { round: true }), rect(56, 24, 20, 36, { round: true }),
    line(38, 0, [[0, 0], [0, 18]]), line(30, 0, [[0, 0], [16, 0]]),
  ] },
  { id: "bds", name: "Bulk drug substance", category: "Fill & storage", label: "Bulk DS", parts: [
    line(0, 0, [[14, 0], [30, 0], [30, 10], [44, 22], [44, 80], [0, 80], [0, 22], [14, 10], [14, 0]], { fill: W }), text(10, 42, "DS", 14),
  ] },
  { id: "freezer", name: "Freezer / freeze-thaw", category: "Fill & storage", label: "Freezer", parts: [
    rect(0, 0, 64, 76), line(32, 18, [[0, 0], [0, 40]]), line(14, 28, [[0, 0], [36, 20]]), line(14, 48, [[0, 0], [36, -20]]),
  ] },

  { id: "lyo", name: "Lyophilizer", category: "Fill & storage", label: "Lyophilizer", parts: [
    rect(0, 0, 80, 72), line(8, 20, [[0, 0], [64, 0]]), line(8, 38, [[0, 0], [64, 0]]), line(8, 56, [[0, 0], [64, 0]]), line(84, 10, [[0, 0], [0, 52]]),
  ] },

  // ---- Other -----------------------------------------------------------------------------------------------
  { id: "offpage", name: "Off-page reference", category: "Other", label: "To / from", parts: [
    line(0, 0, [[0, 0], [60, 0], [76, 18], [60, 36], [0, 36], [0, 0]], { fill: W }),
  ] },
];

export const symbolById = (id: string) => SYMBOLS.find((s) => s.id === id);

/** Bounds of a symbol's parts (texts counted roughly). */
export function partsBounds(parts: readonly Part[]) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of parts) {
    if (p.type === "line") for (const [px, py] of p.pts) { minX = Math.min(minX, p.x + px); maxX = Math.max(maxX, p.x + px); minY = Math.min(minY, p.y + py); maxY = Math.max(maxY, p.y + py); }
    else if (p.type === "text") { const s = p.size ?? 14; minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x + p.text.length * s * 0.6); maxY = Math.max(maxY, p.y + s * 1.2); }
    else { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x + p.w); maxY = Math.max(maxY, p.y + p.h); }
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Small SVG preview of a symbol for the palette (no name label). */
export function symbolPreviewSvg(def: Pick<SymbolDef, "parts">, size = 44): string {
  const b = partsBounds(def.parts);
  const pad = 3;
  const body = def.parts.map((p) => {
    const dash = p.type !== "text" && p.dashed ? ' stroke-dasharray="5 4"' : "";
    const dark = p.type !== "text" && p.fill && p.fill !== W && !(p.type !== "line" && p.hatch) ? "currentColor" : "none";
    if (p.type === "rectangle") return `<rect x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" rx="${p.round ? Math.min(p.w, p.h) * 0.25 : 0}" fill="${p.hatch ? p.fill : dark}"${dash}/>`;
    if (p.type === "ellipse") return `<ellipse cx="${p.x + p.w / 2}" cy="${p.y + p.h / 2}" rx="${p.w / 2}" ry="${p.h / 2}" fill="${dark}"${dash}/>`;
    if (p.type === "line") return `<polyline points="${p.pts.map(([a, c]) => `${p.x + a},${p.y + c}`).join(" ")}" fill="${dark}"${dash}/>`;
    if (p.type !== "text") return "";
    const s = p.size ?? 14;
    return `<text x="${p.x}" y="${p.y + s * 0.95}" font-size="${s}" font-family="Arial, sans-serif" fill="currentColor" stroke="none">${esc(p.text)}</text>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="${b.x - pad} ${b.y - pad} ${b.width + pad * 2} ${b.height + pad * 2}" stroke="currentColor" stroke-width="${Math.max(b.width, b.height) / size * 1.6}" stroke-linejoin="round">${body}</svg>`;
}
