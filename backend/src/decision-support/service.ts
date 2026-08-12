import { digest, deterministicId } from "../util.js";
import type { WorldState } from "../domain.js";
import { solveEnumeratively } from "./enumerative-solver.js";
import { solveWithOrTools } from "./ortools-client.js";
import { optimizationInputFromState } from "./problem.js";
import { consensusCandidate, rankWithTopsis, topsisActors } from "./topsis.js";
import type { DecisionPortfolio, DecisionSupportContext, OptimizationResult } from "./types.js";

export type OptimizerMode = "auto" | "ortools" | "enumerative";

export class DecisionSupportService {
  private readonly cache = new Map<string, Promise<DecisionPortfolio>>();

  constructor(private readonly mode: OptimizerMode = "enumerative") {}

  async contextFor(state: WorldState, actorId: string): Promise<DecisionSupportContext | undefined> {
    if (!eligibleForDecisionSupport(state, actorId)) return undefined;
    const portfolio = await this.portfolio(state);
    const actorRanking = portfolio.rankings[actorId];
    return {
      portfolioId: portfolio.portfolioId,
      optimizer: {
        engine: portfolio.optimizer.engine,
        engineVersion: portfolio.optimizer.engineVersion,
        status: portfolio.optimizer.status,
        diagnostics: stableDiagnostics(portfolio.optimizer.diagnostics),
      },
      consensusCandidateId: portfolio.consensusCandidateId,
      ...(actorRanking ? { actorRanking } : {}),
      candidates: portfolio.candidates,
    };
  }

  async portfolio(state: WorldState): Promise<DecisionPortfolio> {
    const input = optimizationInputFromState(state);
    const inputDigest = digest(input);
    const cached = this.cache.get(inputDigest);
    if (cached) return cached;
    const generated = this.buildPortfolio(state, inputDigest);
    this.cache.set(inputDigest, generated);
    return generated;
  }

  private async buildPortfolio(state: WorldState, inputDigest: string): Promise<DecisionPortfolio> {
    const input = optimizationInputFromState(state);
    let result: OptimizationResult;
    if (this.mode === "enumerative") result = solveEnumeratively(input);
    else if (this.mode === "ortools") result = await solveWithOrTools(input);
    else {
      try {
        result = await solveWithOrTools(input);
        if (result.candidates.length < 2) {
          const fallback = solveEnumeratively(input);
          fallback.diagnostics.push(`OR_TOOLS_FALLBACK:insufficient candidates (${result.candidates.length})`);
          result = fallback;
        }
      } catch (error) {
        result = solveEnumeratively(input);
        result.diagnostics.push(`OR_TOOLS_FALLBACK:${error instanceof Error ? error.message : "unknown error"}`);
      }
    }
    const rankings = result.candidates.length >= 2
      ? Object.fromEntries(topsisActors.map((actorId) => [actorId, rankWithTopsis(actorId, result.candidates)]))
      : {};
    const consensusCandidateId = result.candidates.length >= 2
      ? consensusCandidate(rankings, result.candidates.map((candidate) => candidate.candidateId))
      : result.candidates[0]?.candidateId ?? null;
    return {
      portfolioId: deterministicId("portfolio", inputDigest, result.engine, result.candidates.map((candidate) => candidate.candidateId)),
      generatedAtWorldVersion: state.worldVersion,
      inputDigest,
      optimizer: {
        engine: result.engine,
        engineVersion: result.engineVersion,
        status: result.status,
        solveTimeMs: result.solveTimeMs,
        diagnostics: result.diagnostics,
      },
      candidates: result.candidates,
      rankings,
      consensusCandidateId,
    };
  }
}

function stableDiagnostics(diagnostics: string[]): string[] {
  return diagnostics.filter((item) => !/time|python=/i.test(item));
}

function eligibleForDecisionSupport(state: WorldState, actorId: string): boolean {
  if (["chengdu_leader", "chongqing_leader"].includes(actorId)) return ["policy_formation", "policy_revision", "coordination_debate", "coordination_resolution"].includes(state.simulation.phase);
  if (actorId === "regional_coordinator") {
    if (state.simulation.phase === "coordination_debate") return (state.debateThreads[0]?.messages.length ?? 0) >= 6;
    return state.simulation.phase === "policy_audit" || state.simulation.phase === "post_disclosure" || state.simulation.phase === "coordination_resolution";
  }
  if (actorId === "policy_supervisor") return ["policy_audit", "post_disclosure", "coordination_resolution"].includes(state.simulation.phase);
  if (["company_ceo", "company_cfo", "investor", "company_board"].includes(actorId)) return ["company_deliberation", "post_disclosure", "final_deliberation"].includes(state.simulation.phase);
  return false;
}
