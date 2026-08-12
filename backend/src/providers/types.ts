import type { AgentAction, WorldState } from "../domain.js";
import type { DecisionSupportContext } from "../decision-support/types.js";
import type { AgentDecisionView } from "../agents/decision-view.js";

export interface GenerationRequest {
  scenario: string;
  worldVersion: number;
  agentId: string;
  promptVersion: string;
  model: string;
  seed: number;
  schemaVersion: string;
  instruction: string;
  observation: WorldState;
  decisionView: AgentDecisionView;
  phase: WorldState["simulation"]["phase"];
  eligibleKinds: AgentAction["kind"][];
  repairAttempt: boolean;
  decisionSupport?: DecisionSupportContext;
}

export interface LLMProvider {
  readonly id: string;
  readonly model: string;
  generate(request: GenerationRequest): Promise<unknown>;
}

export interface GeneratedAction {
  action: AgentAction;
  source: "model" | "deterministic_stub" | "cache" | "fallback";
  repairAttempted: boolean;
  diagnostics: string[];
  usage?: ProviderUsage;
}

export interface ProviderUsage {
  callCount: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  promptCacheHitTokens: number;
  promptCacheMissTokens: number;
}

export interface ProviderGeneration {
  providerGeneration: true;
  output: unknown;
  usage?: ProviderUsage;
}

export function providerGeneration(output: unknown, usage?: ProviderUsage): ProviderGeneration {
  return { providerGeneration: true, output, ...(usage ? { usage } : {}) };
}

export function unpackProviderGeneration(value: unknown): { output: unknown; usage?: ProviderUsage } {
  if (isProviderGeneration(value)) return { output: value.output, ...(value.usage ? { usage: value.usage } : {}) };
  return { output: value };
}

export function mergeProviderUsage(...parts: Array<ProviderUsage | undefined>): ProviderUsage | undefined {
  const present = parts.filter((part): part is ProviderUsage => Boolean(part));
  if (present.length === 0) return undefined;
  return present.reduce<ProviderUsage>((total, part) => ({
    callCount: total.callCount + part.callCount,
    promptTokens: total.promptTokens + part.promptTokens,
    completionTokens: total.completionTokens + part.completionTokens,
    totalTokens: total.totalTokens + part.totalTokens,
    promptCacheHitTokens: total.promptCacheHitTokens + part.promptCacheHitTokens,
    promptCacheMissTokens: total.promptCacheMissTokens + part.promptCacheMissTokens,
  }), emptyProviderUsage());
}

export function emptyProviderUsage(): ProviderUsage {
  return { callCount: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, promptCacheHitTokens: 0, promptCacheMissTokens: 0 };
}

function isProviderGeneration(value: unknown): value is ProviderGeneration {
  return Boolean(value && typeof value === "object" && (value as { providerGeneration?: unknown }).providerGeneration === true && "output" in value);
}
