import type { CityState, Commitment, DebateThread, Fact, PolicyPack, WorldState } from "../domain.js";
import { cityCompetitionForState, type CityCompetitionEvidence } from "../decision-support/city-competition.js";

/**
 * The model should decide from domain facts, not from execution metadata.
 * This view deliberately excludes run ids, world versions, receipts, events,
 * traces and other agents' memories so equivalent worlds can be reused safely.
 */
export interface AgentDecisionView {
  scenarioId: string;
  actorId: string;
  round: number;
  phase: WorldState["simulation"]["phase"];
  cycle: number;
  metrics: WorldState["metrics"];
  stakeholders: WorldState["stakeholders"];
  cities: Record<"chengdu" | "chongqing", DecisionCity>;
  company: Omit<WorldState["company"], "internalAdvice"> & { internalAdvice: DecisionAdvice[] };
  visibleFacts: DecisionFact[];
  debateThreads: DebateThread[];
  commitments: DecisionCommitment[];
  coordinationOpinions: WorldState["coordinationOpinions"];
  coordinationPlans: WorldState["coordinationPlans"];
  finalDecision: WorldState["finalDecision"] | null;
  cityCompetition: Omit<CityCompetitionEvidence, "generatedAtWorldVersion">;
  ownMemory: string[];
}

interface DecisionAdvice {
  actorId: string;
  proposal: unknown;
}

interface DecisionCity extends Omit<CityState, "internalAdvice" | "policies" | "policyRevisions" | "offerDecision"> {
  internalAdvice: DecisionAdvice[];
  policies: DecisionPolicy[];
  policyRevisions: Array<Omit<CityState["policyRevisions"][number], "createdAtVersion">>;
  offerDecision?: Omit<NonNullable<CityState["offerDecision"]>, "actionId" | "decidedAtVersion">;
}

type DecisionPolicy = Omit<PolicyPack, "issuedAtVersion">;
type DecisionFact = Omit<Fact, "disclosedAtVersion">;
type DecisionCommitment = Omit<Commitment, "createdAtVersion" | "lastCauseId">;

export function decisionViewFor(state: WorldState, actorId: string): AgentDecisionView {
  return {
    scenarioId: state.scenarioId,
    actorId,
    round: state.round,
    phase: state.simulation.phase,
    cycle: state.simulation.cycle,
    metrics: structuredClone(state.metrics),
    stakeholders: structuredClone(state.stakeholders),
    cities: {
      chengdu: decisionCity(state.cities.chengdu),
      chongqing: decisionCity(state.cities.chongqing),
    },
    company: {
      ...structuredClone(state.company),
      internalAdvice: state.company.internalAdvice.map(decisionAdvice),
    },
    visibleFacts: state.facts.map(decisionFact),
    debateThreads: structuredClone(state.debateThreads),
    commitments: state.commitments.map(decisionCommitment),
    coordinationOpinions: structuredClone(state.coordinationOpinions),
    coordinationPlans: structuredClone(state.coordinationPlans),
    finalDecision: state.finalDecision ? structuredClone(state.finalDecision) : null,
    cityCompetition: semanticCompetition(state),
    ownMemory: (state.agentMemory[actorId] ?? []).map((item) => item.summary),
  };
}

function semanticCompetition(state: WorldState): Omit<CityCompetitionEvidence, "generatedAtWorldVersion"> {
  const { generatedAtWorldVersion: _generatedAtWorldVersion, ...evidence } = cityCompetitionForState(state);
  return evidence;
}

function decisionCity(city: CityState): DecisionCity {
  return {
    ...structuredClone(city),
    internalAdvice: city.internalAdvice.map(decisionAdvice),
    policies: city.policies.map(({ issuedAtVersion: _issuedAtVersion, ...policy }) => structuredClone(policy)),
    policyRevisions: city.policyRevisions.map(({ createdAtVersion: _createdAtVersion, ...revision }) => structuredClone(revision)),
    ...(city.offerDecision
      ? { offerDecision: (({ actionId: _actionId, decidedAtVersion: _decidedAtVersion, ...decision }) => structuredClone(decision))(city.offerDecision) }
      : {}),
  };
}

function decisionAdvice(advice: CityState["internalAdvice"][number]): DecisionAdvice {
  return { actorId: advice.actorId, proposal: structuredClone(advice.proposal) };
}

function decisionFact({ disclosedAtVersion: _disclosedAtVersion, ...fact }: Fact): DecisionFact {
  return structuredClone(fact);
}

function decisionCommitment({ createdAtVersion: _createdAtVersion, lastCauseId: _lastCauseId, ...commitment }: Commitment): DecisionCommitment {
  return structuredClone(commitment);
}
