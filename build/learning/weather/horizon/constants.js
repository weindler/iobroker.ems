"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WEATHER_HORIZON_BIAS_EMA_ALPHA = exports.WEATHER_HORIZON_BIAS_WEIGHT_BY_DAY = exports.WEATHER_HORIZON_DAY_INDEXES = exports.WEATHER_HORIZON_DAY_COUNT = exports.WEATHER_HORIZON_LAST_DAY = exports.WEATHER_HORIZON_FIRST_DAY = void 0;
/**
 * Weather horizon Tag 1–7 (Tag 1 = heute), analog PV-Horizon.
 * BrightSky-Beispiel: Tag1 = daily.00 … Tag7 = daily.06.
 */
exports.WEATHER_HORIZON_FIRST_DAY = 1;
exports.WEATHER_HORIZON_LAST_DAY = 7;
exports.WEATHER_HORIZON_DAY_COUNT = 7;
exports.WEATHER_HORIZON_DAY_INDEXES = [1, 2, 3, 4, 5, 6, 7];
/** Bias-Gewicht je Tag (Tag1 = voll, weiter abnehmend) — wie PV-Horizon. */
exports.WEATHER_HORIZON_BIAS_WEIGHT_BY_DAY = [
    1.0, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4,
];
/** EMA für neuen Tages-Bias-Sample. */
exports.WEATHER_HORIZON_BIAS_EMA_ALPHA = 0.3;
