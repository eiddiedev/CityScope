import { afterEach, describe, expect, it, vi } from "vitest";
import { DeepSeekProvider, deepSeekConfigFromEnv } from "../src/providers/deepseek-provider.js";
import { providerFromEnv } from "../src/providers/index.js";
import { createInitialState } from "../src/world/initial-state.js";
import { decisionViewFor } from "../src/agents/decision-view.js";
import { unpackProviderGeneration } from "../src/providers/types.js";
import { SCHEMA_VERSION } from "../src/domain.js";

afterEach(() => vi.unstubAllGlobals());

describe("DeepSeek provider configuration", () => {
  it("uses fast non-thinking defaults for the live demo", () => {
    const config = deepSeekConfigFromEnv({ DEEPSEEK_API_KEY: "test-key" });
    expect(config).toMatchObject({
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-v4-flash",
      timeoutMs: 15_000,
      maxConcurrency: 2,
      maxTokens: 1_600,
      thinking: "disabled",
    });
  });

  it("selects DeepSeek without changing the default stub or Qwen boundary", () => {
    const provider = providerFromEnv({ LLM_PROVIDER: "deepseek", DEEPSEEK_API_KEY: "test-key" });
    expect(provider).toBeInstanceOf(DeepSeekProvider);
    expect(provider.id).toBe("deepseek");
    expect(provider.model).toBe("deepseek-v4-flash");
    expect(providerFromEnv({}).id).toBe("stub");
  });

  it("requires only the secret because endpoint and model have safe defaults", () => {
    expect(() => deepSeekConfigFromEnv({})).toThrow("DEEPSEEK_API_KEY");
  });

  it("sends a stable prefix plus compact decision view and records cache usage", async () => {
    let body: Record<string, unknown> | undefined;
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({
        choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ kind: "ADVISE_POLICY", reasoning: "compact decision", payload: { supportMillionCny: 100 }, evidenceFactIds: [] }) } }],
        usage: { prompt_tokens: 800, completion_tokens: 80, total_tokens: 880, prompt_cache_hit_tokens: 600, prompt_cache_miss_tokens: 200 },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }));
    const state = createInitialState("must_not_reach_api");
    const provider = new DeepSeekProvider(deepSeekConfigFromEnv({ DEEPSEEK_API_KEY: "test-key" }));
    const generated = unpackProviderGeneration(await provider.generate({
      scenario: state.scenarioId,
      worldVersion: state.worldVersion,
      agentId: "chengdu_investment",
      promptVersion: "cityscope-chengdu_investment.v2",
      model: provider.model,
      seed: state.snapshot.seed,
      schemaVersion: SCHEMA_VERSION,
      instruction: "stable role prompt",
      observation: state,
      decisionView: decisionViewFor(state, "chengdu_investment"),
      phase: "internal_advice",
      eligibleKinds: ["ADVISE_POLICY", "PASS"],
      repairAttempt: false,
    }));

    const serialized = JSON.stringify(body);
    expect(serialized).toContain("Stable action catalog");
    expect(serialized).toContain("SEND_DEBATE_MESSAGE");
    expect(serialized).toContain("自然中文");
    expect(serialized).toContain("at most 90 characters");
    expect(serialized).toContain("35至70个汉字");
    expect(serialized).toContain("decisionView");
    expect(serialized).not.toContain("must_not_reach_api");
    expect(serialized).not.toContain('"worldVersion"');
    expect(serialized).not.toContain('"events"');
    expect(generated.usage).toEqual({ callCount: 1, promptTokens: 800, completionTokens: 80, totalTokens: 880, promptCacheHitTokens: 600, promptCacheMissTokens: 200 });
  });

  it("preserves quota details from DeepSeek error responses", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { code: "insufficient_balance", message: "Insufficient Balance" } }), { status: 402, headers: { "content-type": "application/json" } })));
    const state = createInitialState("quota-test");
    const provider = new DeepSeekProvider(deepSeekConfigFromEnv({ DEEPSEEK_API_KEY: "test-key" }));
    await expect(provider.generate({
      scenario: state.scenarioId,
      worldVersion: state.worldVersion,
      agentId: "chengdu_investment",
      promptVersion: "cityscope-chengdu_investment.v2",
      model: provider.model,
      seed: state.snapshot.seed,
      schemaVersion: SCHEMA_VERSION,
      instruction: "stable role prompt",
      observation: state,
      decisionView: decisionViewFor(state, "chengdu_investment"),
      phase: "internal_advice",
      eligibleKinds: ["ADVISE_POLICY", "PASS"],
      repairAttempt: false,
    })).rejects.toThrow(/DeepSeek HTTP 402.*insufficient_balance.*Insufficient Balance/);
  });
});
