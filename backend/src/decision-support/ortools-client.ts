import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { z } from "zod";
import { evaluateAssignment } from "./evaluate.js";
import { functionIds, type Assignment, type FunctionId, type OptimizationInput, type OptimizationResult } from "./types.js";

const RawCandidateSchema = z.object({
  profileId: z.enum(["chengdu_single", "chongqing_single", "dual_city", "reduced_scope", "no_landing"]),
  assignments: z.record(z.enum(["none", "chengdu", "chongqing"])),
  objectiveValue: z.number(),
  solverStatus: z.enum(["OPTIMAL", "FEASIBLE"]),
});

const RawOutputSchema = z.object({
  engineVersion: z.string(),
  status: z.enum(["OPTIMAL", "FEASIBLE", "INFEASIBLE"]),
  solveTimeMs: z.number(),
  solverWallTimeMs: z.number(),
  statuses: z.array(z.string()),
  candidates: z.array(RawCandidateSchema),
});

export async function solveWithOrTools(input: OptimizationInput, env: NodeJS.ProcessEnv = process.env): Promise<OptimizationResult> {
  const python = pythonExecutable(env);
  const script = resolve(process.cwd(), "optimization/cityscope_solver.py");
  const raw = await runPython(python, script, JSON.stringify(input), Math.max(20_000, Math.ceil(input.timeLimitSeconds * input.profiles.length * 1000 + 5_000)));
  const parsed = RawOutputSchema.parse(JSON.parse(raw));
  const candidates = parsed.candidates.flatMap((item) => {
    const assignments = Object.fromEntries(functionIds.map((functionId) => [functionId, item.assignments[functionId] ?? "none"])) as Record<FunctionId, Assignment>;
    const profile = input.profiles.find((candidate) => candidate.profileId === item.profileId);
    if (!profile) return [];
    const evaluated = evaluateAssignment(input, assignments, profile, item.solverStatus);
    if (!evaluated) throw new Error(`OR-Tools returned an infeasible assignment for ${item.profileId}`);
    evaluated.constraintEvidence.push(`CP_SAT_OBJECTIVE=${Math.round(item.objectiveValue * 100) / 100}`);
    return [evaluated];
  });
  return {
    engine: "ortools-cp-sat",
    engineVersion: parsed.engineVersion,
    status: parsed.status,
    solveTimeMs: parsed.solveTimeMs,
    candidates,
    diagnostics: [`python=${python}`, `solverWallTimeMs=${parsed.solverWallTimeMs}`, `statuses=${parsed.statuses.join(",")}`],
  };
}

function pythonExecutable(env: NodeJS.ProcessEnv): string {
  if (env.CITYSCOPE_ORTOOLS_PYTHON) return env.CITYSCOPE_ORTOOLS_PYTHON;
  const local = resolve(process.cwd(), ".venv-optimization/bin/python");
  return existsSync(local) ? local : "python3";
}

function runPython(python: string, script: string, input: string, timeoutMs: number): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(python, [script], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`OR-Tools solver timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error(`OR-Tools solver exited ${code}: ${stderr.slice(0, 1_000)} ${stdout.slice(0, 1_000)}`));
      else resolvePromise(stdout.trim());
    });
    child.stdin.end(input);
  });
}
