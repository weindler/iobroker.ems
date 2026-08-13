/**
 * Neutral external EV control / smart-plan types (Phase 2, read-only).
 * Source adapters map HA/Tibber/other payloads here — Unified Planner never sees vendor state IDs.
 */

export const EXTERNAL_SOURCE_QUALITIES = [
	"unconfigured",
	"unknown",
	"ok",
	"degraded",
	"stale",
	"invalid",
] as const;

export type ExternalSourceQuality = (typeof EXTERNAL_SOURCE_QUALITIES)[number];

export const SMART_PLAN_SLOT_QUALITIES = ["ok", "degraded"] as const;

export type SmartPlanSlotQuality = (typeof SMART_PLAN_SLOT_QUALITIES)[number];

export interface EvSmartPlanSlot {
	start: string;
	end: string;
	plannedPowerKw: number | null;
	plannedEnergyKWh: number | null;
	source: string | null;
	quality: SmartPlanSlotQuality;
}

export interface ExternalSmartPlanEval {
	mappingConfigured: boolean;
	stateReadable: boolean;
	payloadParseable: boolean;
	validPlanPresent: boolean;
	slots: EvSmartPlanSlot[];
	parsedSlotCount: number;
	ignoredSlotCount: number;
	nextStart: string | null;
	lastEnd: string | null;
	remainingEnergyKWh: number | null;
	remainingMinutes: number | null;
	remainingEnergyEstimated: boolean;
	deadlineUsed: boolean;
	deadlineIso: string | null;
	rawPreview: string | null;
	parseError: string | null;
}

export interface ExternalEvInformation {
	externalControlConfigured: boolean;
	externalControlEnabled: boolean;
	externalControlActive: boolean | null;
	externalControlType: "none" | "vehicle" | "wallbox" | "unknown";
	gridRewardsActive: boolean | null;
	smartChargingActive: boolean | null;
	externalSourceHealthy: boolean;
	externalSourceQuality: ExternalSourceQuality;
	externalSourceUpdatedAt: string | null;
	/** Diagnostic only — never copied onto externalControlActive. */
	vehicleChargePauseDiagnostic: boolean | null;
	smartPlan: ExternalSmartPlanEval;
	externalTargetSocPct: number | null;
	/** External optimizer floor SOC — not departure min. Never copied onto minimumDepartureSocPct. */
	externalSmartChargingMinSocPct: number | null;
	externalSmartChargingMinSocQuality: "valid" | "unknown" | "unconfigured";
	freshnessSignalConfigured: boolean;
}

export function emptySmartPlanEval(): ExternalSmartPlanEval {
	return {
		mappingConfigured: false,
		stateReadable: false,
		payloadParseable: false,
		validPlanPresent: false,
		slots: [],
		parsedSlotCount: 0,
		ignoredSlotCount: 0,
		nextStart: null,
		lastEnd: null,
		remainingEnergyKWh: null,
		remainingMinutes: null,
		remainingEnergyEstimated: false,
		deadlineUsed: false,
		deadlineIso: null,
		rawPreview: null,
		parseError: null,
	};
}
