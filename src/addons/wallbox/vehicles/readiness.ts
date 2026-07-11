import type {
	VehiclePlanningCapability,
	VehicleTelemetryValues,
	WallboxVehicleProfile,
	WallboxVehicleProfileReadiness,
} from "./types";
import { VEHICLE_REASON_CODES } from "./types";

function hasChargeLimits(profile: WallboxVehicleProfile): boolean {
	return (
		profile.maxAcChargePowerW !== null ||
		profile.minCurrentA !== null ||
		profile.maxCurrentA !== null ||
		profile.supportedPhases.length > 0 ||
		profile.preferredPhases !== null
	);
}

export function derivePlanningCapability(
	profile: WallboxVehicleProfile,
	telemetry: Pick<VehicleTelemetryValues, "socPct">,
): VehiclePlanningCapability {
	const socAvailable = telemetry.socPct !== null;
	const capacityAvailable = profile.batteryCapacityNetKwh !== null;
	const limitsAvailable = hasChargeLimits(profile);

	if (socAvailable && capacityAvailable) {
		return "soc_and_capacity";
	}
	if (capacityAvailable) {
		return "energy_only";
	}
	if (limitsAvailable) {
		return "limits_only";
	}
	return "insufficient";
}

export function assessWallboxVehicleProfileReadiness(
	profile: WallboxVehicleProfile,
	telemetry: VehicleTelemetryValues,
	invalidFields: string[] = [],
): WallboxVehicleProfileReadiness {
	const missingFields: string[] = [];
	const invalid = [...invalidFields];
	const reasons: string[] = [];

	if (!profile.enabled) {
		reasons.push(VEHICLE_REASON_CODES.profileDisabled);
	}

	const profileValid = invalid.length === 0 && profile.vehicleId.length > 0;
	if (!profileValid) {
		reasons.push(VEHICLE_REASON_CODES.profileInvalid);
	}

	const connectedKnown = telemetry.connected !== null;
	const chargingKnown = telemetry.charging !== null;
	const socAvailable = telemetry.socPct !== null;
	const capacityAvailable = profile.batteryCapacityNetKwh !== null;
	const chargeLimitsAvailable = hasChargeLimits(profile);

	if (!socAvailable && profileValid) {
		missingFields.push("socPct");
		reasons.push(VEHICLE_REASON_CODES.socUnavailable);
	}
	if (!capacityAvailable && profileValid && !profile.isGuest) {
		missingFields.push("batteryCapacityNetKwh");
	}
	if (!chargeLimitsAvailable && profileValid) {
		missingFields.push("chargeLimits");
		reasons.push(VEHICLE_REASON_CODES.chargeLimitsUnavailable);
	}
	if (
		profile.defaultTargetSocPct === null &&
		profile.minimumDepartureSocPct === null &&
		profileValid &&
		!profile.isGuest
	) {
		missingFields.push("targetSoc");
	}

	const telemetryReady =
		profileValid &&
		connectedKnown &&
		(chargingKnown || !profile.chargingStateId) &&
		(socAvailable || profile.isGuest || profile.source === "manual");

	const planningCapability = derivePlanningCapability(profile, telemetry);
	const planningReady =
		profileValid &&
		telemetryReady &&
		planningCapability !== "insufficient" &&
		!(telemetry.connected === false);

	return {
		profileValid,
		telemetryReady,
		planningReady,
		socAvailable,
		capacityAvailable,
		chargeLimitsAvailable,
		planningCapability,
		missingFields,
		invalidFields: invalid,
		reasons,
	};
}
