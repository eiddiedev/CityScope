import { AgentActionSchema, type AgentAction } from "../domain.js";
import { digest } from "../util.js";
import type { GeneratedAction, GenerationRequest, LLMProvider } from "./types.js";

export class ResilientActionGenerator {
  private readonly cache = new Map<string, AgentAction>();

  constructor(private readonly provider: LLMProvider) {}

  async generate(request: Omit<GenerationRequest, "model" | "repairAttempt">): Promise<GeneratedAction> {
    const full: GenerationRequest = { ...request, model: this.provider.model, repairAttempt: false };
    const key = cacheKey(full);
    const cached = this.cache.get(key);
    if (cached) return { action: structuredClone(cached), source: "cache", repairAttempted: false, diagnostics: [] };
    const diagnostics: string[] = [];
    try {
      const first = AgentActionSchema.safeParse(await this.provider.generate(full));
      if (first.success && noForbiddenKeys(first.data)) {
        this.cache.set(key, first.data);
        return { action: first.data, source: "model", repairAttempted: false, diagnostics };
      }
      diagnostics.push(first.success ? "forbidden outcome-directing field" : first.error.message);
      const repaired = AgentActionSchema.safeParse(await this.provider.generate({ ...full, repairAttempt: true, instruction: `${full.instruction}\nPrevious output failed schema validation. Repair it once.` }));
      if (repaired.success && noForbiddenKeys(repaired.data)) {
        this.cache.set(key, repaired.data);
        return { action: repaired.data, source: "model", repairAttempted: true, diagnostics };
      }
      diagnostics.push(repaired.success ? "repair retained forbidden field" : repaired.error.message);
    } catch (error) {
      diagnostics.push(error instanceof Error ? `${error.name}: ${error.message}` : "unknown provider failure");
    }
    const fallback = AgentActionSchema.parse(full.fallbackAction);
    this.cache.set(key, fallback);
    return { action: fallback, source: "fallback", repairAttempted: diagnostics.length > 1, diagnostics };
  }

  size(): number {
    return this.cache.size;
  }
}

export function cacheKey(request: GenerationRequest): string {
  return digest({
    scenario: request.scenario,
    worldVersion: request.worldVersion,
    agentId: request.agentId,
    promptVersion: request.promptVersion,
    model: request.model,
    seed: request.seed,
    schemaVersion: request.schemaVersion,
    runId: request.observation.runId,
    interventionId: request.observation.interventionId ?? null,
    observationDigest: digest(request.observation),
    instructionDigest: digest(request.instruction),
  });
}

function noForbiddenKeys(action: AgentAction): boolean {
  return !["desiredOutcome", "winner", "forceAgreement"].some((key) => key in action || key in action.payload);
}
