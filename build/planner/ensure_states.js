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
        /*
         * Phase 1b: wirtschaftliche Entlade-Entscheidung des Unified Planners für den
         * aktuellen Slot — grid_balance übernimmt max_discharge_w nur als Obergrenze,
         * Hardware-/Ownership-Gates bleiben lokal in der Batterie-Runtime.
         */
        boolState("planner.battery_discharge.allowed", "Batterie-Entladung (Netzausgleich) wirtschaftlich erlaubt", false),
        {
            id: "planner.battery_discharge.max_discharge_w",
            common: { name: "Batterie-Entladebudget (Netzausgleich) W", type: "number", role: "value", read: true, write: false, def: 0 },
            defaultVal: 0,
        },
        strState("planner.battery_discharge.reason_de", "Batterie-Entladebudget Begründung", ""),
        /*
         * Zentrale Batterie-Reserve — führt learning/battery_runtime (reale Historie),
         * next_reliable_pv.ts (Forecast) und die battery.charge-Contribution (bestehendes
         * Lade-/Reserveziel) zu EINER Zielgröße zusammen; für Lade- UND Entladeplanung.
         */
        {
            id: "planner.battery_reserve.required_soc_at_pv_end_pct",
            common: { name: "Zentrale Batterie-Reserve SOC-Ziel (%)", type: "number", role: "value", read: true, write: false, def: null, unit: "%" },
            defaultVal: null,
            setDefaultIfEmpty: true,
        },
        {
            id: "planner.battery_reserve.predicted_consumption_until_next_pv_kwh",
            common: { name: "Erwarteter Verbrauch bis nächstem PV-Fenster (kWh)", type: "number", role: "value", read: true, write: false, def: null, unit: "kWh" },
            defaultVal: null,
            setDefaultIfEmpty: true,
        },
        strState("planner.battery_reserve.next_reliable_pv_iso", "Nächstes verlässliches PV-Fenster (ISO)", ""),
        strState("planner.battery_reserve.estimated_battery_empty_at_iso", "Batterie voraussichtlich leer ab (ISO)", ""),
        {
            id: "planner.battery_reserve.energy_to_target_kwh",
            common: { name: "Ladebedarf bis Reserve-Ziel (kWh)", type: "number", role: "value", read: true, write: false, def: null, unit: "kWh" },
            defaultVal: null,
            setDefaultIfEmpty: true,
        },
        {
            id: "planner.battery_reserve.estimated_charge_time_to_target_hours",
            common: { name: "Geschätzte Ladezeit bis Reserve-Ziel (h)", type: "number", role: "value", read: true, write: false, def: null, unit: "h" },
            defaultVal: null,
            setDefaultIfEmpty: true,
        },
        strState("planner.battery_reserve.reason_de", "Zentrale Batterie-Reserve Begründung", ""),
    ];
    await (0, state_util_1.ensureStates)(host, defs);
}
exports.ensurePlannerStates = ensurePlannerStates;
