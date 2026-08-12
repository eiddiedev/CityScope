import { describe, expect, it } from "vitest";
import demoFixture from "../../fixtures/v0/cityscope-demo.json";
import type { DemoStep } from "./adapters/cityscopeAdapter";
import { firstObservableDivergence } from "./causalComparison";

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
    expect(firstObservableDivergence([baseline], [fork])?.changedFacts).toContain("proposal.supportPreferenceMillionCny");
  });
});
