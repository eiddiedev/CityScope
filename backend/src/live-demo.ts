import { continueAutonomously } from "./orchestrator/autonomous.js";
import { SimulationEngine } from "./orchestrator/engine.js";
import { providerFromEnv } from "./providers/index.js";
import { createInitialState } from "./world/initial-state.js";
import { classifyAndAttachOutcome } from "./world/outcome.js";
import { emptyProviderUsage } from "./providers/types.js";

const provider = providerFromEnv();
if (provider.id === "stub") throw new Error("demo:live requires a non-stub LLM_PROVIDER in .env");

const startedAt = Date.now();
const continuation = await continueAutonomously(
  new SimulationEngine(provider),
  createInitialState(`live_${Date.now()}`, Number(process.env.CITYSCOPE_LIVE_SEED ?? 20260800), "autonomous"),
  { maxSteps: 60 },
);
const state = classifyAndAttachOutcome(continuation.state);
const sourceCounts = Object.fromEntries(
  [...new Set(continuation.steps.map((step) => step.generationSource))]
    .map((source) => [source, continuation.steps.filter((step) => step.generationSource === source).length]),
);
const repairedGateRejections = state.receipts
  .filter((receipt) => receipt.status === "REJECTED")
  .map((receipt) => ({
    actorId: receipt.actorId,
    reasons: receipt.gateResults.filter((gate) => !gate.passed).map((gate) => gate.reason),
  }));
const decisionEvents = state.events.filter((event) => event.payload.decisionSupport);
const optimizerEngines = [...new Set(decisionEvents.map((event) => {
  const support = event.payload.decisionSupport as { optimizer?: { engine?: string } };
  return support.optimizer?.engine;
}).filter((engine): engine is string => Boolean(engine)))];
const candidateCitations = continuation.steps.filter((step) => /candidate_[a-f0-9]+/i.test(step.candidate.reasoning));
const providerUsage = continuation.steps.reduce((total, step) => {
  if (!step.usage) return total;
  total.callCount += step.usage.callCount;
  total.promptTokens += step.usage.promptTokens;
  total.completionTokens += step.usage.completionTokens;
  total.totalTokens += step.usage.totalTokens;
  total.promptCacheHitTokens += step.usage.promptCacheHitTokens;
  total.promptCacheMissTokens += step.usage.promptCacheMissTokens;
  return total;
}, emptyProviderUsage());
const providerPromptTokens = providerUsage.promptCacheHitTokens + providerUsage.promptCacheMissTokens;

console.log(JSON.stringify({
  provider: provider.id,
  model: provider.model,
  elapsedMs: Date.now() - startedAt,
  terminal: state.terminal,
  outcome: state.simulation.classification?.label,
  worldVersion: state.worldVersion,
  stepCount: continuation.steps.length,
  sourceCounts,
  tokenEfficiency: {
    providerUsage,
    semanticCacheHits: continuation.steps.filter((step) => step.generationSource === "cache").length,
    providerCacheHitRate: providerPromptTokens === 0 ? 0 : providerUsage.promptCacheHitTokens / providerPromptTokens,
  },
  finalRejectedSteps: continuation.steps.filter((step) => step.status === "REJECTED").length,
  repairedGateRejections,
  appliedReceipts: state.receipts.filter((receipt) => receipt.status === "APPLIED").length,
  stateDeltaCount: state.trace.length,
  eventCount: state.events.length,
  policies: Object.values(state.cities).flatMap((city) => city.policies).map((policy) => ({
    cityId: policy.cityId,
    status: policy.status,
    auditStatus: policy.auditStatus,
  })),
  commitmentCount: state.commitments.length,
  projectStage: state.company.projectStage,
  decisionSupport: {
    evidenceEventCount: decisionEvents.length,
    optimizerEngines,
    candidateCitationCount: candidateCitations.length,
    citingActors: [...new Set(candidateCitations.map((step) => step.actorId))],
  },
}, null, 2));
