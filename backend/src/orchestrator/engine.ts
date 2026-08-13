import type { AgentAction, ApplyResult, Permission, WorldState } from "../domain.js";
import { isAgent, manifests, observe } from "../agents/manifests.js";
import { deterministicServiceAction } from "../agents/deterministic-policy.js";
import { applyAction } from "../world/reducer.js";
import { ResilientActionGenerator } from "../providers/resilient-provider.js";
import type { LLMProvider, ProviderUsage } from "../providers/types.js";
import { DecisionSupportService } from "../decision-support/service.js";
import type { DecisionSupportContext } from "../decision-support/types.js";
import { decisionViewFor } from "../agents/decision-view.js";
import { mergeProviderUsage } from "../providers/types.js";
import { governDecisionAction } from "../decision-support/action-governance.js";

export interface ActorStepResult extends ApplyResult {
  candidate: AgentAction;
  generationSource: "model" | "deterministic_stub" | "cache" | "fallback" | "deterministic_service";
  diagnostics: string[];
  usage?: ProviderUsage;
}

export class SimulationEngine {
  readonly generator: ResilientActionGenerator;
  readonly decisionSupport: DecisionSupportService;

  constructor(provider: LLMProvider, decisionSupport = new DecisionSupportService(["deepseek", "qwen"].includes(provider.id) ? "auto" : "enumerative")) {
    this.generator = new ResilientActionGenerator(provider);
    this.decisionSupport = decisionSupport;
  }

  async proposeAndApplyActor(state: WorldState, actorId: string): Promise<ActorStepResult> {
    const manifest = manifests[actorId];
    if (!manifest) throw new Error(`unknown actor ${actorId}`);
    if (manifest.actorKind === "service") {
      const candidate = deterministicServiceAction(manifest, observe(state, actorId));
      return { ...applyAction(state, candidate), candidate, generationSource: "deterministic_service", diagnostics: [] };
    }
    const decisionSupport = await this.decisionSupport.contextFor(state, actorId);
    const observation = observe(state, actorId);
    const request = {
      scenario: state.scenarioId,
      worldVersion: state.worldVersion,
      agentId: actorId,
      promptVersion: manifest.promptVersion,
      seed: state.snapshot.seed,
      schemaVersion: state.snapshot.schemaVersion,
      instruction: instructionFor(actorId, observation),
      observation,
      decisionView: decisionViewFor(observation, actorId),
      phase: state.simulation.phase,
      eligibleKinds: eligibleKinds(manifest.permissions, observation, actorId),
      ...(decisionSupport ? { decisionSupport } : {}),
    };
    const generated = await this.generator.generate(request);
    const governed = governDecisionAction(state, generated.action, decisionSupport);
    const first = applyAction(state, governed);
    attachDecisionSupport(first, governed.actionId, decisionSupport);
    if (first.receipt.status !== "REJECTED" || !["model", "cache"].includes(generated.source)) {
      return { ...first, candidate: governed, generationSource: generated.source, diagnostics: generated.diagnostics, ...(generated.usage ? { usage: generated.usage } : {}) };
    }
    this.generator.invalidate(request, false);
    const gateFeedback = first.receipt.gateResults
      .filter((result) => !result.passed)
      .map((result) => `${result.gate}:${result.code ?? "REJECTED"}:${result.reason}`)
      .join(" | ");
    const repaired = await this.generator.repairAfterGateRejection(request, governed, gateFeedback);
    const governedRepair = governDecisionAction(first.state, repaired.action, decisionSupport);
    const second = applyAction(first.state, governedRepair);
    attachDecisionSupport(second, governedRepair.actionId, decisionSupport);
    if (second.receipt.status === "REJECTED" && repaired.source !== "fallback") {
      this.generator.invalidate(request, true);
      const secondFeedback = second.receipt.gateResults
        .filter((result) => !result.passed)
        .map((result) => `${result.gate}:${result.code ?? "REJECTED"}:${result.reason}`)
        .join(" | ");
      const fallback = this.generator.deterministicFallback(request, [...generated.diagnostics, ...repaired.diagnostics, secondFeedback]);
      const third = applyAction(second.state, fallback.action);
      attachDecisionSupport(third, fallback.action.actionId, decisionSupport);
      const usage = mergeProviderUsage(generated.usage, repaired.usage);
      return { ...third, candidate: fallback.action, generationSource: fallback.source, diagnostics: fallback.diagnostics, ...(usage ? { usage } : {}) };
    }
    const usage = mergeProviderUsage(generated.usage, repaired.usage);
    return {
      ...second,
      candidate: governedRepair,
      generationSource: repaired.source,
      diagnostics: [...generated.diagnostics, ...repaired.diagnostics],
      ...(usage ? { usage } : {}),
    };
  }

