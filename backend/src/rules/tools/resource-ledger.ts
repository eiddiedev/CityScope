import type { PolicyTerm, ResourceAccount, ResourceCalculation, ResourceKind, ResourceLedger } from "../../domain.js";
import { clone } from "../../util.js";

export type ResourceRequests = Partial<Record<ResourceKind, number>>;

export function emptyAccount(capacity: number): ResourceAccount {
  return { capacity, available: capacity, reserved: 0, committed: 0, paid: 0, released: 0 };
}

export function createResourceLedger(input: Record<ResourceKind, number>): ResourceLedger {
  return {
    fiscalMillionCny: emptyAccount(input.fiscalMillionCny),
    landHectares: emptyAccount(input.landHectares),
    factorySqm: emptyAccount(input.factorySqm),
    energyMw: emptyAccount(input.energyMw),
    talentHousingUnits: emptyAccount(input.talentHousingUnits),
  };
}

export function requestsFromTerms(terms: PolicyTerm[]): ResourceRequests {
  const result: ResourceRequests = {};
  for (const term of terms) {
    const mapping = termResource(term);
    if (!mapping) continue;
    result[mapping.resource] = (result[mapping.resource] ?? 0) + mapping.requested;
  }
  return result;
}

export function calculateFiscal(ledger: ResourceLedger, requested: number): ResourceCalculation {
  return calculate(ledger, "fiscalMillionCny", requested, "fiscal");
}

export function calculateLandAndFacility(ledger: ResourceLedger, landRequested: number, facilityRequested: number): ResourceCalculation[] {
  return [calculate(ledger, "landHectares", landRequested, "land_facility"), calculate(ledger, "factorySqm", facilityRequested, "land_facility")].filter((item) => item.requested > 0);
}

export function calculateEnergy(ledger: ResourceLedger, requested: number): ResourceCalculation {
  return calculate(ledger, "energyMw", requested, "energy");
}

export function calculateTalentHousing(ledger: ResourceLedger, requested: number): ResourceCalculation {
  return calculate(ledger, "talentHousingUnits", requested, "talent_housing");
}

export function calculatePolicyResources(ledger: ResourceLedger, terms: PolicyTerm[]): ResourceCalculation[] {
  const requests = requestsFromTerms(terms);
  return [
    ...(requests.fiscalMillionCny !== undefined ? [calculateFiscal(ledger, requests.fiscalMillionCny)] : []),
    ...calculateLandAndFacility(ledger, requests.landHectares ?? 0, requests.factorySqm ?? 0),
    ...(requests.energyMw !== undefined ? [calculateEnergy(ledger, requests.energyMw)] : []),
    ...(requests.talentHousingUnits !== undefined ? [calculateTalentHousing(ledger, requests.talentHousingUnits)] : []),
  ];
}

export function reserveResources(ledger: ResourceLedger, calculations: ResourceCalculation[]): ResourceLedger {
  if (calculations.some((item) => !item.passed)) throw new Error("cannot reserve failed resource calculation");
  const next = clone(ledger);
  for (const item of calculations) {
    const account = next[item.resource];
    account.available -= item.requested;
    account.reserved += item.requested;
  }
  assertLedger(next);
  return next;
}

export function commitResources(ledger: ResourceLedger, requests: ResourceRequests): ResourceLedger {
  const next = clone(ledger);
  for (const [resource, requested] of entries(requests)) {
    const account = next[resource];
    if (requested > account.reserved) throw new Error(`RESOURCE_RESERVATION_MISSING:${resource}`);
    account.reserved -= requested;
    account.committed += requested;
  }
  assertLedger(next);
  return next;
}

export function releaseResources(ledger: ResourceLedger, requests: ResourceRequests, from: "reserved" | "committed"): ResourceLedger {
  const next = clone(ledger);
  for (const [resource, requested] of entries(requests)) {
    const account = next[resource];
    if (requested > account[from]) throw new Error(`RESOURCE_RELEASE_EXCEEDS_${from.toUpperCase()}:${resource}`);
    account[from] -= requested;
    account.available += requested;
    account.released += requested;
  }
  assertLedger(next);
  return next;
}

export function payFiscalResource(ledger: ResourceLedger, amount: number): ResourceLedger {
  const next = clone(ledger);
  const account = next.fiscalMillionCny;
  if (amount > account.committed) throw new Error("RESOURCE_PAYMENT_EXCEEDS_COMMITTED:fiscalMillionCny");
  account.committed -= amount;
  account.paid += amount;
  assertLedger(next);
  return next;
}

export function assertLedger(ledger: ResourceLedger): void {
  for (const [resource, account] of Object.entries(ledger) as Array<[ResourceKind, ResourceAccount]>) {
    if (Object.values(account).some((value) => !Number.isFinite(value) || value < 0)) throw new Error(`INVALID_RESOURCE_LEDGER:${resource}`);
    const occupied = account.available + account.reserved + account.committed + account.paid;
    if (occupied > account.capacity + 1e-9) throw new Error(`RESOURCE_LEDGER_OVERALLOCATED:${resource}`);
  }
}

function calculate(ledger: ResourceLedger, resource: ResourceKind, requested: number, tool: ResourceCalculation["tool"]): ResourceCalculation {
  const account = ledger[resource];
  const valid = Number.isFinite(requested) && requested >= 0;
  const passed = valid && requested <= account.available;
  const reasonCode = !valid ? "INVALID_RESOURCE_REQUEST" : passed ? "RESOURCE_OK" : "RESOURCE_EXCEEDED";
  return {
    tool,
    resource,
    requested,
    available: account.available,
    reserved: account.reserved,
    committed: account.committed,
    paid: account.paid,
    released: account.released,
    remaining: valid ? account.available - requested : account.available,
    passed,
    reasonCode,
    evidence: [`capacity=${account.capacity}`, `available=${account.available}`, `reserved=${account.reserved}`, `committed=${account.committed}`, `paid=${account.paid}`, `requested=${requested}`],
  };
}

function termResource(term: PolicyTerm): { resource: ResourceKind; requested: number } | undefined {
  if (term.type === "cash_support") return { resource: "fiscalMillionCny", requested: term.amountMillionCny ?? 0 };
  if (term.type === "land") return { resource: "landHectares", requested: term.quantity ?? 0 };
  if (term.type === "facility") return { resource: "factorySqm", requested: term.quantity ?? 0 };
  if (term.type === "energy") return { resource: "energyMw", requested: term.quantity ?? 0 };
  if (term.type === "talent_housing") return { resource: "talentHousingUnits", requested: term.quantity ?? 0 };
  return undefined;
}

function entries(requests: ResourceRequests): Array<[ResourceKind, number]> {
  return Object.entries(requests).filter((entry): entry is [ResourceKind, number] => typeof entry[1] === "number" && entry[1] > 0);
}

