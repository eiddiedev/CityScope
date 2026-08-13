import { decisionDimensions, type CandidatePlan, type DecisionDimension, type TopsisRanking } from "./types.js";
import { manifests } from "../agents/manifests.js";

const directions = Object.fromEntries(decisionDimensions.map((dimension) => [dimension, ["fiscalCost", "liquidityRisk", "resourcePressure"].includes(dimension) ? "cost" : "benefit"])) as Record<DecisionDimension, "benefit" | "cost">;

const actorWeightValues: Record<string, number[]> = {
  chengdu_investment: [32, 3, 12, 8, 16, 10, 7, 4, 4, 4],
  chengdu_finance: [8, 3, 8, 8, 8, 20, 8, 20, 10, 7],
  chengdu_leader: [28, 6, 12, 8, 15, 12, 8, 5, 3, 3],
  chongqing_investment: [3, 34, 18, 8, 12, 10, 7, 3, 3, 2],
  chongqing_finance: [3, 10, 10, 8, 5, 20, 7, 20, 10, 7],
  chongqing_leader: [5, 30, 18, 10, 12, 12, 8, 3, 2, 0],
  regional_coordinator: [10, 10, 12, 14, 10, 12, 24, 3, 2, 3],
  policy_supervisor: [5, 5, 8, 10, 5, 30, 10, 15, 5, 7],
  company_ceo: [15, 12, 10, 5, 30, 15, 5, 2, 4, 2],
  company_cfo: [5, 5, 8, 5, 12, 20, 5, 20, 15, 5],
  investor: [8, 10, 10, 5, 25, 20, 5, 5, 10, 2],
  company_board: [10, 10, 10, 8, 22, 18, 8, 5, 6, 3],
  talent_sme: [22, 8, 22, 18, 8, 8, 7, 2, 2, 3],
  resident: [8, 8, 25, 25, 5, 5, 8, 6, 3, 7],
};

export const topsisActors = Object.keys(actorWeightValues);

export function rankWithTopsis(actorId: string, candidates: CandidatePlan[]): TopsisRanking {
  if (candidates.length < 2) throw new Error("TOPSIS_REQUIRES_AT_LEAST_TWO_CANDIDATES");
  const weights = weightsFor(actorId);
  const denominators = Object.fromEntries(decisionDimensions.map((dimension) => [
    dimension,
    Math.sqrt(candidates.reduce((sum, candidate) => sum + actorValue(actorId, candidate, dimension) ** 2, 0)) || 1,
  ])) as Record<DecisionDimension, number>;
  const weighted = candidates.map((candidate) => ({
    candidateId: candidate.candidateId,
    values: Object.fromEntries(decisionDimensions.map((dimension) => [dimension, actorValue(actorId, candidate, dimension) / denominators[dimension] * weights[dimension]])) as Record<DecisionDimension, number>,
  }));
  const idealBest = {} as Record<DecisionDimension, number>;
  const idealWorst = {} as Record<DecisionDimension, number>;
  for (const dimension of decisionDimensions) {
    const values = weighted.map((row) => row.values[dimension]);
    idealBest[dimension] = directions[dimension] === "benefit" ? Math.max(...values) : Math.min(...values);
    idealWorst[dimension] = directions[dimension] === "benefit" ? Math.min(...values) : Math.max(...values);
  }
  const unsorted = weighted.map((row) => {
    const distanceToIdeal = Math.sqrt(decisionDimensions.reduce((sum, dimension) => sum + (row.values[dimension] - idealBest[dimension]) ** 2, 0));
    const distanceToWorst = Math.sqrt(decisionDimensions.reduce((sum, dimension) => sum + (row.values[dimension] - idealWorst[dimension]) ** 2, 0));
    const denominator = distanceToIdeal + distanceToWorst;
    return {
      candidateId: row.candidateId,
      rank: 0,
      closeness: round6(denominator === 0 ? 0.5 : distanceToWorst / denominator),
      distanceToIdeal: round6(distanceToIdeal),
      distanceToWorst: round6(distanceToWorst),
      weightedNormalized: Object.fromEntries(decisionDimensions.map((dimension) => [dimension, round6(row.values[dimension])])) as Record<DecisionDimension, number>,
    };
  });
  const rows = unsorted.sort((left, right) => right.closeness - left.closeness || left.candidateId.localeCompare(right.candidateId)).map((row, index) => ({ ...row, rank: index + 1 }));
  return {
    actorId,
    weights,
    directions,
    idealBest: roundRecord(idealBest),
    idealWorst: roundRecord(idealWorst),
    rows,
  };
}

function actorValue(actorId: string, candidate: CandidatePlan, dimension: DecisionDimension): number {
  const cityId = actorId.startsWith("chengdu") ? "chengdu" : actorId.startsWith("chongqing") ? "chongqing" : undefined;
  if (!cityId || ["regionalSynergy", "fiscalCost", "liquidityRisk", "resourcePressure"].includes(dimension)) return candidate.dimensions[dimension];
  const selected = candidate.selectedFunctions.length;
  if (selected === 0) return candidate.dimensions[dimension];
  const local = candidate.selectedFunctions.filter((functionId) => candidate.assignments[functionId] === cityId).length;
  const core = cityId === "chengdu" ? ["headquarters", "rd_center"] : ["smart_factory", "supply_chain_base"];
  const protectedCore = core.filter((functionId) => candidate.assignments[functionId as keyof typeof candidate.assignments] === cityId).length / core.length;
  const capturedShare = local / selected;
  const captureFactor = 0.2 + capturedShare * 0.45 + protectedCore * 0.35;
  return candidate.dimensions[dimension] * captureFactor;
}

export function consensusCandidate(rankings: Record<string, TopsisRanking>, candidateIds: string[]): string {
  const voters = ["chengdu_leader", "chongqing_leader", "regional_coordinator", "company_board", "resident"];
  const scores = new Map(candidateIds.map((candidateId) => [candidateId, 0]));
  for (const actorId of voters) {
    const ranking = rankings[actorId];
    if (!ranking) continue;
    for (const row of ranking.rows) scores.set(row.candidateId, (scores.get(row.candidateId) ?? 0) + candidateIds.length - row.rank + 1);
  }
  return [...scores.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]?.[0] ?? candidateIds[0] ?? "";
}

export function weightsFor(actorId: string): Record<DecisionDimension, number> {
  const values = actorWeightValues[actorId] ?? [12, 12, 12, 10, 12, 12, 10, 7, 7, 6];
  const total = values.reduce((sum, value) => sum + value, 0);
  return Object.fromEntries(decisionDimensions.map((dimension, index) => [dimension, round6((values[index] ?? 0) / total)])) as Record<DecisionDimension, number>;
}

/** One source of truth: TOPSIS weights are projected back into every behavior manifest. */
export function synchronizeManifestUtilities(): void {
  for (const [actorId, manifest] of Object.entries(manifests)) {
    if (manifest.actorKind !== "agent") continue;
    const weights = weightsFor(actorId);
    manifest.utility = decisionDimensions.map((dimension) => ({
      dimension,
      weight: weights[dimension],
      direction: directions[dimension] === "cost" ? "minimize" : "maximize",
    }));
  }
}

synchronizeManifestUtilities();

function roundRecord(input: Record<DecisionDimension, number>): Record<DecisionDimension, number> {
  return Object.fromEntries(decisionDimensions.map((dimension) => [dimension, round6(input[dimension])])) as Record<DecisionDimension, number>;
}

function round6(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
