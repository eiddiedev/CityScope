import { Component, Fragment, lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ErrorInfo, type ReactNode } from "react";
import {
  Activity,
  AlertTriangle,
  Box,
  Building2,
  Check,
  ChevronRight,
  GitFork,
  Network,
  Pause,
  PanelRight,
  Play,
  Radio,
  ScanLine,
  ShieldAlert,
  Sparkles,
  Split,
  X,
  Zap,
} from "lucide-react";
import { cityScopeAdapter, type AdapterHealth, type CityCompetitionEvidence, type CityScopeDemoFixture, type DemoStep, type LiveForkProgress, type LiveForkRequest, type LiveForkResult } from "./adapters/cityscopeAdapter";
import type { PerformanceSample } from "./visual/CitySandbox";
import { FallbackTwin, type OrganizationLayerGroup } from "./visual/FallbackTwin";
import type { VisualSequencePhase } from "./visual/cityKitManifest";
import { audienceNarrative, audienceValue, optimizerStatusLabel, presentationTerm, receiptStatusLabel } from "./presentationLanguage";

const CitySandbox = lazy(() => import("./visual/CitySandbox").then((module) => ({ default: module.CitySandbox })));

class VisualErrorBoundary extends Component<{ children: ReactNode }, { error?: Error }> {
  state: { error?: Error } = {};
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error("CitySandbox render failed", error, info); }
  render() { return this.state.error ? <div className="scene-skeleton"><strong>城市模型已切换安全视图</strong><small>{this.state.error.message}</small></div> : this.props.children; }
}

type Surface = "world" | "organization" | "evidence";
type EvidenceMode = "trace" | "fork";
type EvidenceSelection = { kind: "step"; index: number } | { kind: "redline" };

type DecisionCandidateView = {
  candidateId: string;
  profileId: string;
  assignments: Record<string, "chengdu" | "chongqing" | "not_built">;
  selectedFunctions: string[];
  cityResources: Record<"chengdu" | "chongqing", { fiscalMillionCny: number; landHectares: number; energyMw: number; talentHousingUnits: number }>;
  investmentMillionCny: number;
  dimensions: Record<string, number>;
  constraintEvidence: string[];
};

type DecisionSupportView = {
  portfolioId: string;
  optimizer: { engine: string; engineVersion: string; status: string; diagnostics: string[] };
  consensusCandidateId: string;
  actorRanking: {
    actorId: string;
    weights: Record<string, number>;
    directions: Record<string, "benefit" | "cost">;
    rows: Array<{ candidateId: string; rank: number; closeness: number; distanceToIdeal: number; distanceToWorst: number }>;
  };
  candidates: DecisionCandidateView[];
};

const decisionDimensionLabels: Record<string, string> = {
  innovationValue: "创新价值", manufacturingValue: "制造价值", employment: "就业带动", publicBenefit: "公共收益", enterpriseValue: "企业价值",
  executionProbability: "执行概率", regionalSynergy: "区域协同", fiscalCost: "财政成本", liquidityRisk: "流动性风险", resourcePressure: "资源压力",
};

const functionLabels: Record<string, string> = {
  headquarters: "总部", rd_center: "研发中心", smart_factory: "智能工厂", supply_chain_base: "供应链基地", training_center: "培训中心",
};

const profileLabels: Record<string, string> = { balanced: "综合平衡", innovation: "创新优先", manufacturing: "制造优先", fiscal: "财政稳健", fiscal_guard: "财政稳健", resilience: "区域韧性" };

const organizationLabels: Record<string, string> = {
  chengdu: "成都高新区",
  chongqing: "重庆两江新区",
  superior: "双城区域统筹层",
  company: "星岚机器人",
  capital: "投资机构",
  stakeholder: "社会利益相关方",
  rule_service: "确定性规则服务",
};

const permissionLabels: Record<string, string> = {
  coordinate: "统筹协调",
  recommend: "提出建议",
  pass: "本轮保留意见",
  audit_policy: "审计政策包",
  request_audit: "发起审计",
  propose: "提出方案",
  revise: "要求修订",
  sign_policy: "签发政策包",
  withdraw_city_offer: "撤回城市要约",
  sign_company_response: "签发企业回应",
  accept_policy: "接受政策条件",
  respond_coordination: "回应协调方案",
  accept_coordination: "接受联合方案",
  withdraw_commitment: "撤回投资承诺",
  exit_project: "退出项目",
  decide_financing: "作出融资决定",
  publish_reaction: "发布利益反馈",
  disclose_fact: "披露核验事实",
  advance_project: "推进项目状态",
};

const utilityDimensionLabels: Record<string, string> = {
  innovationValue: "创新价值",
  manufacturingValue: "制造价值",
  employment: "就业带动",
  publicBenefit: "公共收益",
  enterpriseValue: "企业价值",
  executionProbability: "执行概率",
  regionalSynergy: "区域协同",
  fiscalCost: "财政成本",
  liquidityRisk: "流动性风险",
  resourcePressure: "资源压力",
  regional_spillover: "区域外溢收益",
  functional_complementarity: "双城功能互补",
  duplicate_subsidy: "重复补贴风险",
  compliance: "政策合规性",
  fiscal_sustainability: "财政可持续性",
  policy_credibility: "政策可信度",
  rd_jobs: "研发岗位带动",
  senior_talent: "高端人才吸引",
  headquarters: "总部落地价值",
  investment_scale: "投资规模",
  milestone_certainty: "里程碑确定性",
  manufacturing_output: "制造产出",
  factory_landing: "工厂落地",
  supply_chain: "供应链带动",
  jobs: "就业岗位",
  output_certainty: "产出确定性",
  facility_utilization: "设施利用率",
  growth_speed: "增长速度",
  brand: "品牌影响力",
  control: "经营控制权",
  upfront_cash: "前期现金支持",
  own_capital: "自有资金占用",
  rigid_commitment: "刚性承诺风险",
  enterprise_value: "企业价值",
  liquidity_risk: "流动性风险",
  execution_probability: "执行成功率",
  binding_orders: "约束性订单",
  cash_burn: "现金消耗",
  policy_support: "政策支持力度",
  talent_attraction: "人才吸引力",
  sme_participation: "中小企业参与度",
  supply_chain_readiness: "供应链准备度",
  housing_pressure: "住房压力",
  jobs_benefit: "就业收益",
  public_trust: "公众信任",
  fiscal_fairness: "财政公平",
  traffic_energy_pressure: "交通与能源压力",
};

const responsibilityLabels: Record<string, string> = {
  "round-gated fact verification": "按推演阶段执行事实核验",
  "audience-scoped disclosure": "根据受众权限分级披露信息",
  "resource ledger transitions": "确定性更新城市与企业资源台账",
  "commitment trigger evaluation": "判断承诺是否达到触发条件",
  "project progress update": "更新项目建设与履约进度",
};

const utilityDirectionLabels: Record<string, string> = {
  maximize: "优先提升",
  minimize: "重点控制",
};

const actorDivisionDetails: Record<string, string[]> = {
  regional_coordinator: ["对比成都、重庆的政策条件与资源占用，识别重复补贴。", "寻找研发、制造与供应链的跨城拆分合作空间。", "向两城提出协调建议，但不代替地方或企业签约。"],
  policy_supervisor: ["审计正式政策包的预算、资源和程序合规性。", "标记超预算、重复占用或兑现条件不足的条款。", "要求修订或提出审计意见，不代替城市负责人决策。"],
  chengdu_investment: ["设计成都侧研发总部、人才住房和招商支持方案。", "评估研发岗位、高端人才与总部落地的综合收益。", "向财政与城市负责人提交招商建议，不直接签发政策。"],
  chengdu_finance: ["核算成都政策包的财政占用、付款节奏与兑现边界。", "检查里程碑是否可核验，并控制长期财政承诺。", "对超预算方案提出修订意见，不直接签发政策。"],
  chengdu_leader: ["综合招商、财政与审计意见形成成都正式立场。", "决定是否签发政策包及其附带条件。", "确保研发总部目标与财政可持续性保持平衡。"],
  chongqing_investment: ["设计重庆侧智能制造、工厂落地和供应链支持方案。", "评估制造产出、就业与本地供应链带动。", "向财政与城市负责人提交招商建议，不直接签发政策。"],
  chongqing_finance: ["核算重庆制造基地的财政投入、设施利用与产出兑现风险。", "审查补贴是否与可验证产能和建设里程碑绑定。", "对超预算或产出不确定方案提出修订意见。"],
  chongqing_leader: ["综合招商、财政与审计意见形成重庆正式立场。", "决定是否签发制造基地政策包及附带条件。", "平衡制造规模、供应链收益与财政可持续性。"],
  company_ceo: ["判断项目对增长速度、品牌和产业影响力的贡献。", "提出企业扩张与选址偏好，维护经营控制权。", "向董事会提交战略建议，不单独作出最终投资决定。"],
  company_cfo: ["测算项目现金流、融资缺口和自有资金占用。", "控制高产值承诺、前期投入与刚性付款风险。", "向董事会提交财务意见，并在现金跑道不足时预警。"],
  company_board: ["汇总 CEO 与 CFO 意见，审议两城正式政策包。", "签发企业回应，决定接受、撤回承诺或退出项目。", "确保最终决定建立在已审计政策与完整内部意见之上。"],
  investor: ["独立核验约束性订单、现金消耗和政策支持质量。", "判断项目是否满足融资条件及可支持的融资规模。", "不以非约束订单替代真实偿付与经营能力。"],
  talent_sme: ["反馈人才吸引、住房压力和本地中小企业参与机会。", "评估区域供应链是否具备承接项目的准备度。", "在住房或供应链压力过高时发布风险提示。"],
  resident: ["反馈就业收益、财政公平及交通能源压力。", "评估项目对公众信任和城市公共资源的影响。", "在财政公平恶化时提示，但不伪造或代替公众意见。"],
  due_diligence_service: ["在指定推演阶段核验订单、融资和履约事实。", "依据受众权限披露事实，不参与利益判断。", "所有输出均为确定性规则结果。"],
  world_resource_service: ["更新财政、土地、能源及企业承诺等资源台账。", "判断承诺触发器并推进项目建设状态。", "只执行确定性状态转换，不提出政策偏好。"],
};

const surfaces: Array<{ id: Surface; label: string; icon: typeof Box }> = [
  { id: "world", label: "战略沙盘", icon: Box },
  { id: "organization", label: "组织剖面", icon: Network },
  { id: "evidence", label: "证据层", icon: ScanLine },
];

/** 组织分组：anchor 是卡片在 2.5D 沙盘上的城市坐标锚点（与 FallbackTwin LANDMARKS 同坐标系） */
const organizationGroupDefs: Array<{ name: string; tone: OrganizationLayerGroup["tone"]; anchor: [number, number]; ids: readonly string[] }> = [
  { name: "区域统筹", tone: "blue", anchor: [7.4, 15.8], ids: ["regional_coordinator", "policy_supervisor"] },
  { name: "成都高新区", tone: "mint", anchor: [-0.1, 4.9], ids: ["chengdu_leader", "chengdu_investment", "chengdu_finance"] },
  { name: "重庆两江新区", tone: "ember", anchor: [13.7, 5.1], ids: ["chongqing_leader", "chongqing_investment", "chongqing_finance"] },
  { name: "星岚机器人", tone: "gold", anchor: [7.65, -6.2], ids: ["company_ceo", "company_cfo", "company_board"] },
  { name: "外部利益相关方", tone: "blue", anchor: [3.1, 1.0], ids: ["investor", "talent_sme", "resident"] },
  { name: "确定性世界服务", tone: "service", anchor: [7.4, 18.4], ids: ["due_diligence_service", "world_resource_service"] },
];

const phaseLabels: Record<string, string> = {
  internal_advice: "部门内议",
  policy_formation: "政策成包",
  policy_audit: "上级审计",
  coordination_debate: "成渝协调谈判",
  stakeholder_reaction: "社会反馈",
  company_deliberation: "企业决策",
  due_diligence: "二轮尽调",
  post_disclosure: "风险后重议",
  delivery: "履约核验",
  delivery_reaction: "落地反馈",
};

const defaultHealth: AdapterHealth = {
  mode: "unavailable",
  ready: false,
  contractVersion: null,
  fixtureVersion: null,
  provider: null,
  model: null,
  demoMode: true,
  message: "正在校验签名轨迹…",
};

/** 将供应商余额、配额和 token 耗尽类错误统一映射为评委可读的状态。 */
function isTokenCapacityError(message: string | undefined): boolean {
  if (!message) return false;
  return /(?:insufficient[_\s-]*(?:quota|balance|credit|token)|quota[_\s-]*(?:exceeded|exhausted)|out of (?:tokens|credits)|token(?:s)? (?:exhausted|depleted)|余额不足|额度不足|配额不足|token\s*不足|DeepSeek HTTP 402)/i.test(message);
}

function outcomeLabel(label: string | undefined): string {
  return ({ DUAL_CITY: "政府协调分工", CHENGDU_LED: "成都获得项目", CHONGQING_LED: "重庆获得项目", PROJECT_EXITED: "两城均未落地" } as Record<string, string>)[label ?? ""] ?? (label ? presentationTerm(label) : "未分类");
}

function formatValue(value: unknown): string {
  return audienceValue(value);
}

function phaseVisual(phase: string, kind?: string): VisualSequencePhase {
  if (kind === "DISCLOSE_FACT" || phase === "post_disclosure") return "reorganizing";
  if (phase === "policy_audit" || phase === "due_diligence") return "paused";
  if (phase === "policy_formation" || phase === "delivery") return "constructing";
  return "orientation";
}

const cityDepartments = {
  chengdu: [
    { actorId: "chengdu_investment", label: "招商促进局", responsibility: "提出产业与落地方案" },
    { actorId: "chengdu_finance", label: "财政审查局", responsibility: "控制补贴与兑现风险" },
    { actorId: "chengdu_leader", label: "城市决策中心", responsibility: "合成并签发政策包" },
  ],
  chongqing: [
    { actorId: "chongqing_investment", label: "招商促进局", responsibility: "组织制造与供应链方案" },
    { actorId: "chongqing_finance", label: "财政审查局", responsibility: "检查产能与财政约束" },
    { actorId: "chongqing_leader", label: "城市决策中心", responsibility: "合成并签发政策包" },
  ],
} as const;

function actionKindLabel(kind: string | undefined): string {
  return ({
    ADVISE_POLICY: "提出部门意见",
    SUBMIT_POLICY_PACK: "签发政策包",
    ISSUE_POLICY: "签发政策包",
    AUDIT_POLICY_PACK: "审计政策包",
    AUDIT_POLICY: "审计政策包",
    SEND_DEBATE_MESSAGE: "回应协调议题",
    ISSUE_COORDINATION_OPINION: "发布协调意见",
    PUBLISH_STAKEHOLDER_REACTION: "反馈社会影响",
    STAKEHOLDER_REACT: "反馈社会影响",
    ADVISE_COMPANY_RESPONSE: "提交企业侧意见",
    SUBMIT_COMPANY_RESPONSE: "形成董事会回应",
    ADVISE_FINANCING: "评估融资可行性",
    REQUEST_DUE_DILIGENCE: "申请二轮尽调",
    DISCLOSE_FACT: "披露尽调事实",
    ACCEPT_POLICY: "接受政策条件",
    REJECT_POLICY: "拒绝政策条件",
    EXIT_PROJECT: "退出项目",
    PASS: "本轮保留意见",
  } as Record<string, string>)[kind ?? ""] ?? "执行结构化行动";
}

