import { describe, expect, it } from "vitest";
import { observe, scoreForAgent, validateManifestWeights } from "../src/agents/manifests.js";
import { makeAction } from "../src/orchestrator/actions.js";
import { createInitialState } from "../src/world/initial-state.js";
import { applyAction } from "../src/world/reducer.js";

describe("authority, constraints and privacy", () => {
  it("prevents a department from signing a city PolicyPack", () => {
    const state = createInitialState();
    const action = makeAction("chengdu_investment", "SUBMIT_POLICY_PACK", { policyId: "illegal", cityId: "chengdu", decisionMode: "COMPROMISE", terms: [] }, "越权签署");
    const result = applyAction(state, action);
    expect(result.receipt.status).toBe("REJECTED");
    expect(result.receipt.gateResults).toContainEqual(expect.objectContaining({ gate: "authority", passed: false, code: "AUTHORITY_DENIED" }));
    expect(result.receipt.deltas).toEqual([]);
    expect(result.state.worldVersion).toBe(state.worldVersion);
  });

  it("rejects over-budget policy without any StateDelta", () => {
    const state = createInitialState();
    const action = makeAction("chengdu_leader", "SUBMIT_POLICY_PACK", {
      policyId: "over_budget", cityId: "chengdu", decisionMode: "COMPROMISE",
      terms: [{ termId: "cash", type: "cash_support", amountMillionCny: 701, trigger: { metric: "verifiedJobs", operator: ">=", value: 1 } }],
    }, "测试财政红线", ["fact_cd_capacity"]);
    const result = applyAction(state, action);
    expect(result.receipt.status).toBe("REJECTED");
    expect(result.receipt.deltas).toHaveLength(0);
    expect(result.state.cities.chengdu.policies).toHaveLength(0);
  });

  it("blocks references to facts outside the actor observation", () => {
    const state = createInitialState();
    const action = makeAction("chengdu_investment", "ADVISE_POLICY", { support: 600 }, "偷看订单", ["fact_orders_nonbinding"]);
    const result = applyAction(state, action);
    expect(result.receipt.status).toBe("REJECTED");
    expect(result.receipt.gateResults).toContainEqual(expect.objectContaining({ code: "PRIVATE_FACT_FORBIDDEN" }));
  });

  it("does not disclose private facts through observation filtering", () => {
    const cityView = observe(createInitialState(), "chengdu_investment");
    expect(cityView.facts.map((fact) => fact.factId)).not.toContain("fact_orders_nonbinding");
    const cfoView = observe(createInitialState(), "company_cfo");
    expect(cfoView.facts.map((fact) => fact.factId)).toContain("fact_orders_nonbinding");
  });

  it("rejects outcome-directing fields even when nested in payload", () => {
    const action = { ...makeAction("chengdu_investment", "ADVISE_POLICY", { desiredOutcome: "chengdu_wins" }, "非法导演字段") };
    const result = applyAction(createInitialState(), action);
    expect(result.receipt.status).toBe("REJECTED");
    expect(result.receipt.gateResults[0]).toEqual(expect.objectContaining({ code: "INVALID_ACTION_SCHEMA" }));
  });

  it("requires CEO and CFO advice before board formal response", () => {
    const action = makeAction("company_board", "SUBMIT_COMPANY_RESPONSE", { responseId: "early", targetPolicyIds: [], requestedChanges: [] }, "过早回应");
    const result = applyAction(createInitialState(), action);
    expect(result.receipt.status).toBe("REJECTED");
    expect(result.receipt.gateResults).toContainEqual(expect.objectContaining({ code: "CONSTRAINT_VIOLATION" }));
  });
});

describe("independent role scoring", () => {
  it("keeps every non-empty manifest utility normalized", () => {
    expect(validateManifestWeights()).toEqual([]);
  });

  it("scores the same proposal differently for Chengdu and Chongqing", () => {
    const dimensions = { rd_jobs: 90, senior_talent: 80, headquarters: 100, investment_scale: 70, manufacturing_output: 20, factory_landing: 15, supply_chain: 10, jobs: 40 };
    const chengdu = scoreForAgent("chengdu_investment", dimensions);
    const chongqing = scoreForAgent("chongqing_investment", dimensions);
    expect(chengdu.total).toBeGreaterThan(chongqing.total);
    expect(chengdu.components).not.toEqual(chongqing.components);
  });
});

