const exactLabels: Record<string, string> = {
  repair_required: "需要修订", require_repair: "要求修订", approved: "审计通过", flagged: "发现风险", pending: "等待处理",
  issued: "已发布", accepted: "已接受", rejected: "已拒绝", withdrawn: "已撤回", applied: "已生效", due: "待支付", paid: "已支付", failed: "履约失败",
  courtship: "招商接洽", negotiation: "正式谈判", due_diligence: "尽职调查", post_disclosure: "风险披露后重议", signed: "已签约", delivery: "履约建设", completed: "建设完成", exited: "项目退出", complete: "推演完成",
  support: "支持", concern: "担忧", mixed: "意见分化", conditional: "有条件支持", withhold: "暂缓支持", oppose: "反对", mediate: "协调",
  optimal: "已找到最优解", feasible: "已找到可行解", infeasible: "当前条件无可行解", OPTIMAL: "已找到最优解", FEASIBLE: "已找到可行解", INFEASIBLE: "当前条件无可行解",
  balanced: "综合平衡", fiscal_guard: "财政稳健", innovation: "创新优先", manufacturing: "制造优先", resilience: "区域韧性",
  split_functions: "两城功能分工", reduce_duplicate_subsidy: "削减重复补贴", no_coordination_needed: "无需额外协调",
  functional_allocation: "功能分工", functional_complementarity: "功能互补", duplicate_subsidy: "重复补贴", fiscal_risk: "财政风险",
  cash_support: "现金支持", land: "产业用地", facility: "厂房设施", energy: "能源保障", talent_housing: "人才住房", demo_order: "示范订单", output_floor: "最低产值", jobs_milestone: "就业里程碑",
  cancel_payment: "取消支付", clawback: "追回补贴", renegotiate: "重新协商",
  RESOURCE_OK: "资源校验通过", RESOURCE_EXCEEDED: "资源额度不足", INVALID_RESOURCE_REQUEST: "资源申请无效",
  NO_ELIGIBLE_MATERIAL_ACTION: "当前没有必要行动", BOARD_RESOLUTION_REQUIRED: "董事会尚未形成最终决议",
  ACCEPT_INVESTMENT: "采纳招商方案", ACCEPT_FINANCE: "采纳财政方案", COMPROMISE: "形成折中方案", RETURN_FOR_REVISION: "退回修订",
  ADVISE_POLICY: "提出政策建议", SUBMIT_POLICY_PACK: "签发政策包", AUDIT_POLICY_PACK: "审计政策包", SEND_DEBATE_MESSAGE: "回应协调议题", ISSUE_COORDINATION_OPINION: "发布协调意见",
  REVISE_POLICY_PACK: "修订政策方案", WITHDRAW_CITY_OFFER: "正式撤回要约", PROPOSE_COORDINATION_PLAN: "提出双城分工方案", RESPOND_COORDINATION_PLAN: "回应双城分工方案",
  AUDIT_COORDINATION_PLAN: "审计双城分工方案", ACCEPT_COORDINATION_PLAN: "接受双城分工方案", ASSESS_LONG_TERM_IMPACT: "评估十二与二十四个月成效",
  PUBLISH_STAKEHOLDER_REACTION: "反馈社会影响", ADVISE_COMPANY_RESPONSE: "提交企业意见", SUBMIT_COMPANY_RESPONSE: "形成董事会回应", ADVISE_FINANCING: "评估融资可行性",
  REQUEST_DUE_DILIGENCE: "申请尽职调查", DISCLOSE_FACT: "披露核验事实", ACCEPT_POLICY: "接受政策条件", REJECT_POLICY: "拒绝政策条件", EXIT_PROJECT: "退出项目", ADVANCE_PROJECT: "核验履约进度", PASS: "本轮保留意见",
  internal_advice: "部门内议", policy_formation: "政策成包", policy_audit: "上级审计", coordination_debate: "成渝协调谈判", stakeholder_reaction: "社会反馈", company_deliberation: "企业决策", delivery_reaction: "落地反馈", post_risk_deliberation: "风险后重议", optimization: "可行方案求解", coordination: "双城协调", final_decision: "企业最终决策", impact_assessment: "长期政策评估",
  regional_coordinator: "区域协调 Agent", policy_supervisor: "政策监督 Agent", chengdu_investment: "成都招商 Agent", chengdu_finance: "成都财政 Agent", chengdu_leader: "成都负责人 Agent",
  chongqing_investment: "重庆招商 Agent", chongqing_finance: "重庆财政 Agent", chongqing_leader: "重庆负责人 Agent", company_ceo: "企业 CEO Agent", company_cfo: "企业 CFO Agent", company_board: "企业董事会 Agent",
  investor: "投资机构 Agent", talent_sme: "人才与中小企业 Agent", resident: "居民反应 Agent", due_diligence_service: "尽调规则服务", world_resource_service: "资源规则服务",
  schema: "格式校验", authority: "权限校验", privacy: "信息边界", constraint: "红线约束", APPLIED: "已进入世界", REJECTED: "被规则拦截",
  approve: "通过审计", flag: "标记风险", open: "协商中", resolved: "已达成共识", deadlocked: "协商僵持",
  challenge: "提出冲突", position: "陈述立场", proposal: "提出折中", counter: "提出反案", concession: "确认让步",
  participants: "谈判参与者可见", public: "共同世界可见", autonomous: "自主推演", replay: "轨迹回放", classified: "已完成分类",
  chengdu: "成都", chongqing: "重庆", none: "暂不落地",
  conditional_accept: "有条件接受", accept_both: "同时接受两城方案", binding_orders: "约束订单", policy_support: "政策支持",
  milestone_subsidy: "里程碑补贴", output_rebate: "产值返还", rd_grant: "研发补助", ready_factory: "现成厂房", supply_chain: "供应链",
  equipment_grant: "设备补助", regional_spillover: "区域外溢效应", employment_benefit: "就业带动", cash_burn: "现金消耗",
  NO_DUPLICATE_OCCUPANCY: "没有重复占用资源", REGIONAL_SYNERGY: "形成区域协同", DUPLICATE_SUBSIDY_RISK: "存在重复补贴风险",
  MILESTONE_LINKED: "补贴已绑定里程碑", FUNCTIONAL_COMPLEMENTARITY: "两城功能互补", NO_DUPLICATE_SUBSIDY: "未发现重复补贴",
  RESOURCE_PRESSURE: "资源承压", FISCAL_RISK: "财政风险", FISCAL_LEDGER_MISMATCH: "财政台账不一致",
  TRIGGER_ATTACHED: "已设置兑现条件", TRIGGERS_ALIGNED_WITH_MILESTONES: "兑现条件与里程碑一致",
  ALIGNED_WITH_CONSENSUS_CANDIDATE: "与协调共识一致", CASH_COMPRESSION_AGREED: "双方同意压缩现金补贴", FUNCTIONAL_SPLIT_SUPPORTED: "双方支持功能分工",
  CHENGDU_LED: "成都获得项目", CHONGQING_LED: "重庆获得项目", DUAL_CITY: "政府协调分工", PROJECT_EXITED: "两城均未落地",
};