const metricLabels: Record<string, string> = {
  "metrics.financingConfidence": "融资信心",
  "metrics.trust": "政府可信度",
  "metrics.projectViability": "项目可行性",
  "stakeholders.publicTrust": "公众信任",
  "stakeholders.supplyChainReadiness": "供应链准备度",
  "stakeholders.residentSupport": "居民支持度",
  "company.bindingOrderRatio": "约束订单比例",
  "company.projectStage": "项目阶段",
  "cities.chengdu.policyCredibility": "成都政策可信度",
  "cities.chongqing.policyCredibility": "重庆政策可信度",
};

const fallbackSpeechAnchors: Record<string, { left: number; top: number }> = {
  regional_coordinator: { left: 32, top: 78 }, policy_supervisor: { left: 40, top: 80 },
  chengdu_investment: { left: 25, top: 31 }, chengdu_finance: { left: 20, top: 51 }, chengdu_leader: { left: 28, top: 65 },
  chongqing_investment: { left: 72, top: 31 }, chongqing_finance: { left: 78, top: 51 }, chongqing_leader: { left: 69, top: 65 },
  company_ceo: { left: 46, top: 21 }, company_cfo: { left: 56, top: 25 }, company_board: { left: 51, top: 18 },
  investor: { left: 44, top: 43 }, talent_sme: { left: 58, top: 43 }, resident: { left: 50, top: 53 },
  due_diligence_service: { left: 33, top: 85 }, world_resource_service: { left: 41, top: 87 },
};

function readablePath(path: string): string {
  if (metricLabels[path]) return metricLabels[path];
  const city = path.includes("cities.chengdu") ? "成都" : path.includes("cities.chongqing") ? "重庆" : "";
  if (path.includes("internalAdvice")) return `${city}部门建议`;
  if (path.includes("policies")) return `${city}政策包`;
  if (path.includes("resourceLedger")) return `${city}资源台账`;
  if (path.includes("policyCredibility")) return `${city}政策可信度`;
  if (path.includes("commitments")) return "履约承诺";
  if (path.includes("projectStage")) return "项目阶段";
  if (path.includes("responses")) return "企业正式回应";
  return "关键状态";
}

function cleanNarrative(value: string, maxLength = 150): string {
  return audienceNarrative(value, maxLength);
}

function humanizeDelta(step: DemoStep | undefined): string | undefined {
  const delta = step?.receipt.deltas.find((item) => metricLabels[item.path]) ?? step?.receipt.deltas[0];
  if (!delta) return undefined;
  const label = readablePath(delta.path);
  const before = formatValue(delta.before);
  const after = formatValue(delta.after);
  const change = typeof delta.before === "number" && typeof delta.after === "number"
    ? ` (${delta.after - delta.before >= 0 ? "+" : ""}${Number((delta.after - delta.before).toFixed(2))})`
    : "";
  return `${label} ${before} → ${after}${change}`;
}

function stepSpeech(step: DemoStep): string {
  if (step.candidate.kind === "DISCLOSE_FACT") return "尽调发现：申报订单中仅 34% 具有约束力，项目必须重新评估。";
  if (step.candidate.kind === "SEND_DEBATE_MESSAGE") {
    const content = (step.candidate.payload as { content?: unknown }).content;
    if (typeof content === "string") return cleanNarrative(content, 96);
  }
  if (step.candidate.kind === "ISSUE_COORDINATION_OPINION") {
    const summary = (step.candidate.payload as { summary?: unknown }).summary;
    if (typeof summary === "string") return cleanNarrative(summary, 110);
  }
  return cleanNarrative(step.candidate.reasoning, 96);
}

function CityActionRail({ city, fixture, activeStepIndex, fiscalPressure, onOpenOrganization, onOpenEvidence }: {
  city: "chengdu" | "chongqing";
  fixture: CityScopeDemoFixture;
  activeStepIndex: number;
  fiscalPressure: number;
  onOpenOrganization: () => void;
  onOpenEvidence: (index: number) => void;
}) {
  const cityName = city === "chengdu" ? "成都高新区" : "重庆两江新区";
  const cityState = fixture.baseline.terminalState.cities[city];
  const latestPolicy = cityState.policies.at(-1);
  const cityStepIndices = fixture.baseline.steps
    .map((step, index) => ({ step, index }))
    .filter(({ step }) => step.actorId.startsWith(city));
  const current = [...cityStepIndices].reverse().find(({ index }) => index <= activeStepIndex) ?? cityStepIndices[0];
  const currentDepartment = cityDepartments[city].find((department) => department.actorId === current?.step.actorId);
  const active = Boolean(current && current.index === activeStepIndex);
  return <section className={`city-action-rail ${city}`}>
    <button className="rail-city-heading" type="button" aria-label={`${city === "chengdu" ? "01 · CHENGDU" : "03 · CHONGQING"} ${cityName} 点击展开内部争论与权限结构`} onClick={onOpenOrganization}><span>{city === "chengdu" ? "CHENGDU · BLUE" : "CHONGQING · RED"}</span><strong>{cityName}</strong><small>进入组织剖面</small></button>
    <button className={`rail-current-action ${active ? "active" : ""}`} type="button" disabled={!current} onClick={() => current && onOpenEvidence(current.index)}>
      <i />
      <span><small>{active ? "正在行动" : "最近行动"}</small><strong>{currentDepartment?.label ?? "等待部门行动"}</strong><em>{current ? actionKindLabel(current.step.candidate.kind) : "等待推演"}</em></span>
      {current && <ChevronRight size={13} />}
    </button>
    <div className="rail-pressure"><span>财政压力</span><i><b style={{ width: `${fiscalPressure}%` }} /></i><strong>{fiscalPressure}%</strong></div>
    <div className="rail-policy-status"><span>政策可信度 <b>{cityState.policyCredibility}</b></span><small>{latestPolicy ? `${{ approved: "审计通过", pending: "等待审计", flagged: "发现风险", repair_required: "退回修订" }[latestPolicy.auditStatus]} · ${latestPolicy.terms.length} 项条件` : "政策包合成中"}</small></div>
  </section>;
}

type CompetitionMetric = { id: string; label: string; description: string; chengdu: number; chongqing: number };

function pairShare(chengdu: number, chongqing: number): [number, number] {
  const total = Math.max(0, chengdu) + Math.max(0, chongqing);
  if (total <= 0) return [50, 50];
  const left = Math.max(1, Math.min(99, Math.round((Math.max(0, chengdu) / total) * 100)));
  return [left, 100 - left];
}

function CompetitionBelt({ fixture, activeStepIndex, live, competition, onOpenEvidence }: {
  fixture: CityScopeDemoFixture;
  activeStepIndex: number;
  live: boolean;
  competition?: CityCompetitionEvidence;
  onOpenEvidence: (index: number) => void;
}) {
  const state = fixture.baseline.terminalState;
  const cityScore = (city: "chengdu" | "chongqing") => {
    const current = state.cities[city];
    const ledger = current.resourceLedger;
    const fiscalRemaining = ledger.fiscalMillionCny.capacity > 0 ? ledger.fiscalMillionCny.available / ledger.fiscalMillionCny.capacity : 0;
    const resourceRemaining = ([ledger.landHectares, ledger.factorySqm, ledger.energyMw, ledger.talentHousingUnits]
      .reduce((sum, account) => sum + (account.capacity > 0 ? account.available / account.capacity : 0), 0) / 4);
    const researchFit = (current.objectiveWeights.rd_jobs ?? 0) + (current.objectiveWeights.senior_talent ?? 0) + (current.objectiveWeights.headquarters ?? 0) + (ledger.talentHousingUnits.capacity > 0 ? ledger.talentHousingUnits.available / ledger.talentHousingUnits.capacity : 0) * .2;
    const manufacturingFit = (current.objectiveWeights.manufacturing_output ?? 0) + (current.objectiveWeights.factory_landing ?? 0) + (current.objectiveWeights.supply_chain ?? 0) + (((ledger.factorySqm.capacity > 0 ? ledger.factorySqm.available / ledger.factorySqm.capacity : 0) + (ledger.energyMw.capacity > 0 ? ledger.energyMw.available / ledger.energyMw.capacity : 0)) / 2) * .2;
    const latestPolicy = current.policies.at(-1);
    const cashSupport = latestPolicy?.terms.reduce((sum, term) => sum + (term.type === "cash_support" ? term.amountMillionCny ?? 0 : 0), 0) ?? 0;
    const policyAttraction = current.policyCredibility * .72 + (ledger.fiscalMillionCny.capacity > 0 ? cashSupport / ledger.fiscalMillionCny.capacity : 0) * 100 * .28;
    return {
      policyAttraction,
      fiscalSustainability: fiscalRemaining * 100,
      researchFit: researchFit * 100,
      manufacturingFit: manufacturingFit * 100,
      resourceDelivery: resourceRemaining * 100,
      cashSupport,
      availableFiscal: ledger.fiscalMillionCny.available,
      occupiedFiscal: ledger.fiscalMillionCny.capacity - ledger.fiscalMillionCny.available,
    };
  };
  const chengdu = cityScore("chengdu");
  const chongqing = cityScore("chongqing");
  const fallbackMetrics: CompetitionMetric[] = [
    { id: "policy", label: "政策吸引力", description: "政策可信度 + 现金支持强度", chengdu: chengdu.policyAttraction, chongqing: chongqing.policyAttraction },
    { id: "fiscal", label: "财政可持续", description: "可用财政 / 财政容量", chengdu: chengdu.fiscalSustainability, chongqing: chongqing.fiscalSustainability },
    { id: "research", label: "研发人才匹配", description: "目标权重 + 人才住房余量", chengdu: chengdu.researchFit, chongqing: chongqing.researchFit },
    { id: "manufacturing", label: "制造供应链", description: "产业目标 + 厂房能源余量", chengdu: chengdu.manufacturingFit, chongqing: chongqing.manufacturingFit },
    { id: "delivery", label: "资源兑现能力", description: "土地、厂房、能源、住房余量", chengdu: chengdu.resourceDelivery, chongqing: chongqing.resourceDelivery },
  ];
  const metrics: CompetitionMetric[] = competition
    ? competition.dimensions.map((dimension) => ({
        id: dimension.id,
        label: dimension.label,
        description: `${dimension.direction === "cost" ? "成本型" : "效益型"}指标 · TOPSIS 权重 ${Math.round(dimension.weight * 100)}% · 原值 成都 ${dimension.raw.chengdu} / 重庆 ${dimension.raw.chongqing}`,
        chengdu: dimension.preferenceShare.chengdu,
        chongqing: dimension.preferenceShare.chongqing,
      }))
    : fallbackMetrics;
  const mainChengdu = chengdu.policyAttraction * .28 + chengdu.fiscalSustainability * .18 + chengdu.researchFit * .18 + chengdu.manufacturingFit * .18 + chengdu.resourceDelivery * .18;
  const mainChongqing = chongqing.policyAttraction * .28 + chongqing.fiscalSustainability * .18 + chongqing.researchFit * .18 + chongqing.manufacturingFit * .18 + chongqing.resourceDelivery * .18;
  const [fallbackChengduShare, fallbackChongqingShare] = pairShare(mainChengdu, mainChongqing);
  const chengduShare = competition ? Math.round(competition.scores.chengdu.share) : fallbackChengduShare;
  const chongqingShare = competition ? 100 - chengduShare : fallbackChongqingShare;
  const activeStep = fixture.baseline.steps[activeStepIndex];
  const activeActor = fixture.actorRegistry.find((actor) => actor.agentId === activeStep?.actorId);
  return <section className={`competition-belt ${live ? "live" : ""}`} aria-label="双城项目争取力">
    <button type="button" className="competition-live-action" disabled={!activeStep} onClick={() => activeStep && onOpenEvidence(activeStepIndex)}>
      <span>{activeStep ? `${String(activeStepIndex + 1).padStart(2, "0")} / ${fixture.baseline.steps.length}` : "READY"}</span>
      <div><small>{live ? "DEEPSEEK LIVE · " : "当前行动 · "}{activeActor?.displayName ?? "等待 Agent"}</small><strong>{activeStep ? `${actionKindLabel(activeStep.candidate.kind)}${humanizeDelta(activeStep) ? ` · ${humanizeDelta(activeStep)}` : ""}` : "设置条件后开始推演"}</strong></div>
      {activeStep && <b>证据 <ChevronRight size={12} /></b>}
    </button>
    <div className="tug-heading"><strong className="chengdu-score">成都 {chengduShare}%</strong><span>{competition ? "董事会 TOPSIS 偏好" : "综合争取力"} <small>{competition ? "同一权重、同一可行域，贴近度实时重算" : "5 项状态预览，不代表概率"}</small></span><strong className="chongqing-score">{chongqingShare}% 重庆</strong></div>
    <div className="tug-bar">
      <b className="tug-project-marker" style={{ left: `${chengduShare}%` }}>项目</b>
      <div className="tug-track" aria-label={`成都 ${chengduShare}%，重庆 ${chongqingShare}%`}><i className="chengdu-fill" style={{ width: `${chengduShare}%` }} /><i className="chongqing-fill" style={{ width: `${chongqingShare}%` }} /></div>
    </div>
    <div className="competition-metrics">{metrics.map((metric) => {
      const [left, right] = pairShare(metric.chengdu, metric.chongqing);
      return <div key={metric.id} title={metric.description}><header><b>{left}</b><span>{metric.label}</span><b>{right}</b></header><i><em style={{ width: `${left}%` }} /><strong style={{ width: `${right}%` }} /></i></div>;
    })}</div>
    <footer><span className="chengdu-raw">成都：现金支持 {Math.round(chengdu.cashSupport)} 百万 · 可用财政 {Math.round(chengdu.availableFiscal)} 百万 · 已占用 {Math.round(chengdu.occupiedFiscal)} 百万</span><b>{competition ? `TOPSIS 贴近度 ${Math.round(competition.scores.chengdu.closeness * 100)} : ${Math.round(competition.scores.chongqing.closeness * 100)} · 当前偏好${competition.preferredCity === "chengdu" ? "成都" : "重庆"}` : "研发在成都 · 制造在重庆 · 协同可增益"}</b><span className="chongqing-raw">重庆：已占用 {Math.round(chongqing.occupiedFiscal)} 百万 · 可用财政 {Math.round(chongqing.availableFiscal)} 百万 · 现金支持 {Math.round(chongqing.cashSupport)} 百万</span></footer>
  </section>;
}

