"use strict";
/** Vehicle Presence Learning — kompakt, kein ML-Framework. */
Object.defineProperty(exports, "__esModule", { value: true });
exports.CONFIDENCE_AT_TARGET_PCT = exports.CONFIDENCE_AT_MIN_PCT = exports.PREDICT_UNAVAILABLE_RATIO = exports.PREDICT_AVAILABLE_RATIO = exports.CONFIDENCE_TARGET_SAMPLES = exports.MIN_OBSERVATIONS_FOR_PREDICTION = exports.BUCKETS_PER_DAY = exports.BUCKET_MINUTES = exports.PERSIST_FILE = exports.MODULE_TAG = void 0;
exports.MODULE_TAG = "vehicle_presence_learning_v1";
exports.PERSIST_FILE = "vehicle_presence_learning_v1.json";
/** 15-Minuten-Buckets (kompatibel zum Daily Plan). */
exports.BUCKET_MINUTES = 15;
exports.BUCKETS_PER_DAY = (24 * 60) / exports.BUCKET_MINUTES;
/**
 * Mindestbeobachtungen pro (Fahrzeug × Wochentag × Bucket), bevor eine Prognose
 * statt `unknown` ausgegeben wird.
 * Eine Observation = ein unabhängiges lokales Datum (nicht Runtime-Tick).
 */
exports.MIN_OBSERVATIONS_FOR_PREDICTION = 8;
/** Zielstichprobe für hohe Confidence (gleiche Größenordnung wie Hauslast). */
exports.CONFIDENCE_TARGET_SAMPLES = 20;
/** Ratio ≥ → predicted available. */
exports.PREDICT_AVAILABLE_RATIO = 0.7;
/** Ratio ≤ → predicted unavailable. */
exports.PREDICT_UNAVAILABLE_RATIO = 0.3;
/** Confidence bei genau MIN_OBSERVATIONS (0–100). */
exports.CONFIDENCE_AT_MIN_PCT = 45;
/** Confidence bei ≥ CONFIDENCE_TARGET_SAMPLES. */
exports.CONFIDENCE_AT_TARGET_PCT = 85;
