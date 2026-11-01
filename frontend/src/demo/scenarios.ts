import keyBoundary from "../../../demo/scenarios/key-boundary.json";
import sqliteCeiling from "../../../demo/scenarios/sqlite-ceiling.json";
import visibleCouncil from "../../../demo/scenarios/visible-council.json";
import type { ScenarioFile } from "./types";

export const SCENARIOS: ScenarioFile[] = [
  keyBoundary as ScenarioFile,
  visibleCouncil as ScenarioFile,
  sqliteCeiling as ScenarioFile,
];

export function scenarioById(id: string): ScenarioFile {
  return SCENARIOS.find((item) => item.id === id) ?? SCENARIOS[0]!;
}
