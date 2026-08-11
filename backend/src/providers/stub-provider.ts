import type { GenerationRequest, LLMProvider } from "./types.js";

export class StubProvider implements LLMProvider {
  readonly id = "stub";
  readonly model = "deterministic-cityscope-stub-v1";

  async generate(request: GenerationRequest): Promise<unknown> {
    return structuredClone(request.fallbackAction);
  }
}

