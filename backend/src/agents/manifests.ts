import type { ActorManifest, AgentManifest, Permission, ServiceManifest, UtilityDimension, WorldState } from "../domain.js";

const verifiedAt = "2026-08-11";
const provenance = { source: "CityScope scenario design", verifiedAt };

function agent(input: {
  agentId: string;
  displayName: string;
  organization: AgentManifest["organization"];
  role: string;
  reportsTo?: string;
  permissions: Permission[];
  forbidden: string[];
  goals: string[];
  redLines: string[];
  utility: Array<[string, number, ("maximize" | "minimize")?]>;
  privateFactScopes?: string[];
  promptVersion?: string;
}): AgentManifest {
  return {
    manifestVersion: "0.1",
    actorKind: "agent",
    agentId: input.agentId,
    displayName: input.displayName,
    organization: input.organization,
    role: input.role,
    ...(input.reportsTo ? { reportsTo: input.reportsTo } : {}),
    permissions: input.permissions,
    forbidden: input.forbidden,
    goals: input.goals,
    redLines: input.redLines,
    utility: input.utility.map(([dimension, weight, direction = "maximize"]) => ({ dimension, weight, direction })),
    privateFactScopes: input.privateFactScopes ?? [],
    promptVersion: input.promptVersion ?? `cityscope-${input.agentId}.v2`,
    provenance,
  };
}

function service(input: {
  agentId: string;
  displayName: string;
  role: string;
  permissions: Permission[];
  forbidden: string[];
  privateFactScopes: string[];
  responsibilities: string[];
}): ServiceManifest {
  return {
    manifestVersion: "0.1",
    actorKind: "service",
    agentId: input.agentId,
    displayName: input.displayName,
    organization: "rule_service",
    role: input.role,
    permissions: input.permissions,
    forbidden: input.forbidden,
    privateFactScopes: input.privateFactScopes,
    deterministicResponsibilities: input.responsibilities,
    provenance,
  };
}

