import type { LLMProvider } from "./types.js";
import { DeepSeekProvider, deepSeekConfigFromEnv } from "./deepseek-provider.js";
import { QwenProvider, qwenConfigFromEnv } from "./qwen-provider.js";
import { StubProvider } from "./stub-provider.js";

export function providerFromEnv(env: NodeJS.ProcessEnv = process.env): LLMProvider {
  const provider = env.LLM_PROVIDER?.toLowerCase();
  if (provider === "deepseek") return new DeepSeekProvider(deepSeekConfigFromEnv(env));
  if (provider === "qwen") return new QwenProvider(qwenConfigFromEnv(env));
  return new StubProvider();
}

export * from "./types.js";
export * from "./resilient-provider.js";
export * from "./deepseek-provider.js";
export * from "./qwen-provider.js";
export * from "./stub-provider.js";
