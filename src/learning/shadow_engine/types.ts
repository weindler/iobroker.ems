import { SHADOW_ENGINE_MODULE, SHADOW_ENGINE_SCHEMA_VERSION } from "./constants";

export type ShadowStrategyId = "reference_no_ems" | "reference_sonnen_native" | "ems_without_ai";

export const SHADOW_STRATEGY_IDS: ShadowStrategyId[] = [
	"reference_no_ems",
	"reference_sonnen_native",
	"ems_without_ai",
];

/** Gemeinsame Energie-/Kosten-Felder einer simulierten oder realen Welt. Unbekannt = null, nie erfundene 0. */
export type ShadowWorldEnergy = {
	gridImportKwh: number | null;
	gridExportKwh: number | null;
	batteryChargeKwh: number | null;
	batteryDischargeKwh: number | null;
	socStartPct: number | null;
	socEndPct: number | null;
	/** Netzbezugskosten (dynamischer Real-Tagespreis je Slot × Import) — EUR. */
	importCostEur: number | null;
	/** Einspeisegutschrift (Admin-Einspeisevergütung × Export) — EUR. */
	exportCreditEur: number | null;
	/** importCostEur − exportCreditEur. null wenn importCostEur unbekannt. */
	netCostEur: number | null;
};

/** Realer, gemessener Tag — aus day_telemetry-Buckets aggregiert, keine Simulation. */
export type ShadowRealResult = ShadowWorldEnergy & {
	slotCount: number;
	observedSlotCount: number;
	missingSlotCount: number;
};

/** Ergebnis einer simulierten Gegenwelt (reference_no_ems / ems_without_ai). */
export type ShadowStrategyResult = ShadowWorldEnergy & {
	strategy: ShadowStrategyId;
	modelVersion: string;
	/** false, wenn Grunddaten (Kapazität/SOC-Grenzen/Coverage) für eine belastbare Aussage fehlen. */
	evaluable: boolean;
	missingSlotCount: number;
	/** Deutsche Kurz-Erklärung der Modellannahmen/Vereinfachungen dieser Welt — keine versteckte Präzision. */
	assumptionsDe: string[];
};

export type ShadowDayRecord = {
	module: typeof SHADOW_ENGINE_MODULE;
	schemaVersion: typeof SHADOW_ENGINE_SCHEMA_VERSION;
	dateKey: string;
	timezone: string;
	generatedAtIso: string;
	/** Aus day_telemetry übernommen — Point-in-time-Nachvollziehbarkeit der Quelle. */
	sourceTelemetryLastSampleIso: string | null;
	dayEvaluable: boolean;
	real: ShadowRealResult;
	strategies: Partial<Record<ShadowStrategyId, ShadowStrategyResult>>;
};

export function notEvaluableStrategyResult(
	strategy: ShadowStrategyId,
	assumptionsDe: string[],
	missingSlotCount = 0,
): ShadowStrategyResult {
	return {
		strategy,
		modelVersion: "",
		evaluable: false,
		missingSlotCount,
		assumptionsDe,
		gridImportKwh: null,
		gridExportKwh: null,
		batteryChargeKwh: null,
		batteryDischargeKwh: null,
		socStartPct: null,
		socEndPct: null,
		importCostEur: null,
		exportCreditEur: null,
		netCostEur: null,
	};
}
