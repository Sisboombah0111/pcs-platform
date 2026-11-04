/**
 * Scenarios: the value columns of PCS_LINK (Sending and Receiving to start with). The team can add more
 * (e.g. a 500 L clinical batch), rename them, or point them to another column; a scenario's values live
 * under its id, so a rename keeps them.
 */
import { newId } from "../model/ids";
import type { Project, Scenario } from "../model/types";

const RESERVED = ["streamid", "matcode", "unit", "note"];
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/** Problems with a scenario list (empty when it can be used). */
export function scenarioProblems(list: readonly Pick<Scenario, "name" | "column">[]): string[] {
  const out: string[] = [];
  if (!list.length) out.push("Keep at least one scenario.");
  const names = new Map<string, number>(), cols = new Map<string, number>();
  list.forEach((s, i) => {
    const n = i + 1;
    if (!s.name.trim()) out.push(`Scenario ${n} has no name.`);
    if (!s.column.trim()) out.push(`Scenario ${n} has no PCS_LINK column.`);
    else if (RESERVED.includes(norm(s.column).replace(/\s/g, ""))) out.push(`“${s.column}” is a fixed PCS_LINK column; use another name for scenario ${n}.`);
    if (s.name.trim()) { if (names.has(norm(s.name))) out.push(`Two scenarios are called “${s.name.trim()}”.`); names.set(norm(s.name), n); }
    if (s.column.trim()) { if (cols.has(norm(s.column))) out.push(`Two scenarios read the column “${s.column.trim()}”.`); cols.set(norm(s.column), n); }
  });
  return out;
}

/** A new scenario row (id made here, so its values never mix with another's). */
export const newScenario = (name = "", column = name): Scenario => ({ id: newId("scn"), name, column });

/** Use a scenario list: names and columns trimmed; the active scenario falls back to the first when it is gone. */
export function setScenarios<P extends Pick<Project, "mb">>(p: P, list: readonly Scenario[]): P {
  const scenarios = list.map((s) => ({ id: s.id, name: s.name.trim(), column: s.column.trim() }));
  const activeScenario = scenarios.some((s) => s.id === p.mb.activeScenario) ? p.mb.activeScenario : scenarios[0].id;
  return { ...p, mb: { ...p.mb, scenarios, activeScenario } };
}

/** Short names for PFD labels: the first letter, or more letters when two scenarios start alike. */
export function shortNames(list: readonly Pick<Scenario, "id" | "name">[]): Map<string, string> {
  const out = new Map<string, string>();
  for (let len = 1; len <= 12; len++) {
    const short = list.map((s) => s.name.trim().slice(0, len));
    const clash = short.some((x, i) => short.indexOf(x) !== i);
    if (!clash || len === 12) { list.forEach((s, i) => out.set(s.id, short[i].charAt(0).toUpperCase() + short[i].slice(1))); return out; }
  }
  return out;
}
