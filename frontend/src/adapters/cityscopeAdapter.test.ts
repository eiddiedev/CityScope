import { beforeEach, describe, expect, it, vi } from "vitest";
import demoFixture from "../../../fixtures/v0/cityscope-demo.json";

const fixture = {
  contractVersion: "0.1.0",
  fixtureVersion: "0.1.0",
  actorRegistry: Array.from({ length: 16 }, (_, index) => ({ agentId: `actor_${index}` })),
  baseline: { steps: Array.from({ length: 28 }), terminalState: { runId: "run_test" } },
};

describe("signed fixture adapter", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => fixture })));
  });

  it("reports the frozen contract and fixture versions", async () => {
    const { cityScopeAdapter } = await import("./cityscopeAdapter");
    await expect(cityScopeAdapter.health()).resolves.toMatchObject({
      mode: "signed-fixture",
      ready: true,
      contractVersion: "0.1.0",
      fixtureVersion: "0.1.0",
    });
  });

  it("loads the validated baseline snapshot", async () => {
    const { cityScopeAdapter } = await import("./cityscopeAdapter");
    await expect(cityScopeAdapter.loadWorldSnapshot()).resolves.toMatchObject({ runId: "run_test" });
  });

  it("runs a same-checkpoint live fork without sending a desired outcome", async () => {
    const reply = (value: unknown) => ({ ok: true, status: 200, json: async () => value }) as Response;
    const source = structuredClone(demoFixture.baseline.terminalState);
    const receipt = source.receipts[0];
    const world = { ...source, runId: "root", worldVersion: 38, terminal: true, metrics: { ...source.metrics, financingConfidence: 40 }, snapshot: { ...source.snapshot, provider: "deepseek", model: "deepseek-v4-flash" } };
    const liveStep = { phase: "internal_advice", actorId: receipt.actorId, candidate: { ...demoFixture.baseline.steps[0].candidate, actionId: receipt.actionId, actorId: receipt.actorId }, receiptId: receipt.receiptId, generationSource: "model" };
    const competition = {
      method: "topsis-city-offer-v1",
      generatedAtWorldVersion: 38,
      dimensions: [],
      scores: { chengdu: { closeness: 0.62, rank: 1, share: 62 }, chongqing: { closeness: 0.38, rank: 2, share: 38 } },
      preferredCity: "chengdu",
    };
    const comparison = { baselineRunId: "root", interventionRunId: "fork", interventionPath: "metrics.financingConfidence", firstSemanticActionDivergence: null, firstWorldStateDivergence: null, propagationChain: [], baselineOutcome: "DUAL_CITY", interventionOutcome: "PROJECT_EXITED", outcomeChanged: true, absorbed: false, absorptionLayer: "none" };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url === "/cityscope-demo.json") return reply(demoFixture);
      if (url.includes("/scenarios/") && url.endsWith("/interventions")) return reply({ catalogVersion: "test", scenarioId: source.scenarioId, interventions: [{ path: "metrics.financingConfidence", label: "外部融资信心", unit: "score", min: 0, max: 100, step: 1, baseline: 68, sensitiveRange: { min: 20, max: 55 }, redlineRanges: [{ min: 0, max: 15, label: "融资退出红线" }] }] });
      if (url === "/api/v0/runs") return reply({ ...world, worldVersion: 0, terminal: false });
      if (url.includes("/checkpoints") && !url.includes("/forks")) return reply({ checkpointId: "checkpoint", state: world });
      if (url.includes("/forks")) return reply({ ...world, runId: "fork", parentRunId: "root", worldVersion: 19, terminal: false });
      if (url.endsWith("/outcome")) return reply({ label: url.includes("live_fork") ? "PROJECT_EXITED" : "DUAL_CITY" });
      if (url.endsWith("/competition")) return reply(competition);
      if (url.includes("/comparison/")) return reply(comparison);
      if (url.endsWith("/steps")) return reply([liveStep]);
      if (url.includes("/advance")) return reply(url.includes("live_fork") ? { ...world, runId: "fork", worldVersion: 39 } : world);
      throw new Error(`UNEXPECTED_URL:${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const { cityScopeAdapter } = await import("./cityscopeAdapter");
    const progressLabels: string[] = [];
    const result = await cityScopeAdapter.runLiveFork({ path: "metrics.financingConfidence", newValue: 5, reason: "现场冲击" }, (progress) => progressLabels.push(progress.label));

    expect(result.intervention).toMatchObject({ path: "metrics.financingConfidence", previousValue: 40, newValue: 5 });
    expect(result.baselineOutcome.label).toBe("DUAL_CITY");
    expect(result.forkOutcome.label).toBe("PROJECT_EXITED");
    expect(result.forkSteps).toHaveLength(1);
    expect(result.forkSteps[0]).toMatchObject({ generationSource: "model", receipt });
    expect(result).toMatchObject({ provider: "deepseek", model: "deepseek-v4-flash" });
    expect(result.baselineCompetition).toMatchObject({ method: "topsis-city-offer-v1", preferredCity: "chengdu" });
    expect(progressLabels).toContain("所有 Agent 行动已完成，正在执行终局分类");
    const forkRequest = fetchMock.mock.calls.find(([url]) => String(url).includes("/forks"));
    const forkInit = forkRequest?.slice(1)[0];
    expect(JSON.stringify(forkInit)).not.toMatch(/desiredOutcome|winner|branchIndex/);
  });

  it("keeps advancing unequal A/B phases until both worlds are truly terminal", async () => {
    const reply = (value: unknown) => ({ ok: true, status: 200, json: async () => value }) as Response;
    const phaseOrder = ["internal_advice", "policy_formation", "policy_audit", "stakeholder_reaction", "company_deliberation", "due_diligence", "risk_reassessment", "policy_revision", "coordination_debate", "coordination_resolution", "final_deliberation", "delivery", "delivery_reaction", "impact_assessment", "complete"] as const;
    const template = structuredClone(demoFixture.baseline.terminalState);
    const states = new Map<string, typeof template>();
    const advanceTargets: string[] = [];
    const makeState = (runId: string, phase: typeof phaseOrder[number], terminal = false) => ({ ...structuredClone(template), runId, worldVersion: phaseOrder.indexOf(phase) + (terminal ? 100 : 0), terminal, simulation: { ...template.simulation, phase } });
    const competition = { method: "topsis-city-offer-v1", generatedAtWorldVersion: 0, dimensions: [], scores: { chengdu: { closeness: 0.5, rank: 1, share: 50 }, chongqing: { closeness: 0.5, rank: 2, share: 50 } } };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url === "/cityscope-demo.json") return reply(demoFixture);
      if (url.includes("/scenarios/") && url.endsWith("/interventions")) return reply({ catalogVersion: "test", scenarioId: template.scenarioId, interventions: [{ path: "metrics.financingConfidence", label: "外部融资信心", unit: "score", min: 0, max: 100, step: 1, baseline: 68, sensitiveRange: { min: 20, max: 55 }, redlineRanges: [] }] });
      if (url === "/api/v0/runs" && method === "POST") {
        const runId = JSON.parse(String(init?.body)).runId as string;
        const state = makeState(runId, "internal_advice");
        states.set(runId, state);
        return reply(state);
      }
      if (url.includes("/checkpoints") && !url.includes("/forks")) return reply({ checkpointId: "phase-checkpoint", state: [...states.values()][0] });
      if (url.includes("/forks")) {
        const runId = JSON.parse(String(init?.body)).runId as string;
        const state = makeState(runId, "internal_advice");
        states.set(runId, state);
        return reply(state);
      }
      const runId = [...states.keys()].find((id) => url.includes(`/runs/${id}`));
      if (!runId) throw new Error(`UNKNOWN_RUN:${url}`);
      if (url.endsWith("/competition")) return reply(competition);
      if (url.includes("/comparison/")) return reply({ baselineRunId: "root", interventionRunId: "fork", interventionPath: "metrics.financingConfidence", firstSemanticActionDivergence: null, firstWorldStateDivergence: null, propagationChain: [], baselineOutcome: "DUAL_CITY", interventionOutcome: "DUAL_CITY", outcomeChanged: false, absorbed: true, absorptionLayer: "final_selection" });
      if (url.endsWith("/steps")) return reply([]);
      if (url.endsWith("/outcome")) return reply({ label: "DUAL_CITY", evidence: [], classifiedAtVersion: states.get(runId)?.worldVersion ?? 0 });
      if (url.includes("/advance")) {
        const current = states.get(runId)!;
        const requested = new URL(`http://cityscope${url}`).searchParams.get("stopAfterPhase");
        advanceTargets.push(`${runId.includes("fork") ? "B" : "A"}:${requested ?? "terminal"}`);
        if (current.simulation.phase === "complete" && !requested) {
          const terminal = makeState(runId, "complete", true);
          states.set(runId, terminal);
          return reply(terminal);
        }
        if (requested !== current.simulation.phase) throw new Error(`WRONG_PHASE:${runId}:${current.simulation.phase}:${requested}`);
        const currentIndex = phaseOrder.indexOf(current.simulation.phase as typeof phaseOrder[number]);
        const nextPhase = runId.includes("fork") && current.simulation.phase === "due_diligence" ? "final_deliberation" : phaseOrder[currentIndex + 1];
        const next = makeState(runId, nextPhase);
        states.set(runId, next);
        return reply(next);
      }
      if (url === `/api/v0/runs/${runId}`) return reply(states.get(runId));
      throw new Error(`UNEXPECTED_URL:${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const { cityScopeAdapter } = await import("./cityscopeAdapter");
    const labels: string[] = [];
    const result = await cityScopeAdapter.runLiveFork({ path: "metrics.financingConfidence", newValue: 58, reason: "阶段错位测试" }, (progress) => labels.push(progress.label));

    expect(result.baselineState.terminal).toBe(true);
    expect(result.forkState.terminal).toBe(true);
    expect(advanceTargets).toContain("A:risk_reassessment");
    expect(advanceTargets).toContain("B:final_deliberation");
    expect(advanceTargets.filter((target) => target.endsWith(":terminal"))).toHaveLength(2);
    expect(labels.at(-1)).toBe("所有 Agent 行动已完成，正在执行终局分类");
  });
});
