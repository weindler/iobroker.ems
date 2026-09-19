"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PLAUSIBLE_EUR_MAX = exports.PLAUSIBLE_EUR_MIN = exports.PLAUSIBLE_CT_MAX = exports.PLAUSIBLE_CT_MIN = exports.MODULE_TAG = exports.HOUR_PATTERN_TOP_N = exports.MS_PER_DAY = exports.HISTORY_QUERY_TIMEOUT_MS = exports.MIN_SAMPLE_DAYS_READY = exports.MIN_VALID_HOURS_PER_DAY = exports.RECENT_DOUBLE_WEIGHT_DAYS = exports.MAX_LOOKBACK_DAYS = exports.DEFAULT_LOOKBACK_DAYS = exports.DEFAULT_PRICE_STATE_ID = void 0;
exports.DEFAULT_PRICE_STATE_ID = "live.price.now_ct_per_kwh";
/** Rollierende Lerngrundlage: 24 Monate (vereinfachend 730 Kalendertage). */
exports.DEFAULT_LOOKBACK_DAYS = 730;
exports.MAX_LOOKBACK_DAYS = 730;
exports.RECENT_DOUBLE_WEIGHT_DAYS = 90;
exports.MIN_VALID_HOURS_PER_DAY = 12;
exports.MIN_SAMPLE_DAYS_READY = 7;
exports.HISTORY_QUERY_TIMEOUT_MS = 15_000;
exports.MS_PER_DAY = 86_400_000;
exports.HOUR_PATTERN_TOP_N = 3;
exports.MODULE_TAG = "learning.price_learning.v1";
/** Technisch plausible Spanne; negative und extreme Marktpreise bleiben erhalten. */
exports.PLAUSIBLE_CT_MIN = -1_000;
exports.PLAUSIBLE_CT_MAX = 1_000;
/** Plausible €/kWh. */
exports.PLAUSIBLE_EUR_MIN = -10;
exports.PLAUSIBLE_EUR_MAX = 10;
