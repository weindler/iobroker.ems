"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.effectiveForceTarget = exports.stageByIndex = exports.activeStages = exports.immersionDeviceConfigFromAdapter = void 0;
function numField(c, key, fallback) {
    const v = c[key];
    if (v === null || v === undefined || v === "")
        return fallback;
    const n = typeof v === "number" ? v : parseFloat(String(v).replace(",", "."));
    return Number.isFinite(n) ? n : fallback;
}
function strField(c, key) {
    const v = c[key];
    return typeof v === "string" ? v.trim() : "";
}
function boolField(c, key, fallback) {
    const v = c[key];
    return typeof v === "boolean" ? v : fallback;
}
function parseStageCount(raw) {
    if (raw >= 3)
        return 3;
    if (raw === 2)
        return 2;
    return 1;
}
function parsePhaseCount(raw) {
    return raw >= 3 ? 3 : 1;
}
function stageFromConfig(c, index) {
    const p = `ih_stage_${index}`;
    const legacySet = index === 1 ? strField(c, "ih_set_enabled_target") : "";
    const setState = strField(c, `${p}_set_state`) || legacySet;
    const nominal = numField(c, `${p}_nominal_power_w`, 0);
    return {
        index,
        enabled: boolField(c, `${p}_enabled`, index === 1),
        name: strField(c, `${p}_name`) || `Stufe ${index}`,
        nominalPowerW: nominal > 0 ? nominal : 0,
        setStateId: setState,
        feedbackStateId: strField(c, `${p}_feedback_state`),
    };
}
function immersionDeviceConfigFromAdapter(config) {
    const c = config && typeof config === "object" ? config : {};
    const stageCount = parseStageCount(numField(c, "ih_stage_count", 1));
    const stages = [];
    for (let i = 1; i <= stageCount; i++) {
        stages.push(stageFromConfig(c, i));
    }
    return {
        phaseCount: parsePhaseCount(numField(c, "ih_phase_count", 1)),
        stageCount,
        stages,
        planningMinTempC: numField(c, "ih_planning_min_temp_c", 48),
        planningMaxTempC: numField(c, "ih_planning_max_temp_c", 60),
        temperatureHysteresisK: numField(c, "ih_temperature_hysteresis_k", 2),
        temperatureMaxAgeSec: numField(c, "ih_temperature_max_age_sec", 300),
        temperaturePlausibleMinC: numField(c, "ih_temperature_plausible_min_c", 0),
        temperaturePlausibleMaxC: numField(c, "ih_temperature_plausible_max_c", 110),
        minimumRuntimeSec: numField(c, "ih_minimum_runtime_sec", 60),
        minimumPauseSec: numField(c, "ih_minimum_pause_sec", 60),
        forceDefaultStage: Math.max(1, Math.round(numField(c, "ih_force_default_stage", 1))),
        actualPowerStateId: strField(c, "ih_actual_power_state"),
        powerOnThresholdW: numField(c, "ih_power_on_threshold_w", 50),
        powerOffThresholdW: numField(c, "ih_power_off_threshold_w", 20),
        powerTolerancePct: numField(c, "ih_power_tolerance_pct", 20),
        switchOnCheckDelaySec: numField(c, "ih_switch_on_check_delay_sec", 30),
        switchOffCheckDelaySec: numField(c, "ih_switch_off_check_delay_sec", 30),
        powerMismatchDurationSec: numField(c, "ih_power_mismatch_duration_sec", 60),
        relayChatterWindowSec: numField(c, "ih_relay_chatter_window_sec", 300),
        relayChatterMaxChanges: numField(c, "ih_relay_chatter_max_changes", 6),
        bufferTempStateId: strField(c, "ih_buffer_temp_c_target"),
        bufferTempEnabled: boolField(c, "ih_buffer_temp_c_enabled", true),
    };
}
exports.immersionDeviceConfigFromAdapter = immersionDeviceConfigFromAdapter;
function activeStages(config) {
    return config.stages.filter((s) => s.enabled && s.setStateId);
}
exports.activeStages = activeStages;
function stageByIndex(config, index) {
    return config.stages.find((s) => s.index === index) ?? null;
}
exports.stageByIndex = stageByIndex;
function effectiveForceTarget(config, override) {
    const t = override ?? config.planningMaxTempC;
    return Math.min(t, config.planningMaxTempC);
}
exports.effectiveForceTarget = effectiveForceTarget;
