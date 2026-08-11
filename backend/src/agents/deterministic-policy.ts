import { SCHEMA_VERSION, type ActorManifest, type AgentAction, type AgentManifest, type WorldState } from "../domain.js";
import { deterministicId, digest } from "../util.js";

export function deterministicAgentAction(manifest: AgentManifest, observation: WorldState): AgentAction {
  const phase = observation.simulation.phase;
  const actorId = manifest.agentId;
  if (phase === "internal_advice") return internalAdvice(actorId, observation);
  if (phase === "policy_formation") return leaderPolicy(actorId, observation);
  if (phase === "policy_audit") {
    if (actorId === "policy_supervisor") return auditPolicies(observation);
    if (actorId === "regional_coordinator") return coordinationOpinion(observation);
  }
  if (phase === "stakeholder_reaction" || phase === "delivery_reaction") return stakeholderReaction(actorId, observation);
  if (phase === "company_deliberation") return companyDeliberation(actorId, observation, false);
  if (phase === "due_diligence" && actorId === "policy_supervisor") {
    return action(actorId, "REQUEST_DUE_DILIGENCE", { scope: ["orders", "cash_flow"], round: 2 }, "正式政策发布后启动第二轮订单与现金流尽调", observation);
  }
  if (phase === "post_disclosure") {
    if (actorId === "talent_sme" || actorId === "resident") return stakeholderReaction(actorId, observation);
    if (actorId === "regional_coordinator") return observation.coordinationOpinions.length === 0 ? coordinationOpinion(observation) : pass(actorId, observation, "已有区域协调意见，等待主体自主响应");
    if (actorId === "policy_supervisor") return pass(actorId, observation, "现有政策已完成审计，风险披露不自动改变合规结论");
    return companyDeliberation(actorId, observation, true);
  }
  return pass(actorId, observation, `当前阶段 ${phase} 无需该主体行动`);
}

export function deterministicServiceAction(manifest: ActorManifest, observation: WorldState): AgentAction {
  if (manifest.actorKind !== "service") throw new Error(`${manifest.agentId} is not a service`);
  if (manifest.agentId === "due_diligence_service" && observation.simulation.phase === "due_diligence") {
    const fact = observation.facts.find((item) => item.factId === "fact_orders_nonbinding");
    if (fact?.visibility === "private" && observation.round >= 2) {
      return action(manifest.agentId, "DISCLOSE_FACT", { factId: fact.factId, audience: behaviorAudience(observation) }, "规则核验发现订单中存在非约束性意向", observation, [fact.factId]);
    }
  }
  if (manifest.agentId === "world_resource_service" && observation.simulation.phase === "delivery") {
    const variation = Math.floor(seedUnit(observation, manifest.agentId, "progress") * 121);
    const verifiedJobs = Math.max(observation.company.verifiedJobs, 280 + variation);
    const verifiedInvestmentMillionCny = Math.max(observation.company.verifiedInvestmentMillionCny, 260 + Math.floor(variation * 0.8));
    const failedCommitmentIds = observation.commitments
      .filter((item) => item.status === "approved" && item.trigger?.metric === "verifiedJobs" && item.trigger.value > verifiedJobs)
      .map((item) => item.commitmentId);
    return action(manifest.agentId, "ADVANCE_PROJECT", { verifiedJobs, verifiedInvestmentMillionCny, annualOutputMillionCny: Math.floor(verifiedJobs * 2.5), failedCommitmentIds }, "确定性核验项目进度并执行承诺触发器", observation);
  }
  return pass(manifest.agentId, observation, "确定性服务当前没有待处理规则任务");
}

function internalAdvice(actorId: string, state: WorldState): AgentAction {
  if (actorId === "chengdu_investment") return action(actorId, "ADVISE_POLICY", { requestedFunctions: ["headquarters", "rd_center", "training_center"], supportPreferenceMillionCny: 560, talentHousingUnits: 420 }, "研发总部与人才工具能提高成都长期价值", state);
  if (actorId === "chengdu_finance") return action(actorId, "ADVISE_POLICY", { maxFiscalMillionCny: 500, upfrontRatio: 0.2, requireMilestones: true }, "前置支付必须受预算与招聘里程碑约束", state, ["fact_cd_capacity"]);
  if (actorId === "chongqing_investment") return action(actorId, "ADVISE_POLICY", { requestedFunctions: ["smart_factory", "supply_chain_base"], factorySqm: 120_000, energyMw: 70 }, "现成厂房和供应链适合制造落地", state);
  if (actorId === "chongqing_finance") return action(actorId, "ADVISE_POLICY", { maxFiscalMillionCny: 360, requireOutputFloor: true, outputFloorMillionCny: 2_200 }, "制造支持必须与产值和产能使用挂钩", state, ["fact_cq_capacity"]);
  return pass(actorId, state, "当前没有组织内建议权限");
}

