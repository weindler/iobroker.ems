import { setStateIfChanged } from "../../../policy/core/state_write";
import type { StateHost } from "../../../ems_light/state_util";
import type { EvccTelemetrySnapshot } from "../evcc_telemetry";
import {
	configuredVehicleDetectionStateIds,
	configuredVehicleTelemetryStateIds,
	wallboxVehicleProfilesConfigFromAdapter,
	type WallboxVehicleProfilesConfig,
} from "./config";
import { ensureWallboxVehicleProfileStates, vehicleStatePaths } from "./ensure_states";
import { normalizeWallboxVehicleProfile, normalizeWallboxVehicleProfiles } from "./normalize";
import { assessWallboxVehicleProfileReadiness } from "./readiness";
import { resolveActiveVehicle, pickEvccConnected } from "./resolve";
import {
	activeVehicleSnapshotJson,
	assessActiveProfileReadiness,
	buildActiveVehicleSnapshot,
} from "./snapshot";
import { mergeProfileTelemetryReadings, profileTelemetryFromForeignReads, emptyProfileTelemetry } from "./soc";
import type {
	ActiveVehicleSnapshot,
	EvccVehicleDetection,
	VehicleTelemetryValues,
	WallboxVehicleProfile,
} from "./types";
import { WALLBOX_RUNTIME_STATES } from "../runtime/states";

type VehicleRuntimeHost = StateHost & {
	getForeignStateAsync?: (objectId: string) => Promise<ioBroker.State | null | undefined>;
};

async function readForeign(
	host: VehicleRuntimeHost,
	objectId: string,
): Promise<{ val: unknown; ts?: number } | null> {
	if (!objectId) return null;
	if (host.getForeignStateAsync) {
		const st = await host.getForeignStateAsync(objectId);
		if (!st || st.val === undefined) return null;
		return { val: st.val, ts: st.ts };
	}
	const st = await host.getStateAsync(objectId);
	if (!st || st.val === undefined) return null;
	return { val: st.val, ts: st.ts };
}

async function readEvccDetection(
	host: VehicleRuntimeHost,
	cfg: WallboxVehicleProfilesConfig,
): Promise<EvccVehicleDetection> {
	const idRead = cfg.evccVehicleIdStateId ? await readForeign(host, cfg.evccVehicleIdStateId) : null;
	const nameRead = cfg.evccVehicleNameStateId ? await readForeign(host, cfg.evccVehicleNameStateId) : null;
	return {
		evccVehicleId: idRead?.val != null ? String(idRead.val).trim() : null,
		evccVehicleName: nameRead?.val != null ? String(nameRead.val).trim() : null,
	};
}

async function publishVehicleStates(
	host: VehicleRuntimeHost,
	profile: WallboxVehicleProfile,
	telemetry: VehicleTelemetryValues,
	readiness: ReturnType<typeof assessWallboxVehicleProfileReadiness>,
	active: boolean,
	resolutionSource: string,
	confidence: number,
	invalidFields: string[],
): Promise<void> {
	const p = vehicleStatePaths(profile.vehicleId);
	await setStateIfChanged(host, p.configDisplayName, profile.displayName);
	await setStateIfChanged(host, p.configEnabled, profile.enabled);
	await setStateIfChanged(host, p.configSource, profile.source);
	await setStateIfChanged(host, p.configBatteryCapacityNetKwh, profile.batteryCapacityNetKwh ?? "");
	await setStateIfChanged(host, p.configMaxAcChargePowerW, profile.maxAcChargePowerW ?? "");
	await setStateIfChanged(host, p.configSupportedPhasesJson, JSON.stringify(profile.supportedPhases));
	await setStateIfChanged(host, p.configPreferredPhases, profile.preferredPhases ?? "");
	await setStateIfChanged(host, p.configMinCurrentA, profile.minCurrentA ?? "");
	await setStateIfChanged(host, p.configMaxCurrentA, profile.maxCurrentA ?? "");
	await setStateIfChanged(host, p.configDefaultTargetSocPct, profile.defaultTargetSocPct ?? "");
	await setStateIfChanged(host, p.configMinimumDepartureSocPct, profile.minimumDepartureSocPct ?? "");
	await setStateIfChanged(host, p.configMaximumSocPct, profile.maximumSocPct ?? "");
	await setStateIfChanged(host, p.configChargeEfficiencyPct, profile.chargeEfficiencyPct ?? "");

	await setStateIfChanged(host, p.telemetryConnected, telemetry.connected ?? "");
	await setStateIfChanged(host, p.telemetryCharging, telemetry.charging ?? "");
	await setStateIfChanged(host, p.telemetrySocPct, telemetry.socPct ?? "");
	await setStateIfChanged(host, p.telemetrySocSource, telemetry.socSource);
	await setStateIfChanged(host, p.telemetrySocQuality, telemetry.socQuality ?? "");
	await setStateIfChanged(host, p.telemetryRangeKm, telemetry.rangeKm ?? "");
	await setStateIfChanged(host, p.telemetrySessionEnergyKwh, telemetry.sessionEnergyKwh ?? "");
	await setStateIfChanged(host, p.telemetryLastUpdate, telemetry.lastUpdate ?? "");
	await setStateIfChanged(host, p.telemetryStale, telemetry.stale);

	await setStateIfChanged(host, p.planningCapability, readiness.planningCapability);
	await setStateIfChanged(host, p.planningRequiredEnergyKwh, "");
	await setStateIfChanged(host, p.planningPlannedTargetSocPct, "");
	await setStateIfChanged(host, p.planningDepartureTime, "");

	await setStateIfChanged(host, p.runtimeProfileValid, readiness.profileValid);
	await setStateIfChanged(host, p.runtimeTelemetryReady, readiness.telemetryReady);
	await setStateIfChanged(host, p.runtimePlanningReady, readiness.planningReady);
	await setStateIfChanged(host, p.runtimeActive, active);
	await setStateIfChanged(host, p.runtimeDetectionSource, active ? resolutionSource : "");
	await setStateIfChanged(host, p.runtimeDetectionConfidence, active ? confidence : 0);
	await setStateIfChanged(host, p.runtimeMissingFieldsJson, JSON.stringify(readiness.missingFields));
	await setStateIfChanged(host, p.runtimeInvalidFieldsJson, JSON.stringify(invalidFields));
	await setStateIfChanged(host, p.runtimeStatus, active ? "active" : profile.enabled ? "idle" : "disabled");
}

