/**
 * Project file format v1 (`*.pcs.json`). One project = one process (PCS): its unit operations,
 * the PFD board, the Mass Balance link and the BOM. Everything the app knows lives here.
 */

export const PROJECT_FORMAT = "pcs-project";
/**
 * v3 adds equipment and operations (steps and actions); v4 the SAP semi-finished products (N5.7). A file is
 * written with the lowest version that keeps what it has (without either it is still v2).
 */
export const PROJECT_VERSION = 4;

export interface Material {
  id: string;
  /** Material code, unique in the project (MatCode in PCS_LINK). */
  code: string;
  name: string;
  /** Unit every quantity of this material is expressed in (kg, L, EA …). */
  unit: string;
  category?: string;
  spec?: string;
  note?: string;
  /** Default overage for BOM lines of this material, in % (0 when not set). */
  overagePct?: number;
  /**
   * Made in-house (a buffer, a medium, a stock solution): what it is made of. The BOM turns every
   * quantity of this material into its components (recipe explosion), so the chemicals are bought.
   */
  recipe?: Recipe;
  /** Alternate materials (another supplier or part) used when this one is not available. */
  backups?: BackupMaterial[];
  /** Where the material stands: in use (not set), under review, or obsolete (the BOM asks to replace it). */
  status?: MaterialStatus;
  /** The material that replaced it (id), set by Replace. */
  replacedBy?: string;
  /** Purchasing: who sells it and their part (catalogue) number. */
  supplier?: string;
  partNo?: string;
  /**
   * Size of one pack as bought, in the material's unit (a 25 kg bag, a box of 3 filters = 3). The BOM totals
   * then say how many packs to order: ⌈total ÷ pack size⌉ (rounded up).
   */
  packSize?: number;
}

export type MaterialStatus = "review" | "obsolete";

export interface RecipeComponent {
  materialId: string;
  /**
   * Quantity of the component, in its own unit: for `Recipe.per` units of the prepared material, or,
   * when `basis` is "batch", for each batch (one bag, one filter per preparation …).
   */
  qty: number;
  /** "batch": counted once per batch, ⌈quantity ÷ Recipe.batch⌉ times. Not set: in proportion to the quantity. */
  basis?: "batch";
}

export interface Recipe {
  /** The amount of the prepared material the quantities are written for (e.g. 1000 for "per 1000 L"). */
  per: number;
  components: RecipeComponent[];
  note?: string;
  /**
   * Size of one batch (one preparation: a bag, a tank), in the prepared material's unit. A BOM line of
   * the material needs ⌈quantity ÷ batch⌉ batches; "per batch" components are counted that many times.
   */
  batch?: number;
  /** Make every batch in full: proportional components are counted for batches × batch size, not for the quantity needed. */
  wholeBatches?: boolean;
}

export interface BackupMaterial {
  materialId: string;
  /** Quantity of the backup per 1 unit of the primary material (not set = 1, the same quantity). */
  ratio?: number;
  note?: string;
}

export interface UnitOperation {
  id: string;
  /** UO code used in Stream IDs: A–Z/0–9, at least one letter, ≤ 10 chars. */
  code: string;
  name: string;
  order: number;
}

export type StreamKind = "pfd" | "transfer";

/** Who owns a Stream ID: an arrow on the PFD board. */
export interface StreamOwner {
  kind: StreamKind;
  /** Excalidraw element id of the arrow. */
  elementId: string;
  /** pfd: the UO the arrow sits in. */
  uoId?: string;
  /** transfer: source and destination UO. */
  fromUoId?: string;
  toUoId?: string;
}

export interface RetiredStream extends StreamOwner {
  streamId: string;
  retiredAt: string;
  reason?: string;
}

export interface StreamRegistry {
  /** Last arrow number issued per UO code (only ever grows). */
  seq: Record<string, number>;
  /** streamId → owner, for IDs in use. */
  active: Record<string, StreamOwner>;
  /** IDs whose arrow was deleted. Never reissued; restored if the same arrow comes back (undo). */
  retired: RetiredStream[];
}

export interface Scenario {
  id: string;
  name: string;
  /** Column header in the PCS_LINK sheet. */
  column: string;
}

export interface MbRow {
  streamId: string;
  /** null = flow row (PFD label); a code = material row (BOM). */
  matCode: string | null;
  unit: string;
  /** scenario id → value; null when the workbook left it empty. */
  values: Record<string, number | null>;
  note?: string;
  sourceRow?: number;
}

export interface MbSnapshot {
  id: string;
  source: "file" | "gridcraft";
  fileName?: string;
  sha256?: string;
  /** Application that last saved the workbook (GridCraft, Microsoft Excel …). */
  savedBy?: string;
  fileModifiedAt?: string;
  importedAt: string;
  importedBy?: string;
  scenarios: string[];
  rows: MbRow[];
}

