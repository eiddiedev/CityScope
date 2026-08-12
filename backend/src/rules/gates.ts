import { z } from "zod";
import { AgentActionSchema, type AgentAction, type GateResult, type PolicyPack, type PolicyTerm, type ResourceCalculation, type WorldState } from "../domain.js";
import { manifests, observe } from "../agents/manifests.js";
import { calculatePolicyResources, releaseResources, requestsFromTerms } from "./tools/resource-ledger.js";

const kindPermission: Record<AgentAction["kind"], string> = {
  ADVISE_POLICY: "recommend",
  SUBMIT_POLICY_PACK: "sign_policy",
  REVISE_POLICY_PACK: "sign_policy",
  WITHDRAW_CITY_OFFER: "withdraw_city_offer",
  ADVISE_COMPANY_RESPONSE: "recommend",
  SUBMIT_COMPANY_RESPONSE: "sign_company_response",
  ADVISE_FINANCING: "decide_financing",
  REQUEST_DUE_DILIGENCE: "request_audit",
  DISCLOSE_FACT: "disclose_fact",
  ACCEPT_POLICY: "accept_policy",
  REJECT_POLICY: "accept_policy",
  WITHDRAW_COMMITMENT: "withdraw_commitment",
  EXIT_PROJECT: "exit_project",
  ADVANCE_PROJECT: "advance_project",
  PUBLISH_STAKEHOLDER_REACTION: "publish_reaction",
  SEND_DEBATE_MESSAGE: "debate",
  ISSUE_COORDINATION_OPINION: "coordinate",
  PROPOSE_COORDINATION_PLAN: "coordinate",
  RESPOND_COORDINATION_PLAN: "respond_coordination",
  AUDIT_COORDINATION_PLAN: "audit_policy",
  ACCEPT_COORDINATION_PLAN: "accept_coordination",
  AUDIT_POLICY_PACK: "audit_policy",
  ASSESS_LONG_TERM_IMPACT: "advance_project",
  PASS: "pass",
};

const TriggerSchema = z.object({ metric: z.enum(["verifiedJobs", "verifiedInvestmentMillionCny", "bindingOrderRatio", "annualOutputMillionCny"]), operator: z.literal(">="), value: z.number().nonnegative() }).strict();
const PolicyTermSchema = z.object({
  termId: z.string().min(1),
  type: z.enum(["cash_support", "land", "facility", "energy", "talent_housing", "demo_order", "output_floor", "jobs_milestone"]),
  amountMillionCny: z.number().nonnegative().optional(),
  quantity: z.number().nonnegative().optional(),
  trigger: TriggerSchema.optional(),
  deadline: z.string().optional(),
  failureAction: z.enum(["cancel_payment", "clawback", "renegotiate"]).optional(),
}).strict();

export const PolicyPayloadSchema = z.object({
  policyId: z.string().min(1),
  cityId: z.enum(["chengdu", "chongqing"]),
  decisionMode: z.enum(["ACCEPT_INVESTMENT", "ACCEPT_FINANCE", "COMPROMISE", "RETURN_FOR_REVISION"]),
  terms: z.array(PolicyTermSchema),
  candidateId: z.string().min(1).optional(),
  investmentMillionCny: z.number().nonnegative().optional(),
  supersedesPolicyId: z.string().min(1).optional(),
}).strict();

const AssignmentsSchema = z.object({
  headquarters: z.enum(["chengdu", "chongqing", "none"]),
  rd_center: z.enum(["chengdu", "chongqing", "none"]),
  smart_factory: z.enum(["chengdu", "chongqing", "none"]),
  supply_chain_base: z.enum(["chengdu", "chongqing", "none"]),
  training_center: z.enum(["chengdu", "chongqing", "none"]),
}).strict();

