import type { AgentManifest, WorldState } from "../domain.js";

const verifiedAt = "2026-08-11";
const common = { manifestVersion: "0.1" as const, promptVersion: "cityscope-agent.v1", provenance: { source: "CityScope scenario design", verifiedAt } };

export const manifests: Record<string, AgentManifest> = Object.fromEntries(
  [
    {
      ...common, agentId: "regional_coordinator", displayName: "区域协调 Agent", organization: "superior" as const, role: "协调区域竞争与合作", permissions: ["recommend" as const, "revise" as const], forbidden: ["sign_policy", "transfer_budget"], goals: ["减少恶性竞争", "提升区域总产业能力"], redLines: ["禁止绕过城市负责人承诺"], utility: [{ dimension: "regional_spillover", weight: 0.6, direction: "maximize" as const }, { dimension: "duplicate_subsidy", weight: 0.4, direction: "minimize" as const }], privateFactScopes: ["policy_capacity"],
    },
    {
      ...common, agentId: "policy_supervisor", displayName: "政策监督 Agent", organization: "superior" as const, role: "监督政策合规与可信度", permissions: ["recommend" as const, "request_audit" as const], forbidden: ["sign_policy", "override_audit"], goals: ["政策合规", "承诺可兑现"], redLines: ["不得批准超预算承诺"], utility: [{ dimension: "compliance", weight: 0.7, direction: "maximize" as const }, { dimension: "fiscal_risk", weight: 0.3, direction: "minimize" as const }], privateFactScopes: ["policy_capacity"],
    },
    cityAgent("chengdu_investment", "成都招商 Agent", "chengdu_leader", ["propose", "revise", "recommend"], [
      ["rd_jobs", 0.3], ["senior_talent", 0.25], ["headquarters", 0.25], ["investment_scale", 0.2],
    ], ["争取研发总部", "争取高端人才"], ["sign_policy", "transfer_budget", "override_audit"]),
    cityAgent("chengdu_finance", "成都财政 Agent", "chengdu_leader", ["recommend", "revise"], [
      ["fiscal_sustainability", 0.45], ["milestone_certainty", 0.35], ["policy_credibility", 0.2],
    ], ["控制前置支付", "按投资进度兑现"], ["sign_policy", "transfer_budget", "override_audit"]),
    cityAgent("chengdu_leader", "成都负责人 Agent", "regional_coordinator", ["sign_policy", "revise", "recommend"], [
      ["rd_jobs", 0.25], ["headquarters", 0.25], ["fiscal_sustainability", 0.3], ["policy_credibility", 0.2],
    ], ["形成成都正式政策包", "在招商与财政之间作出选择"], ["override_audit"]),
    cityAgent("chongqing_investment", "重庆招商 Agent", "chongqing_leader", ["propose", "revise", "recommend"], [
      ["manufacturing_output", 0.3], ["factory_landing", 0.25], ["supply_chain", 0.25], ["jobs", 0.2],
    ], ["争取智能工厂", "带动供应链"], ["sign_policy", "transfer_budget", "override_audit"]),
    cityAgent("chongqing_finance", "重庆财政 Agent", "chongqing_leader", ["recommend", "revise"], [
      ["fiscal_sustainability", 0.4], ["output_certainty", 0.4], ["facility_utilization", 0.2],
    ], ["控制现金补贴", "确保产值兑现"], ["sign_policy", "transfer_budget", "override_audit"]),
    cityAgent("chongqing_leader", "重庆负责人 Agent", "regional_coordinator", ["sign_policy", "revise", "recommend"], [
      ["manufacturing_output", 0.3], ["supply_chain", 0.25], ["fiscal_sustainability", 0.25], ["policy_credibility", 0.2],
    ], ["形成重庆正式政策包", "在招商与财政之间作出选择"], ["override_audit"]),
    {
      ...common, agentId: "company_ceo", displayName: "星岚机器人 CEO Agent", organization: "company" as const, role: "扩张、估值与产业影响力", reportsTo: "company_board", permissions: ["propose" as const, "recommend" as const], forbidden: ["sign_company_response", "sign_policy", "decide_financing"], goals: ["快速扩张", "提升估值", "扩大行业影响力"], redLines: ["不接受失去经营控制权"], utility: [{ dimension: "growth_speed", weight: 0.4, direction: "maximize" as const }, { dimension: "brand", weight: 0.3, direction: "maximize" as const }, { dimension: "control", weight: 0.3, direction: "maximize" as const }], privateFactScopes: ["order_quality"],
    },
    {
      ...common, agentId: "company_cfo", displayName: "星岚机器人 CFO Agent", organization: "company" as const, role: "现金流与刚性承诺控制", reportsTo: "company_board", permissions: ["propose" as const, "recommend" as const], forbidden: ["sign_company_response", "sign_policy", "transfer_budget"], goals: ["提高前置现金", "减少自有资金", "保留退出空间"], redLines: ["现金跑道低于六个月", "无融资保障的刚性产值承诺"], utility: [{ dimension: "upfront_cash", weight: 0.4, direction: "maximize" as const }, { dimension: "own_capital", weight: 0.3, direction: "minimize" as const }, { dimension: "rigid_commitment", weight: 0.3, direction: "minimize" as const }], privateFactScopes: ["cash_runway", "order_quality"],
    },
    {
      ...common, agentId: "company_board", displayName: "星岚机器人董事会 Agent", organization: "company" as const, role: "在 CEO/CFO 意见冲突后签发企业正式回应", permissions: ["sign_company_response" as const, "accept_policy" as const, "withdraw_commitment" as const, "exit_project" as const], forbidden: ["sign_policy", "decide_financing", "transfer_budget"], goals: ["平衡增长与偿付能力", "形成正式公司立场"], redLines: ["不在内部建议缺失时签发回应"], utility: [{ dimension: "enterprise_value", weight: 0.4, direction: "maximize" as const }, { dimension: "liquidity_risk", weight: 0.35, direction: "minimize" as const }, { dimension: "execution_probability", weight: 0.25, direction: "maximize" as const }], privateFactScopes: ["cash_runway", "order_quality"],
    },
    {
      ...common, agentId: "investor", displayName: "投资机构 Agent", organization: "capital" as const, role: "独立融资判断", permissions: ["decide_financing" as const, "recommend" as const], forbidden: ["sign_company_response", "sign_policy", "choose_city"], goals: ["风险调整回报", "提高订单确定性"], redLines: ["非约束订单不能作为完整工厂融资依据"], utility: [{ dimension: "binding_orders", weight: 0.45, direction: "maximize" as const }, { dimension: "cash_burn", weight: 0.3, direction: "minimize" as const }, { dimension: "policy_support", weight: 0.25, direction: "maximize" as const }], privateFactScopes: ["financing_market"],
    },
    {
      ...common, agentId: "due_diligence_service", displayName: "尽调规则服务", organization: "rule_service" as const, role: "验证并披露事实，不参与语言谈判", permissions: ["request_audit" as const, "disclose_fact" as const], forbidden: ["negotiate", "sign_policy", "sign_company_response"], goals: ["按轮次核验材料"], redLines: ["不得在触发前披露私有事实"], utility: [], privateFactScopes: ["cash_runway", "order_quality", "financing_market", "policy_capacity"],
    },
    {
      ...common, agentId: "world_service", displayName: "世界规则服务", organization: "rule_service" as const, role: "验证项目进度并执行承诺触发器", permissions: ["advance_project" as const], forbidden: ["negotiate", "sign_policy", "sign_company_response"], goals: ["确定性更新世界", "执行承诺账本"], redLines: ["不得生成语言谈判", "不得绕过 Gate"], utility: [], privateFactScopes: [],
    },
  ].map((manifest) => [manifest.agentId, manifest]),
);

