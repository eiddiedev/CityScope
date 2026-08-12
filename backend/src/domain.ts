import { z } from "zod";

export const SCHEMA_VERSION = "cityscope.contract.v0" as const;

export const actionKinds = [
  "ADVISE_POLICY",
  "SUBMIT_POLICY_PACK",
  "REVISE_POLICY_PACK",
  "WITHDRAW_CITY_OFFER",
  "ADVISE_COMPANY_RESPONSE",
  "SUBMIT_COMPANY_RESPONSE",
  "ADVISE_FINANCING",
  "REQUEST_DUE_DILIGENCE",
  "DISCLOSE_FACT",
  "ACCEPT_POLICY",
  "REJECT_POLICY",
  "WITHDRAW_COMMITMENT",
  "EXIT_PROJECT",
  "ADVANCE_PROJECT",
  "PUBLISH_STAKEHOLDER_REACTION",
  "SEND_DEBATE_MESSAGE",
  "ISSUE_COORDINATION_OPINION",
  "PROPOSE_COORDINATION_PLAN",
  "RESPOND_COORDINATION_PLAN",
  "AUDIT_COORDINATION_PLAN",
  "ACCEPT_COORDINATION_PLAN",
  "AUDIT_POLICY_PACK",
  "ASSESS_LONG_TERM_IMPACT",
  "PASS",
] as const;

export const AgentActionSchema = z
  .object({
    actionId: z.string().min(1),
    actorId: z.string().min(1),
    kind: z.enum(actionKinds),
    reasoning: z.string().min(1),
    payload: z.record(z.unknown()),
    evidenceFactIds: z.array(z.string()).default([]),
    promptVersion: z.string().min(1),
    schemaVersion: z.literal(SCHEMA_VERSION),
  })
  .strict();

export type AgentAction = z.infer<typeof AgentActionSchema>;
export type ActionKind = AgentAction["kind"];

export type Permission =
  | "propose"
  | "revise"
  | "recommend"
  | "sign_policy"
  | "withdraw_city_offer"
  | "sign_company_response"
  | "request_audit"
  | "disclose_fact"
  | "decide_financing"
  | "accept_policy"
  | "withdraw_commitment"
  | "exit_project"
  | "publish_reaction"
  | "debate"
  | "coordinate"
  | "respond_coordination"
  | "accept_coordination"
  | "audit_policy"
  | "pass"
  | "advance_project";

export type ActorKind = "agent" | "service";

export interface UtilityDimension {
  dimension: string;
  weight: number;
  direction: "maximize" | "minimize";
}

interface ActorManifestBase {
  manifestVersion: "0.1";
  agentId: string;
  displayName: string;
  organization: "superior" | "chengdu" | "chongqing" | "company" | "capital" | "stakeholder" | "rule_service";
  role: string;
  actorKind: ActorKind;
  reportsTo?: string;
  permissions: Permission[];
  forbidden: string[];
  privateFactScopes: string[];
  provenance: { source: string; verifiedAt: string };
}

export interface AgentManifest extends ActorManifestBase {
  actorKind: "agent";
  goals: string[];
  redLines: string[];
  utility: UtilityDimension[];
  promptVersion: string;
}

export interface ServiceManifest extends ActorManifestBase {
  actorKind: "service";
  deterministicResponsibilities: string[];
}

export type ActorManifest = AgentManifest | ServiceManifest;

export type ResourceKind = "fiscalMillionCny" | "landHectares" | "factorySqm" | "energyMw" | "talentHousingUnits";

export interface ResourceAccount {
  capacity: number;
  available: number;
  reserved: number;
  committed: number;
  paid: number;
  released: number;
}

export type ResourceLedger = Record<ResourceKind, ResourceAccount>;

export interface ResourceCalculation {
  tool: "fiscal" | "land_facility" | "energy" | "talent_housing";
  resource: ResourceKind;
  requested: number;
  available: number;
  reserved: number;
  committed: number;
  paid: number;
  released: number;
  remaining: number;
  passed: boolean;
  reasonCode: "RESOURCE_OK" | "RESOURCE_EXCEEDED" | "INVALID_RESOURCE_REQUEST";
  evidence: string[];
}

export interface PolicyTerm {
  termId: string;
  type: "cash_support" | "land" | "facility" | "energy" | "talent_housing" | "demo_order" | "output_floor" | "jobs_milestone";
  amountMillionCny?: number;
  quantity?: number;
  trigger?: Trigger;
  deadline?: string;
  failureAction?: "cancel_payment" | "clawback" | "renegotiate";
}

export interface PolicyPack {
  policyId: string;
  cityId: CityId;
  issuerId: string;
  decisionMode: "ACCEPT_INVESTMENT" | "ACCEPT_FINANCE" | "COMPROMISE" | "RETURN_FOR_REVISION";
  terms: PolicyTerm[];
  status: "issued" | "accepted" | "rejected" | "withdrawn";
  auditStatus: "pending" | "approved" | "flagged" | "repair_required";
  resourceCalculations: ResourceCalculation[];
  issuedAtVersion: number;
  version: number;
  supersedesPolicyId?: string;
  candidateId?: string;
  investmentMillionCny: number;
}

