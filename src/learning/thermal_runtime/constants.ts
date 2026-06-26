export const MODULE_TAG = "thermal_runtime_learning_v1";

export const DEFAULT_LOOKBACK_DAYS = 90;
export const DEFAULT_FULL_THRESHOLD_C = 60;
export const DEFAULT_EMPTY_THRESHOLD_C = 48;
export const DEFAULT_MIN_RUNTIME_HOURS = 0.5;
export const DEFAULT_MAX_RUNTIME_HOURS = 72;

/**
 * Umgebungstemperatur am Pufferstandort (Heizraum). Bezugspunkt für die
 * Newton'sche Abkühlung: Ein Schichtspeicher kühlt nahe der Umgebungstemperatur
 * deutlich langsamer ab als kurz nach dem Aufheizen ("erst 3°/h, dann 2°/h, dann 1°/h").
 */
export const DEFAULT_AMBIENT_C = 18;

export const HISTORY_QUERY_TIMEOUT_MS = 45_000;
export const MS_PER_HOUR = 3_600_000;
export const MS_PER_DAY = 86_400_000;

export const PLAUSIBLE_TEMP_MIN_C = -10;
export const PLAUSIBLE_TEMP_MAX_C = 120;

export const MIN_CYCLES_OK = 3;
export const MAX_HISTORY_JSON_CYCLES = 20;

export const SEASONS = ["spring", "summer", "autumn", "winter"] as const;
export type ThermalSeason = (typeof SEASONS)[number];

export const DAY_TYPES = ["weekday", "weekend"] as const;
export type ThermalDayType = (typeof DAY_TYPES)[number];
