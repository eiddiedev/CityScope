import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { DecisionSupportService } from "../src/decision-support/service.js";
import { solveEnumeratively } from "../src/decision-support/enumerative-solver.js";
import { assignmentSignature, evaluateAssignment } from "../src/decision-support/evaluate.js";
import { solveWithOrTools } from "../src/decision-support/ortools-client.js";
import { optimizationInputFromState } from "../src/decision-support/problem.js";
import { rankWithTopsis, weightsFor } from "../src/decision-support/topsis.js";
import { decisionDimensions } from "../src/decision-support/types.js";
import { SimulationEngine } from "../src/orchestrator/engine.js";
import { StubProvider } from "../src/providers/stub-provider.js";
import { createInitialState } from "../src/world/initial-state.js";
import { cityCompetitionForState } from "../src/decision-support/city-competition.js";

describe("Stage 2 CP-SAT candidate generation", () => {
  it("produces five distinct, independently revalidated feasible plans", () => {
    const input = optimizationInputFromState(createInitialState());
    const result = solveEnumeratively(input);

    expect(result.status).toBe("OPTIMAL");
    expect(result.candidates).toHaveLength(5);
    expect(new Set(result.candidates.map((candidate) => assignmentSignature(candidate.assignments))).size).toBe(5);
    for (const candidate of result.candidates) {
      const profile = input.profiles.find((item) => item.profileId === candidate.profileId);
      expect(profile).toBeDefined();
      expect(evaluateAssignment(input, candidate.assignments, profile!)).toMatchObject({
        candidateId: candidate.candidateId,
        objectiveValue: candidate.objectiveValue,
      });
      expect(candidate.constraintEvidence).toContain("CITY_RESOURCE_CAPACITIES_OK");
    }
  });

  it.runIf(existsSync(resolve(process.cwd(), ".venv-optimization/bin/python")))("runs the real OR-Tools CP-SAT engine and revalidates its output", async () => {
    const input = optimizationInputFromState(createInitialState());
    const result = await solveWithOrTools(input);

    expect(result.engine).toBe("ortools-cp-sat");
    expect(result.engineVersion).toMatch(/^ortools-/);
    expect(result.status).toBe("OPTIMAL");
    expect(result.candidates).toHaveLength(5);
    expect(new Set(result.candidates.map((candidate) => assignmentSignature(candidate.assignments))).size).toBe(5);
    expect(result.candidates.every((candidate) => candidate.constraintEvidence.some((item) => item.startsWith("CP_SAT_OBJECTIVE=")))).toBe(true);
  });

  it("returns no plan when every resource and investment hard constraint is impossible", () => {
    const input = optimizationInputFromState(createInitialState());
    input.investmentPlanMillionCny = 0;
    for (const city of Object.values(input.cities)) {
      for (const resource of Object.keys(city.capacities) as Array<keyof typeof city.capacities>) city.capacities[resource] = 0;
    }
    const result = solveEnumeratively(input);
    expect(result.status).toBe("INFEASIBLE");
    expect(result.candidates).toEqual([]);
  });

  it("responds to a real capacity intervention while keeping same-project reservations in scope", () => {
    const state = createInitialState();
    const before = solveEnumeratively(optimizationInputFromState(state));
    state.cities.chengdu.resourceLedger.fiscalMillionCny.capacity = 240;
    state.cities.chengdu.resourceLedger.fiscalMillionCny.available = 240;
    const input = optimizationInputFromState(state);
    const after = solveEnumeratively(input);

    expect(input.cities.chengdu.capacities.fiscalMillionCny).toBe(240);
    expect(after.candidates.every((candidate) => candidate.cityResources.chengdu.fiscalMillionCny <= 240)).toBe(true);
    expect(after.candidates.map((candidate) => candidate.candidateId)).not.toEqual(before.candidates.map((candidate) => candidate.candidateId));
  });

  it("returns explicit INFEASIBLE support instead of crashing the Agent loop", async () => {
    const state = createInitialState();
    state.simulation.phase = "policy_formation";
    state.company.investmentPlanMillionCny = 0;
    for (const city of Object.values(state.cities)) {
      for (const account of Object.values(city.resourceLedger)) {
        account.capacity = 0;
        account.available = 0;
      }
    }
    const context = await new DecisionSupportService("enumerative").contextFor(state, "chengdu_leader");
    expect(context?.optimizer.status).toBe("INFEASIBLE");
    expect(context?.candidates).toEqual([]);
    expect(context?.actorRanking).toBeUndefined();
    expect(context?.consensusCandidateId).toBeNull();
  });
});