export interface PolicyRevision {
  revisionId: string;
  cityId: CityId;
  fromPolicyId: string;
  toPolicyId: string;
  candidateId: string;
  changedTerms: Array<{ termId: string; before: PolicyTerm | null; after: PolicyTerm | null }>;
  createdAtVersion: number;
}

export interface CompanyResponse {
  responseId: string;
  issuerId: string;
  targetPolicyIds: string[];
  requestedChanges: Array<{ policyId: string; termId: string; requestedValue: number }>;
  status: "issued" | "accepted" | "rejected";
}

export interface Trigger {
  metric: "verifiedJobs" | "verifiedInvestmentMillionCny" | "bindingOrderRatio" | "annualOutputMillionCny";
  operator: ">=";
  value: number;
}

export interface Commitment {
  commitmentId: string;
  sourcePolicyId: string;
  payer: string;
  beneficiary: string;
  amountMillionCny: number;
  trigger?: Trigger;
  deadline?: string;
  failureAction: "cancel_payment" | "clawback" | "renegotiate";
  status: "approved" | "due" | "paid" | "failed" | "withdrawn";
  createdAtVersion: number;
  lastCauseId: string;
}

export interface Fact {
  factId: string;
  kind: "cash_runway" | "order_quality" | "financing_market" | "policy_capacity";
  value: unknown;
  ownerId: string;
  visibility: "private" | "disclosed";
  audience: string[];
  disclosedAtVersion?: number;
}

export interface CityState {
  cityId: CityId;
  bidStatus: "competing" | "revising" | "withdrawn" | "closed" | "accepted";
  fiscal: { availableMillionCny: number; committedMillionCny: number; paidMillionCny: number };
  resources: { landHectares: number; factorySqm: number; talentHousingUnits: number; energyMw: number };
  resourceLedger: ResourceLedger;
  policyTools: string[];
  objectiveWeights: Record<string, number>;
  industryGoals: string[];
  policyCredibility: number;
  internalAdvice: Array<{ actionId: string; actorId: string; proposal: unknown }>;
  policies: PolicyPack[];
  policyRevisions: PolicyRevision[];
}

export interface StakeholderState {
  talentAttraction: number;
  smeParticipation: number;
  supplyChainReadiness: number;
  housingPressure: number;
  residentSupport: number;
  fiscalFairnessConcern: number;
  trafficOrEnergyPressure: number;
  publicTrust: number;
}

export interface CoordinationOpinion {
  opinionId: string;
  actorId: "regional_coordinator";
  policyIds: string[];
  recommendation: "split_functions" | "reduce_duplicate_subsidy" | "no_coordination_needed";
  reasonCodes: string[];
  threadId?: string;
  summary?: string;
  concessions?: string[];
}

export type ProjectFunctionId = "headquarters" | "rd_center" | "smart_factory" | "supply_chain_base" | "training_center";

export interface CoordinationResponse {
  cityId: CityId;
  actorId: "chengdu_leader" | "chongqing_leader";
  decision: "accept" | "conditional" | "reject";
  conditions: string[];
  respondedAtVersion: number;
}

export interface CoordinationPlan {
  planId: string;
  actorId: "regional_coordinator";
  candidateId: string;
  sourcePolicyIds: string[];
  assignments: Record<ProjectFunctionId, CityId | "none">;
  cityTerms: Record<CityId, PolicyTerm[]>;
  investmentMillionCny: number;
  milestones: Trigger[];
  commonPlatform: { name: string; payerShares: Record<CityId, number> };
  concessions: Record<CityId, string[]>;
  responses: Partial<Record<CityId, CoordinationResponse>>;
  auditStatus: "pending" | "approved" | "repair_required";
  auditReasonCodes: string[];
  status: "proposed" | "accepted" | "rejected";
  createdAtVersion: number;
}

export interface FinalDecision {
  decisionId: string;
  type: "single_city" | "coordination" | "regional_exit";
  cityId?: CityId;
  policyId?: string;
  coordinationPlanId?: string;
  actorId: "company_board";
  decidedAtVersion: number;
  causeId: string;
}

export interface ImpactAssessment {
  horizonMonths: 12 | 24;
  actualInvestmentMillionCny: number;
  actualJobs: number;
  orderConversionRatio: number;
  capacityUtilization: number;
  subsidyPaidMillionCny: number;
  subsidyCancelledMillionCny: number;
  subsidyClawedBackMillionCny: number;
  fiscalPressure: Record<CityId, number>;
  smeCrowdingOut: number;
  talentPressure: number;
  housingPressure: number;
  governmentCredibility: Record<CityId, number>;
  publicTrust: number;
  policySuccess: "successful" | "mixed" | "failed" | "not_landed";
  evidence: string[];
  assessedAtVersion: number;
}

