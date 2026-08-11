import type { AgentAction, StateDelta, WorldEvent, WorldState } from "../domain.js";
import { clone, deterministicId } from "../util.js";
import { terminate } from "../world/outcome.js";
import type { ActorStepResult, SimulationEngine } from "./engine.js";

export interface AutonomousStep {
  phase: WorldState["simulation"]["phase"];
  actorId: string;
  candidateKind: ActorStepResult["candidate"]["kind"];
  candidate: AgentAction;
  receiptId: string;
  status: ActorStepResult["receipt"]["status"];
  generationSource: ActorStepResult["generationSource"];
  gateRejected: boolean;
}

export interface AutonomousContinuation {
  state: WorldState;
  steps: AutonomousStep[];
  eligibleOrder: Array<{ phase: WorldState["simulation"]["phase"]; actors: string[] }>;
}

export interface ContinuationOptions {
  stopAfterPhase?: Exclude<WorldState["simulation"]["phase"], "complete">;
  maxSteps?: number;
  terminateAtComplete?: boolean;
}

const phaseActors: Record<Exclude<WorldState["simulation"]["phase"], "complete">, string[]> = {
  internal_advice: ["chengdu_investment", "chengdu_finance", "chongqing_investment", "chongqing_finance"],
  policy_formation: ["chengdu_leader", "chongqing_leader"],
  policy_audit: ["policy_supervisor", "regional_coordinator"],
  stakeholder_reaction: ["talent_sme", "resident"],
  company_deliberation: ["company_ceo", "company_cfo", "investor", "company_board"],
  due_diligence: ["policy_supervisor", "due_diligence_service"],
  post_disclosure: ["talent_sme", "resident", "regional_coordinator", "policy_supervisor", "company_ceo", "company_cfo", "investor", "company_board", "company_board"],
  delivery: ["world_resource_service"],
  delivery_reaction: ["talent_sme", "resident"],
};

const nextPhase: Record<Exclude<WorldState["simulation"]["phase"], "complete">, WorldState["simulation"]["phase"]> = {
  internal_advice: "policy_formation", policy_formation: "policy_audit", policy_audit: "stakeholder_reaction",
  stakeholder_reaction: "company_deliberation", company_deliberation: "due_diligence", due_diligence: "post_disclosure",
  post_disclosure: "delivery", delivery: "delivery_reaction", delivery_reaction: "complete",
};

export function eligibleActors(state: WorldState): string[] {
  return state.simulation.phase === "complete" ? [] : [...phaseActors[state.simulation.phase]];
}

export async function continueAutonomously(engine: SimulationEngine, input: WorldState, options: ContinuationOptions = {}): Promise<AutonomousContinuation> {
  if ("actions" in options) throw new Error("AUTONOMOUS_ACTION_LIST_FORBIDDEN: scheduler derives candidates from eligible actors");
  let state = clone(input);
  if (state.simulation.mode !== "autonomous") throw new Error("AUTONOMOUS_MODE_REQUIRED: replay state cannot enter autonomous continuation");
  const steps: AutonomousStep[] = [];
  const eligibleOrder: AutonomousContinuation["eligibleOrder"] = [];
  const maxSteps = options.maxSteps ?? 100;
  while (state.simulation.phase !== "complete" && steps.length < maxSteps) {
    const phase = state.simulation.phase;
    const actors = eligibleActors(state);
    eligibleOrder.push({ phase, actors });
    for (const actorId of actors) {
      if (steps.length >= maxSteps) break;
      const result = await engine.proposeAndApplyActor(state, actorId);
      state = result.state;
      steps.push({ phase, actorId, candidateKind: result.candidate.kind, candidate: result.candidate, receiptId: result.receipt.receiptId, status: result.receipt.status, generationSource: result.generationSource, gateRejected: result.receipt.status === "REJECTED" });
    }
    if (steps.length >= maxSteps) break;
    state = advancePhase(state, nextPhase[phase]);
    if (options.stopAfterPhase === phase) break;
  }
  if (state.simulation.phase === "complete" && (options.terminateAtComplete ?? true) && !state.terminal) state = terminate(state, "autonomous phase state machine reached complete");
  return { state, steps, eligibleOrder };
}

function advancePhase(input: WorldState, next: WorldState["simulation"]["phase"]): WorldState {
  const state = clone(input);
  const before = state.simulation.phase;
  const version = state.worldVersion + 1;
  const causeId = deterministicId("phase", state.runId, before, next, version);
  state.simulation.phase = next;
  state.simulation.cycle += 1;
  state.worldVersion = version;
  const delta: StateDelta = { deltaId: deterministicId("delta", causeId, "simulation.phase"), causeId, path: "simulation.phase", before, after: next, actorId: "orchestrator", worldVersion: version };
  const event: WorldEvent = { eventId: deterministicId("event", state.runId, "StateChanged", causeId), eventType: "StateChanged", causeId, actorId: "orchestrator", worldVersion: version, occurredAt: new Date(Date.UTC(2026, 7, 11, 0, 0, version)).toISOString(), payload: { deltaIds: [delta.deltaId], semantic: "phase_transition" } };
  state.trace.push(delta);
  state.events.push(event);
  return state;
}
