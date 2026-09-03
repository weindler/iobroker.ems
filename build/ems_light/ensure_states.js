"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureEmsLightStates = void 0;
const channels_1 = require("./channels");
const state_util_1 = require("./state_util");
const OPERATOR_BRIEFING_DEFAULT = "EMS-Light Phase 1 aktiv. Planner noch nicht initialisiert.";
function strState(id, name, def, opts) {
    return {
        id,
        common: { name, type: "string", role: "text", read: true, write: false, def },
        defaultVal: def,
        setDefaultIfEmpty: !opts?.alwaysUpdate,
        alwaysUpdate: opts?.alwaysUpdate,
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
function boolState(id, name, def) {
    return {
        id,
        common: { name, type: "boolean", role: "indicator", read: true, write: false, def },
        defaultVal: def,
        setDefaultIfEmpty: true,
    };
}
async function ensureEmsLightStates(host, adapterVersion) {
    await (0, channels_1.ensureEmsLightChannels)(host);
    const defs = [
        strState("system.version", "EMS-Light Adapter-Version", adapterVersion, { alwaysUpdate: true }),
        strState("system.mode", "EMS-Light Modus", "ems_light"),
        strState("system.last_tick_at", "EMS-Light letzter Tick (ISO)"),
        strState("system.health", "EMS-Light Health", "initializing"),
        numState("live.battery.soc_pct", "Live Batterie SOC", "%"),
        numState("live.battery.capacity_kwh", "Live Batteriekapazität", "kWh"),
        numState("live.battery.pv_ac_power_w", "Live PV AC Leistung", "W"),
        numState("live.battery.house_load_w", "Live Hauslast (Verbrauch)", "W"),
        numState("live.thermal.buffer_temp_c", "Live Puffer-Temperatur", "°C"),
        numState("live.thermal.boiler_temp_c", "Live Boiler-Temperatur", "°C"),
        numState("live.pv.power_w", "Live PV-Leistung", "W"),
        numState("live.price.now_ct_per_kwh", "Live Strompreis jetzt", "ct/kWh"),
        strState("learning.house_load.status", "Learning Hauslast Status", "not_initialized"),
        strState("learning.battery_runtime.status", "Learning Batterie Runtime Status", "not_initialized"),
        strState("learning.thermal_runtime.status", "Learning Thermik Runtime Status", "not_initialized"),
        strState("operator.briefing_de", "Operator Briefing (DE)", OPERATOR_BRIEFING_DEFAULT),
        strState("operator.assessment.json", "Operative EMS-Einschätzung (JSON)", "{}"),
        strState("operator.assessment_de", "Operative EMS-Einschätzung (DE)", "EMS-Einschätzung noch nicht gebildet."),
        strState("operator.product_summary_de", "Produkt-Tageszusammenfassung (DE, deterministisch)", "Noch kein Unified Day Plan."),
        strState("operator.plan.battery_strategy_de", "Strategischer Batterieplan (DE)", ""),
        strState("operator.plan.wallbox_strategy_de", "Strategischer Wallboxplan (DE)", ""),
        strState("operator.notification.last_reason_de", "Letzter Notification-Hinweis (DE)", ""),
        strState("operator.notification.last_severity", "Letzte Notification-Severity", ""),
        strState("operator.notification.last_at", "Letzte Notification Zeit (ISO)", ""),
        strState("operator.execution.effective_json", "Effektive Ausführungsmodi (Global∧Add-on)", "{}"),
        strState("operator.execution.summary_de", "Effektive Ausführung Zusammenfassung (DE)", "Ausführung noch nicht synchronisiert."),
        // VIS: Diagnose-/Begründungsblock nur wenn Admin-Haken vis_show_diagnostics an.
        boolState("operator.vis.show_diagnostics", "VIS Diagnose / Begründungen anzeigen", false),
        // Read-only compact Tibber/Plan board for the operations dashboard (no planner math).
        strState("operator.vis.price_timeline_json", "VIS Preis-/Aktionsachse (JSON)", "{}"),
        // Roadmap Block 3.3: Live-Diagnose (Live-Cache + aktueller Daily-Plan-Slot) — ersetzt
        // die VIS-Anzeige von `planner.surplus_w`/`planner.deficit_w` (auslaufender Realtime-Planner).
        numState("operator.diagnostics.surplus_w", "Operator Live-PV-Überschuss", "W"),
        numState("operator.diagnostics.deficit_w", "Operator Live-PV-Unterdeckung", "W"),
        strState("operator.diagnostics.slot_start_iso", "Operator Diagnose aktueller Daily-Plan-Slot (ISO)"),
        strState("execution.safety.global_execution_mode", "Spiegel global.execution_mode"),
        strState("execution.safety.summary_de", "Execution Safety Zusammenfassung"),
        numState("economics.config.fixed_price_ct_per_kwh", "Economics Festpreis", "ct/kWh"),
        numState("economics.config.monthly_base_fee_eur", "Economics Grundgebühr/Monat", "EUR"),
        numState("economics.config.grid_fee_ct_per_kwh", "Economics Netzentgelt", "ct/kWh"),
        numState("economics.config.feed_in_ct_per_kwh", "Economics Einspeisevergütung", "ct/kWh"),
        numState("economics.config.battery_cycle_cost_ct_per_kwh", "Economics Batterie Zyklenkosten", "ct/kWh"),
        numState("economics.today.dynamic_cost_eur", "Economics heute dynamisch", "EUR"),
        numState("economics.today.fixed_tariff_cost_eur", "Economics heute Festpreis", "EUR"),
        numState("economics.today.savings_eur", "Economics heute Ersparnis", "EUR"),
        strState("economics.reason_de", "Economics Hinweis (DE)"),
    ];
    await (0, state_util_1.ensureStates)(host, defs);
}
exports.ensureEmsLightStates = ensureEmsLightStates;
