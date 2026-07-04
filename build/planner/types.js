"use strict";
/** Deterministic EMS planner — Phase 1 MVP (dryrun-first). */
Object.defineProperty(exports, "__esModule", { value: true });
exports.emptyPlannerIntent = exports.PLANNER_ENGINE_VERSION = exports.PLANNER_SCHEMA_VERSION = void 0;
exports.PLANNER_SCHEMA_VERSION = 1;
exports.PLANNER_ENGINE_VERSION = "0.3.0";
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
        battery: { action: "none", max_charge_w: 0, target_soc_pct: null, reason_de: "Kein Batterie-Auftrag." },
    };
}
exports.emptyPlannerIntent = emptyPlannerIntent;
