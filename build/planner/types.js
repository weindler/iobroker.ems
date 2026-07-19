"use strict";
/** Deterministic EMS planner — Phase 1 MVP (dryrun-first). */
Object.defineProperty(exports, "__esModule", { value: true });
exports.emptyPlannerIntent = exports.PLANNER_ENGINE_VERSION = exports.PLANNER_SCHEMA_VERSION = void 0;
exports.PLANNER_SCHEMA_VERSION = 1;
exports.PLANNER_ENGINE_VERSION = "0.4.0";
function emptyPlannerIntent(now) {
    const iso = now.toISOString();
    return {
        schema_version: exports.PLANNER_SCHEMA_VERSION,
        revision: 0,
        resolved_at: iso,
        reason_de: "Planner initialisiert, keine Entscheidung.",
        surplus_w: null,
        pv_power_w: null,
        house_load_w: null,
        constraints: {
            evcc_battery_hold: false,
            evcc_battery_discharge_control: false,
            user_intent_battery_hold: false,
            battery_hold_active: false,
            reason_de: "",
            battery_consumer_immersion_allowed: false,
            battery_consumer_immersion_reason_de: "",
            battery_consumer_climate_allowed: false,
            battery_consumer_climate_reason_de: "",
            battery_consumer_wallbox_allowed: false,
            battery_consumer_wallbox_reason_de: "",
        },
        global_mode: { active: "balanced", policy_label_de: "" },
        deficit_w: null,
        thermal: {
            commanded_stage: 0,
            commanded_power_w: 0,
            reason_de: "Kein Heizstab-Auftrag.",
            target_temp_c: 60,
            target_reason_de: "",
            forecast_active: false,
        },
        cooling: {
            expected_kwh_today: 0,
            expected_peak_w: 0,
            likely_active: false,
            reason_de: "Kein Klima-Auftrag.",
            forecast_active: false,
        },
        battery: { action: "none", max_charge_w: 0, target_soc_pct: null, reason_de: "Kein Batterie-Auftrag." },
        battery_winter: {
            active: false,
            forecast_active: false,
            horizon_days: 0,
            bridge_until_iso: null,
            pv_recovery_day: null,
            energy_stored_kwh: null,
            energy_deficit_kwh: null,
            energy_reserve_kwh: null,
            energy_target_kwh: null,
            soc_target_pct: null,
            charge_energy_kwh: null,
            charge_duration_h: null,
            charge_slots_15m: null,
            confidence_min_pct: null,
            windows_json: "[]",
            reason_de: "Winter-Netzplanung nicht aktiv.",
        },
    };
}
exports.emptyPlannerIntent = emptyPlannerIntent;
