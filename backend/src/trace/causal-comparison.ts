import type { AgentAction, Outcome, StateDelta, WorldState } from "../domain.js";
import type { AutonomousStep } from "../orchestrator/autonomous.js";
import { classifyOutcome } from "../world/outcome.js";

const hiddenIdentityKeys = new Set([
  "actionId", "actorId", "candidateId", "coordinationPlanId", "decisionId", "deltaId", "eventId",
  "factId", "interventionId", "messageId", "opinionId", "planId", "policyId", "receiptId",
  "reactionId", "replyToMessageId", "responseId", "runId", "sourcePolicyIds", "supersedesPolicyId",
  "termId", "threadId",
]);

export interface CausalComparison {
  baselineRunId: string;
  interventionRunId: string;
  interventionPath: string;
  firstSemanticActionDivergence: {
    index: number;
    baselineActionId: string;
    interventionActionId: string;
    baselineActorId: string;
    interventionActorId: string;
    baselineKind: AgentAction["kind"];
    interventionKind: AgentAction["kind"];
    changedFacts: string[];
  } | null;
  firstWorldStateDivergence: {
    path: string;
    baselineValue: unknown;
    interventionValue: unknown;
    interventionCauseId: string;
    worldVersion: number;
  } | null;
  propagationChain: Array<{
    path: string;
    baselineValue: unknown;
    interventionValue: unknown;
    interventionCauseId: string;
    actorId: string;
    worldVersion: number;
  }>;
  baselineOutcome: Outcome["label"];
  interventionOutcome: Outcome["label"];
  outcomeChanged: boolean;
  absorbed: boolean;
  absorptionLayer: "none" | "candidate_generation" | "agent_decision" | "institutional_gate" | "final_selection";
}

export function compareCausalRuns(
  baseline: WorldState,
  intervention: WorldState,
  baselineSteps: AutonomousStep[],
  interventionSteps: AutonomousStep[],
): CausalComparison {
  if (!intervention.intervention) throw new Error("CAUSAL_COMPARISON_REQUIRES_INTERVENTION");
  if (!baseline.terminal || !intervention.terminal) throw new Error("CAUSAL_COMPARISON_REQUIRES_TERMINAL_RUNS");
  const firstSemanticActionDivergence = firstActionDivergence(baselineSteps, interventionSteps);
  const propagationChain = propagationDeltas(baseline, intervention, intervention.trace, intervention.intervention.path);
  const firstWorldStateDivergence = propagationChain[0]
    ? {
        path: propagationChain[0].path,
        baselineValue: propagationChain[0].baselineValue,
        interventionValue: propagationChain[0].interventionValue,
        interventionCauseId: propagationChain[0].interventionCauseId,
        worldVersion: propagationChain[0].worldVersion,
      }
    : null;
  const baselineOutcome = (baseline.simulation.classification ?? classifyOutcome(baseline)).label;
  const interventionOutcome = (intervention.simulation.classification ?? classifyOutcome(intervention)).label;
  const outcomeChanged = baselineOutcome !== interventionOutcome;
  return {
    baselineRunId: baseline.runId,
    interventionRunId: intervention.runId,
    interventionPath: intervention.intervention.path,
    firstSemanticActionDivergence,
    firstWorldStateDivergence,
    propagationChain,
    baselineOutcome,
    interventionOutcome,
    outcomeChanged,
    absorbed: !outcomeChanged,
    absorptionLayer: outcomeChanged ? "none" : absorptionLayer(firstSemanticActionDivergence, propagationChain, interventionSteps),
  };
}

