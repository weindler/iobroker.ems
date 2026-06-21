"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FALLBACK_LEVELS = exports.PLAUSIBLE_W_MAX = exports.PLAUSIBLE_W_MIN = exports.CONFIDENCE_TARGET_SAMPLES = exports.MIN_DAY_HOURS = exports.MIN_PROFILE_SAMPLES = exports.SEGMENT_HOURS = exports.DAY_TYPES = exports.WEEKDAYS = exports.SEASONS = exports.SEGMENTS = exports.MS_PER_DAY = exports.MS_PER_HOUR = exports.HISTORY_QUERY_TIMEOUT_MS = exports.DEFAULT_INTERVAL_SEC = exports.DEFAULT_LOOKBACK_DAYS = exports.MODULE_TAG = void 0;
exports.MODULE_TAG = "house_load_learning_v1";
exports.DEFAULT_LOOKBACK_DAYS = 90;
exports.DEFAULT_INTERVAL_SEC = 3600;
exports.HISTORY_QUERY_TIMEOUT_MS = 45_000;
exports.MS_PER_HOUR = 3_600_000;
exports.MS_PER_DAY = 86_400_000;
/** Segmente (lokale Uhrzeit, Stunde inkl. start, exkl. end — evening bis 23). */
exports.SEGMENTS = ["night", "morning", "midday", "afternoon", "evening"];
exports.SEASONS = ["spring", "summer", "autumn", "winter"];
exports.WEEKDAYS = [
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday",
];
exports.DAY_TYPES = ["weekday", "weekend"];
exports.SEGMENT_HOURS = {
    night: { start: 0, end: 6 },
    morning: { start: 6, end: 10 },
    midday: { start: 10, end: 14 },
    afternoon: { start: 14, end: 18 },
    evening: { start: 18, end: 24 },
};
exports.MIN_PROFILE_SAMPLES = 3;
exports.MIN_DAY_HOURS = 4;
exports.CONFIDENCE_TARGET_SAMPLES = 20;
/** Plausible Hauslast in W — negative Werte werden verworfen. */
exports.PLAUSIBLE_W_MIN = 0;
exports.PLAUSIBLE_W_MAX = 50_000;
exports.FALLBACK_LEVELS = [
    "season_weekday_segment",
    "season_day_type_segment",
    "all_seasons_weekday_segment",
    "global_segment",
    "median_all",
];
