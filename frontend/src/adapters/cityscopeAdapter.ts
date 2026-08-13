import type {
  ActorManifest,
  AgentAction,
  Checkpoint,
  DecisionReceipt,
  Intervention,
  Outcome,
  SemanticEffects,
  WorldState,
  CausalComparison,
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
  steps: DemoStep[];
  causalComparison: CausalComparison;
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
  newValue: number;
  reason: string;
}

export interface InterventionDefinition {
  path: LiveForkRequest["path"];
  label: string;
  unit: "score" | "million_cny";
  min: number;
  max: number;
  step: number;
  baseline: number;
  sensitiveRange: { min: number; max: number };
  redlineRanges: Array<{ min: number; max: number; label: string }>;
}

export interface InterventionCatalogResponse {
  catalogVersion: string;
  scenarioId: string;
  interventions: InterventionDefinition[];
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
  causalComparison: CausalComparison;
}

export interface PitchReplayArtifact {
  replayVersion: "cityscope.pitch-replay.v1";
  generatedAt: string;
  source: "recorded-deepseek-run";
  seed: number;
  durationMs: number;
  request: LiveForkRequest;
  result: LiveForkResult;
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
  loadInterventions(): Promise<InterventionCatalogResponse>;
  loadWorldSnapshot(): Promise<WorldState>;
  loadPitchReplay(): Promise<PitchReplayArtifact>;
  runLiveFork(request: LiveForkRequest, onProgress?: (progress: LiveForkProgress) => void): Promise<LiveForkResult>;
}

