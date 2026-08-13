import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Outcome, WorldState } from "../backend/src/domain.js";
import { evaluateScenario } from "../backend/src/evaluation/scenario-evaluator.js";
import { continueAutonomously, type AutonomousContinuation } from "../backend/src/orchestrator/autonomous.js";
import { SimulationEngine } from "../backend/src/orchestrator/engine.js";
import { providerFromEnv } from "../backend/src/providers/index.js";
import { createCheckpoint, forkFromCheckpoint } from "../backend/src/trace/checkpoint.js";
import { compareCausalRuns } from "../backend/src/trace/causal-comparison.js";
import { createInitialState } from "../backend/src/world/initial-state.js";
import { classifyAndAttachOutcome } from "../backend/src/world/outcome.js";

const provider = providerFromEnv();
if (provider.id !== "deepseek") throw new Error("DEEPSEEK_ACCEPTANCE_REQUIRES_LLM_PROVIDER=deepseek");

const defaultRuns = positiveInteger(process.env.CITYSCOPE_DEEPSEEK_DEFAULT_RUNS, 20);
const pairSeeds = nonNegativeInteger(process.env.CITYSCOPE_DEEPSEEK_PAIR_SEEDS, 5);
const concurrency = positiveInteger(process.env.CITYSCOPE_DEEPSEEK_RUN_CONCURRENCY, 2);
const seeds = Array.from({ length: Math.max(defaultRuns, pairSeeds) }, (_, index) => 20_260_800 + index);
const interventions = [
  { id: "public_trust_redline", path: "stakeholders.publicTrust", value: 15, reason: "公众信任降至红线" },
  { id: "talent_advantage", path: "stakeholders.talentAttraction", value: 95, reason: "研发人才进入显著优势区" },
  { id: "supply_advantage", path: "stakeholders.supplyChainReadiness", value: 95, reason: "供应链进入显著优势区" },
  { id: "financing_redline", path: "metrics.financingConfidence", value: 10, reason: "外部融资信心跌破红线" },
  { id: "viability_redline", path: "metrics.projectViability", value: 15, reason: "项目执行性跌破红线" },
  { id: "reduced_investment", path: "company.investmentPlanMillionCny", value: 1_500, reason: "一期投资缩减至15亿元" },
] as const;

const engine = new SimulationEngine(provider);
const baselineBySeed = new Map<number, CompletedRun>();
const tasks: Array<() => Promise<RunRecord>> = [];
for (const seed of seeds.slice(0, defaultRuns)) tasks.push(async () => {
  const completed = await runState(createInitialState(`deepseek_default_${seed}`, seed, "autonomous"));
  baselineBySeed.set(seed, completed);
  return record("default", "default", seed, completed);
});
const defaults = await pool(tasks, concurrency);