function OrganizationSurface({ fixture, focusCity, onSelectActor, onOpenEvidence }: { fixture: CityScopeDemoFixture; focusCity?: "chengdu" | "chongqing"; onSelectActor: (actorId: string) => void; onOpenEvidence: () => void }) {
  const allGroups = organizationGroupDefs.map((def) => [def.name, def.ids] as const);
  const focusName = focusCity === "chengdu" ? "成都高新区" : focusCity === "chongqing" ? "重庆两江新区" : undefined;
  const groups = focusName ? allGroups.filter(([name]) => name !== (focusCity === "chengdu" ? "重庆两江新区" : "成都高新区")).sort(([a], [b]) => a === focusName ? -1 : b === focusName ? 1 : 0) : allGroups;
  const actors = new Map(fixture.actorRegistry.map((actor) => [actor.agentId, actor]));
  return <div className="surface-content organization-surface">
    <header><p>{focusName ? `${focusName} · 组织层` : "双城完整组织层"}</p><h2>{focusName ? `${focusName}如何形成一份政策` : "14 个角色，2 套确定性服务"}</h2></header>
    <div className="org-groups">
      {groups.map(([name, ids]) => <section className={`org-group ${name.includes("成都") ? "mint" : name.includes("重庆") ? "ember" : name.includes("服务") ? "service" : "blue"}`} key={name}>
        <div className="org-root"><Building2 size={15} /><strong>{name}</strong></div>
        <div className="org-roles">{ids.map((id) => {
          const actor = actors.get(id);
          if (!actor) return null;
          return <button type="button" className={`actor-${actor.actorKind}`} key={id} onClick={() => onSelectActor(id)}>
            <span className="actor-kind">{actor.actorKind === "agent" ? "行为 AGENT" : "规则 SERVICE"}</span><strong>{actor.displayName}</strong><small>{actor.role}</small>
          </button>;
        })}</div>
      </section>)}
    </div>
    <div className="evidence-note ok"><Check size={14} />角色负责判断与协商；服务只核算事实、资源和履约，不参与立场博弈。</div>
    <button className="org-policy-link" type="button" onClick={onOpenEvidence}>继续查看 Agent X-Ray 与因果证据 <ChevronRight size={15} /></button>
  </div>;
}

const interventionControls: Record<LiveForkRequest["path"], { label: string; min: number; max: number; step: number; defaultAdjustment: number; mode: LiveForkRequest["adjustmentMode"]; target: string }> = {
  "stakeholders.publicTrust": { label: "项目初始公众信任", min: -30, max: 30, step: 1, defaultAdjustment: 10, mode: "points", target: "公众信任" },
  "stakeholders.talentAttraction": { label: "研发人才吸引力", min: -30, max: 30, step: 1, defaultAdjustment: 20, mode: "points", target: "人才吸引力" },
  "stakeholders.supplyChainReadiness": { label: "本地供应链准备度", min: -30, max: 30, step: 1, defaultAdjustment: 20, mode: "points", target: "供应链准备度" },
  "company.investmentPlanMillionCny": { label: "企业一期投资预算", min: -50, max: 30, step: 5, defaultAdjustment: -20, mode: "percent", target: "一期投资预算" },
  "metrics.financingConfidence": { label: "外部融资信心", min: -40, max: 30, step: 1, defaultAdjustment: -20, mode: "points", target: "融资信心" },
  "metrics.projectViability": { label: "项目初始可执行性", min: -40, max: 30, step: 1, defaultAdjustment: -20, mode: "points", target: "项目可执行性" },
};

function adjustmentLabel(path: LiveForkRequest["path"], adjustment: number): string {
  const control = interventionControls[path];
  if (adjustment === 0) return `保持${control.target}不变`;
  return `${adjustment > 0 ? "提高" : "降低"}${Math.abs(adjustment)}${control.mode === "percent" ? "%" : "点"}`;
}

function checkpointValueLabel(path: LiveForkRequest["path"], value: number): string {
  if (path === "company.investmentPlanMillionCny") return `${Number((value / 100).toFixed(1))} 亿元`;
  return `${formatValue(value)} 分`;
}

function valueAtPath(state: CityScopeDemoFixture["baseline"]["terminalState"], path: LiveForkRequest["path"]): number {
  const value = path.split(".").reduce<unknown>((current, key) => current && typeof current === "object" ? (current as Record<string, unknown>)[key] : undefined, state);
  return typeof value === "number" ? value : 0;
}

function InterventionSetup({ fixture, path, value, error, onPath, onValue, onClose, onStart }: {
  fixture: CityScopeDemoFixture;
  path: LiveForkRequest["path"];
  value: number;
  error?: string;
  onPath: (path: LiveForkRequest["path"]) => void;
  onValue: (value: number) => void;
  onClose: () => void;
  onStart: () => void;
}) {
  const control = interventionControls[path];
  const baselineValue = valueAtPath(fixture.baseline.terminalState, path);
  const nextValue = control.mode === "percent" ? baselineValue * (1 + value / 100) : baselineValue + value;
  const zeroPct = ((0 - control.min) / (control.max - control.min)) * 100;
  return <div className="intervention-scrim" role="dialog" aria-modal="true" aria-label="设置推演变量">
    <section className="intervention-setup">
      <button className="setup-close" type="button" onClick={onClose} aria-label="关闭"><X size={15} /></button>
      <small>STEP 01 · 设定唯一实验条件</small>
      <h2>改变一个初始条件，<br />看两个世界如何分岔</h2>
      <p>选择一项实验变量并调整幅度。两套 Agent 从完全相同的快照出发，只有这一项不同。</p>
      <div className="variable-grid">{Object.entries(interventionControls).map(([key, item]) => {
        const active = key === path;
        const base = valueAtPath(fixture.baseline.terminalState, key as LiveForkRequest["path"]);
        return <button type="button" key={key} className={`variable-card ${active ? "active" : ""}`} onClick={() => onPath(key as LiveForkRequest["path"])}>
          <small>{item.label}</small>
          <strong>{checkpointValueLabel(key as LiveForkRequest["path"], base)}</strong>
          <span>{active ? adjustmentLabel(path, value) : "设为实验变量"}</span>
        </button>;
      })}</div>
      <div className="delta-panel">
        <div><small>A 世界 · 原始条件</small><b>{checkpointValueLabel(path, baselineValue)}</b></div>
        <i className="delta-arrow"><GitFork size={17} /></i>
        <div className="b-world"><small>B 世界 · 你的干预</small><b>{checkpointValueLabel(path, nextValue)}</b><em>{adjustmentLabel(path, value)}</em></div>
      </div>
      <input aria-label="条件调整幅度" type="range" min={control.min} max={control.max} step={control.step} value={value} onChange={(event) => onValue(Number(event.target.value))} style={{ background: `linear-gradient(90deg, #ec9a7e, #e4e8e4 ${zeroPct}%, #e4e8e4 ${zeroPct}%, #8fcdb2)` }} />
      <div className="adjustment-scale"><span>{adjustmentLabel(path, control.min)}</span><b>0 · 保持原值</b><span>{adjustmentLabel(path, control.max)}</span></div>
      {error && <p className="live-error">{error}</p>}
      <button className="start-live-run" type="button" disabled={value === 0} onClick={onStart}><Sparkles size={16} />开始双世界 Agent 推演</button>
      <p className="setup-footnote">相同初始快照，只改变这一项条件 · 订单风险将作为两套世界共同遭遇的外部冲击</p>
    </section>
  </div>;
}

function OpeningBrief({ fixture, onContinue }: { fixture: CityScopeDemoFixture; onContinue: () => void }) {
  const [page, setPage] = useState(0);
  const investmentYi = Math.round(fixture.scenario.investmentMillionCny / 100);
  const lastPage = 2;
  return <div className="opening-brief">
    <section className="opening-inner">
      <div className="opening-page" key={page}>
        {page === 0 && <>
          <small className="opening-kicker">CITYSCOPE · 双城政企 Agent 推演场</small>
          <h1>没人应该赢下的<b>超级工厂</b></h1>
          <p className="opening-subtitle">成都高新区与重庆两江新区，一场具身智能产业项目争夺战</p>
          <p className="opening-disclaimer"><ShieldAlert size={13} />本实验基于公开城市画像构造反事实场景，不代表真实政策，不预测现实决策。</p>
        </>}
        {page === 1 && <>
          <small className="opening-kicker">项目档案 · 虚构企业</small>
          <h2>{fixture.scenario.company}</h2>
          <p className="opening-subtitle">一家具身智能公司，计划在西部落地研发与智能制造体系，成都和重庆都想争取。</p>
          <div className="brief-stats">
            <div><b>{investmentYi} 亿元</b><span>声称总投资</span></div>
            <div><b>≈ 1200 个</b><span>直接就业岗位</span></div>
            <div><b>数万台 / 年</b><span>三年内机器人产能</span></div>
            <div><b>多家</b><span>零部件供应商跟随落地</span></div>
          </div>
          <div className="brief-functions"><span>西部研发总部</span><span>机器人训练中心</span><span>智能工厂</span><span>上下游产业基地</span></div>
          <p className="brief-note">城市与区位使用真实地名；企业、金额、订单与具体政策均为虚构。</p>
        </>}
        {page === 2 && <>
          <small className="opening-kicker">争夺双方</small>
          <div className="versus-row">
            <div className="versus-card chengdu"><small>成都高新区</small><strong>研发与人才</strong><span>创新策源 · 人才住房 · 算法生态</span></div>
            <div className="versus-badge" aria-hidden="true">VS</div>
            <div className="versus-card chongqing"><small>重庆两江新区</small><strong>制造与供应链</strong><span>智能工厂 · 供应链基地 · 土地能源</span></div>
          </div>
          <div className="tug-preview" aria-hidden="true">
            <span className="tug-side chengdu">50</span>
            <div className="tug-track"><i className="tug-fill chengdu" /><i className="tug-fill chongqing" /><i className="tug-marker" /></div>
            <span className="tug-side chongqing">50</span>
          </div>
          <p className="tug-caption">初始争取力 50 : 50 · 胜负由 Agent 现场推演决定</p>
        </>}
      </div>
      <div className="opening-nav">
        <div className="opening-dots">{[0, 1, 2].map((index) => <button key={index} type="button" aria-label={`第 ${index + 1} 页`} className={index === page ? "active" : ""} onClick={() => setPage(index)} />)}</div>
        <div className="opening-actions">
          {page < lastPage && <button type="button" className="opening-skip" onClick={() => setPage(lastPage)}>跳过背景介绍</button>}
          {page < lastPage
            ? <button type="button" className="opening-next" onClick={() => setPage(page + 1)}>继续 <ChevronRight size={15} /></button>
            : <button type="button" className="opening-next" onClick={onContinue}>设置唯一实验条件 <ChevronRight size={15} /></button>}
        </div>
      </div>
      {page > 0 && <small className="opening-footnote">反事实实验场景 · 不代表真实政策 · 不预测现实决策</small>}
    </section>
  </div>;
}

function StreamingText({ text, active }: { text: string; active: boolean }) {
  const [length, setLength] = useState(active ? 0 : text.length);
  useEffect(() => {
    if (!active) { setLength(text.length); return; }
    setLength(0);
    const interval = window.setInterval(() => setLength((current) => {
      if (current >= text.length) { window.clearInterval(interval); return current; }
      return Math.min(text.length, current + 2);
    }), 24);
    return () => window.clearInterval(interval);
  }, [active, text]);
  return <>{text.slice(0, length)}{active && length < text.length && <i className="stream-caret" />}</>;
}

function readableStepDelay(step: DemoStep | undefined): number {
  if (!step) return 2_400;
  const length = stepSpeech(step).replace(/\s/g, "").length;
  return Math.max(2_400, Math.min(6_000, 1_500 + length * 38));
}

function boundedSpeechPlacement(anchor: { left: number; top: number } | undefined, fallback: { left: number; top: number }, text: string, hasDelta: boolean): { style: CSSProperties; side: "right" | "left" } {
  const viewportWidth = typeof window === "undefined" ? 1440 : window.innerWidth;
  const viewportHeight = typeof window === "undefined" ? 900 : window.innerHeight;
  const rawLeft = anchor?.left ?? viewportWidth * fallback.left / 100;
  const rawTop = anchor?.top ?? viewportHeight * fallback.top / 100;
  const bubbleWidth = Math.min(340, Math.max(280, viewportWidth * .32));
  const estimatedLines = Math.max(2, Math.ceil(text.replace(/\s/g, "").length / 28));
  const estimatedHeight = Math.min(240, 74 + estimatedLines * 15 + (hasDelta ? 28 : 0));
  const gap = 26;
  const side = rawLeft + gap + bubbleWidth <= viewportWidth - 20 ? "right" : "left";
  const proposedLeft = side === "right" ? rawLeft + gap : rawLeft - gap;
  const minTop = 96 + estimatedHeight / 2;
  const maxTop = Math.max(minTop, viewportHeight - 184 - estimatedHeight / 2);
  return {
    side,
    style: {
      left: `${side === "right" ? Math.min(viewportWidth - bubbleWidth - 20, Math.max(20, proposedLeft)) : Math.max(bubbleWidth + 20, Math.min(viewportWidth - 20, proposedLeft))}px`,
      top: `${Math.max(minTop, Math.min(maxTop, rawTop))}px`,
    },
  };
}

function MapSpeeches({ fixture, activeStepIndex, live, actorAnchors }: { fixture: CityScopeDemoFixture; activeStepIndex: number; live: boolean; actorAnchors: Record<string, { left: number; top: number }> }) {
  const step = fixture.baseline.steps[activeStepIndex];
  if (!step) return null;
  const actor = fixture.actorRegistry.find((item) => item.agentId === step.actorId);
  const projected = actorAnchors[step.actorId];
  const fallback = fallbackSpeechAnchors[step.actorId] ?? { left: 50, top: 50 };
  const speech = stepSpeech(step);
  const delta = humanizeDelta(step);
  const placement = boundedSpeechPlacement(projected, fallback, speech, Boolean(delta));
  return <div className="map-speech-layer"><div className={`agent-map-speech current side-${placement.side}`} style={placement.style}>
    <span><i />{live ? "实时建议" : phaseLabels[step.phase] ?? "协作行动"}</span>
    <strong>{actor?.displayName ?? "当前 Agent"}</strong>
    <p><StreamingText text={speech} active={live} /></p>
    {delta && <b>{delta}</b>}
    {step.receipt.status === "REJECTED" && <em><ShieldAlert size={11} />触及约束，未改变世界</em>}
  </div></div>;
}

const debateTurnLabels: Record<string, string> = {
  challenge: "提出冲突",
  position: "陈述立场",
  proposal: "提出折中",
  counter: "提出反案",
  concession: "确认让步",
};