const CoordinationPlanSchema = z.object({
  planId: z.string().min(1),
  candidateId: z.string().min(1),
  sourcePolicyIds: z.array(z.string().min(1)).min(2),
  assignments: AssignmentsSchema,
  cityTerms: z.object({ chengdu: z.array(PolicyTermSchema).min(1), chongqing: z.array(PolicyTermSchema).min(1) }).strict(),
  investmentMillionCny: z.number().positive(),
  milestones: z.array(TriggerSchema).min(1),
  commonPlatform: z.object({
    name: z.string().min(2).max(60),
    payerShares: z.object({ chengdu: z.number().min(0).max(1), chongqing: z.number().min(0).max(1) }).strict(),
  }).strict(),
  concessions: z.object({ chengdu: z.array(z.string().min(2).max(60)).min(1), chongqing: z.array(z.string().min(2).max(60)).min(1) }).strict(),
}).strict();

const CoordinationResponseSchema = z.object({
  planId: z.string().min(1),
  cityId: z.enum(["chengdu", "chongqing"]),
  decision: z.enum(["accept", "conditional", "reject"]),
  conditions: z.array(z.string().min(2).max(80)),
}).strict();

const CoordinationAuditSchema = z.object({
  planId: z.string().min(1),
  decision: z.enum(["approve", "require_repair"]),
  reasonCodes: z.array(z.string().min(1)).min(1),
}).strict();

const StakeholderReactionSchema = z.object({
  reactionId: z.string().min(1),
  metrics: z.record(z.number().min(-15).max(15)),
  reasonCodes: z.array(z.string()).min(1),
  sentiment: z.enum(["support", "concern", "mixed"]),
}).strict();

const AuditSchema = z.object({
  audits: z.array(z.object({ policyId: z.string(), decision: z.enum(["approve", "flag", "require_repair"]), reasonCodes: z.array(z.string()) }).strict()).min(1),
}).strict();

const CompanyResponseSchema = z.object({
  responseId: z.string().min(1),
  targetPolicyIds: z.array(z.string().min(1)),
  requestedChanges: z.array(z.object({
    policyId: z.string().min(1),
    termId: z.string().min(1),
    requestedValue: z.number(),
  }).strict()),
}).strict();

const DebateMessageSchema = z.object({
  messageId: z.string().min(1),
  threadId: z.string().min(1),
  turnType: z.enum(["challenge", "position", "proposal", "counter", "concession"]),
  issue: z.enum(["functional_allocation", "duplicate_subsidy", "fiscal_risk"]),
  stance: z.enum(["support", "oppose", "conditional", "mediate"]),
  content: z.string().min(8).max(100),
  audience: z.array(z.string().min(1)).min(1),
  visibility: z.enum(["participants", "public"]),
  replyToMessageId: z.string().min(1).optional(),
}).strict();

export function runGates(rawAction: unknown, state: WorldState): { action?: AgentAction; results: GateResult[] } {
  const parsed = AgentActionSchema.safeParse(rawAction);
  const schemaResult: GateResult = parsed.success && !containsForbiddenKey(rawAction)
    ? { gate: "schema", passed: true, reason: "AgentAction matches v0 proposal and contains no outcome-directing field" }
    : { gate: "schema", passed: false, code: "INVALID_ACTION_SCHEMA", reason: parsed.success ? "forbidden outcome-directing field found" : parsed.error.issues.map((issue) => issue.message).join("; ") };
  if (!parsed.success || !schemaResult.passed) return { results: [schemaResult] };
  const action = parsed.data;
  const manifest = manifests[action.actorId];
  const required = kindPermission[action.kind];
  const authority: GateResult = manifest?.permissions.includes(required as never)
    ? { gate: "authority", passed: true, reason: `${action.actorId} (${manifest.actorKind}) has ${required}` }
    : { gate: "authority", passed: false, code: "AUTHORITY_DENIED", reason: `${action.actorId} lacks ${required}` };

  const visible = new Set(observe(state, action.actorId).facts.map((fact) => fact.factId));
  const invisible = action.evidenceFactIds.filter((factId) => !visible.has(factId));
  const privacy: GateResult = invisible.length === 0
    ? { gate: "privacy", passed: true, reason: "all referenced facts are observable" }
    : { gate: "privacy", passed: false, code: "PRIVATE_FACT_FORBIDDEN", reason: `unobservable facts: ${invisible.join(", ")}` };
  const constraint = checkConstraints(action, state);
  return { action, results: [schemaResult, authority, privacy, constraint] };
}