const pairTasks: Array<() => Promise<PairRecord>> = [];
for (const intervention of interventions) {
  for (const seed of seeds.slice(0, pairSeeds)) pairTasks.push(async () => {
    const baseline = baselineBySeed.get(seed) ?? await runState(createInitialState(`deepseek_pair_base_${seed}`, seed, "autonomous"));
    const origin = createInitialState(`deepseek_pair_origin_${intervention.id}_${seed}`, seed, "autonomous");
    origin.snapshot.provider = provider.id;
    origin.snapshot.model = provider.model;
    const checkpoint = createCheckpoint(origin, `deepseek_pair_checkpoint_${intervention.id}_${seed}`);
    const previousValue = readNumber(origin, intervention.path);
    const fork = forkFromCheckpoint(checkpoint, `deepseek_pair_${intervention.id}_${seed}`, {
      interventionId: `deepseek_${intervention.id}_${seed}`,
      path: intervention.path,
      previousValue,
      newValue: intervention.value,
      reason: intervention.reason,
    });
    const changed = await runState(fork);
    const comparison = compareCausalRuns(baseline.state, changed.state, baseline.continuation.steps, changed.continuation.steps);
    return {
      group: intervention.id,
      seed,
      baselineOutcome: outcome(baseline.state),
      interventionOutcome: outcome(changed.state),
      actionChainChanged: comparison.firstSemanticActionDivergence !== null,
      outcomeChanged: comparison.outcomeChanged,
      absorbed: comparison.absorbed,
      absorptionLayer: comparison.absorptionLayer,
      firstDivergenceIndex: comparison.firstSemanticActionDivergence?.index ?? null,
      propagationCount: comparison.propagationChain.length,
      run: record("intervention", intervention.id, seed, changed),
    };
  });
}
const pairs = await pool(pairTasks, concurrency);
const runs = [...defaults, ...pairs.map((item) => item.run)];
const validRuns = runs.filter((item) => !item.error);
const behaviorSteps = validRuns.reduce((sum, item) => sum + item.behaviorSteps, 0);
const modelOrCache = validRuns.reduce((sum, item) => sum + item.sources.model + item.sources.cache, 0);
const fallbacks = validRuns.reduce((sum, item) => sum + item.sources.fallback, 0);
const outcomes = counts(validRuns.map((item) => item.outcome).filter((item): item is Outcome["label"] => Boolean(item)));
const elapsed = validRuns.map((item) => item.elapsedMs).sort((left, right) => left - right);
const groupResults = Object.fromEntries(interventions.map((intervention) => {
  const matching = pairs.filter((item) => item.group === intervention.id);
  return [intervention.id, {
    runs: matching.length,
    actionChainChangeRate: ratio(matching.filter((item) => item.actionChainChanged).length, matching.length),
    outcomeChangeRate: ratio(matching.filter((item) => item.outcomeChanged).length, matching.length),
    outcomes: counts(matching.map((item) => item.interventionOutcome)),
    absorptionLayers: counts(matching.filter((item) => item.absorbed).map((item) => item.absorptionLayer)),
  }];
}));
const defaultOutcomeCounts = counts(defaults.map((item) => item.outcome).filter((item): item is Outcome["label"] => Boolean(item)));
const report = {
  evaluationVersion: "cityscope.deepseek-acceptance.v1-batna",
  generatedAt: new Date().toISOString(),
  provider: provider.id,
  model: provider.model,
  temperature: 0,
  requestedRuns: defaultRuns + interventions.length * pairSeeds,
  completedRuns: validRuns.length,
  defaultRuns,
  pairSeeds,
  outcomes,
  defaultOutcomeCounts,
  groups: groupResults,
  quality: {
    validScenarioRate: ratio(validRuns.filter((item) => item.valid).length, validRuns.length),
    modelOrLegalCacheRate: ratio(modelOrCache, behaviorSteps),
    fallbackRate: ratio(fallbacks, behaviorSteps),
    candidateEvidenceRate: ratio(validRuns.reduce((sum, item) => sum + item.supportedKeyActions, 0), validRuns.reduce((sum, item) => sum + item.keyActions, 0)),
    gateRejectedButApplied: validRuns.reduce((sum, item) => sum + item.gateRejectedButApplied, 0),
    repairedStepRate: ratio(validRuns.reduce((sum, item) => sum + item.repairedSteps, 0), validRuns.reduce((sum, item) => sum + item.steps, 0)),
    averageRunLatencyMs: elapsed.length ? Math.round(elapsed.reduce((sum, value) => sum + value, 0) / elapsed.length) : 0,
    p95RunLatencyMs: percentile(elapsed, 0.95),
  },
  acceptance: {
    allRunsCompleted: validRuns.length === defaultRuns + interventions.length * pairSeeds,
    fourOutcomesObserved: Object.keys(outcomes).length === 4,
    defaultCoordinationNotOverSixtyPercent: ratio(defaultOutcomeCounts.DUAL_CITY ?? 0, defaults.length) <= 0.6,
    atLeastFourGroupsChangeActionChainThreeOfFive: pairSeeds < 5
      ? null
      : Object.values(groupResults).filter((item) => item.actionChainChangeRate >= 0.6).length >= 4,
    modelOrLegalCacheAtLeastNinetyPercent: ratio(modelOrCache, behaviorSteps) >= 0.9,
    fallbackAtMostTenPercent: ratio(fallbacks, behaviorSteps) <= 0.1,
    allKeyActionsHaveDecisionSupport: validRuns.every((item) => item.keyActions === item.supportedKeyActions),
    noRejectedActionMutatedWorld: validRuns.every((item) => item.gateRejectedButApplied === 0),
  },
  pairs,
  runs,
};