function leaderPolicy(actorId: string, state: WorldState): AgentAction {
  const cityId = actorId.startsWith("chengdu") ? "chengdu" : "chongqing";
  const advice = state.cities[cityId].internalAdvice;
  if (advice.length < 2) return pass(actorId, state, "招商与财政建议尚未齐备");
  const jitter = Math.floor(seedUnit(state, actorId, "policy") * 31);
  if (cityId === "chengdu") {
    return action(actorId, "SUBMIT_POLICY_PACK", {
      policyId: deterministicId("policy_cd", state.snapshot.seed, state.worldVersion, state.interventionId ?? "root"), cityId, decisionMode: "COMPROMISE",
      terms: [
        { termId: "cd_cash_1", type: "cash_support", amountMillionCny: 100, trigger: { metric: "verifiedInvestmentMillionCny", operator: ">=", value: 100 }, deadline: "year_1", failureAction: "cancel_payment" },
        { termId: "cd_cash_2", type: "cash_support", amountMillionCny: 190 + jitter, trigger: { metric: "verifiedJobs", operator: ">=", value: 300 }, deadline: "year_2", failureAction: "cancel_payment" },
        { termId: "cd_land", type: "land", quantity: 20 },
        { termId: "cd_facility", type: "facility", quantity: 40_000 },
        { termId: "cd_energy", type: "energy", quantity: 20 },
        { termId: "cd_housing", type: "talent_housing", quantity: 400 },
      ],
    }, "基于招商与财政建议形成分期、全资源可核验的折中政策包", state, ["fact_cd_capacity"]);
  }
  return action(actorId, "SUBMIT_POLICY_PACK", {
    policyId: deterministicId("policy_cq", state.snapshot.seed, state.worldVersion, state.interventionId ?? "root"), cityId, decisionMode: "COMPROMISE",
    terms: [
      { termId: "cq_cash_1", type: "cash_support", amountMillionCny: 100, trigger: { metric: "verifiedInvestmentMillionCny", operator: ">=", value: 260 }, deadline: "year_1", failureAction: "clawback" },
      { termId: "cq_cash_2", type: "cash_support", amountMillionCny: 210 + jitter, trigger: { metric: "annualOutputMillionCny", operator: ">=", value: 2200 }, deadline: "year_3", failureAction: "cancel_payment" },
      { termId: "cq_land", type: "land", quantity: 60 },
      { termId: "cq_factory", type: "facility", quantity: 120_000 },
      { termId: "cq_energy", type: "energy", quantity: 70 },
      { termId: "cq_housing", type: "talent_housing", quantity: 100 },
      { termId: "cq_output", type: "output_floor", quantity: 2200 },
    ],
  }, "基于招商与财政建议形成厂房、能源和产值约束政策包", state, ["fact_cq_capacity"]);
}

function auditPolicies(state: WorldState): AgentAction {
  const policies = openPolicies(state);
  if (!policies.length) return pass("policy_supervisor", state, "没有待审计正式政策包");
  return action("policy_supervisor", "AUDIT_POLICY_PACK", {
    audits: policies.map((policy) => {
      const failed = policy.resourceCalculations.filter((item) => !item.passed);
      return { policyId: policy.policyId, decision: failed.length ? "require_repair" : "approve", reasonCodes: failed.length ? failed.map((item) => item.reasonCode) : ["AUTHORITY_OK", "RESOURCE_LEDGER_OK", "MILESTONE_REQUIRED"] };
    }),
  }, "逐项审计正式政策包的权限、资源和里程碑", state);
}

function coordinationOpinion(state: WorldState): AgentAction {
  const policies = openPolicies(state);
  if (policies.length < 2) return pass("regional_coordinator", state, "不足两个城市政策包，无需区域协调");
  const bothCash = policies.every((policy) => policy.terms.some((term) => term.type === "cash_support"));
  const complement = policies.some((policy) => policy.terms.some((term) => term.type === "facility")) && policies.some((policy) => policy.terms.some((term) => term.type === "talent_housing"));
  return action("regional_coordinator", "ISSUE_COORDINATION_OPINION", {
    opinionId: deterministicId("opinion", policies.map((policy) => policy.policyId)), policyIds: policies.map((policy) => policy.policyId),
    recommendation: complement ? "split_functions" : bothCash ? "reduce_duplicate_subsidy" : "no_coordination_needed",
    reasonCodes: [...(bothCash ? ["DUPLICATE_CASH_SUPPORT"] : []), ...(complement ? ["FUNCTIONAL_COMPLEMENTARITY"] : [])],
  }, "区域层只提供跨城协调建议，不替地方或企业签约", state);
}