const pathLabels: Record<string, string> = {
  "metrics.financingConfidence": "融资信心", "metrics.trust": "政府可信度", "metrics.projectViability": "项目可行性",
  "stakeholders.publicTrust": "公众信任", "stakeholders.talentAttraction": "人才吸引力", "stakeholders.smeParticipation": "中小企业参与度", "stakeholders.supplyChainReadiness": "供应链准备度",
  "stakeholders.housingPressure": "住房压力", "stakeholders.residentSupport": "居民支持度", "stakeholders.fiscalFairnessConcern": "财政公平担忧", "stakeholders.trafficOrEnergyPressure": "交通能源压力",
  "company.projectStage": "项目阶段", "company.internalAdvice": "企业内部意见", "company.responses": "企业正式回应", "company.bindingOrderRatio": "约束订单比例",
  "company.verifiedJobs": "核验就业人数", "company.verifiedInvestmentMillionCny": "核验投资额", "company.annualOutputMillionCny": "核验年产值",
  "cities.chengdu.internalAdvice": "成都部门建议", "cities.chongqing.internalAdvice": "重庆部门建议", "cities.chengdu.resourceLedger": "成都资源台账", "cities.chongqing.resourceLedger": "重庆资源台账",
  "cities.chengdu.policies": "成都政策包", "cities.chongqing.policies": "重庆政策包", "cities.chengdu.policyCredibility": "成都政策可信度", "cities.chongqing.policyCredibility": "重庆政策可信度",
};

