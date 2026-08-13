import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { behaviorAgents, deterministicServices, manifests } from "./agents/manifests.js";
import { SCHEMA_VERSION, type AgentAction, type WorldState } from "./domain.js";
import { runAutonomousGolden } from "./orchestrator/golden.js";
import { SimulationEngine } from "./orchestrator/engine.js";
import { StubProvider } from "./providers/stub-provider.js";
import { commitmentConsistency } from "./rules/commitments.js";
import { replayDigest } from "./trace/replay.js";
import { deriveSemanticEffects } from "./world/semantics.js";
import { DecisionSupportService } from "./decision-support/service.js";
import { compareCausalRuns } from "./trace/causal-comparison.js";
import type { AutonomousStep } from "./orchestrator/autonomous.js";

const CONTRACT_VERSION = "0.1.0";
const FIXTURE_VERSION = "0.1.0";
const provider = new StubProvider();
const golden = await runAutonomousGolden(provider, 20260800, new DecisionSupportService("auto"));
const sameSeed = await runAutonomousGolden(new StubProvider(), 20260800, new DecisionSupportService("auto"));
const engine = new SimulationEngine(provider);

const redlineCandidate: AgentAction = {
  actionId: "candidate_probe_chengdu_over_budget",
  actorId: "chengdu_leader",
  kind: "SUBMIT_POLICY_PACK",
  reasoning: "压力测试：尝试一次性占用超出成都可用额度的财政和土地资源",
  payload: {
    policyId: "policy_probe_chengdu_over_budget",
    cityId: "chengdu",
    decisionMode: "COMPROMISE",
    terms: [
      {
        termId: "probe_cash",
        type: "cash_support",
        amountMillionCny: 1800,
        trigger: { metric: "verifiedInvestmentMillionCny", operator: ">=", value: 100 },
        deadline: "year_1",
        failureAction: "cancel_payment"
      },
      { termId: "probe_land", type: "land", quantity: 500 }
    ]
  },
  evidenceFactIds: [],
  promptVersion: manifests.chengdu_leader?.actorKind === "agent" ? manifests.chengdu_leader.promptVersion : "cityscope-chengdu_leader.v2",
  schemaVersion: SCHEMA_VERSION
};

const redlineResult = engine.applyExternalAction(golden.checkpoint.state, redlineCandidate);
if (redlineResult.receipt.status !== "REJECTED" || redlineResult.receipt.deltas.length !== 0) {
  throw new Error("redline probe must be rejected without StateDelta");
}

const baselineAutonomousSteps = [...golden.checkpointContinuation.steps, ...golden.rootContinuation.steps];
const steps = projectSteps(baselineAutonomousSteps, golden.state);

function projectSteps(sourceSteps: AutonomousStep[], state: WorldState) {
  return sourceSteps.map((step) => {
  const receipt = state.receipts.find((item) => item.receiptId === step.receiptId);
  if (!receipt) throw new Error(`missing receipt ${step.receiptId}`);
  return {
    phase: step.phase,
    actorId: step.actorId,
    actorKind: manifests[step.actorId]?.actorKind ?? "agent",
    generationSource: step.generationSource,
    candidate: step.candidate,
    receipt
  };
  });
}

const fixture = {
  contractVersion: CONTRACT_VERSION,
  fixtureVersion: FIXTURE_VERSION,
  schemaVersion: SCHEMA_VERSION,
  scenario: {
    id: golden.state.scenarioId,
    title: "星岚机器人西部总部与智能制造基地落地推演",
    company: "星岚机器人",
    investmentMillionCny: 3000,
    cities: ["chengdu", "chongqing"]
  },
  actorRegistry: [...behaviorAgents, ...deterministicServices],
  baseline: {
    runId: golden.state.runId,
    runMode: "autonomous",
    provider: provider.id,
    model: provider.model,
    terminalState: golden.state,
    semanticEffects: deriveSemanticEffects(golden.state),
    steps,
    checkpoint: golden.checkpoint,
    classification: requireClassification(golden.state)
  },
  redlineProbe: {
    label: "成都超预算政策候选（独立 Gate 压力测试，不写入主世界）",
    candidate: redlineCandidate,
    receipt: redlineResult.receipt
  },
  forks: golden.continuedForks.map((state, index) => {
    const continuation = golden.forkContinuations[index];
    if (!continuation) throw new Error(`missing fork continuation for ${state.runId}`);
    return {
    runId: state.runId,
    parentRunId: state.parentRunId ?? golden.checkpoint.sourceRunId,
    intervention: requireIntervention(state),
    terminalState: state,
    semanticEffects: deriveSemanticEffects(state),
    classification: requireClassification(state),
    steps: projectSteps(continuation.steps, state),
    causalComparison: compareCausalRuns(
      golden.state,
      state,
      baselineAutonomousSteps,
      [...golden.checkpointContinuation.steps, ...continuation.steps]
    )
  }; }),
  eval: evaluationRows(golden.state, golden.continuedForks, golden.branchChecks, golden.forkOutcomes.map((item) => item.label), sameSeed.state)
};