const actors: ActorManifest[] = [
  agent({
    agentId: "regional_coordinator", displayName: "区域协调 Agent", organization: "superior", role: "识别重复补贴、区域资源冲突与拆分合作空间",
    permissions: ["coordinate", "debate", "recommend", "pass"], forbidden: ["sign_policy", "transfer_budget"], goals: ["降低恶性竞争", "提高区域产业互补"], redLines: ["不得替地方签约", "不得指定企业结局"],
    utility: [["regional_spillover", 0.4], ["functional_complementarity", 0.35], ["duplicate_subsidy", 0.25, "minimize"]], privateFactScopes: ["policy_capacity"],
  }),
  agent({
    agentId: "policy_supervisor", displayName: "政策监督 Agent", organization: "superior", role: "审计正式 PolicyPack 并给出 approve/flag/require_repair",
    permissions: ["audit_policy", "request_audit", "recommend", "pass"], forbidden: ["sign_policy", "override_audit"], goals: ["政策合规", "承诺可兑现"], redLines: ["不得放行超预算或重复占用", "不得代替地方负责人"],
    utility: [["compliance", 0.45], ["fiscal_sustainability", 0.35], ["policy_credibility", 0.2]], privateFactScopes: ["policy_capacity"],
  }),
  cityAgent("chengdu_investment", "成都招商 Agent", "chengdu", "chengdu_leader", ["propose", "revise", "recommend", "pass"], [["rd_jobs", 0.3], ["senior_talent", 0.25], ["headquarters", 0.25], ["investment_scale", 0.2]], ["研发总部", "人才集聚"], ["不得签发政策包", "不得绕过财政"]),
  cityAgent("chengdu_finance", "成都财政 Agent", "chengdu", "chengdu_leader", ["recommend", "revise", "pass"], [["fiscal_sustainability", 0.45], ["milestone_certainty", 0.35], ["policy_credibility", 0.2]], ["控制前置支付", "保持财政可兑现"], ["不得签发政策包", "不得超预算"]),
  cityAgent("chengdu_leader", "成都负责人 Agent", "chengdu", "regional_coordinator", ["sign_policy", "withdraw_city_offer", "respond_coordination", "revise", "recommend", "debate", "pass"], [["rd_jobs", 0.25], ["headquarters", 0.25], ["fiscal_sustainability", 0.3], ["policy_credibility", 0.2]], ["形成成都正式政策包"], ["不得覆盖审计", "不得占用不存在资源"]),
  cityAgent("chongqing_investment", "重庆招商 Agent", "chongqing", "chongqing_leader", ["propose", "revise", "recommend", "pass"], [["manufacturing_output", 0.3], ["factory_landing", 0.25], ["supply_chain", 0.25], ["jobs", 0.2]], ["智能工厂", "供应链基地"], ["不得签发政策包", "不得绕过财政"]),
  cityAgent("chongqing_finance", "重庆财政 Agent", "chongqing", "chongqing_leader", ["recommend", "revise", "pass"], [["fiscal_sustainability", 0.4], ["output_certainty", 0.4], ["facility_utilization", 0.2]], ["控制现金补贴", "确保产值兑现"], ["不得签发政策包", "不得超预算"]),
  cityAgent("chongqing_leader", "重庆负责人 Agent", "chongqing", "regional_coordinator", ["sign_policy", "withdraw_city_offer", "respond_coordination", "revise", "recommend", "debate", "pass"], [["manufacturing_output", 0.3], ["supply_chain", 0.25], ["fiscal_sustainability", 0.25], ["policy_credibility", 0.2]], ["形成重庆正式政策包"], ["不得覆盖审计", "不得占用不存在资源"]),
  agent({
    agentId: "company_ceo", displayName: "星岚机器人 CEO Agent", organization: "company", role: "扩张、估值与产业影响力", reportsTo: "company_board", permissions: ["propose", "recommend", "pass"], forbidden: ["sign_company_response", "sign_policy"], goals: ["可执行扩张", "品牌与估值"], redLines: ["不接受失去经营控制权", "不得伪造订单"], utility: [["growth_speed", 0.4], ["brand", 0.3], ["control", 0.3]], privateFactScopes: ["order_quality"],
  }),
  agent({
    agentId: "company_cfo", displayName: "星岚机器人 CFO Agent", organization: "company", role: "现金流与刚性承诺控制", reportsTo: "company_board", permissions: ["propose", "recommend", "pass"], forbidden: ["sign_company_response", "sign_policy"], goals: ["提高前置现金", "降低刚性承诺"], redLines: ["现金跑道低于六个月", "无融资保障的高产值承诺"], utility: [["upfront_cash", 0.4], ["own_capital", 0.3, "minimize"], ["rigid_commitment", 0.3, "minimize"]], privateFactScopes: ["cash_runway", "order_quality"],
  }),
  agent({
    agentId: "company_board", displayName: "星岚机器人董事会 Agent", organization: "company", role: "签发企业正式回应与投资决定", permissions: ["sign_company_response", "accept_policy", "accept_coordination", "withdraw_commitment", "exit_project", "pass"], forbidden: ["sign_policy", "decide_financing"], goals: ["平衡增长与偿付能力", "形成正式企业立场"], redLines: ["未收齐 CEO/CFO 意见不得决定", "不得接受未审计政策"], utility: [["enterprise_value", 0.4], ["liquidity_risk", 0.35, "minimize"], ["execution_probability", 0.25]], privateFactScopes: ["cash_runway", "order_quality"],
  }),
  agent({
    agentId: "investor", displayName: "投资机构 Agent", organization: "capital", role: "作出独立融资判断", permissions: ["decide_financing", "recommend", "pass"], forbidden: ["sign_company_response", "choose_city"], goals: ["风险调整回报", "订单确定性"], redLines: ["非约束订单不能支持完整工厂融资"], utility: [["binding_orders", 0.45], ["cash_burn", 0.3, "minimize"], ["policy_support", 0.25]], privateFactScopes: ["financing_market"],
  }),
  service({
    agentId: "talent_sme", displayName: "人才与中小企业分布模拟器", role: "确定性计算人才、住房、本地采购和中小企业参与分布", permissions: ["publish_reaction", "pass"], forbidden: ["sign_policy", "sign_company_response", "free_language"], privateFactScopes: [], responsibilities: ["population distribution update", "SME crowding-out calculation"],
  }),
  service({
    agentId: "resident", displayName: "居民与公共资源模拟器", role: "确定性计算就业收益、财政公平和公共资源压力", permissions: ["publish_reaction", "pass"], forbidden: ["sign_policy", "sign_company_response", "free_language"], privateFactScopes: [], responsibilities: ["resident distribution update", "public trust calculation"],
  }),
  service({
    agentId: "due_diligence_service", displayName: "尽调规则服务", role: "按阶段核验并披露事实", permissions: ["request_audit", "disclose_fact", "pass"], forbidden: ["negotiate", "sign_policy", "free_language"], privateFactScopes: ["cash_runway", "order_quality", "financing_market", "policy_capacity"], responsibilities: ["round-gated fact verification", "audience-scoped disclosure"],
  }),
  service({
    agentId: "world_resource_service", displayName: "世界与资源规则服务", role: "确定性更新项目进度、资源、承诺与长期影响", permissions: ["advance_project", "pass"], forbidden: ["negotiate", "sign_policy", "free_language"], privateFactScopes: [], responsibilities: ["resource ledger transitions", "commitment trigger evaluation", "project progress update", "long-term impact assessment"],
  }),
];

