import { describe, expect, it } from "vitest";
import { makeAction } from "../src/orchestrator/actions.js";
import { RunStore, ApiError } from "../src/api/run-store.js";
import { StubProvider } from "../src/providers/stub-provider.js";

describe("API run store", () => {
  it("enforces optimistic worldVersion and supports checkpoint/fork", async () => {
    const store = new RunStore(new StubProvider());
    const initial = store.createRun("api_run", 42);
    expect(initial.worldVersion).toBe(0);
    await expect(store.submitAction("api_run", makeAction("chengdu_investment", "ADVISE_POLICY", { support: 500 }, "建议"), 7)).rejects.toMatchObject({ code: "WORLD_VERSION_CONFLICT", status: 409 });
    const advanced = await store.advance("api_run", 0);
    expect(advanced.worldVersion).toBeGreaterThan(0);
    const rootSteps = store.steps("api_run");
    expect(rootSteps.length).toBeGreaterThan(20);
    expect(rootSteps.every((step) => step.candidate.actorId === step.actorId && step.receiptId.length > 0)).toBe(true);
    expect(store.usage("api_run")).toMatchObject({ totalSteps: rootSteps.length, providerCalls: 0, semanticCacheHits: 0, providerCacheHitRate: 0 });
    const checkpoint = store.createCheckpoint("api_run", "api_checkpoint");
    const fork = store.fork(checkpoint.checkpointId, "api_fork", {
      interventionId: "api_intervention",
      path: "metrics.financingConfidence",
      previousValue: advanced.metrics.financingConfidence,
      newValue: 9,
      reason: "test one cause",
    });
    expect(fork.parentRunId).toBe("api_run");
    expect(fork.metrics.financingConfidence).toBe(9);
    expect(store.steps("api_fork")).toEqual(rootSteps);
    expect(store.events("api_fork").some((event) => event.eventType === "ForkCreated")).toBe(true);
  });

  it("rejects outcome access before termination", () => {
    const store = new RunStore(new StubProvider());
    store.createRun("non_terminal");
    expect(() => store.outcome("non_terminal")).toThrow(ApiError);
    try {
      store.outcome("non_terminal");
    } catch (error) {
      expect(error).toMatchObject({ code: "RUN_NOT_TERMINAL", status: 409 });
    }
  });

  it("stops at a requested phase and rejects undeclared intervention paths", async () => {
    const store = new RunStore(new StubProvider());
    store.createRun("live_root", 20260811);
    const checkpointState = await store.advance("live_root", 0, { stopAfterPhase: "due_diligence", terminateAtComplete: false });
    expect(checkpointState.terminal).toBe(false);
    expect(checkpointState.simulation.phase).toBe("risk_reassessment");
    const checkpoint = store.createCheckpoint("live_root", "live_checkpoint");
    expect(() => store.fork(checkpoint.checkpointId, "invalid_fork", {
      interventionId: "invalid",
      path: "cities.chengdu.fiscal.availableMillionCny",
      previousValue: checkpoint.state.cities.chengdu.fiscal.availableMillionCny,
      newValue: 0,
      reason: "attempt undeclared direct budget edit",
    })).toThrow(ApiError);
  });

  it("publishes each autonomous action before the phase-level advance response completes", async () => {
    const store = new RunStore(new StubProvider());
    store.createRun("streamed_run", 20260811);
    const observed: Array<{ actorId: string; storedSteps: number; worldVersion: number }> = [];
    await store.advance("streamed_run", 0, {
      stopAfterPhase: "internal_advice",
      terminateAtComplete: false,
      onStep: (step, state) => { observed.push({ actorId: step.actorId, storedSteps: store.steps("streamed_run").length, worldVersion: state.worldVersion }); },
    });

    expect(observed.map((item) => item.actorId)).toEqual(["chengdu_investment", "chengdu_finance", "chongqing_investment", "chongqing_finance"]);
    expect(observed.map((item) => item.storedSteps)).toEqual([1, 2, 3, 4]);
    expect(observed.every((item, index) => item.worldVersion >= index + 1)).toBe(true);
    expect(store.competition("streamed_run").method).toBe("topsis-city-offer-v1");
  });

  it("reuses every behavior decision in a semantically identical run without crossing run metadata", async () => {
    const store = new RunStore(new StubProvider());
    store.createRun("semantic_full_a", 20260811);
    const first = await store.advance("semantic_full_a", 0);
    store.createRun("semantic_full_b", 20260811);
    const second = await store.advance("semantic_full_b", 0);
    const secondSteps = store.steps("semantic_full_b");
    const behaviorSteps = secondSteps.filter((step) => step.generationSource !== "deterministic_service");

    expect(behaviorSteps.length).toBeGreaterThan(20);
    expect(behaviorSteps.every((step) => step.generationSource === "cache")).toBe(true);
    expect(store.usage("semantic_full_b").semanticCacheHitRate).toBe(1);
    expect(store.outcome("semantic_full_b").label).toBe(store.outcome("semantic_full_a").label);
    expect(second.trace.map((delta) => delta.path)).toEqual(first.trace.map((delta) => delta.path));
    const firstBehaviorIds = store.steps("semantic_full_a").filter((step) => step.generationSource !== "deterministic_service").map((step) => step.candidate.actionId);
    expect(behaviorSteps.map((step) => step.candidate.actionId).every((actionId, index) => actionId !== firstBehaviorIds[index])).toBe(true);
  });
});
