/**
 * PHASE 6 — Öffentliche Fassade des KI-Override-Ledgers für andere Module (z. B. Shadow Engine,
 * Economics), damit diese nicht auf interne Validator-Details angewiesen sind.
 */

import { AI_OVERRIDE_LEDGER_CATEGORY, readOverrideLedgerStore } from "./override/persist";
import { sweepExpiredOverrides } from "./override/validate";
import type { ValidatedAiOverride } from "./override/types";

export type OverrideLedgerHost = {
	getAbsolutePath?: (category?: string) => string;
};

/**
 * Wurde am angegebenen lokalen Kalendertag ein validierter KI-Override aktiv (nicht abgelehnt)?
 * Aktuell im Produktionsbetrieb `false`, solange Admin `ai_override_enabled` aus ist oder
 * keine validierten Overrides existieren — das ist korrekt, keine Vereinfachung
 * (siehe `simulateEmsWithoutAi`).
 */
export async function wasAiOverrideActiveOnDate(
	host: OverrideLedgerHost,
	dateKey: string,
): Promise<boolean> {
	if (typeof host.getAbsolutePath !== "function") return false;
	try {
		const baseDir = host.getAbsolutePath(AI_OVERRIDE_LEDGER_CATEGORY);
		const store = await readOverrideLedgerStore(baseDir);
		const swept = sweepExpiredOverrides(store.overrides);
		return swept.some((o) => o.dateKey === dateKey && o.status !== "rejected");
	} catch {
		return false;
	}
}

export async function listOverridesForDate(
	host: OverrideLedgerHost,
	dateKey: string,
): Promise<ValidatedAiOverride[]> {
	if (typeof host.getAbsolutePath !== "function") return [];
	try {
		const baseDir = host.getAbsolutePath(AI_OVERRIDE_LEDGER_CATEGORY);
		const store = await readOverrideLedgerStore(baseDir);
		return sweepExpiredOverrides(store.overrides).filter((o) => o.dateKey === dateKey);
	} catch {
		return [];
	}
}

export async function listActiveOverrides(host: OverrideLedgerHost): Promise<ValidatedAiOverride[]> {
	if (typeof host.getAbsolutePath !== "function") return [];
	try {
		const baseDir = host.getAbsolutePath(AI_OVERRIDE_LEDGER_CATEGORY);
		const store = await readOverrideLedgerStore(baseDir);
		return sweepExpiredOverrides(store.overrides).filter((o) => o.status === "active");
	} catch {
		return [];
	}
}
