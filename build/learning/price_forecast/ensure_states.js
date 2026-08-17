"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensurePriceForecastLearningStates = void 0;
const state_util_1 = require("../../ems_light/state_util");
function numState(id, name, unit) {
    return {
        id,
        common: {
            name,
            type: "number",
            role: "value",
            read: true,
            write: false,
            unit,
        },
    };
}
function strState(id, name, def) {
    return {
        id,
        common: { name, type: "string", role: "text", read: true, write: false, def },
        defaultVal: def,
        setDefaultIfEmpty: true,
    };
}
async function ensurePriceForecastLearningStates(host) {
    await (0, state_util_1.ensureChannel)(host, "learning.price_forecast", "EMS-Light Learning Price Forecast");
    const defs = [
        strState("learning.price_forecast.status", "Price-Forecast-Learning Status", "not_initialized"),
        strState("learning.price_forecast.health", "Price-Forecast-Learning Health", "degraded"),
        strState("learning.price_forecast.last_run", "Price-Forecast-Learning letzter Lauf (ISO)"),
        numState("learning.price_forecast.forecast_confidence", "Price-Forecast Confidence", "%"),
        numState("learning.price_forecast.sample_days", "Price-Forecast gültige Tage"),
        numState("learning.price_forecast.forecast_accuracy_7d", "Price-Forecast Accuracy 7d", "%"),
        numState("learning.price_forecast.forecast_accuracy_30d", "Price-Forecast Accuracy 30d", "%"),
        numState("learning.price_forecast.avg_error_ct_7d", "Price-Forecast Ø Fehler 7d", "ct/kWh"),
        numState("learning.price_forecast.avg_error_ct_30d", "Price-Forecast Ø Fehler 30d", "ct/kWh"),
        strState("learning.price_forecast.error", "Price-Forecast Fehler"),
        strState("learning.price_forecast.frozen_at_ts", "Price-Forecast Morgen eingefroren um (ISO)"),
        strState("learning.price_forecast.freeze_status", "Price-Forecast Morgen Freeze-Status", "waiting"),
        strState("learning.price_forecast.frozen_today_at_ts", "Price-Forecast Heute eingefroren um (ISO)"),
        strState("learning.price_forecast.freeze_today_status", "Price-Forecast Heute Freeze-Status", "waiting"),
    ];
    await (0, state_util_1.ensureStates)(host, defs);
}
exports.ensurePriceForecastLearningStates = ensurePriceForecastLearningStates;
