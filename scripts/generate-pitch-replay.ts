import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Intervention, WorldState } from "../backend/src/domain.js";
import { manifests } from "../backend/src/agents/manifests.js";
import { cityCompetitionForState } from "../backend/src/decision-support/city-competition.js";
import { continueAutonomously, type AutonomousStep } from "../backend/src/orchestrator/autonomous.js";
import { SimulationEngine } from "../backend/src/orchestrator/engine.js";
import { providerFromEnv } from "../backend/src/providers/index.js";
import { compareCausalRuns } from "../backend/src/trace/causal-comparison.js";
import { createCheckpoint, forkFromCheckpoint } from "../backend/src/trace/checkpoint.js";
import { createInitialState } from "../backend/src/world/initial-state.js";
import { classifyAndAttachOutcome } from "../backend/src/world/outcome.js";

const seed = 20_260_800;
const provider = providerFromEnv({ ...process.env, LLM_PROVIDER: "deepseek" });
if (provider.id !== "deepseek") throw new Error("PITCH_REPLAY_REQUIRES_DEEPSEEK");

const engine = new SimulationEngine(provider);
const baselineInitial = createInitialState("pitch_replay_baseline", seed, "autonomous");
baselineInitial.snapshot.provider = provider.id;
baselineInitial.snapshot.model = provider.model;
const checkpoint = createCheckpoint(baselineInitial, "pitch_replay_checkpoint_financing_66");
const intervention: Intervention = {
  interventionId: "pitch_replay_financing_66_to_5",
  path: "metrics.financingConfidence",
  previousValue: baselineInitial.metrics.financingConfidence,
  newValue: 5,
  reason: "外部融资信心由基准值 66 降至红线值 5",
};
const forkInitial = forkFromCheckpoint(checkpoint, "pitch_replay_experiment_financing_5", intervention);
forkInitial.snapshot.provider = provider.id;
forkInitial.snapshot.model = provider.model;

console.log(`Generating persistent pitch replay with ${provider.id}/${provider.model}: 66 -> 5`);
const [baselineContinuation, forkContinuation] = await Promise.all([
  continueAutonomously(engine, baselineInitial, { maxSteps: 60 }),
  continueAutonomously(engine, forkInitial, { maxSteps: 60 }),
]);
const baselineState = classifyAndAttachOutcome(baselineContinuation.state);
const forkState = classifyAndAttachOutcome(forkContinuation.state);
const result = {
  checkpointId: checkpoint.checkpointId,
  intervention,
  baselineState,
  forkState,
  baselineOutcome: requiredOutcome(baselineState),
  forkOutcome: requiredOutcome(forkState),
  baselineSteps: projectSteps(baselineContinuation.steps, baselineState),
  forkSteps: projectSteps(forkContinuation.steps, forkState),
  baselineCompetition: cityCompetitionForState(baselineState),
  forkCompetition: cityCompetitionForState(forkState),
  provider: provider.id,
  model: provider.model,
  causalComparison: compareCausalRuns(
    baselineState,
    forkState,
    baselineContinuation.steps,
    forkContinuation.steps,
  ),
};
const artifact = {
  replayVersion: "cityscope.pitch-replay.v1",
  generatedAt: new Date().toISOString(),
  source: "recorded-deepseek-run",
  seed,
  durationMs: 40_000,
  request: {
    path: intervention.path,
    newValue: intervention.newValue,
    reason: intervention.reason,
  },
  result,
};
const output = resolve(process.cwd(), "fixtures/v0/pitch-financing-replay.json");
await mkdir(resolve(process.cwd(), "fixtures/v0"), { recursive: true });
await writeFile(output, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  output,
  baseline: result.baselineOutcome.label,
  experiment: result.forkOutcome.label,
  baselineSteps: result.baselineSteps.length,
  experimentSteps: result.forkSteps.length,
  firstSemanticDivergence: result.causalComparison.firstSemanticActionDivergence?.index ?? null,
}, null, 2));

function projectSteps(steps: AutonomousStep[], state: WorldState) {
  const receipts = new Map(state.receipts.map((item) => [item.receiptId, item]));
  return steps.map((step) => {
    const receipt = receipts.get(step.receiptId);
    if (!receipt) throw new Error(`MISSING_RECEIPT:${step.receiptId}`);
    return {
      phase: step.phase,
      actorId: step.actorId,
      actorKind: manifests[step.actorId]?.actorKind ?? "agent",
      generationSource: step.generationSource,
      candidate: step.candidate,
      receipt,
    };
  });
}

function requiredOutcome(state: WorldState) {
  if (!state.simulation.classification) throw new Error("OUTCOME_NOT_CLASSIFIED");
  return state.simulation.classification;
}
