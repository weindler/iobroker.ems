/**
 * Neutral EV data model V1.
 * Planner later consumes these fields and capabilities only — never Ford/Tibber/HA state IDs.
 * Phase 3 may overlay diagnostic takeover fields; preparedEvState stays the EVCC mapping.
 * emsTakeoverActive remains false until a later phase explicitly enables writes.
 */

import type { EvSmartPlanSlot, ExternalSourceQuality } from "./external/types";

export const EV_MODULE_STATES = [
	"idle",
	"pv",
	"minpv",
	"planned_now",
	"external",
	"ems_takeover",
	"manual_override",
] as const;

export type EvModuleState = (typeof EV_MODULE_STATES)[number];

export const EV_TAKEOVER_REASONS = [
	"deadline_risk",
	"insufficient_external_plan",
	"economic_window_loss",
	"external_unavailable",
] as const;

export type EvTakeoverReason = (typeof EV_TAKEOVER_REASONS)[number];

export const EV_EXTERNAL_AUTHORITY_STATES = [
	"inactive",
	"active",
	"planned",
	"active_without_plan",
	"unavailable",
	"unknown",
] as const;

export type EvExternalAuthorityState = (typeof EV_EXTERNAL_AUTHORITY_STATES)[number];

export const EV_TAKEOVER_SEVERITIES = ["none", "observe", "recommended", "required"] as const;

export type EvTakeoverSeverity = (typeof EV_TAKEOVER_SEVERITIES)[number];

export const EV_EXTERNAL_CONTROL_TYPES = ["none", "vehicle", "wallbox", "unknown"] as const;

export type EvExternalControlType = (typeof EV_EXTERNAL_CONTROL_TYPES)[number];

export const EV_DATA_QUALITY = ["ok", "degraded", "unknown"] as const;

export type EvDataQuality = (typeof EV_DATA_QUALITY)[number];

export const EV_FIELD_QUALITY = ["valid", "unknown", "invalid"] as const;

export type EvFieldQuality = (typeof EV_FIELD_QUALITY)[number];

/** Prepared module states that Phase 1 may emit (read-only mapping from EVCC mode). */
export const EV_PHASE1_PREPARED_STATES = ["idle", "pv", "minpv", "planned_now"] as const;

export type EvPhase1PreparedState = (typeof EV_PHASE1_PREPARED_STATES)[number];

export interface EvCapabilities {
	evccAvailable: boolean;
	vehicleSocAvailable: boolean;
	vehicleConnectedAvailable: boolean;
	chargePowerAvailable: boolean;
	realChargePhaseAvailable: boolean;
	vehicleLiveDataAvailable: boolean;
	externalControlDetectable: boolean;
	externalSmartPlanAvailable: boolean;
	tibberGridRewardsViaVehicle: boolean;
	tibberGridRewardsViaWallbox: boolean;
	homeAssistantDataSourceAvailable: boolean;
	externalControlConfigured: boolean;
}

export interface EvModelV1 {
	evccConnected: boolean | null;
	vehicleConnected: boolean | null;
	charging: boolean | null;
	chargePowerW: number | null;
	evccMode: string | null;
	phasesConfigured: number | null;
	phasesActive: number | null;
	maxCurrentA: number | null;
	minCurrentA: number | null;
	effectiveMaxCurrentA: number | null;
	offeredCurrentA: number | null;
	vehicleSocPct: number | null;
	targetSocPct: number | null;
	minimumDepartureSocPct: number | null;
	departureAt: string | null;
	batteryCapacityKWh: number | null;
	maxAcChargePowerKw: number | null;
	chargingEfficiency: number | null;
	safetyMarginMin: number | null;
	vehicleAvailableUntil: string | null;
	externalControlEnabled: boolean | null;
	externalControlType: EvExternalControlType;
	externalControlActive: boolean | null;
	externalControlConfigured: boolean;
	externalSmartPlanAvailable: boolean;
	externalSmartPlanSlots: EvSmartPlanSlot[] | null;
	externalPlanRemainingEnergyKWh: number | null;
	externalPlanRemainingMinutes: number | null;
	externalPlanDeadlineUsed: boolean;
	gridRewardsActive: boolean | null;
	smartChargingActive: boolean | null;
	externalSourceQuality: ExternalSourceQuality;
	externalSourceUpdatedAt: string | null;
	externalSourceHealthy: boolean;
	manualOverrideActive: boolean | null;
	emsTakeoverActive: boolean;
	preparedEvState: EvModuleState;
	/** Diagnostic only — never executed in Phase 3. preparedEvState stays the EVCC mapping. */
	recommendedEvState: EvModuleState;
	externalAuthorityState: EvExternalAuthorityState;
	takeoverSeverity: EvTakeoverSeverity;
	takeoverRecommended: boolean;
	takeoverRequired: boolean;
	takeoverReason: EvTakeoverReason | null;
	vehicleDetectionActive: boolean | null;
	dataQuality: EvDataQuality;
	vehicleSocQuality: EvFieldQuality;
	externalSmartChargingMinSocPct: number | null;
	externalSmartChargingMinSocQuality: "valid" | "unknown" | "unconfigured";
	departureMinSocConfigured: boolean;
	vehicleModelSource: "ev_model_v1" | "vehicle_profile" | "none" | "conflict";
	vehicleModelReady: boolean;
	controlContractModel: "none" | "legacy_direct" | "evcc_string_mode" | "evcc_control_v1" | "evcc_buttons";
	evccControlContractReady: boolean;
	legacyDirectControlPresent: boolean;
	evccModeControlVariant: "none" | "buttons" | "pv_control" | "string_mode";
	evccModeFeedbackState: string;
	evccModeButtonsReady: boolean;
	evccModeOffTargetReady: boolean;
	evccModePvTargetReady: boolean;
	evccModeMinTargetReady: boolean;
	evccModeNowTargetReady: boolean;
}

export const EMPTY_EV_CAPABILITIES: EvCapabilities = {
	evccAvailable: false,
	vehicleSocAvailable: false,
	vehicleConnectedAvailable: false,
	chargePowerAvailable: false,
	realChargePhaseAvailable: false,
	vehicleLiveDataAvailable: false,
	externalControlDetectable: false,
	externalSmartPlanAvailable: false,
	tibberGridRewardsViaVehicle: false,
	tibberGridRewardsViaWallbox: false,
	homeAssistantDataSourceAvailable: false,
	externalControlConfigured: false,
};
