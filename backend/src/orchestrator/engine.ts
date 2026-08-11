import type { AgentAction, ApplyResult, WorldState } from "../domain.js";
import { manifests, observe } from "../agents/manifests.js";
import { applyAction } from "../world/reducer.js";
import { ResilientActionGenerator } from "../providers/resilient-provider.js";
import type { LLMProvider } from "../providers/types.js";

export class SimulationEngine {
  readonly generator: ResilientActionGenerator;

  constructor(provider: LLMProvider) {
    this.generator = new ResilientActionGenerator(provider);
  }

  async proposeAndApply(state: WorldState, fallbackAction: AgentAction): Promise<ApplyResult & { generationSource: string; diagnostics: string[] }> {
    const manifest = manifests[fallbackAction.actorId];
    if (!manifest) throw new Error(`unknown actor ${fallbackAction.actorId}`);
    const generated = await this.generator.generate({
      scenario: state.scenarioId,
      worldVersion: state.worldVersion,
      agentId: fallbackAction.actorId,
      promptVersion: manifest.promptVersion,
      seed: state.snapshot.seed,
      schemaVersion: state.snapshot.schemaVersion,
      instruction: instructionFor(manifest.agentId),
      observation: observe(state, fallbackAction.actorId),
      fallbackAction,
    });
    return { ...applyAction(state, generated.action), generationSource: generated.source, diagnostics: generated.diagnostics };
  }

  async runActions(initial: WorldState, actions: AgentAction[]): Promise<{ state: WorldState; results: ApplyResult[] }> {
    let state = initial;
    const results: ApplyResult[] = [];
    for (const action of actions) {
      const result = await this.proposeAndApply(state, action);
      state = result.state;
      results.push(result);
    }
    return { state, results };
  }
}

function instructionFor(agentId: string): string {
  const manifest = manifests[agentId];
  if (!manifest) throw new Error(`unknown agent ${agentId}`);
  const cityContext = agentId.startsWith("chengdu")
    ? "成都重视研发岗位、高端人才和总部，财政支持强调分期兑现。"
    : agentId.startsWith("chongqing")
      ? "重庆重视制造产值、工厂、供应链和就业，财政支持强调产值条件。"
      : "按组织目标和私有观察行动。";
  return [
    `你是${manifest.displayName}。`,
    cityContext,
    `允许权限：${manifest.permissions.join(", ")}。`,
    `禁止：${manifest.forbidden.join(", ")}。`,
    "只提出下一步结构化 AgentAction。不得修改世界、声称执行成功或指定结局。",
  ].join("\n");
}