function cityAgent(agentId: string, displayName: string, reportsTo: string, permissions: AgentManifest["permissions"], dimensions: Array<[string, number]>, goals: string[], forbidden: string[]): AgentManifest {
  return {
    ...common,
    agentId,
    displayName,
    organization: agentId.startsWith("chengdu") ? "chengdu" : "chongqing",
    role: displayName.includes("招商") ? "产业招商建议" : displayName.includes("财政") ? "财政风险制衡" : "城市正式决策",
    reportsTo,
    permissions,
    forbidden,
    goals,
    redLines: displayName.includes("财政") ? ["不得超预算", "高风险项目不得无条件前置支付"] : ["不得越权签署其他组织承诺"],
    utility: dimensions.map(([dimension, weight]) => ({ dimension, weight, direction: dimension.includes("risk") ? "minimize" : "maximize" })),
    privateFactScopes: displayName.includes("财政") || displayName.includes("负责人") ? ["policy_capacity"] : [],
  };
}

export function validateManifestWeights(): string[] {
  return Object.values(manifests).flatMap((manifest) => {
    if (manifest.utility.length === 0) return [];
    const total = manifest.utility.reduce((sum, item) => sum + item.weight, 0);
    return Math.abs(total - 1) < 1e-9 ? [] : [`${manifest.agentId}: utility weights sum to ${total}`];
  });
}

export function scoreForAgent(agentId: string, dimensions: Record<string, number>): { total: number; components: Record<string, number> } {
  const manifest = manifests[agentId];
  if (!manifest) throw new Error(`unknown agent: ${agentId}`);
  const components: Record<string, number> = {};
  for (const item of manifest.utility) {
    const raw = dimensions[item.dimension] ?? 0;
    components[item.dimension] = item.weight * (item.direction === "maximize" ? raw : -raw);
  }
  return { total: Object.values(components).reduce((sum, value) => sum + value, 0), components };
}

export function observe(state: WorldState, agentId: string): WorldState {
  const manifest = manifests[agentId];
  if (!manifest) throw new Error(`unknown agent: ${agentId}`);
  const visibleFacts = state.facts.filter(
    (fact) => fact.visibility === "disclosed" || fact.ownerId === agentId || fact.audience.includes(agentId) || manifest.privateFactScopes.includes(fact.kind),
  );
  return structuredClone({ ...state, facts: visibleFacts });
}
