import type { DemoStep } from "./adapters/cityscopeAdapter";

const hiddenIdentityKeys = new Set([
  "actionId", "actorId", "candidateId", "coordinationPlanId", "decisionId", "deltaId", "eventId",
  "factId", "interventionId", "messageId", "opinionId", "planId", "policyId", "receiptId",
  "reactionId", "replyToMessageId", "responseId", "runId", "sourcePolicyIds", "supersedesPolicyId",
  "termId", "threadId",
]);

export interface ObservableDivergence {
  index: number;
  baseline: DemoStep;
  fork: DemoStep;
  changedFacts: string[];
}

/**
 * Compare only audience-observable business semantics. Run-scoped identifiers,
 * cache metadata and equivalent wording must never create a fake divergence.
 */
export function firstObservableDivergence(baselineSteps: DemoStep[], forkSteps: DemoStep[]): ObservableDivergence | undefined {
  const length = Math.min(baselineSteps.length, forkSteps.length);
  for (let index = 0; index < length; index += 1) {
    const baseline = baselineSteps[index];
    const fork = forkSteps[index];
    if (!baseline || !fork) continue;
    const left = observableStepFacts(baseline);
    const right = observableStepFacts(fork);
    if (JSON.stringify(left) !== JSON.stringify(right)) {
      const changedFacts = [...new Set([...Object.keys(left), ...Object.keys(right)])]
        .filter((key) => JSON.stringify(left[key]) !== JSON.stringify(right[key]));
      return { index, baseline, fork, changedFacts };
    }
  }
  return undefined;
}

export function observableStepFacts(step: DemoStep): Record<string, unknown> {
  const facts: Record<string, unknown> = {
    actor: step.actorId,
    action: step.candidate.kind,
  };
  flattenObservable(step.candidate.payload, "proposal", facts);
  for (const delta of step.receipt.deltas) {
    if (!isScalar(delta.before) || !isScalar(delta.after)) continue;
    const path = delta.path.replace(/\.\d+(?=\.|$)/g, ".*");
    facts[`change.${path}.before`] = delta.before;
    facts[`change.${path}.after`] = delta.after;
  }
  return sortRecord(facts);
}

function flattenObservable(value: unknown, prefix: string, output: Record<string, unknown>): void {
  if (isScalar(value)) {
    output[prefix] = value;
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => flattenObservable(item, `${prefix}.${index}`, output));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right))) {
    if (hiddenIdentityKeys.has(key) || /(?:Id|Ids)$/.test(key)) continue;
    flattenObservable(item, `${prefix}.${key}`, output);
  }
}

function isScalar(value: unknown): value is string | number | boolean | null | undefined {
  return value === null || value === undefined || ["string", "number", "boolean"].includes(typeof value);
}

function sortRecord(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).sort(([left], [right]) => left.localeCompare(right)));
}
