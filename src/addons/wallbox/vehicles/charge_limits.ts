import type { ActiveVehicleChargeLimits, ActiveVehicleSnapshot } from "./types";
import { VEHICLE_REASON_CODES } from "./types";

export function resolveActiveVehicleChargeLimits(snapshot: ActiveVehicleSnapshot): ActiveVehicleChargeLimits {
	const reasons: string[] = [];

	if (!snapshot.profileResolved) {
		reasons.push(VEHICLE_REASON_CODES.unknown);
		return {
			maxAcChargePowerW: null,
			minCurrentA: null,
			maxCurrentA: null,
			phases: null,
			ready: false,
			source: snapshot.source,
			reasons,
		};
	}

	const hasPower = snapshot.maxAcChargePowerW !== null;
	const hasCurrent = snapshot.minCurrentA !== null || snapshot.maxCurrentA !== null;
	const hasPhases = snapshot.supportedPhases.length > 0 || snapshot.preferredPhases !== null;

	if (!hasPower && !hasCurrent && !hasPhases) {
		reasons.push(VEHICLE_REASON_CODES.chargeLimitsUnavailable);
		return {
			maxAcChargePowerW: null,
			minCurrentA: null,
			maxCurrentA: null,
			phases: null,
			ready: false,
			source: "profile",
			reasons,
		};
	}

	const phases =
		snapshot.preferredPhases ??
		(snapshot.supportedPhases.length === 1 ? snapshot.supportedPhases[0]! : null);

	return {
		maxAcChargePowerW: snapshot.maxAcChargePowerW,
		minCurrentA: snapshot.minCurrentA,
		maxCurrentA: snapshot.maxCurrentA,
		phases,
		ready: true,
		source: "profile",
		reasons,
	};
}
