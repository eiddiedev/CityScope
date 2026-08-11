import { describe, expect, it } from "vitest";
import { createInitialState } from "../src/world/initial-state.js";
import { makeAction } from "../src/orchestrator/actions.js";
import { ResilientActionGenerator, cacheKey } from "../src/providers/resilient-provider.js";
import type { GenerationRequest, LLMProvider } from "../src/providers/types.js";
import { SCHEMA_VERSION, type AgentAction } from "../src/domain.js";

class InvalidProvider implements LLMProvider {
  readonly id = "invalid";
  readonly model = "invalid-model";
  calls = 0;
  async generate(): Promise<unknown> {
    this.calls += 1;
    return { not: "an action" };
  }
}

describe("resilient provider boundary", () => {
  it("repairs at most once then uses deterministic fallback", async () => {
    const provider = new InvalidProvider();
    const generator = new ResilientActionGenerator(provider);
    const state = createInitialState();
    const result = await generator.generate({ scenario: state.scenarioId, worldVersion: 0, agentId: "chengdu_investment", promptVersion: "cityscope-chengdu_investment.v2", seed: state.snapshot.seed, schemaVersion: SCHEMA_VERSION, instruction: "test", observation: state, phase: "internal_advice", eligibleKinds: ["ADVISE_POLICY", "PASS"] });
    expect(provider.calls).toBe(2);
    expect(result.source).toBe("fallback");
    expect(result.action.kind).toBe("ADVISE_POLICY");
  });

  it("caches by scenario/world/agent/prompt/model/seed/schema", async () => {
    const provider = new InvalidProvider();
    const generator = new ResilientActionGenerator(provider);
    const state = createInitialState();
    const request = { scenario: state.scenarioId, worldVersion: 0, agentId: "chengdu_investment", promptVersion: "cityscope-chengdu_investment.v2", seed: state.snapshot.seed, schemaVersion: SCHEMA_VERSION, instruction: "test", observation: state, phase: "internal_advice" as const, eligibleKinds: ["ADVISE_POLICY", "PASS"] as AgentAction["kind"][] };
    await generator.generate(request);
    const cached = await generator.generate(request);
    expect(provider.calls).toBe(2);
    expect(cached.source).toBe("cache");
    const full: GenerationRequest = { ...request, eligibleKinds: [...request.eligibleKinds], model: provider.model, repairAttempt: false };
    expect(cacheKey(full)).not.toBe(cacheKey({ ...full, seed: full.seed + 1 }));
  });
});