function debateMeta(step: DemoStep): { turnType: string; stance: string; replyTo?: string } {
  const payload = step.candidate.payload as { turnType?: unknown; stance?: unknown; replyToMessageId?: unknown };
  return {
    turnType: typeof payload.turnType === "string" ? payload.turnType : step.candidate.kind === "ISSUE_COORDINATION_OPINION" ? "resolution" : "position",
    stance: typeof payload.stance === "string" ? payload.stance : "mediate",
    ...(typeof payload.replyToMessageId === "string" ? { replyTo: payload.replyToMessageId } : {}),
  };
}

function CoordinationDebateStage({ fixture, activeStepIndex, live }: { fixture: CityScopeDemoFixture; activeStepIndex: number; live: boolean }) {
  const debateSteps = fixture.baseline.steps.slice(0, activeStepIndex + 1).filter((step) => step.phase === "coordination_debate");
  const current = fixture.baseline.steps[activeStepIndex];
  const [waitingSeconds, setWaitingSeconds] = useState(0);
  const flowRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const flow = flowRef.current;
    if (typeof flow?.scrollTo === "function") flow.scrollTo({ top: flow.scrollHeight, behavior: "smooth" });
  }, [debateSteps.length]);
  useEffect(() => {
    setWaitingSeconds(0);
    if (!live) return;
    const timer = window.setInterval(() => setWaitingSeconds((seconds) => seconds + 1), 1_000);
    return () => window.clearInterval(timer);
  }, [current?.candidate.actionId, live]);
  if (current?.phase !== "coordination_debate") return null;
  const actors: Record<string, { className: string; label: string; sub: string }> = {
    chengdu_leader: { className: "chengdu", label: "成都负责人 Agent", sub: "研发总部与人才平台" },
    regional_coordinator: { className: "coordinator", label: "区域协调 Agent", sub: "拆解冲突 · 促成让步" },
    chongqing_leader: { className: "chongqing", label: "重庆负责人 Agent", sub: "智能工厂与供应链" },
  };
  const nextActor = ["区域协调 Agent", "成都负责人 Agent", "重庆负责人 Agent", "区域协调 Agent", "成都负责人 Agent", "重庆负责人 Agent", "区域协调 Agent"][debateSteps.length] ?? "协调结论";
  return <div className="coordination-debate-backdrop"><section className="coordination-debate-stage" aria-label="成渝协调谈判">
    <header><span>实时协调</span><strong>不是轮流念稿，而是围绕同一议题持续回应</strong><div className="debate-progress" aria-label={`已完成 ${debateSteps.length}/7 轮`}>{Array.from({ length: 7 }, (_, index) => { const step = debateSteps[index]; return <i key={index} className={step ? `done ${actors[step.actorId]?.className ?? ""}` : live && index === debateSteps.length ? "pending" : ""} />; })}<small>{debateSteps.length}/7 轮</small></div></header>
    <div className="debate-issue-axis"><span>研发总部</span><i>功能分工 · 重复补贴 · 财政兑现</i><span>智能制造</span></div>
    <div className="debate-flow" ref={flowRef}>
      {debateSteps.map((step) => {
        const meta = debateMeta(step);
        const actor = actors[step.actorId] ?? { className: "coordinator", label: step.actorId, sub: "" };
        const isCurrent = step === current;
        const isResolution = step.candidate.kind === "ISSUE_COORDINATION_OPINION";
        const replyTarget = meta.replyTo ? debateSteps.find((item) => (item.candidate.payload as { messageId?: unknown }).messageId === meta.replyTo) : undefined;
        return <article className={`debate-msg ${actor.className} ${isCurrent ? "current" : ""}`} key={step.candidate.actionId}>
          <header><i /><div><strong>{actor.label}</strong><small>{actor.sub}</small></div><span className={`turn-chip ${isResolution ? "resolution" : meta.turnType}`}>{isResolution ? "形成协调结论" : debateTurnLabels[meta.turnType] ?? "回应议题"}</span></header>
          {replyTarget && <blockquote>回复 {actors[replyTarget.actorId]?.label ?? "前序主张"}：{stepSpeech(replyTarget).slice(0, 38)}…</blockquote>}
          <p>{isCurrent ? <StreamingText text={stepSpeech(step)} active={live} /> : stepSpeech(step)}</p>
          {isResolution && <b className="debate-resolution"><Check size={10} />双方让步已写入正式意见</b>}
        </article>;
      })}
      {live && debateSteps.length < 7 && <div className="debate-typing"><span className="live-dot" /><b>等待 {nextActor} 回复</b><small>{waitingSeconds < 2 ? "正在读取前序主张" : `已生成 ${waitingSeconds} 秒，超时将自动降级继续`}</small></div>}
    </div>
  </section></div>;
}

function firstDivergence(baselineSteps: DemoStep[], forkSteps: DemoStep[]): { index: number; baseline: DemoStep; fork: DemoStep } | undefined {
  const length = Math.min(baselineSteps.length, forkSteps.length);
  for (let index = 0; index < length; index += 1) {
    const baseline = baselineSteps[index];
    const fork = forkSteps[index];
    if (!baseline || !fork) continue;
    const left = JSON.stringify([baseline.actorId, baseline.candidate.kind, baseline.candidate.payload, baseline.candidate.reasoning]);
    const right = JSON.stringify([fork.actorId, fork.candidate.kind, fork.candidate.payload, fork.candidate.reasoning]);
    if (left !== right) return { index, baseline, fork };
  }
  return undefined;
}

function RunningWorldSwitcher({ progress, world, onWorld }: { progress: LiveForkProgress; world: "baseline" | "intervention"; onWorld: (world: "baseline" | "intervention") => void }) {
  return <section className="branch-switcher running-world-switcher">
    <header><Radio size={14} /><span>两套 DeepSeek Agent 正在并行推演</span></header>
    <div><button type="button" className={world === "baseline" ? "active" : ""} onClick={() => onWorld("baseline")}><small>A · 对照世界</small><strong>{progress.baselineSteps.length} 个行动</strong><span>保持原始条件</span></button><button type="button" className={world === "intervention" ? "active" : ""} onClick={() => onWorld("intervention")}><small>B · 实验世界</small><strong>{progress.forkSteps.length} 个行动</strong><span>{adjustmentLabel(progress.intervention.path, progress.intervention.newValue === progress.intervention.previousValue ? 0 : progress.intervention.path === "company.investmentPlanMillionCny" ? Math.round((progress.intervention.newValue / progress.intervention.previousValue - 1) * 100) : progress.intervention.newValue - progress.intervention.previousValue)}</span></button></div>
  </section>;
}

function DivergenceNotice({ progress, fixture }: { progress: LiveForkProgress; fixture: CityScopeDemoFixture }) {
  const divergence = firstDivergence(progress.baselineSteps, progress.forkSteps);
  if (!divergence) return <div className="divergence-notice waiting"><span />两套世界尚未出现决策分歧</div>;
  const baselineManifest = fixture.actorRegistry.find((actor) => actor.agentId === divergence.baseline.actorId);
  const forkManifest = fixture.actorRegistry.find((actor) => actor.agentId === divergence.fork.actorId);
  const baselineActor = baselineManifest?.displayName ?? divergence.baseline.actorId;
  const forkActor = forkManifest?.displayName ?? divergence.fork.actorId;
  return <section className="divergence-notice"><header><Split size={13} /><strong>第 {divergence.index + 1} 个行动首次分歧</strong></header><div><span>A · {baselineActor}<b>{actionKindLabel(divergence.baseline.candidate.kind)}</b></span><i /><span>B · {forkActor}<b>{actionKindLabel(divergence.fork.candidate.kind)}</b></span></div></section>;
}

function RiskMilestone({ progress }: { progress: LiveForkProgress }) {
  const [showMoment, setShowMoment] = useState(true);
  useEffect(() => {
    const timer = window.setTimeout(() => setShowMoment(false), 2800);
    return () => window.clearTimeout(timer);
  }, []);
  const divergence = firstDivergence(progress.baselineSteps, progress.forkSteps);
  if (!showMoment) return <PostRiskProgress progress={progress} label="风险后的社会反馈与董事会重议正在生成" />;
  return <section className="checkpoint-moment">
    <div className="checkpoint-pulse"><AlertTriangle size={20} /></div>
    <small>SHARED SHOCK · 共同外部冲击</small>
    <h2>两套世界同时收到尽调事实：约束订单仅 34%</h2>
    <p>这不是分支起点。两套 Agent 从第一轮就分别推演，现在要观察已经形成的政策、信任和财政状态如何影响风险应对。</p>
    <div><span>A · 对照世界<strong>{progress.baselineSteps.length} 个行动</strong></span><i>{divergence ? `首次分歧在第 ${divergence.index + 1} 个行动` : "目前行动仍然一致"}</i><span>B · 实验世界<strong>{progress.forkSteps.length} 个行动</strong></span></div>
  </section>;
}

function PostRiskProgress({ progress, label = progress.label }: { progress: LiveForkProgress; label?: string }) {
  return <section className="post-risk-progress">
    <span className="live-dot" />
    <div><small>风险后续推演 · LIVE</small><strong>{label}</strong></div>
    <p><b>A {progress.baselineSteps.length}</b><i>实时</i><b>B {progress.forkSteps.length}</b><i>实时</i></p>
  </section>;
}

function BranchSwitcher({ result, world, onWorld }: { result: LiveForkResult; world: "baseline" | "intervention"; onWorld: (world: "baseline" | "intervention") => void }) {
  return <section className="branch-switcher">
    <header><GitFork size={14} /><span>相同初始快照 · 仅一项条件不同</span></header>
    <div><button type="button" className={world === "baseline" ? "active" : ""} onClick={() => onWorld("baseline")}><small>A · 对照世界</small><strong>{outcomeLabel(result.baselineOutcome.label)}</strong><span>初始值 {formatValue(result.intervention.previousValue)}</span></button><button type="button" className={world === "intervention" ? "active" : ""} onClick={() => onWorld("intervention")}><small>B · 实验世界</small><strong>{outcomeLabel(result.forkOutcome.label)}</strong><span>实验值 {formatValue(result.intervention.newValue)}</span></button></div>
  </section>;
}

type RunMetricComparison = { label: string; baseline: number; intervention: number; difference: number };

function runMetricComparisons(result: LiveForkResult): RunMetricComparison[] {
  const candidates = [
    ["融资信心", result.baselineState.metrics.financingConfidence, result.forkState.metrics.financingConfidence],
    ["项目可行性", result.baselineState.metrics.projectViability, result.forkState.metrics.projectViability],
    ["政府可信度", result.baselineState.metrics.trust, result.forkState.metrics.trust],
    ["公众信任", result.baselineState.stakeholders.publicTrust, result.forkState.stakeholders.publicTrust],
    ["供应链准备度", result.baselineState.stakeholders.supplyChainReadiness, result.forkState.stakeholders.supplyChainReadiness],
  ] as const;
  return candidates.map(([label, baseline, intervention]) => ({ label, baseline, intervention, difference: intervention - baseline }))
    .sort((left, right) => Math.abs(right.difference) - Math.abs(left.difference));
}

function interventionSummary(result: LiveForkResult): string {
  const control = interventionControls[result.intervention.path];
  return `${control.label}：${checkpointValueLabel(result.intervention.path, result.intervention.previousValue)} → ${checkpointValueLabel(result.intervention.path, result.intervention.newValue)}`;
}

function runHeadline(result: LiveForkResult): string {
  if (result.baselineOutcome.label !== result.forkOutcome.label) return "一项初始条件，改变了项目的最终落点";
  return firstDivergence(result.baselineSteps, result.forkSteps) ? "最终结局一致，但决策路径已经改变" : "最终结局一致，但关键指标发生变化";
}

function divergenceSummary(result: LiveForkResult, fixture: CityScopeDemoFixture): { index: number; baselineActor: string; forkActor: string; baselineAction: string; forkAction: string } | undefined {
  const divergence = firstDivergence(result.baselineSteps, result.forkSteps);
  if (!divergence) return undefined;
  const actorName = (actorId: string) => {
    const actor = fixture.actorRegistry.find((item) => item.agentId === actorId);
    return actor?.displayName ?? actorId;
  };
  return {
    index: divergence.index,
    baselineActor: actorName(divergence.baseline.actorId),
    forkActor: actorName(divergence.fork.actorId),
    baselineAction: actionKindLabel(divergence.baseline.candidate.kind),
    forkAction: actionKindLabel(divergence.fork.candidate.kind),
  };
}

function RunSettlementBar({ result, fixture, onReplayDivergence, onRecap }: { result: LiveForkResult; fixture: CityScopeDemoFixture; onReplayDivergence: () => void; onRecap: () => void }) {
  const metrics = runMetricComparisons(result).slice(0, 3);
  const divergence = divergenceSummary(result, fixture);
  return <section className="run-settlement-bar" aria-label="本轮推演结算">
    <div className="settlement-outcomes">
      <span><small>A · 对照世界</small><strong>{outcomeLabel(result.baselineOutcome.label)}</strong></span>
      <div><small>本轮推演结算</small><b>{runHeadline(result)}</b><em>{interventionSummary(result)}</em></div>
      <span className="fork"><small>B · 实验世界</small><strong>{outcomeLabel(result.forkOutcome.label)}</strong></span>
    </div>
    <div className="settlement-deltas">{metrics.map((metric) => <p key={metric.label}><span>{metric.label}</span><b>{metric.baseline}</b><i>→</i><strong>{metric.intervention}</strong><em className={metric.difference >= 0 ? "up" : "down"}>{metric.difference > 0 ? "+" : ""}{metric.difference}</em></p>)}</div>
    <div className="settlement-actions"><button type="button" disabled={!divergence} onClick={onReplayDivergence}><Split size={13} />{divergence ? `回看第 ${divergence.index + 1} 步分歧` : "两侧行动未分歧"}</button><button type="button" onClick={onRecap}>查看本轮复盘 <ChevronRight size={13} /></button></div>
  </section>;
}

function transcriptVisibility(step: DemoStep): string {
  if (step.phase === "internal_advice" || step.candidate.kind === "ADVISE_COMPANY_RESPONSE") return "组织内部可见";
  if (step.phase === "coordination_debate") return step.candidate.kind === "ISSUE_COORDINATION_OPINION" ? "正式协调结论" : "仅谈判参与者可见";
  if (step.candidate.kind === "DISCLOSE_FACT") return "按尽调范围披露";
  return "共同世界可见";
}

