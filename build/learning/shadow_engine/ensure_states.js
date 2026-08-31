"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureShadowEngineStates = void 0;
const state_util_1 = require("../../ems_light/state_util");
function numState(id, name, unit) {
    return { id, common: { name, type: "number", role: "value", read: true, write: false, unit } };
}
function strState(id, name, def) {
    return {
        id,
        common: { name, type: "string", role: "text", read: true, write: false, def },
        defaultVal: def,
        setDefaultIfEmpty: true,
    };
}
/**
 * Kompakte Diagnose-/Status-States für Phase 5 (Shadow Engine). Die wirtschaftlich
 * aufbereiteten EUR-Kennzahlen (Tarifvorteil/EMS-Vorteil/KI-Mehrwert) leben in `src/economics/`
 * — hier nur der Simulations-Batch-Status selbst, um Doppel-Buchung/State-Flut zu vermeiden.
 */
async function ensureShadowEngineStates(host) {
    await (0, state_util_1.ensureChannel)(host, "learning.shadow_engine", "EMS-Light Learning Shadow/Counterfactual-Engine");
    const defs = [
        strState("learning.shadow_engine.status", "Shadow-Engine Status", "not_initialized"),
        strState("learning.shadow_engine.last_run_at", "Shadow-Engine letzter Lauf (ISO)"),
        strState("learning.shadow_engine.last_evaluated_date_key", "Shadow-Engine letzter simulierter Tag"),
        numState("learning.shadow_engine.evaluated_days_count", "Shadow-Engine simulierte Tage (Retention)"),
        numState("learning.shadow_engine.pending_backlog_count", "Shadow-Engine offene Tage im Backlog"),
        strState("learning.shadow_engine.last_error", "Shadow-Engine letzter Fehler", ""),
        numState("learning.shadow_engine.yesterday_real_net_cost_eur", "Shadow-Engine gestern real Netto-Kosten", "EUR"),
        numState("learning.shadow_engine.yesterday_reference_no_ems_net_cost_eur", "Shadow-Engine gestern reference_no_ems Netto-Kosten", "EUR"),
        numState("learning.shadow_engine.yesterday_ems_without_ai_net_cost_eur", "Shadow-Engine gestern ems_without_ai Netto-Kosten", "EUR"),
    ];
    await (0, state_util_1.ensureStates)(host, defs);
}
exports.ensureShadowEngineStates = ensureShadowEngineStates;