let fixturePromise: Promise<CityScopeDemoFixture> | undefined;
let liveBackendReady: boolean | undefined;
let liveBackendMode: "multi-request" | "batch" | "stream" | undefined;

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
      let backend: { ok: boolean; provider: string; model: string; demoMode: boolean; batchMode?: boolean; streamMode?: string };
      try {
        backend = await getJson("/healthz");
      } catch {
        backend = await getJson("/api/live");
      }
      if (backend.ok && !backend.demoMode) {
        liveBackendReady = true;
        liveBackendMode = backend.streamMode === "sse-v1" ? "stream" : backend.batchMode ? "batch" : "multi-request";
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
      liveBackendReady = false;
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
  async loadInterventions() {
    const fixture = await loadOnce();
    try {
      return await getJson<InterventionCatalogResponse>(`/api/v0/scenarios/${fixture.scenario.id}/interventions`);
    } catch {
      return signedInterventionCatalog(fixture);
    }
  },
  async loadWorldSnapshot() {
    return (await loadOnce()).baseline.terminalState;
  },
  async loadPitchReplay() {
    const response = await fetch("/pitch-financing-replay.json", { cache: "force-cache" });
    if (!response.ok) throw new Error(`PITCH_REPLAY_HTTP_${response.status}`);
    const artifact = await response.json() as PitchReplayArtifact;
    if (artifact.replayVersion !== "cityscope.pitch-replay.v1") throw new Error("PITCH_REPLAY_VERSION_MISMATCH");
    if (artifact.source !== "recorded-deepseek-run") throw new Error("PITCH_REPLAY_SOURCE_INVALID");
    if (artifact.request.path !== "metrics.financingConfidence" || artifact.request.newValue !== 5) throw new Error("PITCH_REPLAY_INTERVENTION_INVALID");
    if (artifact.result.intervention.previousValue !== 66 || artifact.result.intervention.newValue !== 5) throw new Error("PITCH_REPLAY_CAUSAL_PAIR_INVALID");
    return artifact;
  },
  async runLiveFork(request, onProgress) {
    const fixture = await loadOnce();
    if (liveBackendReady === false) return runSignedFixtureFork(fixture, request, onProgress);
    if (liveBackendMode === "stream") return runStreamedServerFork(fixture, request, onProgress);
    if (liveBackendMode === "batch") {
      const previousValue = numberAtPath(fixture.baseline.checkpoint.state, request.path);
      const pendingIntervention: Intervention = {
        interventionId: "pending_server_intervention",
        path: request.path,
        previousValue,
        newValue: request.newValue,
        reason: request.reason,
      };
      onProgress?.({
        stage: "parallel",
        label: "Vercel 服务端正在运行两套真实 DeepSeek Agent 世界",
        baselineState: fixture.baseline.checkpoint.state,
        forkState: fixture.baseline.checkpoint.state,
        baselineSteps: [],
        forkSteps: [],
        intervention: pendingIntervention,
      });
      let result: LiveForkResult;
      try {
        result = await postJson<LiveForkResult>("/api/live", request);
      } catch (error) {
        const fallback = runSignedFixtureFork(fixture, request, onProgress);
        onProgress?.({
          stage: "post_risk",
          label: `实时服务未完成，已切换到签名验收轨迹${error instanceof Error ? `：${error.message}` : ""}`,
          baselineState: fallback.baselineState,
          forkState: fallback.forkState,
          baselineSteps: fallback.baselineSteps,
          forkSteps: fallback.forkSteps,
          intervention: fallback.intervention,
          completedPhase: "complete",
        });
        return fallback;
      }
      onProgress?.({
        stage: "post_risk",
        label: "两套 DeepSeek Agent 已完成推演，正在载入可追溯行动",
        baselineState: result.baselineState,
        forkState: result.forkState,
        baselineSteps: result.baselineSteps,
        forkSteps: result.forkSteps,
        intervention: result.intervention,
        baselineCompetition: result.baselineCompetition,
        forkCompetition: result.forkCompetition,
        completedPhase: "complete",
      });
      return result;
    }
    const suffix = `${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
    const rootRunId = `live_root_${suffix}`;
    const forkRunId = `live_fork_${suffix}`;
    const checkpointId = `live_checkpoint_${suffix}`;
    const initial = await postJson<WorldState>("/api/v0/runs", { runId: rootRunId, seed: 20260800 });
    const checkpoint = await postJson<Checkpoint>(`/api/v0/runs/${rootRunId}/checkpoints`, { checkpointId });
    const previousValue = numberAtPath(initial, request.path);
    const catalog = await getJson<InterventionCatalogResponse>(`/api/v0/scenarios/${initial.scenarioId}/interventions`);
    const definition = catalog.interventions.find((item) => item.path === request.path);
    if (!definition) throw new Error(`实验变量未在后端目录声明：${request.path}`);
    const newValue = normalizeInterventionValue(request.newValue, definition);
    if (newValue === previousValue) throw new Error("实验值与原始值相同，请调整滑杆");
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
        await publishFrames(stageForPhase(phase), waitingProgressLabel(phase), streamedBaselineState, streamedForkState, baselineApiSteps, forkApiSteps, baselineCompetition, forkCompetition, phase, true);
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
    const parallelPhases = ["internal_advice", "policy_formation", "policy_audit", "stakeholder_reaction", "company_deliberation", "due_diligence"] as const;
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
    const [baselineOutcome, forkOutcome, baselineApiSteps, forkApiSteps, finalBaselineCompetition, finalForkCompetition, causalComparison] = await Promise.all([
      getJson<Outcome>(`/api/v0/runs/${rootRunId}/outcome`),
      getJson<Outcome>(`/api/v0/runs/${forkRunId}/outcome`),
      getJson<ApiAutonomousStep[]>(`/api/v0/runs/${rootRunId}/steps`),
      getJson<ApiAutonomousStep[]>(`/api/v0/runs/${forkRunId}/steps`),
      getJson<CityCompetitionEvidence>(`/api/v0/runs/${rootRunId}/competition`),
      getJson<CityCompetitionEvidence>(`/api/v0/runs/${forkRunId}/competition`),
      getJson<CausalComparison>(`/api/v0/runs/${rootRunId}/comparison/${forkRunId}`),
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
      causalComparison,
    };
  },
};

interface StreamStartFrame {
  checkpointId: string;
  intervention: Intervention;
  baselineState: WorldState;
  forkState: WorldState;
  baselineCompetition?: CityCompetitionEvidence;
  forkCompetition?: CityCompetitionEvidence;
  provider: string;
  model: string;
}

interface StreamStepFrame {
  world: "baseline" | "intervention";
  state: WorldState;
  step: DemoStep;
  competition?: CityCompetitionEvidence;
}

async function runStreamedServerFork(
  fixture: CityScopeDemoFixture,
  request: LiveForkRequest,
  onProgress?: (progress: LiveForkProgress) => void,
): Promise<LiveForkResult> {
  return withRequestTimeout(async (signal) => {
    const response = await fetch("/api/live", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "text/event-stream" },
      body: JSON.stringify(request),
      signal,
    });
    if (!response.ok || !response.body) {
      const value = await response.json().catch(() => undefined) as { error?: { code?: string; message?: string } } | undefined;
      throw new Error(value?.error?.message ?? value?.error?.code ?? `HTTP_${response.status}`);
    }

    let start: StreamStartFrame | undefined;
    let result: LiveForkResult | undefined;
    let baselineState = fixture.baseline.checkpoint.state;
    let forkState = fixture.baseline.checkpoint.state;
    let baselineCompetition: CityCompetitionEvidence | undefined;
    let forkCompetition: CityCompetitionEvidence | undefined;
    const baselineSteps: DemoStep[] = [];
    const forkSteps: DemoStep[] = [];

    const publish = (label: string, completedPhase?: string) => {
      if (!start) return;
      const latestPhase = completedPhase ?? forkSteps.at(-1)?.phase ?? baselineSteps.at(-1)?.phase ?? "internal_advice";
      onProgress?.({
        stage: stageForPhase(latestPhase),
        label,
        baselineState,
        forkState,
        baselineSteps: [...baselineSteps],
        forkSteps: [...forkSteps],
        intervention: start.intervention,
        baselineCompetition,
        forkCompetition,
        completedPhase,
      });
    };

    await readSse(response.body, (event, payload) => {
      if (event === "start") {
        start = payload as StreamStartFrame;
        baselineState = start.baselineState;
        forkState = start.forkState;
        baselineCompetition = start.baselineCompetition;
        forkCompetition = start.forkCompetition;
        publish("两套世界已建立，正在等待第一位 Agent 回应");
        return;
      }
      if (event === "step") {
        const frame = payload as StreamStepFrame;
        if (frame.world === "baseline") {
          baselineState = frame.state;
          baselineCompetition = frame.competition;
          baselineSteps.push(frame.step);
        } else {
          forkState = frame.state;
          forkCompetition = frame.competition;
          forkSteps.push(frame.step);
        }
        const actorName = fixture.actorRegistry.find((actor) => actor.agentId === frame.step.actorId)?.displayName ?? "Agent";
        publish(`${worldLabel(frame.world)} · ${actorName} 已回应`, frame.step.phase);
        return;
      }
      if (event === "complete") {
        result = payload as LiveForkResult;
        return;
      }
      if (event === "error") {
        const error = payload as { code?: string; message?: string };
        throw new Error(error.message ?? error.code ?? "线上流式推演失败");
      }
    });

    if (!result) throw new Error("线上流式推演在终局事件前结束");
    return result;
  }, "POST /api/live (stream)");
}

async function readSse(stream: ReadableStream<Uint8Array>, onEvent: (event: string, payload: unknown) => void): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    let boundary = buffer.indexOf("\n\n");
    while (boundary >= 0) {
      const block = buffer.slice(0, boundary).replace(/\r/g, "");
      buffer = buffer.slice(boundary + 2);
      const lines = block.split("\n");
      const event = lines.find((line) => line.startsWith("event:"))?.slice(6).trim() ?? "message";
      const data = lines.filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("\n");
      if (data) onEvent(event, JSON.parse(data));
      boundary = buffer.indexOf("\n\n");
    }
    if (done) break;
  }
}

function worldLabel(world: StreamStepFrame["world"]): string {
  return world === "baseline" ? "A 对照世界" : "B 实验世界";
}

function runSignedFixtureFork(
  fixture: CityScopeDemoFixture,
  request: LiveForkRequest,
  onProgress?: (progress: LiveForkProgress) => void,
): LiveForkResult {
  const fork = fixture.forks.find((item) => item.intervention.path === request.path && Number(item.intervention.newValue) === request.newValue);
  if (!fork) {
    const available = fixture.forks.find((item) => item.intervention.path === request.path);
    throw new Error(available
      ? `线上签名演示的已验收值为 ${String(available.intervention.newValue)}；请将滑杆调到该值，实时后端可使用任意范围。`
      : "该变量暂无线上签名轨迹，请选择人才、供应链、融资或投资规模。"
    );
  }
  const checkpointReceiptIds = new Set(fixture.baseline.checkpoint.state.receipts.map((receipt) => receipt.receiptId));
  const commonSteps = fixture.baseline.steps.filter((step) => checkpointReceiptIds.has(step.receipt.receiptId));
  const forkSteps = [...commonSteps, ...fork.steps];
  const progress: LiveForkProgress = {
    stage: "post_risk",
    label: "已载入通过契约校验的双世界签名轨迹",
    baselineState: fixture.baseline.terminalState,
    forkState: fork.terminalState,
    baselineSteps: fixture.baseline.steps,
    forkSteps,
    intervention: fork.intervention,
    completedPhase: "complete",
  };
  onProgress?.(progress);
  return {
    checkpointId: fixture.baseline.checkpoint.checkpointId,
    intervention: fork.intervention,
    baselineState: fixture.baseline.terminalState,
    forkState: fork.terminalState,
    baselineOutcome: fixture.baseline.classification,
    forkOutcome: fork.classification,
    baselineSteps: fixture.baseline.steps,
    forkSteps,
    provider: "signed-fixture",
    model: "deterministic-cityscope-stub-v1",
    causalComparison: fork.causalComparison,
  };
}

function signedInterventionCatalog(fixture: CityScopeDemoFixture): InterventionCatalogResponse {
  const state = fixture.baseline.checkpoint.state;
  const definitions: InterventionDefinition[] = [
    { path: "stakeholders.publicTrust", label: "公众信任", unit: "score", min: 0, max: 100, step: 1, baseline: state.stakeholders.publicTrust, sensitiveRange: { min: 15, max: 85 }, redlineRanges: [{ min: 0, max: 20, label: "公众信任红线" }] },
    { path: "stakeholders.talentAttraction", label: "人才吸引力", unit: "score", min: 0, max: 100, step: 1, baseline: state.stakeholders.talentAttraction, sensitiveRange: { min: 80, max: 100 }, redlineRanges: [] },
    { path: "stakeholders.supplyChainReadiness", label: "供应链准备度", unit: "score", min: 0, max: 100, step: 1, baseline: state.stakeholders.supplyChainReadiness, sensitiveRange: { min: 80, max: 100 }, redlineRanges: [] },
    { path: "metrics.financingConfidence", label: "融资信心", unit: "score", min: 0, max: 100, step: 1, baseline: state.metrics.financingConfidence, sensitiveRange: { min: 5, max: 25 }, redlineRanges: [{ min: 0, max: 10, label: "融资红线" }] },
    { path: "metrics.projectViability", label: "项目可执行性", unit: "score", min: 0, max: 100, step: 1, baseline: state.metrics.projectViability, sensitiveRange: { min: 10, max: 30 }, redlineRanges: [{ min: 0, max: 15, label: "可执行性红线" }] },
    { path: "company.investmentPlanMillionCny", label: "一期投资规模", unit: "million_cny", min: 1000, max: 4000, step: 100, baseline: state.company.investmentPlanMillionCny, sensitiveRange: { min: 2200, max: 2600 }, redlineRanges: [] },
  ];
  return { catalogVersion: "signed-fixture.v1", scenarioId: fixture.scenario.id, interventions: definitions };
}

function progressLabel(phase: string): string {
  return ({
    internal_advice: "双城招商与财政部门正在形成内部意见",
    policy_formation: "两座城市的负责人正在合成正式政策包",
    policy_audit: "政策监督 Agent 正在检查资源红线与兑现条件",
    coordination_debate: "成渝负责人正在回应协调 Agent，并形成可追溯让步",
    stakeholder_reaction: "人才、中小企业与居民正在反馈政策影响",
    company_deliberation: "CEO、CFO、投资机构与董事会正在评估两城方案",
    due_diligence: "尽调服务正在核验订单约束率与现金跑道",
    risk_reassessment: "双城部门正在按尽调结果重新评价政策风险",
    policy_revision: "两城负责人正在维持、修订或撤回正式要约",
    coordination_resolution: "两城与监督部门正在核验协调方案的 BATNA 与让步",
    final_deliberation: "董事会正在比较单城、双城、缩小规模与不落地方案",
    delivery: "规则服务正在执行 12/24 月履约评估",
    delivery_reaction: "居民与产业群体正在反馈长期政策影响",
    impact_assessment: "正在形成长期影响与政策成败结论",
  } as Record<string, string>)[phase] ?? "Agent 正在更新共同世界";
}

function stageForPhase(phase: string): LiveForkProgress["stage"] {
  if (phase === "due_diligence") return "risk";
  if (["risk_reassessment", "policy_revision", "coordination_debate", "coordination_resolution", "final_deliberation", "post_disclosure", "delivery", "delivery_reaction", "impact_assessment", "complete"].includes(phase)) return "post_risk";
  return "parallel";
}

function waitingProgressLabel(phase: string): string {
  if (phase === "coordination_debate") return "正在计算 OR-Tools 候选、TOPSIS 排序与 BATNA……等待区域协调 Agent 回应";
  if (phase === "coordination_resolution") return "正在核验双方让步与财政红线……等待政策监督 Agent 回应";
  if (phase === "final_deliberation") return "正在比较单城、双城、缩减规模与退出方案……等待企业董事会回应";
  return `${progressLabel(phase)} · 正在等待下一位 Agent 回应`;
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

function normalizeInterventionValue(value: number, definition: InterventionDefinition): number {
  if (!Number.isFinite(value)) throw new Error("实验值必须是有限数字");
  const bounded = Math.max(definition.min, Math.min(definition.max, value));
  const stepped = Math.round((bounded - definition.min) / definition.step) * definition.step + definition.min;
  return definition.unit === "million_cny" ? Math.round(stepped) : Number(stepped.toFixed(2));
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
  const timer = window.setTimeout(() => controller.abort(), 300_000);
  try {
    return await request(controller.signal);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw new Error(`${label} 超过 300 秒，推演已停止而不是无限等待`);
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
