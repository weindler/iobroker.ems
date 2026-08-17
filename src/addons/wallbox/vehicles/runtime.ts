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
	assessActiveProfileReadiness,
	buildActiveVehicleSnapshot,
} from "./snapshot";
import { mergeProfileTelemetryReadings, profileTelemetryFromForeignReads, emptyProfileTelemetry } from "./soc";
import {
	buildSocEnergyInput,
	resolveVehicleSocAndEnergy,
	roundPublishedEnergyKwh,
	roundPublishedSocPct,
} from "./soc_energy";
import {
	getLastTrustedSnapshot,
	getProfileSocPersistence,
	getRollforwardAnchor,
	hydrateProfileSocPersistenceFromLegacyStates,
	updateProfileSocPersistenceAfterResolution,
} from "./baseline";
import type {
	ActiveVehicleSnapshot,
	EvccVehicleDetection,
	VehicleSocEnergyResolution,
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

async function readPersistenceFromHost(
	host: VehicleRuntimeHost,
	vehicleId: string,
): Promise<void> {
	const persistence = getProfileSocPersistence(vehicleId);
	if (persistence.rollforwardAnchor && persistence.lastTrustedSnapshot) return;
	const p = vehicleStatePaths(vehicleId);
	const socSt = await host.getStateAsync(p.estimationBaselineSocPct);
	const sourceSt = await host.getStateAsync(p.estimationBaselineSocSource);
	const atSt = await host.getStateAsync(p.estimationBaselineAt);
	const sessionSt = await host.getStateAsync(p.estimationBaselineSessionEnergyKwh);
	const ltSocSt = await host.getStateAsync(p.estimationLastTrustedSocPct);
	const ltSourceSt = await host.getStateAsync(p.estimationLastTrustedOriginalSource);
	const ltAtSt = await host.getStateAsync(p.estimationLastTrustedObservedAt);
	hydrateProfileSocPersistenceFromLegacyStates(vehicleId, {
		baselineSocPct: socSt?.val,
		baselineSocSource: sourceSt?.val,
		baselineAt: atSt?.val,
		sessionEnergyKwh: sessionSt?.val,
		lastTrustedSocPct: ltSocSt?.val,
		lastTrustedOriginalSource: ltSourceSt?.val,
		lastTrustedObservedAt: ltAtSt?.val,
	});
}

/**
 * Phase D — Rollforward-Anker, Last-Trusted-Snapshot und Session-Zähler aus States laden.
 * Läuft vor der ersten SOC-Auflösung und ohne Fremd-Telemetrie-Lesezugriffe.
 */
export async function hydrateWallboxVehicleSocPersistence(
	host: VehicleRuntimeHost,
	config: unknown,
	now: Date = new Date(),
): Promise<void> {
	const cfg = wallboxVehicleProfilesConfigFromAdapter(config);
	const { profiles } = normalizeWallboxVehicleProfiles(cfg.profiles, now.toISOString());
	for (const profile of profiles) {
		await readPersistenceFromHost(host, profile.vehicleId);
	}
}

async function publishSocEnergyStates(
	_host: VehicleRuntimeHost,
	_vehicleId: string,
	_resolution: VehicleSocEnergyResolution,
): Promise<void> {
	return;
}

async function publishVehicleStates(
	_host: VehicleRuntimeHost,
	_profile: WallboxVehicleProfile,
	_telemetry: VehicleTelemetryValues,
	_readiness: ReturnType<typeof assessWallboxVehicleProfileReadiness>,
	_active: boolean,
	_resolutionSource: string,
	_confidence: number,
	_invalidFields: string[],
	_socEnergy: VehicleSocEnergyResolution,
): Promise<void> {
	return;
}

async function publishGlobalVehicleRuntime(
	_host: VehicleRuntimeHost,
	_snapshot: ActiveVehicleSnapshot,
	_resolution: ReturnType<typeof resolveActiveVehicle>,
	_profileCount: number,
	_enabledCount: number,
	_activeSocEnergy: VehicleSocEnergyResolution | null,
): Promise<void> {
	/* Fahrzeugprofil-Spiegel liegen nicht mehr auf der öffentlichen Runtime-Fläche. */
}

export async function refreshWallboxVehicleRuntime(
	host: VehicleRuntimeHost,
	evccSnap: EvccTelemetrySnapshot,
	config: unknown,
	now: Date = new Date(),
): Promise<ActiveVehicleSnapshot> {
	const cfg = wallboxVehicleProfilesConfigFromAdapter(config);
	const { profiles, errors } = normalizeWallboxVehicleProfiles(cfg.profiles, now.toISOString());

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
	let activeSocEnergy: VehicleSocEnergyResolution | null = null;
	const loadpointConnected = evccConnected === true;

	for (const profile of profiles) {
		await readPersistenceFromHost(host, profile.vehicleId);
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
		const rollforwardAnchor = getRollforwardAnchor(profile.vehicleId);
		const lastTrustedSnapshot = getLastTrustedSnapshot(profile.vehicleId);
		const socEnergyInput = buildSocEnergyInput(
			profile.vehicleId,
			profile,
			telemetry,
			raw,
			rollforwardAnchor,
			lastTrustedSnapshot,
			now,
		);
		const socEnergy = resolveVehicleSocAndEnergy(socEnergyInput);
		updateProfileSocPersistenceAfterResolution(
			profile.vehicleId,
			socEnergy,
			telemetry.sessionEnergyKwh,
			now,
		);

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
				socEnergy,
			);
		} catch {
			// isolate profile publish errors
		}

		if (isResolvedProfile) {
			activeProfile = profile;
			activeTelemetry = telemetry;
			activeSocEnergy = socEnergy;
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
	await publishGlobalVehicleRuntime(
		host,
		snapshot,
		resolution,
		profiles.length,
		enabledCount,
		activeSocEnergy,
	);

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
