import type {
  ActorManifest,
  AgentAction,
  Checkpoint,
  DecisionReceipt,
  Intervention,
  Outcome,
  SemanticEffects,
  WorldState,
} from "../../../contracts/v0/generated/types";

export interface AdapterHealth {
  mode: "live" | "signed-fixture" | "unavailable";
  ready: boolean;
  contractVersion: string | null;
  fixtureVersion: string | null;
  message: string;
  provider: string | null;
  model: string | null;
  demoMode: boolean;
}

export interface DemoStep {
  phase: string;
  actorId: string;
  actorKind: "agent" | "service";
  generationSource: string;
  candidate: AgentAction;
  receipt: DecisionReceipt;
}

export interface RunProjection {
  runId: string;
  runMode: "autonomous";
  provider: string;
  model: string;
  terminalState: WorldState;
  semanticEffects: SemanticEffects;
  steps: DemoStep[];
  checkpoint: Checkpoint;
  classification: Outcome;
}

export interface ForkProjection {
  runId: string;
  parentRunId: string;
  intervention: Intervention;
  terminalState: WorldState;
  semanticEffects: SemanticEffects;
  classification: Outcome;
}

export interface EvalProjection {
  id: string;
  description: string;
  metrics: Record<string, number>;
  provenance: string;
}

export interface CityScopeDemoFixture {
  contractVersion: "0.1.0";
  fixtureVersion: "0.1.0";
  schemaVersion: "cityscope.contract.v0";
  scenario: {
    id: string;
    title: string;
    company: string;
    investmentMillionCny: number;
    cities: ["chengdu", "chongqing"];
  };
  actorRegistry: ActorManifest[];
  baseline: RunProjection;
  redlineProbe: { label: string; candidate: AgentAction; receipt: DecisionReceipt };
  forks: ForkProjection[];
  eval: EvalProjection[];
}

export interface LiveForkRequest {
  path: "stakeholders.publicTrust" | "stakeholders.talentAttraction" | "stakeholders.supplyChainReadiness" | "company.investmentPlanMillionCny" | "metrics.financingConfidence" | "metrics.projectViability";
  adjustment: number;
  adjustmentMode: "percent" | "points";
  reason: string;
}

export interface CityCompetitionEvidence {
  method: "topsis-city-offer-v1";
  generatedAtWorldVersion: number;
  dimensions: Array<{
    id: "policyValue" | "industryFit" | "executionCapacity" | "publicBenefit" | "fiscalBurden";
    label: string;
    direction: "benefit" | "cost";
    weight: number;
    raw: Record<"chengdu" | "chongqing", number>;
    preferenceShare: Record<"chengdu" | "chongqing", number>;
  }>;
  scores: Record<"chengdu" | "chongqing", { closeness: number; rank: 1 | 2; share: number }>;
  preferredCity: "chengdu" | "chongqing";
}

export interface LiveForkResult {
  checkpointId: string;
  intervention: Intervention;
  baselineState: WorldState;
  forkState: WorldState;
  baselineOutcome: Outcome;
  forkOutcome: Outcome;
  baselineSteps: DemoStep[];
  forkSteps: DemoStep[];
  baselineCompetition?: CityCompetitionEvidence;
  forkCompetition?: CityCompetitionEvidence;
  provider: string;
  model: string;
}

export interface LiveForkProgress {
  stage: "parallel" | "risk" | "post_risk";
  label: string;
  baselineState: WorldState;
  forkState: WorldState;
  baselineSteps: DemoStep[];
  forkSteps: DemoStep[];
  intervention: Intervention;
  baselineCompetition?: CityCompetitionEvidence;
  forkCompetition?: CityCompetitionEvidence;
  completedPhase?: string;
}

interface ApiAutonomousStep {
  phase: string;
  actorId: string;
  candidate: AgentAction;
  receiptId: string;
  generationSource: string;
}

