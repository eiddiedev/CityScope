import type { Checkpoint, Intervention, Outcome, WorldState } from "../domain.js";
import { createInitialState } from "../world/initial-state.js";
import { classifyAndAttachOutcome, terminate } from "../world/outcome.js";
import { createCheckpoint, forkFromCheckpoint, verifyBranchIntegrity } from "../trace/checkpoint.js";
import { replay, replayDigest } from "../trace/replay.js";
import { SimulationEngine } from "./engine.js";
import { continueAutonomously, type AutonomousContinuation } from "./autonomous.js";
import { replayPostDisclosureActions, replayPreDisclosureActions, replayProgressAction } from "./actions.js";
import type { LLMProvider } from "../providers/types.js";

export interface AutonomousGoldenRun {
  mode: "AUTONOMOUS_MODE";
  checkpoint: Checkpoint;
  checkpointContinuation: AutonomousContinuation;
  rootContinuation: AutonomousContinuation;
  stateBeforeClassification: WorldState;
  state: WorldState;
  forks: WorldState[];
  continuedForks: WorldState[];
  branchChecks: Array<{ passed: boolean; differences: string[] }>;
  forkOutcomes: Outcome[];
}

export interface ReplayDemoRun {
  mode: "REPLAY_DEMO_MODE";
  state: WorldState;
  actionCount: number;
  replayStable: boolean;
  digest: string;
}

export async function runAutonomousGolden(provider: LLMProvider, seed = 20260811): Promise<AutonomousGoldenRun> {
  const engine = new SimulationEngine(provider);
  const initial = createInitialState("run_autonomous", seed, "autonomous");
  initial.snapshot.provider = provider.id;
  initial.snapshot.model = provider.model;
  const checkpointContinuation = await continueAutonomously(engine, initial, { stopAfterPhase: "due_diligence", terminateAtComplete: false });
  const checkpoint = createCheckpoint(checkpointContinuation.state, "checkpoint_autonomous_post_disclosure");
  const interventions: Intervention[] = [
    oneChange("intervention_public_trust", "stakeholders.publicTrust", checkpoint.state.stakeholders.publicTrust, Math.min(100, checkpoint.state.stakeholders.publicTrust + 10), "提高已验证信息公开度"),
    oneChange("intervention_supply_readiness", "stakeholders.supplyChainReadiness", checkpoint.state.stakeholders.supplyChainReadiness, Math.min(100, checkpoint.state.stakeholders.supplyChainReadiness + 12), "提高本地供应链准备度"),
    oneChange("intervention_scale_down", "company.investmentPlanMillionCny", checkpoint.state.company.investmentPlanMillionCny, 2200, "企业缩小一期投资规模"),
    oneChange("intervention_financing_shock", "metrics.financingConfidence", checkpoint.state.metrics.financingConfidence, 5, "外部融资市场冲击"),
  ];
  const forks = interventions.map((intervention) => forkFromCheckpoint(checkpoint, `fork_${intervention.interventionId}`, intervention));
  const branchChecks = forks.map((fork) => verifyBranchIntegrity(checkpoint, fork));
  const rootContinuation = await continueAutonomously(engine, checkpoint.state);
  const stateBeforeClassification = rootContinuation.state;
  const state = classifyAndAttachOutcome(stateBeforeClassification);
  const forkContinuations = await Promise.all(forks.map((fork) => continueAutonomously(engine, fork)));
  const continuedForks = forkContinuations.map((continuation) => classifyAndAttachOutcome(continuation.state));
  const forkOutcomes = continuedForks.map((fork) => requiredClassification(fork));
  return { mode: "AUTONOMOUS_MODE", checkpoint, checkpointContinuation, rootContinuation, stateBeforeClassification, state, forks, continuedForks, branchChecks, forkOutcomes };
}

export function runReplayDemo(): ReplayDemoRun {
  const initial = createInitialState("run_replay_demo", 20260811, "replay");
  const actions = [...replayPreDisclosureActions(), ...replayPostDisclosureActions(initial), replayProgressAction()];
  const first = terminate(replay(createCheckpoint(initial, "checkpoint_replay_origin"), actions), "replay fixture horizon");
  const second = terminate(replay(createCheckpoint(initial, "checkpoint_replay_origin"), actions), "replay fixture horizon");
  return { mode: "REPLAY_DEMO_MODE", state: first, actionCount: actions.length, replayStable: replayDigest(first) === replayDigest(second), digest: replayDigest(first) };
}

export const runGoldenScenario = runAutonomousGolden;

function oneChange(interventionId: string, path: string, previousValue: unknown, newValue: unknown, reason: string): Intervention {
  return { interventionId, path, previousValue, newValue, reason };
}

function requiredClassification(state: WorldState): Outcome {
  if (state.simulation.outcomeStatus !== "classified" || !state.simulation.classification) throw new Error("classification missing after terminal classifier");
  return state.simulation.classification;
}
