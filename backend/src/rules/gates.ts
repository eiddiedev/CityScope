import { z } from "zod";
import { AgentActionSchema, type AgentAction, type GateResult, type PolicyPack, type PolicyTerm, type ResourceCalculation, type WorldState } from "../domain.js";
import { manifests, observe } from "../agents/manifests.js";
import { calculatePolicyResources } from "./tools/resource-ledger.js";

const kindPermission: Record<AgentAction["kind"], string> = {
  ADVISE_POLICY: "recommend",
  SUBMIT_POLICY_PACK: "sign_policy",
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
  ISSUE_COORDINATION_OPINION: "coordinate",
  AUDIT_POLICY_PACK: "audit_policy",
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
  if (action.kind === "SUBMIT_POLICY_PACK") return checkPolicy(action, state);
  if (action.kind === "SUBMIT_COMPANY_RESPONSE" || action.kind === "EXIT_PROJECT") {
    const ceo = state.company.internalAdvice.some((item) => item.actorId === "company_ceo");
    const cfo = state.company.internalAdvice.some((item) => item.actorId === "company_cfo");
    if (!ceo || !cfo) return fail("board decision requires both CEO and CFO advice");
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
  }
  if (action.kind === "AUDIT_POLICY_PACK") {
    const parsed = AuditSchema.safeParse(action.payload);
    if (!parsed.success) return fail(parsed.error.issues.map((issue) => issue.message).join("; "));
    const missing = parsed.data.audits.filter((audit) => !findPolicy(state, audit.policyId)).map((audit) => audit.policyId);
    if (missing.length) return fail(`unknown policies: ${missing.join(",")}`);
  }
  if (action.kind === "ISSUE_COORDINATION_OPINION") {
    const policyIds = strings(action.payload.policyIds);
    if (policyIds.some((policyId) => !findPolicy(state, policyId))) return fail("coordination opinion references unknown policy");
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
  return { gate: "constraint", passed: true, reason: "lifecycle, payload and red-line constraints passed" };
}

function checkPolicy(action: AgentAction, state: WorldState): GateResult {
  const parsed = PolicyPayloadSchema.safeParse(action.payload);
  if (!parsed.success) return fail(parsed.error.issues.map((issue) => issue.message).join("; "));
  const policy = parsed.data;
  if (action.actorId !== `${policy.cityId}_leader`) return fail(`only ${policy.cityId}_leader may issue this city's PolicyPack`);
  if (policy.decisionMode === "RETURN_FOR_REVISION" && policy.terms.length > 0) return fail("returned policy must not contain executable terms");
  for (const term of policy.terms) {
    if (["cash_support", "demo_order"].includes(term.type) && term.amountMillionCny === undefined) return fail(`${term.termId} requires amountMillionCny`);
    if (["land", "facility", "energy", "talent_housing", "output_floor", "jobs_milestone"].includes(term.type) && term.quantity === undefined) return fail(`${term.termId} requires quantity`);
    if (term.type === "cash_support" && (term.amountMillionCny ?? 0) > 100 && !term.trigger) return fail(`cash term ${term.termId} above 100 requires milestone trigger`);
  }
  const calculations = calculatePolicyResources(state.cities[policy.cityId].resourceLedger, normalizeTerms(policy.terms));
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
  };
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
