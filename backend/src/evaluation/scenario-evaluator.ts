import type { Outcome, WorldState } from "../domain.js";
import { commitmentConsistency } from "../rules/commitments.js";

export interface EvaluationFailure {
  code: string;
  message: string;
  causeId?: string;
}

export interface ScenarioEvaluation {
  runId: string;
  outcome: Outcome["label"] | "UNRESOLVED";
  valid: boolean;
  objective: number;
  fitness: number;
  metrics: {
    legalActionRate: number;
    rejectedActionsWithoutDelta: number;
    causalTraceCoverage: number;
    decisionSupportCoverage: number;
    commitmentConsistency: number;
    formalOutcomeChain: number;
    longTermImpactCoverage: number;
  };
  failures: EvaluationFailure[];
}

/**
 * CityScope equivalent of the courier solver's Evaluation boundary:
 * parse a completed run, validate the solution independently, then calculate
 * objective and fitness separately. It never changes the simulated world.
 */
export function evaluateScenario(state: WorldState): ScenarioEvaluation {
  const failures: EvaluationFailure[] = [];
  const applied = state.receipts.filter((receipt) => receipt.status === "APPLIED");
  const rejected = state.receipts.filter((receipt) => receipt.status === "REJECTED");
  const rejectedWithoutDelta = rejected.filter((receipt) => receipt.deltas.length === 0).length;
  for (const receipt of rejected) {
    if (receipt.deltas.length > 0) failures.push({ code: "REJECTED_ACTION_MUTATED_WORLD", message: "被拒行动产生了 StateDelta", causeId: receipt.actionId });
  }

  const knownCauses = new Set([...state.receipts.map((receipt) => receipt.actionId), ...state.events.map((event) => event.causeId)]);
  const traced = state.trace.filter((delta) => delta.causeId && delta.actorId && delta.worldVersion > 0 && knownCauses.has(delta.causeId)).length;
  const decisionActions = state.events.filter((event) => event.eventType === "AgentActionProposed" && [
    "SUBMIT_POLICY_PACK", "REVISE_POLICY_PACK", "PROPOSE_COORDINATION_PLAN", "ACCEPT_POLICY", "ACCEPT_COORDINATION_PLAN",
  ].includes(String(event.payload.kind)));
  const supported = decisionActions.filter((event) => {
    const support = event.payload.decisionSupport as { optimizer?: { status?: string }; candidates?: unknown[] } | undefined;
    return ["OPTIMAL", "FEASIBLE"].includes(String(support?.optimizer?.status)) && (support?.candidates?.length ?? 0) > 0;
  }).length;
  if (decisionActions.length && supported !== decisionActions.length) failures.push({ code: "DECISION_SUPPORT_MISSING", message: "关键正式行动没有可行 OR-Tools/TOPSIS 证据" });

  const consistency = commitmentConsistency(state);
  if (!consistency.consistent) failures.push({ code: "COMMITMENT_INCONSISTENT", message: consistency.violations.join("；") });
  const formalOutcome = validateFormalOutcome(state, failures);
  const impactCoverage = Number(new Set(state.impactAssessments.map((item) => item.horizonMonths)).size === 2);
  if (!impactCoverage) failures.push({ code: "LONG_TERM_IMPACT_MISSING", message: "落地项目缺少 12/24 月影响评估" });

  const metrics = {
    legalActionRate: ratio(applied.length, state.receipts.length),
    rejectedActionsWithoutDelta: ratio(rejectedWithoutDelta, rejected.length),
    causalTraceCoverage: ratio(traced, state.trace.length),
    decisionSupportCoverage: ratio(supported, decisionActions.length),
    commitmentConsistency: Number(consistency.consistent),
    formalOutcomeChain: Number(formalOutcome),
    longTermImpactCoverage: impactCoverage,
  };
  const objective = round4(
    metrics.causalTraceCoverage * 0.15
    + metrics.decisionSupportCoverage * 0.2
    + metrics.commitmentConsistency * 0.15
    + metrics.formalOutcomeChain * 0.3
    + metrics.longTermImpactCoverage * 0.2,
  );
  const fitness = failures.length ? round4(objective / (1 + failures.length * 0.5)) : objective;
  return {
    runId: state.runId,
    outcome: state.simulation.classification?.label ?? "UNRESOLVED",
    valid: failures.length === 0,
    objective,
    fitness,
    metrics,
    failures,
  };
}

function validateFormalOutcome(state: WorldState, failures: EvaluationFailure[]): boolean {
  const decision = state.finalDecision;
  const outcome = state.simulation.classification?.label;
  if (!state.terminal || !decision || !outcome) {
    failures.push({ code: "FORMAL_OUTCOME_MISSING", message: "终态、FinalDecision 或 Outcome 缺失" });
    return false;
  }
  if (decision.type === "regional_exit") {
    const valid = outcome === "PROJECT_EXITED" && ["withdrawn", "closed"].includes(state.cities.chengdu.bidStatus) && ["withdrawn", "closed"].includes(state.cities.chongqing.bidStatus) && state.company.projectStage === "exited";
    if (!valid) failures.push({ code: "INVALID_EXIT_CHAIN", message: "退出结局没有两城撤回与董事会退出的完整链路" });
    return valid;
  }
  if (decision.type === "coordination") {
    const plan = state.coordinationPlans.find((item) => item.planId === decision.coordinationPlanId);
    const valid = outcome === "DUAL_CITY" && plan?.status === "accepted" && plan.auditStatus === "approved" && plan.responses.chengdu?.decision !== "reject" && plan.responses.chongqing?.decision !== "reject";
    if (!valid) failures.push({ code: "INVALID_COORDINATION_CHAIN", message: "协作结局缺少双方分别同意、审计或董事会接受" });
    return valid;
  }
  const winner = decision.cityId;
  const loser = winner === "chengdu" ? "chongqing" : "chengdu";
  const policy = Object.values(state.cities).flatMap((city) => city.policies).find((item) => item.policyId === decision.policyId);
  const valid = Boolean(policy?.status === "accepted" && policy.auditStatus === "approved" && state.cities[winner!].bidStatus === "accepted" && ["withdrawn", "closed"].includes(state.cities[loser].bidStatus) && outcome === (winner === "chengdu" ? "CHENGDU_LED" : "CHONGQING_LED"));
  if (!valid) failures.push({ code: "INVALID_SINGLE_CITY_CHAIN", message: "单城结局缺少胜方签约、审计或败方撤回" });
  return valid;
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 1 : round4(numerator / denominator);
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
