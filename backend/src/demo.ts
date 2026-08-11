import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { providerFromEnv } from "./providers/index.js";
import { runAutonomousGolden, runReplayDemo } from "./orchestrator/golden.js";
import { commitmentConsistency } from "./rules/commitments.js";
import { behaviorAgents, deterministicServices } from "./agents/manifests.js";
import { deriveSemanticEffects } from "./world/semantics.js";

const provider = providerFromEnv();
const autonomous = await runAutonomousGolden(provider);
const replayDemo = runReplayDemo();
const autonomousSteps = [...autonomous.checkpointContinuation.steps, ...autonomous.rootContinuation.steps];
const actorActivity = Object.fromEntries([...behaviorAgents, ...deterministicServices].map((actor) => [actor.agentId, autonomousSteps.filter((step) => step.actorId === actor.agentId).map((step) => step.candidateKind)]));
const autonomousSummary = {
  mode: autonomous.mode,
  provider: provider.id,
  model: provider.model,
  qwenConnected: provider.id === "qwen",
  eligibleOrder: [...autonomous.checkpointContinuation.eligibleOrder, ...autonomous.rootContinuation.eligibleOrder],
  candidates: autonomousSteps,
  gateRejected: autonomousSteps.filter((step) => step.gateRejected),
  actorActivity,
  stateDeltaCount: autonomous.state.trace.length,
  eventCount: autonomous.state.events.length,
  metrics: autonomous.state.metrics,
  stakeholders: autonomous.state.stakeholders,
  semanticEffects: deriveSemanticEffects(autonomous.state),
  commitmentConsistency: commitmentConsistency(autonomous.state),
  checkpoint: { id: autonomous.checkpoint.checkpointId, version: autonomous.checkpoint.createdAtVersion, digest: autonomous.checkpoint.digest },
  forks: autonomous.continuedForks.map((fork) => ({ runId: fork.runId, intervention: fork.intervention, actionKinds: fork.receipts.slice(autonomous.checkpoint.state.receipts.length).map((receipt) => ({ actorId: receipt.actorId, status: receipt.status, actionId: receipt.actionId })), classification: fork.simulation.classification })),
  classification: autonomous.state.simulation.classification,
};
const replaySummary = { mode: replayDemo.mode, networkRequired: false, actionCount: replayDemo.actionCount, replayStable: replayDemo.replayStable, digest: replayDemo.digest };
const frontendCompatibility = {
  schemaVersion: autonomous.state.snapshot.schemaVersion,
  state: autonomous.state,
  semanticEffects: deriveSemanticEffects(autonomous.state),
  recentEvents: autonomous.state.events.slice(-12),
  recentDeltas: autonomous.state.trace.slice(-20),
  resourceGateReceipts: autonomous.state.receipts.flatMap((receipt) => receipt.gateResults.flatMap((gate) => gate.calculations ?? [])),
};

const fixtureDir = resolve(process.cwd(), "fixtures/generated");
await mkdir(fixtureDir, { recursive: true });
await Promise.all([
  writeFile(resolve(fixtureDir, "autonomous-run.json"), `${JSON.stringify({ summary: autonomousSummary, terminalState: autonomous.state, forkTerminalStates: autonomous.continuedForks }, null, 2)}\n`, "utf8"),
  writeFile(resolve(fixtureDir, "replay-demo.json"), `${JSON.stringify({ summary: replaySummary, terminalState: replayDemo.state }, null, 2)}\n`, "utf8"),
  writeFile(resolve(fixtureDir, "golden-run.json"), `${JSON.stringify({ notice: "Compatibility wrapper: Autonomous and Replay evidence are reported separately", autonomous: autonomousSummary, replayDemo: replaySummary }, null, 2)}\n`, "utf8"),
  writeFile(resolve(fixtureDir, "frontend-compatibility.json"), `${JSON.stringify(frontendCompatibility, null, 2)}\n`, "utf8"),
]);
console.log(JSON.stringify({ autonomous: autonomousSummary, replayDemo: replaySummary }, null, 2));