function checkConstraints(action: AgentAction, state: WorldState): GateResult {
  if (action.reasoning.length > 120) return fail("audience-facing reasoning must not exceed 120 characters");
  if (action.kind === "SUBMIT_POLICY_PACK" || action.kind === "REVISE_POLICY_PACK") return checkPolicy(action, state);
  if (action.kind === "WITHDRAW_CITY_OFFER") {
    const cityId = action.actorId.startsWith("chengdu") ? "chengdu" : "chongqing";
    if (action.actorId !== `${cityId}_leader`) return fail("only the city leader may withdraw its offer");
    if (!state.facts.some((fact) => fact.kind === "order_quality" && fact.visibility === "disclosed")) return fail("city offer may only be withdrawn after due-diligence disclosure");
    if (["withdrawn", "closed", "accepted"].includes(state.cities[cityId].bidStatus)) return fail(`city bid is already ${state.cities[cityId].bidStatus}`);
  }
  if (action.kind === "SUBMIT_COMPANY_RESPONSE" || action.kind === "EXIT_PROJECT" || action.kind === "ACCEPT_COORDINATION_PLAN") {
    const ceo = state.company.internalAdvice.some((item) => item.actorId === "company_ceo");
    const cfo = state.company.internalAdvice.some((item) => item.actorId === "company_cfo");
    if (!ceo || !cfo) return fail("board decision requires both CEO and CFO advice");
  }
  if (action.kind === "EXIT_PROJECT" && state.simulation.phase === "final_deliberation") {
    if (state.cities.chengdu.bidStatus !== "withdrawn" || state.cities.chongqing.bidStatus !== "withdrawn") return fail("regional project exit requires both cities to formally withdraw first");
  }
  if (action.kind === "SUBMIT_COMPANY_RESPONSE") {
    const parsed = CompanyResponseSchema.safeParse(action.payload);
    if (!parsed.success) return fail(parsed.error.issues.map((issue) => issue.message).join("; "));
    const unknownPolicies = parsed.data.targetPolicyIds.filter((policyId) => !findPolicy(state, policyId));
    if (unknownPolicies.length) return fail(`company response references unknown policies: ${unknownPolicies.join(",")}`);
    const invalidChanges = parsed.data.requestedChanges.filter((change) => {
      const policy = findPolicy(state, change.policyId);
      return !policy || !policy.terms.some((term) => term.termId === change.termId);
    });
    if (invalidChanges.length) return fail(`company response references unknown policy terms: ${invalidChanges.map((change) => `${change.policyId}/${change.termId}`).join(",")}`);
    if (state.simulation.phase === "post_disclosure" && (parsed.data.targetPolicyIds.length === 0 || parsed.data.requestedChanges.length === 0)) {
      return fail("post-disclosure continue-negotiation decision requires at least one target policy and one concrete requested change");
    }
  }
  if (action.kind === "DISCLOSE_FACT") {
    const factId = String(action.payload.factId ?? "");
    const fact = state.facts.find((item) => item.factId === factId);
    if (!fact) return fail(`unknown fact ${factId}`);
    if (state.round < 2 && fact.kind === "order_quality") return fail("order quality may only be disclosed in due-diligence round 2 or later");
  }
  if (action.kind === "ACCEPT_POLICY" || action.kind === "REJECT_POLICY") {
    const policy = findPolicy(state, String(action.payload.policyId ?? ""));
    if (!policy || policy.status !== "issued") return fail(`policy ${String(action.payload.policyId)} is not open`);
    if (action.kind === "ACCEPT_POLICY" && policy.auditStatus !== "approved") return fail(`policy ${policy.policyId} is not audit-approved`);
    if (action.kind === "ACCEPT_POLICY") {
      const otherCity = policy.cityId === "chengdu" ? "chongqing" : "chengdu";
      if (!["withdrawn", "closed"].includes(state.cities[otherCity].bidStatus)) return fail(`single-city acceptance requires ${otherCity} bid to be withdrawn or closed`);
      const risk = policyRiskViolation(policy.investmentMillionCny, state);
      if (risk) return fail(risk);
    }
  }
  if (action.kind === "REJECT_POLICY" && state.simulation.phase === "post_disclosure") {
    const remaining = openIssuedPolicies(state).filter((policy) => policy.policyId !== String(action.payload.policyId));
    const accepted = acceptedPolicies(state);
    if (remaining.length === 0 && accepted.length === 0) return fail("rejecting the final open policy is not a complete board resolution; choose EXIT_PROJECT");
  }
  if (action.kind === "AUDIT_POLICY_PACK") {
    const parsed = AuditSchema.safeParse(action.payload);
    if (!parsed.success) return fail(parsed.error.issues.map((issue) => issue.message).join("; "));
    const missing = parsed.data.audits.filter((audit) => !findPolicy(state, audit.policyId)).map((audit) => audit.policyId);
    if (missing.length) return fail(`unknown policies: ${missing.join(",")}`);
  }
  if (action.kind === "SEND_DEBATE_MESSAGE") {
    const parsed = DebateMessageSchema.safeParse(action.payload);
    if (!parsed.success) return fail(parsed.error.issues.map((issue) => issue.message).join("; "));
    if (state.simulation.phase !== "coordination_debate") return fail("debate messages are only legal during coordination_debate");
    const participants = ["regional_coordinator", "chengdu_leader", "chongqing_leader", "policy_supervisor"];
    if (!participants.includes(action.actorId)) return fail(`${action.actorId} is not a coordination debate participant`);
    if (parsed.data.audience.some((actorId) => !participants.includes(actorId))) return fail("coordination debate audience exceeds authorized participants");
    const thread = state.debateThreads.find((item) => item.threadId === parsed.data.threadId);
    const messages = thread?.messages ?? [];
    const expectedActor = ["regional_coordinator", "chengdu_leader", "chongqing_leader", "regional_coordinator", "chengdu_leader", "chongqing_leader"][messages.length];
    if (!expectedActor || action.actorId !== expectedActor) return fail(`debate turn belongs to ${expectedActor ?? "resolution"}`);
    if (messages.length === 0 && parsed.data.replyToMessageId) return fail("opening challenge cannot reply to a missing message");
    if (messages.length > 0 && !messages.some((message) => message.messageId === parsed.data.replyToMessageId)) return fail("debate reply must reference a visible earlier message");
  }
  if (action.kind === "ISSUE_COORDINATION_OPINION") {
    const policyIds = strings(action.payload.policyIds);
    if (policyIds.some((policyId) => !findPolicy(state, policyId))) return fail("coordination opinion references unknown policy");
    if (state.simulation.phase === "coordination_debate") {
      const thread = state.debateThreads.find((item) => item.threadId === String(action.payload.threadId ?? ""));
      if (!thread || thread.messages.length < 6) return fail("coordination opinion requires a completed six-turn debate record");
      const concessions = strings(action.payload.concessions);
      if (concessions.length < 2 || typeof action.payload.summary !== "string") return fail("coordination resolution requires a summary and at least two explicit concessions");
      if (action.payload.summary.length > 120) return fail("coordination summary must not exceed 120 characters");
      if (concessions.some((item) => item.length > 60)) return fail("each coordination concession must not exceed 60 characters");
    }
  }
  if (action.kind === "PROPOSE_COORDINATION_PLAN") {
    const parsed = CoordinationPlanSchema.safeParse(action.payload);
    if (!parsed.success) return fail(parsed.error.issues.map((issue) => issue.message).join("; "));
    if (state.simulation.phase !== "coordination_debate") return fail("coordination plan may only be proposed after risk disclosure debate");
    if (!state.debateThreads.some((thread) => thread.status === "open" && thread.messages.length >= 6)) return fail("coordination plan requires a completed six-message concession record");
    if (parsed.data.sourcePolicyIds.some((policyId) => !findPolicy(state, policyId))) return fail("coordination plan references unknown policy");
    const used = new Set(Object.values(parsed.data.assignments).filter((city) => city !== "none"));
    if (!used.has("chengdu") || !used.has("chongqing")) return fail("coordination plan must assign material functions to both cities");
    if (Math.abs(parsed.data.commonPlatform.payerShares.chengdu + parsed.data.commonPlatform.payerShares.chongqing - 1) > 1e-6) return fail("common platform payer shares must sum to one");
    const portfolioCandidates = decisionCandidates(state, action.actionId);
    if (portfolioCandidates.length && !portfolioCandidates.includes(parsed.data.candidateId)) return fail("coordination candidateId is not part of current decision portfolio");
  }
  if (action.kind === "RESPOND_COORDINATION_PLAN") {
    const parsed = CoordinationResponseSchema.safeParse(action.payload);
    if (!parsed.success) return fail(parsed.error.issues.map((issue) => issue.message).join("; "));
    if (action.actorId !== `${parsed.data.cityId}_leader`) return fail("coordination response city does not match actor authority");
    const plan = state.coordinationPlans.find((item) => item.planId === parsed.data.planId);
    if (!plan || plan.status !== "proposed") return fail("coordination plan is not open");
    if (plan.responses[parsed.data.cityId]) return fail("city has already responded to coordination plan");
    if (parsed.data.decision === "conditional" && parsed.data.conditions.length === 0) return fail("conditional response requires explicit conditions");
  }
  if (action.kind === "AUDIT_COORDINATION_PLAN") {
    const parsed = CoordinationAuditSchema.safeParse(action.payload);
    if (!parsed.success) return fail(parsed.error.issues.map((issue) => issue.message).join("; "));
    const plan = state.coordinationPlans.find((item) => item.planId === parsed.data.planId);
    if (!plan) return fail("unknown coordination plan");
    if (!plan.responses.chengdu || !plan.responses.chongqing) return fail("coordination audit requires both city responses");
    if ([plan.responses.chengdu.decision, plan.responses.chongqing.decision].includes("reject")) return fail("rejected coordination plan cannot be approved");
  }
  if (action.kind === "ACCEPT_COORDINATION_PLAN") {
    const plan = state.coordinationPlans.find((item) => item.planId === String(action.payload.planId ?? ""));
    if (!plan || plan.status !== "proposed") return fail("coordination plan is not open");
    if (plan.auditStatus !== "approved") return fail("coordination plan is not audit-approved");
    if (!plan.responses.chengdu || !plan.responses.chongqing || [plan.responses.chengdu.decision, plan.responses.chongqing.decision].includes("reject")) return fail("coordination plan requires affirmative responses from both cities");
    const risk = policyRiskViolation(plan.investmentMillionCny, state, true);
    if (risk) return fail(risk);
  }
  if (action.kind === "PUBLISH_STAKEHOLDER_REACTION") {
    const parsed = StakeholderReactionSchema.safeParse(action.payload);
    if (!parsed.success) return fail(parsed.error.issues.map((issue) => issue.message).join("; "));
    const allowed = action.actorId === "talent_sme"
      ? new Set(["talentAttraction", "smeParticipation", "supplyChainReadiness", "housingPressure", "publicTrust"])
      : new Set(["residentSupport", "fiscalFairnessConcern", "trafficOrEnergyPressure", "publicTrust"]);
    const forbidden = Object.keys(parsed.data.metrics).filter((key) => !allowed.has(key));
    if (forbidden.length) return fail(`stakeholder cannot change: ${forbidden.join(",")}`);
  }
  if ((action.kind === "ADVANCE_PROJECT" || action.kind === "ASSESS_LONG_TERM_IMPACT") && !["signed", "delivery", "completed", "exited"].includes(state.company.projectStage)) {
    return fail(`project cannot enter delivery from ${state.company.projectStage} without an accepted policy`);
  }
  if (action.kind === "PASS" && action.actorId === "company_board" && ["post_disclosure", "final_deliberation"].includes(state.simulation.phase) && !hasTerminalBoardResolution(state)) {
    return fail("post-disclosure board must explicitly accept an audited policy or exit the project; a counteroffer is intermediate, not a terminal outcome");
  }
  return { gate: "constraint", passed: true, reason: "lifecycle, payload and red-line constraints passed" };
}

