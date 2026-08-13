import type { WorldState } from "../domain.js";
import { clamp, digest } from "../util.js";
import type { AgentDecisionProfile, CandidatePlan, DecisionOptionEvidence, FunctionId, NegotiationEvidence, TopsisRanking } from "./types.js";

const coreFunctions: Record<string, FunctionId[]> = {
  chengdu_leader: ["headquarters", "rd_center"],
  chongqing_leader: ["smart_factory", "supply_chain_base"],
  company_board: ["rd_center", "smart_factory"],
  regional_coordinator: ["rd_center", "smart_factory"],
};

/** Stable preferences are derived only from scenario seed + actor, never run/fork metadata. */
export function decisionProfileFor(state: WorldState, actorId: string): AgentDecisionProfile {
  const unit = profileUnit(state.snapshot.seed, actorId);
  const cityLeader = actorId.endsWith("_leader");
  const board = actorId === "company_board";
  return {
    actorId,
    riskTolerance: round2((cityLeader ? 0.42 : board ? 0.5 : 0.55) + unit * 0.18),
    reservationUtility: round2((cityLeader ? 43 : board ? 39 : 41) + unit * (cityLeader ? 8 : 7)),
    // Regional coordination may justify a limited sacrifice against the local
    // BATNA, but the previous 11–21 point range made acceptance too common.
    // Local coordination may trade away some BATNA value, but a city cannot
    // sacrifice more than 13.25 utility points merely for regional synergy.
    // Profiles still vary inside that public governance ceiling.
    maxConcession: round2(cityLeader
      ? Math.min(13.25, 10.1 + unit * 9.6)
      : (board ? 10 : 12) + unit * 9),
    coreFunctionFloor: [...(coreFunctions[actorId] ?? [])],
    fiscalOrLiquidityFloor: round2((cityLeader ? 27 : board ? 24 : 22) + (1 - unit) * 11),
  };
}

export function optionEvidenceFor(
  state: WorldState,
  actorId: string,
  candidates: CandidatePlan[],
  ranking: TopsisRanking | undefined,
): DecisionOptionEvidence[] {
  const profile = decisionProfileFor(state, actorId);
  const actorLean = actorId === "company_board" ? boardCityLean(state.snapshot.seed) : 0;
  return candidates.map((candidate) => {
    const row = ranking?.rows.find((item) => item.candidateId === candidate.candidateId);
    const baseUtility = candidate.optionType === "no_landing"
      ? profile.reservationUtility
      : absoluteUtility(state, actorId, candidate, (row?.closeness ?? 0) * 100, profile);
    // A board is not a single neutral equation.  Its stable private profile
    // includes a small location preference (talent-led vs manufacturing-led),
    // shared by paired A/B worlds but never derived from run/fork identity.
    // Public conditions remain much stronger than this ±2.4 point tie-breaker.
    const actorUtility = candidate.optionType === "chengdu_single" ? round2(clamp(baseUtility + actorLean * 2.4))
      : candidate.optionType === "chongqing_single" ? round2(clamp(baseUtility - actorLean * 2.4))
        : baseUtility;
    return {
      candidateId: candidate.candidateId,
      optionType: candidate.optionType,
      feasible: true,
      actorUtility,
      reservationUtility: profile.reservationUtility,
      utilityGap: round2(actorUtility - profile.reservationUtility),
      investmentMillionCny: candidate.investmentMillionCny,
      selectedFunctions: [...candidate.selectedFunctions],
      resourceCost: structuredClone(candidate.cityResources),
      longTermRisk: round2((candidate.dimensions.liquidityRisk + candidate.dimensions.resourcePressure + candidate.dimensions.fiscalCost) / 3),
      constraintEvidence: [...candidate.constraintEvidence],
    };
  });
}

