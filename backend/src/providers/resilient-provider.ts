import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { AgentActionSchema, type AgentAction } from "../domain.js";
import { deterministicId, digest } from "../util.js";
import { manifests } from "../agents/manifests.js";
import { deterministicAgentAction } from "../agents/deterministic-policy.js";
import {
  mergeProviderUsage,
  unpackProviderGeneration,
  type GeneratedAction,
  type GenerationRequest,
  type LLMProvider,
  type ProviderUsage,
} from "./types.js";

export class ResilientActionGenerator {
  private readonly cache: SemanticActionCache;

  constructor(private readonly provider: LLMProvider, options: { persistentPath?: string | null } = {}) {
    const path = options.persistentPath === undefined ? defaultPersistentPath(provider) : options.persistentPath ?? undefined;
    this.cache = new SemanticActionCache(path);
  }

  async generate(request: Omit<GenerationRequest, "model" | "repairAttempt">): Promise<GeneratedAction> {
    const full: GenerationRequest = { ...request, model: this.provider.model, repairAttempt: false };
    const key = cacheKey(full);
    const cached = this.cache.get(key);
    if (cached) return { action: stampProposal(cached, full), source: "cache", repairAttempted: false, diagnostics: [] };

    const diagnostics: string[] = [];
    const usages: ProviderUsage[] = [];
    try {
      const firstGeneration = unpackProviderGeneration(await this.provider.generate(full));
      if (firstGeneration.usage) usages.push(firstGeneration.usage);
      const first = AgentActionSchema.safeParse(firstGeneration.output);
      if (first.success && noForbiddenKeys(first.data) && isEligible(first.data, full)) {
        this.cache.set(key, proposalFrom(first.data));
        return generated(first.data, this.provider.id === "stub" ? "deterministic_stub" : "model", false, diagnostics, usages);
      }

      diagnostics.push(first.success ? invalidActionReason(first.data, full) : first.error.message);
      const repairRequest: GenerationRequest = {
        ...full,
        repairAttempt: true,
        instruction: `${full.instruction}\nPrevious output failed schema validation. Repair it once.`,
      };
      const repairGeneration = unpackProviderGeneration(await this.provider.generate(repairRequest));
      if (repairGeneration.usage) usages.push(repairGeneration.usage);
      const repaired = AgentActionSchema.safeParse(repairGeneration.output);
      if (repaired.success && noForbiddenKeys(repaired.data) && isEligible(repaired.data, full)) {
        this.cache.set(key, proposalFrom(repaired.data));
        return generated(repaired.data, this.provider.id === "stub" ? "deterministic_stub" : "model", true, diagnostics, usages);
      }
      diagnostics.push(repaired.success ? invalidActionReason(repaired.data, full) : repaired.error.message);
    } catch (error) {
      diagnostics.push(error instanceof Error ? `${error.name}: ${error.message}` : "unknown provider failure");
    }

    const manifest = manifests[full.agentId];
    if (!manifest || manifest.actorKind !== "agent") throw new Error(`no deterministic agent policy for ${full.agentId}`);
    const fallback = AgentActionSchema.parse(deterministicAgentAction(manifest, full.observation, full.decisionSupport));
    return generated(fallback, "fallback", diagnostics.length > 1, diagnostics, usages);
  }

  async repairAfterGateRejection(
    request: Omit<GenerationRequest, "model" | "repairAttempt">,
    rejected: AgentAction,
    gateFeedback: string,
  ): Promise<GeneratedAction> {
    const full: GenerationRequest = {
      ...request,
      model: this.provider.model,
      repairAttempt: true,
      instruction: [
        request.instruction,
        "Your previous schema-valid action was rejected by deterministic governance gates.",
        `Rejected action: ${JSON.stringify(rejected)}`,
        `Gate feedback: ${gateFeedback}`,
        "Repair the action once. Do not argue with the gate, do not repeat the violation, and use PASS if no legal repair exists.",
      ].join("\n"),
    };
    const key = cacheKey(full);
    const cached = this.cache.get(key);
    if (cached) return { action: stampProposal(cached, full), source: "cache", repairAttempted: true, diagnostics: [gateFeedback] };

    const diagnostics = [gateFeedback];
    const usages: ProviderUsage[] = [];
    try {
      const generation = unpackProviderGeneration(await this.provider.generate(full));
      if (generation.usage) usages.push(generation.usage);
      const parsed = AgentActionSchema.safeParse(generation.output);
      if (parsed.success && noForbiddenKeys(parsed.data) && isEligible(parsed.data, full)) {
        this.cache.set(key, proposalFrom(parsed.data));
        return generated(parsed.data, this.provider.id === "stub" ? "deterministic_stub" : "model", true, diagnostics, usages);
      }
      diagnostics.push(parsed.success ? invalidActionReason(parsed.data, full) : parsed.error.message);
    } catch (error) {
      diagnostics.push(error instanceof Error ? `${error.name}: ${error.message}` : "unknown provider failure during gate repair");
    }

    const manifest = manifests[full.agentId];
    if (!manifest || manifest.actorKind !== "agent") throw new Error(`no deterministic agent policy for ${full.agentId}`);
    const fallback = AgentActionSchema.parse(deterministicAgentAction(manifest, full.observation, full.decisionSupport));
    return generated(fallback, "fallback", true, diagnostics, usages);
  }

