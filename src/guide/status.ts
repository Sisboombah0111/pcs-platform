/**
 * Where a project is on the way from an empty project to a linked PFD, Mass Balance and BOM: the seven
 * steps of the in-app guide, each done / to do / to check, with what was found. Pure: no React.
 *
 *   1 materials   2 process map   3 unit operation drawings   4 MB workbook (PCS_LINK)
 *   5 apply       6 BOM           7 keep it linked (link check)
 */
import type { BomResult } from "../bom/model";
import { workbookNotApplied, type LinkFinding } from "../link/check";
import { usesBatches, recipeOf } from "../model/recipes";
import type { Project } from "../model/types";
import { uosOnMap } from "../pfd/sync";

export type StepId = "materials" | "map" | "drawings" | "workbook" | "apply" | "bom" | "linked";
/** done: nothing to do now · todo: not started · check: started, something needs attention · wait: needs an earlier step. */
export type StepState = "done" | "todo" | "check" | "wait";
export interface Bilingual { en: string; ko: string }
export interface StepStatus { id: StepId; state: StepState; found: Bilingual }

export const STEP_ORDER: StepId[] = ["materials", "map", "drawings", "workbook", "apply", "bom", "linked"];

const n = (k: number, en: string, enMany = en + "s") => `${k} ${k === 1 ? en : enMany}`;

