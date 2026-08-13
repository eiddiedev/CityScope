import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import demoFixture from "../../fixtures/v0/cityscope-demo.json";
import { cityScopeAdapter, type LiveForkResult } from "./adapters/cityscopeAdapter";
import { App } from "./App";

vi.mock("./visual/CitySandbox", () => ({
  CitySandbox: ({ onSelectActor }: { onSelectActor: (actorId: string) => void }) => <button type="button" data-testid="canvas-probe" aria-label="查看成都招商促进局" onClick={() => onSelectActor("chengdu_investment")} />,
}));

describe("CityScope integrated evidence workspace", () => {
  afterEach(() => vi.useRealTimers());

  beforeEach(() => {
    vi.restoreAllMocks();
    window.history.replaceState({}, "", "/");
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => demoFixture })));
  });

  it("waits for the replay button and advances the bottom process state with the 40-second timeline", async () => {
    const fixture = demoFixture as unknown as import("./adapters/cityscopeAdapter").CityScopeDemoFixture;
    const firstStep = structuredClone(fixture.baseline.steps[0]);
    const secondStep = structuredClone(fixture.baseline.steps[1]);
    const terminalState = structuredClone(fixture.baseline.terminalState);
    terminalState.cities.chengdu.resourceLedger.fiscalMillionCny.available = 100;
    secondStep.receipt.deltas = [{
      deltaId: "replay-fiscal-delta",
      causeId: secondStep.candidate.actionId,
      path: "cities.chengdu.resourceLedger.fiscalMillionCny.available",
      before: 700,
      after: 100,
      actorId: secondStep.actorId,
      worldVersion: secondStep.receipt.worldVersion,
    }];
    const result = {
      checkpointId: "pitch-checkpoint",
      intervention: { interventionId: "pitch-intervention", path: "metrics.financingConfidence", previousValue: 66, newValue: 5, reason: "路演" },
      baselineState: terminalState,
      forkState: terminalState,
      baselineOutcome: fixture.baseline.classification,
      forkOutcome: fixture.baseline.classification,
      baselineSteps: [firstStep, secondStep],
      forkSteps: [firstStep, secondStep],
      provider: "deepseek",
      model: "deepseek-v4-flash",
      causalComparison: {
        baselineRunId: terminalState.runId,
        interventionRunId: terminalState.runId,
        interventionPath: "metrics.financingConfidence",
        firstSemanticActionDivergence: null,
        firstWorldStateDivergence: null,
        propagationChain: [],
        baselineOutcome: fixture.baseline.classification.label,
        interventionOutcome: fixture.baseline.classification.label,
        outcomeChanged: false,
        absorbed: true,
        absorptionLayer: "candidate_generation",
      },
    } as LiveForkResult;
    vi.spyOn(cityScopeAdapter, "loadPitchReplay").mockResolvedValue({
      replayVersion: "cityscope.pitch-replay.v1",
      generatedAt: "2026-08-13T00:00:00.000Z",
      source: "recorded-deepseek-run",
      seed: 20260800,
      durationMs: 40_000,
      request: { path: "metrics.financingConfidence", newValue: 5, reason: "路演" },
      result,
    });
    window.history.replaceState({}, "", "/?replay=pitch-financing");

    render(<App />);
    expect(await screen.findByText("DeepSeek · 真实轨迹回放")).toBeInTheDocument();
    expect(screen.getByText(/A\/B DeepSeek 真实轨迹已完成/)).toBeInTheDocument();
    expect(screen.queryByText(/正在 40 秒加速重演/)).not.toBeInTheDocument();

    vi.useFakeTimers();
    fireEvent.click(screen.getByRole("button", { name: "重播双世界轨迹" }));
    expect(screen.getByText(/正在 40 秒加速重演/)).toBeInTheDocument();
    expect(screen.getByText(/成都：现金支持.*可用财政 700 百万/)).toBeInTheDocument();
    expect(screen.getAllByText("1 / 2 个行动")).toHaveLength(2);

    await act(async () => { vi.advanceTimersByTime(40_000); });
    expect(screen.getByText(/成都：现金支持.*可用财政 100 百万/)).toBeInTheDocument();
    expect(screen.getAllByText("2 / 2 个行动")).toHaveLength(2);
  });

  it("loads the signed autonomous fixture and frozen contract", async () => {
    render(<App />);
    expect(await screen.findByText("SIGNED FIXTURE")).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "三个核心图层" })).toBeInTheDocument();
    const map = screen.getByRole("img", { name: "CityScope 双城部门级 2.5D 沙盘" });
    const initialView = map.getAttribute("viewBox");
    fireEvent.wheel(map, { deltaY: -100 });
    expect(map.getAttribute("viewBox")).not.toBe(initialView);
    expect(screen.queryByLabelText("地图缩放控制")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("CityScope 首页")).not.toBeInTheDocument();
  });

  it("shows all 12 roles and 4 deterministic services as clickable organization buildings", async () => {
    render(<App />);
    await screen.findByText("SIGNED FIXTURE");
    fireEvent.click(screen.getByRole("button", { name: /^组织剖面$/ }));
    expect(screen.getByRole("heading", { name: "12 个角色，4 套确定性服务" })).toBeInTheDocument();
    expect(document.querySelectorAll(".organization-node")).toHaveLength(16);
    expect(screen.getByRole("button", { name: "查看成都城市决策中心" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "查看规则服务尽调数据站" })).toBeInTheDocument();
  });

  it("opens the organization profile directly from a presentation link", async () => {
    window.history.replaceState({}, "", "/?surface=organization");
    render(<App />);

    expect(await screen.findByRole("heading", { name: "12 个角色，4 套确定性服务" })).toBeInTheDocument();
    expect(screen.queryByText("没人应该赢下的超级工厂")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^组织剖面$/ })).toHaveClass("active");
  });

  it("highlights only the relationships connected to a hovered organization building", async () => {
    render(<App />);
    await screen.findByText("SIGNED FIXTURE");
    fireEvent.click(screen.getByRole("button", { name: /^组织剖面$/ }));
    expect(document.querySelectorAll(".org-relation.is-idle").length).toBeGreaterThan(0);
    fireEvent.pointerEnter(screen.getByRole("button", { name: "查看成都城市决策中心" }));
    expect(document.querySelectorAll(".org-relation.is-connected").length).toBeGreaterThan(0);
    expect(document.querySelectorAll(".org-relation.is-muted").length).toBeGreaterThan(0);
  });

  it("maps a semantic department building to its Agent X-Ray", async () => {
    render(<App />);
    await screen.findByText("SIGNED FIXTURE");
    fireEvent.click(await screen.findByRole("button", { name: "查看成都招商促进局" }));
    expect(screen.getByRole("heading", { name: "成都招商 Agent" })).toBeInTheDocument();
    expect(screen.getByText("具体分工")).toBeInTheDocument();
    expect(screen.getByText(/设计成都侧研发总部、人才住房和招商支持方案/)).toBeInTheDocument();
    expect(screen.getByText("正式权限")).toBeInTheDocument();
    expect(screen.getByText("提出方案")).toBeInTheDocument();
    expect(screen.getByText("决策权重")).toBeInTheDocument();
    expect(screen.getByText("创新价值")).toBeInTheDocument();
    expect(screen.getByText("不得绕过财政")).toBeInTheDocument();
  });

  it("opens a city-specific organization profile from the strategic rail", async () => {
    render(<App />);
    await screen.findByText("SIGNED FIXTURE");
    fireEvent.click(screen.getByRole("button", { name: /01 · CHENGDU.*成都高新区.*点击展开内部争论与权限结构/ }));
    expect(screen.getByRole("heading", { name: "成都高新区如何形成一份政策" })).toBeInTheDocument();
    expect(screen.queryByText("重庆负责人 Agent")).not.toBeInTheDocument();
  });

  it("opens the cause chain for the current run evidence", async () => {
    render(<App />);
    await screen.findByText("SIGNED FIXTURE");
    fireEvent.click(screen.getByRole("button", { name: "证据层" }));
    fireEvent.click(screen.getByRole("button", { name: "查看本行动 causeId 与前后状态" }));
    expect(screen.getByLabelText("制度证据检查器")).toBeInTheDocument();
    expect(screen.getAllByText(/项状态变化/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("格式校验").length).toBeGreaterThan(0);
  });

  it("shows CP-SAT candidates, role-specific TOPSIS, and Gate execution as one evidence chain", async () => {
    render(<App />);
    await screen.findByText("SIGNED FIXTURE");
    fireEvent.click(screen.getByRole("button", { name: "证据层" }));
    expect(screen.getByRole("heading", { name: "OR-Tools CP-SAT 生成 5 个可行布局" })).toBeInTheDocument();
    expect(screen.getByText(/采用第 1 名/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "算法只给证据，规则门决定能否改变世界" })).toBeInTheDocument();
    expect(screen.getByText("4/4 Gate 通过")).toBeInTheDocument();
  });

  it("keeps the comparison surface empty until a live run completes", async () => {
    render(<App />);
    await screen.findByText("SIGNED FIXTURE");
    fireEvent.click(screen.getByRole("button", { name: "证据层" }));
    fireEvent.click(screen.getByRole("tab", { name: "双世界对照" }));
    expect(screen.getByRole("heading", { name: "先完成一次双世界推演" })).toBeInTheDocument();
    expect(screen.getByText(/不再混入历史演示数据/)).toBeInTheDocument();
    expect(screen.queryByText("stakeholders.publicTrust")).not.toBeInTheDocument();
  });

  it("replaces the fixture timeline and evidence with completed DeepSeek steps", async () => {
    const fixture = demoFixture as unknown as import("./adapters/cityscopeAdapter").CityScopeDemoFixture;
    const liveStep = structuredClone(fixture.baseline.steps[0]);
    liveStep.candidate.reasoning = "作为居民，我支持balanced方案（cd_balanced_pack_001与cq_balanced_pack_001），但审计状态repair_required，需要先修订再兑现。";
    liveStep.generationSource = "model";
    vi.spyOn(cityScopeAdapter, "runLiveFork").mockResolvedValue({
      checkpointId: "live-checkpoint",
      intervention: { interventionId: "live-intervention", path: "metrics.financingConfidence", previousValue: 40, newValue: 30, reason: "test" },
      baselineState: fixture.baseline.terminalState,
      forkState: { ...fixture.baseline.terminalState, runId: "deepseek-fork" },
      baselineOutcome: fixture.baseline.classification,
      forkOutcome: fixture.baseline.classification,
      causalComparison: {
        baselineRunId: fixture.baseline.terminalState.runId,
        interventionRunId: "deepseek-fork",
        interventionPath: "metrics.financingConfidence",
        firstSemanticActionDivergence: null,
        firstWorldStateDivergence: null,
        propagationChain: [],
        baselineOutcome: fixture.baseline.classification.label,
        interventionOutcome: fixture.baseline.classification.label,
        outcomeChanged: false,
        absorbed: true,
        absorptionLayer: "candidate_generation",
      },
      baselineSteps: [liveStep],
      forkSteps: [liveStep],
      provider: "deepseek",
      model: "deepseek-v4-flash",
    } as LiveForkResult);

    render(<App />);
    await screen.findByText("SIGNED FIXTURE");
    fireEvent.click(screen.getByRole("button", { name: "跳过背景介绍" }));
    fireEvent.click(screen.getByRole("button", { name: "设置唯一实验条件" }));
    fireEvent.click(screen.getByRole("button", { name: "开始双世界 Agent 推演" }));

    expect(await screen.findByText(/deepseek-v4-flash · LIVE/i)).toBeInTheDocument();
    expect(screen.getByText(/作为居民，我支持综合平衡方案，但审计状态需要修订，需要先修订再兑现/)).toBeInTheDocument();
    expect(screen.queryByText(/balanced|cd_balanced|cq_balanced|repair_required/)).not.toBeInTheDocument();
    expect(document.querySelector(".agent-map-speech.side-right, .agent-map-speech.side-left")).toBeInTheDocument();
    expect(screen.getByText(/A\/B 两套 DeepSeek 轨迹 · 初始单因实验已完成/)).toBeInTheDocument();
    expect(screen.getByText(/相同初始快照 · 仅一项条件不同/)).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "本轮推演结算" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /查看本轮复盘/ }));
    expect(screen.getByRole("tab", { name: /双世界对照/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("heading", { name: "实验条件被决策系统吸收" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "两侧行动序列未出现可观察分歧" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "实验条件未改变最终执行方案" })).toBeInTheDocument();
    expect(screen.getAllByText("未穿透")).toHaveLength(4);
    expect(screen.getByText("完整决策实录")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "1 个真实行动，不补写赛后对白" })).toBeInTheDocument();
    expect(screen.getByText(/系统只总结已发生的行动、消息、制度校验和状态变化/)).toBeInTheDocument();
    expect(screen.getAllByText("外部融资信心：40 分 → 30 分").length).toBeGreaterThan(0);
    expect(screen.queryByText("metrics.financingConfidence")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /播放安全预览/ })).not.toBeInTheDocument();
  });

  it("shows Token 不足 when DeepSeek reports exhausted balance", async () => {
    vi.spyOn(cityScopeAdapter, "runLiveFork").mockRejectedValue(new Error("DeepSeek HTTP 402 · insufficient_balance · Insufficient Balance"));
    render(<App />);
    await screen.findByText("SIGNED FIXTURE");
    fireEvent.click(screen.getByRole("button", { name: "跳过背景介绍" }));
    fireEvent.click(screen.getByRole("button", { name: "设置唯一实验条件" }));
    fireEvent.click(screen.getByRole("button", { name: "开始双世界 Agent 推演" }));
    expect(await screen.findByText("Token 不足")).toBeInTheDocument();
    expect(screen.getByText("Token 不足").closest(".quiet-status")).toHaveClass("token-insufficient");
  });

  it("keeps the fixed due-diligence shock inside an expandable live status panel", async () => {
    const fixture = demoFixture as unknown as import("./adapters/cityscopeAdapter").CityScopeDemoFixture;
    const dueDiligenceIndex = fixture.baseline.steps.findIndex((step) => step.candidate.kind === "DISCLOSE_FACT");
    const dueDiligenceSteps = fixture.baseline.steps.slice(0, dueDiligenceIndex + 1);
    vi.spyOn(cityScopeAdapter, "runLiveFork").mockImplementation(async (_request, onProgress) => {
      onProgress?.({
        stage: "risk",
        label: "两套世界同时收到订单约束率仅 34% 的尽调事实",
        baselineState: fixture.baseline.terminalState,
        forkState: fixture.baseline.terminalState,
        baselineSteps: dueDiligenceSteps,
        forkSteps: dueDiligenceSteps,
        intervention: { interventionId: "risk-test", path: "metrics.financingConfidence", previousValue: 68, newValue: 48, reason: "test" },
        completedPhase: "due_diligence",
      });
      return await new Promise<never>(() => undefined);
    });

    render(<App />);
    await screen.findByText("SIGNED FIXTURE");
    fireEvent.click(screen.getByRole("button", { name: "跳过背景介绍" }));
    fireEvent.click(screen.getByRole("button", { name: "设置唯一实验条件" }));
    fireEvent.click(screen.getByRole("button", { name: "开始双世界 Agent 推演" }));

    const status = await screen.findByRole("region", { name: "实时推演状态" });
    expect(status).toHaveTextContent(/等待尽调规则服务披露核验事实/);
    expect(document.querySelector(".checkpoint-moment")).not.toBeInTheDocument();
    expect(document.querySelector(".post-risk-progress")).not.toBeInTheDocument();
    fireEvent.click(status.querySelector("button")!);
    expect(screen.getByText("公众信任")).toBeInTheDocument();
    expect(screen.getByText(/约束订单比例来自本场景固定尽调事实/)).toBeInTheDocument();
  });

  it("turns real coordination messages into a focused three-party negotiation stage", async () => {
    const fixture = demoFixture as unknown as import("./adapters/cityscopeAdapter").CityScopeDemoFixture;
    const coordinationIndex = fixture.baseline.steps.findIndex((step) => step.phase === "coordination_debate" && step.actorId === "chengdu_leader");
    const coordinationSteps = fixture.baseline.steps.slice(0, coordinationIndex + 1);
    vi.spyOn(cityScopeAdapter, "runLiveFork").mockImplementation(async (_request, onProgress) => {
      onProgress?.({
        stage: "parallel",
        label: "成渝负责人正在回应协调 Agent",
        baselineState: fixture.baseline.terminalState,
        forkState: fixture.baseline.terminalState,
        baselineSteps: coordinationSteps,
        forkSteps: coordinationSteps,
        intervention: { interventionId: "debate-test", path: "metrics.financingConfidence", previousValue: 68, newValue: 48, reason: "test" },
        completedPhase: "coordination_debate",
      });
      return await new Promise<never>(() => undefined);
    });

    render(<App />);
    await screen.findByText("SIGNED FIXTURE");
    fireEvent.click(screen.getByRole("button", { name: "跳过背景介绍" }));
    fireEvent.click(screen.getByRole("button", { name: "设置唯一实验条件" }));
    fireEvent.click(screen.getByRole("button", { name: "开始双世界 Agent 推演" }));

    expect(await screen.findByRole("region", { name: "成渝协调谈判" })).toBeInTheDocument();
    expect(document.querySelector(".coordination-debate-backdrop")).toBeInTheDocument();
    expect(screen.getByText("不是轮流念稿，而是围绕同一议题持续回应")).toBeInTheDocument();
    expect(screen.getByText(/等待\s+重庆负责人 Agent 回复/)).toBeInTheDocument();
    expect(await screen.findByText(/成都坚持研发总部与高端人才平台/, {}, { timeout: 3_000 })).toBeInTheDocument();
    expect(screen.queryByText("仅谈判参与者可见")).not.toBeInTheDocument();
  });
});
