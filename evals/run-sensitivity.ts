import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Outcome, WorldState } from "../backend/src/domain.js";
import { evaluateScenario } from "../backend/src/evaluation/scenario-evaluator.js";
import { continueAutonomously } from "../backend/src/orchestrator/autonomous.js";
import { SimulationEngine } from "../backend/src/orchestrator/engine.js";
import { StubProvider } from "../backend/src/providers/stub-provider.js";
import { createCheckpoint, forkFromCheckpoint } from "../backend/src/trace/checkpoint.js";
import { classifyAndAttachOutcome } from "../backend/src/world/outcome.js";
import { createInitialState } from "../backend/src/world/initial-state.js";

const variables = [
  { path: "stakeholders.talentAttraction", values: [15, 25, 35, 45, 55, 75, 85, 95, 100] },
  { path: "stakeholders.supplyChainReadiness", values: [10, 20, 30, 40, 50, 70, 80, 90, 100] },
  { path: "metrics.financingConfidence", values: [0, 5, 10, 15, 20, 30, 50, 70, 90] },
  { path: "metrics.projectViability", values: [5, 15, 25, 35, 45, 55, 70, 85, 95] },
  { path: "company.investmentPlanMillionCny", values: [1000, 1300, 1600, 1900, 2200, 2500, 2800, 3400, 4000] },
  { path: "stakeholders.publicTrust", values: [5, 15, 25, 35, 45, 55, 65, 85, 95] },
] as const;

const seedCount = Number(process.env.CITYSCOPE_SENSITIVITY_SEEDS ?? 20);
const seeds = Array.from({ length: seedCount }, (_, index) => 20_260_800 + index);
const engine = new SimulationEngine(new StubProvider());
const baseBySeed = new Map<number, WorldState>();
const baselineOutcomeBySeed = new Map<number, Outcome["label"] | "UNRESOLVED">();
for (const seed of seeds) {
  const initial = createInitialState(`sensitivity_base_${seed}`, seed, "autonomous");
  const continuation = await continueAutonomously(engine, initial, { stopAfterPhase: "due_diligence", terminateAtComplete: false });
  baseBySeed.set(seed, continuation.state);
  try {
    const baseline = await continueAutonomously(engine, structuredClone(continuation.state));
    baselineOutcomeBySeed.set(seed, evaluateScenario(classifyAndAttachOutcome(baseline.state)).outcome);
  } catch {
    baselineOutcomeBySeed.set(seed, "UNRESOLVED");
  }
}

const rows: Array<{ variable: string; value: number; seed: number; outcome: Outcome["label"] | "UNRESOLVED"; valid: boolean; fitness: number; error?: string }> = [];
for (const variable of variables) {
  for (const value of variable.values) {
    for (const seed of seeds) {
      const base = baseBySeed.get(seed)!;
      try {
        const checkpoint = createCheckpoint(base, `sensitivity_checkpoint_${seed}`);
        const previousValue = readNumber(base, variable.path);
        const nextValue = value === previousValue ? value + 0.001 : value;
        const fork = forkFromCheckpoint(checkpoint, `sensitivity_${variable.path}_${value}_${seed}`, {
          interventionId: `sensitivity_${variable.path}_${value}_${seed}`,
          path: variable.path,
          previousValue,
          newValue: nextValue,
          reason: "离线敏感性评测",
        });
        const continuation = await continueAutonomously(engine, fork);
        const state = classifyAndAttachOutcome(continuation.state);
        const evaluation = evaluateScenario(state);
        rows.push({ variable: variable.path, value, seed, outcome: evaluation.outcome, valid: evaluation.valid, fitness: evaluation.fitness });
      } catch (error) {
        rows.push({ variable: variable.path, value, seed, outcome: "UNRESOLVED", valid: false, fitness: 0, error: error instanceof Error ? error.message : String(error) });
      }
    }
  }
}

