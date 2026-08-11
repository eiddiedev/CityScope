import { SCHEMA_VERSION, type AgentAction, type WorldState } from "../domain.js";
import { deterministicId } from "../util.js";

export function makeAction(actorId: string, kind: AgentAction["kind"], payload: Record<string, unknown>, reasoning: string, evidenceFactIds: string[] = []): AgentAction {
  return {
    actionId: deterministicId("action", actorId, kind, payload, reasoning),
    actorId,
    kind,
    reasoning,
    payload,
    evidenceFactIds,
    promptVersion: "cityscope-agent.v1",
    schemaVersion: SCHEMA_VERSION,
  };
}

export function preDisclosureActions(): AgentAction[] {
  return [
    makeAction("chengdu_investment", "ADVISE_POLICY", { supportMillionCny: 600, instruments: ["rd_grant", "talent_housing", "demo_order"], requestedLanding: ["headquarters", "rd_center", "training_center"] }, "高吸引力方案可争取研发总部与完整项目"),
    makeAction("chengdu_finance", "ADVISE_POLICY", { maxSupportMillionCny: 500, upfrontRatio: 0.2, milestones: ["investment_100m", "jobs_300", "jobs_500"] }, "订单确定性不足，现金支持必须分期", ["fact_cd_capacity"]),
    makeAction("chengdu_leader", "SUBMIT_POLICY_PACK", {
      policyId: "policy_chengdu_v1", cityId: "chengdu", decisionMode: "COMPROMISE",
      terms: [
        { termId: "cd_cash_1", type: "cash_support", amountMillionCny: 100, trigger: { metric: "verifiedInvestmentMillionCny", operator: ">=", value: 100 }, deadline: "year_1", failureAction: "cancel_payment" },
        { termId: "cd_cash_2", type: "cash_support", amountMillionCny: 200, trigger: { metric: "verifiedJobs", operator: ">=", value: 300 }, deadline: "year_2", failureAction: "cancel_payment" },
        { termId: "cd_cash_3", type: "cash_support", amountMillionCny: 200, trigger: { metric: "verifiedJobs", operator: ">=", value: 500 }, deadline: "year_2", failureAction: "cancel_payment" },
        { termId: "cd_housing", type: "talent_housing", quantity: 400 },
        { termId: "cd_demo", type: "demo_order", amountMillionCny: 80 }
      ]
    }, "选择招商与财政的折中方案：20%首期，其余与投资和招聘挂钩", ["fact_cd_capacity"]),
    makeAction("chongqing_investment", "ADVISE_POLICY", { cashSupportMillionCny: 420, factorySqm: 120000, equipmentSupport: true, requestedLanding: ["smart_factory", "supply_chain_base"] }, "现成厂房和供应链可以降低制造启动成本"),
    makeAction("chongqing_finance", "ADVISE_POLICY", { maxCashMillionCny: 360, factorySqm: 120000, annualOutputFloorMillionCny: 2500 }, "同意厂房支持，现金必须与产值挂钩", ["fact_cq_capacity"]),
    makeAction("chongqing_leader", "SUBMIT_POLICY_PACK", {
      policyId: "policy_chongqing_v1", cityId: "chongqing", decisionMode: "ACCEPT_FINANCE",
      terms: [
        { termId: "cq_factory", type: "facility", quantity: 120000 },
        { termId: "cq_cash_1", type: "cash_support", amountMillionCny: 120, trigger: { metric: "verifiedInvestmentMillionCny", operator: ">=", value: 300 }, deadline: "year_1", failureAction: "clawback" },
        { termId: "cq_cash_2", type: "cash_support", amountMillionCny: 240, trigger: { metric: "annualOutputMillionCny", operator: ">=", value: 2500 }, deadline: "year_3", failureAction: "cancel_payment" },
        { termId: "cq_output", type: "output_floor", quantity: 2500 }
      ]
    }, "采用财政约束下的制造方案：厂房支持加最低产值条件", ["fact_cq_capacity"]),
    makeAction("company_ceo", "ADVISE_COMPANY_RESPONSE", { preference: "chengdu_rd", rationale: ["brand", "talent", "headquarters"] }, "成都更有利于研发品牌和估值", ["fact_orders_nonbinding"]),
    makeAction("company_cfo", "ADVISE_COMPANY_RESPONSE", { preference: "counter_both", requests: ["more_upfront_cash", "lower_output_floor"] }, "重庆降低制造成本，但产值承诺和成都到账速度都需要调整", ["fact_cash_12m", "fact_orders_nonbinding"]),
    makeAction("company_board", "SUBMIT_COMPANY_RESPONSE", { responseId: "response_company_v1", targetPolicyIds: ["policy_chengdu_v1", "policy_chongqing_v1"], requestedChanges: [{ policyId: "policy_chengdu_v1", termId: "cd_cash_1", requestedValue: 160 }, { policyId: "policy_chongqing_v1", termId: "cq_output", requestedValue: 1800 }] }, "综合 CEO 与 CFO 意见，向两城提交正式反报价", ["fact_cash_12m", "fact_orders_nonbinding"]),
    makeAction("company_board", "ACCEPT_POLICY", { policyId: "policy_chengdu_v1" }, "成都方案更匹配研发总部，接受带里程碑的政策包", ["fact_cash_12m"]),
    makeAction("policy_supervisor", "REQUEST_DUE_DILIGENCE", { scope: ["orders", "cash_flow"], round: 2 }, "正式承诺后进入第二轮订单与现金流尽调"),
    makeAction("due_diligence_service", "DISCLOSE_FACT", { factId: "fact_orders_nonbinding", audience: ["regional_coordinator", "policy_supervisor", "chengdu_leader", "chengdu_finance", "chongqing_leader", "chongqing_finance", "investor", "company_board"] }, "核验发现大额订单中相当部分为非约束性意向", ["fact_orders_nonbinding"]),
  ];
}

export function postDisclosureActions(state: WorldState): AgentAction[] {
  const orderRisk = state.company.bindingOrderRatio < 0.5;
  return [
    makeAction("investor", "ADVISE_FINANCING", { stance: orderRisk ? "withhold" : "conditional", condition: "bindingOrderRatio >= 0.6" }, orderRisk ? "意向订单不足以支持完整工厂融资" : "达到转单条件后可分期融资", ["fact_financing_tight", "fact_orders_nonbinding"]),
    makeAction("company_ceo", "ADVISE_COMPANY_RESPONSE", { preference: "reduce_scope", targetInvestmentMillionCny: 2200 }, "风险披露后缩小一期规模以保持扩张选项", ["fact_orders_nonbinding"]),
    makeAction("company_cfo", "ADVISE_COMPANY_RESPONSE", { preference: "renegotiate_milestones", minUpfrontMillionCny: 120 }, "融资收紧后必须减少刚性承诺并提高现金保障", ["fact_cash_12m", "fact_orders_nonbinding"]),
    makeAction("company_board", "SUBMIT_COMPANY_RESPONSE", { responseId: `response_company_post_dd_v${state.worldVersion}`, targetPolicyIds: ["policy_chengdu_v1"], requestedChanges: [{ policyId: "policy_chengdu_v1", termId: "cd_cash_2", requestedValue: 150 }] }, "尽调后形成缩小一期规模的正式重谈请求", ["fact_cash_12m", "fact_orders_nonbinding"]),
  ];
}

export function progressAction(): AgentAction {
  return makeAction("world_service", "ADVANCE_PROJECT", { verifiedInvestmentMillionCny: 320, verifiedJobs: 300, annualOutputMillionCny: 0 }, "核验一期投资与招聘后执行承诺触发器");
}

