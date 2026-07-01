"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MIN_RATE_SAMPLES = exports.MIN_VALID_NIGHTS = exports.POWER_DEADBAND_W = exports.PLAUSIBLE_POWER_W_MAX = exports.SOC_MAX = exports.SOC_MIN = exports.MS_PER_DAY = exports.MS_PER_HOUR = exports.HISTORY_QUERY_TIMEOUT_MS = exports.DEFAULT_NIGHT_END = exports.DEFAULT_NIGHT_START = exports.DEFAULT_TOPOFF_INTERVAL_DAYS = exports.DEFAULT_SECONDS_SINCE_FULL_STATE = exports.DEFAULT_FULL_CHARGE_SOC = exports.DEFAULT_LOOKBACK_DAYS = exports.MODULE_TAG = void 0;
exports.MODULE_TAG = "battery_runtime_learning_v1";
exports.DEFAULT_LOOKBACK_DAYS = 90;
exports.DEFAULT_FULL_CHARGE_SOC = 100;
exports.DEFAULT_SECONDS_SINCE_FULL_STATE = "sonnen.0.latestData.secondsSinceFullCharge";
exports.DEFAULT_TOPOFF_INTERVAL_DAYS = 20;
exports.DEFAULT_NIGHT_START = "22:00";
exports.DEFAULT_NIGHT_END = "06:00";
exports.HISTORY_QUERY_TIMEOUT_MS = 45_000;
exports.MS_PER_HOUR = 3_600_000;
exports.MS_PER_DAY = 86_400_000;
exports.SOC_MIN = 0;
exports.SOC_MAX = 100;
exports.PLAUSIBLE_POWER_W_MAX = 30_000;
exports.POWER_DEADBAND_W = 30;
exports.MIN_VALID_NIGHTS = 3;
exports.MIN_RATE_SAMPLES = 5;
/**
 * Vorzeichen battery_power_w (Admin/Mapping):
 * positiv = Laden (Energie in die Batterie),
 * negativ = Entladen (Energie aus der Batterie).
 */
