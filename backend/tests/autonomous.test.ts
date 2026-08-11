import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { behaviorAgents, deterministicServices, manifests, validateManifestWeights } from "../src/agents/manifests.js";
import { continueAutonomously } from "../src/orchestrator/autonomous.js";
import { SimulationEngine } from "../src/orchestrator/engine.js";
import { runAutonomousGolden, runReplayDemo } from "../src/orchestrator/golden.js";
import { StubProvider } from "../src/providers/stub-provider.js";
import { replayDigest } from "../src/trace/replay.js";
import { classifyOutcome } from "../src/world/outcome.js";
import { createInitialState } from "../src/world/initial-state.js";

describe("16 collaboration subjects", () => {
  it("contains exactly 14 behavior agents and 2 deterministic services", () => {
    expect(behaviorAgents).toHaveLength(14);
    expect(deterministicServices).toHaveLength(2);
    expect(Object.keys(manifests)).toHaveLength(16);
    expect(new Set(deterministicServices.map((item) => item.agentId))).toEqual(new Set(["due_diligence_service", "world_resource_service"]));
    expect(behaviorAgents.every((item) => item.actorKind === "agent" && item.utility.length > 0 && item.redLines.length > 0 && item.promptVersion.length > 0)).toBe(true);
    expect(deterministicServices.every((item) => item.actorKind === "service" && !("promptVersion" in item) && !("utility" in item))).toBe(true);
    expect(validateManifestWeights()).toEqual([]);
  });
});

describe("autonomous continuation", () => {
  it("gives stakeholder and superior agents real applied receipts", async () => {
    const run = await runAutonomousGolden(new StubProvider());
    const steps = [...run.checkpointContinuation.steps, ...run.rootContinuation.steps];
    for (const actorId of ["talent_sme", "resident", "regional_coordinator", "policy_supervisor"]) {
      expect(steps.some((step) => step.actorId === actorId && step.status === "APPLIED")).toBe(true);
      expect(run.state.receipts.some((receipt) => receipt.actorId === actorId && receipt.status === "APPLIED")).toBe(true);
    }
    expect(steps.some((step) => step.candidateKind === "PASS")).toBe(true);
    expect(new Set(steps.map((step) => step.generationSource))).toEqual(new Set(["deterministic_stub", "deterministic_service"]));
  });

  it("does not accept a prewritten action list in Autonomous Mode", async () => {
    const engine = new SimulationEngine(new StubProvider());
    await expect(continueAutonomously(engine, createInitialState(), { actions: [] } as never)).rejects.toThrow("AUTONOMOUS_ACTION_LIST_FORBIDDEN");
  });

  it("uses one continuation implementation for every fork with no fork selector", async () => {
    const run = await runAutonomousGolden(new StubProvider());
    const receiptActorSequences = run.continuedForks.map((fork) => fork.receipts.slice(run.checkpoint.state.receipts.length).map((receipt) => receipt.actorId));
    expect(receiptActorSequences.every((sequence) => JSON.stringify(sequence) === JSON.stringify(receiptActorSequences[0]))).toBe(true);
    const source = readFileSync(new URL("../src/orchestrator/golden.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/index\s*===|fork_[0-9]|desiredOutcome|winner|forceAgreement/);
    expect(source.match(/continueAutonomously\(engine, fork\)/g)).toHaveLength(1);
  });

  it("is stable for the same seed and changes legal candidates for another seed", async () => {
    const first = await runAutonomousGolden(new StubProvider(), 321);
    const second = await runAutonomousGolden(new StubProvider(), 321);
    const different = await runAutonomousGolden(new StubProvider(), 322);
    expect(replayDigest(first.state)).toBe(replayDigest(second.state));
    const firstActions = [...first.checkpointContinuation.steps, ...first.rootContinuation.steps].map((step) => step.candidate.actionId);
    const differentActions = [...different.checkpointContinuation.steps, ...different.rootContinuation.steps].map((step) => step.candidate.actionId);
    expect(differentActions).not.toEqual(firstActions);
    expect(different.state.receipts.every((receipt) => receipt.status === "APPLIED" || receipt.status === "REJECTED")).toBe(true);
  });

  it("keeps outcome pending until terminal classifier and ignores injected user expectation", async () => {
    const run = await runAutonomousGolden(new StubProvider());
    expect(run.checkpoint.state.simulation.outcomeStatus).toBe("pending");
    expect(run.stateBeforeClassification.simulation.outcomeStatus).toBe("pending");
    expect(run.stateBeforeClassification.simulation.classification).toBeUndefined();
    const injected = structuredClone(run.stateBeforeClassification) as typeof run.stateBeforeClassification & { userExpectedOutcome?: string };
    injected.userExpectedOutcome = "PROJECT_EXITED";
    expect(classifyOutcome(injected).label).toBe(classifyOutcome(run.stateBeforeClassification).label);
    expect(run.state.simulation.outcomeStatus).toBe("classified");
  });

  it("keeps offline Replay/Demo Mode deterministic and separate", () => {
    const replay = runReplayDemo();
    expect(replay.mode).toBe("REPLAY_DEMO_MODE");
    expect(replay.replayStable).toBe(true);
    expect(replay.actionCount).toBeGreaterThan(0);
  });
});

