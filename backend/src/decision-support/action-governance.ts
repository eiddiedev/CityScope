import { SCHEMA_VERSION, type AgentAction, type CityId, type PolicyTerm, type WorldState } from "../domain.js";
import { deterministicId } from "../util.js";
import type { CandidatePlan, DecisionOptionEvidence, DecisionSupportContext } from "./types.js";

/**
 * The model chooses an option and a stance. Trusted code attaches calculated
 * money, resources and utility evidence before the action reaches the gates.
 */
export function governDecisionAction(state: WorldState, raw: AgentAction, support?: DecisionSupportContext): AgentAction {
  if (!support) return raw;
  const cityId = cityForActor(raw.actorId);
  if (["MAINTAIN_CITY_OFFER", "REVISE_POLICY_PACK", "WITHDRAW_CITY_OFFER"].includes(raw.kind) && cityId) {
    return governCityRevision(state, raw, support, cityId);
  }
  if (["SUBMIT_POLICY_PACK", "REVISE_POLICY_PACK"].includes(raw.kind) && cityId) {
    const candidate = selectedCityCandidate(raw, support, cityId);
    if (!candidate) return raw;
    const decisionEvidence = evidenceFor(support, candidate.candidateId);
    const current = [...state.cities[cityId].policies].reverse().find((policy) => policy.status === "issued");
    return restamp(raw, state, {
      policyId: deterministicId("policy", cityId, raw.kind, state.worldVersion, candidate.candidateId),
      cityId,
      decisionMode: "COMPROMISE",
      candidateId: candidate.candidateId,
      investmentMillionCny: candidate.investmentMillionCny,
      terms: policyTerms(candidate, cityId),
      ...(raw.kind === "REVISE_POLICY_PACK" && current ? { supersedesPolicyId: current.policyId } : {}),
      ...(decisionEvidence ? { decisionEvidence: policyDecisionEvidence(decisionEvidence) } : {}),
    });
  }
  if (raw.kind === "PROPOSE_COORDINATION_PLAN") {
    const candidate = selectedCandidate(raw, support, "dual_city");
    if (!candidate) return raw;
    const policies = Object.values(state.cities).flatMap((city) => city.policies).filter((policy) => policy.status === "issued");
    return restamp(raw, state, {
      planId: deterministicId("coordination-plan", state.worldVersion, candidate.candidateId),
      candidateId: candidate.candidateId,
      sourcePolicyIds: policies.map((policy) => policy.policyId),
      assignments: candidate.assignments,
      cityTerms: {
        chengdu: policyTerms(candidate, "chengdu"),
        chongqing: policyTerms(candidate, "chongqing"),
      },
      investmentMillionCny: candidate.investmentMillionCny,
      milestones: [
        { metric: "bindingOrderRatio", operator: ">=", value: 0.3 },
        { metric: "verifiedJobs", operator: ">=", value: Math.max(180, Math.round(candidate.dimensions.employment * 5)) },
      ],
      commonPlatform: { name: "成渝具身智能联合测试平台", payerShares: payerShares(candidate) },
      concessions: { chengdu: ["不重复补贴制造功能"], chongqing: ["不重复补贴研发总部"] },
    });
  }
  if (raw.kind === "RESPOND_COORDINATION_PLAN" && cityId) {
    const planId = String(raw.payload.planId ?? state.coordinationPlans.find((plan) => plan.status === "proposed")?.planId ?? "");
    const plan = state.coordinationPlans.find((item) => item.planId === planId);
    const negotiation = support.negotiation.find((item) => item.actorId === raw.actorId && item.planCandidateId === plan?.candidateId);
    if (!plan || !negotiation) return raw;
    const decision = !negotiation.paretoFeasible ? "reject" : negotiation.utilityGap < 0 ? "conditional" : "accept";
    return restamp(raw, state, {
      planId,
      cityId,
      decision,
      conditions: decision === "conditional" ? ["核心功能与分期兑现写入协议"] : decision === "accept" ? ["按功能分工和里程碑执行"] : [],
      candidateId: plan.candidateId,
      utility: negotiation.planUtility,
      reservationUtility: negotiation.reservationUtility,
      utilityGap: negotiation.utilityGap,
      concessionCost: negotiation.concessionCost,
      reasonCodes: negotiation.reasonCodes,
    });
  }
  if (raw.actorId === "company_board" && state.simulation.phase === "final_deliberation") {
    return governBoardDecision(state, raw, support);
  }
  return raw;
}

