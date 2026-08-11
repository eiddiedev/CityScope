import type { AgentAction, Checkpoint, WorldState } from "../domain.js";
import { applyAction } from "../world/reducer.js";
import { clone, digest } from "../util.js";

export function replay(checkpoint: Checkpoint, actions: AgentAction[]): WorldState {
  let state = clone(checkpoint.state);
  for (const action of actions) state = applyAction(state, action).state;
  return state;
}

export function replayDigest(state: WorldState): string {
  return digest(state);
}

export function assertReplayStable(expected: WorldState, actual: WorldState): void {
  if (replayDigest(expected) !== replayDigest(actual)) throw new Error("REPLAY_DIVERGED: deterministic replay digest mismatch");
}