export interface MbHistoryEntry {
  id: string;
  source: string;
  fileName?: string;
  sha256?: string;
  savedBy?: string;
  importedAt: string;
  importedBy?: string;
  rowCount: number;
  /** What happened, when it was not a plain application (e.g. codes changed by the app). */
  note?: string;
}

/** The engineer's MB workbook, kept with the project so it travels with the file. */
export interface MbWorkbook {
  name: string;
  dataBase64: string;
  sha256: string;
  /** Application that last saved it (from the file), e.g. GridCraft or Microsoft Excel. */
  savedBy?: string;
  /** How it last came in: uploaded as a file, or saved from GridCraft inside the app. */
  source?: "file" | "gridcraft";
  updatedAt: string;
}

export interface MassBalance {
  scenarios: Scenario[];
  activeScenario: string;
  current: MbSnapshot | null;
  history: MbHistoryEntry[];
  workbook: MbWorkbook | null;
}

export type QtySource = "MB" | "PFD" | "manual";

/**
 * A BOM line the user has set or added. Lines the app derives (materials in the applied MB, or
 * linked on PFD shapes) exist without being stored; they are stored once the user changes them.
 */
export interface BomLine {
  materialId: string;
  qtySource: QtySource;
  /** qtySource = manual: scenario id → quantity in the material's unit; null = not entered. */
  manualQty: Record<string, number | null>;
  /** % added on top of the source quantity; not set = the material's default overage. */
  overagePct?: number;
  /** Reason (required for manual quantities) or any remark. */
  note?: string;
  /** Kept in the list but not counted. */
  excluded?: boolean;
}

export interface Bom {
  /** UO id → its stored material lines. */
  lines: Record<string, BomLine[]>;
  /** Saved revisions (Rev A, Rev B …): what the BOM said at that moment, to compare with later. */
  revisions?: BomRevision[];
  /** Semi-finished products and the SAP BOM export (N5.7). Never changes the BOM lines or quantities. */
  sap?: SapSetup;
}

export type SemiKind = "uo" | "packing" | "unpacking";
export type SapDateFormat = "YYYY.MM.DD" | "YYYYMMDD" | "YYYY-MM-DD" | "DD.MM.YYYY" | "MM/DD/YYYY";

/** A semi-finished product (SAP HALB) of a unit operation: its run, or its column packing / unpacking. */
export interface SemiFinished {
  id: string;
  kind: SemiKind;
  uoId: string;
  /** SAP material number (entered here). */
  code: string;
  name: string;
  /** kind "uo": the stream whose MB flow is the base quantity (one batch's output); not set = the first transfer out. */
  stream?: string;
  /** A base quantity typed in (wins over the stream), and its unit. */
  baseQty?: number;
  baseUnit?: string;
  /** packing / unpacking: the BOM lines of its unit operation it takes (material ids). The others stay on the unit operation's. */
  materials?: string[];
}

/** Settings of the SAP BOM sheets (CS01 / upload) and the semi-finished products. */
export interface SapSetup {
  semi: SemiFinished[];
  /** WERKS */
  plant?: string;
  /** STLAN (default 1, production) */
  usage?: string;
  /** STLAL (default 1) */
  alternative?: string;
  /** STLST (default 1, active) */
  status?: string;
  /** DATUV, YYYY-MM-DD (not set = the day of the export). */
  validFrom?: string;
  dateFormat?: SapDateFormat;
  /** The scenario whose quantities go to SAP (not set = Receiving). */
  scenarioId?: string;
  /** Codes are numbers of this many digits (not set = 7; 0 = any code). */
  codeDigits?: number;
  /** App unit (lower case) → SAP unit, on top of L, mL, kg, g, mg, EA. */
  units?: Record<string, string>;
  /** Material id → the unit it is counted in in the SAP BOMs: 1 of its own unit = factor of this one (kg → g × 1000). */
  bomUnits?: Record<string, { unit: string; factor: number }>;
  /** A unit operation's semi-finished product takes the one before it (the transfer in). Not set = yes. */
  chain?: boolean;
}

/** A quantity per scenario id (null = no value). */
export type ScenarioValues = Record<string, number | null>;

/** One saved state of the BOM: its results, by code (not ids), so it reads the same after the list changes. */
export interface BomRevision {
  id: string;
  /** "Rev A", "Rev B" … or the user's own label. */
  label: string;
  note?: string;
  createdAt: string;
  createdBy?: string;
  /** The applied MB workbook at that moment. */
  mbFile?: string;
  scenarios: { id: string; name: string }[];
  /** Counted BOM lines (not the recipe parts or backups). */
  lines: { uo: string; uoName: string; code: string; name: string; unit: string; category?: string; source: string; qty: ScenarioValues; batches?: ScenarioValues; mid?: string; uoId?: string }[];
  /** Totals per material: to buy (buy), prepared in-house (prep). */
  totals: { code: string; name: string; unit: string; category?: string; kind: "buy" | "prep"; qty: ScenarioValues; mid?: string }[];
  /** The materials on the BOM as they were (saved since N5.6): spec, supplier, part no. … to list material changes. */
  materials?: MaterialSnap[];
}