function checkPolicy(action: AgentAction, state: WorldState): GateResult {
  const parsed = PolicyPayloadSchema.safeParse(action.payload);
  if (!parsed.success) return fail(parsed.error.issues.map((issue) => issue.message).join("; "));
  const policy = parsed.data;
  if (action.actorId !== `${policy.cityId}_leader`) return fail(`only ${policy.cityId}_leader may issue this city's PolicyPack`);
  if (["withdrawn", "closed", "accepted"].includes(state.cities[policy.cityId].bidStatus)) return fail(`city bid is ${state.cities[policy.cityId].bidStatus}`);
  if (action.kind === "REVISE_POLICY_PACK") {
    const previous = findPolicy(state, policy.supersedesPolicyId ?? "");
    if (!previous || previous.cityId !== policy.cityId || previous.status !== "issued") return fail("revision must supersede an open policy from the same city");
    if (!policy.candidateId) return fail("policy revision must cite the selected candidateId");
    if (!state.facts.some((fact) => fact.kind === "order_quality" && fact.visibility === "disclosed")) return fail("policy may only be revised in response to disclosed due-diligence risk");
  }
  if (policy.decisionMode === "RETURN_FOR_REVISION" && policy.terms.length > 0) return fail("returned policy must not contain executable terms");
  for (const term of policy.terms) {
    if (["cash_support", "demo_order"].includes(term.type) && term.amountMillionCny === undefined) return fail(`${term.termId} requires amountMillionCny`);
    if (["land", "facility", "energy", "talent_housing", "output_floor", "jobs_milestone"].includes(term.type) && term.quantity === undefined) return fail(`${term.termId} requires quantity`);
    if (term.type === "cash_support" && (term.amountMillionCny ?? 0) > 100 && !term.trigger) return fail(`cash term ${term.termId} above 100 requires milestone trigger`);
  }
  const calculationLedger = action.kind === "REVISE_POLICY_PACK" && policy.supersedesPolicyId
    ? releaseResources(state.cities[policy.cityId].resourceLedger, requestsFromTerms(findPolicy(state, policy.supersedesPolicyId)?.terms ?? []), "reserved")
    : state.cities[policy.cityId].resourceLedger;
  const calculations = calculatePolicyResources(calculationLedger, normalizeTerms(policy.terms));
  const failed = calculations.filter((item) => !item.passed);
  return failed.length
    ? { gate: "constraint", passed: false, code: "CONSTRAINT_VIOLATION", reason: failed.map((item) => `${item.reasonCode}:${item.resource}`).join(","), calculations }
    : { gate: "constraint", passed: true, reason: "all fiscal, land/facility, energy and housing calculations passed", calculations };
}

