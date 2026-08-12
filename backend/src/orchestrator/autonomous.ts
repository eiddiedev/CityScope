import type { AgentAction, StateDelta, WorldEvent, WorldState } from "../domain.js";
import { clone, deterministicId } from "../util.js";
import { terminate } from "../world/outcome.js";
import type { ActorStepResult, SimulationEngine } from "./engine.js";
import type { ProviderUsage } from "../providers/types.js";

export interface AutonomousStep {
  phase: WorldState["simulation"]["phase"];
  actorId: string;
  candidateKind: ActorStepResult["candidate"]["kind"];
  candidate: AgentAction;
  receiptId: string;
  status: ActorStepResult["receipt"]["status"];
  generationSource: ActorStepResult["generationSource"];
  gateRejected: boolean;
  usage?: ProviderUsage;
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
  /** Runtime-only progress hook. It never enters prompts, checkpoints, or the public contract. */
  onStep?: (step: AutonomousStep, state: WorldState) => void | Promise<void>;
}

const phaseActors: Record<Exclude<WorldState["simulation"]["phase"], "complete">, string[]> = {
  internal_advice: ["chengdu_investment", "chengdu_finance", "chongqing_investment", "chongqing_finance"],
  policy_formation: ["chengdu_leader", "chongqing_leader"],
  policy_audit: ["policy_supervisor"],
  stakeholder_reaction: ["talent_sme", "resident"],
  company_deliberation: ["company_ceo", "company_cfo", "investor", "company_board"],
  due_diligence: ["policy_supervisor", "due_diligence_service"],
  risk_reassessment: ["talent_sme", "resident", "chengdu_investment", "chengdu_finance", "chongqing_investment", "chongqing_finance"],
  policy_revision: ["chengdu_leader", "chongqing_leader"],
  coordination_debate: ["regional_coordinator", "chengdu_leader", "chongqing_leader"],
  coordination_resolution: ["chengdu_leader", "chongqing_leader", "policy_supervisor"],
  final_deliberation: ["company_ceo", "company_cfo", "investor", "company_board"],
  post_disclosure: ["talent_sme", "resident", "regional_coordinator", "policy_supervisor", "company_ceo", "company_cfo", "investor", "company_board"],
  delivery: ["world_resource_service"],
  delivery_reaction: ["talent_sme", "resident"],
  impact_assessment: ["world_resource_service"],
};

const nextPhase: Record<Exclude<WorldState["simulation"]["phase"], "post_disclosure" | "complete">, WorldState["simulation"]["phase"]> = {
  internal_advice: "policy_formation", policy_formation: "policy_audit", policy_audit: "stakeholder_reaction",
  stakeholder_reaction: "company_deliberation", company_deliberation: "due_diligence", due_diligence: "risk_reassessment",
  risk_reassessment: "policy_revision", policy_revision: "coordination_debate", coordination_debate: "coordination_resolution",
  coordination_resolution: "final_deliberation", final_deliberation: "delivery", delivery: "delivery_reaction",
  delivery_reaction: "impact_assessment", impact_assessment: "complete",
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
    const queue = phase === "coordination_debate" && shouldCoordinate(state)
      ? ["regional_coordinator", "chengdu_leader", "chongqing_leader", "regional_coordinator", "chengdu_leader", "chongqing_leader", "regional_coordinator"]
      : phase === "coordination_debate"
        ? []
        : phase === "coordination_resolution"
          ? shouldCoordinate(state) ? [...actors] : ["policy_supervisor"]
        : [...actors];
    const followUps = new Map<string, number>();
    while (queue.length > 0) {
      const actorId = queue.shift();
      if (!actorId) break;
      if (steps.length >= maxSteps) break;
      const result = await engine.proposeAndApplyActor(state, actorId);
      state = result.state;
      const step: AutonomousStep = { phase, actorId, candidateKind: result.candidate.kind, candidate: result.candidate, receiptId: result.receipt.receiptId, status: result.receipt.status, generationSource: result.generationSource, gateRejected: result.receipt.status === "REJECTED", ...(result.usage ? { usage: result.usage } : {}) };
      steps.push(step);
      await options.onStep?.(clone(step), clone(state));
      const used = followUps.get(actorId) ?? 0;
      if (used < followUpBudget(phase, actorId) && !state.finalDecision) {
        followUps.set(actorId, used + 1);
        queue.push(actorId);
      }
    }
    if (steps.length >= maxSteps) break;
    state = advancePhase(state, nextPhaseForState(state, phase));
    if (options.stopAfterPhase === phase) break;
  }
  if (state.simulation.phase === "complete" && (options.terminateAtComplete ?? true) && !state.terminal) state = terminate(state, terminalReason(state));
  return { state, steps, eligibleOrder };
}

export function nextPhaseForState(state: WorldState, phase: Exclude<WorldState["simulation"]["phase"], "complete">): WorldState["simulation"]["phase"] {
  if (phase === "final_deliberation") {
    if (state.company.projectStage === "signed" || state.company.projectStage === "delivery") return "delivery";
    if (state.company.projectStage === "exited") return "impact_assessment";
    throw new Error(`BOARD_RESOLUTION_REQUIRED: final deliberation ended with projectStage=${state.company.projectStage}`);
  }
  if (phase !== "post_disclosure") return nextPhase[phase];
  if (state.company.projectStage === "signed" || state.company.projectStage === "delivery") return "delivery";
  if (state.company.projectStage === "exited") return "delivery_reaction";
  throw new Error(`BOARD_RESOLUTION_REQUIRED: post-disclosure ended with projectStage=${state.company.projectStage}`);
}

function terminalReason(state: WorldState): string {
  if (state.company.projectStage === "exited") return "autonomous decision horizon completed after explicit project exit";
  if (["signed", "delivery", "completed"].includes(state.company.projectStage)) return "autonomous decision horizon completed after an accepted policy entered delivery";
  return `autonomous decision horizon completed at projectStage=${state.company.projectStage}`;
}

function followUpBudget(phase: Exclude<WorldState["simulation"]["phase"], "complete">, actorId: string): number {
  // The board may first decide on the best open policy and then explicitly
  // dispose of the remaining offer. This is a second deliberation turn, not a
  // duplicated registry entry or a prewritten outcome branch.
  return ["post_disclosure", "final_deliberation"].includes(phase) && actorId === "company_board" ? 1 : 0;
}

function shouldCoordinate(state: WorldState): boolean {
  return ["competing", "revising"].includes(state.cities.chengdu.bidStatus)
    && ["competing", "revising"].includes(state.cities.chongqing.bidStatus);
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
