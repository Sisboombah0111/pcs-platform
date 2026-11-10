import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { computeBom, setLine } from "../src/bom/model";
import { addRevision, compareBom, deleteRevision, latestRevision, makeRevision, nextLabel, snapshotBom } from "../src/bom/revisions";
import { parseProject, serializeProject } from "../src/model/project";
import { usageCounts, whereUsed } from "../src/model/whereUsed";
import type { Project } from "../src/model/types";

const load = (): Project => parseProject(readFileSync(join(__dirname, "../examples/example-downstream.pcs.json"), "utf8")).project;
const row = (p: Project, uo: string, code: string) => computeBom(p).uos.find((u) => u.uo.code === uo)!.rows.find((r) => r.material.code === code)!;
const now = (p: Project) => ({ label: "Now", ...snapshotBom(computeBom(p)) });

describe("BOM revisions", () => {
  it("a revision keeps the counted lines and the totals by code; labels go Rev A, Rev B …", () => {
    let p = load();
    const r = makeRevision(p, computeBom(p), { note: "Sent to purchasing", by: "Kim", now: "2026-11-04T01:00:00Z" });
    expect([r.label, r.note, r.createdBy, r.mbFile, r.lines.length]).toEqual(["Rev A", "Sent to purchasing", "Kim", "MB_downstream.xlsx", 42]);
    expect(r.lines.find((l) => l.uo === "PROA" && l.code === "BUF-1001-B")).toMatchObject({ unit: "L", source: "MB", qty: { sending: 1980, receiving: 0 }, batches: { sending: 10, receiving: 0 } });
    expect(r.totals.find((t) => t.code === "CON-0004")).toMatchObject({ kind: "buy", qty: { sending: 10, receiving: 0 } });
    expect(r.totals.find((t) => t.code === "BUF-1001")!.kind).toBe("prep");
    p = addRevision(p, r);
    expect(nextLabel(p.bom.revisions!)).toBe("Rev B");
    expect(nextLabel(Array.from({ length: 26 }, (_, i) => ({ ...r, label: `x${i}` })))).toBe("Rev AA");
    // Saved with the project; BOM edits keep the revisions.
    const back = parseProject(serializeProject(p)).project;
    expect(back.bom.revisions).toEqual(p.bom.revisions);
    const edited = setLine(back, row(back, "PROA", "BUF-1002"), { overagePct: 10 });
    expect(edited.bom.revisions).toHaveLength(1);
    expect(latestRevision(edited)!.label).toBe("Rev A");
    expect(deleteRevision(edited, r.id).bom.revisions).toBeUndefined();
  });

  it("compare: nothing changed, then an overage, a removed line and a manual line", () => {
    let p = load();
    const a = makeRevision(p, computeBom(p), { now: "2026-11-04T01:00:00Z" });
    expect(compareBom(a, now(p)).count).toEqual({ added: 0, removed: 0, replaced: 0, changed: 0 });
    // + 10 % on the PROA wash buffer, the CEX strip not counted, a hand-entered line in STOR.
    p = setLine(p, row(p, "PROA", "BUF-1002"), { overagePct: 10 });
    p = setLine(p, row(p, "CEX", "BUF-2003"), { excluded: true });
    const stor = p.uos.find((u) => u.code === "STOR")!.id;
    const logger = p.materials.find((m) => m.code === "CON-0003")!.id;
    p = { ...p, bom: { ...p.bom, lines: { ...p.bom.lines, [stor]: [...(p.bom.lines[stor] ?? []).filter((l) => l.materialId !== "x"), ...(p.bom.lines[stor]?.some((l) => l.materialId === logger) ? [] : [{ materialId: logger, qtySource: "manual" as const, manualQty: { sending: 2, receiving: 2 }, note: "spare" }])] } } };
    const c = compareBom(a, now(p));
    const lines = c.lines.filter((x) => x.kind !== "same").map((x) => [x.kind, x.uo, x.code]);
    expect(lines).toContainEqual(["removed", "CEX", "BUF-2003"]);
    expect(lines).toContainEqual(["changed", "PROA", "BUF-1002"]);
    const wash = c.lines.find((x) => x.uo === "PROA" && x.code === "BUF-1002")!;
    expect([wash.before, wash.after, wash.delta]).toEqual([{ sending: 900, receiving: 6600 }, { sending: 990, receiving: 7260 }, { sending: 90, receiving: 660 }]);
    // Totals follow: NaCl from BUF-1002 up 10 %, and from BUF-2003 gone.
    const nacl = c.totals.find((x) => x.code === "CHM-0002")!;
    expect(nacl.kind).toBe("changed");
    expect(c.totals.find((x) => x.code === "BUF-2003")!.kind).toBe("removed");
    expect([c.from, c.to]).toEqual(["Rev A", "Now"]);
  });
});