function fail(reason: string, calculations?: ResourceCalculation[]): GateResult {
  return { gate: "constraint", passed: false, code: "CONSTRAINT_VIOLATION", reason, ...(calculations ? { calculations } : {}) };
}

function findPolicy(state: WorldState, policyId: string): PolicyPack | undefined {
  return Object.values(state.cities).flatMap((city) => city.policies).find((item) => item.policyId === policyId);
}

function openIssuedPolicies(state: WorldState): PolicyPack[] {
  return Object.values(state.cities).flatMap((city) => city.policies).filter((policy) => policy.status === "issued");
}

function acceptedPolicies(state: WorldState): PolicyPack[] {
  return Object.values(state.cities).flatMap((city) => city.policies).filter((policy) => policy.status === "accepted");
}

function hasTerminalBoardResolution(state: WorldState): boolean {
  return state.company.projectStage === "exited" || acceptedPolicies(state).length > 0;
}

function containsForbiddenKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsForbiddenKey);
  if (value === null || typeof value !== "object") return false;
  return Object.entries(value).some(([key, nested]) => ["desiredOutcome", "winner", "forceAgreement"].includes(key) || containsForbiddenKey(nested));
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export function toPolicyPack(action: AgentAction, worldVersion: number, calculations: ResourceCalculation[]): PolicyPack {
  const payload = PolicyPayloadSchema.parse(action.payload);
  return {
    policyId: payload.policyId,
    cityId: payload.cityId,
    decisionMode: payload.decisionMode,
    terms: normalizeTerms(payload.terms),
    issuerId: action.actorId,
    status: "issued",
    auditStatus: "pending",
    resourceCalculations: calculations,
    issuedAtVersion: worldVersion,
    version: action.kind === "REVISE_POLICY_PACK" ? 2 : 1,
    ...(payload.supersedesPolicyId ? { supersedesPolicyId: payload.supersedesPolicyId } : {}),
    ...(payload.candidateId ? { candidateId: payload.candidateId } : {}),
    investmentMillionCny: payload.investmentMillionCny ?? 3_000,
  };
}

