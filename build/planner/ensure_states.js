"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensurePlannerStates = void 0;
const state_util_1 = require("../ems_light/state_util");
function strState(id, name, def) {
    return {
        id,
        common: { name, type: "string", role: "text", read: true, write: false, def },
        defaultVal: def,
        setDefaultIfEmpty: true,
    };
}
function boolState(id, name, def) {
    return {
        id,
        common: { name, type: "boolean", role: "state", read: true, write: false, def },
        defaultVal: def,
    };
}
/**
 * Planner-/Constraint-Hülle ohne Legacy Realtime-Intent-Bäume (Block 5).
 * Forecast/Daily/Allocation werden separat via Operator ensure_* angelegt.
 */
async function ensurePlannerStates(host, _options) {
    await (0, state_util_1.ensureChannel)(host, "planner", "EMS Planner");
    await (0, state_util_1.ensureChannel)(host, "planner.intent", "Planner Intents");
    await (0, state_util_1.ensureChannel)(host, "planner.constraints", "Planner Constraints");
    const defs = [
        strState("planner.status", "Planner Status", "initializing"),
        strState("planner.last_run_at", "Planner letzter Lauf (ISO)"),
        strState("planner.global_mode.active", "Planner Global Mode", "balanced"),
        boolState("planner.constraints.evcc_battery_hold", "Planner EVCC Batterie-Hold", false),
        boolState("planner.constraints.battery_hold_active", "Planner Batterie-Hold gesamt", false),
        boolState("planner.constraints.battery_consumer_immersion_allowed", "Batterie für Heizstab jetzt erlaubt", false),
        strState("planner.constraints.battery_consumer_immersion_reason_de", "Batterie Heizstab Begründung", ""),
        boolState("planner.constraints.battery_consumer_climate_allowed", "Batterie für Klima jetzt erlaubt", false),
        strState("planner.constraints.battery_consumer_climate_reason_de", "Batterie Klima Begründung", ""),
        boolState("planner.constraints.battery_consumer_wallbox_allowed", "Batterie für Wallbox jetzt erlaubt", false),
        strState("planner.constraints.battery_consumer_wallbox_reason_de", "Batterie Wallbox Begründung", ""),
    ];
    await (0, state_util_1.ensureStates)(host, defs);
}
exports.ensurePlannerStates = ensurePlannerStates;