/** A material as a BOM revision keeps it (N5.6). `replacedBy` is the code of the material that replaced it. */
export interface MaterialSnap {
  mid: string;
  code: string;
  name: string;
  unit: string;
  category?: string;
  spec?: string;
  supplier?: string;
  partNo?: string;
  packSize?: number;
  status?: MaterialStatus;
  replacedBy?: string;
}

export interface PfdView {
  viewBackgroundColor?: string;
  gridModeEnabled?: boolean;
  scrollX?: number;
  scrollY?: number;
  zoom?: number;
}

/** One drawing (one Excalidraw scene). Elements are kept as Excalidraw writes them. */
export interface PfdSheet {
  elements: unknown[];
  /** Embedded images, keyed by file id (Excalidraw BinaryFiles). */
  files: Record<string, unknown>;
  view?: PfdView;
}

/**
 * The PFD: a process map (one box per unit operation, and the transfers between them) and one
 * drawing per unit operation (its frame, equipment and streams, plus a connector per transfer).
 */
export interface PfdBoard {
  map: PfdSheet;
  /** UO id → its drawing. */
  sheets: Record<string, PfdSheet>;
  /** User-made library items (components), shared by all drawings. */
  library: unknown[];
}

/** Project file v1 kept the whole PFD in one scene; read it only to convert it. */
export interface PfdBoardV1 {
  elements: unknown[];
  files: Record<string, unknown>;
  library: unknown[];
  view?: PfdView;
}

/**
 * A PFD symbol the user added: an uploaded picture (SVG, PNG …) or shapes saved from a drawing
 * (also from an Excalidraw library file). Used like the built-in symbols and saved with the project.
 */
export interface CustomSymbol {
  id: string;
  name: string;
  /** Palette group; may be a built-in category name to sit next to the built-in symbols. */
  category: string;
  kind: "image" | "shapes";
  /** kind = image */
  image?: { mimeType: string; dataURL: string; width: number; height: number };
  /** kind = shapes: Excalidraw elements with the top-left of their bounds at (0, 0), and their images */
  elements?: unknown[];
  files?: Record<string, unknown>;
  createdAt: string;
}

/** What a piece of equipment is: decides its states (a valve opens and closes, a pump starts and stops). */
export type EquipmentType = "valve" | "pump" | "agitator" | "device" | "vessel" | "filter" | "column" | "instrument" | "other";

/**
 * A piece of equipment with a tag (XV-101, P-101 …): the key that ties a PFD shape to the actions in the
 * steps. Usually drawn (a PFD shape carries its id in customData.pcs.equipmentId), but it need not be.
 */
export interface Equipment {
  id: string;
  /** Unique in the project (compared without regard to case). */
  tag: string;
  type: EquipmentType;
  name?: string;
  /** The unit operation it belongs to (where it was drawn, or set by hand). */
  uoId?: string;
  /** State before the first step; not set = the type's default (valve Closed, pump Off). */
  initial?: string;
  note?: string;
}

/** What happens to one piece of equipment in a step: its state from then on (Open, Closed, On, Off, 150 rpm …). */
export interface OpAction {
  equipmentId: string;
  state: string;
  note?: string;
}

/** One step of a unit operation (Equilibrate, Load, Elute …): its streams and the actions at its start. */
export interface OpStep {
  id: string;
  name: string;
  /** Duration in minutes. */
  minutes?: number;
  /** Stream IDs that flow in this step. */
  streams?: string[];
  note?: string;
  /** At most one per piece of equipment, in the order they are done. */
  actions: OpAction[];
}

export type LabelMode = "id" | "id+active" | "id+both";

export interface ProjectSettings {
  labelMode: LabelMode;
}

export interface ProjectMeta {
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Project {
  format: typeof PROJECT_FORMAT;
  version: typeof PROJECT_VERSION;
  id: string;
  meta: ProjectMeta;
  materials: Material[];
  uos: UnitOperation[];
  pfd: PfdBoard;
  streams: StreamRegistry;
  mb: MassBalance;
  bom: Bom;
  /** Symbols the user added to the PFD palette. */
  symbols: CustomSymbol[];
  /** Equipment with tags (valves, pumps, agitators …), drawn on the PFD or not. */
  equipment: Equipment[];
  /** UO id → its steps, in order. */
  operations: Record<string, OpStep[]>;
  /** Who changed what, when (newest first; the newest 1000). */
  changeLog: ChangeEntry[];
  settings: ProjectSettings;
}

/** One line of the change log. */
export interface ChangeEntry {
  id: string;
  at: string;
  by?: string;
  /** Screen (Materials, BOM, Operations, Mass Balance, PFD) or the action (Undo …). */
  screen: string;
  what: string[];
}
