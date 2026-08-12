import type { OptimizationInput, OptimizationProfile } from "./types.js";
import type { WorldState } from "../domain.js";

const profiles: OptimizationProfile[] = [
  profile("balanced", [2, 2, 2, 2, 2, 2, 2, -1, -1, -1], {}),
  profile("innovation", [6, 1, 1, 2, 3, 2, 2, -1, -1, -1], { maxInvestmentMillionCny: 1_600, requiredAssignments: { headquarters: "chengdu", rd_center: "chengdu", training_center: "chengdu" } }),
  profile("manufacturing", [1, 6, 3, 2, 2, 2, 2, -1, -1, -1], { maxInvestmentMillionCny: 2_200, requiredAssignments: { smart_factory: "chongqing", supply_chain_base: "chongqing", training_center: "chongqing" } }),
  profile("fiscal_guard", [1, 1, 2, 2, 1, 4, 1, -5, -3, -3], { maxInvestmentMillionCny: 1_400, maxFunctions: 2 }),
  profile("resilience", [2, 2, 2, 3, 2, 4, 6, -2, -3, -3], { maxInvestmentMillionCny: 2_600, requireDualCity: true }),
];

export function optimizationInputFromState(state: WorldState): OptimizationInput {
  return {
    inputVersion: "cityscope.optimization.v1",
    seed: state.snapshot.seed,
    maxCandidates: 5,
    timeLimitSeconds: 0.5,
    investmentPlanMillionCny: Math.max(800, Math.round(state.company.investmentPlanMillionCny)),
    riskFactorPercent: Math.max(5, Math.min(95, Math.round((1 - state.company.bindingOrderRatio) * 100))),
    signals: {
      publicTrust: Math.round(state.stakeholders.publicTrust),
      residentSupport: Math.round(state.stakeholders.residentSupport),
      supplyChainReadiness: Math.round(state.stakeholders.supplyChainReadiness),
      talentAttraction: Math.round(state.stakeholders.talentAttraction),
      projectViability: Math.round(state.metrics.projectViability),
    },
    cities: {
      chengdu: { capacities: capacities(state, "chengdu") },
      chongqing: { capacities: capacities(state, "chongqing") },
    },
    functions: [
      spec("headquarters", [80, 4, 8_000, 2, 120, 350], 200, 55, 5, 25, 45, [95, 55]),
      spec("rd_center", [180, 8, 20_000, 8, 300, 700], 500, 100, 10, 45, 75, [100, 65]),
      spec("smart_factory", [260, 45, 120_000, 65, 80, 1_300], 900, 10, 100, 65, 80, [35, 100]),
      spec("supply_chain_base", [120, 20, 50_000, 25, 50, 450], 450, 5, 75, 80, 55, [45, 95]),
      spec("training_center", [60, 3, 6_000, 2, 100, 120], 120, 45, 15, 55, 35, [90, 70]),
    ],
    profiles,
  };
}

function capacities(state: WorldState, cityId: "chengdu" | "chongqing") {
  const ledger = state.cities[cityId].resourceLedger;
  return {
    // This scenario contains one project. Reserved/committed resources belong to
    // that same project and remain part of the allocation decision. A future
    // multi-project ledger must add ownership before subtracting reservations.
    fiscalMillionCny: ledger.fiscalMillionCny.capacity,
    landHectares: ledger.landHectares.capacity,
    factorySqm: ledger.factorySqm.capacity,
    energyMw: ledger.energyMw.capacity,
    talentHousingUnits: ledger.talentHousingUnits.capacity,
  };
}

function spec(
  functionId: OptimizationInput["functions"][number]["functionId"],
  demand: [number, number, number, number, number, number],
  jobs: number,
  innovationValue: number,
  manufacturingValue: number,
  publicBenefit: number,
  enterpriseValue: number,
  execution: [number, number],
): OptimizationInput["functions"][number] {
  return {
    functionId,
    demands: {
      fiscalMillionCny: demand[0], landHectares: demand[1], factorySqm: demand[2], energyMw: demand[3], talentHousingUnits: demand[4], investmentMillionCny: demand[5],
    },
    jobs, innovationValue, manufacturingValue, publicBenefit, enterpriseValue,
    cityExecution: { chengdu: execution[0], chongqing: execution[1] },
  };
}

function profile(profileId: OptimizationProfile["profileId"], values: [number, number, number, number, number, number, number, number, number, number], scenarioConstraints: OptimizationProfile["scenarioConstraints"]): OptimizationProfile {
  const [innovationValue, manufacturingValue, employment, publicBenefit, enterpriseValue, executionProbability, regionalSynergy, fiscalCost, liquidityRisk, resourcePressure] = values;
  return { profileId, objectiveWeights: { innovationValue, manufacturingValue, employment, publicBenefit, enterpriseValue, executionProbability, regionalSynergy, fiscalCost, liquidityRisk, resourcePressure }, scenarioConstraints };
}