function stakeholderReaction(actorId: string, state: WorldState): AgentAction {
  const disclosedRisk = state.facts.some((fact) => fact.kind === "order_quality" && fact.visibility === "disclosed");
  const delivery = state.company.projectStage === "delivery" || state.company.verifiedJobs > 0;
  if (actorId === "talent_sme") {
    const metrics = delivery
      ? { talentAttraction: 5, smeParticipation: 6, supplyChainReadiness: 7, housingPressure: 3, publicTrust: 4 }
      : disclosedRisk
        ? { talentAttraction: -4, smeParticipation: -5, supplyChainReadiness: -6, housingPressure: -1, publicTrust: -7 }
        : { talentAttraction: 8, smeParticipation: 5, supplyChainReadiness: 6, housingPressure: 7, publicTrust: 2 };
    return action(actorId, "PUBLISH_STAKEHOLDER_REACTION", { reactionId: deterministicId("reaction", actorId, state.worldVersion), metrics, reasonCodes: delivery ? ["VERIFIED_JOBS", "LOCAL_PROCUREMENT_EXPECTED"] : disclosedRisk ? ["ORDER_RISK_DISCLOSED"] : ["TALENT_HOUSING_SUPPORT", "SUPPLY_CHAIN_OPPORTUNITY"], sentiment: disclosedRisk ? "concern" : "support" }, "基于当前政策、风险和履约事实更新人才与中小企业反应", state);
  }
  if (actorId === "resident") {
    const metrics = delivery
      ? { residentSupport: 7, fiscalFairnessConcern: -2, trafficOrEnergyPressure: 4, publicTrust: 5 }
      : disclosedRisk
        ? { residentSupport: -8, fiscalFairnessConcern: 7, trafficOrEnergyPressure: 1, publicTrust: -9 }
        : { residentSupport: 4, fiscalFairnessConcern: 6, trafficOrEnergyPressure: 5, publicTrust: -1 };
    return action(actorId, "PUBLISH_STAKEHOLDER_REACTION", { reactionId: deterministicId("reaction", actorId, state.worldVersion), metrics, reasonCodes: delivery ? ["EMPLOYMENT_VERIFIED"] : disclosedRisk ? ["PUBLIC_RISK_INCREASED", "FISCAL_FAIRNESS_CONCERN"] : ["EMPLOYMENT_BENEFIT", "RESOURCE_PRESSURE"], sentiment: disclosedRisk ? "concern" : "mixed" }, "基于就业、财政公平和公共资源压力更新居民反应", state);
  }
  return pass(actorId, state, "非利益相关者主体不发布社会反应");
}

