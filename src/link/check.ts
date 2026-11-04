/**
 * The link check: how the applied Mass Balance, the PFD and the material list fit together right now.
 *
 * Applied MB values are a snapshot. The PFD and the material list keep changing after it, so every
 * applied row is checked against them again, all the time:
 *   ok                the stream is on the PFD and (material rows) the material and its unit match
 *   stream-gone       the stream is no longer on the PFD (deleted, or redrawn and given a new ID)
 *   unknown-material  the MatCode is not in the material list (any more)
 *   unit-mismatch     the material is now counted in another unit than the MB row's
 * Only ok rows count: the BOM always follows the current PFD and material list, and says what it left out.
 * Pure: no React, no editor.
 */
import { bomUoCodeOf } from "../model/ids";
import { componentIds, recipeLoops, recipeOf } from "../model/recipes";
import type { Material, MbRow, Project, UnitOperation } from "../model/types";
import { fmtQty, pfdLinksByCode, pfdStreamIds, streamNames } from "../mb/model";
import { equipmentShapes, uoStreams } from "../ops/model";

export type RowStatus = "ok" | "stream-gone" | "unknown-material" | "unit-mismatch";

export interface AppliedRow {
  row: MbRow;
  status: RowStatus;
  /** UO the row counts toward: the stream's own UO, or a transfer's destination (also for a stream that is gone, when known). */
  uo?: UnitOperation;
  /** UO code from the row's Stream ID, when the UO itself is not known any more. */
  uoCode?: string;
  material?: Material;
}

/** Every applied MB row with its status against the current PFD and material list. */
export function appliedRows(p: Pick<Project, "mb" | "streams" | "uos" | "materials">): AppliedRow[] {
  const cur = p.mb.current;
  if (!cur) return [];
  const uoById = new Map(p.uos.map((u) => [u.id, u]));
  const matByCode = new Map(p.materials.map((m) => [m.code, m]));
  // The newest retirement of an ID says where a stream that is gone used to be.
  const retired = new Map<string, (typeof p.streams.retired)[number]>();
  for (const r of p.streams.retired) retired.set(r.streamId, r);
  return cur.rows.map((row): AppliedRow => {
    const owner = p.streams.active[row.streamId] ?? retired.get(row.streamId);
    const uoId = owner ? (owner.kind === "pfd" ? owner.uoId : owner.toUoId) : undefined;
    const uo = uoId ? uoById.get(uoId) : undefined;
    const base = { row, uo, uoCode: uo?.code ?? bomUoCodeOf(row.streamId) ?? undefined };
    if (!p.streams.active[row.streamId]) return { ...base, status: "stream-gone" };
    if (!row.matCode) return { ...base, status: "ok" };
    const material = matByCode.get(row.matCode);
    if (!material) return { ...base, status: "unknown-material" };
    if (material.unit.trim().toLowerCase() !== row.unit.trim().toLowerCase()) return { ...base, material, status: "unit-mismatch" };
    return { ...base, material, status: "ok" };
  });
}

const valuesText = (p: Pick<Project, "mb">, r: MbRow) =>
  p.mb.scenarios.filter((s) => r.values[s.id] != null).map((s) => `${s.name} ${fmtQty(r.values[s.id])}`).join(" · ") + ` ${r.unit}`;

/** Why an applied row does not count, in a sentence. */
export function whyNotCounted(p: Pick<Project, "mb">, a: AppliedRow): string {
  const what = a.row.matCode ? `${a.row.matCode} from ${a.row.streamId} (${valuesText(p, a.row)})` : `${a.row.streamId} (${valuesText(p, a.row)})`;
  switch (a.status) {
    case "stream-gone": return `${what} is not counted: ${a.row.streamId} is no longer on the PFD.`;
    case "unknown-material": return `${what} is not counted: ${a.row.matCode} is not in the material list.`;
    case "unit-mismatch": return `${what} is not counted: the MB gives ${a.row.unit}, but ${a.material!.code} is counted in ${a.material!.unit}.`;
    default: return "";
  }
}

/** True when the project's MB workbook is not the one whose values are applied. */
export function workbookNotApplied(p: Pick<Project, "mb">): boolean {
  const wb = p.mb.workbook;
  return !!wb && p.mb.current?.sha256 !== wb.sha256;
}

export type Area = "pfd" | "operations" | "mb" | "bom" | "materials";

export interface LinkFinding {
  id: string;
  level: "warn" | "info";
  /** Screen where it is fixed. */
  area: Area;
  title: string;
  /** One line per item (stream, material …). */
  items: { text: string; streamId?: string }[];
  /** What to do, in a sentence. */
  fix: string;
}

