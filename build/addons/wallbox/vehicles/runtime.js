"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureWallboxVehicleProfileStates = exports.collectWallboxVehicleForeignStateIds = exports.refreshWallboxVehicleRuntime = exports.hydrateWallboxVehicleSocPersistence = void 0;
const config_1 = require("./config");
const ensure_states_1 = require("./ensure_states");
const normalize_1 = require("./normalize");
const readiness_1 = require("./readiness");
const resolve_1 = require("./resolve");
const snapshot_1 = require("./snapshot");
const soc_1 = require("./soc");
const soc_energy_1 = require("./soc_energy");
const baseline_1 = require("./baseline");
async function readForeign(host, objectId) {
    if (!objectId)
        return null;
    if (host.getForeignStateAsync) {
        const st = await host.getForeignStateAsync(objectId);
        if (!st || st.val === undefined)
            return null;
        return { val: st.val, ts: st.ts };
    }
    const st = await host.getStateAsync(objectId);
    if (!st || st.val === undefined)
        return null;
    return { val: st.val, ts: st.ts };
}
async function readEvccDetection(host, cfg) {
    const idRead = cfg.evccVehicleIdStateId ? await readForeign(host, cfg.evccVehicleIdStateId) : null;
    const nameRead = cfg.evccVehicleNameStateId ? await readForeign(host, cfg.evccVehicleNameStateId) : null;
    return {
        evccVehicleId: idRead?.val != null ? String(idRead.val).trim() : null,
        evccVehicleName: nameRead?.val != null ? String(nameRead.val).trim() : null,
    };
}
async function readPersistenceFromHost(host, vehicleId) {
    const persistence = (0, baseline_1.getProfileSocPersistence)(vehicleId);
    if (persistence.rollforwardAnchor && persistence.lastTrustedSnapshot)
        return;
    const p = (0, ensure_states_1.vehicleStatePaths)(vehicleId);
    const socSt = await host.getStateAsync(p.estimationBaselineSocPct);
    const sourceSt = await host.getStateAsync(p.estimationBaselineSocSource);
    const atSt = await host.getStateAsync(p.estimationBaselineAt);
    const sessionSt = await host.getStateAsync(p.estimationBaselineSessionEnergyKwh);
    const ltSocSt = await host.getStateAsync(p.estimationLastTrustedSocPct);
    const ltSourceSt = await host.getStateAsync(p.estimationLastTrustedOriginalSource);
    const ltAtSt = await host.getStateAsync(p.estimationLastTrustedObservedAt);
    (0, baseline_1.hydrateProfileSocPersistenceFromLegacyStates)(vehicleId, {
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
async function hydrateWallboxVehicleSocPersistence(host, config, now = new Date()) {
    const cfg = (0, config_1.wallboxVehicleProfilesConfigFromAdapter)(config);
    const { profiles } = (0, normalize_1.normalizeWallboxVehicleProfiles)(cfg.profiles, now.toISOString());
    for (const profile of profiles) {
        await readPersistenceFromHost(host, profile.vehicleId);
    }
}
exports.hydrateWallboxVehicleSocPersistence = hydrateWallboxVehicleSocPersistence;
async function publishSocEnergyStates(_host, _vehicleId, _resolution) {
    return;
}
async function publishVehicleStates(_host, _profile, _telemetry, _readiness, _active, _resolutionSource, _confidence, _invalidFields, _socEnergy) {
    return;
}
async function publishGlobalVehicleRuntime(_host, _snapshot, _resolution, _profileCount, _enabledCount, _activeSocEnergy) {
    /* Fahrzeugprofil-Spiegel liegen nicht mehr auf der öffentlichen Runtime-Fläche. */
}
async function refreshWallboxVehicleRuntime(host, evccSnap, config, now = new Date()) {
    const cfg = (0, config_1.wallboxVehicleProfilesConfigFromAdapter)(config);
    const { profiles, errors } = (0, normalize_1.normalizeWallboxVehicleProfiles)(cfg.profiles, now.toISOString());
    const evccDetection = await readEvccDetection(host, cfg);
    const evccConnected = (0, resolve_1.pickEvccConnected)(evccSnap);
    const resolution = (0, resolve_1.resolveActiveVehicle)({
        profiles,
        configuredManualVehicleId: cfg.manualVehicleId,
        evccDetection,
        evccConnected,
        nowIso: now.toISOString(),
    });
    const invalidById = new Map();
    for (const err of errors) {
        const input = cfg.profiles.find((p) => p.slotIndex === err.slotIndex);
        if (!input)
            continue;
        const norm = (0, normalize_1.normalizeWallboxVehicleProfile)(input, now.toISOString());
        if (norm.profile)
            invalidById.set(norm.profile.vehicleId, norm.invalidFields);
    }
    let activeProfile = null;
    let activeTelemetry = null;
    let activeSocEnergy = null;
    const loadpointConnected = evccConnected === true;
    for (const profile of profiles) {
        await readPersistenceFromHost(host, profile.vehicleId);
        const isResolvedProfile = resolution.profileResolved && resolution.vehicleId === profile.vehicleId;
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
        const raw = (0, soc_1.profileTelemetryFromForeignReads)(profile, reads, now);
        const telemetry = (0, soc_1.mergeProfileTelemetryReadings)(profile, raw, evccSnap, isResolvedProfile, loadpointConnected, now);
        const invalidFields = invalidById.get(profile.vehicleId) ?? [];
        const readiness = (0, readiness_1.assessWallboxVehicleProfileReadiness)(profile, telemetry, invalidFields);
        const rollforwardAnchor = (0, baseline_1.getRollforwardAnchor)(profile.vehicleId);
        const lastTrustedSnapshot = (0, baseline_1.getLastTrustedSnapshot)(profile.vehicleId);
        const socEnergyInput = (0, soc_energy_1.buildSocEnergyInput)(profile.vehicleId, profile, telemetry, raw, rollforwardAnchor, lastTrustedSnapshot, now);
        const socEnergy = (0, soc_energy_1.resolveVehicleSocAndEnergy)(socEnergyInput);
        (0, baseline_1.updateProfileSocPersistenceAfterResolution)(profile.vehicleId, socEnergy, telemetry.sessionEnergyKwh, now);
        try {
            await publishVehicleStates(host, profile, telemetry, readiness, isResolvedProfile, isResolvedProfile ? resolution.source : "", isResolvedProfile ? resolution.confidence : 0, invalidFields, socEnergy);
        }
        catch {
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
            charging: evccSnap.charging.status === "valid" && typeof evccSnap.charging.value === "boolean"
                ? evccSnap.charging.value
                : null,
            socPct: evccSnap.vehicle_soc_pct.status === "valid" && typeof evccSnap.vehicle_soc_pct.value === "number"
                ? evccSnap.vehicle_soc_pct.value
                : null,
            socSource: "evcc_estimated",
            socQuality: "evcc",
            rangeKm: null,
            sessionEnergyKwh: evccSnap.session_energy_kwh.status === "valid" &&
                typeof evccSnap.session_energy_kwh.value === "number"
                ? evccSnap.session_energy_kwh.value
                : null,
            lastUpdate: now.toISOString(),
            stale: false,
        };
    }
    else if (!activeTelemetry && resolution.profileResolved) {
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
    const telemetryForSnapshot = activeTelemetry ?? (0, soc_1.emptyProfileTelemetry)(now);
    const readiness = activeProfile
        ? (0, snapshot_1.assessActiveProfileReadiness)(activeProfile, telemetryForSnapshot, invalidById.get(activeProfile.vehicleId) ?? [])
        : null;
    const snapshot = (0, snapshot_1.buildActiveVehicleSnapshot)({
        resolution,
        profile: activeProfile,
        readiness,
        telemetry: telemetryForSnapshot,
        now,
    });
    const enabledCount = profiles.filter((p) => p.enabled).length;
    await publishGlobalVehicleRuntime(host, snapshot, resolution, profiles.length, enabledCount, activeSocEnergy);
    return snapshot;
}
exports.refreshWallboxVehicleRuntime = refreshWallboxVehicleRuntime;
function collectWallboxVehicleForeignStateIds(config) {
    const cfg = (0, config_1.wallboxVehicleProfilesConfigFromAdapter)(config);
    const { profiles } = (0, normalize_1.normalizeWallboxVehicleProfiles)(cfg.profiles, new Date(0).toISOString());
    const ids = new Set();
    for (const id of (0, config_1.configuredVehicleDetectionStateIds)(cfg))
        ids.add(id);
    for (const id of (0, config_1.configuredVehicleTelemetryStateIds)(profiles))
        ids.add(id);
    return [...ids];
}
exports.collectWallboxVehicleForeignStateIds = collectWallboxVehicleForeignStateIds;
var ensure_states_2 = require("./ensure_states");
Object.defineProperty(exports, "ensureWallboxVehicleProfileStates", { enumerable: true, get: function () { return ensure_states_2.ensureWallboxVehicleProfileStates; } });