export interface CityScopeAdapter {
  health(): Promise<AdapterHealth>;
  loadDemo(): Promise<CityScopeDemoFixture>;
  loadWorldSnapshot(): Promise<WorldState>;
  runLiveFork(request: LiveForkRequest, onProgress?: (progress: LiveForkProgress) => void): Promise<LiveForkResult>;
}

let fixturePromise: Promise<CityScopeDemoFixture> | undefined;

async function fetchFixture(): Promise<CityScopeDemoFixture> {
  const response = await fetch("/cityscope-demo.json", { cache: "no-store" });
  if (!response.ok) throw new Error(`FIXTURE_HTTP_${response.status}`);
  const value = await response.json() as CityScopeDemoFixture;
  if (value.contractVersion !== "0.1.0" || value.fixtureVersion !== "0.1.0") throw new Error("FIXTURE_VERSION_MISMATCH");
  if (value.actorRegistry.length !== 16) throw new Error("ACTOR_REGISTRY_INCOMPLETE");
  return value;
}

function loadOnce(): Promise<CityScopeDemoFixture> {
  fixturePromise ??= fetchFixture();
  return fixturePromise;
}

export const cityScopeAdapter: CityScopeAdapter = {
  async health() {
    let fixture: CityScopeDemoFixture;
    try {
      fixture = await loadOnce();
    } catch (error) {
      return {
        mode: "unavailable",
        ready: false,
        contractVersion: null,
        fixtureVersion: null,
        provider: null,
        model: null,
        demoMode: true,
        message: error instanceof Error ? error.message : "签名 Fixture 不可用",
      };
    }
    try {
      const backend = await getJson<{ ok: boolean; provider: string; model: string; demoMode: boolean }>("/healthz");
      if (backend.ok && !backend.demoMode) {
        return {
          mode: "live",
          ready: true,
          contractVersion: fixture.contractVersion,
          fixtureVersion: fixture.fixtureVersion,
          provider: backend.provider,
          model: backend.model,
          demoMode: false,
          message: `${backend.provider} / ${backend.model} 已连接；Fixture 仅作启动预览`,
        };
      }
      return {
        mode: "signed-fixture",
        ready: true,
        contractVersion: fixture.contractVersion,
        fixtureVersion: fixture.fixtureVersion,
        provider: backend.provider,
        model: backend.model,
        demoMode: true,
        message: `${fixture.baseline.steps.length} 步自主轨迹已通过 Contract v${fixture.contractVersion} 校验`,
      };
    } catch (error) {
      return {
        mode: "signed-fixture",
        ready: true,
        contractVersion: fixture.contractVersion,
        fixtureVersion: fixture.fixtureVersion,
        provider: fixture.baseline.provider,
        model: fixture.baseline.model,
        demoMode: true,
        message: `实时后端不可用，已降级到 ${fixture.baseline.steps.length} 步签名 Fixture${error instanceof Error ? `：${error.message}` : ""}`,
      };
    }
  },
  loadDemo: loadOnce,
  async loadWorldSnapshot() {
    return (await loadOnce()).baseline.terminalState;
  },
  async runLiveFork(request, onProgress) {
    const fixture = await loadOnce();
    const suffix = `${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
    const rootRunId = `live_root_${suffix}`;
    const forkRunId = `live_fork_${suffix}`;
    const checkpointId = `live_checkpoint_${suffix}`;
    const initial = await postJson<WorldState>("/api/v0/runs", { runId: rootRunId, seed: 20260811 });
    const checkpoint = await postJson<Checkpoint>(`/api/v0/runs/${rootRunId}/checkpoints`, { checkpointId });
    const previousValue = numberAtPath(initial, request.path);
    const newValue = resolveInterventionValue(previousValue, request);
    const intervention: Intervention = {
      interventionId: `human_${suffix}`,
      path: request.path,
      previousValue,
      newValue,
      reason: request.reason,
    };
    let baselineState = initial;
    let forkState = await postJson<WorldState>(`/api/v0/checkpoints/${checkpointId}/forks`, { runId: forkRunId, intervention });
    let [baselineCompetition, forkCompetition] = await Promise.all([
      getJson<CityCompetitionEvidence>(`/api/v0/runs/${rootRunId}/competition`),
      getJson<CityCompetitionEvidence>(`/api/v0/runs/${forkRunId}/competition`),
    ]);
    let visibleBaselineSteps = 0;
    let visibleForkSteps = 0;
    let nextFrameReadyAt = 0;
    const publishFrames = async (
      stage: LiveForkProgress["stage"],
      label: string,
      currentBaselineState: WorldState,
      currentForkState: WorldState,
      baselineApiSteps: ApiAutonomousStep[],
      forkApiSteps: ApiAutonomousStep[],
      currentBaselineCompetition: CityCompetitionEvidence,
      currentForkCompetition: CityCompetitionEvidence,
      completedPhase?: string,
      force = false,
    ) => {
      let emitted = false;
      while (visibleBaselineSteps < baselineApiSteps.length || visibleForkSteps < forkApiSteps.length) {
        const remainingReadingTime = nextFrameReadyAt - Date.now();
        if (remainingReadingTime > 0) await waitForMilliseconds(remainingReadingTime);
        visibleBaselineSteps = Math.min(baselineApiSteps.length, visibleBaselineSteps + 1);
        visibleForkSteps = Math.min(forkApiSteps.length, visibleForkSteps + 1);
        const visibleBaselineStep = baselineApiSteps[visibleBaselineSteps - 1];
        const visibleForkStep = forkApiSteps[visibleForkSteps - 1];
        onProgress?.({
          stage,
          label,
          baselineState: currentBaselineState,
          forkState: currentForkState,
          baselineSteps: materializeSteps(baselineApiSteps.slice(0, visibleBaselineSteps), currentBaselineState, fixture),
          forkSteps: materializeSteps(forkApiSteps.slice(0, visibleForkSteps), currentForkState, fixture),
          intervention,
          baselineCompetition: currentBaselineCompetition,
          forkCompetition: currentForkCompetition,
          completedPhase,
        });
        emitted = true;
        nextFrameReadyAt = Date.now() + readingDelayMs(visibleBaselineStep, visibleForkStep);
      }
      if (force && !emitted) {
        onProgress?.({
          stage,
          label,
          baselineState: currentBaselineState,
          forkState: currentForkState,
          baselineSteps: materializeSteps(baselineApiSteps, currentBaselineState, fixture),
          forkSteps: materializeSteps(forkApiSteps, currentForkState, fixture),
          intervention,
          baselineCompetition: currentBaselineCompetition,
          forkCompetition: currentForkCompetition,
          completedPhase,
        });
      }
    };
    const advancePhaseLive = async (phase: Exclude<WorldState["simulation"]["phase"], "complete">, finalStage: LiveForkProgress["stage"], finalLabel: string) => {
      let baselineDone = baselineState.simulation.phase === "complete";
      let forkDone = forkState.simulation.phase === "complete";
      // A/B may leave a phase at different times after the risk disclosure.
      // Advance each world only through its own current phase so neither side
      // silently consumes several later phases while the UI waits.
      const baselineTargetPhase = baselineState.simulation.phase;
      const forkTargetPhase = forkState.simulation.phase;
      const baselineAdvance = baselineDone
        ? Promise.resolve(baselineState)
        : postJson<WorldState>(`/api/v0/runs/${rootRunId}/advance?stopAfterPhase=${baselineTargetPhase}`, {}, baselineState.worldVersion);
      const forkAdvance = forkDone
        ? Promise.resolve(forkState)
        : postJson<WorldState>(`/api/v0/runs/${forkRunId}/advance?stopAfterPhase=${forkTargetPhase}`, {}, forkState.worldVersion);
      baselineAdvance.then(() => { baselineDone = true; }, () => { baselineDone = true; });
      forkAdvance.then(() => { forkDone = true; }, () => { forkDone = true; });

      await Promise.resolve();
      while (!baselineDone || !forkDone) {
        await waitForPoll();
        const [streamedBaselineState, streamedForkState, baselineApiSteps, forkApiSteps, streamedBaselineCompetition, streamedForkCompetition] = await Promise.all([
          getJson<WorldState>(`/api/v0/runs/${rootRunId}`),
          getJson<WorldState>(`/api/v0/runs/${forkRunId}`),
          getJson<ApiAutonomousStep[]>(`/api/v0/runs/${rootRunId}/steps`),
          getJson<ApiAutonomousStep[]>(`/api/v0/runs/${forkRunId}/steps`),
          getJson<CityCompetitionEvidence>(`/api/v0/runs/${rootRunId}/competition`),
          getJson<CityCompetitionEvidence>(`/api/v0/runs/${forkRunId}/competition`),
        ]);
        baselineCompetition = streamedBaselineCompetition;
        forkCompetition = streamedForkCompetition;
        await publishFrames(stageForPhase(phase), `${progressLabel(phase)} · 正在生成下一位 Agent 的回应`, streamedBaselineState, streamedForkState, baselineApiSteps, forkApiSteps, baselineCompetition, forkCompetition, phase, true);
      }

      [baselineState, forkState] = await Promise.all([baselineAdvance, forkAdvance]);
      const [baselineApiSteps, forkApiSteps, finalBaselineCompetition, finalForkCompetition] = await Promise.all([
        getJson<ApiAutonomousStep[]>(`/api/v0/runs/${rootRunId}/steps`),
        getJson<ApiAutonomousStep[]>(`/api/v0/runs/${forkRunId}/steps`),
        getJson<CityCompetitionEvidence>(`/api/v0/runs/${rootRunId}/competition`),
        getJson<CityCompetitionEvidence>(`/api/v0/runs/${forkRunId}/competition`),
      ]);
      baselineCompetition = finalBaselineCompetition;
      forkCompetition = finalForkCompetition;
      await publishFrames(finalStage, finalLabel, baselineState, forkState, baselineApiSteps, forkApiSteps, baselineCompetition, forkCompetition, phase, true);
    };
    onProgress?.({
      stage: "parallel",
      label: `两套 Agent 已从同一初始快照启动，实验世界应用 ${request.reason}`,
      baselineState,
      forkState,
      baselineSteps: [],
      forkSteps: [],
      intervention,
      baselineCompetition,
      forkCompetition,
    });
    const parallelPhases = ["internal_advice", "policy_formation", "policy_audit", "coordination_debate", "stakeholder_reaction", "company_deliberation", "due_diligence"] as const;
    for (const phase of parallelPhases) {
      await advancePhaseLive(
        phase,
        phase === "due_diligence" ? "risk" : "parallel",
        phase === "due_diligence" ? "两套世界同时收到订单约束率仅 34% 的尽调事实" : progressLabel(phase),
      );
    }
    // Continue phase by phase until both worlds really reach complete. The
    // previous fixed three-phase loop could leave one world waiting after its
    // 29th visible action and then hide a long terminal request from the UI.
    let postRiskPhaseCount = 0;
    while (baselineState.simulation.phase !== "complete" || forkState.simulation.phase !== "complete") {
      postRiskPhaseCount += 1;
      if (postRiskPhaseCount > 8) throw new Error("终局推进超过安全上限，请重新开始本轮推演");
      const baselinePhase = baselineState.simulation.phase;
      const forkPhase = forkState.simulation.phase;
      const phaseToAdvance = baselinePhase === "complete" ? forkPhase : baselinePhase;
      if (phaseToAdvance === "complete") break;
      await advancePhaseLive(phaseToAdvance, "post_risk", postRiskProgressLabel(baselinePhase, forkPhase));
    }
    const [preTerminalBaselineSteps, preTerminalForkSteps] = await Promise.all([
      getJson<ApiAutonomousStep[]>(`/api/v0/runs/${rootRunId}/steps`),
      getJson<ApiAutonomousStep[]>(`/api/v0/runs/${forkRunId}/steps`),
    ]);
    await publishFrames("post_risk", "所有 Agent 行动已完成，正在执行终局分类", baselineState, forkState, preTerminalBaselineSteps, preTerminalForkSteps, baselineCompetition, forkCompetition, "complete", true);
    [baselineState, forkState] = await Promise.all([
      baselineState.terminal ? Promise.resolve(baselineState) : postJson<WorldState>(`/api/v0/runs/${rootRunId}/advance`, {}, baselineState.worldVersion),
      forkState.terminal ? Promise.resolve(forkState) : postJson<WorldState>(`/api/v0/runs/${forkRunId}/advance`, {}, forkState.worldVersion),
    ]);
    const [baselineOutcome, forkOutcome, baselineApiSteps, forkApiSteps, finalBaselineCompetition, finalForkCompetition] = await Promise.all([
      getJson<Outcome>(`/api/v0/runs/${rootRunId}/outcome`),
      getJson<Outcome>(`/api/v0/runs/${forkRunId}/outcome`),
      getJson<ApiAutonomousStep[]>(`/api/v0/runs/${rootRunId}/steps`),
      getJson<ApiAutonomousStep[]>(`/api/v0/runs/${forkRunId}/steps`),
      getJson<CityCompetitionEvidence>(`/api/v0/runs/${rootRunId}/competition`),
      getJson<CityCompetitionEvidence>(`/api/v0/runs/${forkRunId}/competition`),
    ]);
    return {
      checkpointId: checkpoint.checkpointId,
      intervention,
      baselineState,
      forkState,
      baselineOutcome,
      forkOutcome,
      baselineSteps: materializeSteps(baselineApiSteps, baselineState, fixture),
      forkSteps: materializeSteps(forkApiSteps, forkState, fixture),
      baselineCompetition: finalBaselineCompetition,
      forkCompetition: finalForkCompetition,
      provider: forkState.snapshot.provider,
      model: forkState.snapshot.model,
    };
  },
};

function progressLabel(phase: string): string {
  return ({
    internal_advice: "双城招商与财政部门正在形成内部意见",
    policy_formation: "两座城市的负责人正在合成正式政策包",
    policy_audit: "政策监督 Agent 正在检查资源红线与兑现条件",
    coordination_debate: "成渝负责人正在回应协调 Agent，并形成可追溯让步",
    stakeholder_reaction: "人才、中小企业与居民正在反馈政策影响",
    company_deliberation: "CEO、CFO、投资机构与董事会正在评估两城方案",
  } as Record<string, string>)[phase] ?? "Agent 正在更新共同世界";
}

function stageForPhase(phase: string): LiveForkProgress["stage"] {
  if (phase === "due_diligence") return "risk";
  if (["post_disclosure", "delivery", "delivery_reaction", "complete"].includes(phase)) return "post_risk";
  return "parallel";
}

function postRiskProgressLabel(baselinePhase: string, forkPhase: string): string {
  const phases = new Set([baselinePhase, forkPhase]);
  if (phases.has("post_disclosure")) return "社会主体与董事会正在根据风险重新谈判";
  if (phases.has("delivery")) return "规则服务正在核验承诺、财政与项目履约";
  if (phases.has("delivery_reaction")) return "人才、居民与中小企业正在反馈最终影响";
  return "两套世界正在形成可追溯结局";
}

function waitForPoll(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 240));
}

function readingDelayMs(...steps: Array<ApiAutonomousStep | undefined>): number {
  const readingLength = Math.max(0, ...steps.map((step) => {
    if (!step) return 0;
    const payload = step.candidate.payload as { content?: unknown; summary?: unknown };
    const text = typeof payload.content === "string"
      ? payload.content
      : typeof payload.summary === "string"
        ? payload.summary
        : step.candidate.reasoning;
    return text.replace(/\s/g, "").length;
  }));
  return Math.max(2_200, Math.min(5_600, 1_200 + readingLength * 36));
}

function waitForMilliseconds(delay: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, delay));
}

const liveInterventionRanges: Record<LiveForkRequest["path"], { min: number; max: number }> = {
  "stakeholders.publicTrust": { min: 0, max: 100 },
  "stakeholders.talentAttraction": { min: 0, max: 100 },
  "stakeholders.supplyChainReadiness": { min: 0, max: 100 },
  "company.investmentPlanMillionCny": { min: 1000, max: 4000 },
  "metrics.financingConfidence": { min: 0, max: 100 },
  "metrics.projectViability": { min: 0, max: 100 },
};

function resolveInterventionValue(previousValue: number, request: LiveForkRequest): number {
  const raw = request.adjustmentMode === "percent"
    ? previousValue * (1 + request.adjustment / 100)
    : previousValue + request.adjustment;
  const range = liveInterventionRanges[request.path];
  const bounded = Math.max(range.min, Math.min(range.max, raw));
  const value = request.path === "company.investmentPlanMillionCny" ? Math.round(bounded) : Number(bounded.toFixed(2));
  if (value === previousValue) throw new Error("干预幅度在当前状态下没有产生变化，请调整滑杆");
  return value;
}

function materializeSteps(steps: ApiAutonomousStep[], state: WorldState, fixture: CityScopeDemoFixture): DemoStep[] {
  const actors = new Map(fixture.actorRegistry.map((actor) => [actor.agentId, actor.actorKind]));
  const receipts = new Map(state.receipts.map((receipt) => [receipt.receiptId, receipt]));
  return steps.map((step) => {
    const receipt = receipts.get(step.receiptId);
    if (!receipt) throw new Error(`LIVE_STEP_RECEIPT_MISSING:${step.receiptId}`);
    return {
      phase: step.phase,
      actorId: step.actorId,
      actorKind: actors.get(step.actorId) ?? "agent",
      generationSource: step.generationSource,
      candidate: step.candidate,
      receipt,
    };
  });
}

async function postJson<T>(url: string, body: unknown, expectedVersion?: number): Promise<T> {
  return withRequestTimeout(async (signal) => parseResponse<T>(await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...(expectedVersion !== undefined ? { "if-match": String(expectedVersion) } : {}) },
      body: JSON.stringify(body),
      signal,
    })), `POST ${url}`);
}

async function getJson<T>(url: string): Promise<T> {
  return withRequestTimeout(async (signal) => parseResponse<T>(await fetch(url, { cache: "no-store", signal })), `GET ${url}`);
}

async function withRequestTimeout<T>(request: (signal: AbortSignal) => Promise<T>, label: string): Promise<T> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 120_000);
  try {
    return await request(controller.signal);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw new Error(`${label} 超过 120 秒，推演已停止而不是无限等待`);
    throw error;
  } finally {
    window.clearTimeout(timer);
  }
}

async function parseResponse<T>(response: Response): Promise<T> {
  const value = await response.json() as T & { error?: { code?: string; message?: string } };
  if (!response.ok) throw new Error(value.error?.message ?? value.error?.code ?? `HTTP_${response.status}`);
  return value;
}

function numberAtPath(state: WorldState, path: LiveForkRequest["path"]): number {
  const value = path.split(".").reduce<unknown>((current, key) => current && typeof current === "object" ? (current as Record<string, unknown>)[key] : undefined, state);
  if (typeof value !== "number") throw new Error(`INTERVENTION_PATH_NOT_NUMERIC: ${path}`);
  return value;
}
