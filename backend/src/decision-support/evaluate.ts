import { clamp, deterministicId } from "../util.js";
import { decisionDimensions, functionIds, type Assignment, type CandidatePlan, type DecisionDimension, type FunctionId, type OptimizationInput, type OptimizationProfile } from "./types.js";

type ResourceTotals = CandidatePlan["cityResources"]["chengdu"];

export function evaluateAssignment(
  input: OptimizationInput,
  assignments: Record<FunctionId, Assignment>,
  profile: OptimizationProfile,
  solverStatus: CandidatePlan["solverStatus"] = "OPTIMAL",
): CandidatePlan | undefined {
  const selectedFunctions = functionIds.filter((functionId) => assignments[functionId] !== "none");
  if (selectedFunctions.length < 2) return undefined;
  if (assignments.rd_center === "none" && assignments.smart_factory === "none") return undefined;
  if (assignments.headquarters !== "none" && assignments.headquarters !== assignments.rd_center) return undefined;
  if (assignments.supply_chain_base !== "none" && assignments.supply_chain_base !== assignments.smart_factory) return undefined;
  const scenario = profile.scenarioConstraints;
  if (scenario.maxFunctions !== undefined && selectedFunctions.length > scenario.maxFunctions) return undefined;
  if (scenario.requireDualCity && new Set(Object.values(assignments).filter((value) => value !== "none")).size < 2) return undefined;
  if (scenario.requiredAssignments && Object.entries(scenario.requiredAssignments).some(([functionId, cityId]) => assignments[functionId as FunctionId] !== cityId)) return undefined;

  const cityResources = { chengdu: emptyResources(), chongqing: emptyResources() };
  let investmentMillionCny = 0;
  let innovationRaw = 0;
  let manufacturingRaw = 0;
  let employmentRaw = 0;
  let publicRaw = 0;
  let enterpriseRaw = 0;
  let executionRaw = 0;
  for (const item of input.functions) {
    const cityId = assignments[item.functionId];
    if (cityId === "none") continue;
    const totals = cityResources[cityId];
    totals.fiscalMillionCny += item.demands.fiscalMillionCny;
    totals.landHectares += item.demands.landHectares;
    totals.factorySqm += item.demands.factorySqm;
    totals.energyMw += item.demands.energyMw;
    totals.talentHousingUnits += item.demands.talentHousingUnits;
    investmentMillionCny += item.demands.investmentMillionCny;
    innovationRaw += item.innovationValue;
    manufacturingRaw += item.manufacturingValue;
    employmentRaw += item.jobs;
    publicRaw += item.publicBenefit;
    enterpriseRaw += item.enterpriseValue;
    executionRaw += item.cityExecution[cityId];
  }
  if (investmentMillionCny > input.investmentPlanMillionCny || (scenario.maxInvestmentMillionCny !== undefined && investmentMillionCny > scenario.maxInvestmentMillionCny)) return undefined;
  for (const cityId of ["chengdu", "chongqing"] as const) {
    const totals = cityResources[cityId];
    const capacity = input.cities[cityId].capacities;
    if (totals.fiscalMillionCny > capacity.fiscalMillionCny
      || totals.landHectares > capacity.landHectares
      || totals.factorySqm > capacity.factorySqm
      || totals.energyMw > capacity.energyMw
      || totals.talentHousingUnits > capacity.talentHousingUnits) return undefined;
  }

  const usedCities = new Set(Object.values(assignments).filter((city): city is "chengdu" | "chongqing" => city !== "none"));
  const pressure = Math.max(...(["chengdu", "chongqing"] as const).flatMap((cityId) => {
    const totals = cityResources[cityId];
    const capacity = input.cities[cityId].capacities;
    return [
      ratio(totals.fiscalMillionCny, capacity.fiscalMillionCny),
      ratio(totals.landHectares, capacity.landHectares),
      ratio(totals.factorySqm, capacity.factorySqm),
      ratio(totals.energyMw, capacity.energyMw),
      ratio(totals.talentHousingUnits, capacity.talentHousingUnits),
    ];
  }));
  const totalFiscal = cityResources.chengdu.fiscalMillionCny + cityResources.chongqing.fiscalMillionCny;
  const fiscalCapacity = input.cities.chengdu.capacities.fiscalMillionCny + input.cities.chongqing.capacities.fiscalMillionCny;
  const dimensions: Record<DecisionDimension, number> = {
    innovationValue: round2(clamp(innovationRaw / 215 * input.signals.talentAttraction / 70 * 100)),
    manufacturingValue: round2(clamp(manufacturingRaw / 205 * input.signals.supplyChainReadiness / 65 * 100)),
    employment: round2(clamp(employmentRaw / 2170 * 100)),
    publicBenefit: round2(clamp(publicRaw / 270 * ((input.signals.publicTrust + input.signals.residentSupport) / 140) * 100)),
    enterpriseValue: round2(clamp(enterpriseRaw / 290 * input.signals.projectViability / 76 * 100)),
    executionProbability: round2(clamp(executionRaw / selectedFunctions.length)),
    regionalSynergy: usedCities.size === 2 ? 100 : 35,
    fiscalCost: round2(clamp(totalFiscal / fiscalCapacity * 100)),
    liquidityRisk: round2(clamp(investmentMillionCny / input.investmentPlanMillionCny * input.riskFactorPercent)),
    resourcePressure: round2(clamp(pressure * 100)),
  };
  const objectiveValue = round2(decisionDimensions.reduce((sum, dimension) => sum + profile.objectiveWeights[dimension] * dimensions[dimension], 0));
  const signature = functionIds.map((functionId) => `${functionId}:${assignments[functionId]}`).join("|");
  return {
    candidateId: deterministicId("candidate", profile.profileId, signature),
    profileId: profile.profileId,
    assignments: structuredClone(assignments),
    selectedFunctions,
    cityResources,
    investmentMillionCny,
    dimensions,
    objectiveValue,
    solverStatus,
    constraintEvidence: [
      "FUNCTION_COUNT>=2",
      "ANCHOR_PRESENT",
      "HEADQUARTERS_REQUIRES_COLOCATED_RD",
      "SUPPLY_CHAIN_REQUIRES_COLOCATED_FACTORY",
      "CITY_RESOURCE_CAPACITIES_OK",
      "INVESTMENT_PLAN_OK",
    ],
  };
}

export function assignmentSignature(assignments: Record<FunctionId, Assignment>): string {
  return functionIds.map((functionId) => assignments[functionId]).join("|");
}

function emptyResources(): ResourceTotals {
  return { fiscalMillionCny: 0, landHectares: 0, factorySqm: 0, energyMw: 0, talentHousingUnits: 0 };
}

function ratio(value: number, capacity: number): number {
  return capacity <= 0 ? (value > 0 ? 1 : 0) : value / capacity;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
