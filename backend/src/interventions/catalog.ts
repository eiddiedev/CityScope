import type { WorldState } from "../domain.js";

export const INTERVENTION_CATALOG_VERSION = "cityscope.interventions.v2" as const;

export interface InterventionDefinition {
  path: string;
  label: string;
  unit: "score" | "million_cny";
  min: number;
  max: number;
  step: number;
  baseline: number;
  sensitiveRange: { min: number; max: number };
  redlineRanges: Array<{ min: number; max: number; label: string }>;
}

export const interventionCatalog: InterventionDefinition[] = [
  score("stakeholders.publicTrust", "项目初始公众信任", 70, 35, 75, [{ min: 0, max: 25, label: "公共信任红线" }]),
  score("stakeholders.talentAttraction", "研发人才吸引力", 62, 72, 92, [{ min: 90, max: 100, label: "成都显著优势区" }]),
  score("stakeholders.supplyChainReadiness", "本地供应链准备度", 60, 72, 92, [{ min: 90, max: 100, label: "重庆显著优势区" }]),
  score("metrics.financingConfidence", "外部融资信心", 66, 20, 55, [{ min: 0, max: 15, label: "融资退出红线" }]),
  score("metrics.projectViability", "项目初始可执行性", 76, 25, 60, [{ min: 0, max: 20, label: "执行退出红线" }]),
  { path: "company.investmentPlanMillionCny", label: "企业一期投资规模", unit: "million_cny", min: 1_000, max: 4_000, step: 100, baseline: 3_000, sensitiveRange: { min: 1_600, max: 2_600 }, redlineRanges: [{ min: 3_600, max: 4_000, label: "流动性高压区" }] },
];

export function interventionDefinition(path: string): InterventionDefinition | undefined {
  return interventionCatalog.find((item) => item.path === path);
}

export function interventionCatalogForState(state: WorldState): { catalogVersion: typeof INTERVENTION_CATALOG_VERSION; scenarioId: string; interventions: InterventionDefinition[] } {
  return {
    catalogVersion: INTERVENTION_CATALOG_VERSION,
    scenarioId: state.scenarioId,
    interventions: interventionCatalog.map((item) => ({ ...item, baseline: numberAtPath(state, item.path) })),
  };
}

function score(path: string, label: string, baseline: number, sensitiveMin: number, sensitiveMax: number, redlineRanges: InterventionDefinition["redlineRanges"]): InterventionDefinition {
  return { path, label, unit: "score", min: 0, max: 100, step: 1, baseline, sensitiveRange: { min: sensitiveMin, max: sensitiveMax }, redlineRanges };
}

function numberAtPath(state: WorldState, path: string): number {
  let current: unknown = state;
  for (const segment of path.split(".")) current = (current as Record<string, unknown>)[segment];
  if (typeof current !== "number") throw new Error(`intervention path ${path} is not numeric`);
  return current;
}
