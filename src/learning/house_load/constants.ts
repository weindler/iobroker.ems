export const MODULE_TAG = "house_load_learning_v1";

export const DEFAULT_LOOKBACK_DAYS = 90;
export const DEFAULT_INTERVAL_SEC = 3600;

export const HISTORY_QUERY_TIMEOUT_MS = 45_000;
export const MS_PER_HOUR = 3_600_000;
export const MS_PER_DAY = 86_400_000;

/** Segmente (lokale Uhrzeit, Stunde inkl. start, exkl. end — evening bis 23). */
export const SEGMENTS = ["night", "morning", "midday", "afternoon", "evening"] as const;
export type HouseLoadSegment = (typeof SEGMENTS)[number];

export const SEASONS = ["spring", "summer", "autumn", "winter"] as const;
export type HouseLoadSeason = (typeof SEASONS)[number];

export const WEEKDAYS = [
	"monday",
	"tuesday",
	"wednesday",
	"thursday",
	"friday",
	"saturday",
	"sunday",
] as const;
export type HouseLoadWeekday = (typeof WEEKDAYS)[number];

export const DAY_TYPES = ["weekday", "weekend"] as const;
export type HouseLoadDayType = (typeof DAY_TYPES)[number];

export const SEGMENT_HOURS: Record<HouseLoadSegment, { start: number; end: number }> = {
	night: { start: 0, end: 6 },
	morning: { start: 6, end: 10 },
	midday: { start: 10, end: 14 },
	afternoon: { start: 14, end: 18 },
	evening: { start: 18, end: 24 },
};

export const MIN_PROFILE_SAMPLES = 3;
export const MIN_DAY_HOURS = 4;
export const CONFIDENCE_TARGET_SAMPLES = 20;

/** Plausible Hauslast in W — negative Werte werden verworfen. */
export const PLAUSIBLE_W_MIN = 0;
export const PLAUSIBLE_W_MAX = 50_000;

export const FALLBACK_LEVELS = [
	"season_weekday_segment",
	"season_day_type_segment",
	"all_seasons_weekday_segment",
	"global_segment",
	"median_all",
] as const;
export type FallbackLevel = (typeof FALLBACK_LEVELS)[number];
