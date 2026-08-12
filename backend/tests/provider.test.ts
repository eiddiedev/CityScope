import { describe, expect, it } from "vitest";
import { createInitialState } from "../src/world/initial-state.js";
import { makeAction } from "../src/orchestrator/actions.js";
import { ResilientActionGenerator, cacheKey } from "../src/providers/resilient-provider.js";
import type { GenerationRequest, LLMProvider } from "../src/providers/types.js";
import { SimulationEngine } from "../src/orchestrator/engine.js";
import { SCHEMA_VERSION, type AgentAction } from "../src/domain.js";
import { decisionViewFor } from "../src/agents/decision-view.js";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

class InvalidProvider implements LLMProvider {
  readonly id = "invalid";
  readonly model = "invalid-model";
  calls = 0;
  async generate(): Promise<unknown> {
    this.calls += 1;
    return { not: "an action" };
  }
}

class ValidProvider implements LLMProvider {
  readonly id = "valid";
  readonly model = "valid-model";
  calls = 0;
  async generate(request: GenerationRequest): Promise<unknown> {
    this.calls += 1;
    return {
      actionId: `provider_${request.observation.runId}_${this.calls}`,
      actorId: request.agentId,
      kind: "ADVISE_POLICY",
      reasoning: "same semantic policy advice",
      payload: { supportMillionCny: 120, milestones: ["verified_jobs"] },
      evidenceFactIds: [],
      promptVersion: request.promptVersion,
      schemaVersion: request.schemaVersion,
    };
  }
}

describe("resilient provider boundary", () => {
  it("repairs at most once then uses deterministic fallback", async () => {
    const provider = new InvalidProvider();
    const generator = new ResilientActionGenerator(provider);
    const state = createInitialState();
    const result = await generator.generate({ scenario: state.scenarioId, worldVersion: 0, agentId: "chengdu_investment", promptVersion: "cityscope-chengdu_investment.v2", seed: state.snapshot.seed, schemaVersion: SCHEMA_VERSION, instruction: "test", observation: state, decisionView: decisionViewFor(state, "chengdu_investment"), phase: "internal_advice", eligibleKinds: ["ADVISE_POLICY", "PASS"] });
    expect(provider.calls).toBe(2);
    expect(result.source).toBe("fallback");
    expect(result.action.kind).toBe("ADVISE_POLICY");
  });

  it("reuses a semantic decision across run ids and re-stamps trusted metadata", async () => {
    const provider = new ValidProvider();
    const generator = new ResilientActionGenerator(provider, { persistentPath: null });
    const firstState = createInitialState("semantic_run_a");
    const secondState = createInitialState("semantic_run_b");
    const request = requestFor(firstState);
    const first = await generator.generate(request);
    const cached = await generator.generate(requestFor(secondState));
    expect(provider.calls).toBe(1);
    expect(first.source).toBe("model");
    expect(cached.source).toBe("cache");
    expect(cached.action.actionId).not.toBe(first.action.actionId);
    expect(cached.action.payload).toEqual(first.action.payload);
    const full: GenerationRequest = { ...request, eligibleKinds: [...request.eligibleKinds], model: provider.model, repairAttempt: false };
    expect(cacheKey(full)).not.toBe(cacheKey({ ...full, seed: full.seed + 1 }));
    expect(cacheKey(full)).toBe(cacheKey({ ...full, observation: secondState, worldVersion: 99, decisionView: decisionViewFor(secondState, "chengdu_investment") }));
    secondState.stakeholders.publicTrust -= 1;
    expect(cacheKey(full)).not.toBe(cacheKey({ ...full, observation: secondState, decisionView: decisionViewFor(secondState, "chengdu_investment") }));
    generator.close();
  });

  it("persists exact semantic proposals across generator restarts", async () => {
    const directory = mkdtempSync(join(tmpdir(), "cityscope-cache-"));
    const path = join(directory, "actions.sqlite");
    try {
      const firstProvider = new ValidProvider();
      const firstGenerator = new ResilientActionGenerator(firstProvider, { persistentPath: path });
      await firstGenerator.generate(requestFor(createInitialState("persistent_a")));
      firstGenerator.close();

      const secondProvider = new ValidProvider();
      const secondGenerator = new ResilientActionGenerator(secondProvider, { persistentPath: path });
      const cached = await secondGenerator.generate(requestFor(createInitialState("persistent_b")));
      expect(cached.source).toBe("cache");
      expect(secondProvider.calls).toBe(0);
      secondGenerator.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

function requestFor(state: ReturnType<typeof createInitialState>) {
  return {
    scenario: state.scenarioId,
    worldVersion: state.worldVersion,
    agentId: "chengdu_investment",
    promptVersion: "cityscope-chengdu_investment.v2",
    seed: state.snapshot.seed,
    schemaVersion: SCHEMA_VERSION,
    instruction: "test",
    observation: state,
    decisionView: decisionViewFor(state, "chengdu_investment"),
    phase: "internal_advice" as const,
    eligibleKinds: ["ADVISE_POLICY", "PASS"] as AgentAction["kind"][],
  };
}

describe("deterministic gate feedback", () => {
  it("retains the rejected receipt and lets the model repair once", async () => {
    let calls = 0;
    const provider: LLMProvider = {
      id: "gate-repair-test",
      model: "test-model",
      async generate(request) {
        calls += 1;
        const base = {
          actionId: `company_ceo_${calls}`,
          actorId: "company_ceo",
          reasoning: "test",
          evidenceFactIds: calls === 1 ? ["fact_cd_capacity"] : [],
          promptVersion: request.promptVersion,
          schemaVersion: request.schemaVersion,
        };
        return calls === 1
          ? { ...base, kind: "ADVISE_COMPANY_RESPONSE", payload: { stance: "expand" } }
          : { ...base, kind: "PASS", payload: { phase: request.phase, reasonCode: "LEGAL_REPAIR" } };
      },
    };
    const state = createInitialState("gate_repair_test");
    state.simulation.phase = "stakeholder_reaction";
    const result = await new SimulationEngine(provider).proposeAndApplyActor(state, "company_ceo");
    expect(calls).toBe(2);
    expect(result.receipt.status).toBe("APPLIED");
    expect(result.candidate.kind).toBe("PASS");
    expect(result.state.receipts.map((receipt) => receipt.status)).toEqual(["REJECTED", "APPLIED"]);
    expect(result.diagnostics.join(" ")).toContain("unobservable facts: fact_cd_capacity");
  });

  it("uses a legal deterministic fallback when the model repeats a gate violation", async () => {
    let calls = 0;
    const provider: LLMProvider = {
      id: "repeated-gate-violation",
      model: "test-model",
      async generate(request) {
        calls += 1;
        return {
          actionId: `company_ceo_invalid_${calls}`,
          actorId: "company_ceo",
          kind: "ADVISE_COMPANY_RESPONSE",
          reasoning: "repeated invalid scope",
          payload: { stance: "expand" },
          evidenceFactIds: ["fact_cd_capacity"],
          promptVersion: request.promptVersion,
          schemaVersion: request.schemaVersion,
        };
      },
    };
    const state = createInitialState("gate_fallback_test");
    state.simulation.phase = "stakeholder_reaction";
    const result = await new SimulationEngine(provider).proposeAndApplyActor(state, "company_ceo");
    expect(calls).toBe(2);
    expect(result.generationSource).toBe("fallback");
    expect(result.receipt.status).toBe("APPLIED");
    expect(result.state.receipts.map((receipt) => receipt.status)).toEqual(["REJECTED", "REJECTED", "APPLIED"]);
  });
});
