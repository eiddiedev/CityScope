import { z } from "zod";

export const SCHEMA_VERSION = "cityscope.contract.v0" as const;

export const actionKinds = [
  "ADVISE_POLICY",
  "SUBMIT_POLICY_PACK",
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
  "ISSUE_COORDINATION_OPINION",
  "AUDIT_POLICY_PACK",
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
  | "sign_company_response"
  | "request_audit"
  | "disclose_fact"
  | "decide_financing"
  | "accept_policy"
  | "withdraw_commitment"
  | "exit_project"
  | "publish_reaction"
  | "coordinate"
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
  fiscal: { availableMillionCny: number; committedMillionCny: number; paidMillionCny: number };
  resources: { landHectares: number; factorySqm: number; talentHousingUnits: number; energyMw: number };
  resourceLedger: ResourceLedger;
  policyTools: string[];
  objectiveWeights: Record<string, number>;
  industryGoals: string[];
  policyCredibility: number;
  internalAdvice: Array<{ actionId: string; actorId: string; proposal: unknown }>;
  policies: PolicyPack[];
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
  coordinationOpinions: CoordinationOpinion[];
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
    phase: "internal_advice" | "policy_formation" | "policy_audit" | "stakeholder_reaction" | "company_deliberation" | "due_diligence" | "post_disclosure" | "delivery" | "delivery_reaction" | "complete";
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
  label: "CHENGDU_LED" | "CHONGQING_LED" | "DUAL_CITY" | "PROJECT_EXITED" | "CONTINUING_COMMITMENTS";
  evidence: string[];
  classifiedAtVersion: number;
}

export interface ApplyResult {
  state: WorldState;
  receipt: DecisionReceipt;
  events: WorldEvent[];
}
