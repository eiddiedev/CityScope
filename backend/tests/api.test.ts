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
});

