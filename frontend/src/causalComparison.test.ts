import { describe, expect, it } from "vitest";
import demoFixture from "../../fixtures/v0/cityscope-demo.json";
import type { DemoStep } from "./adapters/cityscopeAdapter";
import { firstObservableDivergence, observableFactValue } from "./causalComparison";

describe("observable causal comparison", () => {
  const source = demoFixture.baseline.steps[0] as unknown as DemoStep;

  it("ignores run-scoped identifiers and equivalent hidden candidate ids", () => {
    const baseline = structuredClone(source);
    const fork = structuredClone(source);
    baseline.candidate.actionId = "action_baseline";
    fork.candidate.actionId = "action_fork";
    Object.assign(baseline.candidate.payload, { candidateId: "candidate_a", policyId: "policy_a" });
    Object.assign(fork.candidate.payload, { candidateId: "candidate_b", policyId: "policy_b" });
    expect(firstObservableDivergence([baseline], [fork])).toBeUndefined();
  });

  it("detects a real policy amount difference", () => {
    const baseline = structuredClone(source);
    const fork = structuredClone(source);
    Object.assign(baseline.candidate.payload, { supportPreferenceMillionCny: 160 });
    Object.assign(fork.candidate.payload, { supportPreferenceMillionCny: 220 });
    const divergence = firstObservableDivergence([baseline], [fork]);
    expect(divergence?.changedFacts).toContain("proposal.supportPreferenceMillionCny");
    expect(observableFactValue(baseline, "payload.supportPreferenceMillionCny")).toBe(160);
    expect(observableFactValue(fork, "proposal.supportPreferenceMillionCny")).toBe(220);
  });

  it("does not call calculated utility evidence a semantic action divergence", () => {
    const baseline = structuredClone(source);
    const fork = structuredClone(source);
    Object.assign(baseline.candidate.payload, { candidateId: "candidate_a", utility: 60, decisionEvidence: { candidateId: "candidate_a", utility: 60 } });
    Object.assign(fork.candidate.payload, { candidateId: "candidate_a", utility: 73, decisionEvidence: { candidateId: "candidate_a", utility: 73 } });
    expect(firstObservableDivergence([baseline], [fork])).toBeUndefined();
  });

  it("detects when only one world has an additional observable action", () => {
    expect(firstObservableDivergence([source], [source, source])?.changedFacts).toEqual(["action_presence"]);
  });
});
