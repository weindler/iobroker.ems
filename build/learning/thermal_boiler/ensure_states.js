"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureThermalBoilerLearningStates = void 0;
const state_util_1 = require("../../ems_light/state_util");
function numState(id, name, unit) {
    return {
        id,
        common: { name, type: "number", role: "value", read: true, write: false, unit },
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
function boolState(id, name) {
    return {
        id,
        common: { name, type: "boolean", role: "indicator", read: true, write: false },
    };
}
/** Boiler-Learning A — getrennt von Puffer `learning.thermal_runtime.*`. */
async function ensureThermalBoilerLearningStates(host) {
    await (0, state_util_1.ensureChannel)(host, "learning.thermal_boiler", "EMS-Light Learning Boiler-Runtime");
    const defs = [
        strState("learning.thermal_boiler.status", "Boiler-Learning Status", "not_initialized"),
        strState("learning.thermal_boiler.health", "Boiler-Learning Health"),
        strState("learning.thermal_boiler.last_run", "Boiler-Learning letzter Lauf (ISO)"),
        strState("learning.thermal_boiler.next_run", "Boiler-Learning nächster geplanter Lauf (ISO)"),
        strState("learning.thermal_boiler.last_sample_at", "Boiler letzter Istwert-Sample (ISO)"),
        strState("learning.thermal_boiler.trigger_source", "Boiler-Learning Trigger", ""),
        strState("learning.thermal_boiler.last_error", "Boiler-Learning Fehler"),
        numState("learning.thermal_boiler.samples", "Boiler-Learning Zyklen"),
        numState("learning.thermal_boiler.history_points", "Boiler-Temperaturpunkte in der Historie"),
        numState("learning.thermal_boiler.cooling_rate_c_per_h_avg", "Boiler Ø Kühlrate", "°C/h"),
        numState("learning.thermal_boiler.cooling_k_per_h", "Boiler Newton-k", "1/h"),
        numState("learning.thermal_boiler.cooling_asymptote_c", "Boiler Asymptote", "°C"),
        strState("learning.thermal_boiler.cooling_asymptote_source", "Boiler Asymptote-Quelle"),
        numState("learning.thermal_boiler.cooling_segments", "Boiler Kühl-Segmente"),
        numState("learning.thermal_boiler.current_temperature_c", "Boiler aktuelle Temperatur", "°C"),
        numState("learning.thermal_boiler.estimated_remaining_hours", "Boiler Restlaufzeit", "h"),
        strState("learning.thermal_boiler.estimated_empty_at", "Boiler geschätzt leer um (ISO)"),
        strState("learning.thermal_boiler.by_day_type_json", "Boiler nach Day-Type (JSON)", "{}"),
        strState("learning.thermal_boiler.history_json", "Boiler Temperaturhistorie (JSON)", "[]"),
        strState("learning.thermal_boiler.model", "Boiler-Kühlmodell", "none"),
        strState("learning.thermal_boiler.quality", "Boiler-Learning Qualität", "insufficient_data"),
        strState("learning.thermal_boiler.vessel", "Speichergefäß", "boiler"),
        boolState("learning.thermal_boiler.hard_relevance", "Hard-Warmwasser-Relevanz"),
        boolState("learning.thermal_boiler.soft_relevance", "Soft-Precharge-Relevanz"),
        strState("learning.thermal_boiler.reason_de", "Boiler-Learning Begründung", "Noch keine Boiler-Daten — lernt."),
    ];
    await (0, state_util_1.ensureStates)(host, defs);
}
exports.ensureThermalBoilerLearningStates = ensureThermalBoilerLearningStates;
