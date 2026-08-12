export const functionIds = ["headquarters", "rd_center", "smart_factory", "supply_chain_base", "training_center"] as const;
export type FunctionId = typeof functionIds[number];
export type CandidateCityId = "chengdu" | "chongqing";
export type Assignment = CandidateCityId | "none";

export const decisionDimensions = [
  "innovationValue",
  "manufacturingValue",
  "employment",
  "publicBenefit",
  "enterpriseValue",
  "executionProbability",
  "regionalSynergy",
  "fiscalCost",
  "liquidityRisk",
  "resourcePressure",
] as const;
export type DecisionDimension = typeof decisionDimensions[number];

export interface FunctionSpec {
  functionId: FunctionId;
  demands: {
    fiscalMillionCny: number;
    landHectares: number;
    factorySqm: number;
    energyMw: number;
    talentHousingUnits: number;
    investmentMillionCny: number;
  };
  jobs: number;
  innovationValue: number;
  manufacturingValue: number;
  publicBenefit: number;
  enterpriseValue: number;
  cityExecution: Record<CandidateCityId, number>;
}

export interface OptimizationProfile {
  profileId: "balanced" | "innovation" | "manufacturing" | "fiscal_guard" | "resilience";
  objectiveWeights: Record<DecisionDimension, number>;
  scenarioConstraints: {
    maxInvestmentMillionCny?: number;
    maxFunctions?: number;
    requireDualCity?: boolean;
    requiredAssignments?: Partial<Record<FunctionId, CandidateCityId>>;
  };
}

export interface OptimizationInput {
  inputVersion: "cityscope.optimization.v1";
  seed: number;
  maxCandidates: number;
  timeLimitSeconds: number;
  investmentPlanMillionCny: number;
  riskFactorPercent: number;
  signals: {
    publicTrust: number;
    residentSupport: number;
    supplyChainReadiness: number;
    talentAttraction: number;
    projectViability: number;
  };
  cities: Record<CandidateCityId, {
    capacities: {
      fiscalMillionCny: number;
      landHectares: number;
      factorySqm: number;
      energyMw: number;
      talentHousingUnits: number;
    };
  }>;
  functions: FunctionSpec[];
  profiles: OptimizationProfile[];
}

export interface CandidatePlan {
  candidateId: string;
  profileId: OptimizationProfile["profileId"];
  assignments: Record<FunctionId, Assignment>;
  selectedFunctions: FunctionId[];
  cityResources: Record<CandidateCityId, {
    fiscalMillionCny: number;
    landHectares: number;
    factorySqm: number;
    energyMw: number;
    talentHousingUnits: number;
  }>;
  investmentMillionCny: number;
  dimensions: Record<DecisionDimension, number>;
  objectiveValue: number;
  solverStatus: "OPTIMAL" | "FEASIBLE";
  constraintEvidence: string[];
}

export interface OptimizationResult {
  engine: "ortools-cp-sat" | "enumerative-fallback";
  engineVersion: string;
  status: "OPTIMAL" | "FEASIBLE" | "INFEASIBLE" | "ERROR";
  solveTimeMs: number;
  candidates: CandidatePlan[];
  diagnostics: string[];
}

export interface TopsisRow {
  candidateId: string;
  rank: number;
  closeness: number;
  distanceToIdeal: number;
  distanceToWorst: number;
  weightedNormalized: Record<DecisionDimension, number>;
}

export interface TopsisRanking {
  actorId: string;
  weights: Record<DecisionDimension, number>;
  directions: Record<DecisionDimension, "benefit" | "cost">;
  idealBest: Record<DecisionDimension, number>;
  idealWorst: Record<DecisionDimension, number>;
  rows: TopsisRow[];
}

export interface DecisionPortfolio {
  portfolioId: string;
  generatedAtWorldVersion: number;
  inputDigest: string;
  optimizer: Omit<OptimizationResult, "candidates">;
  candidates: CandidatePlan[];
  rankings: Record<string, TopsisRanking>;
  consensusCandidateId: string | null;
}

export interface DecisionSupportContext {
  portfolioId: string;
  optimizer: Pick<DecisionPortfolio["optimizer"], "engine" | "engineVersion" | "status" | "diagnostics">;
  consensusCandidateId: string | null;
  actorRanking?: TopsisRanking;
  candidates: CandidatePlan[];
}