function companyDeliberation(actorId: string, state: WorldState, afterDisclosure: boolean): AgentAction {
  const disclosed = state.facts.some((fact) => fact.factId === "fact_orders_nonbinding" && fact.visibility === "disclosed");
  if (actorId === "company_ceo") return action(actorId, "ADVISE_COMPANY_RESPONSE", { stance: disclosed ? "reduce_scope" : "expand", preferredCapability: "rd_and_brand", targetInvestmentMillionCny: disclosed ? 2200 : 3000 }, disclosed ? "订单风险披露后缩小一期规模" : "在政策支持下保持扩张选项", state, ["fact_orders_nonbinding"]);
  if (actorId === "company_cfo") return action(actorId, "ADVISE_COMPANY_RESPONSE", { stance: disclosed ? "renegotiate" : "conditional", requireUpfrontCash: true, maxRigidOutputMillionCny: disclosed ? 1600 : 2200 }, disclosed ? "融资和订单风险要求降低刚性里程碑" : "现金到账与退出条款必须明确", state, ["fact_cash_12m", "fact_orders_nonbinding"]);
  if (actorId === "investor") return action(actorId, "ADVISE_FINANCING", { stance: state.company.bindingOrderRatio < 0.5 ? "withhold" : "conditional", condition: "bindingOrderRatio >= 0.6" }, state.company.bindingOrderRatio < 0.5 ? "非约束订单不足以支持完整融资" : "订单转化后可分期融资", state, disclosed ? ["fact_financing_tight", "fact_orders_nonbinding"] : ["fact_financing_tight"]);
  if (actorId === "company_board") {
    const hasBothAdvice = state.company.internalAdvice.some((item) => item.actorId === "company_ceo") && state.company.internalAdvice.some((item) => item.actorId === "company_cfo");
    if (!hasBothAdvice) return pass(actorId, state, "等待 CEO 与 CFO 独立建议");
    if (!afterDisclosure) return action(actorId, "SUBMIT_COMPANY_RESPONSE", { responseId: deterministicId("response", state.snapshot.seed, state.worldVersion), targetPolicyIds: openPolicies(state).map((policy) => policy.policyId), requestedChanges: [] }, "董事会汇总内部冲突后形成正式尽调前回应", state, ["fact_cash_12m", "fact_orders_nonbinding"]);
    if (state.company.projectStage === "exited") return pass(actorId, state, "董事会已正式退出，本轮不再接受政策");
    if (state.metrics.financingConfidence < 12 || state.metrics.projectViability < 30) return action(actorId, "EXIT_PROJECT", { reasonCode: "EXECUTION_FINANCING_BELOW_RED_LINE" }, "融资或可执行性跌破董事会红线，正式退出", state, ["fact_cash_12m", "fact_orders_nonbinding"]);
    const alreadyAccepted = Object.values(state.cities).flatMap((city) => city.policies).filter((policy) => policy.status === "accepted");
    if (alreadyAccepted.length > 0 && (state.company.investmentPlanMillionCny < 2400 || seedUnit(state, actorId, "second-policy") < 0.55)) return pass(actorId, state, "已有可执行政策，第二城市政策的边际效用不足");
    const candidates = openPolicies(state).filter((policy) => policy.auditStatus === "approved" && policy.status === "issued");
    if (!candidates.length) return pass(actorId, state, "没有可接受的已审计政策包");
    const selected = [...candidates].sort((left, right) => policyUtility(right, state) - policyUtility(left, state))[0];
    if (!selected) return pass(actorId, state, "政策效用不足");
    return action(actorId, "ACCEPT_POLICY", { policyId: selected.policyId }, "董事会按流动性、执行概率和政策效用接受当前最优可执行政策", state, ["fact_cash_12m", "fact_orders_nonbinding"]);
  }
  return pass(actorId, state, "当前企业协商阶段无需行动");
}

function policyUtility(policy: ReturnType<typeof openPolicies>[number], state: WorldState): number {
  const seedBias = seedUnit(state, "company_board", policy.policyId) * 8;
  if (policy.cityId === "chengdu") return state.stakeholders.talentAttraction * 0.35 + state.cities.chengdu.policyCredibility * 0.25 + state.stakeholders.publicTrust * 0.2 + seedBias;
  return state.stakeholders.supplyChainReadiness * 0.35 + state.cities.chongqing.policyCredibility * 0.25 + state.stakeholders.smeParticipation * 0.2 + seedBias;
}

function openPolicies(state: WorldState) {
  return Object.values(state.cities).flatMap((city) => city.policies).filter((policy) => policy.status === "issued");
}

function pass(actorId: string, state: WorldState, reasoning: string): AgentAction {
  return action(actorId, "PASS", { phase: state.simulation.phase, reasonCode: "NO_ELIGIBLE_MATERIAL_ACTION" }, reasoning, state);
}

function action(actorId: string, kind: AgentAction["kind"], payload: Record<string, unknown>, reasoning: string, state: WorldState, evidenceFactIds: string[] = []): AgentAction {
  return {
    actionId: deterministicId("action", actorId, kind, state.runId, state.worldVersion, state.snapshot.seed, payload), actorId, kind, reasoning, payload, evidenceFactIds,
    promptVersion: manifestsPromptVersion(actorId), schemaVersion: SCHEMA_VERSION,
  };
}

function manifestsPromptVersion(actorId: string): string {
  return actorId.endsWith("_service") ? "deterministic-service.v2" : `cityscope-${actorId}.v2`;
}

function seedUnit(state: WorldState, actorId: string, salt: string): number {
  const hex = digest({ seed: state.snapshot.seed, actorId, salt, intervention: state.intervention ?? null, metrics: state.metrics, stakeholders: state.stakeholders }).slice(0, 8);
  return Number.parseInt(hex, 16) / 0xffffffff;
}

function behaviorAudience(state: WorldState): string[] {
  return Object.keys(state.agentMemory).filter((actorId) => !actorId.endsWith("_service"));
}