/** Everything that does not line up between the PFD, the Mass Balance, the BOM and the material list. */
export function linkCheck(p: Project): LinkFinding[] {
  const out: LinkFinding[] = [];
  const rows = appliedRows(p);
  const names = streamNames(p);
  const label = (id: string) => (names.get(id) ? `${id} · ${names.get(id)}` : id);

  if (workbookNotApplied(p)) {
    out.push({
      id: "not-applied", level: "warn", area: "mb",
      title: p.mb.current ? "The MB workbook changed after its values were applied" : "The MB workbook has not been applied yet",
      items: [{ text: `${p.mb.workbook!.name}, ${p.mb.workbook!.source === "gridcraft" ? "saved in GridCraft" : "uploaded"} ${p.mb.workbook!.updatedAt.slice(0, 16).replace("T", " ")}` }],
      fix: "PFD labels and the BOM still use the values applied before. Review the changes on Mass Balance and apply them.",
    });
  }

  const gone = rows.filter((r) => r.status === "stream-gone");
  if (gone.length) {
    out.push({
      id: "stream-gone", level: "warn", area: "pfd",
      title: `MB values for ${new Set(gone.map((g) => g.row.streamId)).size} stream(s) that are no longer on the PFD`,
      items: [...new Map(gone.map((g) => [g.row.streamId, g])).values()].map((g) => ({
        text: `${g.row.streamId}${g.uoCode ? ` (${g.uoCode})` : ""}: ${gone.filter((x) => x.row.streamId === g.row.streamId).map((x) => (x.row.matCode ? `${x.row.matCode} ${valuesText(p, x.row)}` : `flow ${valuesText(p, x.row)}`)).join("; ")}`,
      })),
      fix: "They are left out of the BOM and the labels. Draw the stream again (undo brings its ID back), or remove its rows from PCS_LINK and apply again.",
    });
  }

  const unit = rows.filter((r) => r.status === "unit-mismatch");
  if (unit.length) {
    out.push({
      id: "unit-mismatch", level: "warn", area: "materials",
      title: `${unit.length} MB material row(s) in a different unit than the material list`,
      items: unit.map((u) => ({ text: `${u.row.matCode} in ${u.row.streamId}: MB ${u.row.unit}, material list ${u.material!.unit}`, streamId: u.row.streamId })),
      fix: "They are left out of the BOM. Fix the unit in the material list or in PCS_LINK (then apply again).",
    });
  }

  const unknown = rows.filter((r) => r.status === "unknown-material");
  if (unknown.length) {
    out.push({
      id: "unknown-material", level: "warn", area: "materials",
      title: `${unknown.length} MB material row(s) with a code that is not in the material list`,
      items: unknown.map((u) => ({ text: `${u.row.matCode} in ${u.row.streamId}`, streamId: u.row.streamId })),
      fix: "They are left out of the BOM. Add the material (or fix its code) in the material list, or fix MatCode in PCS_LINK.",
    });
  }

  if (p.mb.current) {
    const withFlow = new Set(p.mb.current.rows.filter((r) => !r.matCode).map((r) => r.streamId));
    const missing = pfdStreamIds(p).filter((id) => !withFlow.has(id));
    if (missing.length) {
      out.push({
        id: "no-flow", level: "info", area: "mb",
        title: `${missing.length} PFD stream(s) without a value in the applied mass balance`,
        items: missing.map((id) => ({ text: label(id), streamId: id })),
        fix: "Their labels show the ID only. Add a flow row per stream to PCS_LINK (Mass Balance › Copy rows for the streams without values) and apply again.",
      });
    }
  }

  // The same material in a UO from the MB and from PFD links: the BOM counts one of them.
  const links = pfdLinksByCode(p);
  const both: string[] = [];
  for (const r of rows) {
    if (r.status !== "ok" || !r.row.matCode || !r.uo) continue;
    if (links.get(r.uo.code)?.has(r.row.matCode)) both.push(`${r.row.matCode} in ${r.uo.code}`);
  }
  if (both.length) {
    out.push({
      id: "double", level: "info", area: "bom",
      title: "Materials both in the MB and linked on the PFD",
      items: [...new Set(both)].map((t) => ({ text: t })),
      fix: "Each BOM line counts one source (MB by default); the other is shown under the line. Remove the PFD link or pick the source on the BOM screen.",
    });
  }
  // Recipes: loops cannot be exploded; a solution and its own chemicals both in the MB of one UO.
  const loops = recipeLoops(p.materials);
  if (loops.length) {
    out.push({
      id: "recipe-loop", level: "warn", area: "materials",
      title: `${loops.length} recipe loop(s): a prepared material is made of itself`,
      items: loops.map((l) => ({ text: l.join(" → ") })),
      fix: "The BOM cannot turn these into chemicals and leaves the looping part out. Fix the recipes on the Materials screen.",
    });
  }
  const byId = new Map(p.materials.map((m) => [m.id, m]));
  const twice: { text: string; streamId?: string }[] = [];
  const okRows = rows.filter((r) => r.status === "ok" && r.row.matCode && r.uo && r.material);
  for (const r of okRows) {
    if (!recipeOf(r.material)) continue;
    const parts = componentIds(r.material!, byId);
    for (const o of okRows) {
      if (o.row.streamId === r.row.streamId && parts.has(o.material!.id)) twice.push({ text: `${r.row.streamId} (${o.uoCode ?? o.uo!.code}): ${r.material!.code} and ${o.material!.code}, which is in its recipe`, streamId: o.row.streamId });
    }
  }
  if (twice.length) {
    out.push({
      id: "recipe-double", level: "info", area: "bom",
      title: "Streams whose MB rows list a solution and also one of its chemicals",
      items: [...new Map(twice.map((t) => [t.text, t])).values()],
      fix: "The BOM counts both. If the MB lists a solution and its chemicals, keep one of them (usually the solution, which the BOM turns into chemicals).",
    });
  }
  // Obsolete materials that something still uses (MB rows, PFD links, recipes, BOM lines).
  const obsolete = p.materials.filter((m) => m.status === "obsolete");
  if (obsolete.length) {
    const used: { text: string; streamId?: string }[] = [];
    for (const m of obsolete) {
      const where: string[] = [];
      const mbRows = rows.filter((r) => r.status === "ok" && r.row.matCode === m.code);
      if (mbRows.length) where.push(`MB ${[...new Set(mbRows.map((r) => r.row.streamId))].join(", ")}`);
      const inLinks = [...links.entries()].filter(([, byCode]) => byCode.has(m.code)).map(([uo]) => uo);
      if (inLinks.length) where.push(`PFD links in ${inLinks.join(", ")}`);
      const recipes = p.materials.filter((x) => x.status !== "obsolete" && x.recipe?.components.some((c) => c.materialId === m.id)).map((x) => x.code);
      if (recipes.length) where.push(`recipe of ${recipes.join(", ")}`);
      const lines = Object.entries(p.bom.lines).filter(([, ls]) => ls.some((l) => l.materialId === m.id && !l.excluded)).map(([uo]) => p.uos.find((u) => u.id === uo)?.code ?? "?");
      if (lines.length) where.push(`BOM lines in ${lines.join(", ")}`);
      if (where.length) used.push({ text: `${m.code} ${m.name}${m.replacedBy ? ` (replaced by ${byId.get(m.replacedBy)?.code ?? "?"})` : ""}: ${where.join("; ")}`, ...(mbRows[0] ? { streamId: mbRows[0].row.streamId } : {}) });
    }
    if (used.length) {
      out.push({
        id: "obsolete-in-use", level: "warn", area: "materials",
        title: `${used.length} obsolete material(s) still in use`,
        items: used,
        fix: "Replace each with the material that takes its place (Materials › Replace…: the BOM, recipes, PFD links and the MB workbook follow), or set it back to In use.",
      });
    }
  }
  out.push(...operationFindings(p));
  return out;
}

