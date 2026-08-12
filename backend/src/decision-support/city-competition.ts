import type { CityId, WorldState } from "../domain.js";

export const competitionDimensionIds = ["policyValue", "industryFit", "executionCapacity", "publicBenefit", "fiscalBurden"] as const;
export type CompetitionDimensionId = typeof competitionDimensionIds[number];

export interface CityCompetitionEvidence {
  method: "topsis-city-offer-v1";
  generatedAtWorldVersion: number;
  dimensions: Array<{
    id: CompetitionDimensionId;
    label: string;
    direction: "benefit" | "cost";
    weight: number;
    raw: Record<CityId, number>;
    preferenceShare: Record<CityId, number>;
  }>;
  scores: Record<CityId, { closeness: number; rank: 1 | 2; share: number }>;
  preferredCity: CityId;
}

const dimensionConfig: Record<CompetitionDimensionId, { label: string; direction: "benefit" | "cost"; weight: number }> = {
  policyValue: { label: "政策方案", direction: "benefit", weight: 0.22 },
  industryFit: { label: "产业匹配", direction: "benefit", weight: 0.32 },
  executionCapacity: { label: "兑现能力", direction: "benefit", weight: 0.2 },
  publicBenefit: { label: "社会收益", direction: "benefit", weight: 0.14 },
  fiscalBurden: { label: "财政负担", direction: "cost", weight: 0.12 },
};

export function cityCompetitionForState(state: WorldState): CityCompetitionEvidence {
  const raw = {
    chengdu: cityValues(state, "chengdu"),
    chongqing: cityValues(state, "chongqing"),
  };
  const weighted = { chengdu: {} as Record<CompetitionDimensionId, number>, chongqing: {} as Record<CompetitionDimensionId, number> };
  const dimensions = competitionDimensionIds.map((id) => {
    const config = dimensionConfig[id];
    const denominator = Math.hypot(raw.chengdu[id], raw.chongqing[id]) || 1;
    weighted.chengdu[id] = raw.chengdu[id] / denominator * config.weight;
    weighted.chongqing[id] = raw.chongqing[id] / denominator * config.weight;
    const preference = config.direction === "benefit"
      ? pairShare(raw.chengdu[id], raw.chongqing[id])
      : pairShare(100 - raw.chengdu[id], 100 - raw.chongqing[id]);
    return {
      id,
      label: config.label,
      direction: config.direction,
      weight: config.weight,
      raw: { chengdu: round2(raw.chengdu[id]), chongqing: round2(raw.chongqing[id]) },
      preferenceShare: { chengdu: preference[0], chongqing: preference[1] },
    };
  });
  const distances = Object.fromEntries((["chengdu", "chongqing"] as const).map((cityId) => {
    let bestDistance = 0;
    let worstDistance = 0;
    for (const id of competitionDimensionIds) {
      const config = dimensionConfig[id];
      const values = [weighted.chengdu[id], weighted.chongqing[id]];
      const idealBest = config.direction === "benefit" ? Math.max(...values) : Math.min(...values);
      const idealWorst = config.direction === "benefit" ? Math.min(...values) : Math.max(...values);
      bestDistance += (weighted[cityId][id] - idealBest) ** 2;
      worstDistance += (weighted[cityId][id] - idealWorst) ** 2;
    }
    const toBest = Math.sqrt(bestDistance);
    const toWorst = Math.sqrt(worstDistance);
    return [cityId, toBest + toWorst === 0 ? 0.5 : toWorst / (toBest + toWorst)];
  })) as Record<CityId, number>;
  const preferredCity: CityId = distances.chengdu >= distances.chongqing ? "chengdu" : "chongqing";
  const total = distances.chengdu + distances.chongqing || 1;
  const chengduShare = round2(distances.chengdu / total * 100);
  return {
    method: "topsis-city-offer-v1",
    generatedAtWorldVersion: state.worldVersion,
    dimensions,
    scores: {
      chengdu: { closeness: round6(distances.chengdu), rank: preferredCity === "chengdu" ? 1 : 2, share: chengduShare },
      chongqing: { closeness: round6(distances.chongqing), rank: preferredCity === "chongqing" ? 1 : 2, share: round2(100 - chengduShare) },
    },
    preferredCity,
  };
}

function cityValues(state: WorldState, cityId: CityId): Record<CompetitionDimensionId, number> {
  const city = state.cities[cityId];
  const policy = [...city.policies].reverse().find((item) => item.status === "accepted") ?? city.policies.at(-1);
  const cashSupport = policy?.terms.reduce((sum, term) => sum + (term.type === "cash_support" ? term.amountMillionCny ?? 0 : 0), 0) ?? 0;
  const ledger = city.resourceLedger;
  const remaining = [ledger.landHectares, ledger.factorySqm, ledger.energyMw, ledger.talentHousingUnits]
    .reduce((sum, account) => sum + ratio(account.available, account.capacity), 0) / 4;
  const auditBonus = policy?.auditStatus === "approved" ? 8 : policy?.auditStatus === "pending" ? 2 : -8;
  const acceptanceBonus = policy?.status === "accepted" ? 8 : 0;
  const policyValue = clamp(city.policyCredibility * 0.76 + Math.min(16, ratio(cashSupport, ledger.fiscalMillionCny.capacity) * 32) + auditBonus + acceptanceBonus);
  const industryFit = cityId === "chengdu"
    ? clamp(state.stakeholders.talentAttraction * 0.62 + ratio(ledger.talentHousingUnits.capacity, 700) * 38)
    : clamp(state.stakeholders.supplyChainReadiness * 0.62 + ((ratio(ledger.factorySqm.capacity, 220_000) + ratio(ledger.energyMw.capacity, 120)) / 2) * 38);
  const executableTerms = policy?.resourceCalculations.length ? policy.resourceCalculations.filter((item) => item.passed).length / policy.resourceCalculations.length : 0.5;
  const executionCapacity = clamp(executableTerms * 55 + remaining * 25 + state.metrics.projectViability * 0.2);
  const publicBenefit = cityId === "chengdu"
    ? clamp(state.stakeholders.publicTrust * 0.35 + state.stakeholders.residentSupport * 0.25 + state.stakeholders.talentAttraction * 0.4)
    : clamp(state.stakeholders.publicTrust * 0.3 + state.stakeholders.smeParticipation * 0.3 + state.stakeholders.supplyChainReadiness * 0.4);
  const fiscalBurden = clamp(ratio(ledger.fiscalMillionCny.capacity - ledger.fiscalMillionCny.available, ledger.fiscalMillionCny.capacity) * 70 + ratio(cashSupport, ledger.fiscalMillionCny.capacity) * 30);
  return { policyValue, industryFit, executionCapacity, publicBenefit, fiscalBurden };
}

function pairShare(left: number, right: number): [number, number] {
  const total = Math.max(0, left) + Math.max(0, right);
  if (total <= 0) return [50, 50];
  const share = round2(Math.max(0, left) / total * 100);
  return [share, round2(100 - share)];
}

function ratio(value: number, capacity: number): number {
  return capacity > 0 ? Math.max(0, Math.min(1, value / capacity)) : 0;
}

function clamp(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function round6(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
