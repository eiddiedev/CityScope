import { providerGeneration, type GenerationRequest, type LLMProvider, type ProviderUsage } from "./types.js";

export interface QwenConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  timeoutMs: number;
  maxConcurrency: number;
}

export class QwenProvider implements LLMProvider {
  readonly id = "qwen";
  readonly model: string;
  private readonly semaphore: Semaphore;

  constructor(private readonly config: QwenConfig) {
    this.model = config.model;
    this.semaphore = new Semaphore(config.maxConcurrency);
  }

  async generate(request: GenerationRequest): Promise<unknown> {
    const release = await this.semaphore.acquire();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const response = await fetch(`${this.config.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${this.config.apiKey}` },
        body: JSON.stringify({
          model: this.config.model,
          seed: request.seed,
          temperature: 0,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: "CityScope is a governed multi-agent policy simulation. Return exactly one AgentAction JSON object. Never claim an action executed. Deterministic gates and the World Reducer alone execute changes. When decisionSupport has at least two candidates, compare them using your actorRanking and cite the chosen candidateId in reasoning. If its optimizer status is INFEASIBLE, state the hard-constraint conflict and do not invent a candidate." },
            { role: "system", content: request.instruction },
            { role: "user", content: JSON.stringify({ phase: request.phase, eligibleKinds: request.eligibleKinds, decisionView: request.decisionView, schemaVersion: request.schemaVersion, repairAttempt: request.repairAttempt, decisionSupport: request.decisionSupport }) },
          ],
        }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Qwen HTTP ${response.status}`);
      const body = await response.json() as { choices?: Array<{ message?: { content?: string } }>; usage?: QwenUsage };
      const content = body.choices?.[0]?.message?.content;
      if (!content) throw new Error("Qwen response contained no message content");
      return providerGeneration(parseJsonContent(content), providerUsage(body.usage));
    } finally {
      clearTimeout(timeout);
      release();
    }
  }
}

interface QwenUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  prompt_cache_hit_tokens?: number;
  prompt_cache_miss_tokens?: number;
}

function providerUsage(usage: QwenUsage | undefined): ProviderUsage | undefined {
  if (!usage) return undefined;
  const promptTokens = finite(usage.prompt_tokens);
  const completionTokens = finite(usage.completion_tokens);
  return {
    callCount: 1,
    promptTokens,
    completionTokens,
    totalTokens: finite(usage.total_tokens) || promptTokens + completionTokens,
    promptCacheHitTokens: finite(usage.prompt_cache_hit_tokens),
    promptCacheMissTokens: finite(usage.prompt_cache_miss_tokens),
  };
}

function finite(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

export function qwenConfigFromEnv(env: NodeJS.ProcessEnv = process.env): QwenConfig {
  const apiKey = env.QWEN_API_KEY;
  const baseUrl = env.QWEN_BASE_URL;
  const model = env.QWEN_MODEL;
  if (!apiKey || !baseUrl || !model) throw new Error("QWEN_API_KEY, QWEN_BASE_URL and QWEN_MODEL are required for qwen provider");
  return {
    apiKey,
    baseUrl,
    model,
    timeoutMs: positiveInteger(env.QWEN_TIMEOUT_MS, 8_000),
    maxConcurrency: positiveInteger(env.QWEN_MAX_CONCURRENCY, 3),
  };
}

function positiveInteger(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseJsonContent(content: string): unknown {
  const trimmed = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  return JSON.parse(trimmed);
}

class Semaphore {
  private active = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(private readonly max: number) {}

  async acquire(): Promise<() => void> {
    if (this.active >= this.max) await new Promise<void>((resolve) => this.waiting.push(resolve));
    this.active += 1;
    return () => {
      this.active -= 1;
      this.waiting.shift()?.();
    };
  }
}
