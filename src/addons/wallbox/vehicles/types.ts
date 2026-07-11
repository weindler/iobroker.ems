/** Wallbox vehicle profile foundation (v0.1.138) — read-only / diagnostic. */

export type VehicleProfileSource = "manual" | "evcc" | "hybrid";

export type VehicleSocSource = "measured" | "evcc_estimated" | "ems_estimated" | "manual" | "unavailable";

export type VehiclePlanningCapability = "soc_and_capacity" | "energy_only" | "limits_only" | "insufficient";

export type ActiveVehicleSource =
	| "evcc"
	| "manual"
	| "single_enabled_profile"
	| "guest"
	| "unknown";

export type ActiveVehicleDetectionStatus =
	| "resolved"
	| "disconnected"
	| "ambiguous"
	| "unknown"
	| "invalid_manual"
	| "no_profile";

export interface WallboxVehicleProfile {
	vehicleId: string;
	displayName: string;
	enabled: boolean;
	isGuest: boolean;

	source: VehicleProfileSource;

	evccVehicleId: string | null;
	evccVehicleName: string | null;

	batteryCapacityNetKwh: number | null;

	maxAcChargePowerW: number | null;
	supportedPhases: number[];
	preferredPhases: number | null;

	minCurrentA: number | null;
	maxCurrentA: number | null;

	defaultTargetSocPct: number | null;
	minimumDepartureSocPct: number | null;
	maximumSocPct: number | null;

	chargeEfficiencyPct: number | null;

	socStateId: string | null;
	rangeStateId: string | null;
	connectedStateId: string | null;
	chargingStateId: string | null;
	sessionEnergyStateId: string | null;

	createdAt: string | null;
	updatedAt: string | null;
}

export interface WallboxVehicleProfileReadiness {
	profileValid: boolean;
	telemetryReady: boolean;
	planningReady: boolean;
	socAvailable: boolean;
	capacityAvailable: boolean;
	chargeLimitsAvailable: boolean;

	planningCapability: VehiclePlanningCapability;

	missingFields: string[];
	invalidFields: string[];
	reasons: string[];
}

export interface VehicleTelemetryValues {
	connected: boolean | null;
	charging: boolean | null;
	socPct: number | null;
	socSource: VehicleSocSource;
	socQuality: string | null;
	rangeKm: number | null;
	sessionEnergyKwh: number | null;
	lastUpdate: string | null;
	stale: boolean;
}

export interface ActiveVehicleResolution {
	profileResolved: boolean;
	vehicleId: string | null;
	displayName: string | null;
	source: ActiveVehicleSource;
	detectionStatus: ActiveVehicleDetectionStatus;
	confidence: number;
	configuredManualVehicleId: string | null;
	connected: boolean | null;
	activeForCharging: boolean;
	reasons: string[];
}

export interface ActiveVehicleSnapshot {
	profileResolved: boolean;
	activeForCharging: boolean;

	vehicleId: string | null;
	displayName: string | null;
	source: string;

	connected: boolean;
	charging: boolean;

	socPct: number | null;
	socSource: VehicleSocSource | null;
	socQuality: string | null;
	rangeKm: number | null;

	batteryCapacityNetKwh: number | null;

	maxAcChargePowerW: number | null;
	supportedPhases: number[];
	preferredPhases: number | null;
	minCurrentA: number | null;
	maxCurrentA: number | null;

	defaultTargetSocPct: number | null;
	minimumDepartureSocPct: number | null;
	maximumSocPct: number | null;

	chargeEfficiencyPct: number | null;

	planningCapability: VehiclePlanningCapability;

	reasons: string[];
	createdAt: string;
}

export interface ActiveVehicleChargeLimits {
	maxAcChargePowerW: number | null;
	minCurrentA: number | null;
	maxCurrentA: number | null;
	phases: number | null;

	ready: boolean;
	source: string;
	reasons: string[];
}

export interface EvccVehicleDetection {
	evccVehicleId: string | null;
	evccVehicleName: string | null;
}

export const VEHICLE_REASON_CODES = {
	profileMissing: "vehicle_profile_missing",
	profileDisabled: "vehicle_profile_disabled",
	profileInvalid: "vehicle_profile_invalid",
	idInvalid: "vehicle_id_invalid",
	resolutionAmbiguous: "vehicle_resolution_ambiguous",
	notConnected: "vehicle_not_connected",
	socUnavailable: "vehicle_soc_unavailable",
	capacityUnavailable: "vehicle_capacity_unavailable",
	chargeLimitsUnavailable: "vehicle_charge_limits_unavailable",
	targetSocUnavailable: "vehicle_target_soc_unavailable",
	evccMappingMissing: "vehicle_evcc_mapping_missing",
	manualSelectionInvalid: "vehicle_manual_selection_invalid",
	unknown: "vehicle_unknown",
	guestExplicit: "vehicle_guest_explicit",
	singleEnabledProfile: "vehicle_single_enabled_profile",
	evccMatch: "vehicle_evcc_match",
	manualMatch: "vehicle_manual_match",
	disconnected: "vehicle_disconnected",
} as const;
