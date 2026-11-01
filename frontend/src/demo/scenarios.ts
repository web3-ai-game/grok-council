import s01 from "../../../demo/scenarios/01-key-boundary.json";
import s02 from "../../../demo/scenarios/02-visible-council.json";
import s03 from "../../../demo/scenarios/03-sqlite-ceiling.json";
import s04 from "../../../demo/scenarios/04-gate-refuse.json";
import s05 from "../../../demo/scenarios/05-review-delta.json";
import s06 from "../../../demo/scenarios/06-public-sandbox.json";
import s07 from "../../../demo/scenarios/07-latency-bill.json";
import s08 from "../../../demo/scenarios/08-chair-bound.json";
import s09 from "../../../demo/scenarios/09-locale-contract.json";
import s10 from "../../../demo/scenarios/10-seat-failure.json";
import type { ScenarioFile } from "./types";

export const SCENARIOS: ScenarioFile[] = [
  s01 as ScenarioFile,
  s02 as ScenarioFile,
  s03 as ScenarioFile,
  s04 as ScenarioFile,
  s05 as ScenarioFile,
  s06 as ScenarioFile,
  s07 as ScenarioFile,
  s08 as ScenarioFile,
  s09 as ScenarioFile,
  s10 as ScenarioFile,
];

export function scenarioById(id: string): ScenarioFile {
  return SCENARIOS.find((item) => item.id === id) ?? SCENARIOS[0]!;
}