function governCityRevision(state: WorldState, raw: AgentAction, support: DecisionSupportContext, cityId: CityId): AgentAction {
  const candidate = selectedCityCandidate(raw, support, cityId);
  const evidence = candidate ? evidenceFor(support, candidate.candidateId) : undefined;
  if (!candidate || !evidence) return raw;
  const profile = support.actorDecisionProfile;
  const longTermRisk = evidence.longTermRisk;
  const systemicRedLine = state.metrics.financingConfidence < (profile?.fiscalOrLiquidityFloor ?? 30)
    || state.metrics.projectViability < 25
    || state.company.bindingOrderRatio < 0.25;
  const clearlyUnacceptable = evidence.utilityGap < -4;
  const clearlyAcceptable = evidence.utilityGap >= 22
    && longTermRisk <= (profile?.riskTolerance ?? 0.5) * 100;
  // Clear regions are governed deterministically.  In the grey region the
  // model's maintain/revise/withdraw stance is preserved, but trusted code
  // still attaches the selected candidate and calculated evidence.
  const governedKind: AgentAction["kind"] = systemicRedLine || clearlyUnacceptable
    ? "WITHDRAW_CITY_OFFER"
    : clearlyAcceptable
      ? "MAINTAIN_CITY_OFFER"
      : raw.kind;
  const reasonCodes = systemicRedLine
    ? ["SYSTEMIC_EXECUTION_RISK", "CITY_RED_LINE_REACHED"]
    : clearlyUnacceptable
      ? ["BELOW_RESERVATION_UTILITY"]
      : clearlyAcceptable
        ? ["UTILITY_CLEARLY_ABOVE_RESERVATION", "RISK_WITHIN_TOLERANCE"]
        : decisionReasonCodes(raw, evidence);
  if (governedKind === "REVISE_POLICY_PACK") {
    const current = [...state.cities[cityId].policies].reverse().find((policy) => policy.status === "issued");
    if (!current) return raw;
    return restamp({ ...raw, kind: governedKind }, state, {
      policyId: deterministicId("policy", cityId, governedKind, state.worldVersion, candidate.candidateId),
      cityId,
      decisionMode: "COMPROMISE",
      candidateId: candidate.candidateId,
      investmentMillionCny: candidate.investmentMillionCny,
      supersedesPolicyId: current.policyId,
      terms: policyTerms(candidate, cityId),
      decisionEvidence: policyDecisionEvidence(evidence),
    });
  }
  return restamp({ ...raw, kind: governedKind }, state, cityDecisionPayload(cityId, evidence, reasonCodes));
}