export function guideStatus(p: Project, findings: readonly LinkFinding[], bom: BomResult | null): StepStatus[] {
  const out: StepStatus[] = [];
  const add = (id: StepId, state: StepState, en: string, ko: string) => out.push({ id, state, found: { en, ko } });

  // 1. Materials: codes and units are what the MB and the PFD links point at.
  const mats = p.materials.length;
  const recipes = p.materials.filter((m) => recipeOf(m)).length;
  const batched = p.materials.filter((m) => usesBatches(recipeOf(m))).length;
  const dup = mats - new Set(p.materials.map((m) => m.code.trim())).size;
  const obsoleteUsed = findings.find((f) => f.id === "obsolete-in-use")?.items.length ?? 0;
  if (!mats) add("materials", "todo", "No materials yet.", "아직 자재가 없습니다.");
  else if (obsoleteUsed) add("materials", "check", `${n(mats, "material")}; ${n(obsoleteUsed, "obsolete material")} still in use: replace them.`, `자재 ${mats}개; 단종 자재 ${obsoleteUsed}개가 아직 쓰입니다. 교체하세요.`);
  else if (dup) add("materials", "check", `${n(mats, "material")}; ${n(dup, "code")} used twice.`, `자재 ${mats}개, 중복 코드 ${dup}개.`);
  else add("materials", "done",
    `${n(mats, "material")}${recipes ? `, ${recipes} with a recipe${batched ? ` (${batched} in batches)` : ""}` : ""}.`,
    `자재 ${mats}개${recipes ? `, 레시피 ${recipes}개${batched ? `(배치 ${batched}개)` : ""}` : ""}.`);

  // 2. Process map: unit operation boxes and the transfers between them.
  const onMap = uosOnMap(p.pfd);
  const boxes = p.uos.filter((u) => onMap.has(u.id));
  const transfers = Object.values(p.streams.active).filter((s) => s.kind === "transfer").length;
  if (!boxes.length) add("map", "todo", "No unit operation boxes on the process map yet.", "공정 맵에 단위공정 상자가 아직 없습니다.");
  else if (boxes.length > 1 && !transfers) add("map", "check", `${n(boxes.length, "unit operation")}, no transfer arrows between them yet.`, `단위공정 ${boxes.length}개, 상자 사이 이송 화살표가 아직 없습니다.`);
  else add("map", "done", `${n(boxes.length, "unit operation")}, ${n(transfers, "transfer")}.`, `단위공정 ${boxes.length}개, 이송 ${transfers}개.`);

  // 3. Drawings: streams inside each unit operation.
  const inside = new Map<string, number>();
  for (const s of Object.values(p.streams.active)) if (s.kind === "pfd" && s.uoId) inside.set(s.uoId, (inside.get(s.uoId) ?? 0) + 1);
  const total = [...inside.values()].reduce((a, b) => a + b, 0);
  // A unit operation with transfers but no arrows inside (a storage step) is fine; one with neither is not drawn yet.
  const withTransfer = new Set<string>();
  for (const s of Object.values(p.streams.active)) if (s.kind === "transfer") { if (s.fromUoId) withTransfer.add(s.fromUoId); if (s.toUoId) withTransfer.add(s.toUoId); }
  const bare = boxes.filter((u) => !inside.get(u.id));
  const empty = bare.filter((u) => !withTransfer.has(u.id)).map((u) => u.code);
  const transfersOnly = bare.filter((u) => withTransfer.has(u.id)).map((u) => u.code);
  const only = transfersOnly.length ? { en: ` (${transfersOnly.join(", ")}: transfers only)`, ko: ` (${transfersOnly.join(", ")}: 이송만)` } : { en: "", ko: "" };
  if (!boxes.length) add("drawings", "wait", "Needs unit operations (step 2).", "2단계(단위공정)가 먼저 필요합니다.");
  else if (!total) add("drawings", "todo", "No stream arrows inside the unit operations yet.", "단위공정 안에 스트림 화살표가 아직 없습니다.");
  else if (empty.length) add("drawings", "check", `${n(total, "stream")}; nothing drawn yet in ${empty.join(", ")}.`, `스트림 ${total}개; ${empty.join(", ")}은(는) 아직 비어 있습니다.`);
  else add("drawings", "done", `${n(total, "stream")} in ${n(boxes.length, "unit operation")}${only.en}.`, `단위공정 ${boxes.length}개에 스트림 ${total}개${only.ko}.`);

  // 4. The MB workbook with its PCS_LINK sheet.
  const wb = p.mb.workbook;
  if (wb) add("workbook", "done", `${wb.name}`, `${wb.name}`);
  else if (!total) add("workbook", "wait", "Needs Stream IDs (step 3).", "3단계(Stream ID)가 먼저 필요합니다.");
  else add("workbook", "todo", "No MB workbook in the project yet.", "프로젝트에 MB 워크북이 아직 없습니다.");

  // 5. Apply: values go to the PFD labels and the BOM only when applied.
  if (!wb) add("apply", p.mb.current ? "check" : "wait", p.mb.current ? "Values applied, but the workbook was removed." : "Needs a workbook (step 4).", p.mb.current ? "값은 적용됐지만 워크북이 없습니다." : "4단계(워크북)가 먼저 필요합니다.");
  else if (!p.mb.current) add("apply", "todo", "The workbook is not applied yet.", "워크북을 아직 적용하지 않았습니다.");
  else if (workbookNotApplied(p)) add("apply", "check", "The workbook changed after its values were applied.", "적용한 뒤 워크북이 바뀌었습니다. 다시 적용하세요.");
  else add("apply", "done", `${n(p.mb.current.rows.length, "row")} applied.`, `${p.mb.current.rows.length}행 적용됨.`);

  // 6. The BOM.
  const lines = bom ? bom.uos.reduce((k, u) => k + u.rows.length, 0) : 0;
  if (!bom || !lines) add("bom", p.mb.current || p.materials.length ? "todo" : "wait", "No BOM lines yet.", "BOM 줄이 아직 없습니다.");
  else if (bom.issueCount) add("bom", "check", `${n(lines, "line")}, ${bom.issueCount} to check.`, `${lines}줄, 확인할 것 ${bom.issueCount}개.`);
  else add("bom", "done", `${n(lines, "line")}, complete.`, `${lines}줄, 완료.`);

  // 7. The link check, all the time.
  const warn = findings.filter((f) => f.level === "warn").length;
  const notes = findings.length - warn;
  if (!p.mb.current && !total) add("linked", "wait", "Nothing to check yet.", "아직 점검할 것이 없습니다.");
  else if (warn) add("linked", "check", `${n(warn, "thing")} to fix.`, `고칠 것 ${warn}개.`);
  else add("linked", "done", notes ? `Linked, ${n(notes, "note")}.` : "Linked.", notes ? `연동됨, 참고 ${notes}개.` : "연동됨.");
  return out;
}

/** The step to work on now: the first one not done (or null when all are done). */
export const nextStep = (s: readonly StepStatus[]) => s.find((x) => x.state !== "done")?.id ?? null;
