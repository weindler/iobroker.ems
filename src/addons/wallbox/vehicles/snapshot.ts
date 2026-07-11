import type {
	ActiveVehicleResolution,
	ActiveVehicleSnapshot,
	VehicleTelemetryValues,
	WallboxVehicleProfile,
	WallboxVehicleProfileReadiness,
} from "./types";
import { VEHICLE_REASON_CODES } from "./types";
import { assessWallboxVehicleProfileReadiness } from "./readiness";

export interface BuildActiveVehicleSnapshotInput {
	resolution: ActiveVehicleResolution;
	profile: WallboxVehicleProfile | null;
	readiness: WallboxVehicleProfileReadiness | null;
	telemetry: VehicleTelemetryValues;
	now: Date;
}

export function buildActiveVehicleSnapshot(input: BuildActiveVehicleSnapshotInput): ActiveVehicleSnapshot {
	const { resolution, profile, readiness, telemetry, now } = input;
	const reasons = [...resolution.reasons];

	const connected = telemetry.connected === true;
	const charging = telemetry.charging === true;
	const profileResolved = resolution.profileResolved;
	const activeForCharging = resolution.activeForCharging;

	if (!profileResolved || !profile) {
		if (!reasons.includes(VEHICLE_REASON_CODES.unknown)) {
			reasons.push(VEHICLE_REASON_CODES.unknown);
		}
		return {
			profileResolved: false,
			activeForCharging: false,
			vehicleId: resolution.vehicleId || null,
			displayName: resolution.displayName,
			source: resolution.source,
			connected,
			charging,
			socPct: telemetry.socPct,
			socSource: telemetry.socSource,
			socQuality: telemetry.socQuality,
			rangeKm: telemetry.rangeKm,
			batteryCapacityNetKwh: null,
			maxAcChargePowerW: null,
			supportedPhases: [],
			preferredPhases: null,
			minCurrentA: null,
			maxCurrentA: null,
			defaultTargetSocPct: null,
			minimumDepartureSocPct: null,
			maximumSocPct: null,
			chargeEfficiencyPct: null,
			planningCapability: "insufficient",
			reasons,
			createdAt: now.toISOString(),
		};
	}

	if (profile.isGuest) {
		reasons.push(VEHICLE_REASON_CODES.guestExplicit);
	}

	const planningCapability = readiness?.planningCapability ?? "insufficient";
	if (planningCapability === "insufficient") {
		reasons.push(VEHICLE_REASON_CODES.profileInvalid);
	}
	if (telemetry.socPct === null && !profile.isGuest) {
		if (!reasons.includes(VEHICLE_REASON_CODES.socUnavailable)) {
			reasons.push(VEHICLE_REASON_CODES.socUnavailable);
		}
	}
	if (profile.batteryCapacityNetKwh === null && !profile.isGuest) {
		if (!reasons.includes(VEHICLE_REASON_CODES.capacityUnavailable)) {
			reasons.push(VEHICLE_REASON_CODES.capacityUnavailable);
		}
	}
	if (!connected && profileResolved) {
		if (!reasons.includes(VEHICLE_REASON_CODES.notConnected)) {
			reasons.push(VEHICLE_REASON_CODES.notConnected);
		}
	}

	return {
		profileResolved: true,
		activeForCharging,
		vehicleId: profile.vehicleId,
		displayName: profile.displayName,
		source: resolution.source,
		connected,
		charging,
		socPct: telemetry.socPct,
		socSource: telemetry.socSource,
		socQuality: telemetry.socQuality,
		rangeKm: telemetry.rangeKm,
		batteryCapacityNetKwh: profile.batteryCapacityNetKwh,
		maxAcChargePowerW: profile.maxAcChargePowerW,
		supportedPhases: [...profile.supportedPhases],
		preferredPhases: profile.preferredPhases,
		minCurrentA: profile.minCurrentA,
		maxCurrentA: profile.maxCurrentA,
		defaultTargetSocPct: profile.defaultTargetSocPct,
		minimumDepartureSocPct: profile.minimumDepartureSocPct,
		maximumSocPct: profile.maximumSocPct,
		chargeEfficiencyPct: profile.chargeEfficiencyPct,
		planningCapability,
		reasons: [...new Set(reasons)],
		createdAt: now.toISOString(),
	};
}

export function activeVehicleSnapshotJson(snapshot: ActiveVehicleSnapshot): string {
	return JSON.stringify(snapshot);
}

export function assessActiveProfileReadiness(
	profile: WallboxVehicleProfile,
	telemetry: VehicleTelemetryValues,
	invalidFields: string[] = [],
): WallboxVehicleProfileReadiness {
	return assessWallboxVehicleProfileReadiness(profile, telemetry, invalidFields);
}
