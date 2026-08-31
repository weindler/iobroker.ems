/**
 * PHASE 6 — Persistenz des KI-Override-Ledgers.
 *
 * Restorewürdig (kleine, langlebige Entscheidungs-Historie) — analog
 * `learning/daily_evaluator/learning_state_v1.json`, siehe `.cursor/rules` Persistenz-Konvention.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { atomicWriteFile, DIAGNOSTIC_FILE_MODE } from "../../persistence/atomic_write";
import { sweepExpiredOverrides } from "./validate";
import type { ValidatedAiOverride } from "./types";

export const AI_OVERRIDE_LEDGER_CATEGORY = "ai/override_ledger";
export const AI_OVERRIDE_LEDGER_FILE = "override_ledger_v1.json";
/** Ledger bleibt klein — nur zuletzt aktive/abgelaufene/abgelehnte Einträge behalten. */
export const AI_OVERRIDE_LEDGER_MAX_ENTRIES = 500;

export type AiOverrideLedgerStore = {
	module: "ai_override_ledger";
	schemaVersion: 1;
	updatedAtIso: string;
	overrides: ValidatedAiOverride[];
};

export function emptyOverrideLedgerStore(): AiOverrideLedgerStore {
	return { module: "ai_override_ledger", schemaVersion: 1, updatedAtIso: new Date(0).toISOString(), overrides: [] };
}

function ledgerPath(baseDir: string): string {
	return path.join(baseDir, AI_OVERRIDE_LEDGER_FILE);
}

export async function readOverrideLedgerStore(
	baseDir: string | null | undefined,
): Promise<AiOverrideLedgerStore> {
	if (!baseDir) return emptyOverrideLedgerStore();
	try {
		const raw = await fs.readFile(ledgerPath(baseDir), "utf8");
		const parsed = JSON.parse(raw) as Partial<AiOverrideLedgerStore>;
		if (!parsed || parsed.module !== "ai_override_ledger" || !Array.isArray(parsed.overrides)) {
			return emptyOverrideLedgerStore();
		}
		return {
			module: "ai_override_ledger",
			schemaVersion: 1,
			updatedAtIso: typeof parsed.updatedAtIso === "string" ? parsed.updatedAtIso : new Date(0).toISOString(),
			overrides: parsed.overrides,
		};
	} catch {
		return emptyOverrideLedgerStore();
	}
}

export async function writeOverrideLedgerStore(
	baseDir: string,
	store: AiOverrideLedgerStore,
): Promise<void> {
	await atomicWriteFile(ledgerPath(baseDir), `${JSON.stringify(store)}\n`, { mode: DIAGNOSTIC_FILE_MODE });
}

/** Neuen validierten Override anhängen, TTL-Sweep anwenden, Ledger auf Maximalgröße begrenzen. */
export async function appendOverrideToLedger(
	baseDir: string,
	override: ValidatedAiOverride,
	now: Date = new Date(),
): Promise<AiOverrideLedgerStore> {
	const store = await readOverrideLedgerStore(baseDir);
	const swept = sweepExpiredOverrides([...store.overrides, override], now);
	const trimmed = swept.length > AI_OVERRIDE_LEDGER_MAX_ENTRIES ? swept.slice(-AI_OVERRIDE_LEDGER_MAX_ENTRIES) : swept;
	const next: AiOverrideLedgerStore = {
		module: "ai_override_ledger",
		schemaVersion: 1,
		updatedAtIso: now.toISOString(),
		overrides: trimmed,
	};
	await writeOverrideLedgerStore(baseDir, next);
	return next;
}
