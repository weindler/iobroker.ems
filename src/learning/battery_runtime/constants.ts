export const MODULE_TAG = "battery_runtime_learning_v1";

export const DEFAULT_LOOKBACK_DAYS = 90;
export const DEFAULT_FULL_CHARGE_SOC = 100;
export const DEFAULT_SECONDS_SINCE_FULL_STATE = "sonnen.0.latestData.secondsSinceFullCharge";
export const DEFAULT_TOPOFF_INTERVAL_DAYS = 20;
export const DEFAULT_NIGHT_START = "22:00";
export const DEFAULT_NIGHT_END = "06:00";

export const HISTORY_QUERY_TIMEOUT_MS = 45_000;
export const MS_PER_HOUR = 3_600_000;
export const MS_PER_DAY = 86_400_000;

export const SOC_MIN = 0;
export const SOC_MAX = 100;
export const PLAUSIBLE_POWER_W_MAX = 30_000;
export const POWER_DEADBAND_W = 30;

export const MIN_VALID_NIGHTS = 3;
export const MIN_RATE_SAMPLES = 5;

/**
 * Vorzeichen battery_power_w (Admin/Mapping):
 * positiv = Laden (Energie in die Batterie),
 * negativ = Entladen (Energie aus der Batterie).
 */
