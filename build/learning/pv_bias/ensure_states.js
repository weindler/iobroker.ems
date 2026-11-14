"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensurePvBiasStates = ensurePvBiasStates;
const state_util_1 = require("../../ems_light/state_util");
function strState(id, name, def) {
    return {
        id,
        common: { name, type: "string", role: "text", read: true, write: false, def },
        defaultVal: def,
        setDefaultIfEmpty: true,
    };
}
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
async function ensurePvBiasStates(host) {
    await (0, state_util_1.ensureChannel)(host, "learning.pv_bias", "EMS-Light Learning PV-Bias");
    const defs = [
        numState("learning.pv_bias.bias_today_pct", "PV-Bias heute", "%"),
        numState("learning.pv_bias.bias_7d_pct", "PV-Bias 7 Tage", "%"),
        numState("learning.pv_bias.bias_30d_pct", "PV-Bias 30 Tage", "%"),
        numState("learning.pv_bias.bias_14d_pct", "PV-Bias 14 Tage energiegewichtet", "%"),
        numState("learning.pv_bias.bias_90d_pct", "PV-Bias Langzeitbasis bis 90 Tage", "%"),
        numState("learning.pv_bias.model_bias_pct", "PV-Bias Modellwert 60/40", "%"),
        numState("learning.pv_bias.applied_bias_pct", "PV-Bias tatsächlich angewendet", "%"),
        numState("learning.pv_bias.corrected_today_kwh", "PV korrigiert heute", "kWh"),
        numState("learning.pv_bias.expected_today_kwh", "PV heute erwartet (bisher + Rest, mit Tageskorrektur)", "kWh"),
        numState("learning.pv_bias.corrected_tomorrow_kwh", "PV korrigiert morgen", "kWh"),
        numState("learning.pv_bias.confidence_pct", "PV-Bias Confidence", "%"),
        numState("learning.pv_bias.raw_today_kwh", "PV Rohforecast heute", "kWh"),
        numState("learning.pv_bias.raw_tomorrow_kwh", "PV Rohforecast morgen", "kWh"),
        numState("learning.pv_bias.actual_today_kwh", "PV Ist-Ertrag heute", "kWh"),
        numState("learning.pv_bias.sample_days_30d", "PV-Bias gültige Tage 30d"),
        numState("learning.pv_bias.sample_days_14d", "PV-Bias gültige Tage 14d"),
        numState("learning.pv_bias.sample_days_90d", "PV-Bias gültige Tage bis 90d"),
        numState("learning.pv_bias.coverage_pct", "PV-Bias Datenabdeckung", "%"),
        numState("learning.pv_bias.stability_pct", "PV-Bias Stabilität", "%"),
        strState("learning.pv_bias.last_update_ts", "PV-Bias letztes Update (ISO)"),
        strState("learning.pv_bias.status", "Learning PV-Bias Status", "not_initialized"),
        strState("learning.pv_bias.reason", "Learning PV-Bias Hinweis"),
        strState("learning.pv_bias.frozen_at_ts", "PV-Bias Forecast eingefroren um (ISO)"),
        numState("learning.pv_bias.frozen_today_kwh", "PV eingefrorener Forecast heute", "kWh"),
        numState("learning.pv_bias.frozen_tomorrow_kwh", "PV eingefrorener Forecast morgen", "kWh"),
        strState("learning.pv_bias.freeze_status", "PV-Bias Freeze-Status", "waiting"),
        numState("learning.pv_bias.alt_today_kwh", "PV Zweitquelle heute (live)", "kWh"),
        numState("learning.pv_bias.alt_tomorrow_kwh", "PV Zweitquelle morgen (live)", "kWh"),
        strState("learning.pv_bias.guard_status", "Zweitquellen-Guard (none oder Hinweis)", "none"),
        strState("learning.pv_bias.compare_json", "Quellenvergleich Haupt/Zweit/Ist (JSON)"),
        numState("learning.pv_bias.intraday_factor", "PV-Korrektur im Tagesverlauf (Faktor für Rest des Tages)"),
        strState("learning.pv_bias.profile_status_de", "PV-Profil (Dach-Faktor je Stunde) Lernstand", ""),
        strState("learning.pv_bias.intraday_status_de", "PV-Korrektur im Tagesverlauf (Begründung)", ""),
    ];
    await (0, state_util_1.ensureStates)(host, defs);
}
