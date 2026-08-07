"use strict";
/**
 * Spätere Verdrahtung (Schritt 2+): bestehende Operator-Welt → Unified Contract.
 * Pure Hinweise / Typ-Aliase — keine Runtime-Calls, keine State-Writes.
 *
 * Upstream heute:
 *   learning (PV bias/horizon, house_load, price) → PlanContribution[]
 *   → ForecastPlan → DailyPlan (+ allocation.ts)
 *
 * Addon-Runtimes bleiben Ausführungsadapter (EVCC Master, Heizstab-FSM, …).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.LEGACY_ATTACH_POINTS = exports.mapDailyPlanToUnified = exports.mapLegacyToUnifiedInput = void 0;
/**
 * Platzhalter — bewusst nicht implementiert.
 * Verhindert, dass Schritt 1 eine zweite Planner-Pipeline erfindet.
 */
function mapLegacyToUnifiedInput(_sources) {
    throw new Error("mapLegacyToUnifiedInput: Schritt 2 — aus ForecastPlan + Telemetrie + Contributions befüllen");
}
exports.mapLegacyToUnifiedInput = mapLegacyToUnifiedInput;
function mapDailyPlanToUnified(_plan) {
    throw new Error("mapDailyPlanToUnified: Schritt 2 — DailyPlan → UnifiedDayPlan Projection");
}
exports.mapDailyPlanToUnified = mapDailyPlanToUnified;
/** Komponenten, die später an den gemeinsamen Planner angeschlossen werden. */
exports.LEGACY_ATTACH_POINTS = [
    "src/operator/forecast/build.ts",
    "src/operator/daily_plan/build.ts",
    "src/operator/daily_plan/allocation.ts",
    "src/operator/contributions/pv.ts",
    "src/operator/contributions/house_load.ts",
    "src/operator/supply/grid.ts",
    "src/operator/contributions/flexible/battery.ts",
    "src/operator/contributions/flexible/immersion_heater.ts",
    "src/operator/contributions/flexible/wallbox.ts",
    "src/operator/contributions/flexible/air_conditioning.ts",
    "src/learning/pv_bias/",
    "src/learning/pv_horizon/",
    "src/learning/house_load/",
    "src/learning/thermal_runtime/",
    "src/learning/price_learning/",
];
