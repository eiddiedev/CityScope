import { describe, expect, it } from "vitest";
import { postDisclosureActions, progressAction } from "../src/orchestrator/actions.js";
import { runGoldenScenario } from "../src/orchestrator/golden.js";
import { StubProvider } from "../src/providers/stub-provider.js";
import { commitmentConsistency } from "../src/rules/commitments.js";
import { replay, replayDigest } from "../src/trace/replay.js";
import { classifyOutcome } from "../src/world/outcome.js";
import { applyAction } from "../src/world/reducer.js";
import { makeAction } from "../src/orchestrator/actions.js";

describe("golden autonomous chain", () => {
  it("runs offline through negotiation, disclosure, fork and terminal classification", async () => {
    const run = await runGoldenScenario(new StubProvider());
    expect(run.state.terminal).toBe(true);
    expect(run.state.receipts.every((receipt) => receipt.status === "APPLIED")).toBe(true);
    expect(run.state.company.bindingOrderRatio).toBe(0.34);
    expect(run.state.metrics.trust).toBeLessThan(72);
    expect(run.state.metrics.financingConfidence).toBeLessThan(68);
    expect(run.state.commitments).toHaveLength(3);
    expect(run.state.commitments.map((item) => item.status)).toEqual(["paid", "paid", "approved"]);
    expect(commitmentConsistency(run.state)).toEqual({ consistent: true, violations: [] });
    expect(run.branchChecks.every((check) => check.passed)).toBe(true);
    expect(new Set(run.forkOutcomes.map((outcome) => outcome.label))).toEqual(new Set(["CHENGDU_LED", "DUAL_CITY", "PROJECT_EXITED"]));
  });

  it("gives every metric delta a causal action/event and before/after", async () => {
    const run = await runGoldenScenario(new StubProvider());
    const knownCauses = new Set([...run.state.receipts.map((receipt) => receipt.actionId), ...run.state.events.map((event) => event.causeId)]);
    const metricDeltas = run.state.trace.filter((delta) => delta.path.startsWith("metrics."));
    expect(metricDeltas.length).toBeGreaterThan(0);
    for (const delta of metricDeltas) {
      expect(knownCauses.has(delta.causeId)).toBe(true);
      expect(delta.actorId).toBeTruthy();
      expect(delta.worldVersion).toBeGreaterThan(0);
      expect(delta.before).not.toEqual(delta.after);
    }
  });

  it("replays the same snapshot/actions to the same digest", async () => {
    const run = await runGoldenScenario(new StubProvider());
    const actions = [...postDisclosureActions(run.checkpoint.state), progressAction()];
    const first = replay(run.checkpoint, actions);
    const second = replay(run.checkpoint, actions);
    expect(replayDigest(first)).toBe(replayDigest(second));
  });

  it("does not classify a non-terminal state", async () => {
    const run = await runGoldenScenario(new StubProvider());
    expect(() => classifyOutcome(run.checkpoint.state)).toThrow("RUN_NOT_TERMINAL");
  });

  it("turns an unfulfilled approved commitment into auditable breach consequences", async () => {
    const run = await runGoldenScenario(new StubProvider());
    const state = run.checkpoint.state;
    const unpaid = state.commitments[2];
    expect(unpaid?.status).toBe("approved");
    const beforeCredibility = state.cities.chengdu.policyCredibility;
    const result = applyAction(state, makeAction("world_service", "ADVANCE_PROJECT", { failedCommitmentIds: [unpaid?.commitmentId] }, "截止期核验：招聘未达到500人，政府承诺无法支付"));
    expect(result.state.commitments[2]?.status).toBe("failed");
    expect(result.state.cities.chengdu.policyCredibility).toBe(beforeCredibility - 12);
    expect(result.state.company.projectStage).toBe("renegotiation");
    expect(result.receipt.deltas.some((delta) => delta.path === "metrics.trust")).toBe(true);
  });
});
