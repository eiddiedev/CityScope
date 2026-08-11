import type { Commitment, WorldState } from "../domain.js";

export function commitmentConsistency(state: WorldState): { consistent: boolean; violations: string[] } {
  const violations: string[] = [];
  const seen = new Set<string>();
  for (const commitment of state.commitments) {
    if (seen.has(commitment.commitmentId)) violations.push(`duplicate commitment ${commitment.commitmentId}`);
    seen.add(commitment.commitmentId);
    const cityId = commitment.payer.startsWith("chengdu") ? "chengdu" : commitment.payer.startsWith("chongqing") ? "chongqing" : undefined;
    if (!cityId) violations.push(`unknown payer ${commitment.payer}`);
    if (commitment.amountMillionCny < 0) violations.push(`negative amount ${commitment.commitmentId}`);
    if (commitment.status === "paid" && !triggerSatisfied(commitment, state)) violations.push(`paid before trigger ${commitment.commitmentId}`);
  }
  for (const city of Object.values(state.cities)) {
    const ledgerCommitted = state.commitments.filter((item) => item.payer.startsWith(city.cityId) && item.status !== "withdrawn").reduce((sum, item) => sum + item.amountMillionCny, 0);
    if (Math.abs(ledgerCommitted - city.fiscal.committedMillionCny) > 1e-9) violations.push(`${city.cityId} ledger/fiscal mismatch`);
  }
  return { consistent: violations.length === 0, violations };
}

function triggerSatisfied(commitment: Commitment, state: WorldState): boolean {
  if (!commitment.trigger) return true;
  return state.company[commitment.trigger.metric] >= commitment.trigger.value;
}