async function publishGlobalVehicleRuntime(
	host: VehicleRuntimeHost,
	snapshot: ActiveVehicleSnapshot,
	resolution: ReturnType<typeof resolveActiveVehicle>,
	profileCount: number,
	enabledCount: number,
): Promise<void> {
	const resolvedId = resolution.profileResolved ? (resolution.vehicleId ?? "") : "";
	await setStateIfChanged(host, WALLBOX_RUNTIME_STATES.activeVehicleId, resolvedId);
	await setStateIfChanged(
		host,
		WALLBOX_RUNTIME_STATES.activeVehicleName,
		resolution.profileResolved ? (snapshot.displayName ?? "") : "",
	);
	await setStateIfChanged(host, WALLBOX_RUNTIME_STATES.activeVehicleSource, resolution.source);
	await setStateIfChanged(
		host,
		WALLBOX_RUNTIME_STATES.activeVehicleDetectionStatus,
		resolution.detectionStatus,
	);
	await setStateIfChanged(host, WALLBOX_RUNTIME_STATES.activeVehicleConfidence, resolution.confidence);
	await setStateIfChanged(host, WALLBOX_RUNTIME_STATES.activeVehicleSnapshotJson, activeVehicleSnapshotJson(snapshot));
	await setStateIfChanged(
		host,
		WALLBOX_RUNTIME_STATES.activeVehicleProfileValid,
		snapshot.profileResolved && snapshot.planningCapability !== "insufficient",
	);
	await setStateIfChanged(
		host,
		WALLBOX_RUNTIME_STATES.activeVehiclePlanningCapability,
		snapshot.planningCapability,
	);
	await setStateIfChanged(host, WALLBOX_RUNTIME_STATES.vehicleProfileCount, profileCount);
	await setStateIfChanged(host, WALLBOX_RUNTIME_STATES.vehicleEnabledProfileCount, enabledCount);
	await setStateIfChanged(
		host,
		WALLBOX_RUNTIME_STATES.vehicleResolutionReason,
		resolution.reasons.join(";") || snapshot.reasons.join(";"),
	);
	await setStateIfChanged(host, WALLBOX_RUNTIME_STATES.vehicleProfileResolved, resolution.profileResolved);
	await setStateIfChanged(host, WALLBOX_RUNTIME_STATES.vehicleActiveForCharging, resolution.activeForCharging);
	await setStateIfChanged(host, WALLBOX_RUNTIME_STATES.vehicleConnected, snapshot.connected);
}