const fieldLabels: Record<string, string> = {
  status: "状态", auditStatus: "审计状态", projectStage: "项目阶段", decisionMode: "决策方式", recommendation: "协调建议", sentiment: "社会态度",
  reasonCode: "原因", reasonCodes: "原因", phase: "推演阶段", visibility: "可见范围", stance: "立场", turnType: "回应类型",
  decision: "审计结论", cityId: "城市", policyId: "政策包", termId: "政策条款", actorId: "行动主体", kind: "行动类型",
  content: "发言", summary: "摘要", preference: "偏好", condition: "前提条件", projectTendency: "项目倾向",
};

const replacementEntries = [...Object.entries({ ...pathLabels, ...exactLabels })].sort(([left], [right]) => right.length - left.length);
const preservedTerms = new Set(["Agent", "DeepSeek", "TOPSIS", "OR-Tools", "CP-SAT", "CEO", "CFO", "MW", "causeId"]);

export function presentationTerm(value: string): string {
  return exactLabels[value] ?? pathLabels[value] ?? fieldLabels[value] ?? audienceNarrative(value, 80);
}

export function optimizerStatusLabel(value: string): string {
  return exactLabels[value] ?? exactLabels[value.toUpperCase()] ?? "求解完成";
}

export function receiptStatusLabel(value: string): string {
  return exactLabels[value] ?? "已完成制度校验";
}

