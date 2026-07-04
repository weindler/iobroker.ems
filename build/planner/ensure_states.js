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
function numState(id, name, def) {
    return {
        id,
        common: { name, type: "number", role: "value", read: true, write: false, def },
        defaultVal: def,
    };
}
function boolState(id, name, def) {
    return {
        id,
        common: { name, type: "boolean", role: "state", read: true, write: false, def },
        defaultVal: def,
    };
}
async function ensurePlannerStates(host) {
    await (0, state_util_1.ensureChannel)(host, "planner", "EMS Planner");
    await (0, state_util_1.ensureChannel)(host, "planner.intent", "Planner Intents");
    await (0, state_util_1.ensureChannel)(host, "planner.intent.thermal", "Planner Heizstab");
    await (0, state_util_1.ensureChannel)(host, "planner.intent.battery", "Planner Batterie");
    await (0, state_util_1.ensureChannel)(host, "planner.constraints", "Planner Constraints");
    const defs = [
        strState("planner.status", "Planner Status", "initializing"),
        strState("planner.last_run_at", "Planner letzter Lauf (ISO)"),
        numState("planner.surplus_w", "Planner PV-Überschuss", undefined),
        numState("planner.deficit_w", "Planner PV-Unterdeckung", undefined),
        strState("planner.global_mode.active", "Planner Global Mode", "balanced"),
        strState("planner.intent.last_json", "Planner letzter Intent (JSON)", "{}"),
        strState("planner.intent.last_reason_de", "Planner letzte Begründung (DE)", ""),
        numState("planner.intent.thermal.commanded_stage", "Planner Heizstab Stufe", 0),
        numState("planner.intent.thermal.commanded_power_w", "Planner Heizstab Leistung W", 0),
        strState("planner.intent.thermal.reason_de", "Planner Heizstab Begründung", ""),
        strState("planner.intent.battery.action", "Planner Batterie Aktion", "none"),
        numState("planner.intent.battery.max_charge_w", "Planner Batterie max. Ladeleistung W", 0),
        strState("planner.intent.battery.reason_de", "Planner Batterie Begründung", ""),
        boolState("planner.constraints.evcc_battery_hold", "Planner EVCC Batterie-Hold", false),
        boolState("planner.constraints.battery_hold_active", "Planner Batterie-Hold gesamt", false),
    ];
    await (0, state_util_1.ensureStates)(host, defs);
}
exports.ensurePlannerStates = ensurePlannerStates;