const outputDir = resolve(process.cwd(), "fixtures/generated");
const reportFile = process.env.CITYSCOPE_DEEPSEEK_REPORT_FILE ?? "deepseek-acceptance-report.json";
await mkdir(outputDir, { recursive: true });
await writeFile(resolve(outputDir, reportFile), `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  report: `fixtures/generated/${reportFile}`,
  requestedRuns: report.requestedRuns,
  completedRuns: report.completedRuns,
  outcomes,
  defaultOutcomeCounts,
  groups: groupResults,
  quality: report.quality,
  acceptance: report.acceptance,
}, null, 2));

interface CompletedRun { state: WorldState; continuation: AutonomousContinuation; elapsedMs: number }
interface RunRecord {
  kind: "default" | "intervention";
  group: string;
  seed: number;
  runId: string;
  outcome?: Outcome["label"];
  elapsedMs: number;
  steps: number;
  behaviorSteps: number;
  sources: Record<"model" | "cache" | "fallback" | "deterministic_stub" | "deterministic_service", number>;
  keyActions: number;
  supportedKeyActions: number;
  gateRejectedButApplied: number;
  repairedSteps: number;
  valid: boolean;
  failureCodes: string[];
  error?: string;
}
interface PairRecord {
  group: string;
  seed: number;
  baselineOutcome: Outcome["label"];
  interventionOutcome: Outcome["label"];
  actionChainChanged: boolean;
  outcomeChanged: boolean;
  absorbed: boolean;
  absorptionLayer: string;
  firstDivergenceIndex: number | null;
  propagationCount: number;
  run: RunRecord;
}

async function runState(input: WorldState): Promise<CompletedRun> {
  input.snapshot.provider = provider.id;
  input.snapshot.model = provider.model;
  const started = Date.now();
  const continuation = await continueAutonomously(engine, input, { maxSteps: 70 });
  return { state: classifyAndAttachOutcome(continuation.state), continuation, elapsedMs: Date.now() - started };
}

function record(kind: RunRecord["kind"], group: string, seed: number, completed: CompletedRun): RunRecord {
  const evaluation = evaluateScenario(completed.state);
  const keyKinds = new Set(["SUBMIT_POLICY_PACK", "REVISE_POLICY_PACK", "MAINTAIN_CITY_OFFER", "WITHDRAW_CITY_OFFER", "PROPOSE_COORDINATION_PLAN", "RESPOND_COORDINATION_PLAN", "ACCEPT_POLICY", "ACCEPT_COORDINATION_PLAN", "EXIT_PROJECT"]);
  const keyActions = completed.continuation.steps.filter((step) => keyKinds.has(step.candidate.kind));
  const events = new Map(completed.state.events.filter((event) => event.eventType === "AgentActionProposed").map((event) => [event.causeId, event]));
  const supportedKeyActions = keyActions.filter((step) => {
    const support = events.get(step.candidate.actionId)?.payload.decisionSupport as { optimizer?: { status?: string }; candidates?: unknown[] } | undefined;
    return ["OPTIMAL", "FEASIBLE"].includes(String(support?.optimizer?.status)) && (support?.candidates?.length ?? 0) >= 2;
  }).length;
  const sources = Object.fromEntries(["model", "cache", "fallback", "deterministic_stub", "deterministic_service"].map((source) => [source, completed.continuation.steps.filter((step) => step.generationSource === source).length])) as RunRecord["sources"];
  return {
    kind, group, seed, runId: completed.state.runId, outcome: outcome(completed.state),
    elapsedMs: completed.elapsedMs, steps: completed.continuation.steps.length,
    behaviorSteps: completed.continuation.steps.filter((step) => step.generationSource !== "deterministic_service").length,
    sources, keyActions: keyActions.length, supportedKeyActions,
    gateRejectedButApplied: completed.state.receipts.filter((receipt) => receipt.status === "REJECTED" && receipt.deltas.length > 0).length,
    repairedSteps: completed.continuation.steps.filter((step) => step.gateRejected || step.generationSource === "fallback").length,
    valid: evaluation.valid, failureCodes: evaluation.failures.map((item) => item.code),
  };
}

async function pool<T>(tasks: Array<() => Promise<T>>, limit: number): Promise<T[]> {
  const results = new Array<T>(tasks.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= tasks.length) return;
      try {
        results[index] = await tasks[index]!();
      } catch (error) {
        throw new Error(`DeepSeek acceptance run ${index + 1}/${tasks.length} failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }));
  return results;
}

function outcome(state: WorldState): Outcome["label"] {
  if (!state.simulation.classification) throw new Error(`run ${state.runId} has no classification`);
  return state.simulation.classification.label;
}

function readNumber(state: WorldState, path: string): number {
  let current: unknown = state;
  for (const segment of path.split(".")) current = (current as Record<string, unknown>)[segment];
  if (typeof current !== "number") throw new Error(`${path} is not numeric`);
  return current;
}

function counts(values: string[]): Record<string, number> {
  return values.reduce<Record<string, number>>((result, value) => ({ ...result, [value]: (result[value] ?? 0) + 1 }), {});
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : Math.round(numerator / denominator * 10_000) / 10_000;
}

function positiveInteger(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function nonNegativeInteger(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  return Number.isInteger(value) && value >= 0 ? value : fallback;
}

function percentile(values: number[], quantile: number): number {
  if (values.length === 0) return 0;
  return values[Math.min(values.length - 1, Math.max(0, Math.ceil(values.length * quantile) - 1))] ?? 0;
}
