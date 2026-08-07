/** Vehicle Presence Learning — kompakt, kein ML-Framework. */

export const MODULE_TAG = "vehicle_presence_learning_v1";
export const PERSIST_FILE = "vehicle_presence_learning_v1.json";

/** 15-Minuten-Buckets (kompatibel zum Daily Plan). */
export const BUCKET_MINUTES = 15;
export const BUCKETS_PER_DAY = (24 * 60) / BUCKET_MINUTES;

/**
 * Mindestbeobachtungen pro (Fahrzeug × Wochentag × Bucket), bevor eine Prognose
 * statt `unknown` ausgegeben wird.
 * Eine Observation = ein unabhängiges lokales Datum (nicht Runtime-Tick).
 */
export const MIN_OBSERVATIONS_FOR_PREDICTION = 8;

/** Zielstichprobe für hohe Confidence (gleiche Größenordnung wie Hauslast). */
export const CONFIDENCE_TARGET_SAMPLES = 20;

/** Ratio ≥ → predicted available. */
export const PREDICT_AVAILABLE_RATIO = 0.7;
/** Ratio ≤ → predicted unavailable. */
export const PREDICT_UNAVAILABLE_RATIO = 0.3;

/** Confidence bei genau MIN_OBSERVATIONS (0–100). */
export const CONFIDENCE_AT_MIN_PCT = 45;
/** Confidence bei ≥ CONFIDENCE_TARGET_SAMPLES. */
export const CONFIDENCE_AT_TARGET_PCT = 85;