  deterministicFallback(
    request: Omit<GenerationRequest, "model" | "repairAttempt">,
    diagnostics: string[],
  ): GeneratedAction {
    const manifest = manifests[request.agentId];
    if (!manifest || manifest.actorKind !== "agent") throw new Error(`no deterministic agent policy for ${request.agentId}`);
    return {
      action: AgentActionSchema.parse(deterministicAgentAction(manifest, request.observation, request.decisionSupport)),
      source: "fallback",
      repairAttempted: true,
      diagnostics,
    };
  }

  invalidate(
    request: Omit<GenerationRequest, "model" | "repairAttempt">,
    repairAttempt: boolean,
  ): void {
    this.cache.delete(cacheKey({ ...request, model: this.provider.model, repairAttempt }));
  }

  size(): number {
    return this.cache.size();
  }

  close(): void {
    this.cache.close();
  }
}

export function cacheKey(request: GenerationRequest): string {
  return digest({
    workflowVersion: "two-round-v3",
    providerProtocolVersion: "governed-action-protocol-v4",
    scenario: request.scenario,
    agentId: request.agentId,
    promptVersion: request.promptVersion,
    model: request.model,
    seed: request.seed,
    schemaVersion: request.schemaVersion,
    phase: request.phase,
    eligibleKinds: request.eligibleKinds,
    repairAttempt: request.repairAttempt,
    decisionViewDigest: digest(request.decisionView),
    instructionDigest: digest(request.instruction),
    decisionSupportDigest: request.decisionSupport ? digest(request.decisionSupport) : null,
  });
}

type ActionProposal = Pick<AgentAction, "kind" | "reasoning" | "payload" | "evidenceFactIds">;

class SemanticActionCache {
  private readonly memory = new Map<string, ActionProposal>();
  private readonly database?: DatabaseSync;

  constructor(path?: string) {
    if (!path) return;
    const absolute = resolve(path);
    mkdirSync(dirname(absolute), { recursive: true });
    this.database = new DatabaseSync(absolute);
    this.database.exec("CREATE TABLE IF NOT EXISTS semantic_action_cache_v3 (cache_key TEXT PRIMARY KEY, proposal_json TEXT NOT NULL, created_at TEXT NOT NULL)");
  }

  get(key: string): ActionProposal | undefined {
    const memory = this.memory.get(key);
    if (memory) return structuredClone(memory);
    const row = this.database?.prepare("SELECT proposal_json FROM semantic_action_cache_v3 WHERE cache_key = ?").get(key) as { proposal_json?: unknown } | undefined;
    if (typeof row?.proposal_json !== "string") return undefined;
    const proposal = JSON.parse(row.proposal_json) as ActionProposal;
    this.memory.set(key, proposal);
    return structuredClone(proposal);
  }

  set(key: string, proposal: ActionProposal): void {
    const value = structuredClone(proposal);
    this.memory.set(key, value);
    this.database?.prepare("INSERT OR REPLACE INTO semantic_action_cache_v3 (cache_key, proposal_json, created_at) VALUES (?, ?, ?)").run(key, JSON.stringify(value), new Date().toISOString());
  }

  delete(key: string): void {
    this.memory.delete(key);
    this.database?.prepare("DELETE FROM semantic_action_cache_v3 WHERE cache_key = ?").run(key);
  }

  size(): number {
    if (!this.database) return this.memory.size;
    const row = this.database.prepare("SELECT COUNT(*) AS count FROM semantic_action_cache_v3").get() as { count?: number | bigint };
    return Number(row.count ?? this.memory.size);
  }

  close(): void {
    this.database?.close();
  }
}

function generated(
  action: AgentAction,
  source: GeneratedAction["source"],
  repairAttempted: boolean,
  diagnostics: string[],
  usages: ProviderUsage[],
): GeneratedAction {
  const usage = mergeProviderUsage(...usages);
  return { action, source, repairAttempted, diagnostics, ...(usage ? { usage } : {}) };
}

function proposalFrom(action: AgentAction): ActionProposal {
  return structuredClone({ kind: action.kind, reasoning: action.reasoning, payload: action.payload, evidenceFactIds: action.evidenceFactIds });
}

function stampProposal(proposal: ActionProposal, request: GenerationRequest): AgentAction {
  return AgentActionSchema.parse({
    ...structuredClone(proposal),
    actionId: deterministicId("model-action", request.observation.runId, request.worldVersion, request.agentId, proposal.kind, proposal.payload, proposal.reasoning),
    actorId: request.agentId,
    promptVersion: request.promptVersion,
    schemaVersion: request.schemaVersion,
  });
}

function defaultPersistentPath(provider: LLMProvider): string | undefined {
  if (!["deepseek", "qwen"].includes(provider.id) || process.env.CITYSCOPE_SEMANTIC_CACHE?.toLowerCase() === "disabled") return undefined;
  return process.env.CITYSCOPE_SEMANTIC_CACHE_PATH ?? ".cache/cityscope-actions-v3.sqlite";
}

function noForbiddenKeys(action: AgentAction): boolean {
  return !["desiredOutcome", "winner", "forceAgreement"].some((key) => key in action || key in action.payload);
}

function isEligible(action: AgentAction, request: GenerationRequest): boolean {
  return request.eligibleKinds.includes(action.kind);
}

function invalidActionReason(action: AgentAction, request: GenerationRequest): string {
  if (!noForbiddenKeys(action)) return "forbidden outcome-directing field";
  if (!isEligible(action, request)) return `action kind ${action.kind} is not legal in phase ${request.phase}`;
  return "invalid action";
}
