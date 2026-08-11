import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { providerFromEnv } from "./providers/index.js";
import { runGoldenScenario } from "./orchestrator/golden.js";
import { commitmentConsistency } from "./rules/commitments.js";

const provider = providerFromEnv();
const run = await runGoldenScenario(provider);
const summary = {
  mode: provider.id === "stub" ? "DEMO_MODE" : "LIVE_WITH_DETERMINISTIC_FALLBACK",
  provider: provider.id,
  model: provider.model,
  runId: run.state.runId,
  worldVersion: run.state.worldVersion,
  actionCount: run.actionCount,
  appliedReceipts: run.state.receipts.filter((receipt) => receipt.status === "APPLIED").length,
  rejectedReceipts: run.state.receipts.filter((receipt) => receipt.status === "REJECTED").length,
  stateDeltaCount: run.state.trace.length,
  eventCount: run.state.events.length,
  metrics: run.state.metrics,
  projectStage: run.state.company.projectStage,
  commitments: run.state.commitments.map((item) => ({ id: item.commitmentId, status: item.status, amountMillionCny: item.amountMillionCny, trigger: item.trigger })),
  commitmentConsistency: commitmentConsistency(run.state),
  checkpoint: { id: run.checkpoint.checkpointId, version: run.checkpoint.createdAtVersion, digest: run.checkpoint.digest },
  forks: run.forks.map((fork, index) => ({ runId: fork.runId, intervention: fork.intervention, integrity: run.branchChecks[index], outcomeAfterIndependentContinuation: run.forkOutcomes[index] })),
  terminalOutcome: run.outcome,
};

const fixtureDir = resolve(process.cwd(), "fixtures/generated");
await mkdir(fixtureDir, { recursive: true });
await writeFile(resolve(fixtureDir, "golden-run.json"), `${JSON.stringify({ summary, terminalState: run.state, forkTerminalStates: run.continuedForks }, null, 2)}\n`, { encoding: "utf8", mode: 0o644 });
console.log(JSON.stringify(summary, null, 2));

