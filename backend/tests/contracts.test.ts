import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import * as formatsModule from "ajv-formats";
import { describe, expect, it } from "vitest";
import { behaviorAgents, deterministicServices } from "../src/agents/manifests.js";
import { runAutonomousGolden } from "../src/orchestrator/golden.js";
import { StubProvider } from "../src/providers/stub-provider.js";
import { deriveSemanticEffects } from "../src/world/semantics.js";

const contractDir = new URL("../../contracts/v0/schemas/", import.meta.url);
const contract = json("contract.schema.json");
const worldRoot = json("world-state.schema.json");
const actionRoot = json("agent-action.schema.json");
const traceRoot = json("trace.schema.json");

function json(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(new URL(name, contractDir), "utf8")) as Record<string, unknown>;
}

function ajv(): Ajv2020 {
  const instance = new Ajv2020({ strict: true, strictTypes: false, allErrors: true });
  const addFormats = formatsModule.default as unknown as (target: Ajv2020) => Ajv2020;
  addFormats(instance);
  instance.addSchema(contract);
  instance.addSchema(worldRoot);
  instance.addSchema(actionRoot);
  instance.addSchema(traceRoot);
  return instance;
}

describe("frozen contract-v0.1 Ajv compatibility", () => {
  it("compiles every root schema without unresolved placeholder structures", () => {
    const instance = ajv();
    expect(instance.getSchema(String(worldRoot.$id))).toBeTypeOf("function");
    expect(instance.getSchema(String(actionRoot.$id))).toBeTypeOf("function");
    expect(instance.getSchema(String(traceRoot.$id))).toBeTypeOf("function");
    const source = JSON.stringify(contract);
    expect(source).not.toContain('"type":"array"}');
    expect(source).not.toContain('"type":"object"}');
    expect(source).not.toContain(':{}');
  });

  it("validates all actors, autonomous actions, terminal state, trace and frontend semantics", async () => {
    const instance = ajv();
    const validateActor = instance.compile({ $ref: "https://cityscope.local/contracts/v0/contract.schema.json#/$defs/ActorManifest" });
    for (const actor of [...behaviorAgents, ...deterministicServices]) expect(validateActor(actor), JSON.stringify(validateActor.errors)).toBe(true);
    const run = await runAutonomousGolden(new StubProvider());
    const validateAction = instance.getSchema(String(actionRoot.$id));
    for (const step of [...run.checkpointContinuation.steps, ...run.rootContinuation.steps]) expect(validateAction?.(step.candidate), JSON.stringify(validateAction?.errors)).toBe(true);
    const validateWorld = instance.getSchema(String(worldRoot.$id));
    expect(validateWorld?.(run.state), JSON.stringify(validateWorld?.errors)).toBe(true);
    const validateTrace = instance.getSchema(String(traceRoot.$id));
    for (const item of [...run.state.receipts, ...run.state.trace, ...run.state.events]) expect(validateTrace?.(item), JSON.stringify(validateTrace?.errors)).toBe(true);
    const validateSemantics = instance.compile({ $ref: "https://cityscope.local/contracts/v0/contract.schema.json#/$defs/SemanticEffects" });
    const semanticEffects = deriveSemanticEffects(run.state);
    expect(validateSemantics(semanticEffects), JSON.stringify(validateSemantics.errors)).toBe(true);
    const validateFrontend = instance.compile({ $ref: "https://cityscope.local/contracts/v0/contract.schema.json#/$defs/FrontendCompatibilitySample" });
    const frontendSample = { schemaVersion: run.state.snapshot.schemaVersion, state: run.state, semanticEffects, recentEvents: run.state.events.slice(-12), recentDeltas: run.state.trace.slice(-20), resourceGateReceipts: run.state.receipts.flatMap((receipt) => receipt.gateResults.flatMap((gate) => gate.calculations ?? [])) };
    expect(validateFrontend(frontendSample), JSON.stringify(validateFrontend.errors)).toBe(true);
  });
});
