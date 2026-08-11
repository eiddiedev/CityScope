import type { GenerationRequest, LLMProvider } from "./types.js";
import { manifests } from "../agents/manifests.js";
import { deterministicAgentAction } from "../agents/deterministic-policy.js";

export class StubProvider implements LLMProvider {
  readonly id = "stub";
  readonly model = "deterministic-cityscope-stub-v1";

  async generate(request: GenerationRequest): Promise<unknown> {
    const manifest = manifests[request.agentId];
    if (!manifest || manifest.actorKind !== "agent") throw new Error(`StubProvider only evaluates behavior agents: ${request.agentId}`);
    return deterministicAgentAction(manifest, request.observation);
  }
}
