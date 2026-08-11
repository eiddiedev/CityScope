import { z } from "zod";
import { AgentActionSchema, type AgentAction, type GateResult, type PolicyPack, type WorldState } from "../domain.js";
import { manifests, observe } from "../agents/manifests.js";

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
};

export const PolicyPayloadSchema = z.object({
  policyId: z.string().min(1),
  cityId: z.enum(["chengdu", "chongqing"]),
  decisionMode: z.enum(["ACCEPT_INVESTMENT", "ACCEPT_FINANCE", "COMPROMISE", "RETURN_FOR_REVISION"]),
  terms: z.array(
    z.object({
      termId: z.string().min(1),
      type: z.enum(["cash_support", "facility", "talent_housing", "demo_order", "output_floor", "jobs_milestone"]),
      amountMillionCny: z.number().nonnegative().optional(),
      quantity: z.number().nonnegative().optional(),
      trigger: z.object({ metric: z.enum(["verifiedJobs", "verifiedInvestmentMillionCny", "bindingOrderRatio", "annualOutputMillionCny"]), operator: z.literal(">="), value: z.number().nonnegative() }).optional(),
      deadline: z.string().optional(),
      failureAction: z.enum(["cancel_payment", "clawback", "renegotiate"]).optional(),
    }).strict(),
  ),
}).strict();

export function runGates(rawAction: unknown, state: WorldState): { action?: AgentAction; results: GateResult[] } {
  const parsed = AgentActionSchema.safeParse(rawAction);
  const schemaResult: GateResult = parsed.success && !containsForbiddenKey(rawAction)
    ? { gate: "schema", passed: true, reason: "AgentAction matches schema and contains no outcome-directing field" }
    : { gate: "schema", passed: false, code: "INVALID_ACTION_SCHEMA", reason: parsed.success ? "forbidden outcome-directing field found" : parsed.error.issues.map((issue) => issue.message).join("; ") };
  if (!parsed.success || !schemaResult.passed) return { results: [schemaResult] };
  const action = parsed.data;
  const manifest = manifests[action.actorId];
  const required = kindPermission[action.kind];
  const authority: GateResult = manifest?.permissions.includes(required as never)
    ? { gate: "authority", passed: true, reason: `${action.actorId} has ${required}` }
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
  if (action.kind === "SUBMIT_POLICY_PACK") {
    const parsed = PolicyPayloadSchema.safeParse(action.payload);
    if (!parsed.success) return { gate: "constraint", passed: false, code: "CONSTRAINT_VIOLATION", reason: parsed.error.issues.map((issue) => issue.message).join("; ") };
    const policy = parsed.data;
    const expectedLeader = `${policy.cityId}_leader`;
    if (action.actorId !== expectedLeader) return { gate: "constraint", passed: false, code: "CONSTRAINT_VIOLATION", reason: `only ${expectedLeader} may issue this city's PolicyPack` };
    if (policy.decisionMode === "RETURN_FOR_REVISION" && policy.terms.length > 0) return { gate: "constraint", passed: false, code: "CONSTRAINT_VIOLATION", reason: "returned policy must not contain externally executable terms" };
    const city = state.cities[policy.cityId];
    const cash = policy.terms.reduce((sum, term) => sum + (term.type === "cash_support" ? term.amountMillionCny ?? 0 : 0), 0);
    if (cash > city.fiscal.availableMillionCny) return { gate: "constraint", passed: false, code: "CONSTRAINT_VIOLATION", reason: `cash support ${cash} exceeds available budget ${city.fiscal.availableMillionCny}` };
    const facility = policy.terms.reduce((sum, term) => sum + (term.type === "facility" ? term.quantity ?? 0 : 0), 0);
    if (facility > city.resources.factorySqm) return { gate: "constraint", passed: false, code: "CONSTRAINT_VIOLATION", reason: `facility ${facility} exceeds available ${city.resources.factorySqm}` };
    for (const term of policy.terms) {
      if (term.type === "cash_support" && (term.amountMillionCny ?? 0) > 100 && !term.trigger) return { gate: "constraint", passed: false, code: "CONSTRAINT_VIOLATION", reason: `cash term ${term.termId} above 100 requires a milestone trigger` };
    }
  }
  if (action.kind === "SUBMIT_COMPANY_RESPONSE") {
    const ceo = state.company.internalAdvice.some((item) => item.actorId === "company_ceo");
    const cfo = state.company.internalAdvice.some((item) => item.actorId === "company_cfo");
    if (!ceo || !cfo) return { gate: "constraint", passed: false, code: "CONSTRAINT_VIOLATION", reason: "board response requires both CEO and CFO advice" };
  }
  if (action.kind === "DISCLOSE_FACT") {
    const factId = String(action.payload.factId ?? "");
    const fact = state.facts.find((item) => item.factId === factId);
    if (!fact) return { gate: "constraint", passed: false, code: "CONSTRAINT_VIOLATION", reason: `unknown fact ${factId}` };
    if (state.round < 2 && fact.kind === "order_quality") return { gate: "constraint", passed: false, code: "CONSTRAINT_VIOLATION", reason: "order quality may only be disclosed in due-diligence round 2 or later" };
  }
  if (action.kind === "ACCEPT_POLICY" || action.kind === "REJECT_POLICY") {
    const policyId = String(action.payload.policyId ?? "");
    const policy = Object.values(state.cities).flatMap((city) => city.policies).find((item) => item.policyId === policyId);
    if (!policy || policy.status !== "issued") return { gate: "constraint", passed: false, code: "CONSTRAINT_VIOLATION", reason: `policy ${policyId} is not open` };
  }
  return { gate: "constraint", passed: true, reason: "budget, resource, lifecycle and red-line constraints passed" };
}

function containsForbiddenKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsForbiddenKey);
  if (value === null || typeof value !== "object") return false;
  return Object.entries(value).some(([key, nested]) => ["desiredOutcome", "winner", "forceAgreement"].includes(key) || containsForbiddenKey(nested));
}

export function toPolicyPack(action: AgentAction, worldVersion: number): PolicyPack {
  const payload = PolicyPayloadSchema.parse(action.payload);
  return {
    policyId: payload.policyId,
    cityId: payload.cityId,
    decisionMode: payload.decisionMode,
    terms: payload.terms.map((term) => ({
      termId: term.termId,
      type: term.type,
      ...(term.amountMillionCny !== undefined ? { amountMillionCny: term.amountMillionCny } : {}),
      ...(term.quantity !== undefined ? { quantity: term.quantity } : {}),
      ...(term.trigger !== undefined ? { trigger: term.trigger } : {}),
      ...(term.deadline !== undefined ? { deadline: term.deadline } : {}),
      ...(term.failureAction !== undefined ? { failureAction: term.failureAction } : {}),
    })),
    issuerId: action.actorId,
    status: "issued",
    issuedAtVersion: worldVersion,
  };
}