function governBoardDecision(state: WorldState, raw: AgentAction, support: DecisionSupportContext): AgentAction {
  const exit = support.options.find((item) => item.optionType === "no_landing");
  const forcedExit = state.metrics.financingConfidence < 10
    || state.metrics.projectViability < 25
    || state.company.bindingOrderRatio < 0.25;
  const executable = support.options.flatMap((evidence) => {
    const target = boardTargetForEvidence(state, evidence);
    return target ? [{ evidence, ...target }] : [];
  });
  const best = [...executable].sort((left, right) => right.evidence.actorUtility - left.evidence.actorUtility
    || left.evidence.candidateId.localeCompare(right.evidence.candidateId))[0];
  const belowReservation = !best || best.evidence.actorUtility <= (exit?.actorUtility ?? support.actorDecisionProfile?.reservationUtility ?? 50);
  if (forcedExit || belowReservation) {
    if (!exit) return raw;
    const reasonCodes = forcedExit
      ? ["SYSTEMIC_EXECUTION_RISK", "BELOW_BOARD_SIGNING_FLOOR"]
      : ["NO_EXECUTABLE_OPTION_ABOVE_RESERVATION"];
    return restamp({ ...raw, kind: "EXIT_PROJECT" }, state, {
      reason: "全部可执行方案均未超过董事会保留效用",
      candidateId: exit.candidateId,
      utility: exit.actorUtility,
      reservationUtility: exit.reservationUtility,
      utilityGap: exit.utilityGap,
      reasonCodes,
    });
  }
  return restamp({ ...raw, kind: best.kind }, state, {
    ...best.payload,
    candidateId: best.evidence.candidateId,
    utility: best.evidence.actorUtility,
    reservationUtility: best.evidence.reservationUtility,
    utilityGap: best.evidence.utilityGap,
    reasonCodes: ["HIGHEST_EXECUTABLE_UTILITY", "ABOVE_RESERVATION_UTILITY"],
  });
}

function boardTargetForEvidence(
  state: WorldState,
  evidence: DecisionOptionEvidence,
): { kind: "ACCEPT_POLICY" | "ACCEPT_COORDINATION_PLAN"; payload: Record<string, unknown> } | undefined {
  if (evidence.optionType === "dual_city") {
    const plan = state.coordinationPlans.find((item) => item.status === "proposed"
      && item.auditStatus === "approved"
      && item.candidateId === evidence.candidateId
      && item.responses.chengdu
      && item.responses.chongqing
      && ![item.responses.chengdu.decision, item.responses.chongqing.decision].includes("reject"));
    return plan ? { kind: "ACCEPT_COORDINATION_PLAN", payload: { planId: plan.planId } } : undefined;
  }
  if (["chengdu_single", "chongqing_single", "reduced_scope"].includes(evidence.optionType)) {
    const policy = Object.values(state.cities).flatMap((city) => city.policies)
      .find((item) => item.status === "issued" && item.auditStatus === "approved" && item.candidateId === evidence.candidateId);
    return policy ? { kind: "ACCEPT_POLICY", payload: { policyId: policy.policyId } } : undefined;
  }
  return undefined;
}

export function policyTerms(candidate: CandidatePlan, cityId: CityId): PolicyTerm[] {
  const resources = candidate.cityResources[cityId];
  const prefix = cityId === "chengdu" ? "cd" : "cq";
  const terms: PolicyTerm[] = [];
  if (resources.fiscalMillionCny > 0) terms.push({ termId: `${prefix}_cash_${candidate.candidateId.slice(-6)}`, type: "cash_support", amountMillionCny: resources.fiscalMillionCny, trigger: { metric: cityId === "chengdu" ? "verifiedJobs" : "annualOutputMillionCny", operator: ">=", value: cityId === "chengdu" ? 220 : 1_400 }, deadline: "year_2", failureAction: "clawback" });
  if (resources.landHectares > 0) terms.push({ termId: `${prefix}_land_${candidate.candidateId.slice(-6)}`, type: "land", quantity: resources.landHectares });
  if (resources.factorySqm > 0) terms.push({ termId: `${prefix}_facility_${candidate.candidateId.slice(-6)}`, type: "facility", quantity: resources.factorySqm });
  if (resources.energyMw > 0) terms.push({ termId: `${prefix}_energy_${candidate.candidateId.slice(-6)}`, type: "energy", quantity: resources.energyMw });
  if (resources.talentHousingUnits > 0) terms.push({ termId: `${prefix}_housing_${candidate.candidateId.slice(-6)}`, type: "talent_housing", quantity: resources.talentHousingUnits });
  return terms;
}

