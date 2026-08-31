/**
 * PHASE 6 — periodischer Sweep: TTL-Ablauf anwenden und Diagnose-States aktualisieren.
 * Reine Transparenz — ändert nie reales Planner-/Control-Verhalten.
 */

import { AI_OVERRIDE_LEDGER_CATEGORY, readOverrideLedgerStore, writeOverrideLedgerStore } from "./persist";
import { sweepExpiredOverrides } from "./validate";
import { AI_VALIDATOR_STATES } from "./ensure_states";

export type AiValidatorTickHost = {
	getAbsolutePath: (category?: string) => string;
	setStateAsync?: (id: string, state: ioBroker.SettableState) => Promise<unknown>;
};

export async function syncAiValidatorStates(
	host: AiValidatorTickHost,
	now: Date = new Date(),
): Promise<void> {
	const baseDir = host.getAbsolutePath(AI_OVERRIDE_LEDGER_CATEGORY);
	const store = await readOverrideLedgerStore(baseDir);
	const swept = sweepExpiredOverrides(store.overrides, now);
	const changed = swept.some((o, i) => o.status !== store.overrides[i]?.status);
	if (changed) {
		await writeOverrideLedgerStore(baseDir, { ...store, updatedAtIso: now.toISOString(), overrides: swept });
	}
	const active = swept.filter((o) => o.status === "active");
	if (!host.setStateAsync) return;
	await host.setStateAsync(AI_VALIDATOR_STATES.activeOverridesCount, { val: active.length, ack: true });
	await host.setStateAsync(AI_VALIDATOR_STATES.lastValidatedAtIso, { val: now.toISOString(), ack: true });
}
