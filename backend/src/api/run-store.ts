import type { AgentAction, ApplyResult, Checkpoint, Intervention, Outcome, WorldState } from "../domain.js";
import type { LLMProvider } from "../providers/types.js";
import { SimulationEngine } from "../orchestrator/engine.js";
import { continueAutonomously, type AutonomousStep, type ContinuationOptions } from "../orchestrator/autonomous.js";
import { createCheckpoint, forkFromCheckpoint } from "../trace/checkpoint.js";
import { replay } from "../trace/replay.js";
import { createInitialState } from "../world/initial-state.js";
import { classifyOutcome } from "../world/outcome.js";
import { emptyProviderUsage } from "../providers/types.js";
import { cityCompetitionForState, type CityCompetitionEvidence } from "../decision-support/city-competition.js";
import { compareCausalRuns, type CausalComparison } from "../trace/causal-comparison.js";

export class ApiError extends Error {
  constructor(readonly code: string, message: string, readonly status: number, readonly retryable = false, readonly details?: unknown) {
    super(message);
  }
}

export class RunStore {
  private readonly runs = new Map<string, WorldState>();
  private readonly runSteps = new Map<string, AutonomousStep[]>();
  private readonly checkpoints = new Map<string, Checkpoint>();
  private readonly engine: SimulationEngine;

  constructor(private readonly provider: LLMProvider) {
    this.engine = new SimulationEngine(provider);
  }

  createRun(runId: string, seed = 20260800): WorldState {
    if (this.runs.has(runId)) throw new ApiError("WORLD_VERSION_CONFLICT", `run ${runId} already exists`, 409, true);
    const state = createInitialState(runId, seed);
    state.snapshot.provider = this.provider.id;
    state.snapshot.model = this.provider.model;
    this.runs.set(runId, state);
    this.runSteps.set(runId, []);
    return structuredClone(state);
  }

  getRun(runId: string): WorldState {
    const state = this.runs.get(runId);
    if (!state) throw new ApiError("RUN_NOT_FOUND", `run ${runId} not found`, 404);
    return structuredClone(state);
  }

  async submitAction(runId: string, action: AgentAction, expectedVersion?: number): Promise<ApplyResult> {
    const state = this.requireRun(runId);
    this.assertVersion(state, expectedVersion);
    const result = this.engine.applyExternalAction(state, action);
    this.runs.set(runId, result.state);
    return result;
  }

  async advance(runId: string, expectedVersion?: number, options: ContinuationOptions = {}): Promise<WorldState> {
    const state = this.requireRun(runId);
    this.assertVersion(state, expectedVersion);
    const result = await continueAutonomously(this.engine, state, {
      ...options,
      onStep: async (step, streamedState) => {
        this.runs.set(runId, structuredClone(streamedState));
        this.runSteps.set(runId, [...(this.runSteps.get(runId) ?? []), structuredClone(step)]);
        await options.onStep?.(step, streamedState);
      },
    });
    this.runs.set(runId, result.state);
    return structuredClone(result.state);
  }

  steps(runId: string): AutonomousStep[] {
    this.requireRun(runId);
    return structuredClone(this.runSteps.get(runId) ?? []);
  }

  usage(runId: string): RunUsageSummary {
    this.requireRun(runId);
    const steps = this.runSteps.get(runId) ?? [];
    const providerUsage = steps.reduce((total, step) => {
      if (!step.usage) return total;
      total.callCount += step.usage.callCount;
      total.promptTokens += step.usage.promptTokens;
      total.completionTokens += step.usage.completionTokens;
      total.totalTokens += step.usage.totalTokens;
      total.promptCacheHitTokens += step.usage.promptCacheHitTokens;
      total.promptCacheMissTokens += step.usage.promptCacheMissTokens;
      return total;
    }, emptyProviderUsage());
    const semanticCacheHits = steps.filter((step) => step.generationSource === "cache").length;
    const cacheableSteps = steps.filter((step) => ["model", "cache"].includes(step.generationSource)).length;
    const providerPromptTokens = providerUsage.promptCacheHitTokens + providerUsage.promptCacheMissTokens;
    return {
      runId,
      totalSteps: steps.length,
      providerCalls: providerUsage.callCount,
      semanticCacheHits,
      avoidedProviderCalls: semanticCacheHits,
      semanticCacheHitRate: cacheableSteps === 0 ? 0 : semanticCacheHits / cacheableSteps,
      providerCacheHitRate: providerPromptTokens === 0 ? 0 : providerUsage.promptCacheHitTokens / providerPromptTokens,
      providerUsage,
      sources: Object.fromEntries(["model", "cache", "fallback", "deterministic_stub", "deterministic_service"].map((source) => [source, steps.filter((step) => step.generationSource === source).length])),
    };
  }

