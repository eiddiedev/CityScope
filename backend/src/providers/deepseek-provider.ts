import { actionKinds } from "../domain.js";
import { providerGeneration, type GenerationRequest, type LLMProvider, type ProviderUsage } from "./types.js";
import { deterministicId } from "../util.js";

export interface DeepSeekConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  timeoutMs: number;
  maxConcurrency: number;
  maxTokens: number;
  thinking: "enabled" | "disabled";
  temperature: number;
}

export class DeepSeekProvider implements LLMProvider {
  readonly id = "deepseek";
  readonly model: string;
  private readonly semaphore: Semaphore;

  constructor(private readonly config: DeepSeekConfig) {
    this.model = config.model;
    this.semaphore = new Semaphore(config.maxConcurrency);
  }

  async generate(request: GenerationRequest): Promise<unknown> {
    const release = await this.semaphore.acquire();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const response = await fetch(`${this.config.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${this.config.apiKey}` },
        body: JSON.stringify({
          model: this.config.model,
          thinking: { type: this.config.thinking },
          temperature: this.config.temperature,
          max_tokens: this.config.maxTokens,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content: [
                "CityScope is a governed multi-agent policy simulation. Produce proposals only; deterministic gates and the World Reducer alone decide whether anything executes.",
                "Return one JSON decision object and no prose. Never claim an action executed.",
                "Use exactly this decision shape without an outer wrapper:",
                '{"kind":"LEGAL_KIND","reasoning":"decision rationale","payload":{},"evidenceFactIds":[]}',
                "Do not output actorId, actionId, promptVersion or schemaVersion; the trusted provider stamps that metadata.",
                "Prefer a meaningful legal action. Use PASS only when no material legal action is possible.",
                "All audience-facing text must be concise natural Chinese. reasoning must be at most 90 characters: state one decision and one decisive reason only. When decisionSupport is present, include the chosen candidateId exactly once for traceability; otherwise never repeat internal field names, enum literals, IDs, status codes, or the full calculation process.",
                "When decisionSupport has at least two candidates, compare them using your actorRanking, cite the chosen candidateId in reasoning, and explain any disagreement with consensusCandidateId. If optimizer status is INFEASIBLE, state the hard-constraint conflict and do not invent a candidate.",
                `Stable action catalog:\n${payloadGuidance([...actionKinds])}`,
              ].join("\n"),
            },
            {
              role: "system",
              content: [request.instruction, `The only legal kind values for this turn are: ${request.eligibleKinds.join(", ")}.`].join("\n"),
            },
            {
              role: "user",
              content: JSON.stringify({
                phase: request.phase,
                eligibleKinds: request.eligibleKinds,
                decisionView: request.decisionView,
                schemaVersion: request.schemaVersion,
                repairAttempt: request.repairAttempt,
                decisionSupport: request.decisionSupport,
              }),
            },
          ],
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const requestId = response.headers.get("x-request-id");
        let providerDetail = "";
        try {
          const errorBody = await response.json() as { error?: { code?: string; message?: string; type?: string } };
          providerDetail = [errorBody.error?.code, errorBody.error?.type, errorBody.error?.message].filter(Boolean).join(" · ").slice(0, 320);
        } catch { /* 供应商偶尔返回非 JSON 错误页，保留 HTTP 状态即可。 */ }
        throw new Error(`DeepSeek HTTP ${response.status}${providerDetail ? ` · ${providerDetail}` : ""}${requestId ? ` requestId=${requestId}` : ""}`);
      }
      const body = await response.json() as {
        choices?: Array<{ finish_reason?: string; message?: { content?: string } }>;
        usage?: DeepSeekUsage;
      };
      const choice = body.choices?.[0];
      const content = choice?.message?.content;
      if (!content) throw new Error(`DeepSeek response contained no message content (finish=${choice?.finish_reason ?? "unknown"})`);
      return providerGeneration(canonicalizeAction(parseJsonContent(content), request), providerUsage(body.usage));
    } finally {
      clearTimeout(timeout);
      release();
    }
  }
}

interface DeepSeekUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  prompt_cache_hit_tokens?: number;
  prompt_cache_miss_tokens?: number;
}

function providerUsage(usage: DeepSeekUsage | undefined): ProviderUsage | undefined {
  if (!usage) return undefined;
  const promptTokens = finite(usage.prompt_tokens);
  const completionTokens = finite(usage.completion_tokens);
  return {
    callCount: 1,
    promptTokens,
    completionTokens,
    totalTokens: finite(usage.total_tokens) || promptTokens + completionTokens,
    promptCacheHitTokens: finite(usage.prompt_cache_hit_tokens),
    promptCacheMissTokens: finite(usage.prompt_cache_miss_tokens),
  };
}

