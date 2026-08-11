import { describe, expect, it } from "vitest";
import { createInitialState } from "../src/world/initial-state.js";
import { makeAction } from "../src/orchestrator/actions.js";
import { ResilientActionGenerator, cacheKey } from "../src/providers/resilient-provider.js";
import type { GenerationRequest, LLMProvider } from "../src/providers/types.js";
import { SCHEMA_VERSION } from "../src/domain.js";

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
    const fallback = makeAction("chengdu_investment", "ADVISE_POLICY", { support: 500 }, "fallback");
    const result = await generator.generate({ scenario: state.scenarioId, worldVersion: 0, agentId: fallback.actorId, promptVersion: fallback.promptVersion, seed: state.snapshot.seed, schemaVersion: SCHEMA_VERSION, instruction: "test", observation: state, fallbackAction: fallback });
    expect(provider.calls).toBe(2);
    expect(result.source).toBe("fallback");
    expect(result.action).toEqual(fallback);
  });

  it("caches by scenario/world/agent/prompt/model/seed/schema", async () => {
    const provider = new InvalidProvider();
    const generator = new ResilientActionGenerator(provider);
    const state = createInitialState();
    const fallback = makeAction("chengdu_investment", "ADVISE_POLICY", { support: 500 }, "fallback");
    const request = { scenario: state.scenarioId, worldVersion: 0, agentId: fallback.actorId, promptVersion: fallback.promptVersion, seed: state.snapshot.seed, schemaVersion: SCHEMA_VERSION, instruction: "test", observation: state, fallbackAction: fallback };
    await generator.generate(request);
    const cached = await generator.generate(request);
    expect(provider.calls).toBe(2);
    expect(cached.source).toBe("cache");
    const full: GenerationRequest = { ...request, model: provider.model, repairAttempt: false };
    expect(cacheKey(full)).not.toBe(cacheKey({ ...full, seed: full.seed + 1 }));
  });
});