  applyExternalAction(state: WorldState, action: AgentAction): ApplyResult {
    return applyAction(state, action);
  }

  runReplayActions(initial: WorldState, actions: AgentAction[]): { state: WorldState; results: ApplyResult[] } {
    let state = structuredClone(initial);
    const results: ApplyResult[] = [];
    for (const action of actions) {
      const result = applyAction(state, action);
      state = result.state;
      results.push(result);
    }
    return { state, results };
  }
}

function attachDecisionSupport(result: ApplyResult, actionId: string, support: DecisionSupportContext | undefined): void {
  if (!support) return;
  const evidence = {
    portfolioId: support.portfolioId,
    optimizer: support.optimizer,
    consensusCandidateId: support.consensusCandidateId,
    actorRanking: support.actorRanking,
    actorDecisionProfile: support.actorDecisionProfile,
    options: support.options,
    negotiation: support.negotiation,
    candidates: support.candidates,
  };
  for (const event of result.state.events) {
    if (event.causeId === actionId && (event.eventType === "AgentActionProposed" || event.eventType === "ActionRejected")) event.payload.decisionSupport = evidence;
  }
}

function instructionFor(actorId: string, state: WorldState): string {
  const manifest = manifests[actorId];
  if (!manifest || !isAgent(manifest)) throw new Error(`actor ${actorId} has no LLM prompt`);
  const cityContext = actorId.startsWith("chengdu")
    ? "成都重视研发岗位、高端人才和总部，财政支持强调分期兑现。"
    : actorId.startsWith("chongqing")
      ? "重庆重视制造产值、工厂、供应链和就业，财政支持强调产值条件。"
      : "按独立效用、红线、私有观察和已有记忆行动。";
  const boardResolution = actorId === "company_board"
    ? "风险披露后，董事会必须同时比较已审计的成都单城、重庆单城、双城分工、缩小规模和不落地方案。联合方案没有优先权；只选择自身效用最高且超过保留效用的可执行方案，否则退出。未形成四类终局之一前不得 PASS。"
    : "";
  const debateInstruction = state.simulation.phase === "coordination_debate"
    ? actorId === "regional_coordinator" && (state.debateThreads[0]?.messages.length ?? 0) >= 6
      ? "协调对话已完成六轮。基于真实消息发布正式协调意见，summary 必须在90个汉字内概括争议，concessions 必须分别记录两城让步且每项不超过45个汉字。"
      : "你正在参加有边界的成渝协调对话。必须针对 debateThreads 中上一条可见消息回应，不得复述系统字段；content 用35至70个汉字的自然中文，只陈述一个主张、质疑或让步。"
    : "";
  return [
    `你是${manifest.displayName}，actorKind=agent。`, cityContext,
    `效用：${manifest.utility.map((item) => `${item.dimension}:${item.weight}:${item.direction}`).join(", ")}。`,
    `红线：${manifest.redLines.join("；")}。`,
    `允许权限：${manifest.permissions.join(", ")}。`,
    boardResolution, debateInstruction,
    "决策边界：明显超过接受线可接受，明显低于底线必须拒绝或撤回；位于灰区时，结合私有画像、TOPSIS 排名与对话自行判断。协调方案必须与自身 BATNA 比较，不能因为协调程序已经开始就接受。",
    "reasoning 控制在90个字符内，只写决定与一个关键理由；若有 decisionSupport，仅为可追溯性写一次所选 candidateId，不得复述其他字段名、英文枚举、状态码或完整计算过程。",
    "只提出一个当前阶段合法的结构化 AgentAction 或 PASS。不得修改世界、声称执行成功、读取隐藏事实或指定结局。",
  ].filter(Boolean).join("\n");
}