export async function refreshWallboxVehicleRuntime(
	host: VehicleRuntimeHost,
	evccSnap: EvccTelemetrySnapshot,
	config: unknown,
	now: Date = new Date(),
): Promise<ActiveVehicleSnapshot> {
	const cfg = wallboxVehicleProfilesConfigFromAdapter(config);
	const { profiles, errors } = normalizeWallboxVehicleProfiles(cfg.profiles, now.toISOString());

	for (const profile of profiles) {
		try {
			await ensureWallboxVehicleProfileStates(host, [profile]);
		} catch {
			// one profile must not block others
		}
	}

	const evccDetection = await readEvccDetection(host, cfg);
	const evccConnected = pickEvccConnected(evccSnap);
	const resolution = resolveActiveVehicle({
		profiles,
		configuredManualVehicleId: cfg.manualVehicleId,
		evccDetection,
		evccConnected,
		nowIso: now.toISOString(),
	});

	const invalidById = new Map<string, string[]>();
	for (const err of errors) {
		const input = cfg.profiles.find((p) => p.slotIndex === err.slotIndex);
		if (!input) continue;
		const norm = normalizeWallboxVehicleProfile(input, now.toISOString());
		if (norm.profile) invalidById.set(norm.profile.vehicleId, norm.invalidFields);
	}

	let activeProfile: WallboxVehicleProfile | null = null;
	let activeTelemetry: VehicleTelemetryValues | null = null;
	const loadpointConnected = evccConnected === true;

	for (const profile of profiles) {
		const isResolvedProfile =
			resolution.profileResolved && resolution.vehicleId === profile.vehicleId;
		const socRead = profile.socStateId ? await readForeign(host, profile.socStateId) : undefined;
		const rangeRead = profile.rangeStateId ? await readForeign(host, profile.rangeStateId) : undefined;
		const connectedRead = profile.connectedStateId ? await readForeign(host, profile.connectedStateId) : undefined;
		const chargingRead = profile.chargingStateId ? await readForeign(host, profile.chargingStateId) : undefined;
		const sessionEnergyRead = profile.sessionEnergyStateId
			? await readForeign(host, profile.sessionEnergyStateId)
			: undefined;
		const reads = {
			soc: socRead ?? undefined,
			range: rangeRead ?? undefined,
			connected: connectedRead ?? undefined,
			charging: chargingRead ?? undefined,
			sessionEnergy: sessionEnergyRead ?? undefined,
		};
		const raw = profileTelemetryFromForeignReads(profile, reads, now);
		const telemetry = mergeProfileTelemetryReadings(
			profile,
			raw,
			evccSnap,
			isResolvedProfile,
			loadpointConnected,
			now,
		);
		const invalidFields = invalidById.get(profile.vehicleId) ?? [];
		const readiness = assessWallboxVehicleProfileReadiness(profile, telemetry, invalidFields);

		try {
			await publishVehicleStates(
				host,
				profile,
				telemetry,
				readiness,
				isResolvedProfile,
				isResolvedProfile ? resolution.source : "",
				isResolvedProfile ? resolution.confidence : 0,
				invalidFields,
			);
		} catch {
			// isolate profile publish errors
		}

		if (isResolvedProfile) {
			activeProfile = profile;
			activeTelemetry = telemetry;
		}
	}

	if (!activeTelemetry && !resolution.profileResolved) {
		activeTelemetry = {
			connected: evccConnected,
			charging:
				evccSnap.charging.status === "valid" && typeof evccSnap.charging.value === "boolean"
					? evccSnap.charging.value
					: null,
			socPct:
				evccSnap.vehicle_soc_pct.status === "valid" && typeof evccSnap.vehicle_soc_pct.value === "number"
					? evccSnap.vehicle_soc_pct.value
					: null,
			socSource: "evcc_estimated",
			socQuality: "evcc",
			rangeKm: null,
			sessionEnergyKwh:
				evccSnap.session_energy_kwh.status === "valid" &&
				typeof evccSnap.session_energy_kwh.value === "number"
					? evccSnap.session_energy_kwh.value
					: null,
			lastUpdate: now.toISOString(),
			stale: false,
		};
	} else if (!activeTelemetry && resolution.profileResolved) {
		activeTelemetry = {
			connected: loadpointConnected,
			charging: null,
			socPct: null,
			socSource: "unavailable",
			socQuality: null,
			rangeKm: null,
			sessionEnergyKwh: null,
			lastUpdate: now.toISOString(),
			stale: false,
		};
	}

	const telemetryForSnapshot = activeTelemetry ?? emptyProfileTelemetry(now);
	const readiness = activeProfile
		? assessActiveProfileReadiness(
				activeProfile,
				telemetryForSnapshot,
				invalidById.get(activeProfile.vehicleId) ?? [],
			)
		: null;

	const snapshot = buildActiveVehicleSnapshot({
		resolution,
		profile: activeProfile,
		readiness,
		telemetry: telemetryForSnapshot,
		now,
	});

	const enabledCount = profiles.filter((p) => p.enabled).length;
	await publishGlobalVehicleRuntime(host, snapshot, resolution, profiles.length, enabledCount);

	return snapshot;
}

export function collectWallboxVehicleForeignStateIds(config: unknown): string[] {
	const cfg = wallboxVehicleProfilesConfigFromAdapter(config);
	const { profiles } = normalizeWallboxVehicleProfiles(cfg.profiles, new Date(0).toISOString());
	const ids = new Set<string>();
	for (const id of configuredVehicleDetectionStateIds(cfg)) ids.add(id);
	for (const id of configuredVehicleTelemetryStateIds(profiles)) ids.add(id);
	return [...ids];
}

export { ensureWallboxVehicleProfileStates } from "./ensure_states";
