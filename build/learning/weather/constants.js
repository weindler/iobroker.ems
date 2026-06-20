"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CONFIDENCE_PCT = exports.PLAUSIBILITY = exports.METRIC_KEYS = exports.DEFAULT_INTERVAL_SEC = exports.WEATHER_CONFIDENCE_LOW_MIN_HOURS = exports.WEATHER_CONFIDENCE_MEDIUM_MIN_HOURS = exports.WEATHER_CONFIDENCE_HIGH_MIN_HOURS = exports.WEATHER_MIN_VALID_DAY_HOURS = exports.WEATHER_HEALTH_WARNING_MIN_HOURS = exports.WEATHER_HEALTH_OK_MIN_HOURS = exports.HISTORY_QUERY_TIMEOUT_MS = exports.MS_PER_DAY = void 0;
/** Kalendertag 00:00–23:59 — gleiche Regel wie PV-Learning. */
exports.MS_PER_DAY = 86_400_000;
exports.HISTORY_QUERY_TIMEOUT_MS = 8000;
/** Health nach valider Stundenanzahl (Kalendertag). */
exports.WEATHER_HEALTH_OK_MIN_HOURS = 18;
exports.WEATHER_HEALTH_WARNING_MIN_HOURS = 6;
/** Mindest-Stunden für einen gültigen Lerntag (7d/30d sample). */
exports.WEATHER_MIN_VALID_DAY_HOURS = 6;
exports.WEATHER_CONFIDENCE_HIGH_MIN_HOURS = 18;
exports.WEATHER_CONFIDENCE_MEDIUM_MIN_HOURS = 12;
exports.WEATHER_CONFIDENCE_LOW_MIN_HOURS = 6;
exports.DEFAULT_INTERVAL_SEC = 3600;
exports.METRIC_KEYS = ["temp", "cloud", "rain", "wind"];
/** Plausibilitätsgrenzen — Werte außerhalb gelten als missing. */
exports.PLAUSIBILITY = {
    temp: { min: -60, max: 60 },
    cloud: { min: 0, max: 100 },
    rain: { min: 0, max: 500 },
    wind: { min: 0, max: 250 },
};
exports.CONFIDENCE_PCT = {
    high: 85,
    medium: 60,
    low: 30,
    none: 0,
};
