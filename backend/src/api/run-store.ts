import type { AgentAction, ApplyResult, Checkpoint, Intervention, Outcome, WorldState } from "../domain.js";
import type { LLMProvider } from "../providers/types.js";
import { SimulationEngine } from "../orchestrator/engine.js";
import { continueAutonomously } from "../orchestrator/autonomous.js";
import { createCheckpoint, forkFromCheckpoint } from "../trace/checkpoint.js";
import { replay } from "../trace/replay.js";
import { createInitialState } from "../world/initial-state.js";
import { classifyOutcome } from "../world/outcome.js";

export class ApiError extends Error {
  constructor(readonly code: string, message: string, readonly status: number, readonly retryable = false, readonly details?: unknown) {
    super(message);
  }
}

export class RunStore {
  private readonly runs = new Map<string, WorldState>();
  private readonly checkpoints = new Map<string, Checkpoint>();
  private readonly engine: SimulationEngine;

  constructor(private readonly provider: LLMProvider) {
    this.engine = new SimulationEngine(provider);
  }

  createRun(runId: string, seed = 20260811): WorldState {
    if (this.runs.has(runId)) throw new ApiError("WORLD_VERSION_CONFLICT", `run ${runId} already exists`, 409, true);
    const state = createInitialState(runId, seed);
    state.snapshot.provider = this.provider.id;
    state.snapshot.model = this.provider.model;
    this.runs.set(runId, state);
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

  async advance(runId: string, expectedVersion?: number): Promise<WorldState> {
    const state = this.requireRun(runId);
    this.assertVersion(state, expectedVersion);
    const result = await continueAutonomously(this.engine, state);
    this.runs.set(runId, result.state);
    return structuredClone(result.state);
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

  private requireRun(runId: string): WorldState {
    const state = this.runs.get(runId);
    if (!state) throw new ApiError("RUN_NOT_FOUND", `run ${runId} not found`, 404);
    return state;
  }

  private assertVersion(state: WorldState, expectedVersion?: number): void {
    if (expectedVersion !== undefined && expectedVersion !== state.worldVersion) throw new ApiError("WORLD_VERSION_CONFLICT", `expected ${expectedVersion}, current ${state.worldVersion}`, 409, true);
  }
}
