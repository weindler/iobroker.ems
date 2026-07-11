import type { TelemetryField } from "../normalize";
import type { EvccTelemetrySnapshot } from "../evcc_telemetry";
import type {
	ActiveVehicleDetectionStatus,
	ActiveVehicleResolution,
	ActiveVehicleSource,
	EvccVehicleDetection,
	WallboxVehicleProfile,
} from "./types";
import { VEHICLE_REASON_CODES } from "./types";
import { evccTokensMatch } from "./vehicle_id";

export interface ResolveActiveVehicleInput {
	profiles: WallboxVehicleProfile[];
	configuredManualVehicleId: string | null;
	evccDetection: EvccVehicleDetection;
	evccConnected: boolean | null;
	nowIso: string;
}

interface ProfileIdentityResolution {
	profileResolved: boolean;
	vehicleId: string | null;
	displayName: string | null;
	source: ActiveVehicleSource;
	detectionStatus: ActiveVehicleDetectionStatus;
	confidence: number;
	reasons: string[];
}

function profileMatchesEvcc(profile: WallboxVehicleProfile, detection: EvccVehicleDetection): boolean {
	if (!profile.enabled) return false;
	if (profile.source !== "evcc" && profile.source !== "hybrid") return false;
	if (profile.evccVehicleId && detection.evccVehicleId) {
		return evccTokensMatch(profile.evccVehicleId, detection.evccVehicleId);
	}
	if (profile.evccVehicleName && detection.evccVehicleName) {
		return evccTokensMatch(profile.evccVehicleName, detection.evccVehicleName);
	}
	return false;
}

function findByManualId(profiles: WallboxVehicleProfile[], manualId: string | null): WallboxVehicleProfile | null {
	if (!manualId) return null;
	const match = profiles.find((p) => p.enabled && p.vehicleId === manualId);
	return match ?? null;
}

function enabledProfiles(profiles: WallboxVehicleProfile[]): WallboxVehicleProfile[] {
	return profiles.filter((p) => p.enabled);
}

function resolveByEvcc(profiles: WallboxVehicleProfile[], detection: EvccVehicleDetection): WallboxVehicleProfile[] {
	return profiles.filter((p) => profileMatchesEvcc(p, detection));
}

function resolveBySingleEnabled(profiles: WallboxVehicleProfile[]): WallboxVehicleProfile | null {
	const enabled = enabledProfiles(profiles);
	if (enabled.length === 1) return enabled[0]!;
	return null;
}

function resolveProfileIdentity(
	profiles: WallboxVehicleProfile[],
	configuredManualVehicleId: string | null,
	evccDetection: EvccVehicleDetection,
): ProfileIdentityResolution {
	const manualSanitized = configuredManualVehicleId?.trim() || null;

	const evccMatches = resolveByEvcc(profiles, evccDetection);
	if (evccMatches.length > 1) {
		return {
			profileResolved: false,
			vehicleId: "",
			displayName: null,
			source: "unknown",
			detectionStatus: "ambiguous",
			confidence: 0,
			reasons: [VEHICLE_REASON_CODES.resolutionAmbiguous],
		};
	}
	if (evccMatches.length === 1) {
		const p = evccMatches[0]!;
		return {
			profileResolved: true,
			vehicleId: p.vehicleId,
			displayName: p.displayName,
			source: "evcc",
			detectionStatus: "resolved",
			confidence: 0.95,
			reasons: [VEHICLE_REASON_CODES.evccMatch],
		};
	}

	if (manualSanitized) {
		const manualMatch = findByManualId(profiles, manualSanitized);
		if (!manualMatch) {
			return {
				profileResolved: false,
				vehicleId: null,
				displayName: null,
				source: "unknown",
				detectionStatus: "invalid_manual",
				confidence: 0,
				reasons: [VEHICLE_REASON_CODES.manualSelectionInvalid],
			};
		}
		if (manualMatch.isGuest) {
			return {
				profileResolved: true,
				vehicleId: manualMatch.vehicleId,
				displayName: manualMatch.displayName,
				source: "guest",
				detectionStatus: "resolved",
				confidence: 0.7,
				reasons: [VEHICLE_REASON_CODES.guestExplicit],
			};
		}
		return {
			profileResolved: true,
			vehicleId: manualMatch.vehicleId,
			displayName: manualMatch.displayName,
			source: "manual",
			detectionStatus: "resolved",
			confidence: 0.75,
			reasons: [VEHICLE_REASON_CODES.manualMatch],
		};
	}

	const single = resolveBySingleEnabled(profiles);
	if (single) {
		const source: ActiveVehicleSource = single.isGuest ? "guest" : "single_enabled_profile";
		return {
			profileResolved: true,
			vehicleId: single.vehicleId,
			displayName: single.displayName,
			source,
			detectionStatus: "resolved",
			confidence: 0.6,
			reasons: [VEHICLE_REASON_CODES.singleEnabledProfile],
		};
	}

	const enabled = enabledProfiles(profiles);
	if (enabled.length === 0) {
		return {
			profileResolved: false,
			vehicleId: null,
			displayName: null,
			source: "unknown",
			detectionStatus: "no_profile",
			confidence: 0,
			reasons: [VEHICLE_REASON_CODES.profileMissing],
		};
	}

	return {
		profileResolved: false,
		vehicleId: "",
		displayName: null,
		source: "unknown",
		detectionStatus: "ambiguous",
		confidence: 0,
		reasons: [VEHICLE_REASON_CODES.resolutionAmbiguous, VEHICLE_REASON_CODES.unknown],
	};
}

/** Priority: EVCC match → manual fallback → single enabled profile → unknown/ambiguous. Connection is applied separately. */
export function resolveActiveVehicle(input: ResolveActiveVehicleInput): ActiveVehicleResolution {
	const identity = resolveProfileIdentity(
		input.profiles,
		input.configuredManualVehicleId,
		input.evccDetection,
	);
	const connected = input.evccConnected === true;
	const activeForCharging = identity.profileResolved && connected;
	const reasons = [...identity.reasons];

	let detectionStatus = identity.detectionStatus;
	if (identity.profileResolved && !connected) {
		detectionStatus = "disconnected";
		if (!reasons.includes(VEHICLE_REASON_CODES.notConnected)) {
			reasons.push(VEHICLE_REASON_CODES.notConnected);
		}
		if (!reasons.includes(VEHICLE_REASON_CODES.disconnected)) {
			reasons.push(VEHICLE_REASON_CODES.disconnected);
		}
	} else if (identity.profileResolved && connected) {
		detectionStatus = "resolved";
	}

	return {
		profileResolved: identity.profileResolved,
		vehicleId: identity.vehicleId,
		displayName: identity.displayName,
		source: identity.source,
		detectionStatus,
		confidence: identity.confidence,
		configuredManualVehicleId: input.configuredManualVehicleId?.trim() || null,
		connected: input.evccConnected,
		activeForCharging,
		reasons,
	};
}

export function pickEvccConnected(snap: EvccTelemetrySnapshot): boolean | null {
	const f = snap.connected;
	if (f.status === "valid" && typeof f.value === "boolean") return f.value;
	return null;
}

export function pickTelemetryFieldBool(field: TelemetryField<boolean>): boolean | null {
	if (field.status === "valid" && typeof field.value === "boolean") return field.value;
	return null;
}

export function pickTelemetryFieldNumber(field: TelemetryField<number>): number | null {
	if (field.status === "valid" && typeof field.value === "number" && Number.isFinite(field.value)) {
		return field.value;
	}
	return null;
}
