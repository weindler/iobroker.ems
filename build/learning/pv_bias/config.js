"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pvBiasConfigReady = exports.pvBiasConfigFromAdapter = exports.normalizeFreezeTime = exports.parseFreezeTimeHHMM = void 0;
const DEFAULT_INTERVAL_SEC = 3600;
const DEFAULT_FREEZE_TIME = "06:00";
const DEFAULT_ACTUAL_SNAPSHOT_TIME = "23:58";
function strField(config, key) {
    const v = config[key];
    return typeof v === "string" ? v.trim() : "";
}
function boolField(config, key, defaultVal) {
    const v = config[key];
    if (typeof v === "boolean") {
        return v;
    }
    if (typeof v === "number") {
        return v !== 0;
    }
    if (typeof v === "string") {
        const s = v.trim().toLowerCase();
        if (["1", "true", "on", "yes", "ja"].includes(s)) {
            return true;
        }
        if (["0", "false", "off", "no", "nein"].includes(s)) {
            return false;
        }
    }
    return defaultVal;
}
/** HH:MM oder H:MM — ungültig → null. */
function parseFreezeTimeHHMM(raw) {
    const m = raw.trim().match(/^(\d{1,2}):(\d{2})$/);
    if (!m) {
        return null;
    }
    const hours = parseInt(m[1], 10);
    const minutes = parseInt(m[2], 10);
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
        return null;
    }
    return { hours, minutes };
}
exports.parseFreezeTimeHHMM = parseFreezeTimeHHMM;
function normalizeFreezeTime(raw) {
    const parsed = parseFreezeTimeHHMM(raw);
    if (!parsed) {
        return DEFAULT_FREEZE_TIME;
    }
    return `${String(parsed.hours).padStart(2, "0")}:${String(parsed.minutes).padStart(2, "0")}`;
}
exports.normalizeFreezeTime = normalizeFreezeTime;
function pvBiasConfigFromAdapter(config) {
    const c = config && typeof config === "object" ? config : {};
    const intervalRaw = c.learning_pv_bias_interval_sec;
    const intervalN = typeof intervalRaw === "number" ? intervalRaw : parseInt(String(intervalRaw ?? ""), 10);
    const intervalSec = Number.isFinite(intervalN) && intervalN >= 300 && intervalN <= 86400
        ? Math.round(intervalN)
        : DEFAULT_INTERVAL_SEC;
    const freezeTimeRaw = strField(c, "learning_pv_bias_forecast_freeze_time") || DEFAULT_FREEZE_TIME;
    const snapshotTimeRaw = strField(c, "learning_pv_bias_actual_snapshot_time") || DEFAULT_ACTUAL_SNAPSHOT_TIME;
    return {
        enabled: boolField(c, "learning_pv_bias_enabled", true),
        historyActualStateId: strField(c, "learning_pv_bias_history_actual_state"),
        historyForecastStateId: strField(c, "learning_pv_bias_history_forecast_state"),
        rawTodayStateId: strField(c, "learning_pv_bias_raw_today_state"),
        rawTomorrowStateId: strField(c, "learning_pv_bias_raw_tomorrow_state"),
        intervalSec,
        freezeEnabled: boolField(c, "learning_pv_bias_forecast_freeze_enabled", true),
        freezeTime: normalizeFreezeTime(freezeTimeRaw),
        actualSnapshotEnabled: boolField(c, "learning_pv_bias_actual_snapshot_enabled", true),
        actualSnapshotTime: normalizeFreezeTime(snapshotTimeRaw),
    };
}
exports.pvBiasConfigFromAdapter = pvBiasConfigFromAdapter;
function pvBiasConfigReady(cfg) {
    if (!cfg.historyActualStateId) {
        return false;
    }
    if (cfg.freezeEnabled) {
        if (parseFreezeTimeHHMM(cfg.freezeTime) === null) {
            return false;
        }
        if (cfg.actualSnapshotEnabled && parseFreezeTimeHHMM(cfg.actualSnapshotTime) === null) {
            return false;
        }
        return true;
    }
    return Boolean(cfg.historyForecastStateId);
}
exports.pvBiasConfigReady = pvBiasConfigReady;