export function audienceNarrative(value: string, maxLength = 150): string {
  const source = value.normalize("NFC");
  let cleaned = source;
  // Trace identifiers remain in the evidence object, but never inside audience-facing prose.
  cleaned = cleaned
    .replace(/[（(][^()（）]*(?:candidate|cd|cq|policy|pack|term|fact|action|run|live|root)[_\-.][^()（）]*[）)]/gi, "")
    .replace(/\b(?:candidate|cd|cq)[_\-.][a-z0-9_.-]+\b/gi, "候选方案")
    .replace(/\b(?:policy|pack)[_\-.][a-z0-9_.-]+\b/gi, "政策包")
    .replace(/\b(?:term|milestone)[_\-.][a-z0-9_.-]+\b/gi, "政策条款")
    .replace(/\bfact[_\-.][a-z0-9_.-]+\b/gi, "核验事实")
    .replace(/\b(?:action|run|live|root)[_\-.][a-z0-9_.-]+\b/gi, "本轮记录");
  for (const [raw, translated] of replacementEntries) cleaned = replaceToken(cleaned, raw, translated);
  cleaned = cleaned
    .replace(/引用候选\s*[a-f0-9]{6,}/gi, "依据当前候选方案")
    .replace(/(?:候选|方案)(?:编号|标识)?\s*[a-f0-9]{8,}/gi, "当前候选方案")
    .replace(/(?:TOPSIS|结构化状态)\s*(?:得分|贴近度|状态)?\s*[:：]?\s*0?\.(\d+)/gi, (_, digits: string) => `综合匹配度 ${Math.round(Number(`0.${digits}`) * 100)}%`)
    .replace(/(?:TOPSIS|结构化状态)\s*(?:得分|贴近度|状态)?\s*[:：]?\s*(\d+(?:\.\d+)?)\s*%?/gi, (_, raw: string) => `综合匹配度 ${Math.round(Number(raw))}%`)
    .replace(/\b(?:cities|company|metrics|stakeholders|commitments|facts|debateThreads)(?:\.[A-Za-z0-9_]+)+\b/g, "相关状态")
    .replace(/AgentAction matches v\d+ proposal[^,.。；;]*/gi, "行动格式符合约定")
    .replace(/all referenced facts are observable/gi, "引用事实均在该角色可见范围内")
    .replace(/has recommend permission/gi, "具备提出建议的正式权限")
    .replace(/lifecycle, payload and red-line constraints passed/gi, "生命周期、行动内容与红线检查均已通过")
    .replace(/no state change produced/gi, "未产生世界状态变化")
    .replace(/\b(?:coordination-main|coord-debate-[a-z0-9-]*|msg-coord-[a-z0-9-]*|rc-debate-[a-z0-9-]*|debate-message-[a-z0-9-]*|coord-opinion-[a-z0-9-]*|rc-opinion-[a-z0-9-]*)\b/gi, "协调记录")
    .replace(/\b(?:resident|talent-sme)-reaction-[a-z0-9-]*\b/gi, "社会反馈记录")
    .replace(/\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/gi, "相关条件")
    .replace(/\b[A-Z][A-Z0-9_]{2,}\b/g, "结构化状态")
    .replace(/(\d+(?:\.\d+)?)\s*百万(?:元)?/g, (_, raw: string) => {
      const million = Number(raw);
      return million >= 100 ? `${Number((million / 100).toFixed(2))}亿元` : `${Number((million * 100).toFixed(0))}万元`;
    })
    .replace(/(\d+(?:\.\d+)?)\s*MW\b/gi, "$1兆瓦")
    .replace(/\s*\+\s*/g, "与")
    .replace(/[（(]\s*[）)]/g, "")
    .replace(/[{}\[\]"`]/g, "")
    .replace(/\s+/g, " ")
    .replace(/([，。；：])(?:\s*[，。；：])+/g, "$1")
    .trim();
  if (untranslatedEnglishWordCount(cleaned) >= 6) cleaned = residualEnglishSummary(source);
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength)}…` : cleaned;
}

export function audienceValue(value: unknown): string {
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : value.toFixed(2);
  if (typeof value === "string") return presentationTerm(value);
  if (typeof value === "boolean") return value ? "是" : "否";
  if (value === null || value === undefined) return "—";
  if (Array.isArray(value)) return `${value.length} 项`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).slice(0, 3);
    if (entries.length === 0) return "空记录";
    return entries.map(([key, item]) => `${fieldLabels[key] ?? presentationTerm(key)}：${isScalar(item) ? audienceValue(item) : Array.isArray(item) ? `${item.length} 项` : "已更新"}`).join(" · ");
  }
  return "结构化记录";
}

export function hasProtocolLeak(value: string): boolean {
  const withoutAllowed = [...preservedTerms].reduce((text, term) => text.replaceAll(term, ""), value);
  return /\b(?:candidate|cd|cq|policy|pack|term|fact|action|run|live|root)[_\-.][a-z0-9_.-]+\b/i.test(withoutAllowed)
    || /\b(?:cities|company|metrics|stakeholders|commitments|facts|debateThreads)(?:\.[A-Za-z0-9_]+)+\b/.test(withoutAllowed)
    || /\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/i.test(withoutAllowed)
    || /\b(?:APPLIED|REJECTED|OPTIMAL|FEASIBLE|INFEASIBLE|RESOURCE_OK|RESOURCE_EXCEEDED)\b/.test(withoutAllowed)
    || /(?:引用候选|候选编号|方案标识)\s*[a-f0-9]{6,}/i.test(withoutAllowed);
}

function replaceToken(source: string, raw: string, translated: string): string {
  const escaped = raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return source.replace(new RegExp(`(?<![A-Za-z0-9_])${escaped}(?![A-Za-z0-9_])`, "gi"), translated);
}

function isScalar(value: unknown): value is string | number | boolean | null | undefined {
  return value === null || value === undefined || ["string", "number", "boolean"].includes(typeof value);
}

function untranslatedEnglishWordCount(value: string): number {
  const allowed = /^(?:Agent|DeepSeek|TOPSIS|OR|Tools|CP|SAT|CEO|CFO|MW|D)$/i;
  return (value.match(/\b[A-Za-z]{2,}\b/g) ?? []).filter((word) => !allowed.test(word)).length;
}

function residualEnglishSummary(source: string): string {
  const lower = source.toLowerCase();
  if (/non[- ]binding|binding order/.test(lower)) return "约束订单比例偏低，履约不确定性上升，需重新评估融资和兑现条件。";
  if (/liquidity|cash runway|fiscal cost/.test(lower)) return "该 Agent 优先控制流动性与财政成本，建议压低现金承诺，并把支持与可核验里程碑绑定。";
  if (/audit|red[- ]line|resource calculation/.test(lower)) return "政策包已接受资源、权限与红线复核；本轮判断仅依据可见事实和已审计条款。";
  if (/chosen|ranking|closeness|consensus candidate/.test(lower)) return "该 Agent 根据自身权重比较可行方案，并说明了当前选择相对共识方案的收益与代价。";
  if (/no new material action|already been/.test(lower)) return "前序正式行动已经生效，当前阶段没有新增必要动作，本轮保留意见。";
  if (/policy pack|policy/.test(lower)) return "该 Agent 已结合政策条件、资源边界和履约风险形成结构化判断。";
  return "该 Agent 已依据可见事实、职责边界与红线完成本轮判断。";
}
