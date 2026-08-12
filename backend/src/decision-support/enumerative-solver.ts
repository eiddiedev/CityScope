import { assignmentSignature, evaluateAssignment } from "./evaluate.js";
import { functionIds, type Assignment, type CandidatePlan, type FunctionId, type OptimizationInput, type OptimizationResult } from "./types.js";

export function solveEnumeratively(input: OptimizationInput): OptimizationResult {
  const startedAt = performance.now();
  const assignments = enumerateAssignments();
  const candidates: CandidatePlan[] = [];
  const used = new Set<string>();
  for (const profile of input.profiles) {
    const ranked = assignments
      .map((assignment) => evaluateAssignment(input, assignment, profile))
      .filter((candidate): candidate is CandidatePlan => Boolean(candidate))
      .sort((left, right) => right.objectiveValue - left.objectiveValue || left.candidateId.localeCompare(right.candidateId));
    const selected = ranked.find((candidate) => !used.has(assignmentSignature(candidate.assignments)));
    if (!selected) continue;
    used.add(assignmentSignature(selected.assignments));
    candidates.push(selected);
    if (candidates.length >= input.maxCandidates) break;
  }
  return {
    engine: "enumerative-fallback",
    engineVersion: "cityscope-enumerator.v1",
    status: candidates.length ? "OPTIMAL" : "INFEASIBLE",
    solveTimeMs: Math.round((performance.now() - startedAt) * 100) / 100,
    candidates,
    diagnostics: [`enumerated=${assignments.length}`, `uniqueCandidates=${candidates.length}`],
  };
}

function enumerateAssignments(): Array<Record<FunctionId, Assignment>> {
  const values: Assignment[] = ["none", "chengdu", "chongqing"];
  const results: Array<Record<FunctionId, Assignment>> = [];
  const visit = (index: number, current: Partial<Record<FunctionId, Assignment>>) => {
    if (index === functionIds.length) {
      results.push(current as Record<FunctionId, Assignment>);
      return;
    }
    const functionId = functionIds[index];
    if (!functionId) return;
    for (const value of values) visit(index + 1, { ...current, [functionId]: value });
  };
  visit(0, {});
  return results;
}
