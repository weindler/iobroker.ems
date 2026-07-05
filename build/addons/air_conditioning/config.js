"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.acEnabledUnits = exports.acGlobalConfigFromAdapter = exports.acUnitConfigFromAdapter = void 0;
const constants_1 = require("./constants");
function configRecord(config) {
    return config && typeof config === "object" ? config : {};
}
function boolField(c, key, def) {
    const v = c[key];
    if (typeof v === "boolean")
        return v;
    if (typeof v === "number")
        return v !== 0;
    const s = String(v ?? "").trim().toLowerCase();
    if (["1", "true", "on", "yes", "ja"].includes(s))
        return true;
    if (["0", "false", "off", "no", "nein"].includes(s))
        return false;
    return def;
}
function numField(c, key, def) {
    const v = c[key];
    if (v === null || v === undefined || v === "")
        return def;
    const n = typeof v === "number" ? v : parseFloat(String(v).replace(",", "."));
    return Number.isFinite(n) ? n : def;
}
function strField(c, key, def = "") {
    const v = c[key];
    return typeof v === "string" ? v.trim() : v != null ? String(v).trim() : def;
}
function parseProfile(raw, fallback) {
    const s = String(raw ?? "").trim().toLowerCase();
    return constants_1.AC_PROFILE_IDS.includes(s) ? s : fallback;
}
function parseOptionalHumidity(c, key) {
    const v = numField(c, key, 0);
    return v > 0 ? v : null;
}
function effectiveEstimatedPowerW(c, key, def) {
    const n = numField(c, key, def);
    return n > 0 ? n : def;
}
function acUnitConfigFromAdapter(config, index) {
    const c = configRecord(config);
    const p = `ac_u${index}_`;
    const defaultProfile = parseProfile(c.ac_default_profile, "generic");
    return {
        index,
        enabled: boolField(c, `${p}enabled`, false),
        name: strField(c, `${p}name`, `Innengerät ${index}`),
        profileId: parseProfile(c[`${p}profile`], defaultProfile),
        onTempC: numField(c, `${p}on_temp_c`, 26),
        offTempC: numField(c, `${p}off_temp_c`, 24),
        maxHumidityPct: parseOptionalHumidity(c, `${p}max_humidity_pct`),
        coolingSetpointC: numField(c, `${p}cooling_setpoint_c`, 17),
        modeWhenCooling: strField(c, `${p}mode_when_cooling`, "cool"),
        fanModeWhenCooling: strField(c, `${p}fan_mode_when_cooling`, "auto"),
        fanSpeedWhenCooling: strField(c, `${p}fan_speed_when_cooling`, ""),
        modeWhenDehumidify: strField(c, `${p}mode_when_dehumidify`, "dry"),
        fanModeWhenDehumidify: strField(c, `${p}fan_mode_when_dehumidify`, "auto"),
        modeWhenFanOnly: strField(c, `${p}mode_when_fan_only`, "fan"),
        fanModeWhenFanOnly: strField(c, `${p}fan_mode_when_fan_only`, "auto"),
        modeWhenHeating: strField(c, `${p}mode_when_heating`, "heat"),
        fanModeWhenHeating: strField(c, `${p}fan_mode_when_heating`, "auto"),
        heatSetpointC: null,
        activeFrom: strField(c, `${p}active_from`, "08:00"),
        activeUntil: strField(c, `${p}active_until`, "20:00"),
        hardOffAt: strField(c, `${p}hard_off_at`, "20:00"),
        estimatedPowerW: effectiveEstimatedPowerW(c, `${p}estimated_power_w`, 700),
        cleaningAfterRun: boolField(c, `${p}cleaning_after_run`, true),
        cleaningDelayMin: Math.max(0, numField(c, `${p}cleaning_delay_min`, 1)),
        cleaningDurationMin: Math.max(0, numField(c, `${p}cleaning_duration_min`, 30)),
        statsEnabled: boolField(c, `${p}stats_enabled`, true),
        statsTrackRuntime: boolField(c, `${p}stats_track_runtime`, true),
        statsTrackEnergy: boolField(c, `${p}stats_track_energy`, true),
        statsRuntimeOffsetSec: Math.max(0, numField(c, `${p}stats_runtime_offset_h`, 0) * 3600),
        statsEnergyOffsetKwh: Math.max(0, numField(c, `${p}stats_energy_offset_kwh`, 0)),
    };
}
exports.acUnitConfigFromAdapter = acUnitConfigFromAdapter;
function acGlobalConfigFromAdapter(config) {
    const c = configRecord(config);
    const units = [];
    for (let i = 1; i <= constants_1.AC_UNIT_COUNT; i++) {
        units.push(acUnitConfigFromAdapter(config, i));
    }
    return {
        outdoorMaxPowerW: Math.max(0, numField(c, "ac_outdoor_max_power_w", 1300)),
        plannerOutdoorLikelyTempC: numField(c, "ac_planner_outdoor_likely_temp_c", 28),
        defaultProfileId: parseProfile(c.ac_default_profile, "generic"),
        units,
    };
}
exports.acGlobalConfigFromAdapter = acGlobalConfigFromAdapter;
function acEnabledUnits(config) {
    return config.units.filter((u) => u.enabled);
}
exports.acEnabledUnits = acEnabledUnits;