function DecisionTranscript({ steps, fixture }: { steps: DemoStep[]; fixture: CityScopeDemoFixture }) {
  return <section className="recap-transcript">
    <header><div><small>完整决策实录</small><h3>{steps.length} 个真实行动，不补写赛后对白</h3></div><span>发言 · 权限 · 结果</span></header>
    <div className="transcript-list">{steps.map((step, index) => {
      const actor = fixture.actorRegistry.find((item) => item.agentId === step.actorId);
      const debate = step.phase === "coordination_debate";
      return <article className={`${debate ? "debate" : ""} ${step.receipt.status === "REJECTED" ? "rejected" : ""}`} key={`${step.candidate.actionId}-${index}`}>
        <span className="transcript-index">{String(index + 1).padStart(2, "0")}</span>
        <div className="transcript-actor"><small>{phaseLabels[step.phase] ?? presentationTerm(step.phase)}</small><strong>{actor?.displayName ?? presentationTerm(step.actorId)}</strong><em>{transcriptVisibility(step)}</em></div>
        <div className="transcript-speech"><b>{actionKindLabel(step.candidate.kind)}</b><p>{stepSpeech(step)}</p></div>
        <div className="transcript-result"><strong>{step.receipt.status === "APPLIED" ? "已进入世界" : "被规则拦截"}</strong><span>{step.receipt.deltas.length} 项变化</span><small>{step.candidate.evidenceFactIds.length > 0 ? `引用 ${step.candidate.evidenceFactIds.length} 项授权事实` : "未引用私有事实"}</small></div>
      </article>;
    })}</div>
  </section>;
}

function OutcomeRetrospective({ result, fixture, world }: { result: LiveForkResult; fixture: CityScopeDemoFixture; world: "baseline" | "intervention" }) {
  const state = world === "baseline" ? result.baselineState : result.forkState;
  const steps = world === "baseline" ? result.baselineSteps : result.forkSteps;
  const outcome = world === "baseline" ? result.baselineOutcome : result.forkOutcome;
  const opinion = state.coordinationOpinions.at(-1);
  const finalStep = [...steps].reverse().find((step) => ["ACCEPT_POLICY", "EXIT_PROJECT"].includes(step.candidate.kind));
  const finalActor = fixture.actorRegistry.find((actor) => actor.agentId === finalStep?.actorId)?.displayName;
  return <section className="recap-retrospective">
    <header><small>结局复盘 · {world === "baseline" ? "A 对照世界" : "B 实验世界"}</small><h3>{outcomeLabel(outcome.label)}</h3></header>
    <div className="retrospective-chain">
      <p><span>01</span><b>实验起点</b><em>{world === "baseline" ? "保持原始条件" : interventionSummary(result)}</em></p>
      <i />
      <p><span>02</span><b>协调转折</b><em>{opinion?.summary ? cleanNarrative(opinion.summary, 110) : "本轮没有形成正式跨城协调意见"}</em></p>
      <i />
      <p><span>03</span><b>最终决策</b><em>{finalStep ? `${finalActor ?? "决策主体"}：${actionKindLabel(finalStep.candidate.kind)}` : "由终态规则完成分类"}</em></p>
    </div>
    {opinion?.concessions && opinion.concessions.length > 0 && <div className="retrospective-concessions"><span>协调为何成立</span>{opinion.concessions.map((item, index) => <p key={item}><b>{index === 0 ? "成都" : "重庆"}</b>{cleanNarrative(item, 80)}</p>)}</div>}
    <footer>系统只总结已发生的行动、消息、制度校验和状态变化，不根据结局倒写理由。</footer>
  </section>;
}

function RunRecapContent({ result, fixture, onReplayDivergence, onBack }: { result: LiveForkResult; fixture: CityScopeDemoFixture; onReplayDivergence: () => void; onBack: () => void }) {
  const [transcriptWorld, setTranscriptWorld] = useState<"baseline" | "intervention">("intervention");
  const metrics = runMetricComparisons(result).slice(0, 3);
  const divergence = divergenceSummary(result, fixture);
  const baselineStep = divergence ? result.baselineSteps[divergence.index] : undefined;
  const forkStep = divergence ? result.forkSteps[divergence.index] : undefined;
  return <div className="run-recap-content">
    <header className="recap-title"><div><small>本轮 DEEPSEEK 双世界实验</small><h2>{runHeadline(result)}</h2><p>{interventionSummary(result)}</p></div><button type="button" onClick={onBack}><X size={14} />返回沙盘</button></header>
    <section className="recap-outcome-line">
      <div className="baseline"><small>A · 对照世界</small><strong>{outcomeLabel(result.baselineOutcome.label)}</strong><span>保持原始条件 · {result.baselineSteps.length} 个行动</span></div>
      <i><GitFork size={17} /><span>唯一条件不同</span></i>
      <div className="intervention"><small>B · 实验世界</small><strong>{outcomeLabel(result.forkOutcome.label)}</strong><span>应用实验条件 · {result.forkSteps.length} 个行动</span></div>
    </section>
    <section className="recap-metric-line"><header><span>关键结果差异</span><small>A 对照</small><small>B 实验</small><small>差值</small></header>{metrics.map((metric) => <p key={metric.label}><span>{metric.label}</span><b>{metric.baseline}</b><strong>{metric.intervention}</strong><em className={metric.difference >= 0 ? "up" : "down"}>{metric.difference > 0 ? "+" : ""}{metric.difference}</em></p>)}</section>
    <section className="recap-divergence">
      <header><div><small>首次可观察分歧</small><h3>{divergence ? `第 ${divergence.index + 1} 个行动开始走向不同路径` : "两侧行动序列未出现可观察分歧"}</h3></div>{divergence && <button type="button" onClick={onReplayDivergence}><Play size={13} />回放这一刻</button>}</header>
      {divergence && <div><p><small>A · {divergence.baselineActor}</small><strong>{divergence.baselineAction}</strong><span>{baselineStep ? cleanNarrative(baselineStep.candidate.reasoning, 70) : "—"}</span></p><i /><p><small>B · {divergence.forkActor}</small><strong>{divergence.forkAction}</strong><span>{forkStep ? cleanNarrative(forkStep.candidate.reasoning, 70) : "—"}</span></p></div>}
    </section>
    <OutcomeRetrospective result={result} fixture={fixture} world={transcriptWorld} />
    <div className="recap-world-tabs" role="tablist" aria-label="选择决策实录世界"><button type="button" role="tab" aria-selected={transcriptWorld === "baseline"} className={transcriptWorld === "baseline" ? "active" : ""} onClick={() => setTranscriptWorld("baseline")}>A · 对照世界记录</button><button type="button" role="tab" aria-selected={transcriptWorld === "intervention"} className={transcriptWorld === "intervention" ? "active" : ""} onClick={() => setTranscriptWorld("intervention")}>B · 实验世界记录</button></div>
    <DecisionTranscript steps={transcriptWorld === "baseline" ? result.baselineSteps : result.forkSteps} fixture={fixture} />
    <details className="recap-technical"><summary><span><ScanLine size={14} />展开技术证据</span><small>制度校验、causeId 与状态变化</small></summary><div>
      {[{ label: "A · 对照世界", step: baselineStep, state: result.baselineState }, { label: "B · 实验世界", step: forkStep, state: result.forkState }].map((item) => <section key={item.label}><header><strong>{item.label}</strong><span>{item.step ? `${item.step.receipt.gateResults.filter((gate) => gate.passed).length}/${item.step.receipt.gateResults.length} 道制度校验通过` : "无分歧行动"}</span></header>{item.step ? <><p>因果标识 <b>{item.step.candidate.actionId}</b></p><p>本行动产生 <b>{item.step.receipt.deltas.length}</b> 项状态变化</p>{item.step.receipt.deltas.slice(0, 3).map((delta) => <p key={delta.deltaId}><span>{readablePath(delta.path)}</span><b>{formatValue(delta.before)} → {formatValue(delta.after)}</b></p>)}</> : <p>两侧在当前可观测行动中保持一致。</p>}<footer>本世界累计 {item.state.trace.length} 项可追溯变化</footer></section>)}
    </div></details>
  </div>;
}

function ForkSurface({ fixture, liveResult, liveStatus, liveError, onReplayDivergence, onBack }: {
  fixture: CityScopeDemoFixture;
  liveResult?: LiveForkResult;
  liveStatus: "idle" | "running" | "completed" | "failed";
  liveError?: string;
  onReplayDivergence: () => void;
  onBack: () => void;
}) {
  if (liveResult) return <div className="surface-content fork-surface live-recap-surface"><RunRecapContent result={liveResult} fixture={fixture} onReplayDivergence={onReplayDivergence} onBack={onBack} /></div>;
  return <div className="surface-content fork-surface empty-run-recap"><GitFork size={30} /><small>双世界对照</small><h2>{liveStatus === "running" ? "本轮推演仍在进行" : liveStatus === "failed" ? "本轮推演未完成" : "先完成一次双世界推演"}</h2><p>{liveError ?? (liveStatus === "running" ? "两套 Agent 正在并行形成政策、企业决策与风险响应。" : "完成后，这里只会展示本轮 DeepSeek 的真实结果，不再混入历史演示数据。")}</p><button type="button" onClick={onBack}>返回战略沙盘</button></div>;
}

function ActorXRay({ fixture, actorId, onClose }: { fixture: CityScopeDemoFixture; actorId: string; onClose: () => void }) {
  const actor = fixture.actorRegistry.find((item) => item.agentId === actorId);
  if (!actor) return null;
  const divisionDetails = actorDivisionDetails[actor.agentId] ?? [actor.role];
  return <aside className="actor-xray">
    <button type="button" onClick={onClose} aria-label="关闭 Agent X-Ray"><X size={14} /></button>
    <small>{actor.actorKind === "agent" ? "行为智能体" : "确定性规则服务"} · {organizationLabels[actor.organization] ?? presentationTerm(actor.organization)}</small>
    <h3>{actor.displayName}</h3>
    <p className="actor-role-summary">核心职责：{actor.role}</p>
    <section className="actor-division"><span>具体分工</span><ul>{divisionDetails.map((detail) => <li key={detail}>{detail}</li>)}</ul></section>
    <section className="actor-permissions"><span>正式权限</span><div>{actor.permissions.map((item) => <i key={item}>{permissionLabels[item] ?? presentationTerm(item)}</i>)}</div></section>
    {actor.actorKind === "agent" ? <>
      <section className="actor-utility"><span>决策权重</span><div className="utility-grid">{actor.utility.map((item) => <div className="utility-row" key={item.dimension}><b><span>{utilityDimensionLabels[item.dimension] ?? presentationTerm(item.dimension)}</span><small>{utilityDirectionLabels[item.direction] ?? presentationTerm(item.direction)}</small></b><i style={{ width: `${item.weight * 100}%` }} /><em>{Math.round(item.weight * 100)}%</em></div>)}</div></section>
      <section className="actor-redlines"><span>红线</span><div>{actor.redLines.map((line) => <p key={line}>{line}</p>)}</div></section>
    </> : <section className="actor-deterministic"><span>确定性职责</span><div>{actor.deterministicResponsibilities.map((line) => <p key={line}>{responsibilityLabels[line] ?? cleanNarrative(line)}</p>)}</div></section>}
  </aside>;
}

function EvidenceInspector({ fixture, selection, onClose }: { fixture: CityScopeDemoFixture; selection: EvidenceSelection; onClose: () => void }) {
  const step = selection.kind === "step" ? fixture.baseline.steps[selection.index] : undefined;
  const candidate = step?.candidate ?? fixture.redlineProbe.candidate;
  const receipt = step?.receipt ?? fixture.redlineProbe.receipt;
  const actor = fixture.actorRegistry.find((item) => item.agentId === candidate.actorId);
  const failed = receipt.status === "REJECTED";
  const gateLabel = (gate: string) => ({ schema: "格式校验", authority: "权限校验", privacy: "信息边界", constraint: "红线约束" } as Record<string, string>)[gate] ?? "制度校验";
  return <aside className={`inspector open evidence-inspector ${failed ? "rejected" : ""}`} aria-label="制度证据检查器">
    <button className="inspector-close" type="button" onClick={onClose} aria-label="关闭证据"><X size={13} /></button>
    <div className="inspector-title"><span><ScanLine size={16} />{selection.kind === "redline" ? "红线拦截" : phaseLabels[step?.phase ?? ""]}</span><strong>{failed ? "未改变世界" : `${receipt.deltas.length} 项状态变化`}</strong></div>
    <div className="inspector-hero"><div className={failed ? "rejected-mini" : "core-mini"} /><div><small>{step?.actorKind === "service" ? "规则服务" : "AI AGENT"} · {step?.generationSource === "model" ? "实时生成" : "已验证结果"}</small><h3>{actionKindLabel(candidate.kind)}</h3></div></div>
    <p className="reasoning">{cleanNarrative(candidate.reasoning)}</p>
    {actor && actor.actorKind === "agent" && <div className="xray-evidence-grid">
      <section><span>本轮关注</span>{actor.goals.slice(0, 2).map((goal) => <p key={goal}>{cleanNarrative(goal, 42)}</p>)}</section>
      <section><span>决策红线</span>{actor.redLines.slice(0, 2).map((line) => <p key={line}>{cleanNarrative(line, 42)}</p>)}</section>
    </div>}
    <div className="gate-list">{receipt.gateResults.map((gate) => <div className={gate.passed ? "pass" : "fail"} key={gate.gate}><span>{gate.passed ? <Check size={11} /> : <X size={11} />}{gateLabel(gate.gate)}</span><p>{gate.passed ? "通过" : cleanNarrative(gate.reason, 34)}</p></div>)}</div>
    <div className="trace-chain"><span>部门行动</span><ChevronRight size={13} /><span>{failed ? "已拦截" : "已通过"}</span><ChevronRight size={13} /><span>{receipt.deltas.length} 项变化</span></div>
    <div className="delta-list">{receipt.deltas.length ? receipt.deltas.slice(0, 4).map((delta) => <div key={delta.deltaId}><small>{readablePath(delta.path)}</small><span>{formatValue(delta.before)}</span><ChevronRight size={11} /><strong>{formatValue(delta.after)}</strong></div>) : <p><ShieldAlert size={13} />该建议被约束门拦截，世界状态保持不变。</p>}</div>
  </aside>;
}

function decisionSupportFor(fixture: CityScopeDemoFixture, step: DemoStep): DecisionSupportView | undefined {
  const event = fixture.baseline.terminalState.events.find((item) => item.causeId === step.candidate.actionId && typeof item.payload === "object" && item.payload !== null && "decisionSupport" in item.payload);
  const raw = event?.payload.decisionSupport as unknown;
  if (!raw || typeof raw !== "object" || !("candidates" in raw) || !Array.isArray((raw as { candidates?: unknown }).candidates)) return undefined;
  return raw as DecisionSupportView;
}

function selectedCandidateId(step: DemoStep, support: DecisionSupportView): string {
  return support.candidates.find((candidate) => step.candidate.reasoning.includes(candidate.candidateId))?.candidateId
    ?? support.actorRanking.rows.find((row) => row.rank === 1)?.candidateId
    ?? support.candidates[0]?.candidateId
    ?? "";
}

function useInView<T extends HTMLElement>(): [(node: T | null) => void, boolean] {
  const [inView, setInView] = useState(false);
  const observerRef = useRef<IntersectionObserver | undefined>(undefined);
  const ref = useCallback((node: T | null) => {
    observerRef.current?.disconnect();
    if (!node) return;
    if (typeof IntersectionObserver === "undefined") { setInView(true); return; }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) { setInView(true); observer.disconnect(); }
    }, { threshold: 0.15 });
    observer.observe(node);
    observerRef.current = observer;
  }, []);
  return [ref, inView];
}