function policyRiskViolation(investmentMillionCny: number, state: WorldState, coordination = false): string | null {
  if (state.metrics.financingConfidence < 10 || state.company.bindingOrderRatio < 0.25) return "financing or binding orders are below the board signing floor";
  if (coordination) {
    if (investmentMillionCny > 2_400 || state.metrics.financingConfidence < 20 || state.company.bindingOrderRatio < 0.3) return "coordination plan exceeds the audited risk-sharing envelope";
    return null;
  }
  if (investmentMillionCny > 2_400 && (state.metrics.financingConfidence < 50 || state.company.bindingOrderRatio < 0.5)) return "full-scale investment lacks binding orders or financing confidence";
  if (investmentMillionCny > 2_200 || state.metrics.financingConfidence < 20 || state.company.bindingOrderRatio < 0.3) return "single-city revised policy exceeds the reduced-scope risk envelope";
  return null;
}

function decisionCandidates(state: WorldState, actionId: string): string[] {
  void actionId;
  return [...state.events].reverse().flatMap((event) => {
    const support = event.payload.decisionSupport as { candidates?: Array<{ candidateId?: unknown }> } | undefined;
    return support?.candidates?.flatMap((candidate) => typeof candidate.candidateId === "string" ? [candidate.candidateId] : []) ?? [];
  });
}

function normalizeTerms(terms: z.infer<typeof PolicyTermSchema>[]): PolicyTerm[] {
  return terms.map((term) => ({
    termId: term.termId, type: term.type,
    ...(term.amountMillionCny !== undefined ? { amountMillionCny: term.amountMillionCny } : {}),
    ...(term.quantity !== undefined ? { quantity: term.quantity } : {}),
    ...(term.trigger !== undefined ? { trigger: term.trigger } : {}),
    ...(term.deadline !== undefined ? { deadline: term.deadline } : {}),
    ...(term.failureAction !== undefined ? { failureAction: term.failureAction } : {}),
  }));
}
