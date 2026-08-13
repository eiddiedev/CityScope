import type { Intervention, WorldState } from "../backend/src/domain.js";
import { manifests } from "../backend/src/agents/manifests.js";
import { DecisionSupportService } from "../backend/src/decision-support/service.js";
import { interventionDefinition } from "../backend/src/interventions/catalog.js";
import { continueAutonomously, type AutonomousStep } from "../backend/src/orchestrator/autonomous.js";
import { SimulationEngine } from "../backend/src/orchestrator/engine.js";
import { providerFromEnv } from "../backend/src/providers/index.js";
import { compareCausalRuns } from "../backend/src/trace/causal-comparison.js";
import { createCheckpoint, forkFromCheckpoint } from "../backend/src/trace/checkpoint.js";
import { createInitialState } from "../backend/src/world/initial-state.js";
import { classifyAndAttachOutcome } from "../backend/src/world/outcome.js";
import { cityCompetitionForState } from "../backend/src/decision-support/city-competition.js";

export const config = { maxDuration: 300 };

interface RequestLike { method?: string; body?: unknown }
interface ResponseLike {
  status(code: number): ResponseLike;
  json(value: unknown): void;
  setHeader(name: string, value: string): void;
}

let activeSimulation = false;

export default async function handler(request: RequestLike, response: ResponseLike): Promise<void> {
  response.setHeader("cache-control", "no-store");
  if (request.method === "GET") {
    response.status(200).json({ ok: true, provider: "deepseek", model: process.env.DEEPSEEK_MODEL ?? "deepseek-v4-flash", demoMode: false, batchMode: true });
    return;
  }
  if (request.method !== "POST") {
    response.status(405).json({ error: { code: "METHOD_NOT_ALLOWED", message: "仅支持 GET 与 POST" } });
    return;
  }
  if (activeSimulation) {
    response.status(429).json({ error: { code: "LIVE_SIMULATION_BUSY", message: "已有一轮线上推演正在进行，请稍后重试" } });
    return;
  }
  activeSimulation = true;
  try {
    const body = asRecord(request.body);
    const path = String(body.path ?? "");
    const definition = interventionDefinition(path);
    const rawValue = Number(body.newValue);
    if (!definition || !Number.isFinite(rawValue)) throw new Error("实验变量或数值无效");
    const newValue = normalize(rawValue, definition.min, definition.max, definition.step);
    process.env.CITYSCOPE_SEMANTIC_CACHE = "disabled";
    const provider = providerFromEnv({ ...process.env, LLM_PROVIDER: "deepseek", CITYSCOPE_SEMANTIC_CACHE: "disabled" });
    const engine = new SimulationEngine(provider, new DecisionSupportService("enumerative"));
    const suffix = `${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
    const baselineInitial = createInitialState(`web_baseline_${suffix}`, 20260800, "autonomous");
    baselineInitial.snapshot.provider = provider.id;
    baselineInitial.snapshot.model = provider.model;
    const previousValue = numberAtPath(baselineInitial, path);
    if (previousValue === newValue) throw new Error("实验值与原始值相同，请调整滑杆");
    const checkpoint = createCheckpoint(baselineInitial, `web_checkpoint_${suffix}`);
    const intervention: Intervention = {
      interventionId: `web_intervention_${suffix}`,
      path,
      previousValue,
      newValue,
      reason: typeof body.reason === "string" ? body.reason.slice(0, 120) : "线上单因干预",
    };
    const forkInitial = forkFromCheckpoint(checkpoint, `web_fork_${suffix}`, intervention);
    forkInitial.snapshot.provider = provider.id;
    forkInitial.snapshot.model = provider.model;
    const [baselineContinuation, forkContinuation] = await Promise.all([
      continueAutonomously(engine, baselineInitial, { maxSteps: 60 }),
      continueAutonomously(engine, forkInitial, { maxSteps: 60 }),
    ]);
    const baselineState = classifyAndAttachOutcome(baselineContinuation.state);
    const forkState = classifyAndAttachOutcome(forkContinuation.state);
    response.status(200).json({
      checkpointId: checkpoint.checkpointId,
      intervention,
      baselineState,
      forkState,
      baselineOutcome: requiredOutcome(baselineState),
      forkOutcome: requiredOutcome(forkState),
      baselineSteps: projectSteps(baselineContinuation.steps, baselineState),
      forkSteps: projectSteps(forkContinuation.steps, forkState),
      baselineCompetition: cityCompetitionForState(baselineState),
      forkCompetition: cityCompetitionForState(forkState),
      provider: provider.id,
      model: provider.model,
      causalComparison: compareCausalRuns(baselineState, forkState, baselineContinuation.steps, forkContinuation.steps),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "线上推演失败";
    response.status(/余额|额度|quota|402/i.test(message) ? 402 : 500).json({ error: { code: "LIVE_SIMULATION_FAILED", message } });
  } finally {
    activeSimulation = false;
  }
}

function projectSteps(steps: AutonomousStep[], state: WorldState) {
  const receipts = new Map(state.receipts.map((item) => [item.receiptId, item]));
  return steps.map((step) => {
    const receipt = receipts.get(step.receiptId);
    if (!receipt) throw new Error(`缺少行动回执 ${step.receiptId}`);
    return { phase: step.phase, actorId: step.actorId, actorKind: manifests[step.actorId]?.actorKind ?? "agent", generationSource: step.generationSource, candidate: step.candidate, receipt };
  });
}

function requiredOutcome(state: WorldState) {
  if (!state.simulation.classification) throw new Error("终局尚未完成分类");
  return state.simulation.classification;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function normalize(value: number, min: number, max: number, step: number): number {
  const bounded = Math.max(min, Math.min(max, value));
  return Math.round((bounded - min) / step) * step + min;
}

function numberAtPath(state: WorldState, path: string): number {
  let current: unknown = state;
  for (const segment of path.split(".")) current = current && typeof current === "object" ? (current as Record<string, unknown>)[segment] : undefined;
  if (typeof current !== "number") throw new Error(`实验变量 ${path} 不是数值`);
  return current;
}
