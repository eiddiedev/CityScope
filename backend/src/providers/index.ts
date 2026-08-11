import type { LLMProvider } from "./types.js";
import { QwenProvider, qwenConfigFromEnv } from "./qwen-provider.js";
import { StubProvider } from "./stub-provider.js";

export function providerFromEnv(env: NodeJS.ProcessEnv = process.env): LLMProvider {
  return env.LLM_PROVIDER?.toLowerCase() === "qwen" ? new QwenProvider(qwenConfigFromEnv(env)) : new StubProvider();
}

export * from "./types.js";
export * from "./resilient-provider.js";
export * from "./qwen-provider.js";
export * from "./stub-provider.js";

