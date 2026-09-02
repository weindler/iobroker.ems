"use strict";
/**
 * Economic Grid Balance Learning — Konstanten.
 * Kein W_native, kein theoretisches Offset-Energiemodell.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.LOOKBACK_DAYS = exports.MAX_GB_SEGMENTS_PER_DAY = exports.MAX_OFF_WINDOWS_PER_DAY = exports.ETA_PLAUSIBLE_MAX = exports.ETA_PLAUSIBLE_MIN = exports.MIN_ETA_ENERGY_KWH = exports.MIN_ETA_SESSIONS = exports.BETA_PLAUSIBLE_MAX = exports.BETA_PLAUSIBLE_MIN = exports.ALPHA_PLAUSIBLE_MAX = exports.ALPHA_PLAUSIBLE_MIN = exports.MAX_RELATIVE_IQR = exports.MIN_PAIRS_SLOT_FALLBACK = exports.MIN_PAIRS_FOR_USABLE = exports.MIN_GB_ENERGY_KWH = exports.MATCH_HOUR_ABS = exports.MATCH_DEFICIT_ABS_W = exports.MATCH_DEFICIT_REL = exports.MATCH_SOC_ABS_PCT = exports.MATCH_PV_ABS_W = exports.MATCH_PV_REL = exports.MATCH_HOUSE_ABS_W = exports.MATCH_HOUSE_REL = exports.MIN_STABLE_PHASE_SEC = exports.STABILITY_ABS_FLOOR_GB_W = exports.STABILITY_ABS_FLOOR_GRID_W = exports.STABILITY_ABS_FLOOR_PV_W = exports.STABILITY_ABS_FLOOR_HOUSE_W = exports.STABILITY_REL_TOL = exports.STABILITY_MIN_SAMPLES = exports.DEFAULT_ECONOMICS_MARGIN_CT_PER_KWH = exports.ETA_PATH_FALLBACK = exports.GRID_BALANCE_ECONOMICS_FILE = exports.GRID_BALANCE_ECONOMICS_CATEGORY = exports.GRID_BALANCE_ECONOMICS_SCHEMA = exports.GRID_BALANCE_ECONOMICS_MODULE = void 0;
exports.GRID_BALANCE_ECONOMICS_MODULE = "grid_balance_economics";
exports.GRID_BALANCE_ECONOMICS_SCHEMA = 1;
exports.GRID_BALANCE_ECONOMICS_CATEGORY = "learning/grid_balance_economics";
exports.GRID_BALANCE_ECONOMICS_FILE = "grid_balance_economics_v1.json";
/** Technischer Pfad-Fallback, solange kein belastbares η gelernt ist. */
exports.ETA_PATH_FALLBACK = 0.92;
/** Kleine wirtschaftliche Hysterese (ct/kWh) — kein Mini-Rauschen als Entscheidung. */
exports.DEFAULT_ECONOMICS_MARGIN_CT_PER_KWH = 1.5;
/** Stabilität: Mindestanzahl aufeinanderfolgender Messungen. */
exports.STABILITY_MIN_SAMPLES = 3;
/** Relative Toleranz (Anteil der Skala). */
exports.STABILITY_REL_TOL = 0.2;
/** Absolute Untergrenzen — kleine Watt-Rauschen bei niedriger Last nicht als Sprung werten. */
exports.STABILITY_ABS_FLOOR_HOUSE_W = 80;
exports.STABILITY_ABS_FLOOR_PV_W = 80;
exports.STABILITY_ABS_FLOOR_GRID_W = 50;
exports.STABILITY_ABS_FLOOR_GB_W = 40;
/** Sehr kurze stabile Phasen verwerfen (Learning, nicht Regelung). */
exports.MIN_STABLE_PHASE_SEC = 90;
/** Vergleichsfenster: Haus/PV/SOC/Defizit. */
exports.MATCH_HOUSE_REL = 0.25;
exports.MATCH_HOUSE_ABS_W = 150;
exports.MATCH_PV_REL = 0.25;
exports.MATCH_PV_ABS_W = 120;
exports.MATCH_SOC_ABS_PCT = 15;
exports.MATCH_DEFICIT_REL = 0.3;
exports.MATCH_DEFICIT_ABS_W = 150;
exports.MATCH_HOUR_ABS = 3;
exports.MIN_GB_ENERGY_KWH = 0.004;
exports.MIN_PAIRS_FOR_USABLE = 8;
exports.MIN_PAIRS_SLOT_FALLBACK = 16;
/** IQR / |median| oberhalb → Streuung zu groß. */
exports.MAX_RELATIVE_IQR = 0.85;
/** Plausibilität für usable (Messwerte selbst werden nicht zurechtgestutzt). */
exports.ALPHA_PLAUSIBLE_MIN = -0.4;
exports.ALPHA_PLAUSIBLE_MAX = 2.5;
exports.BETA_PLAUSIBLE_MIN = -0.4;
exports.BETA_PLAUSIBLE_MAX = 4;
exports.MIN_ETA_SESSIONS = 4;
exports.MIN_ETA_ENERGY_KWH = 0.2;
exports.ETA_PLAUSIBLE_MIN = 0.55;
exports.ETA_PLAUSIBLE_MAX = 1.05;
exports.MAX_OFF_WINDOWS_PER_DAY = 64;
exports.MAX_GB_SEGMENTS_PER_DAY = 48;
exports.LOOKBACK_DAYS = 45;
