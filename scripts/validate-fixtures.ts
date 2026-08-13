import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import * as formatsModule from "ajv-formats";

type JsonObject = Record<string, unknown>;

const root = process.cwd();
const [contract, demoSchema, fixture] = await Promise.all([
  json("contracts/v0/schemas/contract.schema.json"),
  json("contracts/v0/schemas/demo-fixture.schema.json"),
  json("fixtures/v0/cityscope-demo.json")
]);

const ajv = new Ajv2020({ strict: true, strictTypes: false, allErrors: true });
const addFormats = formatsModule.default as unknown as (target: Ajv2020) => Ajv2020;
addFormats(ajv);
ajv.addSchema(contract);
const validate = ajv.compile(demoSchema);
if (!validate(fixture)) throw new Error(`fixture schema validation failed:\n${ajv.errorsText(validate.errors, { separator: "\n" })}`);

const registry = array(fixture.actorRegistry);
assert(registry.filter((item) => object(item).actorKind === "agent").length === 12, "fixture must contain 12 behavioral agents");
assert(registry.filter((item) => object(item).actorKind === "service").length === 4, "fixture must contain 4 deterministic services");

const baseline = object(fixture.baseline);
const baselineState = object(baseline.terminalState);
assert(baseline.runMode === "autonomous", "baseline must be autonomous");
assert(baselineState.terminal === true, "baseline outcome may only exist after terminal state");
assert(object(object(baselineState.simulation).classification).label === object(baseline.classification).label, "baseline classification must match terminal state");

const knownActors = new Set(registry.map((item) => String(object(item).agentId)));
const knownCauses = new Set<string>();
for (const receiptValue of array(baselineState.receipts)) {
  const receipt = object(receiptValue);
  knownCauses.add(String(receipt.actionId));
  if (receipt.status === "REJECTED") assert(array(receipt.deltas).length === 0, `rejected action ${receipt.actionId} produced deltas`);
}
for (const eventValue of array(baselineState.events)) knownCauses.add(String(object(eventValue).causeId));
for (const deltaValue of array(baselineState.trace)) {
  const delta = object(deltaValue);
  assert(knownCauses.has(String(delta.causeId)), `unresolvable causeId ${delta.causeId}`);
  assert(knownActors.has(String(delta.actorId)) || ["orchestrator", "outcome_classifier"].includes(String(delta.actorId)), `unknown delta actor ${delta.actorId}`);
}

const redline = object(fixture.redlineProbe);
const redlineReceipt = object(redline.receipt);
assert(redlineReceipt.status === "REJECTED", "redline probe must be rejected");
assert(array(redlineReceipt.deltas).length === 0, "redline probe must not mutate WorldState");
assert(array(redlineReceipt.gateResults).some((item) => object(item).passed === false), "redline probe must expose a failed gate");

for (const forkValue of array(fixture.forks)) {
  const fork = object(forkValue);
  const state = object(fork.terminalState);
  const intervention = object(fork.intervention);
  assert(state.terminal === true, `fork ${fork.runId} is not terminal`);
  assert(String(fork.runId) !== String(fork.parentRunId), `fork ${fork.runId} reuses parent id`);
  assert(["interventionId", "path", "previousValue", "newValue", "reason"].every((key) => key in intervention), `fork ${fork.runId} intervention is incomplete`);
  assert(object(object(state.simulation).classification).label === object(fork.classification).label, `fork ${fork.runId} classification mismatch`);
  assert(array(fork.steps).length > 0, `fork ${fork.runId} must contain replayable continuation steps`);
  assert(object(fork.causalComparison).interventionRunId === fork.runId, `fork ${fork.runId} causal comparison mismatch`);
}

const serialized = JSON.stringify(fixture);
for (const forbidden of ["desiredOutcome", "forceAgreement", "winner"]) assert(!serialized.includes(`\"${forbidden}\"`), `forbidden outcome-directing field ${forbidden}`);

console.log(JSON.stringify({
  valid: true,
  contractVersion: fixture.contractVersion,
  fixtureVersion: fixture.fixtureVersion,
  actors: registry.length,
  steps: array(baseline.steps).length,
  forks: array(fixture.forks).length,
  redlineDeltaCount: array(redlineReceipt.deltas).length
}, null, 2));

async function json(relativePath: string): Promise<JsonObject> {
  return JSON.parse(await readFile(resolve(root, relativePath), "utf8")) as JsonObject;
}

function object(value: unknown): JsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("expected object");
  return value as JsonObject;
}

function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error("expected array");
  return value;
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
