import type { Outcome, StateDelta, WorldEvent, WorldState } from "../domain.js";
import { clone, deterministicId } from "../util.js";

export function terminate(input: WorldState, reason: string): WorldState {
  const state = clone(input);
  if (state.terminal) return state;
  const version = state.worldVersion + 1;
  const causeId = deterministicId("termination", state.runId, reason, version);
  const delta: StateDelta = { deltaId: deterministicId("delta", causeId, "terminal"), causeId, path: "terminal", before: false, after: true, actorId: "orchestrator", worldVersion: version };
  const event: WorldEvent = { eventId: deterministicId("event", state.runId, "SimulationTerminated", version), eventType: "SimulationTerminated", causeId, actorId: "orchestrator", worldVersion: version, occurredAt: new Date(Date.UTC(2026, 7, 11, 0, 0, version)).toISOString(), payload: { reason } };
  state.terminal = true;
  state.terminalReason = reason;
  state.worldVersion = version;
  state.trace.push(delta);
  state.events.push(event);
  return state;
}

export function classifyOutcome(state: WorldState): Outcome {
  if (!state.terminal) throw new Error("RUN_NOT_TERMINAL: outcome classification requires terminal WorldState");
  const accepted = Object.values(state.cities).flatMap((city) => city.policies).filter((policy) => policy.status === "accepted");
  const activeCities = new Set(accepted.map((policy) => policy.cityId));
  let label: Outcome["label"];
  if (state.company.projectStage === "exited" || state.metrics.projectViability < 25) label = "PROJECT_EXITED";
  else if (activeCities.size === 2) label = "DUAL_CITY";
  else if (activeCities.has("chengdu")) label = "CHENGDU_LED";
  else if (activeCities.has("chongqing")) label = "CHONGQING_LED";
  else label = "CONTINUING_COMMITMENTS";
  return {
    label,
    evidence: [
      `terminal=${state.terminal}`,
      `stage=${state.company.projectStage}`,
      `acceptedPolicies=${accepted.map((policy) => policy.policyId).join(",") || "none"}`,
      `viability=${state.metrics.projectViability}`,
    ],
    classifiedAtVersion: state.worldVersion,
  };
}