describe("Stage 2 role-specific TOPSIS", () => {
  it("normalizes weights, exposes all intermediate evidence and yields role disagreement", () => {
    const candidates = solveEnumeratively(optimizationInputFromState(createInitialState())).candidates;
    const board = rankWithTopsis("company_board", candidates);
    const cfo = rankWithTopsis("company_cfo", candidates);

    expect(Object.keys(board.weights)).toEqual([...decisionDimensions]);
    expect(Object.values(weightsFor("company_board")).reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 5);
    expect(board.rows.map((row) => row.rank)).toEqual([1, 2, 3, 4, 5]);
    expect(board.rows.every((row) => row.closeness >= 0 && row.closeness <= 1)).toBe(true);
    expect(board.rows.every((row) => Object.keys(row.weightedNormalized).length === decisionDimensions.length)).toBe(true);
    expect(cfo.rows[0]?.candidateId).not.toBe(board.rows[0]?.candidateId);
  });

  it("ranks the two city offers with auditable TOPSIS evidence and reacts to a supply-chain intervention", () => {
    const state = createInitialState();
    const baseline = cityCompetitionForState(state);
    state.stakeholders.supplyChainReadiness = 100;
    const intervention = cityCompetitionForState(state);

    expect(baseline.dimensions.map((item) => item.id)).toEqual(["policyValue", "industryFit", "executionCapacity", "publicBenefit", "fiscalBurden"]);
    expect(baseline.dimensions.reduce((sum, item) => sum + item.weight, 0)).toBeCloseTo(1, 6);
    expect(baseline.scores.chengdu.share + baseline.scores.chongqing.share).toBeCloseTo(100, 2);
    expect(baseline.preferredCity).toBe("chengdu");
    expect(intervention.preferredCity).toBe("chongqing");
    expect(intervention.scores.chongqing.closeness).toBeGreaterThan(baseline.scores.chongqing.closeness);
  });
});

describe("Stage 2 Agent and trace integration", () => {
  it("keeps the six conversational turns lightweight and adds optimization only to the formal coordination resolution", async () => {
    const state = createInitialState();
    state.simulation.phase = "coordination_debate";
    const service = new DecisionSupportService("enumerative");

    expect(await service.contextFor(state, "regional_coordinator")).toBeUndefined();

    state.debateThreads = [{
      threadId: "coordination-main",
      topic: "功能分工",
      participantIds: ["regional_coordinator", "chengdu_leader", "chongqing_leader", "policy_supervisor"],
      status: "open",
      messages: Array.from({ length: 6 }, (_, index) => ({
        messageId: `message-${index}`,
        threadId: "coordination-main",
        actorId: ["regional_coordinator", "chengdu_leader", "chongqing_leader"][index % 3]!,
        sequence: index + 1,
        turnType: index === 0 ? "challenge" : "position",
        issue: "functional_allocation",
        stance: "conditional",
        content: `第 ${index + 1} 轮协调意见`,
        audience: ["regional_coordinator", "chengdu_leader", "chongqing_leader", "policy_supervisor"],
        visibility: "participants",
        ...(index > 0 ? { replyToMessageId: `message-${index - 1}` } : {}),
        createdAtVersion: index + 1,
      })),
    }];

    expect((await service.contextFor(state, "regional_coordinator"))?.candidates.length).toBeGreaterThanOrEqual(2);
  });

  it("injects the portfolio into a key Agent and records it on the causal event", async () => {
    const state = createInitialState();
    state.simulation.phase = "policy_formation";
    state.cities.chengdu.internalAdvice = [
      { actionId: "advice-investment", actorId: "chengdu_investment", proposal: { focus: "innovation" } },
      { actionId: "advice-finance", actorId: "chengdu_finance", proposal: { ceiling: 500 } },
    ];
    const engine = new SimulationEngine(new StubProvider(), new DecisionSupportService("enumerative"));
    const result = await engine.proposeAndApplyActor(state, "chengdu_leader");
    const event = result.state.events.find((item) => item.causeId === result.candidate.actionId && item.eventType === "AgentActionProposed");
    const evidence = event?.payload.decisionSupport as Record<string, unknown> | undefined;

    expect(result.receipt.status).toBe("APPLIED");
    expect(result.candidate.reasoning).toContain("引用候选");
    expect(evidence).toBeDefined();
    expect(evidence?.portfolioId).toMatch(/^portfolio_/);
    expect((evidence?.optimizer as { engine?: string }).engine).toBe("enumerative-fallback");
    expect((evidence?.actorRanking as { actorId?: string } | undefined)?.actorId).toBe("chengdu_leader");
    expect(evidence?.candidates).toHaveLength(5);
    expect(evidence?.consensusCandidateId).toBeTypeOf("string");
  });
});
