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
async function ensurePlannerStates(host, options) {
    const includeThermal = options?.includeThermal !== false;
    const includeCooling = options?.includeCooling !== false;
    const includeWinter = options?.includeWinter !== false;
    await (0, state_util_1.ensureChannel)(host, "planner", "EMS Planner");
    await (0, state_util_1.ensureChannel)(host, "planner.intent", "Planner Intents");
    await (0, state_util_1.ensureChannel)(host, "planner.intent.battery", "Planner Batterie");
    await (0, state_util_1.ensureChannel)(host, "planner.constraints", "Planner Constraints");
    if (includeThermal) {
        await (0, state_util_1.ensureChannel)(host, "planner.intent.thermal", "Planner Heizstab");
    }
    if (includeCooling) {
        await (0, state_util_1.ensureChannel)(host, "planner.intent.cooling", "Planner Klima");
    }
    if (includeWinter) {
        await (0, state_util_1.ensureChannel)(host, "planner.intent.battery.winter", "Planner Batterie Winter-Netz");
    }
    const defs = [
        strState("planner.status", "Planner Status", "initializing"),
        strState("planner.last_run_at", "Planner letzter Lauf (ISO)"),
        numState("planner.surplus_w", "Planner PV-Überschuss", undefined),
        numState("planner.deficit_w", "Planner PV-Unterdeckung", undefined),
        strState("planner.global_mode.active", "Planner Global Mode", "balanced"),
        strState("planner.intent.last_json", "Planner letzter Intent (JSON)", "{}"),
        strState("planner.intent.last_reason_de", "Planner letzte Begründung (DE)", ""),
        strState("planner.intent.battery.action", "Planner Batterie Aktion", "none"),
        numState("planner.intent.battery.max_charge_w", "Planner Batterie max. Ladeleistung W", 0),
        strState("planner.intent.battery.reason_de", "Planner Batterie Begründung", ""),
        boolState("planner.constraints.evcc_battery_hold", "Planner EVCC Batterie-Hold", false),
        boolState("planner.constraints.battery_hold_active", "Planner Batterie-Hold gesamt", false),
        boolState("planner.constraints.battery_consumer_immersion_allowed", "Batterie für Heizstab jetzt erlaubt", false),
        strState("planner.constraints.battery_consumer_immersion_reason_de", "Batterie Heizstab Begründung", ""),
        boolState("planner.constraints.battery_consumer_climate_allowed", "Batterie für Klima jetzt erlaubt", false),
        strState("planner.constraints.battery_consumer_climate_reason_de", "Batterie Klima Begründung", ""),
        boolState("planner.constraints.battery_consumer_wallbox_allowed", "Batterie für Wallbox jetzt erlaubt", false),
        strState("planner.constraints.battery_consumer_wallbox_reason_de", "Batterie Wallbox Begründung", ""),
    ];
    if (includeThermal) {
        defs.push(numState("planner.intent.thermal.commanded_stage", "Planner Heizstab Stufe", 0), numState("planner.intent.thermal.commanded_power_w", "Planner Heizstab Leistung W", 0), strState("planner.intent.thermal.reason_de", "Planner Heizstab Begründung", ""), numState("planner.intent.thermal.target_temp_c", "Planner Heizstab Tagesziel °C"), strState("planner.intent.thermal.target_reason_de", "Planner Heizstab Ziel-Begründung", ""), boolState("planner.intent.thermal.forecast_active", "Planner Heizstab Forecast aktiv", false));
    }
    if (includeCooling) {
        defs.push(numState("planner.intent.cooling.expected_kwh_today", "Planner Klima erwartet kWh heute", 0), numState("planner.intent.cooling.expected_peak_w", "Planner Klima erwartete Peak-Leistung W", 0), boolState("planner.intent.cooling.likely_active", "Planner Klima voraussichtlich aktiv", false), strState("planner.intent.cooling.reason_de", "Planner Klima Begründung", ""), boolState("planner.intent.cooling.forecast_active", "Planner Klima Forecast aktiv", false));
    }
    if (includeWinter) {
        defs.push(boolState("planner.intent.battery.winter.active", "Planner Winter-Netz aktiv", false), boolState("planner.intent.battery.winter.forecast_active", "Planner Winter-Netz Forecast aktiv", false), numState("planner.intent.battery.winter.horizon_days", "Planner Winter Horizont Tage", 0), strState("planner.intent.battery.winter.bridge_until_iso", "Planner Winter Brücke bis (ISO)"), numState("planner.intent.battery.winter.pv_recovery_day", "Planner Winter PV-Recovery Tag"), numState("planner.intent.battery.winter.energy_stored_kwh", "Planner Winter Energie gespeichert kWh"), numState("planner.intent.battery.winter.energy_deficit_kwh", "Planner Winter Energielücke kWh"), numState("planner.intent.battery.winter.energy_reserve_kwh", "Planner Winter Reserve kWh"), numState("planner.intent.battery.winter.energy_target_kwh", "Planner Winter Energieziel kWh"), numState("planner.intent.battery.winter.soc_target_pct", "Planner Winter SOC-Ziel %"), numState("planner.intent.battery.winter.charge_energy_kwh", "Planner Winter Netzladung kWh"), numState("planner.intent.battery.winter.charge_duration_h", "Planner Winter Ladedauer h"), numState("planner.intent.battery.winter.charge_slots_15m", "Planner Winter 15-min-Slots"), numState("planner.intent.battery.winter.confidence_min_pct", "Planner Winter min. PV-Confidence %"), strState("planner.intent.battery.winter.windows_json", "Planner Winter Preisfenster (JSON)", "[]"), strState("planner.intent.battery.winter.reason_de", "Planner Winter Begründung", ""));
    }
    await (0, state_util_1.ensureStates)(host, defs);
}
exports.ensurePlannerStates = ensurePlannerStates;