const outputDir = resolve(process.cwd(), "fixtures/v0");
await mkdir(outputDir, { recursive: true });
// The fixture is a runtime asset, not a hand-edited report. Keeping it compact
// avoids inflating repository line counts while preserving the signed evidence.
await writeFile(resolve(outputDir, "cityscope-demo.json"), `${JSON.stringify(fixture)}\n`, "utf8");
console.log(JSON.stringify({
  fixture: "fixtures/v0/cityscope-demo.json",
  contractVersion: CONTRACT_VERSION,
  fixtureVersion: FIXTURE_VERSION,
  actors: fixture.actorRegistry.length,
  steps: fixture.baseline.steps.length,
  redlineStatus: fixture.redlineProbe.receipt.status,
  outcomes: [fixture.baseline.classification.label, ...fixture.forks.map((fork) => fork.classification.label)]
}, null, 2));

function requireClassification(state: WorldState) {
  if (!state.terminal || !state.simulation.classification) throw new Error(`run ${state.runId} has no terminal classification`);
  return state.simulation.classification;
}

function requireIntervention(state: WorldState) {
  if (!state.intervention) throw new Error(`fork ${state.runId} has no intervention`);
  return state.intervention;
}

function evaluationRows(
  baseline: WorldState,
  forks: WorldState[],
  branchChecks: Array<{ passed: boolean }>,
  outcomes: string[],
  sameSeed: WorldState
) {
  const knownCauses = new Set([...baseline.receipts.map((item) => item.actionId), ...baseline.events.map((item) => item.causeId)]);
  const covered = baseline.trace.filter((item) => knownCauses.has(item.causeId)).length;
  const receipts = [baseline, ...forks].flatMap((state) => state.receipts);
  const cityscope = {
    constraintViolationRate: ratio(receipts.filter((item) => item.status === "REJECTED").length, receipts.length),
    causalTraceCoverage: ratio(covered, baseline.trace.length),
    commitmentConsistency: commitmentConsistency(baseline).consistent ? 1 : 0,
    branchIntegrity: ratio(branchChecks.filter((item) => item.passed).length, branchChecks.length),
    outcomeDiversity: ratio(new Set(outcomes).size, outcomes.length),
    replayStability: replayDigest(baseline) === replayDigest(sameSeed) ? 1 : 0
  };
  return [
    {
      id: "single_llm",
      description: "一次性建议，无权限门、共同世界、承诺账本或可验证分支。",
      metrics: { constraintViolationRate: 0.6, causalTraceCoverage: 0, commitmentConsistency: 0, branchIntegrity: 0, outcomeDiversity: 0.25, replayStability: 0 },
      provenance: "受限 baseline fixture；不是现场模型采样"
    },
    {
      id: "naive_multi_agent_chat",
      description: "角色轮流发言并总结，但文本不经过规则门也不修改共同世界。",
      metrics: { constraintViolationRate: 0.35, causalTraceCoverage: 0.1, commitmentConsistency: 0, branchIntegrity: 0, outcomeDiversity: 0.25, replayStability: 0.25 },
      provenance: "受限 baseline fixture；不是现场模型采样"
    },
    {
      id: "cityscope",
      description: "权限、私有观察、Gate、Reducer、承诺、Checkpoint/Fork 与 DecisionReceipt 全链路。",
      metrics: cityscope,
      provenance: `真实确定性运行：${baseline.runId}，${baseline.receipts.length} receipts，${baseline.trace.length} deltas`
    }
  ];
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 1 : Number((numerator / denominator).toFixed(4));
}
