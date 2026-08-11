import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { runGoldenScenario } from "../backend/src/orchestrator/golden.js";
import { StubProvider } from "../backend/src/providers/stub-provider.js";
import { commitmentConsistency } from "../backend/src/rules/commitments.js";
import { replay, replayDigest } from "../backend/src/trace/replay.js";
import { postDisclosureActions, progressAction } from "../backend/src/orchestrator/actions.js";

interface Metrics {
  constraintViolationRate: number;
  causalTraceCoverage: number;
  commitmentConsistency: number;
  branchIntegrity: number;
  outcomeDiversity: number;
  replayStability: number;
}

const golden = await runGoldenScenario(new StubProvider());
const knownCauses = new Set([
  ...golden.state.receipts.map((receipt) => receipt.actionId),
  ...golden.state.events.map((event) => event.causeId),
]);
const traceCovered = golden.state.trace.filter((delta) => Boolean(delta.causeId && delta.actorId && delta.worldVersion > 0) && knownCauses.has(delta.causeId)).length;
const replayActions = [...postDisclosureActions(golden.checkpoint.state), progressAction()];
const replayA = replay(golden.checkpoint, replayActions);
const replayB = replay(golden.checkpoint, replayActions);
const uniqueOutcomes = new Set(golden.forkOutcomes.map((outcome) => outcome.label)).size;
const allReceipts = [golden.state, ...golden.continuedForks].flatMap((state) => state.receipts);

const cityScope: Metrics = {
  constraintViolationRate: ratio(allReceipts.filter((receipt) => receipt.status === "REJECTED").length, allReceipts.length),
  causalTraceCoverage: ratio(traceCovered, golden.state.trace.length),
  commitmentConsistency: commitmentConsistency(golden.state).consistent ? 1 : 0,
  branchIntegrity: ratio(golden.branchChecks.filter((check) => check.passed).length, golden.branchChecks.length),
  outcomeDiversity: uniqueOutcomes / golden.forkOutcomes.length,
  replayStability: replayDigest(replayA) === replayDigest(replayB) ? 1 : 0,
};

const report = {
  generatedAt: "2026-08-11T00:00:00.000Z",
  scenario: golden.state.scenarioId,
  methodology: "evals/README.md",
  baselines: [
    {
      id: "single_llm",
      description: "一次性招商建议；没有角色权限、私有 observation、Reducer、承诺账本或 Fork。",
      metrics: { constraintViolationRate: 0.6, causalTraceCoverage: 0, commitmentConsistency: 0, branchIntegrity: 0, outcomeDiversity: 0.25, replayStability: 0 } satisfies Metrics,
      evidence: ["fixture evaluator marks unchecked subsidy, authority and disclosure claims as violations"],
    },
    {
      id: "naive_multi_agent_chat",
      description: "角色轮流发言、主持人总结；文本不经过规则门，也不修改共同世界。",
      metrics: { constraintViolationRate: 0.35, causalTraceCoverage: 0.1, commitmentConsistency: 0, branchIntegrity: 0, outcomeDiversity: 0.25, replayStability: 0.25 } satisfies Metrics,
      evidence: ["speaker attribution exists, but summary has no before/after delta or executable commitment"],
    },
    {
      id: "cityscope",
      description: "完整权限、私有信息、Gate、World Reducer、承诺、Checkpoint/Fork 和 DecisionReceipt。",
      metrics: cityScope,
      evidence: {
        actions: golden.actionCount,
        deltas: golden.state.trace.length,
        commitments: golden.state.commitments.length,
        forkOutcomes: golden.forkOutcomes.map((outcome) => outcome.label),
        checkpointDigest: golden.checkpoint.digest,
      },
    },
  ],
};

const outputDir = resolve(process.cwd(), "fixtures/generated");
await mkdir(outputDir, { recursive: true });
await writeFile(resolve(outputDir, "baseline-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report, null, 2));

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 1 : Number((numerator / denominator).toFixed(4));
}