const permissionKinds: Partial<Record<Permission, AgentAction["kind"][]>> = {
  recommend: ["ADVISE_POLICY", "ADVISE_COMPANY_RESPONSE"],
  maintain_city_offer: ["MAINTAIN_CITY_OFFER"],
  sign_policy: ["SUBMIT_POLICY_PACK"], sign_company_response: ["SUBMIT_COMPANY_RESPONSE"],
  withdraw_city_offer: ["WITHDRAW_CITY_OFFER"],
  request_audit: ["REQUEST_DUE_DILIGENCE"], disclose_fact: ["DISCLOSE_FACT"],
  decide_financing: ["ADVISE_FINANCING"], accept_policy: ["ACCEPT_POLICY", "REJECT_POLICY"],
  withdraw_commitment: ["WITHDRAW_COMMITMENT"], exit_project: ["EXIT_PROJECT"],
  advance_project: ["ADVANCE_PROJECT", "ASSESS_LONG_TERM_IMPACT"], publish_reaction: ["PUBLISH_STAKEHOLDER_REACTION"],
  debate: ["SEND_DEBATE_MESSAGE"], coordinate: ["ISSUE_COORDINATION_OPINION", "PROPOSE_COORDINATION_PLAN"],
  respond_coordination: ["RESPOND_COORDINATION_PLAN"], accept_coordination: ["ACCEPT_COORDINATION_PLAN"],
  audit_policy: ["AUDIT_POLICY_PACK", "AUDIT_COORDINATION_PLAN"], pass: ["PASS"],
};

function eligibleKinds(permissions: Permission[], state: WorldState, actorId: string): AgentAction["kind"][] {
  if (state.simulation.phase === "internal_advice" || state.simulation.phase === "risk_reassessment") {
    if (actorId.endsWith("_investment") || actorId.endsWith("_finance")) return ["ADVISE_POLICY"];
  }
  if (state.simulation.phase === "policy_formation" && actorId.endsWith("_leader")) return ["SUBMIT_POLICY_PACK"];
  if (state.simulation.phase === "policy_audit" && actorId === "policy_supervisor") return ["AUDIT_POLICY_PACK"];
  if (state.simulation.phase === "company_deliberation") {
    if (actorId === "company_ceo" || actorId === "company_cfo") return ["ADVISE_COMPANY_RESPONSE"];
    if (actorId === "investor") return ["ADVISE_FINANCING"];
    if (actorId === "company_board") return ["SUBMIT_COMPANY_RESPONSE"];
  }
  if (state.simulation.phase === "due_diligence" && actorId === "policy_supervisor") return ["REQUEST_DUE_DILIGENCE"];
  if (state.simulation.phase === "coordination_debate") {
    const messageCount = state.debateThreads[0]?.messages.length ?? 0;
    return actorId === "regional_coordinator" && messageCount >= 6 ? ["PROPOSE_COORDINATION_PLAN", "ISSUE_COORDINATION_OPINION"] : ["SEND_DEBATE_MESSAGE"];
  }
  if (state.simulation.phase === "policy_revision" && actorId.endsWith("_leader")) return ["MAINTAIN_CITY_OFFER", "REVISE_POLICY_PACK", "WITHDRAW_CITY_OFFER"];
  if (state.simulation.phase === "coordination_resolution") {
    const hasOpenPlan = state.coordinationPlans.some((plan) => plan.status === "proposed");
    if (actorId === "policy_supervisor") return hasOpenPlan ? ["AUDIT_COORDINATION_PLAN"] : ["AUDIT_POLICY_PACK"];
    return ["RESPOND_COORDINATION_PLAN"];
  }
  if (state.simulation.phase === "final_deliberation" || state.simulation.phase === "post_disclosure") {
    if (actorId === "company_ceo" || actorId === "company_cfo") return ["ADVISE_COMPANY_RESPONSE"];
    if (actorId === "investor") return ["ADVISE_FINANCING"];
    if (actorId === "company_board") {
      const kinds: AgentAction["kind"][] = ["EXIT_PROJECT"];
      const hasAuditedPolicy = Object.values(state.cities).some((city) => city.policies.some((policy) => policy.status === "issued" && policy.auditStatus === "approved"));
      const hasAuditedCoordination = state.coordinationPlans.some((plan) => plan.status === "proposed" && plan.auditStatus === "approved");
      if (hasAuditedPolicy) kinds.unshift("ACCEPT_POLICY");
      if (hasAuditedCoordination) kinds.unshift("ACCEPT_COORDINATION_PLAN");
      return kinds;
    }
  }
  if (state.simulation.phase === "impact_assessment") return ["ASSESS_LONG_TERM_IMPACT"];
  return [...new Set(permissions.flatMap((permission) => permissionKinds[permission] ?? []))];
}
