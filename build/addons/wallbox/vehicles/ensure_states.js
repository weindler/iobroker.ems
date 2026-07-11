"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.wallboxVehicleStatePaths = exports.ensureWallboxVehicleProfileStates = exports.vehicleStatePaths = exports.vehicleBasePath = exports.WALLBOX_VEHICLES_BASE = void 0;
const tree_paths_1 = require("../../../tree_paths");
const state_util_1 = require("../../../ems_light/state_util");
exports.WALLBOX_VEHICLES_BASE = `${(0, tree_paths_1.addonBase)("wallbox")}.vehicles`;
function vehicleBasePath(vehicleId) {
    return `${exports.WALLBOX_VEHICLES_BASE}.${vehicleId}`;
}
exports.vehicleBasePath = vehicleBasePath;
function vehicleChannelPath(vehicleId, channel) {
    return `${vehicleBasePath(vehicleId)}.${channel}`;
}
function vehicleStatePaths(vehicleId) {
    const config = `${vehicleBasePath(vehicleId)}.config`;
    const telemetry = `${vehicleBasePath(vehicleId)}.telemetry`;
    const estimation = `${vehicleBasePath(vehicleId)}.estimation`;
    const planning = `${vehicleBasePath(vehicleId)}.planning`;
    const runtime = `${vehicleBasePath(vehicleId)}.runtime`;
    return {
        configDisplayName: `${config}.display_name`,
        configEnabled: `${config}.enabled`,
        configSource: `${config}.source`,
        configBatteryCapacityNetKwh: `${config}.battery_capacity_net_kwh`,
        configMaxAcChargePowerW: `${config}.max_ac_charge_power_w`,
        configSupportedPhasesJson: `${config}.supported_phases_json`,
        configPreferredPhases: `${config}.preferred_phases`,
        configMinCurrentA: `${config}.min_current_a`,
        configMaxCurrentA: `${config}.max_current_a`,
        configDefaultTargetSocPct: `${config}.default_target_soc_pct`,
        configMinimumDepartureSocPct: `${config}.minimum_departure_soc_pct`,
        configMaximumSocPct: `${config}.maximum_soc_pct`,
        configChargeEfficiencyPct: `${config}.charge_efficiency_pct`,
        telemetryConnected: `${telemetry}.connected`,
        telemetryCharging: `${telemetry}.charging`,
        telemetrySocPct: `${telemetry}.soc_pct`,
        telemetrySocSource: `${telemetry}.soc_source`,
        telemetrySocQuality: `${telemetry}.soc_quality`,
        telemetryRangeKm: `${telemetry}.range_km`,
        telemetrySessionEnergyKwh: `${telemetry}.session_energy_kwh`,
        telemetryLastUpdate: `${telemetry}.last_update`,
        telemetryStale: `${telemetry}.stale`,
        estimationManualStartSocPct: `${estimation}.manual_start_soc_pct`,
        estimationEstimatedSocPct: `${estimation}.estimated_soc_pct`,
        estimationEstimateValid: `${estimation}.estimate_valid`,
        estimationEstimateConfidence: `${estimation}.estimate_confidence`,
        estimationEstimateStartedAt: `${estimation}.estimate_started_at`,
        planningCapability: `${planning}.planning_capability`,
        planningRequiredEnergyKwh: `${planning}.required_energy_kwh`,
        planningPlannedTargetSocPct: `${planning}.planned_target_soc_pct`,
        planningDepartureTime: `${planning}.departure_time`,
        runtimeProfileValid: `${runtime}.profile_valid`,
        runtimeTelemetryReady: `${runtime}.telemetry_ready`,
        runtimePlanningReady: `${runtime}.planning_ready`,
        runtimeActive: `${runtime}.active`,
        runtimeDetectionSource: `${runtime}.detection_source`,
        runtimeDetectionConfidence: `${runtime}.detection_confidence`,
        runtimeMissingFieldsJson: `${runtime}.missing_fields_json`,
        runtimeInvalidFieldsJson: `${runtime}.invalid_fields_json`,
        runtimeStatus: `${runtime}.status`,
    };
}
exports.vehicleStatePaths = vehicleStatePaths;
exports.wallboxVehicleStatePaths = vehicleStatePaths;
function strState(id, name, def = "") {
    return {
        id,
        common: { name, type: "string", role: "text", read: true, write: false, def },
        defaultVal: def,
        setDefaultIfEmpty: true,
    };
}
function numState(id, name, def) {
    return {
        id,
        common: { name, type: "number", role: "value", read: true, write: false, def },
        defaultVal: def,
    };
}
function boolState(id, name, def = false) {
    return {
        id,
        common: { name, type: "boolean", role: "switch", read: true, write: false, def },
        defaultVal: def,
    };
}
async function ensureVehicleFolder(host, path, name) {
    await host.setObjectNotExistsAsync(path, {
        type: "folder",
        common: { name },
        native: {},
    });
}
function vehicleStateDefs(vehicleId, displayName) {
    const p = vehicleStatePaths(vehicleId);
    const label = displayName || vehicleId;
    return [
        strState(p.configDisplayName, `${label} Anzeigename`),
        boolState(p.configEnabled, `${label} Profil aktiv`, true),
        strState(p.configSource, `${label} Profilquelle`, "manual"),
        numState(p.configBatteryCapacityNetKwh, `${label} Batteriekapazität netto kWh`),
        numState(p.configMaxAcChargePowerW, `${label} max. AC-Ladeleistung W`),
        strState(p.configSupportedPhasesJson, `${label} unterstützte Phasen (JSON)`, "[]"),
        numState(p.configPreferredPhases, `${label} bevorzugte Phasen`),
        numState(p.configMinCurrentA, `${label} min. Strom A`),
        numState(p.configMaxCurrentA, `${label} max. Strom A`),
        numState(p.configDefaultTargetSocPct, `${label} Standard-Ziel-SOC %`),
        numState(p.configMinimumDepartureSocPct, `${label} Mindest-SOC Abfahrt %`),
        numState(p.configMaximumSocPct, `${label} max. SOC %`),
        numState(p.configChargeEfficiencyPct, `${label} Ladeeffizienz %`),
        boolState(p.telemetryConnected, `${label} verbunden`),
        boolState(p.telemetryCharging, `${label} lädt`),
        numState(p.telemetrySocPct, `${label} SOC %`),
        strState(p.telemetrySocSource, `${label} SOC-Quelle`, "unavailable"),
        strState(p.telemetrySocQuality, `${label} SOC-Qualität`),
        numState(p.telemetryRangeKm, `${label} Reichweite km`),
        numState(p.telemetrySessionEnergyKwh, `${label} Sitzungsenergie kWh`),
        strState(p.telemetryLastUpdate, `${label} Telemetrie zuletzt`),
        boolState(p.telemetryStale, `${label} Telemetrie veraltet`, false),
        numState(p.estimationManualStartSocPct, `${label} manueller Start-SOC %`),
        numState(p.estimationEstimatedSocPct, `${label} geschätzter SOC %`),
        boolState(p.estimationEstimateValid, `${label} Schätzung gültig`, false),
        numState(p.estimationEstimateConfidence, `${label} Schätz-Konfidenz`),
        strState(p.estimationEstimateStartedAt, `${label} Schätzung gestartet`),
        strState(p.planningCapability, `${label} Planungsfähigkeit`, "insufficient"),
        numState(p.planningRequiredEnergyKwh, `${label} benötigte Energie kWh`),
        numState(p.planningPlannedTargetSocPct, `${label} geplanter Ziel-SOC %`),
        strState(p.planningDepartureTime, `${label} Abfahrtszeit`),
        boolState(p.runtimeProfileValid, `${label} Profil gültig`, false),
        boolState(p.runtimeTelemetryReady, `${label} Telemetrie bereit`, false),
        boolState(p.runtimePlanningReady, `${label} Planung bereit`, false),
        boolState(p.runtimeActive, `${label} aktiv`, false),
        strState(p.runtimeDetectionSource, `${label} Erkennungsquelle`),
        numState(p.runtimeDetectionConfidence, `${label} Erkennungs-Konfidenz`, 0),
        strState(p.runtimeMissingFieldsJson, `${label} fehlende Felder (JSON)`, "[]"),
        strState(p.runtimeInvalidFieldsJson, `${label} ungültige Felder (JSON)`, "[]"),
        strState(p.runtimeStatus, `${label} Status`, "unknown"),
    ];
}
async function ensureWallboxVehicleProfileStates(host, profiles) {
    await (0, state_util_1.ensureChannel)(host, exports.WALLBOX_VEHICLES_BASE, "Wallbox Fahrzeugprofile");
    for (const profile of profiles) {
        const base = vehicleBasePath(profile.vehicleId);
        await ensureVehicleFolder(host, base, profile.displayName);
        for (const channel of ["config", "telemetry", "estimation", "planning", "runtime"]) {
            await ensureVehicleFolder(host, vehicleChannelPath(profile.vehicleId, channel), channel);
        }
        await (0, state_util_1.ensureStates)(host, vehicleStateDefs(profile.vehicleId, profile.displayName));
    }
}
exports.ensureWallboxVehicleProfileStates = ensureWallboxVehicleProfileStates;