export const manifests: Record<string, ActorManifest> = Object.fromEntries(actors.map((manifest) => [manifest.agentId, manifest]));
export const behaviorAgents = actors.filter((manifest): manifest is AgentManifest => manifest.actorKind === "agent");
export const deterministicServices = actors.filter((manifest): manifest is ServiceManifest => manifest.actorKind === "service");

function cityAgent(agentId: string, displayName: string, organization: "chengdu" | "chongqing", reportsTo: string, permissions: Permission[], utility: Array<[string, number]>, goals: string[], redLines: string[]): AgentManifest {
  return agent({ agentId, displayName, organization, role: displayName.includes("招商") ? "产业招商建议" : displayName.includes("财政") ? "财政风险制衡" : "城市正式决策", reportsTo, permissions, forbidden: ["override_audit", ...(displayName.includes("负责人") ? [] : ["sign_policy"])], goals, redLines, utility });
}

export function validateManifestWeights(): string[] {
  return behaviorAgents.flatMap((manifest) => {
    const total = manifest.utility.reduce((sum, item) => sum + item.weight, 0);
    return manifest.utility.length > 0 && Math.abs(total - 1) < 1e-9 ? [] : [`${manifest.agentId}: invalid utility weights ${total}`];
  });
}

export function scoreForAgent(agentId: string, dimensions: Record<string, number>): { total: number; components: Record<string, number> } {
  const manifest = manifests[agentId];
  if (!manifest || manifest.actorKind !== "agent") throw new Error(`actor ${agentId} is not a behavior agent`);
  const components: Record<string, number> = {};
  for (const item of manifest.utility) {
    const raw = dimensions[item.dimension] ?? 0;
    components[item.dimension] = item.weight * (item.direction === "maximize" ? raw : -raw);
  }
  return { total: Object.values(components).reduce((sum, value) => sum + value, 0), components };
}

export function observe(state: WorldState, actorId: string): WorldState {
  const manifest = manifests[actorId];
  if (!manifest) throw new Error(`unknown actor: ${actorId}`);
  const visibleFacts = state.facts.filter((fact) => fact.visibility === "disclosed" || fact.ownerId === actorId || fact.audience.includes(actorId) || manifest.privateFactScopes.includes(fact.kind));
  const visibleDebateThreads = state.debateThreads
    .filter((thread) => thread.participantIds.includes(actorId) || thread.messages.some((message) => message.visibility === "public"))
    .map((thread) => ({
      ...thread,
      messages: thread.messages.filter((message) => message.visibility === "public" || message.actorId === actorId || message.audience.includes(actorId)),
    }));
  const cityAdvice = (cityId: "chengdu" | "chongqing") => {
    if (manifest.organization !== cityId) return [];
    return actorId === `${cityId}_leader`
      ? state.cities[cityId].internalAdvice
      : state.cities[cityId].internalAdvice.filter((advice) => advice.actorId === actorId);
  };
  const companyAdvice = manifest.organization !== "company"
    ? []
    : actorId === "company_board"
      ? state.company.internalAdvice
      : state.company.internalAdvice.filter((advice) => advice.actorId === actorId);
  return structuredClone({
    ...state,
    facts: visibleFacts,
    debateThreads: visibleDebateThreads,
    cities: {
      chengdu: { ...state.cities.chengdu, internalAdvice: cityAdvice("chengdu") },
      chongqing: { ...state.cities.chongqing, internalAdvice: cityAdvice("chongqing") },
    },
    company: { ...state.company, internalAdvice: companyAdvice },
    agentMemory: { [actorId]: state.agentMemory[actorId] ?? [] },
  });
}

export function isAgent(manifest: ActorManifest): manifest is AgentManifest {
  return manifest.actorKind === "agent";
}

export function agentUtility(manifest: AgentManifest): UtilityDimension[] {
  return manifest.utility;
}
