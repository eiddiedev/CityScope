import { describe, expect, it } from "vitest";
import demoFixture from "../../fixtures/v0/cityscope-demo.json";
import contractSchema from "../../contracts/v0/schemas/contract.schema.json";
import { audienceNarrative, audienceValue, hasProtocolLeak, optimizerStatusLabel, presentationTerm, receiptStatusLabel } from "./presentationLanguage";

describe("audience presentation language", () => {
  it("translates every known protocol family before it reaches the UI", () => {
    const samples = [
      "政策包状态repair_required，应选择split_functions并减少duplicate_subsidy。",
      "候选candidate_5de3973885a10e2e采用fiscal_guard，当前company.projectStage为post_disclosure。",
      "审计返回RESOURCE_EXCEEDED，居民立场conditional，失败后renegotiate。",
    ];
    for (const sample of samples) {
      const visible = audienceNarrative(sample, 300);
      expect(visible).not.toMatch(/repair_required|split_functions|duplicate_subsidy|candidate_|fiscal_guard|company\.projectStage|post_disclosure|RESOURCE_EXCEEDED|conditional|renegotiate/);
      expect(hasProtocolLeak(visible)).toBe(false);
    }
    expect(optimizerStatusLabel("OPTIMAL")).toBe("已找到最优解");
    expect(receiptStatusLabel("APPLIED")).toBe("已进入世界");
    expect(presentationTerm("regional_coordinator")).toBe("区域协调 Agent");
    expect(audienceValue({ auditStatus: "repair_required", decisionMode: "COMPROMISE" })).toBe("审计状态：需要修订 · 决策方式：形成折中方案");
    expect(audienceNarrative("As CFO, I prioritize liquidity risk and fiscal cost because binding orders are only 34%.")).toBe("约束订单比例偏低，履约不确定性上升，需重新评估融资和兑现条件。");
  });

  it("sanitizes every narrative currently stored in the signed end-to-end fixture", () => {
    const fixture = demoFixture as unknown as {
      baseline: { steps: Array<{ candidate: { reasoning: string; payload: Record<string, unknown> }; receipt: { gateResults: Array<{ reason: string }> } }> };
      redlineProbe: { candidate: { reasoning: string }; receipt: { gateResults: Array<{ reason: string }> } };
    };
    const visible: string[] = [];
    for (const step of fixture.baseline.steps) {
      visible.push(audienceNarrative(step.candidate.reasoning, 500));
      for (const key of ["content", "summary"] as const) if (typeof step.candidate.payload[key] === "string") visible.push(audienceNarrative(step.candidate.payload[key] as string, 500));
      visible.push(...step.receipt.gateResults.map((gate) => audienceNarrative(gate.reason, 500)));
    }
    visible.push(audienceNarrative(fixture.redlineProbe.candidate.reasoning, 500));
    visible.push(...fixture.redlineProbe.receipt.gateResults.map((gate) => audienceNarrative(gate.reason, 500)));
    expect(visible.filter(hasProtocolLeak)).toEqual([]);
  });

  it("keeps every contract enum behind the presentation-language boundary", () => {
    const values = new Set<string>();
    const visit = (node: unknown) => {
      if (Array.isArray(node)) return node.forEach(visit);
      if (!node || typeof node !== "object") return;
      const record = node as Record<string, unknown>;
      if (Array.isArray(record.enum)) for (const value of record.enum) if (typeof value === "string") values.add(value);
      if (typeof record.const === "string") values.add(record.const);
      Object.values(record).forEach(visit);
    };
    visit(contractSchema);
    const visible = [...values].map((value) => presentationTerm(value));
    expect(visible.filter(hasProtocolLeak)).toEqual([]);
  });
});
