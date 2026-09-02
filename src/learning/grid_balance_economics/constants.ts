/**
 * Economic Grid Balance Learning — Konstanten.
 * Kein W_native, kein theoretisches Offset-Energiemodell.
 */

export const GRID_BALANCE_ECONOMICS_MODULE = "grid_balance_economics" as const;
export const GRID_BALANCE_ECONOMICS_SCHEMA = 1 as const;
export const GRID_BALANCE_ECONOMICS_CATEGORY = "learning/grid_balance_economics";
export const GRID_BALANCE_ECONOMICS_FILE = "grid_balance_economics_v1.json";

/** Technischer Pfad-Fallback, solange kein belastbares η gelernt ist. */
export const ETA_PATH_FALLBACK = 0.92;

/** Kleine wirtschaftliche Hysterese (ct/kWh) — kein Mini-Rauschen als Entscheidung. */
export const DEFAULT_ECONOMICS_MARGIN_CT_PER_KWH = 1.5;

/** Stabilität: Mindestanzahl aufeinanderfolgender Messungen. */
export const STABILITY_MIN_SAMPLES = 3;
/** Relative Toleranz (Anteil der Skala). */
export const STABILITY_REL_TOL = 0.2;
/** Absolute Untergrenzen — kleine Watt-Rauschen bei niedriger Last nicht als Sprung werten. */
export const STABILITY_ABS_FLOOR_HOUSE_W = 80;
export const STABILITY_ABS_FLOOR_PV_W = 80;
export const STABILITY_ABS_FLOOR_GRID_W = 50;
export const STABILITY_ABS_FLOOR_GB_W = 40;

/** Sehr kurze stabile Phasen verwerfen (Learning, nicht Regelung). */
export const MIN_STABLE_PHASE_SEC = 90;

/** Vergleichsfenster: Haus/PV/SOC/Defizit. */
export const MATCH_HOUSE_REL = 0.25;
export const MATCH_HOUSE_ABS_W = 150;
export const MATCH_PV_REL = 0.25;
export const MATCH_PV_ABS_W = 120;
export const MATCH_SOC_ABS_PCT = 15;
export const MATCH_DEFICIT_REL = 0.3;
export const MATCH_DEFICIT_ABS_W = 150;
export const MATCH_HOUR_ABS = 3;

export const MIN_GB_ENERGY_KWH = 0.004;
export const MIN_PAIRS_FOR_USABLE = 8;
export const MIN_PAIRS_SLOT_FALLBACK = 16;
/** IQR / |median| oberhalb → Streuung zu groß. */
export const MAX_RELATIVE_IQR = 0.85;

/** Plausibilität für usable (Messwerte selbst werden nicht zurechtgestutzt). */
export const ALPHA_PLAUSIBLE_MIN = -0.4;
export const ALPHA_PLAUSIBLE_MAX = 2.5;
export const BETA_PLAUSIBLE_MIN = -0.4;
export const BETA_PLAUSIBLE_MAX = 4;

export const MIN_ETA_SESSIONS = 4;
export const MIN_ETA_ENERGY_KWH = 0.2;
export const ETA_PLAUSIBLE_MIN = 0.55;
export const ETA_PLAUSIBLE_MAX = 1.05;

export const MAX_OFF_WINDOWS_PER_DAY = 64;
export const MAX_GB_SEGMENTS_PER_DAY = 48;

export const LOOKBACK_DAYS = 45;