/** Operations: a tag on two PFD shapes (a copy kept it), steps that name a stream their unit operation does not have. */
export function operationFindings(p: Project): LinkFinding[] {
  const out: LinkFinding[] = [];
  const codeOf = (scope: string) => (scope === "map" ? "process map" : p.uos.find((u) => u.id === scope)?.code ?? "?");
  const shapes = equipmentShapes(p.pfd);
  const twice = p.equipment.filter((e) => (shapes.get(e.id)?.length ?? 0) > 1);
  if (twice.length) {
    out.push({
      id: "tag-twice", level: "warn", area: "pfd",
      title: `${twice.length} equipment tag(s) on more than one PFD shape`,
      items: twice.map((e) => ({ text: `${e.tag}: ${shapes.get(e.id)!.length} shapes (${[...new Set(shapes.get(e.id)!.map((s) => codeOf(s.scope)))].join(", ")})` })),
      fix: "A copied shape keeps the tag of the one it was copied from. Select the copy on the PFD and give it its own tag (Equipment tag, in the panel).",
    });
  }
  const odd: { text: string }[] = [];
  for (const u of p.uos) {
    const known = new Set(uoStreams(p, u.id).map((s) => s.id));
    (p.operations[u.id] ?? []).forEach((s, i) => {
      const bad = (s.streams ?? []).filter((x) => !known.has(x));
      if (bad.length) odd.push({ text: `${u.code} step ${i + 1} ${s.name}: ${bad.join(", ")}` });
    });
  }
  if (odd.length) {
    out.push({
      id: "step-stream", level: "warn", area: "operations",
      title: `${odd.length} step(s) name a stream that is not in their unit operation`,
      items: odd,
      fix: "The stream was deleted, or belongs to another unit operation. Pick the streams of the step again on Operations, or draw the stream again on the PFD (undo brings its ID back).",
    });
  }
  return out;
}

export const findingCount = (list: readonly LinkFinding[]) => list.filter((f) => f.level === "warn").length;
