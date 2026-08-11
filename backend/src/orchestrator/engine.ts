import type { AgentAction, ApplyResult, Permission, WorldState } from "../domain.js";
import { isAgent, manifests, observe } from "../agents/manifests.js";
import { deterministicServiceAction } from "../agents/deterministic-policy.js";
import { applyAction } from "../world/reducer.js";
import { ResilientActionGenerator } from "../providers/resilient-provider.js";
import type { LLMProvider } from "../providers/types.js";

export interface ActorStepResult extends ApplyResult {
  candidate: AgentAction;
  generationSource: "model" | "deterministic_stub" | "cache" | "fallback" | "deterministic_service";
  diagnostics: string[];
}

export class SimulationEngine {
  readonly generator: ResilientActionGenerator;

  constructor(provider: LLMProvider) {
    this.generator = new ResilientActionGenerator(provider);
  }

  async proposeAndApplyActor(state: WorldState, actorId: string): Promise<ActorStepResult> {
    const manifest = manifests[actorId];
    if (!manifest) throw new Error(`unknown actor ${actorId}`);
    if (manifest.actorKind === "service") {
      const candidate = deterministicServiceAction(manifest, observe(state, actorId));
      return { ...applyAction(state, candidate), candidate, generationSource: "deterministic_service", diagnostics: [] };
    }
    const generated = await this.generator.generate({
      scenario: state.scenarioId,
      worldVersion: state.worldVersion,
      agentId: actorId,
      promptVersion: manifest.promptVersion,
      seed: state.snapshot.seed,
      schemaVersion: state.snapshot.schemaVersion,
      instruction: instructionFor(actorId),
      observation: observe(state, actorId),
      phase: state.simulation.phase,
      eligibleKinds: eligibleKinds(manifest.permissions),
    });
    return { ...applyAction(state, generated.action), candidate: generated.action, generationSource: generated.source, diagnostics: generated.diagnostics };
  }

  applyExternalAction(state: WorldState, action: AgentAction): ApplyResult {
    return applyAction(state, action);
  }

  runReplayActions(initial: WorldState, actions: AgentAction[]): { state: WorldState; results: ApplyResult[] } {
    let state = structuredClone(initial);
    const results: ApplyResult[] = [];
    for (const action of actions) {
      const result = applyAction(state, action);
      state = result.state;
      results.push(result);
    }
    return { state, results };
  }
}

function instructionFor(actorId: string): string {
  const manifest = manifests[actorId];
  if (!manifest || !isAgent(manifest)) throw new Error(`actor ${actorId} has no LLM prompt`);
  const cityContext = actorId.startsWith("chengdu")
    ? "成都重视研发岗位、高端人才和总部，财政支持强调分期兑现。"
    : actorId.startsWith("chongqing")
      ? "重庆重视制造产值、工厂、供应链和就业，财政支持强调产值条件。"
      : "按独立效用、红线、私有观察和已有记忆行动。";
  return [
    `你是${manifest.displayName}，actorKind=agent。`, cityContext,
    `效用：${manifest.utility.map((item) => `${item.dimension}:${item.weight}:${item.direction}`).join(", ")}。`,
    `红线：${manifest.redLines.join("；")}。`,
    `允许权限：${manifest.permissions.join(", ")}。`,
    "只提出一个当前阶段合法的结构化 AgentAction 或 PASS。不得修改世界、声称执行成功、读取隐藏事实或指定结局。",
  ].join("\n");
}

const permissionKinds: Partial<Record<Permission, AgentAction["kind"][]>> = {
  recommend: ["ADVISE_POLICY", "ADVISE_COMPANY_RESPONSE"],
  sign_policy: ["SUBMIT_POLICY_PACK"], sign_company_response: ["SUBMIT_COMPANY_RESPONSE"],
  request_audit: ["REQUEST_DUE_DILIGENCE"], disclose_fact: ["DISCLOSE_FACT"],
  decide_financing: ["ADVISE_FINANCING"], accept_policy: ["ACCEPT_POLICY", "REJECT_POLICY"],
  withdraw_commitment: ["WITHDRAW_COMMITMENT"], exit_project: ["EXIT_PROJECT"],
  advance_project: ["ADVANCE_PROJECT"], publish_reaction: ["PUBLISH_STAKEHOLDER_REACTION"],
  coordinate: ["ISSUE_COORDINATION_OPINION"], audit_policy: ["AUDIT_POLICY_PACK"], pass: ["PASS"],
};

function eligibleKinds(permissions: Permission[]): AgentAction["kind"][] {
  return [...new Set(permissions.flatMap((permission) => permissionKinds[permission] ?? []))];
}
