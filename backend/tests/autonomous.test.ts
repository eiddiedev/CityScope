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
  it("contains exactly 12 behavior agents and 4 deterministic services", () => {
    expect(behaviorAgents).toHaveLength(12);
    expect(deterministicServices).toHaveLength(4);
    expect(Object.keys(manifests)).toHaveLength(16);
    expect(new Set(deterministicServices.map((item) => item.agentId))).toEqual(new Set(["talent_sme", "resident", "due_diligence_service", "world_resource_service"]));
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
    expect(steps.every((step) => step.candidateKind !== "PASS")).toBe(true);
    expect(new Set(steps.map((step) => step.generationSource))).toEqual(new Set(["deterministic_stub", "deterministic_service"]));
    for (const actorId of ["talent_sme", "resident"]) {
      const stakeholderSteps = steps.filter((step) => step.actorId === actorId);
      expect(stakeholderSteps.length).toBeGreaterThan(0);
      expect(stakeholderSteps.every((step) => step.candidate.reasoning.startsWith("我们"))).toBe(true);
    }
  });

  it("does not accept a prewritten action list in Autonomous Mode", async () => {
    const engine = new SimulationEngine(new StubProvider());
    await expect(continueAutonomously(engine, createInitialState(), { actions: [] } as never)).rejects.toThrow("AUTONOMOUS_ACTION_LIST_FORBIDDEN");
  });

  it("uses one continuation implementation for every fork with no outcome selector", async () => {
    const run = await runAutonomousGolden(new StubProvider());
    expect(run.continuedForks.every((fork) => fork.terminal && Boolean(fork.finalDecision))).toBe(true);
    const source = readFileSync(new URL("../src/orchestrator/golden.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/index\s*===|fork_[0-9]|desiredOutcome|winner|forceAgreement/);
    expect(source.match(/continueAutonomously\(engine, fork\)/g)).toHaveLength(1);
  });

  it("keeps each phase registry unique and models the board follow-up as a deliberation turn", async () => {
    const run = await runAutonomousGolden(new StubProvider());
    const orders = [...run.checkpointContinuation.eligibleOrder, ...run.rootContinuation.eligibleOrder];
    expect(orders.every(({ actors }) => new Set(actors).size === actors.length)).toBe(true);
    const boardSteps = run.rootContinuation.steps.filter((step) => step.phase === "final_deliberation" && step.actorId === "company_board");
    expect(boardSteps).toHaveLength(1);
  });

  it("records a six-turn reply chain before the coordinator resolves the city conflict", async () => {
    const run = await runAutonomousGolden(new StubProvider());
    const steps = [...run.checkpointContinuation.steps, ...run.rootContinuation.steps];
    const debateSteps = steps.filter((step) => step.phase === "coordination_debate");
    expect(debateSteps.map((step) => step.actorId)).toEqual(["regional_coordinator", "chengdu_leader", "chongqing_leader", "regional_coordinator", "chengdu_leader", "chongqing_leader", "regional_coordinator"]);
    expect(debateSteps.slice(0, 6).every((step) => step.candidateKind === "SEND_DEBATE_MESSAGE" && step.status === "APPLIED")).toBe(true);
    expect(debateSteps[6]?.candidateKind).toBe("PROPOSE_COORDINATION_PLAN");
    const thread = run.state.debateThreads[0];
    expect(thread?.status).toBe("resolved");
    expect(thread?.messages).toHaveLength(6);
    expect(new Set(thread?.messages.map((message) => message.content)).size).toBe(6);
    expect(thread?.messages.slice(1).every((message) => Boolean(message.replyToMessageId))).toBe(true);
    expect(run.state.coordinationPlans[0]?.concessions.chengdu).toHaveLength(1);
    expect(run.state.coordinationPlans[0]?.concessions.chongqing).toHaveLength(1);
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

  it("makes all four agreed outcomes reachable from real autonomous state transitions", async () => {
    const run = await runAutonomousGolden(new StubProvider());
    const labels = new Set([run.state.simulation.classification?.label, ...run.forkOutcomes.map((outcome) => outcome.label)]);
    expect(labels).toEqual(new Set(["CHENGDU_LED", "CHONGQING_LED", "DUAL_CITY", "PROJECT_EXITED"]));
    expect(labels.has("CONTINUING_COMMITMENTS" as never)).toBe(false);
  });

  it("keeps offline Replay/Demo Mode deterministic and separate", () => {
    const replay = runReplayDemo();
    expect(replay.mode).toBe("REPLAY_DEMO_MODE");
    expect(replay.replayStable).toBe(true);
    expect(replay.actionCount).toBeGreaterThan(0);
  });

  it("derives long-term impact from the accepted plan instead of a fixed investment constant", async () => {
    const run = await runAutonomousGolden(new StubProvider());
    const coordination = run.state.coordinationPlans.find((plan) => plan.status === "accepted");
    const impact24 = run.state.impactAssessments.find((impact) => impact.horizonMonths === 24);
    expect(coordination).toBeDefined();
    expect(impact24).toBeDefined();
    expect(impact24?.evidence).toContain(`acceptedInvestmentMillionCny=${coordination?.investmentMillionCny}`);
    expect(impact24?.evidence).toContain(`requestedInvestmentMillionCny=${run.state.company.investmentPlanMillionCny}`);
    expect(impact24?.actualInvestmentMillionCny).toBeLessThanOrEqual(coordination?.investmentMillionCny ?? 0);
  });
});
