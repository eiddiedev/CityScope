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
  const decision = state.finalDecision;
  if (!decision) throw new Error("OUTCOME_UNRESOLVED: terminal state has no formal FinalDecision");
  const accepted = Object.values(state.cities).flatMap((city) => city.policies).filter((policy) => policy.status === "accepted");
  const activeCommitments = state.commitments.filter((commitment) => ["approved", "due", "paid"].includes(commitment.status));
  const openPolicies = Object.values(state.cities).flatMap((city) => city.policies).filter((policy) => policy.status === "issued");
  let label: Outcome["label"];
  let decisionCode: string;
  const approvals: string[] = [];
  if (decision.type === "regional_exit") {
    if (!["withdrawn", "closed"].includes(state.cities.chengdu.bidStatus) || !["withdrawn", "closed"].includes(state.cities.chongqing.bidStatus) || state.company.projectStage !== "exited") throw new Error("OUTCOME_INVALID: regional exit requires both city offers to close before board exit");
    label = "PROJECT_EXITED"; decisionCode = "board_selected_no_landing";
  } else if (decision.type === "coordination") {
    const plan = state.coordinationPlans.find((item) => item.planId === decision.coordinationPlanId);
    if (!plan || plan.status !== "accepted" || plan.auditStatus !== "approved" || !plan.responses.chengdu || !plan.responses.chongqing || [plan.responses.chengdu.decision, plan.responses.chongqing.decision].includes("reject")) throw new Error("OUTCOME_INVALID: coordination requires an audited plan accepted by both cities and the board");
    const active = new Set(Object.values(plan.assignments).filter((city) => city !== "none"));
    if (!active.has("chengdu") || !active.has("chongqing")) throw new Error("OUTCOME_INVALID: coordination plan does not materially allocate both cities");
    label = "DUAL_CITY"; decisionCode = "audited_coordination_plan"; approvals.push(plan.planId, `${plan.planId}:chengdu`, `${plan.planId}:chongqing`);
  } else {
    const cityId = decision.cityId;
    const otherCity = cityId === "chengdu" ? "chongqing" : "chengdu";
    const policy = accepted.find((item) => item.policyId === decision.policyId && item.cityId === cityId && item.auditStatus === "approved");
    if (!cityId || !policy || !["withdrawn", "closed"].includes(state.cities[otherCity].bidStatus) || state.cities[cityId].bidStatus !== "accepted") throw new Error("OUTCOME_INVALID: single-city result requires an audited accepted policy and the other city to close its bid");
    label = cityId === "chengdu" ? "CHENGDU_LED" : "CHONGQING_LED";
    decisionCode = cityId === "chengdu" ? "accept_chengdu_after_chongqing_closed" : "accept_chongqing_after_chengdu_closed";
    approvals.push(policy.policyId);
  }
  const requiredActionIds = state.receipts.filter((receipt) => receipt.status === "APPLIED" && ["WITHDRAW_CITY_OFFER", "RESPOND_COORDINATION_PLAN", "AUDIT_COORDINATION_PLAN", "ACCEPT_COORDINATION_PLAN", "ACCEPT_POLICY", "EXIT_PROJECT"].includes(state.agentMemory[receipt.actorId]?.find((item) => item.causeId === receipt.actionId)?.summary.split(":")[0] ?? "")).map((receipt) => receipt.actionId);
  return {
    label,
    evidence: [
      `terminal=${state.terminal}`,
      `decision=${decisionCode}`,
      `finalDecision=${decision.decisionId}`,
      `stage=${state.company.projectStage}`,
      `acceptedPolicies=${accepted.map((policy) => policy.policyId).join(",") || "none"}`,
      `openPolicies=${openPolicies.map((policy) => policy.policyId).join(",") || "none"}`,
      `activeCommitments=${activeCommitments.map((commitment) => commitment.commitmentId).join(",") || "none"}`,
      `viability=${state.metrics.projectViability}`,
    ],
    classifiedAtVersion: state.worldVersion,
    basis: { decisionType: decision.type, finalDecisionId: decision.decisionId, requiredActionIds, approvalIds: approvals, causeIds: [decision.causeId] },
  };
}

export function classifyAndAttachOutcome(input: WorldState): WorldState {
  const classification = classifyOutcome(input);
  const state = clone(input);
  const version = state.worldVersion + 1;
  const causeId = deterministicId("outcome", state.runId, version);
  const before = { status: state.simulation.outcomeStatus };
  state.simulation.outcomeStatus = "classified";
  state.simulation.classification = classification;
  const after = { status: state.simulation.outcomeStatus, classification };
  const delta: StateDelta = { deltaId: deterministicId("delta", causeId, "simulation.classification"), causeId, path: "simulation.classification", before, after, actorId: "outcome_classifier", worldVersion: version };
  const event: WorldEvent = { eventId: deterministicId("event", state.runId, "OutcomeClassified", version), eventType: "OutcomeClassified", causeId, actorId: "outcome_classifier", worldVersion: version, occurredAt: new Date(Date.UTC(2026, 7, 11, 0, 0, version)).toISOString(), payload: { label: classification.label, evidence: classification.evidence } };
  state.worldVersion = version;
  state.trace.push(delta);
  state.events.push(event);
  return state;
}
