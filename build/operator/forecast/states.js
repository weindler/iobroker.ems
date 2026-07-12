"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureForecastPlanStates = exports.FORECAST_PLAN_STATE_IDS = void 0;
const state_util_1 = require("../../ems_light/state_util");
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
exports.FORECAST_PLAN_STATE_IDS = {
    status: "planner.intent.forecast_plan.status",
    generatedAt: "planner.intent.forecast_plan.generated_at",
    validUntil: "planner.intent.forecast_plan.valid_until",
    horizonStart: "planner.intent.forecast_plan.horizon_start",
    horizonEnd: "planner.intent.forecast_plan.horizon_end",
    slotMinutes: "planner.intent.forecast_plan.slot_minutes",
    activeContributorsJson: "planner.intent.forecast_plan.active_contributors_json",
    excludedContributorsJson: "planner.intent.forecast_plan.excluded_contributors_json",
    daysJson: "planner.intent.forecast_plan.days_json",
    slotsJson: "planner.intent.forecast_plan.slots_json",
    contributionsJson: "planner.intent.forecast_plan.contributions_json",
    planJson: "planner.intent.forecast_plan.plan_json",
    reasonDe: "planner.intent.forecast_plan.reason_de",
    revision: "planner.intent.forecast_plan.revision",
    semanticRevisionHash: "planner.intent.forecast_plan.semantic_revision_hash",
};
async function ensureForecastPlanStates(host) {
    await (0, state_util_1.ensureChannel)(host, "planner.intent.forecast_plan", "Planner Forecast Plan");
    const defs = [
        strState(exports.FORECAST_PLAN_STATE_IDS.status, "Forecast Plan Status", "not_initialized"),
        strState(exports.FORECAST_PLAN_STATE_IDS.generatedAt, "Forecast Plan erzeugt (ISO)"),
        strState(exports.FORECAST_PLAN_STATE_IDS.validUntil, "Forecast Plan gültig bis (ISO)"),
        strState(exports.FORECAST_PLAN_STATE_IDS.horizonStart, "Forecast Plan Horizont Start (ISO)"),
        strState(exports.FORECAST_PLAN_STATE_IDS.horizonEnd, "Forecast Plan Horizont Ende (ISO)"),
        numState(exports.FORECAST_PLAN_STATE_IDS.slotMinutes, "Forecast Plan Slot-Minuten", 15),
        strState(exports.FORECAST_PLAN_STATE_IDS.activeContributorsJson, "Forecast Plan aktive Contributors (JSON)", "[]"),
        strState(exports.FORECAST_PLAN_STATE_IDS.excludedContributorsJson, "Forecast Plan ausgeschlossene Contributors (JSON)", "[]"),
        strState(exports.FORECAST_PLAN_STATE_IDS.daysJson, "Forecast Plan Tage (JSON)", "[]"),
        strState(exports.FORECAST_PLAN_STATE_IDS.slotsJson, "Forecast Plan Slots (JSON)", "[]"),
        strState(exports.FORECAST_PLAN_STATE_IDS.contributionsJson, "Forecast Plan Contributions (JSON)", "[]"),
        strState(exports.FORECAST_PLAN_STATE_IDS.planJson, "Forecast Plan vollständig (JSON)", "{}"),
        strState(exports.FORECAST_PLAN_STATE_IDS.reasonDe, "Forecast Plan Begründung (DE)", ""),
        numState(exports.FORECAST_PLAN_STATE_IDS.revision, "Forecast Plan Revision", 0),
        strState(exports.FORECAST_PLAN_STATE_IDS.semanticRevisionHash, "Forecast Plan semantischer Revisions-Hash", ""),
    ];
    await (0, state_util_1.ensureStates)(host, defs);
}
exports.ensureForecastPlanStates = ensureForecastPlanStates;
