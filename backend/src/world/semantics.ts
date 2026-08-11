import type { ResourceKind, WorldState } from "../domain.js";

export interface SemanticEffects {
  projectTendency: "pending" | "chengdu_research" | "chongqing_manufacturing" | "dual_city_split" | "exit_risk";
  researchBuildingStage: "idle" | "planned" | "construction" | "operating";
  factoryStage: "idle" | "planned" | "construction" | "operating";
  talentFlow: "outflow_risk" | "stable" | "inflow";
  logisticsFlow: "idle" | "preparing" | "active";
  housingSignal: "normal" | "tight" | "critical";
  residentSignal: "opposed" | "watching" | "supportive";
  resourceAlerts: Array<{ cityId: "chengdu" | "chongqing"; resource: ResourceKind; severity: "warning" | "critical"; remainingRatio: number }>;
}

export function deriveSemanticEffects(state: WorldState): SemanticEffects {
  const accepted = Object.values(state.cities).flatMap((city) => city.policies).filter((policy) => policy.status === "accepted");
  const cityIds = new Set(accepted.map((policy) => policy.cityId));
  const projectTendency = state.company.projectStage === "exited" || state.metrics.projectViability < 25
    ? "exit_risk"
    : cityIds.size === 2 ? "dual_city_split" : cityIds.has("chengdu") ? "chengdu_research" : cityIds.has("chongqing") ? "chongqing_manufacturing" : "pending";
  const active = state.company.projectStage === "delivery" || state.company.projectStage === "completed";
  const planned = accepted.length > 0;
  return {
    projectTendency,
    researchBuildingStage: cityIds.has("chengdu") ? active ? "operating" : "construction" : planned ? "planned" : "idle",
    factoryStage: cityIds.has("chongqing") ? active ? "operating" : "construction" : planned ? "planned" : "idle",
    talentFlow: state.stakeholders.talentAttraction >= 65 ? "inflow" : state.stakeholders.talentAttraction < 40 ? "outflow_risk" : "stable",
    logisticsFlow: state.stakeholders.supplyChainReadiness >= 65 && active ? "active" : state.stakeholders.supplyChainReadiness >= 50 ? "preparing" : "idle",
    housingSignal: state.stakeholders.housingPressure >= 75 ? "critical" : state.stakeholders.housingPressure >= 50 ? "tight" : "normal",
    residentSignal: state.stakeholders.residentSupport >= 65 ? "supportive" : state.stakeholders.residentSupport < 40 ? "opposed" : "watching",
    resourceAlerts: Object.values(state.cities).flatMap((city) => (Object.entries(city.resourceLedger) as Array<[ResourceKind, WorldState["cities"]["chengdu"]["resourceLedger"][ResourceKind]]>).flatMap(([resource, account]) => {
      const ratio = account.capacity === 0 ? 0 : account.available / account.capacity;
      return ratio < 0.25 ? [{ cityId: city.cityId, resource, severity: ratio < 0.1 ? "critical" as const : "warning" as const, remainingRatio: Number(ratio.toFixed(4)) }] : [];
    })),
  };
}
