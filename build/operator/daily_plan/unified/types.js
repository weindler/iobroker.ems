"use strict";
/**
 * Unified Day Planner — gemeinsamer serialisierbarer Vertrag (Schritt 1).
 *
 * Erweitert das bestehende Operator-Modell (PlanContribution → ForecastPlan → DailyPlan),
 * ersetzt es nicht. Keine Live-Writes, keine Takeover in diesem Modul.
 *
 * Produktziel: docs/EMS_LIGHT_ONE_PLAN.md
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.UNIFIED_REPLAN_TRIGGERS = exports.deriveUnifiedHardConstraints = exports.UNIFIED_OBJECTIVE_PRIORITY = void 0;
/** Prioritätsordnung — Vertrag + Tests; noch kein Solver. */
exports.UNIFIED_OBJECTIVE_PRIORITY = [
    "safety_constraints",
    "hard_user_deadlines",
    "physical_availability",
    "anticipate_surplus_and_deficit",
    "minimize_horizon_cost",
    "increase_pv_self_consumption",
    "avoid_needless_battery_cycles",
    "comfort_goals",
];
/** Kanonische harte Constraints aus dem Input ableiten (Contract-Sanity, kein Solver). */
function deriveUnifiedHardConstraints(input) {
    const out = [];
    const wb = input.wallbox;
    if (wb) {
        out.push({
            id: "wallbox.presence",
            kind: "availability",
            hard: true,
            descriptionDe: "Wallbox-Allocation nur in Presence-Fenstern mit available=true (harter Constraint).",
            ref: "presenceHardConstraint",
        });
        if (wb.deadlineIso || wb.requiredEnergyKwh !== null) {
            out.push({
                id: "wallbox.energy_goal",
                kind: "deadline",
                hard: wb.energyGoalHard,
                descriptionDe: wb.energyGoalHard
                    ? "Fahrzeug Zielenergie/Deadline ist hartes Goal (soweit physisch möglich)."
                    : "Fahrzeug Zielenergie/Deadline ist weiches Goal (best effort).",
                ref: wb.deadlineIso ?? "requiredEnergyKwh",
            });
        }
    }
    if (input.thermal?.minTempC != null) {
        out.push({
            id: "thermal.min_temp",
            kind: "safety",
            hard: true,
            descriptionDe: `Thermische Pflicht-Untergrenze ${input.thermal.minTempC} °C.`,
        });
    }
    return out;
}
exports.deriveUnifiedHardConstraints = deriveUnifiedHardConstraints;
exports.UNIFIED_REPLAN_TRIGGERS = [
    {
        id: "forecast_changed_significantly",
        descriptionDe: "PV- oder Wetter-Forecast weicht deutlich vom Planungsstand ab.",
        suggestedThresholdHintDe: "z. B. Tagesenergie oder mehrstündiges Profil > konfigurierbarer Anteil",
    },
    {
        id: "pv_observed_deviates",
        descriptionDe: "PV-Ist weicht relevant vom geplanten Slot-Profil ab.",
        suggestedThresholdHintDe: "kumulierte kWh oder Leistung über N Slots",
    },
    {
        id: "house_load_deviates",
        descriptionDe: "Hauslast-Ist weicht relevant vom Plan ab.",
        suggestedThresholdHintDe: "kumulierte kWh über N Slots",
    },
    {
        id: "new_price_interval",
        descriptionDe: "Neues oder geändertes Strompreis-Intervall im Horizont.",
        suggestedThresholdHintDe: "jeder neue Tibber-/Tarif-Slot",
    },
    {
        id: "vehicle_plugged",
        descriptionDe: "Fahrzeug wurde angesteckt.",
        suggestedThresholdHintDe: "sofort",
    },
    {
        id: "vehicle_unplugged",
        descriptionDe: "Fahrzeug wurde abgesteckt.",
        suggestedThresholdHintDe: "sofort",
    },
    {
        id: "vehicle_presence_changed",
        descriptionDe: "Erwartete Verfügbarkeit an der Wallbox hat sich geändert.",
        suggestedThresholdHintDe: "Presence-Fenster geändert",
    },
    {
        id: "vehicle_target_or_deadline_changed",
        descriptionDe: "Ziel-SOC oder Abfahrts-Deadline geändert.",
        suggestedThresholdHintDe: "sofort",
    },
    {
        id: "battery_soc_deviates",
        descriptionDe: "Batterie-SOC weicht relevant von der Trajektorie ab.",
        suggestedThresholdHintDe: "ΔSOC oder ΔkWh",
    },
    {
        id: "buffer_temp_deviates",
        descriptionDe: "Puffertemperatur weicht relevant vom erwarteten Verlauf ab.",
        suggestedThresholdHintDe: "ΔK über Zeit",
    },
    {
        id: "manual_user_change",
        descriptionDe: "Manuelle Benutzeränderung (Modus, Ziele, Freigaben).",
        suggestedThresholdHintDe: "sofort",
    },
    {
        id: "device_or_safety_change",
        descriptionDe: "Relevante Geräte- oder Safety-Änderung (Fault, Lockout, Mapping).",
        suggestedThresholdHintDe: "sofort",
    },
];
