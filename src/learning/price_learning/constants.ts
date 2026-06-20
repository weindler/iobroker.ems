export const DEFAULT_PRICE_STATE_ID = "live.price.now_ct_per_kwh";

export const DEFAULT_LOOKBACK_DAYS = 90;
export const MIN_VALID_HOURS_PER_DAY = 12;
export const MIN_SAMPLE_DAYS_READY = 7;
export const HISTORY_QUERY_TIMEOUT_MS = 15_000;
export const MS_PER_DAY = 86_400_000;
export const HOUR_PATTERN_TOP_N = 3;
export const MODULE_TAG = "learning.price_learning.v1";

/** Plausible ct/kWh (0–500 ct = 0–5 €/kWh). */
export const PLAUSIBLE_CT_MIN = 0;
export const PLAUSIBLE_CT_MAX = 500;

/** Plausible €/kWh. */
export const PLAUSIBLE_EUR_MIN = 0;
export const PLAUSIBLE_EUR_MAX = 5;
