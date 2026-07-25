"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureCompareStates = exports.COMPARE_STATES = exports.COMPARE_BASE = void 0;
const state_util_1 = require("../../ems_light/state_util");
exports.COMPARE_BASE = "compare";
exports.COMPARE_STATES = {
    planAChartJson: `${exports.COMPARE_BASE}.plan_a.chart_json`,
    planBChartJson: `${exports.COMPARE_BASE}.plan_b.chart_json`,
    activePlan: `${exports.COMPARE_BASE}.active_plan`,
    deltaSummaryJson: `${exports.COMPARE_BASE}.delta_summary_json`,
    generatedAt: `${exports.COMPARE_BASE}.generated_at`,
    planRevision: `${exports.COMPARE_BASE}.plan_revision`,
};
async function ensureCompareStates(host) {
    await (0, state_util_1.ensureChannel)(host, exports.COMPARE_BASE, "Plan-Vergleich (Plan A deterministisch, Plan B KI-Simulation)");
    await (0, state_util_1.ensureChannel)(host, `${exports.COMPARE_BASE}.plan_a`, "Plan A — deterministisch, tatsächlich ausgeführt");
    await (0, state_util_1.ensureChannel)(host, `${exports.COMPARE_BASE}.plan_b`, "Plan B — KI-gewichtete Simulation, nur zur Beobachtung");
    const defs = [
        {
            id: exports.COMPARE_STATES.planAChartJson,
            common: {
                name: "Plan A Zeitreihe (JSON) — [{t,pv_w,grid_w,ih_w,ac_w,price_ct}], für VIS",
                type: "string",
                role: "json",
                read: true,
                write: false,
                def: "[]",
            },
            defaultVal: "[]",
        },
        {
            id: exports.COMPARE_STATES.planBChartJson,
            common: {
                name: "Plan B Zeitreihe (JSON, Simulation) — [{t,pv_w,grid_w,ih_w,ac_w,price_ct}], für VIS",
                type: "string",
                role: "json",
                read: true,
                write: false,
                def: "[]",
            },
            defaultVal: "[]",
        },
        {
            id: exports.COMPARE_STATES.activePlan,
            common: {
                name: "Rechnerisch günstigerer Plan (nur Anzeige — EMS führt immer Plan A aus)",
                type: "string",
                role: "text",
                read: true,
                write: false,
                def: "a",
                states: { a: "Plan A (deterministisch)", b: "Plan B (KI-Simulation, günstiger)" },
            },
            defaultVal: "a",
        },
        {
            id: exports.COMPARE_STATES.deltaSummaryJson,
            common: {
                name: "Plan-Vergleich Zusammenfassung (JSON) — Kosten/PV/Netz/unallokiert A vs. B",
                type: "string",
                role: "json",
                read: true,
                write: false,
                def: "{}",
            },
            defaultVal: "{}",
        },
        {
            id: exports.COMPARE_STATES.generatedAt,
            common: { name: "Plan-Vergleich zuletzt berechnet", type: "string", role: "date", read: true, write: false, def: "" },
        },
        {
            id: exports.COMPARE_STATES.planRevision,
            common: {
                name: "Zugrundeliegende Daily-Plan-Revision",
                type: "number",
                role: "value",
                read: true,
                write: false,
                def: 0,
            },
            defaultVal: 0,
        },
    ];
    await (0, state_util_1.ensureStates)(host, defs);
}
exports.ensureCompareStates = ensureCompareStates;