export interface OutcomeBasis {
  decisionType: FinalDecision["type"];
  finalDecisionId: string;
  requiredActionIds: string[];
  approvalIds: string[];
  causeIds: string[];
}

export interface DebateMessage {
  messageId: string;
  threadId: string;
  actorId: string;
  sequence: number;
  turnType: "challenge" | "position" | "proposal" | "counter" | "concession";
  issue: "functional_allocation" | "duplicate_subsidy" | "fiscal_risk";
  stance: "support" | "oppose" | "conditional" | "mediate";
  content: string;
  audience: string[];
  visibility: "participants" | "public";
  replyToMessageId?: string;
  createdAtVersion: number;
}

export interface DebateThread {
  threadId: string;
  topic: string;
  participantIds: string[];
  status: "open" | "resolved" | "deadlocked";
  messages: DebateMessage[];
  resolutionOpinionId?: string;
}

export type CityId = "chengdu" | "chongqing";

export interface StateDelta {
  deltaId: string;
  causeId: string;
  path: string;
  before: unknown;
  after: unknown;
  actorId: string;
  worldVersion: number;
}

export interface GateResult {
  gate: "schema" | "authority" | "constraint" | "privacy";
  passed: boolean;
  code?: string;
  reason: string;
  calculations?: ResourceCalculation[];
}

export interface DecisionReceipt {
  receiptId: string;
  actionId: string;
  actorId: string;
  status: "APPLIED" | "REJECTED";
  gateResults: GateResult[];
  evidence: Array<{ kind: "fact" | "policy" | "state" | "action"; id: string; digest: string }>;
  deltas: StateDelta[];
  worldVersion: number;
}

export interface WorldEvent {
  eventId: string;
  eventType:
    | "AgentActionProposed"
    | "ActionRejected"
    | "PolicyPackIssued"
    | "CompanyResponseIssued"
    | "FactDisclosed"
    | "DebateMessagePublished"
    | "CommitmentApproved"
    | "CommitmentStatusChanged"
    | "StateChanged"
    | "CheckpointCreated"
    | "ForkCreated"
    | "SimulationTerminated"
    | "OutcomeClassified";
  causeId: string;
  actorId: string;
  worldVersion: number;
  occurredAt: string;
  payload: Record<string, unknown>;
}

export interface ModelSnapshot {
  provider: string;
  model: string;
  promptVersions: Record<string, string>;
  seed: number;
  schemaVersion: typeof SCHEMA_VERSION;
}

export interface WorldState {
  scenarioId: string;
  runId: string;
  parentRunId?: string;
  interventionId?: string;
  intervention?: Intervention;
  worldVersion: number;
  round: number;
  terminal: boolean;
  terminalReason?: string;
  metrics: { trust: number; financingConfidence: number; projectViability: number };
  stakeholders: StakeholderState;
  debateThreads: DebateThread[];
  coordinationOpinions: CoordinationOpinion[];
  coordinationPlans: CoordinationPlan[];
  finalDecision?: FinalDecision;
  impactAssessments: ImpactAssessment[];
  cities: Record<CityId, CityState>;
  company: {
    cashRunwayMonths: number;
    investmentPlanMillionCny: number;
    verifiedInvestmentMillionCny: number;
    verifiedJobs: number;
    annualOutputMillionCny: number;
    bindingOrderRatio: number;
    projectStage: "courtship" | "due_diligence" | "negotiation" | "signed" | "delivery" | "renegotiation" | "completed" | "exited";
    internalAdvice: Array<{ actionId: string; actorId: string; proposal: unknown }>;
    responses: CompanyResponse[];
  };
  facts: Fact[];
  commitments: Commitment[];
  agentMemory: Record<string, Array<{ causeId: string; summary: string }>>;
  events: WorldEvent[];
  receipts: DecisionReceipt[];
  trace: StateDelta[];
  snapshot: ModelSnapshot;
  simulation: {
    mode: "autonomous" | "replay";
    phase: "internal_advice" | "policy_formation" | "policy_audit" | "stakeholder_reaction" | "company_deliberation" | "due_diligence" | "risk_reassessment" | "policy_revision" | "coordination_debate" | "coordination_resolution" | "final_deliberation" | "post_disclosure" | "delivery" | "delivery_reaction" | "impact_assessment" | "complete";
    cycle: number;
    outcomeStatus: "pending" | "classified";
    classification?: Outcome;
  };
}

export interface Intervention {
  interventionId: string;
  path: string;
  previousValue: unknown;
  newValue: unknown;
  reason: string;
}

export interface Checkpoint {
  checkpointId: string;
  sourceRunId: string;
  createdAtVersion: number;
  digest: string;
  state: WorldState;
}

export interface Outcome {
  label: "CHENGDU_LED" | "CHONGQING_LED" | "DUAL_CITY" | "PROJECT_EXITED";
  evidence: string[];
  classifiedAtVersion: number;
  basis?: OutcomeBasis;
}

export interface ApplyResult {
  state: WorldState;
  receipt: DecisionReceipt;
  events: WorldEvent[];
}
