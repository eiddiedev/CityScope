import type { Checkpoint, WorldState } from "../domain.js";
import { createInitialState } from "../world/initial-state.js";
import { terminate, classifyOutcome } from "../world/outcome.js";
import { createCheckpoint, forkFromCheckpoint, verifyBranchIntegrity } from "../trace/checkpoint.js";
import { SimulationEngine } from "./engine.js";
import { makeAction, postDisclosureActions, preDisclosureActions, progressAction } from "./actions.js";
import type { LLMProvider } from "../providers/types.js";

export interface GoldenRun {
  state: WorldState;
  checkpoint: Checkpoint;
  forks: WorldState[];
  continuedForks: WorldState[];
  branchChecks: Array<{ passed: boolean; differences: string[] }>;
  forkOutcomes: Array<ReturnType<typeof classifyOutcome>>;
  outcome: ReturnType<typeof classifyOutcome>;
  actionCount: number;
}

export async function runGoldenScenario(provider: LLMProvider): Promise<GoldenRun> {
  const engine = new SimulationEngine(provider);
  let state = createInitialState();
  const before = await engine.runActions(state, preDisclosureActions());
  state = before.state;
  const checkpoint = createCheckpoint(state, "checkpoint_post_order_disclosure");
  const interventions = [
    { interventionId: "intervention_cd_budget_plus", path: "cities.chengdu.fiscal.availableMillionCny", previousValue: state.cities.chengdu.fiscal.availableMillionCny, newValue: state.cities.chengdu.fiscal.availableMillionCny + 100, reason: "成都增加可用政策预算，不指定结局" },
    { interventionId: "intervention_cq_factory_plus", path: "cities.chongqing.resources.factorySqm", previousValue: state.cities.chongqing.resources.factorySqm, newValue: state.cities.chongqing.resources.factorySqm + 30_000, reason: "重庆增加可用厂房，不指定结局" },
    { interventionId: "intervention_company_scale_down", path: "company.investmentPlanMillionCny", previousValue: state.company.investmentPlanMillionCny, newValue: 2_200, reason: "企业缩小投资原因，不指定结局" },
    { interventionId: "intervention_financing_shock", path: "metrics.financingConfidence", previousValue: state.metrics.financingConfidence, newValue: 5, reason: "融资市场进一步收紧，不指定结局" },
  ];
  const forks = interventions.map((intervention, index) => forkFromCheckpoint(checkpoint, `fork_${index + 1}`, intervention));
  const branchChecks = forks.map((fork) => verifyBranchIntegrity(checkpoint, fork));
  const continuedForks: WorldState[] = [];
  for (const [index, fork] of forks.entries()) {
    const branchActions = index === 0
      ? [progressAction()]
      : index === 1
        ? [makeAction("company_board", "ACCEPT_POLICY", { policyId: "policy_chongqing_v1" }, "新增厂房使制造方案可与研发总部并行", ["fact_orders_nonbinding"]), progressAction()]
        : index === 2
          ? postDisclosureActions(fork)
          : [makeAction("company_board", "EXIT_PROJECT", { reason: "financing_unavailable" }, "融资冲击使缩减后的项目仍不可执行，董事会正式退出", ["fact_cash_12m", "fact_orders_nonbinding"])];
    const continued = await engine.runActions(fork, branchActions);
    continuedForks.push(terminate(continued.state, `fork ${index + 1} reached demonstration horizon`));
  }
  const forkOutcomes = continuedForks.map(classifyOutcome);
  const after = await engine.runActions(state, [...postDisclosureActions(state), progressAction()]);
  state = terminate(after.state, "golden fixture reached configured demonstration horizon");
  const outcome = classifyOutcome(state);
  return { state, checkpoint, forks, continuedForks, branchChecks, forkOutcomes, outcome, actionCount: preDisclosureActions().length + postDisclosureActions(state).length + 1 };
}
