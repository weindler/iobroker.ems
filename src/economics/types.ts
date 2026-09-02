/**
 * PHASE 7 — Wirtschaftlichkeit. Drei Effekte strikt getrennt, nie schönrechnen:
 *   1. Tarifvorteil  — dynamischer Tarif vs. Festtarif (bestehende Statistik)
 *   2. EMS-Vorteil   — reference_no_ems vs. real (Shadow Engine)
 *   3. KI-Mehrwert   — ems_without_ai vs. real (Shadow Engine; kann negativ sein)
 *
 * Der KI-Euro-Wert stammt AUSSCHLIESSLICH aus der deterministischen Shadow-Berechnung — nie aus
 * einer LLM-Selbsteinschätzung. Grid Rewards separat, nie mit dem Tarifvorteil vermischt.
 */

export const ECONOMICS_MODULE = "economics" as const;
export const ECONOMICS_SCHEMA_VERSION = 1 as const;

export type EconomicsDayRecord = {
	dateKey: string;
	generatedAtIso: string;
	/** Tag bereits vollständig abgeschlossen (Shadow + Statistik verfügbar) — sonst nur Teilwerte (heute). */
	final: boolean;

	tarifvorteilEur: number | null;
	emsVorteilEur: number | null;
	kiMehrwertEur: number | null;

	gridRewardsCreditEur: number | null;
	gridRewardsSource: string | null;

	realNetCostEur: number | null;
	referenceNoEmsNetCostEur: number | null;
	/** Realistische Sonnen-ohne-EMS; null wenn nicht bewertbar. */
	referenceSonnenNativeNetCostEur?: number | null;
	emsWithoutAiNetCostEur: number | null;

	emsVorteilEvaluable: boolean;
	kiMehrwertEvaluable: boolean;
	notesDe: string[];
};

export type EconomicsPersist = {
	module: typeof ECONOMICS_MODULE;
	schemaVersion: typeof ECONOMICS_SCHEMA_VERSION;
	updatedAtIso: string;
	/** dateKey → Tagesbuchung. Klein pro Eintrag — unbeschränkte Retention vertretbar (Accounting-Historie). */
	days: Record<string, EconomicsDayRecord>;
};

export function emptyEconomicsPersist(now = new Date()): EconomicsPersist {
	return { module: ECONOMICS_MODULE, schemaVersion: ECONOMICS_SCHEMA_VERSION, updatedAtIso: now.toISOString(), days: {} };
}

export type EconomicsPeriodSummary = {
	period: string;
	periodLabelDe: string;
	fromKey: string;
	toKey: string;
	daysTotal: number;
	daysTarifvorteilEvaluable: number;
	daysEmsVorteilEvaluable: number;
	daysKiMehrwertEvaluable: number;
	tarifvorteilEur: number | null;
	emsVorteilEur: number | null;
	kiMehrwertEur: number | null;
	gridRewardsCreditEur: number | null;
	reasonDe: string;
};