function useCountUp(target: number, duration = 750, active = true): number {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (!active) { setValue(0); return; }
    if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) { setValue(target); return; }
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      setValue(target * (1 - Math.pow(1 - t, 3)));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration, active]);
  return value;
}

function CountUp({ value, decimals = 0, suffix = "" }: { value: number; decimals?: number; suffix?: string }) {
  const [ref, inView] = useInView<HTMLSpanElement>();
  return <span ref={ref}>{useCountUp(value, 750, inView).toFixed(decimals)}{suffix}</span>;
}

function Reveal({ className, ariaLabel, children }: { className: string; ariaLabel?: string; children: ReactNode }) {
  const [ref, inView] = useInView<HTMLElement>();
  return <section ref={ref} aria-label={ariaLabel} className={`${className}${inView ? " in-view" : ""}`}>{children}</section>;
}

function DecisionFunnel({ support, currentCandidate, chosenRank, gatePassed, gateTotal }: {
  support: DecisionSupportView;
  currentCandidate?: DecisionCandidateView;
  chosenRank?: number;
  gatePassed: number;
  gateTotal: number;
}) {
  const functionCount = currentCandidate ? Object.keys(currentCandidate.assignments).length : 0;
  const totalCombos = functionCount > 0 ? Math.pow(3, functionCount) : 0;
  const dimCount = Object.keys(support.actorRanking.weights).length;
  const constraintCount = currentCandidate?.constraintEvidence.length ?? 0;
  const steps: Array<{ tag: string; value: ReactNode; unit?: string; label: string }> = [
    { tag: "组合空间", value: totalCombos > 0 ? <CountUp value={totalCombos} /> : "—", unit: "种", label: "功能 × 城市 全覆盖搜索" },
    { tag: "约束求解", value: <CountUp value={constraintCount} />, unit: "条", label: "CP-SAT 硬约束逐候选剪枝" },
    { tag: "可行域", value: <CountUp value={support.candidates.length} />, unit: "个", label: `可行布局 · ${optimizerStatusLabel(support.optimizer.status)}` },
    { tag: "加权排序", value: <CountUp value={dimCount} />, unit: "维", label: "TOPSIS 显式权重贴近度" },
    { tag: "制度门", value: <><CountUp value={gatePassed} /><i>/{gateTotal}</i></>, label: "Gate 通过才允许写回" },
    { tag: "采用", value: <>#<CountUp value={chosenRank ?? 0} /></>, label: "最终采用名次" },
  ];
  return <Reveal className="decision-funnel" ariaLabel="决策流水线总览">
    <div className="funnel-pipeline">{steps.map((item, index) => <Fragment key={item.tag}>
      {index > 0 && <ChevronRight size={13} className="funnel-arrow" />}
      <div className="funnel-node" style={{ animationDelay: `${index * 70}ms` }}><small>{String(index + 1).padStart(2, "0")} · {item.tag}</small><b>{item.value}{item.unit ? <i>{item.unit}</i> : null}</b><span>{item.label}</span></div>
    </Fragment>)}</div>
    <div className="funnel-track" aria-hidden="true">
      <i className="funnel-track-fill" />
      <span style={{ left: "8.3%" }}><b>{totalCombos || "—"}</b> 组合</span>
      <span style={{ left: "41.7%" }}>剪枝后 <b>{support.candidates.length}</b> 可行</span>
      <span style={{ left: "91.7%" }}>采用 <b>#{chosenRank ?? "—"}</b></span>
    </div>
    <p className="funnel-note">对比单次生成的黑盒结论：组合空间全覆盖搜索 · 约束逐条可审计 · 权重显式可查 · 结果可复现（{support.optimizer.engineVersion}）</p>
  </Reveal>;
}

function TopsisScatter({ support, chosenId, candidateId, onSelect }: {
  support: DecisionSupportView;
  chosenId: string;
  candidateId: string;
  onSelect: (candidateId: string) => void;
}) {
  const rows = [...support.actorRanking.rows].sort((a, b) => a.rank - b.rank);
  const maxPlus = Math.max(...rows.map((row) => row.distanceToIdeal), 1e-6);
  const maxMinus = Math.max(...rows.map((row) => row.distanceToWorst), 1e-6);
  const W = 320, H = 218, padL = 30, padR = 14, padT = 14, padB = 30;
  const x = (dMinus: number) => padL + (dMinus / maxMinus) * (W - padL - padR);
  const y = (dPlus: number) => H - padB - (dPlus / maxPlus) * (H - padT - padB);
  const contours = [0.25, 0.5, 0.75].map((c) => {
    const m = (1 - c) / c;
    const endMinus = Math.min(maxMinus, maxPlus / m);
    return { c, x2: x(endMinus), y2: y(m * endMinus) };
  });
  return <div className="topsis-scatter">
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="TOPSIS 距离几何图">
      <line x1={padL} y1={H - padB} x2={W - padR} y2={H - padB} className="scatter-axis" />
      <line x1={padL} y1={padT} x2={padL} y2={H - padB} className="scatter-axis" />
      {contours.map((line) => <g key={line.c}>
        <line x1={x(0)} y1={y(0)} x2={line.x2} y2={line.y2} className="scatter-contour" />
        <text x={line.x2 - 2} y={line.y2 - 3} className="scatter-contour-label">C={line.c}</text>
      </g>)}
      <text x={W - padR} y={H - 8} className="scatter-axis-label" textAnchor="end">距负理想解 D− →</text>
      <text x={padL - 6} y={padT + 2} className="scatter-axis-label" textAnchor="end" transform={`rotate(-90 ${padL - 6} ${padT + 2})`}>距理想解 D+ ↑</text>
      <text x={W - padR - 4} y={H - padB - 6} className="scatter-ideal-label" textAnchor="end">理想解方向 ↘</text>
      {rows.map((row, index) => {
        const candidate = support.candidates.find((item) => item.candidateId === row.candidateId);
        const isChosen = row.candidateId === chosenId;
        const isConsensus = row.candidateId === support.consensusCandidateId;
        const isActive = row.candidateId === candidateId;
        const cx = x(row.distanceToWorst), cy = y(row.distanceToIdeal);
        return <g key={row.candidateId} style={{ animationDelay: `${180 + index * 70}ms` }} className={`scatter-point ${isChosen ? "chosen" : ""} ${isConsensus ? "consensus" : ""} ${isActive ? "active" : ""}`} onClick={() => onSelect(row.candidateId)}>
          <title>{profileLabels[candidate?.profileId ?? ""] ?? "候选方案"} · 第 {row.rank} 名 · D+ {row.distanceToIdeal.toFixed(3)} · D− {row.distanceToWorst.toFixed(3)}</title>
          {isActive && <circle cx={cx} cy={cy} r={13} className="scatter-ring" />}
          <circle cx={cx} cy={cy} r={9} className="scatter-dot" />
          <text x={cx} y={cy + 2.5} className="scatter-rank" textAnchor="middle">{row.rank}</text>
          <text x={cx} y={cy + 20} className="scatter-score" textAnchor="middle">{(row.closeness * 100).toFixed(1)}</text>
        </g>;
      })}
    </svg>
    <div className="scatter-legend"><span><i className="dot chosen" />本行动采用</span><span><i className="dot consensus" />跨角色共识</span><span>虚线 = 等贴近度 C（越靠右下越优）</span></div>
  </div>;
}

function CandidateRadar({ support, chosenId }: { support: DecisionSupportView; chosenId: string }) {
  const dims = Object.keys(support.actorRanking.weights);
  const directions = support.actorRanking.directions;
  const ranges = dims.map((dim) => {
    const values = support.candidates.map((candidate) => candidate.dimensions[dim] ?? 0);
    return { dim, min: Math.min(...values), max: Math.max(...values) };
  });
  const norm = (candidate: DecisionCandidateView, dim: string) => {
    const range = ranges.find((item) => item.dim === dim);
    if (!range || range.max === range.min) return 0.6;
    const raw = ((candidate.dimensions[dim] ?? 0) - range.min) / (range.max - range.min);
    return directions[dim] === "cost" ? 1 - raw : raw;
  };
  const W = 300, H = 236, cx = W / 2, cy = 114, R = 70;
  const point = (index: number, value: number) => {
    const angle = -Math.PI / 2 + (index * 2 * Math.PI) / dims.length;
    const r = R * (0.12 + 0.88 * value);
    return [cx + r * Math.cos(angle), cy + r * Math.sin(angle)] as const;
  };
  const polygon = (candidate: DecisionCandidateView) => dims.map((dim, index) => point(index, norm(candidate, dim)).join(",")).join(" ");
  const series = [...support.candidates].sort((a, b) => (a.candidateId === chosenId ? 1 : 0) - (b.candidateId === chosenId ? 1 : 0) || (a.candidateId === support.consensusCandidateId ? 1 : 0) - (b.candidateId === support.consensusCandidateId ? 1 : 0));
  return <div className="candidate-radar">
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="候选方案多维雷达图">
      {[0.25, 0.5, 0.75, 1].map((ring) => <polygon key={ring} points={dims.map((_, index) => point(index, ring).join(",")).join(" ")} className="radar-ring" />)}
      {dims.map((dim, index) => {
        const [x2, y2] = point(index, 1);
        const [lx, ly] = point(index, 1.24);
        const anchor = Math.abs(lx - cx) < 8 ? "middle" : lx > cx ? "start" : "end";
        return <g key={dim}>
          <line x1={cx} y1={cy} x2={x2} y2={y2} className="radar-axis" />
          <text x={lx} y={ly + 2} textAnchor={anchor} className="radar-label">{decisionDimensionLabels[dim] ?? presentationTerm(dim)}</text>
        </g>;
      })}
      {series.map((candidate) => {
        const isChosen = candidate.candidateId === chosenId;
        const isConsensus = candidate.candidateId === support.consensusCandidateId;
        return <polygon key={candidate.candidateId} points={polygon(candidate)} className={`radar-series ${isChosen ? "chosen" : isConsensus ? "consensus" : ""}`}><title>{profileLabels[candidate.profileId] ?? presentationTerm(candidate.profileId)}</title></polygon>;
      })}
    </svg>
    <div className="scatter-legend"><span><i className="line chosen" />本行动采用</span><span><i className="line consensus" />跨角色共识</span><span><i className="line other" />其他候选（成本维度已反向，越靠外越优）</span></div>
  </div>;
}

function DimensionHeatmap({ support, chosenId }: { support: DecisionSupportView; chosenId: string }) {
  const dims = Object.entries(support.actorRanking.weights).sort(([, a], [, b]) => b - a);
  const rows = [...support.actorRanking.rows].sort((a, b) => a.rank - b.rank);
  const ranges = dims.map(([dim]) => {
    const values = support.candidates.map((candidate) => candidate.dimensions[dim] ?? 0);
    return { dim, min: Math.min(...values), max: Math.max(...values) };
  });
  const contribution = (candidateId: string, dim: string, weight: number) => {
    const candidate = support.candidates.find((item) => item.candidateId === candidateId);
    const range = ranges.find((item) => item.dim === dim);
    if (!candidate || !range || range.max === range.min) return weight * 0.6;
    const raw = ((candidate.dimensions[dim] ?? 0) - range.min) / (range.max - range.min);
    return weight * (support.actorRanking.directions[dim] === "cost" ? 1 - raw : raw);
  };
  const maxContribution = Math.max(...rows.flatMap((row) => dims.map(([dim, weight]) => contribution(row.candidateId, dim, weight))), 1e-6);
  return <div className="dim-heatmap" role="table" aria-label="维度加权贡献热力图" style={{ "--heat-cols": rows.length } as CSSProperties}>
    <div className="heatmap-row heatmap-head" role="row">
      <span className="heatmap-dim">维度 ↓ / 候选 →</span>
      {rows.map((row) => { const candidate = support.candidates.find((item) => item.candidateId === row.candidateId); return <span key={row.candidateId} className={`heatmap-cand ${row.candidateId === chosenId ? "chosen" : ""}`}>{profileLabels[candidate?.profileId ?? ""] ?? "候选方案"}<small>#{row.rank}{row.candidateId === chosenId ? " · 采用" : row.candidateId === support.consensusCandidateId ? " · 共识" : ""}</small></span>; })}
    </div>
    {dims.map(([dim, weight], dimIndex) => <div className="heatmap-row heatmap-data-row" role="row" key={dim} style={{ animationDelay: `${220 + dimIndex * 45}ms` }}>
      <span className="heatmap-dim">{decisionDimensionLabels[dim] ?? presentationTerm(dim)}<small>{Math.round(weight * 100)}% · {support.actorRanking.directions[dim] === "cost" ? "越低越好" : "越高越好"}</small></span>
      {rows.map((row) => {
        const value = contribution(row.candidateId, dim, weight);
        const alpha = 0.07 + 0.85 * (value / maxContribution);
        return <span key={row.candidateId} className={`heatmap-cell ${row.candidateId === chosenId ? "chosen" : ""}`} style={{ background: `rgba(199, 154, 66, ${alpha.toFixed(3)})` }} title={`${decisionDimensionLabels[dim] ?? presentationTerm(dim)} · 加权贡献 ${(value * 100).toFixed(1)}`}><CountUp value={value * 100} /></span>;
      })}
    </div>)}
  </div>;
}

function DecisionEvidenceWorkspace({ fixture, activeStepIndex, onOpenStep, onShowRedline }: { fixture: CityScopeDemoFixture; activeStepIndex: number; onOpenStep: () => void; onShowRedline: () => void }) {
  const requestedStep = fixture.baseline.steps[activeStepIndex] ?? fixture.baseline.steps[0];
  const supportedSteps = fixture.baseline.steps.map((step, index) => ({ step, index, support: decisionSupportFor(fixture, step) })).filter((item): item is { step: DemoStep; index: number; support: DecisionSupportView } => Boolean(item.support));
  const selected = supportedSteps.find((item) => item.step.candidate.actionId === requestedStep?.candidate.actionId) ?? supportedSteps[0];
  const [candidateId, setCandidateId] = useState("");
  useEffect(() => {
    if (selected) setCandidateId(selectedCandidateId(selected.step, selected.support));
  }, [selected?.step.candidate.actionId]);
  if (!selected) return <div className="surface-content algorithm-empty"><h2>本行动由确定性规则直接处理</h2><p>请选择政策形成、审计、企业决策或社会反馈行动，查看 CP-SAT 与 TOPSIS 证据。</p></div>;

  const { step, support } = selected;
  const actor = fixture.actorRegistry.find((item) => item.agentId === step.actorId);
  const chosenId = selectedCandidateId(step, support);
  const currentCandidate = support.candidates.find((candidate) => candidate.candidateId === candidateId) ?? support.candidates.find((candidate) => candidate.candidateId === chosenId) ?? support.candidates[0];
  const ranked = [...support.actorRanking.rows].sort((a, b) => a.rank - b.rank);
  const topWeights = Object.entries(support.actorRanking.weights).sort(([, a], [, b]) => b - a);
  const chosenRank = ranked.find((row) => row.candidateId === chosenId);
  const gatePassed = step.receipt.gateResults.filter((gate) => gate.passed).length;
  const engineName = support.optimizer.engine === "ortools-cp-sat" ? "OR-Tools CP-SAT" : "可行域穷举验证器";

  return <div className="surface-content algorithm-evidence">
    <header className="algorithm-title"><div><p>当前决策 · {phaseLabels[step.phase] ?? presentationTerm(step.phase)}</p><h2>{actor?.displayName ?? presentationTerm(step.actorId)}</h2></div><span>{step.generationSource === "model" ? "DeepSeek · OR-Tools 实时证据" : support.optimizer.engine === "ortools-cp-sat" ? "OR-Tools 9.14 · 可复现证据" : "签名演示证据"}</span></header>
    {selected.index !== activeStepIndex && <p className="algorithm-context-note">当前行动没有调用布局算法，已自动定位到最近一条完整算法证据：第 {selected.index + 1} 个行动。</p>}

    <DecisionFunnel support={support} currentCandidate={currentCandidate} chosenRank={chosenRank?.rank} gatePassed={gatePassed} gateTotal={step.receipt.gateResults.length} />

    <Reveal className="algorithm-stage feasible-stage">
      <header><span>01</span><div><small>硬约束可行域</small><h3>{engineName} 生成 {support.candidates.length} 个可行布局</h3></div><strong><Check size={12} />{optimizerStatusLabel(support.optimizer.status)}</strong></header>
      <div className="optimizer-proof"><p><b><CountUp value={support.candidates.length} /></b><span>互异候选</span></p><p><b><CountUp value={currentCandidate?.constraintEvidence.length ?? 0} /></b><span>约束检查</span></p><p><b>{currentCandidate ? <CountUp value={currentCandidate.investmentMillionCny} /> : "—"}</b><span>百万元投资</span></p><small>{support.optimizer.engineVersion}<br />{support.optimizer.diagnostics.map((item) => cleanNarrative(item, 48)).join(" · ")}</small></div>
      <div className="candidate-strip">{ranked.map((row) => {
        const candidate = support.candidates.find((item) => item.candidateId === row.candidateId);
        if (!candidate) return null;
        const isChosen = row.candidateId === chosenId;
        return <button type="button" key={row.candidateId} className={`${candidateId === row.candidateId ? "active" : ""} ${isChosen ? "chosen" : ""}`} onClick={() => setCandidateId(row.candidateId)}>
          <header><i>#{row.rank}</i><small>{profileLabels[candidate.profileId] ?? presentationTerm(candidate.profileId)}</small>{isChosen && <em>本行动采用</em>}</header>
          <strong><CountUp value={Math.round(row.closeness * 100)} /><i>/100</i></strong>
          <div className="mini-bar"><b style={{ width: `${Math.round(row.closeness * 100)}%` }} /></div>
          <div className="mini-map">{Object.entries(candidate.assignments).map(([fn, city]) => <span key={fn} className={city === "chengdu" || city === "chongqing" ? city : ""}><i />{functionLabels[fn] ?? presentationTerm(fn)}·{city === "chengdu" ? "成都" : city === "chongqing" ? "重庆" : "不建"}</span>)}</div>
        </button>;
      })}</div>
      {currentCandidate && <div className="candidate-detail"><div className="function-map">{Object.entries(currentCandidate.assignments).map(([fn, city]) => <p key={fn}><span>{functionLabels[fn] ?? presentationTerm(fn)}</span><i /> <strong className={city}>{city === "chengdu" ? "成都" : city === "chongqing" ? "重庆" : "本期不建"}</strong></p>)}</div><div className="resource-compare"><header><span>资源占用</span><b>成都</b><b>重庆</b></header>{[["财政 / 百万", "fiscalMillionCny"], ["土地 / 公顷", "landHectares"], ["能源 / MW", "energyMw"], ["人才住房 / 套", "talentHousingUnits"]].map(([label, key]) => <p key={key}><span>{label}</span><b>{currentCandidate.cityResources.chengdu[key as keyof typeof currentCandidate.cityResources.chengdu]}</b><b>{currentCandidate.cityResources.chongqing[key as keyof typeof currentCandidate.cityResources.chongqing]}</b></p>)}</div></div>}
    </Reveal>

    <Reveal className="algorithm-stage topsis-stage">
      <header><span>02</span><div><small>多目标排序</small><h3>同一批方案，{actor?.displayName ?? presentationTerm(step.actorId)} 有自己的权重</h3></div><strong>采用第 {chosenRank?.rank ?? "—"} 名 · {chosenRank ? <CountUp value={chosenRank.closeness * 100} decimals={1} /> : "—"} 分</strong></header>
      <div className="topsis-body"><div className="weight-list">{topWeights.map(([dimension, weight], weightIndex) => <p key={dimension} style={{ animationDelay: `${weightIndex * 60}ms` }}><span>{decisionDimensionLabels[dimension] ?? presentationTerm(dimension)}<small>{support.actorRanking.directions[dimension] === "cost" ? "越低越好" : "越高越好"}</small></span><i><b style={{ width: `${weight * 100 / (topWeights[0]?.[1] ?? 1)}%` }} /></i><strong><CountUp value={Math.round(weight * 100)} suffix="%" /></strong></p>)}</div><TopsisScatter support={support} chosenId={chosenId} candidateId={currentCandidate?.candidateId ?? chosenId} onSelect={setCandidateId} /></div>
      <p className="algorithm-reasoning">{cleanNarrative(step.candidate.reasoning)}</p>
    </Reveal>

    <Reveal className="algorithm-stage compare-stage">
      <header><span>03</span><div><small>多维画像对比</small><h3>10 个维度上，每个候选的强项与代价一目了然</h3></div><strong>雷达图 · 加权贡献热力图</strong></header>
      <div className="compare-body"><CandidateRadar support={support} chosenId={chosenId} /><DimensionHeatmap support={support} chosenId={chosenId} /></div>
    </Reveal>

    <Reveal className="algorithm-stage execution-stage">
      <header><span>04</span><div><small>制度执行</small><h3>算法只给证据，规则门决定能否改变世界</h3></div><strong>{gatePassed}/{step.receipt.gateResults.length} Gate 通过</strong></header>
      <div className="execution-line"><div>{step.receipt.gateResults.map((gate) => <span className={gate.passed ? "pass" : "fail"} key={gate.gate}>{gate.passed ? <Check size={11} /> : <X size={11} />}{presentationTerm(gate.gate)}</span>)}</div><ChevronRight size={14} /><p><b>{receiptStatusLabel(step.receipt.status)}</b><small>{step.receipt.deltas.length} 项状态变化</small></p></div>
      <div className="execution-actions"><button type="button" onClick={onOpenStep}>查看 causeId 与 before/after</button><button type="button" onClick={onShowRedline}>查看被 Gate 拒绝的方案</button></div>
    </Reveal>
  </div>;
}

function EvidenceLayerSurface({ fixture, activeStepIndex, mode, onMode, onOpenStep, onShowRedline, liveResult, liveStatus, liveError, onReplayDivergence, onBackToWorld }: {
  fixture: CityScopeDemoFixture;
  activeStepIndex: number;
  mode: EvidenceMode;
  onMode: (mode: EvidenceMode) => void;
  onOpenStep: () => void;
  onShowRedline: () => void;
  liveResult?: LiveForkResult;
  liveStatus: "idle" | "running" | "completed" | "failed";
  liveError?: string;
  onReplayDivergence: () => void;
  onBackToWorld: () => void;
}) {
  return <div className="evidence-layer-shell">
    <div className="layer-switch" role="tablist" aria-label="证据层视图">
      <button type="button" role="tab" aria-selected={mode === "trace"} className={mode === "trace" ? "active" : ""} onClick={() => onMode("trace")}><ScanLine size={14} />决策证据</button>
      <button type="button" role="tab" aria-selected={mode === "fork"} className={mode === "fork" ? "active" : ""} onClick={() => onMode("fork")}><GitFork size={14} />双世界对照</button>
    </div>
    {mode === "fork" ? <ForkSurface fixture={fixture} liveResult={liveResult} liveStatus={liveStatus} liveError={liveError} onReplayDivergence={onReplayDivergence} onBack={onBackToWorld} /> : <DecisionEvidenceWorkspace fixture={fixture} activeStepIndex={activeStepIndex} onOpenStep={onOpenStep} onShowRedline={onShowRedline} />}
  </div>;
}

function SurfacePanel({ surface, fixture, focusCity, activeStepIndex, evidenceMode, onEvidenceMode, onShowRedline, onOpenStep, onSelectActor, onOpenEvidence, liveResult, liveStatus, liveError, onReplayDivergence, onBackToWorld }: {
  surface: Surface;
  fixture: CityScopeDemoFixture;
  focusCity?: "chengdu" | "chongqing";
  activeStepIndex: number;
  evidenceMode: EvidenceMode;
  onEvidenceMode: (mode: EvidenceMode) => void;
  onShowRedline: () => void;
  onOpenStep: () => void;
  onSelectActor: (actorId: string) => void;
  onOpenEvidence: () => void;
  liveResult?: LiveForkResult;
  liveStatus: "idle" | "running" | "completed" | "failed";
  liveError?: string;
  onReplayDivergence: () => void;
  onBackToWorld: () => void;
}) {
  if (surface === "organization") return <OrganizationSurface fixture={fixture} focusCity={focusCity} onSelectActor={onSelectActor} onOpenEvidence={onOpenEvidence} />;
  if (surface === "evidence") return <EvidenceLayerSurface fixture={fixture} activeStepIndex={activeStepIndex} mode={evidenceMode} onMode={onEvidenceMode} onOpenStep={onOpenStep} onShowRedline={onShowRedline} liveResult={liveResult} liveStatus={liveStatus} liveError={liveError} onReplayDivergence={onReplayDivergence} onBackToWorld={onBackToWorld} />;
  return null;
}

export function App() {
  const [health, setHealth] = useState(defaultHealth);
  const [fixture, setFixture] = useState<CityScopeDemoFixture>();
  const [surface, setSurface] = useState<Surface>(() => {
    const param = new URLSearchParams(window.location.search).get("surface");
    return param === "organization" || param === "evidence" ? param : "world";
  });
  const [evidenceMode, setEvidenceMode] = useState<EvidenceMode>("trace");
  const [selectedVisualKey, setSelectedVisualKey] = useState("visual-project-core");
  const [renderMode, setRenderMode] = useState<"webgl" | "fallback">(() => new URLSearchParams(window.location.search).get("render") === "webgl" ? "webgl" : "fallback");
  const [performanceSample, setPerformanceSample] = useState<PerformanceSample>({ fps: 0, drawCalls: 0, triangles: 0 });
  const [selection, setSelection] = useState<EvidenceSelection>();
  const [selectedActor, setSelectedActor] = useState<string>();
  const [selectedCity, setSelectedCity] = useState<"chengdu" | "chongqing">();
  const [activeStepIndex, setActiveStepIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [professionalMode, setProfessionalMode] = useState(false);
  const [introOpen, setIntroOpen] = useState(true);
  const [setupOpen, setSetupOpen] = useState(false);
  const [plannedPath, setPlannedPath] = useState<LiveForkRequest["path"]>("metrics.financingConfidence");
  const [plannedAdjustment, setPlannedAdjustment] = useState(-20);
  const [activeWorld, setActiveWorld] = useState<"baseline" | "intervention">("intervention");
  const [liveProgress, setLiveProgress] = useState<LiveForkProgress>();
  const [liveResult, setLiveResult] = useState<LiveForkResult>();
  const [liveStatus, setLiveStatus] = useState<"idle" | "running" | "completed" | "failed">("idle");
  const [liveError, setLiveError] = useState<string>();
  const [recapOpen, setRecapOpen] = useState(false);
  const [visualPhase, setVisualPhase] = useState<VisualSequencePhase>("orientation");
  const [actorAnchors, setActorAnchors] = useState<Record<string, { left: number; top: number }>>({});
  const lowFpsSamples = useRef(0);
  const displayFixture = useMemo<CityScopeDemoFixture | undefined>(() => {
    if (!fixture) return fixture;
    if (liveProgress && !liveResult) {
      const baselineWorld = activeWorld === "baseline";
      const selectedState = baselineWorld ? liveProgress.baselineState : liveProgress.forkState;
      return {
        ...fixture,
        baseline: {
          ...fixture.baseline,
          runId: selectedState.runId,
          provider: selectedState.snapshot.provider,
          model: selectedState.snapshot.model,
          terminalState: selectedState,
          steps: baselineWorld ? liveProgress.baselineSteps : liveProgress.forkSteps,
        },
      };
    }
    if (!liveResult) return fixture;
    const baselineWorld = activeWorld === "baseline";
    return {
      ...fixture,
      baseline: {
        ...fixture.baseline,
        runId: baselineWorld ? liveResult.baselineState.runId : liveResult.forkState.runId,
        provider: liveResult.provider,
        model: liveResult.model,
        terminalState: baselineWorld ? liveResult.baselineState : liveResult.forkState,
        steps: baselineWorld ? liveResult.baselineSteps : liveResult.forkSteps,
        classification: baselineWorld ? liveResult.baselineOutcome : liveResult.forkOutcome,
      },
    };
  }, [activeWorld, fixture, liveProgress, liveResult]);

  useEffect(() => {
    Promise.all([cityScopeAdapter.health(), cityScopeAdapter.loadDemo()]).then(([nextHealth, nextFixture]) => {
      setHealth(nextHealth); setFixture(nextFixture);
    }).catch((error) => setHealth({ ...defaultHealth, message: error instanceof Error ? error.message : "数据加载失败" }));
    try {
      const canvas = document.createElement("canvas");
      if (!canvas.getContext("webgl2") && !canvas.getContext("webgl")) setRenderMode("fallback");
    } catch { setRenderMode("fallback"); }
  }, []);

  useEffect(() => {
    setPlannedAdjustment(interventionControls[plannedPath].defaultAdjustment);
  }, [plannedPath]);

  useEffect(() => {
    const closeFloatingPanels = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setSelection(undefined);
      setSelectedActor(undefined);
      setRecapOpen(false);
    };
    window.addEventListener("keydown", closeFloatingPanels);
    return () => window.removeEventListener("keydown", closeFloatingPanels);
  }, []);

  useEffect(() => {
    if (!isPlaying || !displayFixture) return;
    const currentStep = displayFixture.baseline.steps[activeStepIndex];
    const timer = window.setTimeout(() => {
      setActiveStepIndex((index) => {
        const next = index + 1;
        if (next >= displayFixture.baseline.steps.length) {
          setIsPlaying(false);
          return index;
        }
        const step = displayFixture.baseline.steps[next];
        setVisualPhase(phaseVisual(step.phase, step.candidate.kind));
        return next;
      });
    }, readableStepDelay(currentStep));
    return () => window.clearTimeout(timer);
  }, [activeStepIndex, displayFixture, isPlaying]);

  const handlePerformance = useCallback((sample: PerformanceSample) => {
    setPerformanceSample(sample);
    lowFpsSamples.current = sample.fps > 0 && sample.fps < 26 ? lowFpsSamples.current + 1 : 0;
    if (lowFpsSamples.current >= 3) setRenderMode("fallback");
  }, []);

  const organizationLayer = useMemo(() => {
    if (!displayFixture || surface !== "organization") return undefined;
    const actors = new Map(displayFixture.actorRegistry.map((actor) => [actor.agentId, actor]));
    return {
      groups: organizationGroupDefs
        .filter((def) => !(selectedCity === "chengdu" && def.name === "重庆两江新区") && !(selectedCity === "chongqing" && def.name === "成都高新区"))
        .map((def): OrganizationLayerGroup => ({
          name: def.name,
          tone: def.tone,
          anchor: def.anchor,
          members: def.ids.map((id) => actors.get(id)).filter((actor): actor is NonNullable<typeof actor> => Boolean(actor)).map((actor) => ({ actorId: actor.agentId, displayName: actor.displayName, role: actor.role, actorKind: actor.actorKind })),
        })),
    };
  }, [displayFixture, surface, selectedCity]);

  const demoChapters = useMemo(() => {
    if (!displayFixture) return [];
    const find = (predicate: (step: DemoStep) => boolean) => Math.max(0, displayFixture.baseline.steps.findIndex(predicate));
    return [
      { label: "01 双城开局", index: 0, phase: "orientation" as const },
      { label: "02 部门制衡", index: find((step) => step.phase === "policy_formation"), phase: "constructing" as const },
      { label: "03 红线拦截", index: -1, phase: "paused" as const },
      { label: "04 风险披露", index: find((step) => step.candidate.kind === "DISCLOSE_FACT"), phase: "reorganizing" as const },
      { label: "05 董事会重议", index: find((step) => step.phase === "post_disclosure" && step.actorId === "company_board"), phase: "reorganizing" as const },
      { label: "06 Fork 未来", index: displayFixture.baseline.steps.length - 1, phase: "constructing" as const },
    ];
  }, [displayFixture]);

  const activateChapter = (chapter: (typeof demoChapters)[number]) => {
    setVisualPhase(chapter.phase);
    if (chapter.index < 0) setSelection({ kind: "redline" }); else setSelection({ kind: "step", index: chapter.index });
    if (chapter.label.includes("Fork")) { setEvidenceMode("fork"); setSurface("evidence"); } else setSurface("world");
  };

  const runLiveFork = async (request: LiveForkRequest) => {
    setLiveStatus("running");
    setLiveError(undefined);
    setLiveResult(undefined);
    setLiveProgress(undefined);
    setRecapOpen(false);
    setSetupOpen(false);
    setIntroOpen(false);
    setSurface("world");
    setProfessionalMode(false);
    setActiveWorld("intervention");
    setActiveStepIndex(0);
    try {
      const result = await cityScopeAdapter.runLiveFork(request, (progress) => {
        setLiveProgress(progress);
        setActiveStepIndex(Math.max(0, progress.forkSteps.length - 1));
        setVisualPhase(phaseVisual(progress.completedPhase ?? "", progress.forkSteps.at(-1)?.candidate.kind));
      });
      setLiveResult(result);
      setLiveProgress(undefined);
      setLiveStatus("completed");
      setActiveStepIndex(Math.max(0, result.forkSteps.length - 1));
      setProfessionalMode(true);
      setSelectedVisualKey("visual-project-core");
      setVisualPhase(result.forkOutcome.label === "PROJECT_EXITED" ? "reorganizing" : "constructing");
    } catch (error) {
      setLiveStatus("failed");
      setLiveError(error instanceof Error ? error.message : "现场续跑失败");
    }
  };

  const plannedRequest: LiveForkRequest = {
    path: plannedPath,
    adjustment: plannedAdjustment,
    adjustmentMode: interventionControls[plannedPath].mode,
    reason: `初始实验条件：${adjustmentLabel(plannedPath, plannedAdjustment)}`,
  };
  const replayFirstDivergence = () => {
    if (!liveResult) return;
    const divergence = firstDivergence(liveResult.baselineSteps, liveResult.forkSteps);
    setRecapOpen(false);
    setSurface("world");
    setActiveWorld("intervention");
    setIsPlaying(false);
    setActiveStepIndex(divergence?.index ?? 0);
  };
  const state = displayFixture?.baseline.terminalState;
  const activeOutcome = liveStatus === "running" ? undefined : displayFixture?.baseline.classification;
  const activeSemanticEffects = useMemo(() => {
    const baseline = fixture?.baseline.semanticEffects;
    if (!baseline || !liveResult) return baseline;
    const selectedOutcome = activeWorld === "baseline" ? liveResult.baselineOutcome : liveResult.forkOutcome;
    const projectTendency = ({
      CHENGDU_LED: "chengdu_research",
      CHONGQING_LED: "chongqing_manufacturing",
      DUAL_CITY: "dual_city_split",
      PROJECT_EXITED: "exit_risk",
    } as const)[selectedOutcome.label] ?? baseline.projectTendency;
    return { ...baseline, projectTendency };
  }, [activeWorld, fixture, liveResult]);
  const quality = renderMode === "fallback" ? "2.5D VECTOR" : performanceSample.fps > 0 && performanceSample.fps < 30 ? "AUTO LOW" : "WEBGL";
  const fiscalPressure = (city: "chengdu" | "chongqing") => {
    const ledger = state?.cities[city].resourceLedger.fiscalMillionCny;
    return ledger ? Math.round(((ledger.capacity - ledger.available) / ledger.capacity) * 100) : 0;
  };
  const activeStep = displayFixture?.baseline.steps[activeStepIndex];
  const activeActor = displayFixture?.actorRegistry.find((actor) => actor.agentId === activeStep?.actorId);
  const liveTimeline = Boolean(liveResult || liveProgress);
  const tokenInsufficient = liveStatus === "failed" && isTokenCapacityError(liveError);
  const activeCompetition = liveProgress
    ? activeWorld === "baseline" ? liveProgress.baselineCompetition : liveProgress.forkCompetition
    : liveResult
      ? activeWorld === "baseline" ? liveResult.baselineCompetition : liveResult.forkCompetition
      : undefined;
  const runtimeStatus = tokenInsufficient
    ? "Token 不足"
    : liveStatus === "running"
    ? `${health.model ?? "DeepSeek"} · 推演中`
    : liveTimeline
      ? `${liveResult?.model ?? "DeepSeek"} · LIVE`
      : health.mode === "live"
        ? `${health.model ?? "DeepSeek"} · 已连接`
        : "SIGNED FIXTURE";

  return <main className={`app-shell ${professionalMode ? "professional-mode" : "presentation-mode"}`}>
    <header className="floating-chrome">
      <nav className="surface-nav" aria-label="三个核心图层">{surfaces.map((item) => { const Icon = item.icon; return <button type="button" key={item.id} className={surface === item.id ? "active" : ""} onClick={() => { setSelectedActor(undefined); setSelection(undefined); if (item.id === "organization") setSelectedCity(undefined); if (item.id === "evidence") setEvidenceMode("trace"); setSurface(item.id); }}><Icon size={15} />{item.label}</button>; })}</nav>
      <div />
      <div className="header-actions"><span className={`quiet-status ${liveTimeline || liveStatus === "running" ? "live" : ""} ${tokenInsufficient ? "token-insufficient" : ""}`} title={tokenInsufficient ? liveError : health.message}><i className={health.ready && !tokenInsufficient ? "ready" : ""} />{runtimeStatus}</span><button className="pro-toggle active" type="button" disabled={liveStatus === "running"} onClick={() => { if (liveStatus === "completed" && displayFixture) { setSurface("world"); setActiveStepIndex(0); setIsPlaying(true); return; } setSetupOpen(true); setIntroOpen(false); }}><Sparkles size={14} />{liveStatus === "running" ? "双世界推演中" : liveStatus === "completed" ? "重播双世界轨迹" : "设置条件并开始推演"}</button></div>
    </header>

    <section className="workspace" id="workspace">
      {fixture && introOpen && <OpeningBrief fixture={fixture} onContinue={() => { setIntroOpen(false); setSetupOpen(true); }} />}
      {fixture && setupOpen && <InterventionSetup fixture={fixture} path={plannedPath} value={plannedAdjustment} error={liveError} onPath={setPlannedPath} onValue={setPlannedAdjustment} onClose={() => setSetupOpen(false)} onStart={() => runLiveFork(plannedRequest)} />}
      {displayFixture && (surface === "evidence" || (surface === "organization" && renderMode !== "fallback")) ? (
        <section className="surface-page" aria-label={surface === "evidence" ? "证据层视图" : "组织剖面视图"}>
          <SurfacePanel surface={surface} fixture={displayFixture} focusCity={selectedCity} activeStepIndex={activeStepIndex} evidenceMode={evidenceMode} onEvidenceMode={setEvidenceMode} onShowRedline={() => setSelection({ kind: "redline" })} onOpenStep={() => setSelection({ kind: "step", index: activeStepIndex })} onSelectActor={setSelectedActor} onOpenEvidence={() => { setEvidenceMode("trace"); setSurface("evidence"); }} liveResult={liveResult} liveStatus={liveStatus} liveError={liveError} onReplayDivergence={replayFirstDivergence} onBackToWorld={() => setSurface("world")} />
        </section>
      ) : (
        <div className="world-stage">
          {renderMode === "webgl" ? <VisualErrorBoundary><Suspense fallback={<div className="scene-skeleton"><span /><strong>加载双城沙盘</strong><small>业务数据已独立校验</small></div>}>
            <CitySandbox selectedVisualKey={selectedVisualKey} visualPhase={visualPhase} semanticEffects={activeSemanticEffects} activeActorId={liveTimeline ? activeStep?.actorId : undefined} onSelectVisualKey={setSelectedVisualKey} onSelectActor={(actorId) => { setSelection(undefined); setSelectedActor(actorId); }} onPerformance={handlePerformance} />
          </Suspense></VisualErrorBoundary> : <FallbackTwin activeActorId={surface === "organization" || !liveTimeline ? undefined : activeStep?.actorId} organizationLayer={organizationLayer} onAnchorPositions={setActorAnchors} onDeselectActor={() => { setSelectedActor(undefined); setSelection(undefined); }} onSelectVisualKey={setSelectedVisualKey} onSelectActor={(actorId) => { setSelection(undefined); setSelectedActor(actorId); }} />}

          {surface === "organization" && displayFixture && organizationLayer && <div className="stage-caption">
            <h2>{selectedCity ? `${selectedCity === "chengdu" ? "成都高新区" : "重庆两江新区"}如何形成一份政策` : "14 个角色，2 套确定性服务"}</h2>
            <span>箭头指向接收方 · 实线为正式权责 · 虚线为建议或事实输入</span>
            <button type="button" onClick={() => { setEvidenceMode("trace"); setSurface("evidence"); }}>证据 <ChevronRight size={12} /></button>
          </div>}

          {surface === "world" && <>
            {displayFixture && <><CityActionRail city="chengdu" fixture={displayFixture} activeStepIndex={activeStepIndex} fiscalPressure={fiscalPressure("chengdu")} onOpenOrganization={() => { setSelectedCity("chengdu"); setSurface("organization"); }} onOpenEvidence={(index) => setSelection({ kind: "step", index })} /><CityActionRail city="chongqing" fixture={displayFixture} activeStepIndex={activeStepIndex} fiscalPressure={fiscalPressure("chongqing")} onOpenOrganization={() => { setSelectedCity("chongqing"); setSurface("organization"); }} onOpenEvidence={(index) => setSelection({ kind: "step", index })} /></>}

            {displayFixture && !liveResult && <CompetitionBelt fixture={displayFixture} activeStepIndex={activeStepIndex} live={liveStatus === "running"} competition={activeCompetition} onOpenEvidence={(index) => setSelection({ kind: "step", index })} />}

            {displayFixture && liveTimeline && activeStep?.phase === "coordination_debate"
              ? <CoordinationDebateStage fixture={displayFixture} activeStepIndex={activeStepIndex} live={liveStatus === "running"} />
              : displayFixture && liveTimeline && <MapSpeeches fixture={displayFixture} activeStepIndex={activeStepIndex} live={liveStatus === "running"} actorAnchors={actorAnchors} />}

            {liveProgress && <RunningWorldSwitcher progress={liveProgress} world={activeWorld} onWorld={(world) => { setActiveWorld(world); setActiveStepIndex(Math.max(0, (world === "baseline" ? liveProgress.baselineSteps : liveProgress.forkSteps).length - 1)); }} />}

            {liveProgress && displayFixture && liveProgress.stage === "parallel" && liveProgress.baselineSteps.length > 0 && <DivergenceNotice progress={liveProgress} fixture={displayFixture} />}

            {liveProgress && liveProgress.stage === "risk" && <RiskMilestone progress={liveProgress} />}

            {liveProgress && liveProgress.stage === "post_risk" && <PostRiskProgress progress={liveProgress} />}

            {liveResult && <BranchSwitcher result={liveResult} world={activeWorld} onWorld={(world) => { setActiveWorld(world); setActiveStepIndex(Math.max(0, (world === "baseline" ? liveResult.baselineSteps : liveResult.forkSteps).length - 1)); }} />}

            {professionalMode && <div className={`contract-banner ${health.ready ? "contract-ready" : ""} ${liveTimeline ? "live" : ""}`}>{health.ready ? <Check size={15} /> : <AlertTriangle size={15} />}<span>{liveStatus === "completed" ? `A/B 两套 DeepSeek 轨迹 · 初始单因实验已完成` : health.mode === "live" ? `${health.model} 已连接 · 等待用户设定条件` : `${displayFixture?.baseline.steps.length ?? "—"} 步签名轨迹已通过约束校验`}</span><small>12 行为 Agent · 4 规则 Service · {state?.trace.length ?? "—"} 项可追溯变化</small></div>}

            {professionalMode && liveResult && fixture && <RunSettlementBar result={liveResult} fixture={fixture} onReplayDivergence={replayFirstDivergence} onRecap={() => setRecapOpen(true)} />}
          </>}
        </div>
      )}

      {recapOpen && liveResult && fixture && <div className="run-recap-scrim" role="dialog" aria-modal="true" aria-label="本轮推演复盘"><section className="run-recap-overlay"><RunRecapContent result={liveResult} fixture={fixture} onReplayDivergence={replayFirstDivergence} onBack={() => setRecapOpen(false)} /></section></div>}

      {displayFixture && selection && <EvidenceInspector fixture={displayFixture} selection={selection} onClose={() => setSelection(undefined)} />}
      {displayFixture && selectedActor && <><div className="actor-xray-backdrop" aria-hidden="true" /><ActorXRay fixture={displayFixture} actorId={selectedActor} onClose={() => setSelectedActor(undefined)} /></>}
    </section>
  </main>;
}
