import { describe, expect, it } from "vitest";
import { decisionViewFor } from "../src/agents/decision-view.js";
import { observe } from "../src/agents/manifests.js";
import { createInitialState } from "../src/world/initial-state.js";
import { digest } from "../src/util.js";

describe("agent decision view", () => {
  it("removes execution history and run metadata while preserving decision state", () => {
    const state = createInitialState("compact_observation");
    state.events.push(...Array.from({ length: 30 }, (_, index) => ({
      eventId: `event_${index}`,
      eventType: "StateChanged" as const,
      causeId: `cause_${index}`,
      actorId: "orchestrator",
      worldVersion: index,
      occurredAt: new Date(index * 1_000).toISOString(),
      payload: { verbose: "x".repeat(200) },
    })));
    const visible = observe(state, "resident");
    const view = decisionViewFor(visible, "resident");
    const serialized = JSON.stringify(view);

    expect(serialized).not.toContain("compact_observation");
    expect(serialized).not.toContain("occurredAt");
    expect(serialized).not.toContain("worldVersion");
    expect(serialized).not.toContain("receipts");
    expect(serialized).not.toContain("trace");
    expect(serialized.length).toBeLessThan(JSON.stringify(visible).length * 0.55);
    expect(view.cities.chengdu.resources.factorySqm).toBe(60_000);
    expect(view.company.investmentPlanMillionCny).toBe(3_000);
  });

  it("keeps privacy filtering and creates cross-run semantic identity", () => {
    const first = createInitialState("semantic_a");
    const second = createInitialState("semantic_b");
    second.worldVersion = 88;
    const residentFirst = decisionViewFor(observe(first, "resident"), "resident");
    const residentSecond = decisionViewFor(observe(second, "resident"), "resident");

    expect(residentFirst.visibleFacts).toEqual([]);
    expect(digest(residentFirst)).toBe(digest(residentSecond));
    second.metrics.trust -= 1;
    expect(digest(residentFirst)).not.toBe(digest(decisionViewFor(observe(second, "resident"), "resident")));
  });

  it("isolates organization-internal advice, memories, and participant-scoped debate", () => {
    const state = createInitialState("organization_privacy");
    state.cities.chengdu.internalAdvice.push({ actionId: "cd_private", actorId: "chengdu_finance", proposal: { ceiling: 500 } });
    state.cities.chongqing.internalAdvice.push({ actionId: "cq_private", actorId: "chongqing_finance", proposal: { ceiling: 360 } });
    state.company.internalAdvice.push({ actionId: "cfo_private", actorId: "company_cfo", proposal: { runway: 12 } });
    state.agentMemory.chengdu_leader?.push({ causeId: "memory_cd", summary: "成都内部记忆" });
    state.agentMemory.chongqing_leader?.push({ causeId: "memory_cq", summary: "重庆内部记忆" });
    state.debateThreads.push({
      threadId: "coordination-main", topic: "test", participantIds: ["regional_coordinator", "chengdu_leader", "chongqing_leader"], status: "open",
      messages: [{ messageId: "private_message", threadId: "coordination-main", actorId: "chengdu_leader", sequence: 1, turnType: "position", issue: "functional_allocation", stance: "conditional", content: "只向协调参与者开放", audience: ["regional_coordinator", "chengdu_leader", "chongqing_leader"], visibility: "participants", createdAtVersion: 1 }],
    });

    const chengdu = observe(state, "chengdu_leader");
    expect(chengdu.cities.chengdu.internalAdvice).toHaveLength(1);
    expect(chengdu.cities.chongqing.internalAdvice).toEqual([]);
    expect(chengdu.company.internalAdvice).toEqual([]);
    expect(Object.keys(chengdu.agentMemory)).toEqual(["chengdu_leader"]);
    expect(JSON.stringify(chengdu)).not.toContain("重庆内部记忆");
    expect(chengdu.debateThreads[0]?.messages).toHaveLength(1);

    const chengduFinance = observe(state, "chengdu_finance");
    expect(chengduFinance.cities.chengdu.internalAdvice).toHaveLength(1);
    expect(chengduFinance.cities.chengdu.internalAdvice[0]?.actorId).toBe("chengdu_finance");

    const board = observe(state, "company_board");
    expect(board.company.internalAdvice).toHaveLength(1);
    expect(board.cities.chengdu.internalAdvice).toEqual([]);
    expect(board.cities.chongqing.internalAdvice).toEqual([]);
    expect(board.debateThreads).toEqual([]);

    const ceo = observe(state, "company_ceo");
    expect(ceo.company.internalAdvice).toEqual([]);
  });
});
