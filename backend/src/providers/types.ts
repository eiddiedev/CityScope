import type { AgentAction, WorldState } from "../domain.js";

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
  fallbackAction: AgentAction;
  repairAttempt: boolean;
}

export interface LLMProvider {
  readonly id: string;
  readonly model: string;
  generate(request: GenerationRequest): Promise<unknown>;
}

export interface GeneratedAction {
  action: AgentAction;
  source: "model" | "cache" | "fallback";
  repairAttempted: boolean;
  diagnostics: string[];
}

