import { SCHEMA_VERSION, type ActorManifest, type AgentAction, type AgentManifest, type WorldState } from "../domain.js";
import type { DecisionSupportContext } from "../decision-support/types.js";
import { cityCompetitionForState } from "../decision-support/city-competition.js";
import { deterministicId, digest } from "../util.js";
import { behaviorAgents } from "./manifests.js";

export function deterministicAgentAction(manifest: AgentManifest, observation: WorldState, decisionSupport?: DecisionSupportContext): AgentAction {
  return explainDecisionSupport(baseDeterministicAgentAction(manifest, observation, decisionSupport), observation, decisionSupport);
}

function baseDeterministicAgentAction(manifest: AgentManifest, observation: WorldState, decisionSupport?: DecisionSupportContext): AgentAction {
  const phase = observation.simulation.phase;
  const actorId = manifest.agentId;
  if (phase === "internal_advice") return internalAdvice(actorId, observation);
  if (phase === "policy_formation") return leaderPolicy(actorId, observation);
  if (phase === "policy_audit") {
    if (actorId === "policy_supervisor") return auditPolicies(observation);
  }
  if (phase === "coordination_debate") return coordinationDebate(actorId, observation);
  if (phase === "stakeholder_reaction" || phase === "delivery_reaction") return stakeholderReaction(actorId, observation);
  if (phase === "company_deliberation") return companyDeliberation(actorId, observation, false);
  if (phase === "due_diligence" && actorId === "policy_supervisor") {
    return action(actorId, "REQUEST_DUE_DILIGENCE", { scope: ["orders", "cash_flow"], round: 2 }, "正式政策发布后启动第二轮订单与现金流尽调", observation);
  }
  if (phase === "risk_reassessment") {
    if (actorId === "talent_sme" || actorId === "resident") return stakeholderReaction(actorId, observation);
    if (["chengdu_investment", "chengdu_finance", "chongqing_investment", "chongqing_finance"].includes(actorId)) return riskAdvice(actorId, observation);
  }
  if (phase === "policy_revision") return cityRevisionDecision(actorId, observation, decisionSupport);
  if (phase === "coordination_resolution") return coordinationResolution(actorId, observation);
  if (phase === "final_deliberation") return companyDeliberation(actorId, observation, true);
  if (phase === "post_disclosure") return companyDeliberation(actorId, observation, true);
  return pass(actorId, observation, `当前阶段 ${phase} 无需该主体行动`);
}

