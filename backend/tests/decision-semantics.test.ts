import { describe, expect, it } from "vitest";
import type { WorldState } from "../src/domain.js";
import { makeAction } from "../src/orchestrator/actions.js";
import { nextPhaseForState } from "../src/orchestrator/autonomous.js";
import { createInitialState } from "../src/world/initial-state.js";
import { classifyOutcome } from "../src/world/outcome.js";
import { applyAction } from "../src/world/reducer.js";

describe("post-disclosure board resolution", () => {
  it("rejects an unresolved board PASS and an unsigned delivery advance", () => {
    const state = boardReadyState();
    const pass = applyAction(state, makeAction("company_board", "PASS", { phase: "post_disclosure", reasonCode: "NO_DECISION" }, "暂不表态"));
    expect(pass.receipt.status).toBe("REJECTED");
    expect(pass.receipt.gateResults).toContainEqual(expect.objectContaining({ gate: "constraint", passed: false, reason: expect.stringContaining("must explicitly") }));

    const advance = applyAction(state, makeAction("world_resource_service", "ADVANCE_PROJECT", { verifiedJobs: 100 }, "错误地进入履约"));
    expect(advance.receipt.status).toBe("REJECTED");
    expect(advance.receipt.gateResults).toContainEqual(expect.objectContaining({ reason: expect.stringContaining("without an accepted policy") }));
  });

  it("treats a concrete post-disclosure counteroffer as an intermediate action, not a terminal outcome", () => {
    const state = boardReadyState();
    const response = applyAction(state, makeAction("company_board", "SUBMIT_COMPANY_RESPONSE", {
      responseId: "counteroffer_post_dd",
      targetPolicyIds: ["policy_chengdu_test"],
      requestedChanges: [{ policyId: "policy_chengdu_test", termId: "cd_housing_test", requestedValue: 120 }],
    }, "订单风险披露后提出具体缩量反报价"));
    expect(response.receipt.status).toBe("APPLIED");
    expect(response.state.company.projectStage).toBe("renegotiation");
    expect(() => nextPhaseForState(response.state, "post_disclosure")).toThrow("BOARD_RESOLUTION_REQUIRED");

    const unresolvedPass = applyAction(response.state, makeAction("company_board", "PASS", { phase: "post_disclosure", reasonCode: "FORMAL_COUNTEROFFER_ALREADY_ISSUED" }, "正式反报价已经形成"));
    expect(unresolvedPass.receipt.status).toBe("REJECTED");
    expect(unresolvedPass.receipt.gateResults).toContainEqual(expect.objectContaining({ reason: expect.stringContaining("not a terminal outcome") }));
  });

  it("routes signed projects to delivery and refuses an unresolved phase transition", () => {
    const signed = boardReadyState();
    signed.company.projectStage = "signed";
    signed.cities.chengdu.policies[0]!.status = "accepted";
    signed.cities.chengdu.policies[0]!.auditStatus = "approved";
    expect(nextPhaseForState(signed, "post_disclosure")).toBe("delivery");

    const unresolved = boardReadyState();
    expect(() => nextPhaseForState(unresolved, "post_disclosure")).toThrow("BOARD_RESOLUTION_REQUIRED");
  });
});

describe("four outcome semantics", () => {
  it.each([
    ["chengdu", "CHENGDU_LED", "accept_chengdu"],
    ["chongqing", "CHONGQING_LED", "accept_chongqing"],
  ] as const)("classifies an accepted %s policy", (cityId, expected, decision) => {
    const state = terminalWithAccepted(cityId);
    const outcome = classifyOutcome(state);
    expect(outcome.label).toBe(expected);
    expect(outcome.evidence).toContain(`decision=${decision}_after_${cityId === "chengdu" ? "chongqing" : "chengdu"}_closed`);
  });

  it("refuses to classify two accepted policies as coordination without bilateral consent", () => {
    const state = terminalWithAccepted("chengdu");
    state.finalDecision = { decisionId: "bad_dual", type: "coordination", coordinationPlanId: "missing", actorId: "company_board", decidedAtVersion: 1, causeId: "bad" };
    expect(() => classifyOutcome(state)).toThrow("OUTCOME_INVALID");
  });

  it("classifies explicit project exit and refuses to disguise renegotiation as a fifth outcome", () => {
    const exited = createInitialState("outcome_exit");
    exited.terminal = true;
    exited.company.projectStage = "exited";
    exited.cities.chengdu.bidStatus = "withdrawn";
    exited.cities.chongqing.bidStatus = "withdrawn";
    exited.finalDecision = { decisionId: "exit", type: "regional_exit", actorId: "company_board", decidedAtVersion: 1, causeId: "exit_action" };
    expect(classifyOutcome(exited)).toMatchObject({ label: "PROJECT_EXITED", evidence: expect.arrayContaining(["decision=both_cities_withdrew"]) });

    const continuing = createInitialState("outcome_continue");
    continuing.terminal = true;
    continuing.company.projectStage = "renegotiation";
    expect(() => classifyOutcome(continuing)).toThrow("OUTCOME_UNRESOLVED");
  });

  it("does not classify an unresolved courtship as a fake outcome", () => {
    const state = createInitialState("outcome_unresolved");
    state.terminal = true;
    expect(() => classifyOutcome(state)).toThrow("OUTCOME_UNRESOLVED");
  });
});

function boardReadyState(): WorldState {
  const state = issuePolicy(createInitialState("board_resolution"), "chengdu");
  state.simulation.phase = "post_disclosure";
  state.company.projectStage = "due_diligence";
  state.company.internalAdvice = [
    { actionId: "ceo_advice", actorId: "company_ceo", proposal: { stance: "reduce_scope" } },
    { actionId: "cfo_advice", actorId: "company_cfo", proposal: { stance: "renegotiate" } },
  ];
  return state;
}

function terminalWithAccepted(cityId: "chengdu" | "chongqing"): WorldState {
  const state = issuePolicy(createInitialState(`outcome_${cityId}`), cityId);
  const policy = state.cities[cityId].policies.at(-1)!;
  policy.status = "accepted";
  policy.auditStatus = "approved";
  state.company.projectStage = "signed";
  state.cities[cityId].bidStatus = "accepted";
  const otherCity = cityId === "chengdu" ? "chongqing" : "chengdu";
  state.cities[otherCity].bidStatus = "closed";
  state.finalDecision = { decisionId: `decision_${cityId}`, type: "single_city", cityId, policyId: policy.policyId, actorId: "company_board", decidedAtVersion: state.worldVersion, causeId: `accept_${cityId}` };
  state.terminal = true;
  return state;
}

function issuePolicy(input: WorldState, cityId: "chengdu" | "chongqing"): WorldState {
  const policyId = cityId === "chengdu" ? "policy_chengdu_test" : "policy_chongqing_test";
  const termId = cityId === "chengdu" ? "cd_housing_test" : "cq_housing_test";
  const result = applyAction(input, makeAction(`${cityId}_leader`, "SUBMIT_POLICY_PACK", {
    policyId,
    cityId,
    decisionMode: "COMPROMISE",
    terms: [{ termId, type: "talent_housing", quantity: 100 }],
  }, "测试政策包", [cityId === "chengdu" ? "fact_cd_capacity" : "fact_cq_capacity"]));
  if (result.receipt.status !== "APPLIED") throw new Error(`test policy failed: ${JSON.stringify(result.receipt.gateResults)}`);
  return result.state;
}
