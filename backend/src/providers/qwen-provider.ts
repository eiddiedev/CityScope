import type { GenerationRequest, LLMProvider } from "./types.js";

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
          temperature: 0.2,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: `${request.instruction}\nReturn exactly one AgentAction JSON object. Never claim an action executed.` },
            { role: "user", content: JSON.stringify({ worldVersion: request.worldVersion, phase: request.phase, eligibleKinds: request.eligibleKinds, observation: request.observation, schemaVersion: request.schemaVersion, repairAttempt: request.repairAttempt }) },
          ],
        }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Qwen HTTP ${response.status}`);
      const body = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
      const content = body.choices?.[0]?.message?.content;
      if (!content) throw new Error("Qwen response contained no message content");
      return parseJsonContent(content);
    } finally {
      clearTimeout(timeout);
      release();
    }
  }
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
