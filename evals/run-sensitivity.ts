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
import { interventionCatalog } from "../backend/src/interventions/catalog.js";

const variables = interventionCatalog.map((item) => ({
  path: item.path,
  values: Array.from({ length: 9 }, (_, index) => Math.round((item.min + (item.max - item.min) * index / 8) / item.step) * item.step),
}));

const seedCount = Number(process.env.CITYSCOPE_SENSITIVITY_SEEDS ?? 50);
const seeds = Array.from({ length: seedCount }, (_, index) => 20_260_800 + index);
const baseBySeed = new Map<number, WorldState>();
const baselineOutcomeBySeed = new Map<number, Outcome["label"] | "UNRESOLVED">();
for (const seed of seeds) {
  const initial = createInitialState(`sensitivity_base_${seed}`, seed, "autonomous");
  baseBySeed.set(seed, initial);
  try {
    const engine = new SimulationEngine(new StubProvider());
    const baseline = await continueAutonomously(engine, structuredClone(initial));
    baselineOutcomeBySeed.set(seed, evaluateScenario(classifyAndAttachOutcome(baseline.state)).outcome);
  } catch {
    baselineOutcomeBySeed.set(seed, "UNRESOLVED");
  }
}

const rows: Array<{ variable: string; value: number; seed: number; outcome: Outcome["label"] | "UNRESOLVED"; valid: boolean; fitness: number; failureCodes?: string[]; error?: string }> = [];
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
        // A/B share scenario/profile seed, but never mutable solver/cache state.
        // This mirrors two independent API runs and prevents one matrix row
        // from contaminating the next through in-memory semantic caches.
        const continuation = await continueAutonomously(new SimulationEngine(new StubProvider()), fork);
        const state = classifyAndAttachOutcome(continuation.state);
        const evaluation = evaluateScenario(state);
        rows.push({ variable: variable.path, value, seed, outcome: evaluation.outcome, valid: evaluation.valid, fitness: evaluation.fitness, ...(evaluation.failures.length ? { failureCodes: evaluation.failures.map((item) => item.code) } : {}) });
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
// A variable is causal only when changing its value changes the outcome for
// at least one paired seed. Outcome diversity across different profiles does
// not count as intervention sensitivity.
const variablesChangingOutcome = variables.filter((variable) => seeds.some((seed) =>
  new Set(rows.filter((row) => row.variable === variable.path && row.seed === seed).map((row) => row.outcome)).size > 1,
)).map((item) => item.path);
const pairedChangeRates = Object.fromEntries(variables.map((variable) => [variable.path, Object.fromEntries(variable.values.map((value) => {
  const matching = rows.filter((row) => row.variable === variable.path && row.value === value);
  const changed = matching.filter((row) => row.outcome !== baselineOutcomeBySeed.get(row.seed)).length;
  return [value, matching.length === 0 ? 0 : changed / matching.length];
}))]));
const sensitiveVariables = variables.filter((variable) => Math.max(...Object.values(pairedChangeRates[variable.path] ?? {})) >= 0.3).map((item) => item.path);
const strongSensitiveVariables = variables.filter((variable) => strongChangeRate(variable.path) >= 0.7).map((item) => item.path);
const defaultDistribution = counts([...baselineOutcomeBySeed.values()]);
const defaultResolved = Object.entries(defaultDistribution).filter(([label]) => label !== "UNRESOLVED");
const defaultMaxShare = Math.max(0, ...defaultResolved.map(([, count]) => count / seeds.length));
const defaultShares = {
  DUAL_CITY: (defaultDistribution.DUAL_CITY ?? 0) / seeds.length,
  CHENGDU_LED: (defaultDistribution.CHENGDU_LED ?? 0) / seeds.length,
  CHONGQING_LED: (defaultDistribution.CHONGQING_LED ?? 0) / seeds.length,
  PROJECT_EXITED: (defaultDistribution.PROJECT_EXITED ?? 0) / seeds.length,
};
const lowFinanceRows = rows.filter((row) => row.variable === "metrics.financingConfidence" && row.value <= 20);
const highTalentRows = rows.filter((row) => row.variable === "stakeholders.talentAttraction" && row.value >= 85);
const highSupplyRows = rows.filter((row) => row.variable === "stakeholders.supplyChainReadiness" && row.value >= 90);
const talentTrend = trend("stakeholders.talentAttraction", "CHENGDU_LED");
const supplyTrend = trend("stakeholders.supplyChainReadiness", "CHONGQING_LED", "ascending", 75);
const financeExitTrend = trend("metrics.financingConfidence", "PROJECT_EXITED", "descending");
const viabilityExitTrend = trend("metrics.projectViability", "PROJECT_EXITED", "descending");
const report = {
  evaluationVersion: "cityscope.sensitivity.v4.mechanism-validation",
  generatedAt: new Date().toISOString(),
  scope: {
    provider: "stub",
    purpose: "mechanism_reachability_causality_and_direction",
    probabilityCalibrationSource: "fixtures/generated/deepseek-acceptance-report.json",
    note: "Stub 分布只用于诊断规则与阈值，不代表真实 Agent 的结局概率。",
  },
  runCount: rows.length,
  seedCount,
  variables: variables.map((item) => item.path),
  reachableOutcomes: [...reachable].sort(),
  variablesChangingOutcome,
  sensitiveVariables,
  strongSensitiveVariables,
  defaultDistribution,
  defaultShares,
  defaultMaxShare,
  pairedChangeRates,
  validRate: rows.filter((row) => row.valid).length / rows.length,
  unresolvedCount: rows.filter((row) => row.outcome === "UNRESOLVED").length,
  acceptance: {
    allFourOutcomesReachable: reachable.size === 4,
    atLeastFourCausalVariables: variablesChangingOutcome.length >= 4,
    sensitivePairRateAtLeastThirtyPercent: sensitiveVariables.length >= 4,
    strongPairRateAtLeastSeventyPercent: strongSensitiveVariables.length >= 4,
    stubProfilesDoNotCollapseToOneOutcome: defaultMaxShare <= 0.6,
    lowFinancingRaisesExit: share(lowFinanceRows, "PROJECT_EXITED") >= 0.5,
    highTalentRaisesChengdu: share(highTalentRows, "CHENGDU_LED") >= 0.5,
    highSupplyRaisesChongqing: share(highSupplyRows, "CHONGQING_LED") >= 0.5,
    directionalTrendsAreMonotonic: talentTrend.monotonic && supplyTrend.monotonic && financeExitTrend.monotonic && viabilityExitTrend.monotonic,
    allRunsResolved: rows.every((row) => row.outcome !== "UNRESOLVED"),
    allRunsValid: rows.every((row) => row.valid),
  },
  trends: { talentToChengdu: talentTrend, supplyToChongqing: supplyTrend, financingToExit: financeExitTrend, viabilityToExit: viabilityExitTrend },
  distribution,
  failures: rows.filter((row) => row.error || !row.valid).slice(0, 100),
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

function strongChangeRate(path: string): number {
  const rates = pairedChangeRates[path] ?? {};
  const definition = interventionCatalog.find((item) => item.path === path);
  if (!definition) return 0;
  return Math.max(0, ...Object.entries(rates)
    .filter(([rawValue]) => Math.abs(Number(rawValue) - definition.baseline) >= (definition.max - definition.min) * 0.35)
    .map(([, rate]) => rate));
}

function trend(path: string, label: Outcome["label"], direction: "ascending" | "descending" = "ascending", fromValue?: number): { values: number[]; shares: number[]; monotonic: boolean } {
  const variable = variables.find((item) => item.path === path);
  const values = variable?.values ?? [];
  const shares = values.map((value) => share(rows.filter((row) => row.variable === path && row.value === value), label));
  const selected = fromValue === undefined ? shares : shares.filter((_, index) => values[index]! >= fromValue);
  const ordered = direction === "ascending" ? selected : [...selected].reverse();
  return { values, shares, monotonic: ordered.every((value, index) => index === 0 || value + 0.08 >= ordered[index - 1]!) };
}
