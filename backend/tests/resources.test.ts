import { describe, expect, it } from "vitest";
import { makeAction } from "../src/orchestrator/actions.js";
import { calculateEnergy, calculateFiscal, calculateLandAndFacility, calculateTalentHousing, commitResources, createResourceLedger, releaseResources, reserveResources } from "../src/rules/tools/resource-ledger.js";
import { createCheckpoint, forkFromCheckpoint } from "../src/trace/checkpoint.js";
import { createInitialState } from "../src/world/initial-state.js";
import { applyAction } from "../src/world/reducer.js";

describe("deterministic resource tools", () => {
  it("handles exact boundaries and over-limit requests for all four calculators", () => {
    const ledger = createResourceLedger({ fiscalMillionCny: 100, landHectares: 10, factorySqm: 1000, energyMw: 20, talentHousingUnits: 50 });
    expect(calculateFiscal(ledger, 100)).toMatchObject({ passed: true, remaining: 0, reasonCode: "RESOURCE_OK" });
    expect(calculateFiscal(ledger, 100.01)).toMatchObject({ passed: false, reasonCode: "RESOURCE_EXCEEDED" });
    expect(calculateLandAndFacility(ledger, 10, 1001)).toEqual([expect.objectContaining({ resource: "landHectares", passed: true }), expect.objectContaining({ resource: "factorySqm", passed: false })]);
    expect(calculateEnergy(ledger, 21)).toMatchObject({ passed: false, resource: "energyMw" });
    expect(calculateTalentHousing(ledger, 50)).toMatchObject({ passed: true, remaining: 0 });
  });

  it("prevents duplicate reservations and supports commit/release lifecycle", () => {
    const ledger = createResourceLedger({ fiscalMillionCny: 100, landHectares: 10, factorySqm: 1000, energyMw: 20, talentHousingUnits: 50 });
    const calculation = calculateFiscal(ledger, 70);
    const reserved = reserveResources(ledger, [calculation]);
    expect(calculateFiscal(reserved, 70)).toMatchObject({ passed: false, available: 30, reserved: 70 });
    const committed = commitResources(reserved, { fiscalMillionCny: 70 });
    expect(committed.fiscalMillionCny).toMatchObject({ available: 30, reserved: 0, committed: 70 });
    const released = releaseResources(committed, { fiscalMillionCny: 70 }, "committed");
    expect(released.fiscalMillionCny).toMatchObject({ available: 100, committed: 0, released: 70 });
  });

  it("rejects a second PolicyPack that reuses resources and exposes calculation evidence", () => {
    const initial = createInitialState();
    const payload = { cityId: "chengdu", decisionMode: "COMPROMISE", terms: [{ termId: "cash", type: "cash_support", amountMillionCny: 400, trigger: { metric: "verifiedJobs", operator: ">=", value: 300 } }, { termId: "land", type: "land", quantity: 30 }] };
    const first = applyAction(initial, makeAction("chengdu_leader", "SUBMIT_POLICY_PACK", { ...payload, policyId: "resource_policy_1" }, "first reservation", ["fact_cd_capacity"]));
    expect(first.receipt.status).toBe("APPLIED");
    expect(first.state.cities.chengdu.resourceLedger.fiscalMillionCny).toMatchObject({ available: 300, reserved: 400 });
    const duplicate = applyAction(first.state, makeAction("chengdu_leader", "SUBMIT_POLICY_PACK", { ...payload, policyId: "resource_policy_2" }, "duplicate reservation", ["fact_cd_capacity"]));
    expect(duplicate.receipt.status).toBe("REJECTED");
    const resourceGate = duplicate.receipt.gateResults.find((gate) => gate.gate === "constraint");
    expect(resourceGate?.calculations?.find((item) => item.resource === "fiscalMillionCny")).toMatchObject({ requested: 400, available: 300, reserved: 400, passed: false, reasonCode: "RESOURCE_EXCEEDED" });
    expect(duplicate.receipt.deltas).toEqual([]);
  });

  it("releases rejected policy reservations and isolates fork ledgers", () => {
    const initial = createInitialState();
    const issued = applyAction(initial, makeAction("chengdu_leader", "SUBMIT_POLICY_PACK", { policyId: "release_policy", cityId: "chengdu", decisionMode: "COMPROMISE", terms: [{ termId: "housing", type: "talent_housing", quantity: 500 }] }, "reserve housing", ["fact_cd_capacity"]));
    const checkpoint = createCheckpoint(issued.state, "resource_checkpoint");
    const fork = forkFromCheckpoint(checkpoint, "resource_fork", { interventionId: "public_only", path: "stakeholders.publicTrust", previousValue: issued.state.stakeholders.publicTrust, newValue: 55, reason: "fork isolation" });
    const released = applyAction(fork, makeAction("company_board", "REJECT_POLICY", { policyId: "release_policy" }, "reject and release"));
    expect(released.state.cities.chengdu.resourceLedger.talentHousingUnits).toMatchObject({ available: 650, reserved: 0, released: 500 });
    expect(checkpoint.state.cities.chengdu.resourceLedger.talentHousingUnits).toMatchObject({ available: 150, reserved: 500, released: 0 });
  });
});

