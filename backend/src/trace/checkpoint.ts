import type { Checkpoint, Intervention, StateDelta, WorldEvent, WorldState } from "../domain.js";
import { clone, deterministicId, digest, getAtPath, setAtPath } from "../util.js";

export function createCheckpoint(state: WorldState, checkpointId = deterministicId("checkpoint", state.runId, state.worldVersion)): Checkpoint {
  const snapshot = clone(state);
  const checkpoint = { checkpointId, sourceRunId: state.runId, createdAtVersion: state.worldVersion, digest: digest(snapshot), state: snapshot };
  return checkpoint;
}

export function forkFromCheckpoint(checkpoint: Checkpoint, newRunId: string, intervention: Intervention): WorldState {
  if (!intervention.interventionId || !intervention.path || intervention.previousValue === undefined || intervention.newValue === undefined) {
    throw new Error("INVALID_FORK_INTERVENTION: exactly one fully specified intervention is required");
  }
  const state = clone(checkpoint.state);
  const actual = getAtPath(state, intervention.path);
  if (digest(actual) !== digest(intervention.previousValue)) throw new Error(`INVALID_FORK_INTERVENTION: previousValue does not match ${intervention.path}`);
  const oldRunId = state.runId;
  state.runId = newRunId;
  state.parentRunId = oldRunId;
  state.interventionId = intervention.interventionId;
  state.intervention = clone(intervention);
  const nextVersion = state.worldVersion + 1;
  setAtPath(state, intervention.path, clone(intervention.newValue));
  const delta: StateDelta = {
    deltaId: deterministicId("delta", intervention.interventionId, intervention.path, nextVersion),
    causeId: intervention.interventionId,
    path: intervention.path,
    before: clone(intervention.previousValue),
    after: clone(intervention.newValue),
    actorId: "human_intervention",
    worldVersion: nextVersion,
  };
  const event: WorldEvent = {
    eventId: deterministicId("event", newRunId, "ForkCreated", intervention.interventionId),
    eventType: "ForkCreated",
    causeId: intervention.interventionId,
    actorId: "human_intervention",
    worldVersion: nextVersion,
    occurredAt: new Date(Date.UTC(2026, 7, 11, 0, 0, nextVersion)).toISOString(),
    payload: { checkpointId: checkpoint.checkpointId, sourceRunId: checkpoint.sourceRunId, path: intervention.path },
  };
  state.worldVersion = nextVersion;
  state.trace.push(delta);
  state.events.push(event);
  return state;
}

export function verifyBranchIntegrity(checkpoint: Checkpoint, fork: WorldState): { passed: boolean; differences: string[] } {
  const base = clone(checkpoint.state) as unknown as Record<string, unknown>;
  const branch = clone(fork) as unknown as Record<string, unknown>;
  const allowedTopLevel = new Set(["runId", "parentRunId", "interventionId", "intervention", "worldVersion", "trace", "events"]);
  const differences: string[] = [];
  for (const key of Object.keys({ ...base, ...branch })) {
    if (allowedTopLevel.has(key)) continue;
    if (fork.intervention?.path.startsWith(`${key}.`)) {
      const baseValue = getAtPath(base, fork.intervention.path);
      const forkValue = getAtPath(branch, fork.intervention.path);
      if (digest(baseValue) !== digest(fork.intervention.previousValue) || digest(forkValue) !== digest(fork.intervention.newValue)) differences.push(`${fork.intervention.path} does not match declared intervention`);
      const branchWithoutChange = clone(branch);
      setAtPath(branchWithoutChange, fork.intervention.path, baseValue);
      if (digest(base[key]) !== digest(branchWithoutChange[key])) differences.push(`${key} contains undeclared differences`);
    } else if (digest(base[key]) !== digest(branch[key])) differences.push(`${key} differs unexpectedly`);
  }
  return { passed: differences.length === 0, differences };
}