function firstActionDivergence(leftSteps: AutonomousStep[], rightSteps: AutonomousStep[]): CausalComparison["firstSemanticActionDivergence"] {
  const count = Math.max(leftSteps.length, rightSteps.length);
  for (let index = 0; index < count; index += 1) {
    const left = leftSteps[index];
    const right = rightSteps[index];
    if (!left || !right) {
      const existing = left ?? right;
      if (!existing) continue;
      return {
        index,
        baselineActionId: left?.candidate.actionId ?? "none",
        interventionActionId: right?.candidate.actionId ?? "none",
        baselineActorId: left?.actorId ?? "none",
        interventionActorId: right?.actorId ?? "none",
        baselineKind: left?.candidate.kind ?? "PASS",
        interventionKind: right?.candidate.kind ?? "PASS",
        changedFacts: ["action_presence"],
      };
    }
    const leftFacts = actionFacts(left.candidate);
    const rightFacts = actionFacts(right.candidate);
    if (JSON.stringify(leftFacts) === JSON.stringify(rightFacts)) continue;
    const changedFacts = [...new Set([...Object.keys(leftFacts), ...Object.keys(rightFacts)])]
      .filter((key) => JSON.stringify(leftFacts[key]) !== JSON.stringify(rightFacts[key]));
    return {
      index,
      baselineActionId: left.candidate.actionId,
      interventionActionId: right.candidate.actionId,
      baselineActorId: left.actorId,
      interventionActorId: right.actorId,
      baselineKind: left.candidate.kind,
      interventionKind: right.candidate.kind,
      changedFacts,
    };
  }
  return null;
}

function actionFacts(action: AgentAction): Record<string, unknown> {
  const result: Record<string, unknown> = { actor: action.actorId, kind: action.kind };
  // `proposal` is the public evidence namespace shared with the frontend.
  // Keeping one namespace prevents a real payload difference from rendering
  // as an empty value in the A/B comparison.
  flatten(semanticActionPayload(action.payload), "proposal", result);
  return Object.fromEntries(Object.entries(result).sort(([left], [right]) => left.localeCompare(right)));
}

function semanticActionPayload(payload: AgentAction["payload"]): Record<string, unknown> {
  const result = structuredClone(payload);
  delete result.decisionEvidence;
  for (const key of ["utility", "reservationUtility", "utilityGap", "concessionCost"] as const) delete result[key];
  return result;
}

function flatten(value: unknown, prefix: string, result: Record<string, unknown>): void {
  if (value === null || ["string", "number", "boolean"].includes(typeof value)) {
    result[prefix] = value;
    return;
  }
  if (Array.isArray(value)) return value.forEach((item, index) => flatten(item, `${prefix}.${index}`, result));
  if (!value || typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right))) {
    if (hiddenIdentityKeys.has(key) || /(?:Id|Ids)$/.test(key)) continue;
    flatten(nested, `${prefix}.${key}`, result);
  }
}

function propagationDeltas(baseline: WorldState, intervention: WorldState, deltas: StateDelta[], interventionPath: string): CausalComparison["propagationChain"] {
  const seen = new Set<string>();
  const result: CausalComparison["propagationChain"] = [];
  for (const delta of deltas) {
    const path = normalizeIndexedPath(delta.path);
    if (path === interventionPath || path.startsWith("simulation.") || path === "terminal" || seen.has(path)) continue;
    const baselineValue = readPath(baseline, delta.path);
    const interventionValue = readPath(intervention, delta.path);
    if (baselineValue === undefined || interventionValue === undefined || JSON.stringify(baselineValue) === JSON.stringify(interventionValue)) continue;
    seen.add(path);
    result.push({ path, baselineValue, interventionValue, interventionCauseId: delta.causeId, actorId: delta.actorId, worldVersion: delta.worldVersion });
  }
  return result.slice(0, 20);
}

function normalizeIndexedPath(path: string): string {
  return path.replace(/\.\d+(?=\.|$)/g, "");
}

function readPath(root: unknown, path: string): unknown {
  let current = root;
  for (const segment of path.split(".")) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function absorptionLayer(
  divergence: CausalComparison["firstSemanticActionDivergence"],
  propagation: CausalComparison["propagationChain"],
  steps: AutonomousStep[],
): CausalComparison["absorptionLayer"] {
  if (!divergence && propagation.length === 0) return "candidate_generation";
  if (!divergence) return "agent_decision";
  const laterRejected = steps.slice(divergence.index).some((step) => step.receiptId && step.status === "REJECTED");
  if (laterRejected) return "institutional_gate";
  return "final_selection";
}