function finite(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

export function deepSeekConfigFromEnv(env: NodeJS.ProcessEnv = process.env): DeepSeekConfig {
  const apiKey = env.DEEPSEEK_API_KEY;
  const baseUrl = env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com";
  const model = env.DEEPSEEK_MODEL ?? "deepseek-v4-flash";
  if (!apiKey) throw new Error("DEEPSEEK_API_KEY is required for deepseek provider");
  return {
    apiKey,
    baseUrl,
    model,
    timeoutMs: positiveInteger(env.DEEPSEEK_TIMEOUT_MS, 15_000),
    maxConcurrency: positiveInteger(env.DEEPSEEK_MAX_CONCURRENCY, 2),
    maxTokens: positiveInteger(env.DEEPSEEK_MAX_TOKENS, 1_600),
    thinking: env.DEEPSEEK_THINKING?.toLowerCase() === "enabled" ? "enabled" : "disabled",
    temperature: finiteTemperature(env.DEEPSEEK_TEMPERATURE, 0),
  };
}

function finiteTemperature(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 2 ? parsed : fallback;
}

function positiveInteger(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseJsonContent(content: string): unknown {
  const trimmed = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  return JSON.parse(trimmed);
}

function canonicalizeAction(raw: unknown, request: GenerationRequest): unknown {
  if (containsForbiddenKey(raw)) throw new Error("DeepSeek proposed a forbidden outcome-directing field");
  const root = asRecord(raw);
  const proposal = asRecord(Object.keys(root).length === 1 && root.action !== undefined ? root.action : root);
  const kind = proposal.kind ?? proposal.action;
  const reasoning = proposal.reasoning ?? proposal.rationale;
  const payload = asRecord(proposal.payload ?? proposal.proposal ?? {});
  const evidenceFactIds = Array.isArray(proposal.evidenceFactIds)
    ? proposal.evidenceFactIds.filter((item): item is string => typeof item === "string")
    : [];
  return {
    actionId: deterministicId("model-action", request.observation.runId, request.worldVersion, request.agentId, kind, payload, reasoning),
    actorId: request.agentId,
    kind,
    reasoning,
    payload,
    evidenceFactIds,
    promptVersion: request.promptVersion,
    schemaVersion: request.schemaVersion,
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function containsForbiddenKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsForbiddenKey);
  if (value === null || typeof value !== "object") return false;
  return Object.entries(value).some(([key, nested]) => ["desiredOutcome", "winner", "forceAgreement"].includes(key) || containsForbiddenKey(nested));
}

function payloadGuidance(kinds: GenerationRequest["eligibleKinds"]): string {
  const guides: Partial<Record<GenerationRequest["eligibleKinds"][number], string>> = {
    ADVISE_POLICY: "ADVISE_POLICY: structured recommendations such as supportMillionCny/maxSupportMillionCny, instruments, requestedLanding, milestones and risks.",
    SUBMIT_POLICY_PACK: 'SUBMIT_POLICY_PACK: {"policyId":"unique","cityId":"chengdu|chongqing","decisionMode":"ACCEPT_INVESTMENT|ACCEPT_FINANCE|COMPROMISE|RETURN_FOR_REVISION","terms":[{"termId":"unique","type":"cash_support|land|facility|energy|talent_housing|demo_order|output_floor|jobs_milestone","amountMillionCny":number OR "quantity":number,"trigger":{"metric":"verifiedJobs|verifiedInvestmentMillionCny|bindingOrderRatio|annualOutputMillionCny","operator":">=","value":number},"deadline":"string","failureAction":"cancel_payment|clawback|renegotiate"}]} Use amountMillionCny for cash_support/demo_order; quantity for other term types. Cash above 100 requires trigger.',
    MAINTAIN_CITY_OFFER: 'MAINTAIN_CITY_OFFER: choose {"candidateId":"own feasible single-city candidate"}. Trusted code attaches utility evidence.',
    REVISE_POLICY_PACK: 'REVISE_POLICY_PACK: choose {"candidateId":"own feasible single-city or reduced-scope candidate"}. Trusted code generates terms, money and decision evidence.',
    WITHDRAW_CITY_OFFER: 'WITHDRAW_CITY_OFFER: choose {"candidateId":"own evaluated candidate","reasonCodes":["current red-line reason"]}. Trusted code attaches utilities.',
    ADVISE_COMPANY_RESPONSE: "ADVISE_COMPANY_RESPONSE: structured stance, targetPolicyIds, risks and requestedChanges.",
    SUBMIT_COMPANY_RESPONSE: 'SUBMIT_COMPANY_RESPONSE: {"responseId":"unique","targetPolicyIds":["existing policyId"],"requestedChanges":[{"policyId":"existing","termId":"existing","requestedValue":number}]}.',
    ADVISE_FINANCING: 'ADVISE_FINANCING: {"stance":"support|conditional|withhold","conditions":["..."]}.',
    REQUEST_DUE_DILIGENCE: 'REQUEST_DUE_DILIGENCE: {"scope":["order_quality","cash_runway"],"reasonCode":"..."}.',
    DISCLOSE_FACT: 'DISCLOSE_FACT: {"factId":"visible existing factId","audience":["actorId"]}.',
    ACCEPT_POLICY: 'ACCEPT_POLICY: {"policyId":"existing issued and audit-approved policyId"}.',
    REJECT_POLICY: 'REJECT_POLICY: {"policyId":"existing issued policyId","reasonCodes":["..."]}.',
    WITHDRAW_COMMITMENT: 'WITHDRAW_COMMITMENT: {"commitmentId":"existing commitmentId","reasonCode":"..."}.',
    EXIT_PROJECT: 'EXIT_PROJECT: {"candidateId":"no_landing","reasonCodes":["当前保留效用或红线理由"]}. Trusted code attaches utility evidence.',
    ADVANCE_PROJECT: 'ADVANCE_PROJECT: {"verifiedJobs":number,"verifiedInvestmentMillionCny":number,"annualOutputMillionCny":number,"failedCommitmentIds":[]}.',
    PUBLISH_STAKEHOLDER_REACTION: 'PUBLISH_STAKEHOLDER_REACTION: {"reactionId":"unique","metrics":{"allowedMetric":deltaBetweenMinus15And15},"reasonCodes":["..."],"sentiment":"support|concern|mixed"}. Talent/SME may change talentAttraction,smeParticipation,supplyChainReadiness,housingPressure,publicTrust; resident may change residentSupport,fiscalFairnessConcern,trafficOrEnergyPressure,publicTrust.',
    SEND_DEBATE_MESSAGE: 'SEND_DEBATE_MESSAGE: {"messageId":"unique","threadId":"coordination-main","turnType":"challenge|position|proposal|counter|concession","issue":"functional_allocation|duplicate_subsidy|fiscal_risk","stance":"support|oppose|conditional|mediate","content":"35至70个汉字的自然中文，只表达一个核心主张，不得出现英文枚举或内部字段","audience":["regional_coordinator","chengdu_leader","chongqing_leader","policy_supervisor"],"visibility":"participants","replyToMessageId":"existing prior messageId except opening"}.',
    ISSUE_COORDINATION_OPINION: 'ISSUE_COORDINATION_OPINION: {"opinionId":"unique","threadId":"existing debate threadId","policyIds":["existing policyId"],"recommendation":"split_functions|reduce_duplicate_subsidy|no_coordination_needed","reasonCodes":["..."],"summary":"不超过90个汉字的自然中文协调结论","concessions":["不超过45个汉字的成都明确让步","不超过45个汉字的重庆明确让步"]}.',
    PROPOSE_COORDINATION_PLAN: 'PROPOSE_COORDINATION_PLAN: choose {"candidateId":"one Pareto-feasible dual-city candidate"}. Trusted code generates assignments, terms, amounts and milestones. If no candidate is Pareto-feasible, issue a no_coordination_needed opinion instead.',
    RESPOND_COORDINATION_PLAN: 'RESPOND_COORDINATION_PLAN: choose {"planId":"existing proposed plan"}. Trusted code calculates BATNA, utility gap and the legally allowed response.',
    AUDIT_COORDINATION_PLAN: 'AUDIT_COORDINATION_PLAN: {"planId":"existing proposed plan","decision":"approve|require_repair","reasonCodes":["..."]}. Approval requires both city responses and no rejection.',
    ACCEPT_COORDINATION_PLAN: 'ACCEPT_COORDINATION_PLAN: {"planId":"existing audited plan","candidateId":"its candidate"}. Select it only if its own utility beats every executable single-city, reduced-scope and no-landing option.',
    AUDIT_POLICY_PACK: 'AUDIT_POLICY_PACK: {"audits":[{"policyId":"existing policyId","decision":"approve|flag|require_repair","reasonCodes":["..."]}]}.',
    ASSESS_LONG_TERM_IMPACT: 'ASSESS_LONG_TERM_IMPACT is deterministic-service only. A behavior Agent must not invent this payload.',
    PASS: 'PASS: {"phase":"current phase","reasonCode":"NO_ELIGIBLE_MATERIAL_ACTION"}.',
  };
  return kinds.map((kind) => guides[kind]).filter((guide): guide is string => Boolean(guide)).join("\n");
}

class Semaphore {
  private active = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(private readonly max: number) {}

  async acquire(): Promise<() => void> {
    if (this.active >= this.max) await new Promise<void>((resolve) => this.waiting.push(resolve));
    this.active += 1;
    return () => {
      this.active -= 1;
      this.waiting.shift()?.();
    };
  }
}
