"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureWallboxVehicleProfileStates = exports.collectWallboxVehicleForeignStateIds = exports.refreshWallboxVehicleRuntime = exports.hydrateWallboxVehicleSocPersistence = void 0;
const state_write_1 = require("../../../policy/core/state_write");
const config_1 = require("./config");
const ensure_states_1 = require("./ensure_states");
const normalize_1 = require("./normalize");
const readiness_1 = require("./readiness");
const resolve_1 = require("./resolve");
const snapshot_1 = require("./snapshot");
const soc_1 = require("./soc");
const soc_energy_1 = require("./soc_energy");
const baseline_1 = require("./baseline");
const states_1 = require("../runtime/states");
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
async function publishSocEnergyStates(host, vehicleId, resolution) {
    const p = (0, ensure_states_1.vehicleStatePaths)(vehicleId);
    const anchor = (0, baseline_1.getRollforwardAnchor)(vehicleId);
    const snapshot = (0, baseline_1.getLastTrustedSnapshot)(vehicleId);
    await (0, state_write_1.setStateIfChanged)(host, p.estimationResolvedSocPct, (0, soc_energy_1.roundPublishedSocPct)(resolution.resolvedSocPct));
    await (0, state_write_1.setStateIfChanged)(host, p.estimationResolvedSocSource, resolution.socSource);
    await (0, state_write_1.setStateIfChanged)(host, p.estimationResolvedSocQuality, resolution.socQuality);
    await (0, state_write_1.setStateIfChanged)(host, p.estimationResolvedSocEstimated, resolution.socEstimated);
    await (0, state_write_1.setStateIfChanged)(host, p.estimationCurrentBatteryEnergyKwh, (0, soc_energy_1.roundPublishedEnergyKwh)(resolution.currentBatteryEnergyKwh));
    await (0, state_write_1.setStateIfChanged)(host, p.estimationTargetBatteryEnergyKwh, (0, soc_energy_1.roundPublishedEnergyKwh)(resolution.targetBatteryEnergyKwh));
    await (0, state_write_1.setStateIfChanged)(host, p.estimationRequiredBatteryEnergyKwh, (0, soc_energy_1.roundPublishedEnergyKwh)(resolution.requiredBatteryEnergyKwh));
    await (0, state_write_1.setStateIfChanged)(host, p.estimationRequiredInputEnergyKwh, (0, soc_energy_1.roundPublishedEnergyKwh)(resolution.requiredInputEnergyKwh));
    await (0, state_write_1.setStateIfChanged)(host, p.estimationResolvedTargetSocPct, (0, soc_energy_1.roundPublishedSocPct)(resolution.targetSocPct));
    await (0, state_write_1.setStateIfChanged)(host, p.estimationSocEnergyReady, resolution.ready);
    await (0, state_write_1.setStateIfChanged)(host, p.estimationSocEnergyReasonCode, resolution.reasonCode);
    await (0, state_write_1.setStateIfChanged)(host, p.estimationBaselineValid, resolution.baselineValid);
    await (0, state_write_1.setStateIfChanged)(host, p.estimationRollforwardAnchorValid, anchor !== null);
    if (anchor) {
        await (0, state_write_1.setStateIfChanged)(host, p.estimationBaselineSocPct, (0, soc_energy_1.roundPublishedSocPct)(anchor.socPct));
        await (0, state_write_1.setStateIfChanged)(host, p.estimationBaselineSocSource, anchor.rootSource);
        await (0, state_write_1.setStateIfChanged)(host, p.estimationBaselineAt, new Date(anchor.observedAtMs).toISOString());
        await (0, state_write_1.setStateIfChanged)(host, p.estimationBaselineSessionEnergyKwh, (0, soc_energy_1.roundPublishedEnergyKwh)(anchor.sessionEnergyKwh));
        await (0, state_write_1.setStateIfChanged)(host, p.estimationBaselineUpdatedAt, new Date(anchor.observedAtMs).toISOString());
        await (0, state_write_1.setStateIfChanged)(host, p.estimationRollforwardRootSource, anchor.rootSource);
    }
    else {
        await (0, state_write_1.setStateIfChanged)(host, p.estimationBaselineSocPct, "");
        await (0, state_write_1.setStateIfChanged)(host, p.estimationBaselineSocSource, "");
        await (0, state_write_1.setStateIfChanged)(host, p.estimationBaselineAt, "");
        await (0, state_write_1.setStateIfChanged)(host, p.estimationBaselineSessionEnergyKwh, "");
        await (0, state_write_1.setStateIfChanged)(host, p.estimationBaselineUpdatedAt, "");
        await (0, state_write_1.setStateIfChanged)(host, p.estimationRollforwardRootSource, "");
    }
    if (snapshot) {
        await (0, state_write_1.setStateIfChanged)(host, p.estimationLastTrustedSocPct, (0, soc_energy_1.roundPublishedSocPct)(snapshot.socPct));
        await (0, state_write_1.setStateIfChanged)(host, p.estimationLastTrustedOriginalSource, snapshot.originalSource);
        await (0, state_write_1.setStateIfChanged)(host, p.estimationLastTrustedObservedAt, new Date(snapshot.observedAtMs).toISOString());
    }
    else {
        await (0, state_write_1.setStateIfChanged)(host, p.estimationLastTrustedSocPct, "");
        await (0, state_write_1.setStateIfChanged)(host, p.estimationLastTrustedOriginalSource, "");
        await (0, state_write_1.setStateIfChanged)(host, p.estimationLastTrustedObservedAt, "");
    }
}
async function publishVehicleStates(host, profile, telemetry, readiness, active, resolutionSource, confidence, invalidFields, socEnergy) {
    const p = (0, ensure_states_1.vehicleStatePaths)(profile.vehicleId);
    await (0, state_write_1.setStateIfChanged)(host, p.configDisplayName, profile.displayName);
    await (0, state_write_1.setStateIfChanged)(host, p.configEnabled, profile.enabled);
    await (0, state_write_1.setStateIfChanged)(host, p.configSource, profile.source);
    await (0, state_write_1.setStateIfChanged)(host, p.configBatteryCapacityNetKwh, profile.batteryCapacityNetKwh ?? "");
    await (0, state_write_1.setStateIfChanged)(host, p.configMaxAcChargePowerW, profile.maxAcChargePowerW ?? "");
    await (0, state_write_1.setStateIfChanged)(host, p.configSupportedPhasesJson, JSON.stringify(profile.supportedPhases));
    await (0, state_write_1.setStateIfChanged)(host, p.configPreferredPhases, profile.preferredPhases ?? "");
    await (0, state_write_1.setStateIfChanged)(host, p.configMinCurrentA, profile.minCurrentA ?? "");
    await (0, state_write_1.setStateIfChanged)(host, p.configMaxCurrentA, profile.maxCurrentA ?? "");
    await (0, state_write_1.setStateIfChanged)(host, p.configDefaultTargetSocPct, profile.defaultTargetSocPct ?? "");
    await (0, state_write_1.setStateIfChanged)(host, p.configMinimumDepartureSocPct, profile.minimumDepartureSocPct ?? "");
    await (0, state_write_1.setStateIfChanged)(host, p.configMaximumSocPct, profile.maximumSocPct ?? "");
    await (0, state_write_1.setStateIfChanged)(host, p.configChargeEfficiencyPct, profile.chargeEfficiencyPct ?? "");
    await (0, state_write_1.setStateIfChanged)(host, p.configReferenceRangeAt100PctKm, profile.referenceRangeAt100PctKm ?? "");
    await (0, state_write_1.setStateIfChanged)(host, p.configSocFallbackMaxAgeMin, profile.socFallbackMaxAgeMin ?? "");
    await (0, state_write_1.setStateIfChanged)(host, p.telemetryConnected, telemetry.connected ?? "");
    await (0, state_write_1.setStateIfChanged)(host, p.telemetryCharging, telemetry.charging ?? "");
    await (0, state_write_1.setStateIfChanged)(host, p.telemetrySocPct, telemetry.socPct ?? "");
    await (0, state_write_1.setStateIfChanged)(host, p.telemetrySocSource, telemetry.socSource);
    await (0, state_write_1.setStateIfChanged)(host, p.telemetrySocQuality, telemetry.socQuality ?? "");
    await (0, state_write_1.setStateIfChanged)(host, p.telemetryRangeKm, telemetry.rangeKm ?? "");
    await (0, state_write_1.setStateIfChanged)(host, p.telemetrySessionEnergyKwh, telemetry.sessionEnergyKwh ?? "");
    await (0, state_write_1.setStateIfChanged)(host, p.telemetryLastUpdate, telemetry.lastUpdate ?? "");
    await (0, state_write_1.setStateIfChanged)(host, p.telemetryStale, telemetry.stale);
    await (0, state_write_1.setStateIfChanged)(host, p.planningCapability, readiness.planningCapability);
    await (0, state_write_1.setStateIfChanged)(host, p.planningRequiredEnergyKwh, (0, soc_energy_1.roundPublishedEnergyKwh)(socEnergy.requiredBatteryEnergyKwh));
    await (0, state_write_1.setStateIfChanged)(host, p.planningPlannedTargetSocPct, (0, soc_energy_1.roundPublishedSocPct)(socEnergy.targetSocPct));
    await (0, state_write_1.setStateIfChanged)(host, p.planningDepartureTime, "");
    await (0, state_write_1.setStateIfChanged)(host, p.runtimeProfileValid, readiness.profileValid);
    await (0, state_write_1.setStateIfChanged)(host, p.runtimeTelemetryReady, readiness.telemetryReady);
    await (0, state_write_1.setStateIfChanged)(host, p.runtimePlanningReady, readiness.planningReady);
    await (0, state_write_1.setStateIfChanged)(host, p.runtimeActive, active);
    await (0, state_write_1.setStateIfChanged)(host, p.runtimeDetectionSource, active ? resolutionSource : "");
    await (0, state_write_1.setStateIfChanged)(host, p.runtimeDetectionConfidence, active ? confidence : 0);
    await (0, state_write_1.setStateIfChanged)(host, p.runtimeMissingFieldsJson, JSON.stringify(readiness.missingFields));
    await (0, state_write_1.setStateIfChanged)(host, p.runtimeInvalidFieldsJson, JSON.stringify(invalidFields));
    await (0, state_write_1.setStateIfChanged)(host, p.runtimeStatus, active ? "active" : profile.enabled ? "idle" : "disabled");
    await publishSocEnergyStates(host, profile.vehicleId, socEnergy);
}
async function publishGlobalVehicleRuntime(host, snapshot, resolution, profileCount, enabledCount, activeSocEnergy) {
    const resolvedId = resolution.profileResolved ? (resolution.vehicleId ?? "") : "";
    await (0, state_write_1.setStateIfChanged)(host, states_1.WALLBOX_RUNTIME_STATES.activeVehicleId, resolvedId);
    await (0, state_write_1.setStateIfChanged)(host, states_1.WALLBOX_RUNTIME_STATES.activeVehicleName, resolution.profileResolved ? (snapshot.displayName ?? "") : "");
    await (0, state_write_1.setStateIfChanged)(host, states_1.WALLBOX_RUNTIME_STATES.activeVehicleSource, resolution.source);
    await (0, state_write_1.setStateIfChanged)(host, states_1.WALLBOX_RUNTIME_STATES.activeVehicleDetectionStatus, resolution.detectionStatus);
    await (0, state_write_1.setStateIfChanged)(host, states_1.WALLBOX_RUNTIME_STATES.activeVehicleConfidence, resolution.confidence);
    await (0, state_write_1.setStateIfChanged)(host, states_1.WALLBOX_RUNTIME_STATES.activeVehicleProfileValid, snapshot.profileResolved && snapshot.planningCapability !== "insufficient");
    await (0, state_write_1.setStateIfChanged)(host, states_1.WALLBOX_RUNTIME_STATES.activeVehiclePlanningCapability, snapshot.planningCapability);
    await (0, state_write_1.setStateIfChanged)(host, states_1.WALLBOX_RUNTIME_STATES.vehicleProfileCount, profileCount);
    await (0, state_write_1.setStateIfChanged)(host, states_1.WALLBOX_RUNTIME_STATES.vehicleEnabledProfileCount, enabledCount);
    await (0, state_write_1.setStateIfChanged)(host, states_1.WALLBOX_RUNTIME_STATES.vehicleResolutionReason, resolution.reasons.join(";") || snapshot.reasons.join(";"));
    await (0, state_write_1.setStateIfChanged)(host, states_1.WALLBOX_RUNTIME_STATES.vehicleProfileResolved, resolution.profileResolved);
    await (0, state_write_1.setStateIfChanged)(host, states_1.WALLBOX_RUNTIME_STATES.vehicleActiveForCharging, resolution.activeForCharging);
    await (0, state_write_1.setStateIfChanged)(host, states_1.WALLBOX_RUNTIME_STATES.vehicleConnected, snapshot.connected);
    const socEnergy = activeSocEnergy;
    await (0, state_write_1.setStateIfChanged)(host, states_1.WALLBOX_RUNTIME_STATES.activeVehicleResolvedSocPct, socEnergy ? (0, soc_energy_1.roundPublishedSocPct)(socEnergy.resolvedSocPct) : "");
    await (0, state_write_1.setStateIfChanged)(host, states_1.WALLBOX_RUNTIME_STATES.activeVehicleResolvedSocSource, socEnergy?.socSource ?? "unknown");
    await (0, state_write_1.setStateIfChanged)(host, states_1.WALLBOX_RUNTIME_STATES.activeVehicleResolvedSocQuality, socEnergy?.socQuality ?? "none");
    await (0, state_write_1.setStateIfChanged)(host, states_1.WALLBOX_RUNTIME_STATES.activeVehicleCurrentBatteryEnergyKwh, socEnergy ? (0, soc_energy_1.roundPublishedEnergyKwh)(socEnergy.currentBatteryEnergyKwh) : "");
    await (0, state_write_1.setStateIfChanged)(host, states_1.WALLBOX_RUNTIME_STATES.activeVehicleRequiredBatteryEnergyKwh, socEnergy ? (0, soc_energy_1.roundPublishedEnergyKwh)(socEnergy.requiredBatteryEnergyKwh) : "");
    await (0, state_write_1.setStateIfChanged)(host, states_1.WALLBOX_RUNTIME_STATES.activeVehicleSocEnergyReady, socEnergy?.ready ?? false);
    await (0, state_write_1.setStateIfChanged)(host, states_1.WALLBOX_RUNTIME_STATES.activeVehicleSocEnergyReasonCode, socEnergy?.reasonCode ?? "");
}
async function refreshWallboxVehicleRuntime(host, evccSnap, config, now = new Date()) {
    const cfg = (0, config_1.wallboxVehicleProfilesConfigFromAdapter)(config);
    const { profiles, errors } = (0, normalize_1.normalizeWallboxVehicleProfiles)(cfg.profiles, now.toISOString());
    for (const profile of profiles) {
        try {
            await (0, ensure_states_1.ensureWallboxVehicleProfileStates)(host, [profile]);
        }
        catch {
            // one profile must not block others
        }
    }
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
