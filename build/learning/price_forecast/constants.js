"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ACCURACY_ERROR_SCALE = exports.MODULE_TAG = exports.MS_PER_HOUR = exports.MS_PER_DAY = exports.HISTORY_QUERY_TIMEOUT_MS = exports.MIN_SAMPLE_DAYS_READY = exports.MIN_MATCHED_HOURS_PER_DAY = exports.DEFAULT_LOOKBACK_DAYS = exports.DEFAULT_FREEZE_TIME = void 0;
exports.DEFAULT_FREEZE_TIME = "14:00";
exports.DEFAULT_LOOKBACK_DAYS = 90;
exports.MIN_MATCHED_HOURS_PER_DAY = 6;
exports.MIN_SAMPLE_DAYS_READY = 7;
exports.HISTORY_QUERY_TIMEOUT_MS = 15_000;
exports.MS_PER_DAY = 86_400_000;
exports.MS_PER_HOUR = 3_600_000;
exports.MODULE_TAG = "learning.price_forecast.v1";
/** Linear accuracy: 100 - avgErrorCt * ACCURACY_ERROR_SCALE (10 ct avg error → 0%). */
exports.ACCURACY_ERROR_SCALE = 10;