function explainDecisionSupport(action: AgentAction, state: WorldState, support: DecisionSupportContext | undefined): AgentAction {
  const candidateKinds = new Set<AgentAction["kind"]>([
    "SUBMIT_POLICY_PACK",
    "REVISE_POLICY_PACK",
    "PROPOSE_COORDINATION_PLAN",
    "ACCEPT_POLICY",
    "ACCEPT_COORDINATION_PLAN",
  ]);
  if (!candidateKinds.has(action.kind)) return action;
  const row = support?.actorRanking?.rows[0];
  if (!support || !row) return action;
  const candidate = support.candidates.find((item) => item.candidateId === row.candidateId);
  if (!candidate) return action;
  const consensus = support.consensusCandidateId === candidate.candidateId ? "接近跨角色共识" : "因本角色底线偏离共识";
  const reasoning = `${action.reasoning}；引用候选${candidate.candidateId.slice(-8)}，TOPSIS ${row.closeness.toFixed(3)}，${consensus}`.slice(0, 120);
  return {
    ...action,
    actionId: deterministicId("action", action.actorId, action.kind, state.runId, state.worldVersion, state.snapshot.seed, action.payload, candidate.candidateId),
    reasoning,
  };
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
  if (["talent_sme", "resident"].includes(manifest.agentId) && ["stakeholder_reaction", "risk_reassessment", "delivery_reaction"].includes(observation.simulation.phase)) {
    return stakeholderReaction(manifest.agentId, observation);
  }
  if (manifest.agentId === "world_resource_service" && observation.simulation.phase === "impact_assessment") {
    return action(manifest.agentId, "ASSESS_LONG_TERM_IMPACT", { assessments: impactAssessments(observation) }, "按同一终态计算十二与二十四个月政策后果", observation);
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
      policyId: deterministicId("policy_cd", state.snapshot.seed, state.worldVersion, state.interventionId ?? "root"), cityId, decisionMode: "COMPROMISE", investmentMillionCny: 3_000,
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
    policyId: deterministicId("policy_cq", state.snapshot.seed, state.worldVersion, state.interventionId ?? "root"), cityId, decisionMode: "COMPROMISE", investmentMillionCny: 3_000,
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

function coordinationDebate(actorId: string, state: WorldState): AgentAction {
  const existingThread = state.debateThreads[0];
  const threadId = existingThread?.threadId ?? "coordination-main";
  const messages = existingThread?.messages ?? [];
  const latest = messages.at(-1);
  const opening = messages[0];
  const proposal = [...messages].reverse().find((message) => message.turnType === "proposal");
  const audience = ["regional_coordinator", "chengdu_leader", "chongqing_leader", "policy_supervisor"];
  const message = (turnType: "challenge" | "position" | "proposal" | "counter" | "concession", issue: "functional_allocation" | "duplicate_subsidy" | "fiscal_risk", stance: "support" | "oppose" | "conditional" | "mediate", content: string, replyToMessageId?: string) => action(actorId, "SEND_DEBATE_MESSAGE", {
    messageId: deterministicId("debate-message", state.runId, threadId, messages.length + 1, actorId),
    threadId, turnType, issue, stance, content, audience, visibility: "participants",
    ...(replyToMessageId ? { replyToMessageId } : {}),
  }, content, state);

  if (actorId === "regional_coordinator" && messages.length === 0) {
    return message("challenge", "duplicate_subsidy", "mediate", "两城政策包同时提供现金和场地，存在重复补贴；请分别说明不可让步的核心功能与可削减条件。 ");
  }
  if (actorId === "chengdu_leader" && messages.length === 1) {
    return message("position", "functional_allocation", "conditional", "成都坚持研发总部与高端人才平台，但可以放弃大规模制造厂房，并将现金支持改为研发岗位达标后兑现。", opening?.messageId);
  }
  if (actorId === "chongqing_leader" && messages.length === 2) {
    return message("position", "functional_allocation", "conditional", "重庆坚持智能工厂和供应链基地，但不再争夺研发总部；现金支持可以与实际产值和本地采购挂钩。", opening?.messageId);
  }
  if (actorId === "regional_coordinator" && messages.length === 3) {
    return message("proposal", "functional_allocation", "mediate", "提出分工方案：研发总部和训练中心落成都，智能工厂和供应链基地落重庆；两城取消功能重叠补贴，分别按招聘与产值兑现。", latest?.messageId);
  }
  if (actorId === "chengdu_leader" && messages.length === 4) {
    return message("concession", "duplicate_subsidy", "support", "成都接受制造环节落重庆，并削减重复厂房支持；条件是研发总部、核心算法团队和人才住房明确落在成都。", proposal?.messageId);
  }
  if (actorId === "chongqing_leader" && messages.length === 5) {
    return message("concession", "duplicate_subsidy", "support", "重庆接受研发总部落成都，并取消总部类补贴；条件是智能工厂、供应链采购和产值考核明确落在重庆。", proposal?.messageId);
  }
  if (actorId === "regional_coordinator" && messages.length >= 6) {
    const policies = openPolicies(state);
    const candidate = bestDualCandidate(state);
    if (!candidate) return pass(actorId, state, "当前硬约束下不存在可审计的双城拆分候选");
    return action(actorId, "PROPOSE_COORDINATION_PLAN", {
      planId: deterministicId("coordination-plan", threadId, candidate.candidateId), candidateId: candidate.candidateId,
      sourcePolicyIds: policies.map((policy) => policy.policyId), assignments: candidate.assignments,
      cityTerms: {
        chengdu: [{ termId: "joint_cd_cash", type: "cash_support", amountMillionCny: 160, trigger: { metric: "verifiedJobs", operator: ">=", value: 260 }, deadline: "year_2", failureAction: "cancel_payment" }, { termId: "joint_cd_housing", type: "talent_housing", quantity: 260 }],
        chongqing: [{ termId: "joint_cq_cash", type: "cash_support", amountMillionCny: 180, trigger: { metric: "annualOutputMillionCny", operator: ">=", value: 1500 }, deadline: "year_3", failureAction: "clawback" }, { termId: "joint_cq_factory", type: "facility", quantity: 100000 }],
      },
      investmentMillionCny: Math.min(2_400, candidate.investmentMillionCny),
      milestones: [{ metric: "bindingOrderRatio", operator: ">=", value: 0.3 }, { metric: "verifiedJobs", operator: ">=", value: 260 }],
      commonPlatform: { name: "成渝具身智能联合测试平台", payerShares: { chengdu: 0.45, chongqing: 0.55 } },
      concessions: { chengdu: ["放弃大规模制造厂房支持"], chongqing: ["放弃研发总部补贴" ] },
    }, "双方形成可核验让步，提交由硬约束候选支撑的双城方案", state, ["fact_orders_nonbinding"]);
  }
  return pass(actorId, state, "当前不是该主体的协调回应轮次");
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
    if (state.cities.chengdu.bidStatus === "withdrawn" && state.cities.chongqing.bidStatus === "withdrawn") return action(actorId, "EXIT_PROJECT", { reasonCode: "BOTH_CITIES_WITHDREW" }, "两座城市均正式撤回要约，董事会终止本区域项目", state, ["fact_cash_12m", "fact_orders_nonbinding"]);
    if (state.metrics.financingConfidence < 10 || state.company.bindingOrderRatio < 0.25 || state.metrics.projectViability < 25) return action(actorId, "EXIT_PROJECT", { reasonCode: "EXECUTION_FINANCING_BELOW_RED_LINE" }, "融资、订单或可执行性跌破董事会签署红线", state, ["fact_cash_12m", "fact_orders_nonbinding"]);
    const coordination = state.coordinationPlans.find((plan) => plan.status === "proposed" && plan.auditStatus === "approved" && plan.responses.chengdu && plan.responses.chongqing && ![plan.responses.chengdu.decision, plan.responses.chongqing.decision].includes("reject"));
    if (coordination) return action(actorId, "ACCEPT_COORDINATION_PLAN", { planId: coordination.planId }, "双城方案已获双方接受并通过审计，董事会选择风险拆分", state, ["fact_cash_12m", "fact_orders_nonbinding"]);
    const alreadyAccepted = Object.values(state.cities).flatMap((city) => city.policies).filter((policy) => policy.status === "accepted");
    if (alreadyAccepted.length > 0 && (state.company.investmentPlanMillionCny < 2400 || seedUnit(state, actorId, "second-policy") < 0.55)) return pass(actorId, state, "已有可执行政策，第二城市政策的边际效用不足");
    const candidates = openPolicies(state).filter((policy) => policy.auditStatus === "approved" && policy.status === "issued");
    if (!candidates.length) return action(actorId, "EXIT_PROJECT", { reasonCode: "NO_AUDIT_APPROVED_POLICY" }, "风险披露后没有可接受的已审计政策包，董事会明确终止本轮项目", state, ["fact_cash_12m", "fact_orders_nonbinding"]);
    const competition = cityCompetitionForState(state);
    const selected = [...candidates].sort((left, right) => competition.scores[left.cityId].rank - competition.scores[right.cityId].rank)[0];
    if (!selected) return action(actorId, "EXIT_PROJECT", { reasonCode: "NO_EXECUTABLE_POLICY" }, "所有候选政策均低于董事会执行门槛，正式退出", state, ["fact_cash_12m", "fact_orders_nonbinding"]);
    return action(actorId, "ACCEPT_POLICY", { policyId: selected.policyId }, "董事会按流动性、执行概率和政策效用接受当前最优可执行政策", state, ["fact_cash_12m", "fact_orders_nonbinding"]);
  }
  return pass(actorId, state, "当前企业协商阶段无需行动");
}

function riskAdvice(actorId: string, state: WorldState): AgentAction {
  const cityId = actorId.startsWith("chengdu") ? "chengdu" : "chongqing";
  const fiscalActor = actorId.endsWith("finance");
  return action(actorId, "ADVISE_POLICY", {
    riskRound: 2, recommendation: fiscalActor ? "reduce_and_milestone" : "preserve_core_functions",
    maxInvestmentMillionCny: fiscalActor ? 2_200 : 2_400,
    cityId,
  }, fiscalActor ? "订单风险披露后应缩减前置支持并强化里程碑" : "保留本城核心功能，同时放弃重叠功能争夺", state, ["fact_orders_nonbinding"]);
}

function cityRevisionDecision(actorId: string, state: WorldState, support?: DecisionSupportContext): AgentAction {
  if (!actorId.endsWith("_leader")) return pass(actorId, state, "只有城市负责人能修订或撤回正式要约");
  const cityId = actorId.startsWith("chengdu") ? "chengdu" : "chongqing";
  const current = [...state.cities[cityId].policies].reverse().find((policy) => policy.status === "issued");
  if (!current) return pass(actorId, state, "本城没有待修订的正式政策包");
  const talent = state.stakeholders.talentAttraction;
  const supply = state.stakeholders.supplyChainReadiness;
  const cityScore = cityId === "chengdu" ? talent : supply;
  const affordability = state.cities[cityId].resourceLedger.fiscalMillionCny.available / Math.max(1, state.cities[cityId].resourceLedger.fiscalMillionCny.capacity);
  const viability = state.metrics.projectViability + cityScore * 0.25 + state.metrics.financingConfidence * 0.2 + affordability * 20;
  const systemicRedLine = state.metrics.financingConfidence < 35 || state.company.bindingOrderRatio < 0.25 || state.metrics.projectViability < 25;
  // A narrow, seed-stable tolerance band represents legitimate differences in
  // leaders' risk appetite. It creates sensitivity without reading run ids or
  // prescribing an outcome; identical seed + world remains replayable.
  const comparativeTolerance = 8 + Math.floor(seedUnit(state, actorId, "comparative-tolerance") * 5);
  const viabilityFloor = 56 + Math.floor(seedUnit(state, actorId, "viability-floor") * 5);
  const comparativeDisadvantage = cityId === "chengdu" ? supply - talent >= comparativeTolerance : talent - supply >= comparativeTolerance;
  if (systemicRedLine || viability < viabilityFloor || comparativeDisadvantage) {
    const reasonCodes = systemicRedLine
      ? ["SYSTEMIC_EXECUTION_RISK"]
      : comparativeDisadvantage
        ? ["COMPARATIVE_ADVANTAGE_LOST"]
        : ["RISK_ADJUSTED_VALUE_BELOW_FLOOR"];
    return action(actorId, "WITHDRAW_CITY_OFFER", { cityId, reasonCodes }, systemicRedLine ? "订单或融资跌破执行红线，本城停止继续投入" : comparativeDisadvantage ? "另一城市的核心能力显著占优，本城撤回完整项目要约" : "风险调整价值低于本城底线，正式撤回要约", state, ["fact_orders_nonbinding", cityId === "chengdu" ? "fact_cd_capacity" : "fact_cq_capacity"]);
  }
  const row = support?.actorRanking?.rows.find((item) => support.candidates.find((candidate) => candidate.candidateId === item.candidateId)?.assignments && Object.values(support.candidates.find((candidate) => candidate.candidateId === item.candidateId)!.assignments).includes(cityId));
  const candidate = support?.candidates.find((item) => item.candidateId === row?.candidateId) ?? support?.candidates[0];
  const candidateId = candidate?.candidateId ?? deterministicId("fallback-candidate", cityId, state.worldVersion);
  const cash = cityId === "chengdu" ? 220 : 240;
  return action(actorId, "REVISE_POLICY_PACK", {
    policyId: deterministicId(`policy_${cityId}_v2`, current.policyId, candidateId), cityId, decisionMode: "COMPROMISE",
    supersedesPolicyId: current.policyId, candidateId, investmentMillionCny: Math.min(2_200, candidate?.investmentMillionCny ?? 2_200),
    terms: cityId === "chengdu"
      ? [{ termId: "cd_v2_cash", type: "cash_support", amountMillionCny: cash, trigger: { metric: "verifiedJobs", operator: ">=", value: 260 }, deadline: "year_2", failureAction: "cancel_payment" }, { termId: "cd_v2_housing", type: "talent_housing", quantity: 300 }]
      : [{ termId: "cq_v2_cash", type: "cash_support", amountMillionCny: cash, trigger: { metric: "annualOutputMillionCny", operator: ">=", value: 1600 }, deadline: "year_3", failureAction: "clawback" }, { termId: "cq_v2_factory", type: "facility", quantity: 100000 }],
  }, "尽调后缩小一期规模并把支持改为分阶段兑现", state, ["fact_orders_nonbinding", cityId === "chengdu" ? "fact_cd_capacity" : "fact_cq_capacity"]);
}

function coordinationResolution(actorId: string, state: WorldState): AgentAction {
  const plan = state.coordinationPlans.find((item) => item.status === "proposed");
  if (!plan) return actorId === "policy_supervisor" ? auditPolicies(state) : pass(actorId, state, "没有待响应的联合协调方案");
  if (actorId === "policy_supervisor") {
    if (!plan.responses.chengdu || !plan.responses.chongqing) return pass(actorId, state, "等待两城分别响应联合方案");
    const rejected = [plan.responses.chengdu.decision, plan.responses.chongqing.decision].includes("reject");
    return action(actorId, "AUDIT_COORDINATION_PLAN", { planId: plan.planId, decision: rejected ? "require_repair" : "approve", reasonCodes: rejected ? ["CITY_REJECTED"] : ["BOTH_CITIES_CONSENTED", "NO_DUPLICATE_FUNCTION_SUBSIDY", "MILESTONE_BOUND"] }, rejected ? "一方拒绝后联合方案不能放行" : "双方让步、功能分工和兑现条件均可核验", state);
  }
  const cityId = actorId.startsWith("chengdu") ? "chengdu" : "chongqing";
  const assigned = Object.values(plan.assignments).filter((city) => city === cityId).length;
  const decision = assigned > 0 ? "accept" : "reject";
  return action(actorId, "RESPOND_COORDINATION_PLAN", { planId: plan.planId, cityId, decision, conditions: decision === "accept" ? ["按约定功能与里程碑执行"] : [] }, decision === "accept" ? "本城保留核心功能且重复补贴被移除，同意联合方案" : "联合方案未保留本城核心功能，拒绝接受", state);
}

function bestDualCandidate(state: WorldState): DecisionSupportContext["candidates"][number] | undefined {
  const events = [...state.events].reverse();
  for (const event of events) {
    const support = event.payload.decisionSupport as DecisionSupportContext | undefined;
    const candidate = support?.candidates?.find((item) => new Set(Object.values(item.assignments).filter((city) => city !== "none")).size === 2);
    if (candidate) return candidate;
  }
  return undefined;
}

function impactAssessments(state: WorldState): Array<Omit<import("../domain.js").ImpactAssessment, "assessedAtVersion">> {
  const landed = state.finalDecision?.type !== "regional_exit" && state.company.projectStage !== "exited";
  const coordination = state.finalDecision?.type === "coordination";
  const finalPlan = acceptedInvestmentPlan(state);
  const selectedFunctions = acceptedFunctions(state);
  const functionCount = selectedFunctions.length;
  const hasManufacturing = selectedFunctions.includes("smart_factory");
  const hasSupplyChain = selectedFunctions.includes("supply_chain_base");
  const hasResearch = selectedFunctions.includes("rd_center");
  const hasHeadquarters = selectedFunctions.includes("headquarters");
  const financingFactor = clamp01(state.metrics.financingConfidence / 70);
  const viabilityFactor = clamp01(state.metrics.projectViability / 76);
  const scopeFactor = clamp01(functionCount / 5);
  const orderUplift = (coordination ? 0.13 : 0.07)
    + (hasManufacturing ? 0.04 : 0)
    + (hasSupplyChain ? 0.03 : 0)
    + (hasResearch ? 0.02 : 0);
  const baseConversion = landed
    ? clamp01(state.company.bindingOrderRatio + orderUplift * financingFactor * viabilityFactor)
    : 0;
  return ([12, 24] as const).map((horizon) => {
    const maturity = horizon === 12 ? 0.55 : 0.88;
    const realization = clamp01((0.38 + financingFactor * 0.27 + viabilityFactor * 0.25 + baseConversion * 0.1) * maturity);
    const actualInvestment = landed ? Math.round(finalPlan.investmentMillionCny * realization) : 0;
    const jobsAtFullScope = 240 + functionCount * 150 + (hasResearch ? 120 : 0) + (hasManufacturing ? 210 : 0) + (hasHeadquarters ? 80 : 0);
    const actualJobs = landed ? Math.round(jobsAtFullScope * maturity * (0.45 + baseConversion * 0.55) * viabilityFactor) : 0;
    const utilization = landed
      ? clamp01((0.16 + baseConversion * 0.62 + financingFactor * 0.12 + viabilityFactor * 0.1) * (0.82 + scopeFactor * 0.18))
      : 0;
    const paid = state.commitments.filter((item) => item.status === "paid").reduce((sum, item) => sum + item.amountMillionCny, 0);
    const cancelled = state.commitments.filter((item) => ["failed", "withdrawn"].includes(item.status)).reduce((sum, item) => sum + item.amountMillionCny, 0);
    const policySuccess = !landed ? "not_landed" : utilization >= 0.65 && actualJobs >= 450 ? "successful" : utilization >= 0.4 ? "mixed" : "failed";
    return {
      horizonMonths: horizon, actualInvestmentMillionCny: actualInvestment, actualJobs, orderConversionRatio: baseConversion,
      capacityUtilization: utilization, subsidyPaidMillionCny: paid, subsidyCancelledMillionCny: cancelled, subsidyClawedBackMillionCny: 0,
      fiscalPressure: { chengdu: Math.round(state.cities.chengdu.resourceLedger.fiscalMillionCny.committed / 7), chongqing: Math.round(state.cities.chongqing.resourceLedger.fiscalMillionCny.committed / 5.5) },
      smeCrowdingOut: landed ? Math.max(0, Math.round((paid - 260) / 10)) : 0, talentPressure: landed ? Math.round(actualJobs / 20) : 0,
      housingPressure: state.stakeholders.housingPressure, governmentCredibility: { chengdu: state.cities.chengdu.policyCredibility, chongqing: state.cities.chongqing.policyCredibility },
      publicTrust: state.stakeholders.publicTrust, policySuccess, evidence: [
        `finalDecision=${state.finalDecision?.type ?? "none"}`,
        `acceptedSource=${finalPlan.source}`,
        `acceptedInvestmentMillionCny=${finalPlan.investmentMillionCny}`,
        `requestedInvestmentMillionCny=${state.company.investmentPlanMillionCny}`,
        `selectedFunctions=${selectedFunctions.join(",") || "none"}`,
        `horizon=${horizon}`,
        `orderConversion=${baseConversion.toFixed(2)}`,
      ],
    };
  });
}

function acceptedInvestmentPlan(state: WorldState): { investmentMillionCny: number; source: string } {
  if (state.finalDecision?.type === "coordination") {
    const plan = state.coordinationPlans.find((item) => item.planId === state.finalDecision?.coordinationPlanId && item.status === "accepted");
    if (plan) return { investmentMillionCny: plan.investmentMillionCny, source: "accepted_coordination_plan" };
  }
  if (state.finalDecision?.type === "single_city") {
    const policy = Object.values(state.cities).flatMap((city) => city.policies)
      .find((item) => item.policyId === state.finalDecision?.policyId && item.status === "accepted");
    if (policy) return { investmentMillionCny: policy.investmentMillionCny, source: "accepted_policy_pack" };
  }
  return { investmentMillionCny: 0, source: "no_accepted_plan" };
}

function acceptedFunctions(state: WorldState): import("../domain.js").ProjectFunctionId[] {
  if (state.finalDecision?.type === "coordination") {
    const plan = state.coordinationPlans.find((item) => item.planId === state.finalDecision?.coordinationPlanId && item.status === "accepted");
    if (plan) return Object.entries(plan.assignments)
      .filter(([, cityId]) => cityId !== "none")
      .map(([functionId]) => functionId as import("../domain.js").ProjectFunctionId);
  }
  if (state.finalDecision?.type === "single_city") {
    const policy = Object.values(state.cities).flatMap((city) => city.policies)
      .find((item) => item.policyId === state.finalDecision?.policyId && item.status === "accepted");
    const candidate = latestCandidate(state, policy?.candidateId);
    if (candidate) return Object.entries(candidate.assignments)
      .filter(([, cityId]) => cityId !== "none")
      .map(([functionId]) => functionId as import("../domain.js").ProjectFunctionId);
  }
  return [];
}

function latestCandidate(state: WorldState, candidateId: string | undefined): DecisionSupportContext["candidates"][number] | undefined {
  if (!candidateId) return undefined;
  for (const event of [...state.events].reverse()) {
    const support = event.payload.decisionSupport as DecisionSupportContext | undefined;
    const candidate = support?.candidates?.find((item) => item.candidateId === candidateId);
    if (candidate) return candidate;
  }
  return undefined;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
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

function behaviorAudience(_state: WorldState): string[] {
  return behaviorAgents.map((manifest) => manifest.agentId);
}