function selectedCityCandidate(action: AgentAction, support: DecisionSupportContext, cityId: CityId): CandidatePlan | undefined {
  const requested = selectedCandidate(action, support);
  if (requested && candidateBelongsToCity(requested, cityId)) return requested;
  const ownType = cityId === "chengdu" ? "chengdu_single" : "chongqing_single";
  const allowed = support.candidates.filter((candidate) => candidate.optionType === ownType || (candidate.optionType === "reduced_scope" && candidateBelongsToCity(candidate, cityId)));
  return [...allowed].sort((left, right) => optionUtility(support, right.candidateId) - optionUtility(support, left.candidateId))[0];
}

function selectedCandidate(action: AgentAction, support: DecisionSupportContext, type?: CandidatePlan["optionType"]): CandidatePlan | undefined {
  const requested = support.candidates.find((candidate) => candidate.candidateId === String(action.payload.candidateId ?? "") && (!type || candidate.optionType === type));
  if (requested) return requested;
  return support.candidates.find((candidate) => !type || candidate.optionType === type);
}

function candidateBelongsToCity(candidate: CandidatePlan, cityId: CityId): boolean {
  const used = new Set(Object.values(candidate.assignments).filter((value) => value !== "none"));
  return used.size === 1 && used.has(cityId);
}

function evidenceFor(support: DecisionSupportContext, candidateId: string): DecisionOptionEvidence | undefined {
  return support.options.find((item) => item.candidateId === candidateId);
}

function optionUtility(support: DecisionSupportContext, candidateId: string): number {
  return evidenceFor(support, candidateId)?.actorUtility ?? 0;
}

function decisionReasonCodes(action: AgentAction, evidence: DecisionOptionEvidence): string[] {
  const supplied = Array.isArray(action.payload.reasonCodes) ? action.payload.reasonCodes.filter((item): item is string => typeof item === "string") : [];
  return supplied.length ? supplied.slice(0, 4) : [evidence.utilityGap >= 0 ? "ABOVE_RESERVATION_UTILITY" : "BELOW_RESERVATION_UTILITY", "CANDIDATE_EVIDENCE_ATTACHED"];
}

function cityDecisionPayload(cityId: CityId, evidence: DecisionOptionEvidence, reasonCodes: string[]): Record<string, unknown> {
  return {
    cityId,
    candidateId: evidence.candidateId,
    utility: evidence.actorUtility,
    reservationUtility: evidence.reservationUtility,
    utilityGap: evidence.utilityGap,
    reasonCodes,
  };
}

function policyDecisionEvidence(evidence: DecisionOptionEvidence): Record<string, unknown> {
  return {
    candidateId: evidence.candidateId,
    optionType: evidence.optionType,
    utility: evidence.actorUtility,
    reservationUtility: evidence.reservationUtility,
    utilityGap: evidence.utilityGap,
    longTermRisk: evidence.longTermRisk,
    reasonCodes: [evidence.utilityGap >= 0 ? "ABOVE_RESERVATION_UTILITY" : "BELOW_RESERVATION_UTILITY", "CANDIDATE_EVIDENCE_ATTACHED"],
  };
}

function payerShares(candidate: CandidatePlan): Record<CityId, number> {
  const chengdu = candidate.cityResources.chengdu.fiscalMillionCny;
  const chongqing = candidate.cityResources.chongqing.fiscalMillionCny;
  const total = chengdu + chongqing || 1;
  const chengduShare = Math.round(chengdu / total * 100) / 100;
  return { chengdu: chengduShare, chongqing: Math.round((1 - chengduShare) * 100) / 100 };
}

function cityForActor(actorId: string): CityId | undefined {
  if (actorId.startsWith("chengdu")) return "chengdu";
  if (actorId.startsWith("chongqing")) return "chongqing";
  return undefined;
}

function restamp(action: AgentAction, state: WorldState, payload: Record<string, unknown>): AgentAction {
  return {
    ...action,
    payload,
    actionId: deterministicId("governed-action", action.actorId, action.kind, state.runId, state.worldVersion, payload),
    schemaVersion: SCHEMA_VERSION,
  };
}