export function negotiationEvidenceFor(
  state: WorldState,
  actorId: string,
  candidates: CandidatePlan[],
  ranking: TopsisRanking | undefined,
): NegotiationEvidence[] {
  if (!ranking) return [];
  const profile = decisionProfileFor(state, actorId);
  const utility = (candidate: CandidatePlan): number => candidate.optionType === "no_landing"
    ? profile.reservationUtility
    : absoluteUtility(state, actorId, candidate, (ranking.rows.find((row) => row.candidateId === candidate.candidateId)?.closeness ?? 0) * 100, profile);
  const alternatives = candidates.filter((candidate) => candidate.optionType !== "dual_city");
  const batna = [...alternatives].sort((left, right) => utility(right) - utility(left))[0];
  if (!batna) return [];
  const batnaUtility = utility(batna);
  return candidates.filter((candidate) => candidate.optionType === "dual_city").map((candidate) => {
    const planUtility = utility(candidate);
    const concessionCost = round2(Math.max(0, batnaUtility - planUtility));
    const cityId = actorCity(actorId);
    const assignedCore = profile.coreFunctionFloor.filter((functionId) => cityId ? candidate.assignments[functionId] === cityId : candidate.assignments[functionId] !== "none");
    const coreFunctionProtected = profile.coreFunctionFloor.length === 0 || assignedCore.length > 0;
    const withinConcessionBudget = concessionCost <= profile.maxConcession;
    const aboveReservation = planUtility >= profile.reservationUtility;
    const paretoFeasible = coreFunctionProtected && withinConcessionBudget && aboveReservation;
    return {
      planCandidateId: candidate.candidateId,
      actorId,
      batnaCandidateId: batna.candidateId,
      batnaUtility,
      reservationUtility: profile.reservationUtility,
      planUtility,
      utilityGap: round2(planUtility - batnaUtility),
      concessionCost,
      withinConcessionBudget,
      coreFunctionProtected,
      paretoFeasible,
      reasonCodes: [
        ...(coreFunctionProtected ? ["CORE_FUNCTION_PROTECTED"] : ["CORE_FUNCTION_LOST"]),
        ...(withinConcessionBudget ? ["CONCESSION_WITHIN_BUDGET"] : ["CONCESSION_EXCEEDS_BUDGET"]),
        ...(aboveReservation ? ["ABOVE_RESERVATION_UTILITY"] : ["BELOW_RESERVATION_UTILITY"]),
      ],
    };
  });
}

function actorCity(actorId: string): "chengdu" | "chongqing" | undefined {
  if (actorId.startsWith("chengdu")) return "chengdu";
  if (actorId.startsWith("chongqing")) return "chongqing";
  return undefined;
}

function absoluteUtility(state: WorldState, actorId: string, candidate: CandidatePlan, relativeUtility: number, profile: AgentDecisionProfile): number {
  const systemHealth = (state.metrics.projectViability + state.metrics.financingConfidence + state.company.bindingOrderRatio * 100) / 300;
  const cityId = actorCity(actorId);
  const localSignal = cityId === "chengdu" ? state.stakeholders.talentAttraction : cityId === "chongqing" ? state.stakeholders.supplyChainReadiness : 50;
  const risk = (candidate.dimensions.liquidityRisk + candidate.dimensions.resourcePressure + candidate.dimensions.fiscalCost) / 3;
  const excessRisk = Math.max(0, risk - profile.riskTolerance * 100);
  const comparative = state.stakeholders.talentAttraction - state.stakeholders.supplyChainReadiness;
  const candidateCity = candidate.optionType === "chengdu_single" ? "chengdu"
    : candidate.optionType === "chongqing_single" ? "chongqing"
      : candidate.optionType === "reduced_scope" ? actorCityFromCandidate(candidate) : undefined;
  // Once a city signal leaves the balanced zone, its single-city option gains
  // progressively more execution confidence. The ramp avoids a hidden cliff at
  // 90 while preserving the balanced default scenario.
  const extremeSignalBonus = candidateCity === "chengdu" ? Math.max(0, state.stakeholders.talentAttraction - 70) * 0.34
    : candidateCity === "chongqing" ? Math.max(0, state.stakeholders.supplyChainReadiness - 70) * 0.34 : 0;
  const comparativeBonus = candidateCity === "chengdu" ? comparative * 0.309 : candidateCity === "chongqing" ? -comparative * 0.309 : 0;
  return round2(clamp(relativeUtility * 0.5 + systemHealth * 40 + (localSignal - 50) * (cityId ? 0.18 : 0) + comparativeBonus + extremeSignalBonus - excessRisk * 0.22));
}

function actorCityFromCandidate(candidate: CandidatePlan): "chengdu" | "chongqing" | undefined {
  const used = new Set(Object.values(candidate.assignments).filter((value) => value !== "none"));
  if (used.size !== 1) return undefined;
  return used.has("chengdu") ? "chengdu" : used.has("chongqing") ? "chongqing" : undefined;
}

function profileUnit(seed: number, actorId: string): number {
  const hex = digest({ seed, actorId, profileVersion: "agent-decision-profile.v2" }).slice(0, 8);
  return Number.parseInt(hex, 16) / 0xffffffff;
}

function boardCityLean(seed: number): number {
  return profileUnit(seed, "company_board_city_lean") * 2 - 1;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