  createCheckpoint(runId: string, checkpointId?: string): Checkpoint {
    const state = this.requireRun(runId);
    const checkpoint = createCheckpoint(state, checkpointId);
    this.checkpoints.set(checkpoint.checkpointId, checkpoint);
    return structuredClone(checkpoint);
  }

  fork(checkpointId: string, newRunId: string, intervention: Intervention): WorldState {
    const checkpoint = this.checkpoints.get(checkpointId);
    if (!checkpoint) throw new ApiError("CHECKPOINT_NOT_FOUND", `checkpoint ${checkpointId} not found`, 404);
    if (this.runs.has(newRunId)) throw new ApiError("WORLD_VERSION_CONFLICT", `run ${newRunId} already exists`, 409, true);
    let fork: WorldState;
    try {
      fork = forkFromCheckpoint(checkpoint, newRunId, intervention);
    } catch (error) {
      throw new ApiError("INVALID_FORK_INTERVENTION", error instanceof Error ? error.message : "invalid fork", 422);
    }
    this.runs.set(newRunId, fork);
    const checkpointReceiptIds = new Set(checkpoint.state.receipts.map((receipt) => receipt.receiptId));
    const inheritedSteps = (this.runSteps.get(checkpoint.sourceRunId) ?? []).filter((step) => checkpointReceiptIds.has(step.receiptId));
    this.runSteps.set(newRunId, structuredClone(inheritedSteps));
    return structuredClone(fork);
  }

  replayFrom(runId: string, checkpointId: string, actions: AgentAction[]): WorldState {
    this.requireRun(runId);
    const checkpoint = this.checkpoints.get(checkpointId);
    if (!checkpoint) throw new ApiError("CHECKPOINT_NOT_FOUND", `checkpoint ${checkpointId} not found`, 404);
    return replay(checkpoint, actions);
  }

  events(runId: string, afterVersion = -1): WorldState["events"] {
    return this.requireRun(runId).events.filter((event) => event.worldVersion > afterVersion).map((event) => structuredClone(event));
  }

  trace(runId: string, causeId: string): { actionReceipt: WorldState["receipts"][number] | null; events: WorldState["events"]; deltas: WorldState["trace"] } {
    const state = this.requireRun(runId);
    return {
      actionReceipt: structuredClone(state.receipts.find((receipt) => receipt.actionId === causeId) ?? null),
      events: structuredClone(state.events.filter((event) => event.causeId === causeId)),
      deltas: structuredClone(state.trace.filter((delta) => delta.causeId === causeId)),
    };
  }

  outcome(runId: string): Outcome {
    const state = this.requireRun(runId);
    try {
      return classifyOutcome(state);
    } catch (error) {
      throw new ApiError("RUN_NOT_TERMINAL", error instanceof Error ? error.message : "run not terminal", 409);
    }
  }

  competition(runId: string): CityCompetitionEvidence {
    return cityCompetitionForState(this.requireRun(runId));
  }

  comparison(baselineRunId: string, interventionRunId: string): CausalComparison {
    const baseline = this.requireRun(baselineRunId);
    const intervention = this.requireRun(interventionRunId);
    try {
      return compareCausalRuns(baseline, intervention, this.runSteps.get(baselineRunId) ?? [], this.runSteps.get(interventionRunId) ?? []);
    } catch (error) {
      throw new ApiError("COMPARISON_NOT_READY", error instanceof Error ? error.message : "causal comparison not ready", 409, true);
    }
  }

  private requireRun(runId: string): WorldState {
    const state = this.runs.get(runId);
    if (!state) throw new ApiError("RUN_NOT_FOUND", `run ${runId} not found`, 404);
    return state;
  }

  private assertVersion(state: WorldState, expectedVersion?: number): void {
    if (expectedVersion !== undefined && expectedVersion !== state.worldVersion) throw new ApiError("WORLD_VERSION_CONFLICT", `expected ${expectedVersion}, current ${state.worldVersion}`, 409, true);
  }
}

export interface RunUsageSummary {
  runId: string;
  totalSteps: number;
  providerCalls: number;
  semanticCacheHits: number;
  avoidedProviderCalls: number;
  semanticCacheHitRate: number;
  providerCacheHitRate: number;
  providerUsage: ReturnType<typeof emptyProviderUsage>;
  sources: Record<string, number>;
}