const distribution = Object.fromEntries(variables.map((variable) => [variable.path, Object.fromEntries(variable.values.map((value) => {
  const matching = rows.filter((row) => row.variable === variable.path && row.value === value);
  return [value, counts(matching.map((row) => row.outcome))];
}))]));
const reachable = new Set(rows.map((row) => row.outcome).filter((item): item is Outcome["label"] => item !== "UNRESOLVED"));
const variablesChangingOutcome = variables.filter((variable) => new Set(rows.filter((row) => row.variable === variable.path).map((row) => row.outcome)).size > 1).map((item) => item.path);
const pairedChangeRates = Object.fromEntries(variables.map((variable) => [variable.path, Object.fromEntries(variable.values.map((value) => {
  const matching = rows.filter((row) => row.variable === variable.path && row.value === value);
  const changed = matching.filter((row) => row.outcome !== baselineOutcomeBySeed.get(row.seed)).length;
  return [value, matching.length === 0 ? 0 : changed / matching.length];
}))]));
const sensitiveVariables = variables.filter((variable) => Math.max(...Object.values(pairedChangeRates[variable.path] ?? {})) >= 0.3).map((item) => item.path);
const defaultDistribution = counts([...baselineOutcomeBySeed.values()]);
const defaultResolved = Object.entries(defaultDistribution).filter(([label]) => label !== "UNRESOLVED");
const defaultMaxShare = Math.max(0, ...defaultResolved.map(([, count]) => count / seeds.length));
const defaultDualShare = (defaultDistribution.DUAL_CITY ?? 0) / seeds.length;
const defaultOtherMaxShare = Math.max(0, ...defaultResolved.filter(([label]) => label !== "DUAL_CITY").map(([, count]) => count / seeds.length));
const lowFinanceRows = rows.filter((row) => row.variable === "metrics.financingConfidence" && row.value <= 20);
const highTalentRows = rows.filter((row) => row.variable === "stakeholders.talentAttraction" && row.value >= 85);
const highSupplyRows = rows.filter((row) => row.variable === "stakeholders.supplyChainReadiness" && row.value >= 90);
const report = {
  evaluationVersion: "cityscope.sensitivity.v2",
  generatedAt: new Date().toISOString(),
  runCount: rows.length,
  seedCount,
  variables: variables.map((item) => item.path),
  reachableOutcomes: [...reachable].sort(),
  variablesChangingOutcome,
  sensitiveVariables,
  defaultDistribution,
  defaultMaxShare,
  pairedChangeRates,
  validRate: rows.filter((row) => row.valid).length / rows.length,
  unresolvedCount: rows.filter((row) => row.outcome === "UNRESOLVED").length,
  acceptance: {
    allFourOutcomesReachable: reachable.size === 4,
    atLeastThreeCausalVariables: variablesChangingOutcome.length >= 3,
    sensitivePairRateAtLeastThirtyPercent: sensitiveVariables.length >= 3,
    defaultIsDiverse: defaultMaxShare <= 0.85,
    defaultDualIsMostLikelyButNotFixed: defaultDualShare > defaultOtherMaxShare && defaultDualShare < 1,
    lowFinancingRaisesExit: share(lowFinanceRows, "PROJECT_EXITED") >= 0.5,
    highTalentRaisesChengdu: share(highTalentRows, "CHENGDU_LED") >= 0.5,
    highSupplyRaisesChongqing: share(highSupplyRows, "CHONGQING_LED") >= 0.5,
    allRunsResolved: rows.every((row) => row.outcome !== "UNRESOLVED"),
  },
  distribution,
  failures: rows.filter((row) => row.error).slice(0, 100),
};

const outputDir = resolve(process.cwd(), "fixtures/generated");
await mkdir(outputDir, { recursive: true });
await writeFile(resolve(outputDir, "sensitivity-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report, null, 2));

function readNumber(state: WorldState, path: string): number {
  let current: unknown = state;
  for (const segment of path.split(".")) current = (current as Record<string, unknown>)[segment];
  if (typeof current !== "number") throw new Error(`${path} is not numeric`);
  return current;
}

function counts(outcomes: Array<Outcome["label"] | "UNRESOLVED">): Record<string, number> {
  return outcomes.reduce<Record<string, number>>((result, outcome) => ({ ...result, [outcome]: (result[outcome] ?? 0) + 1 }), {});
}

function share(rows: Array<{ outcome: Outcome["label"] | "UNRESOLVED" }>, label: Outcome["label"]): number {
  return rows.length === 0 ? 0 : rows.filter((row) => row.outcome === label).length / rows.length;
}