describe("revisions after a code change", () => {
  it("a material whose code changed reads as changed (code A → B), not removed + added", () => {
    let p = load();
    const a = makeRevision(p, computeBom(p), { now: "2026-11-04T01:00:00Z" });
    // The code changes in the material list and in the applied MB rows (as Materials › code change does).
    p = { ...p, materials: p.materials.map((m) => (m.code === "BUF-1002" ? { ...m, code: "BUF-1002A" } : m)),
      mb: { ...p.mb, current: { ...p.mb.current!, rows: p.mb.current!.rows.map((r) => (r.matCode === "BUF-1002" ? { ...r, matCode: "BUF-1002A" } : r)) } } };
    const c = compareBom(a, now(p));
    const x = c.lines.find((l) => l.uo === "PROA" && l.code === "BUF-1002A")!;
    expect([x.kind, x.notes]).toEqual(["changed", ["code BUF-1002 → BUF-1002A"]]);
    expect(c.lines.some((l) => l.kind === "removed" || l.kind === "added")).toBe(false);
    // An older revision without ids still compares by code.
    const old = { ...a, lines: a.lines.map(({ mid, uoId, ...l }) => (void mid, void uoId, l)), totals: a.totals.map(({ mid, ...t }) => (void mid, t)) };
    const c2 = compareBom(old, now(p));
    expect(c2.lines.filter((l) => l.kind !== "same").map((l) => [l.kind, l.code]).sort()).toEqual([["added", "BUF-1002A"], ["removed", "BUF-1002"]]);
  });
});

describe("where used", () => {
  it("a buffer bag: BOM through a recipe, the recipe, no MB rows of its own", () => {
    const p = load();
    const w = whereUsed(p, p.materials.find((m) => m.code === "CON-0004")!.id, computeBom(p))!;
    expect(w.bomLines).toEqual([]);
    expect(w.bomParts).toEqual([{ uo: "PROA", parent: "BUF-1001-B", via: "BUF-1001-B", qty: { sending: 10, receiving: 0 } }]);
    expect(w.inRecipes).toEqual([{ code: "BUF-1001-B", name: "ProA equilibration buffer, filled in 200 L bags", qty: 1, per: 1000, perBatch: true, unit: "L" }]);
    expect(w.count).toBe(2);
  });

  it("sodium chloride: in recipes, through recipes on the BOM, with a backup", () => {
    const p = load();
    const w = whereUsed(p, p.materials.find((m) => m.code === "CHM-0002")!.id, computeBom(p))!;
    expect(w.inRecipes.map((r) => r.code)).toEqual(["BUF-1001", "BUF-1002", "BUF-2002", "BUF-2003", "BUF-3001"]);
    expect(new Set(w.bomParts.map((x) => x.uo))).toEqual(new Set(["PROA", "CEX", "MMC", "VF"]));
    expect(w.backups).toEqual([{ code: "CHM-0102", name: "Sodium chloride (supplier B)", ratio: 1 }]);
  });

  it("a filter: MB rows and PFD links, each with where to go", () => {
    const p = load();
    const flt1 = whereUsed(p, p.materials.find((m) => m.code === "FLT-0001")!.id, computeBom(p))!;
    expect(flt1.mbRows).toEqual([{ streamId: "ST-PROA-010", uo: "PROA", values: { sending: 3, receiving: 18 }, unit: "EA", counted: true }]);
    expect(flt1.bomLines.map((l) => [l.uo, l.source])).toEqual([["PROA", "MB"]]);
    const flt2 = whereUsed(p, p.materials.find((m) => m.code === "FLT-0002")!.id, computeBom(p))!;
    expect(flt2.pfdLinks.length).toBeGreaterThan(0);
    expect(flt2.pfdLinks.every((l) => l.elementId && l.scope)).toBe(true);
  });

  it("the Used count of each material is the number of places Where used lists", () => {
    const p = load();
    const bom = computeBom(p);
    const counts = usageCounts(p, bom);
    for (const m of p.materials) expect([m.code, counts.get(m.id) ?? 0]).toEqual([m.code, whereUsed(p, m.id, bom)!.count]);
  });
});
