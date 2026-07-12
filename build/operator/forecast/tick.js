"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runForecastPlanTick = exports.forecastPlanRevisionForTest = exports.resetForecastPlanRevisionForTest = void 0;
const state_write_1 = require("../../policy/core/state_write");
const read_1 = require("../contributions/read");
const build_1 = require("./build");
const states_1 = require("./states");
let lastRevisionPayload = "";
let revision = 0;
function resetForecastPlanRevisionForTest() {
    lastRevisionPayload = "";
    revision = 0;
}
exports.resetForecastPlanRevisionForTest = resetForecastPlanRevisionForTest;
function forecastPlanRevisionForTest() {
    return revision;
}
exports.forecastPlanRevisionForTest = forecastPlanRevisionForTest;
async function runForecastPlanTick(host, gridForecast, flexibleContributions = []) {
    const now = new Date();
    const collected = await (0, read_1.collectContributions)(host, now, gridForecast);
    const contributions = [...collected.contributions, ...flexibleContributions];
    const plan = (0, build_1.buildForecastPlan)({
        now,
        timezone: collected.timezone,
        contributions,
    });
    const payload = (0, build_1.forecastPlanRevisionPayload)(plan);
    const revisionChanged = payload !== lastRevisionPayload;
    const nextRevision = revisionChanged ? revision + 1 : revision;
    plan.revision = nextRevision;
    const writeOpts = revisionChanged ? { skipRead: true } : undefined;
    try {
        await (0, state_write_1.setStateIfChanged)(host, states_1.FORECAST_PLAN_STATE_IDS.status, plan.status, writeOpts);
        await (0, state_write_1.setStateIfChanged)(host, states_1.FORECAST_PLAN_STATE_IDS.generatedAt, plan.generatedAt, writeOpts);
        await (0, state_write_1.setStateIfChanged)(host, states_1.FORECAST_PLAN_STATE_IDS.validUntil, plan.validUntil ?? "", writeOpts);
        await (0, state_write_1.setStateIfChanged)(host, states_1.FORECAST_PLAN_STATE_IDS.horizonStart, plan.horizonStart, writeOpts);
        await (0, state_write_1.setStateIfChanged)(host, states_1.FORECAST_PLAN_STATE_IDS.horizonEnd, plan.horizonEnd, writeOpts);
        await (0, state_write_1.setStateIfChanged)(host, states_1.FORECAST_PLAN_STATE_IDS.slotMinutes, plan.slotMinutes, writeOpts);
        await (0, state_write_1.setStateIfChanged)(host, states_1.FORECAST_PLAN_STATE_IDS.activeContributorsJson, JSON.stringify(plan.activeContributors), writeOpts);
        await (0, state_write_1.setStateIfChanged)(host, states_1.FORECAST_PLAN_STATE_IDS.excludedContributorsJson, JSON.stringify(plan.excludedContributors), writeOpts);
        await (0, state_write_1.setStateIfChanged)(host, states_1.FORECAST_PLAN_STATE_IDS.daysJson, JSON.stringify(plan.days), writeOpts);
        await (0, state_write_1.setStateIfChanged)(host, states_1.FORECAST_PLAN_STATE_IDS.slotsJson, JSON.stringify(plan.slots), writeOpts);
        await (0, state_write_1.setStateIfChanged)(host, states_1.FORECAST_PLAN_STATE_IDS.contributionsJson, JSON.stringify(plan.contributions), writeOpts);
        await (0, state_write_1.setStateIfChanged)(host, states_1.FORECAST_PLAN_STATE_IDS.planJson, JSON.stringify(plan), writeOpts);
        await (0, state_write_1.setStateIfChanged)(host, states_1.FORECAST_PLAN_STATE_IDS.reasonDe, plan.reasonDe, writeOpts);
        await (0, state_write_1.setStateIfChanged)(host, states_1.FORECAST_PLAN_STATE_IDS.revision, nextRevision, writeOpts);
        if (revisionChanged) {
            revision = nextRevision;
            lastRevisionPayload = payload;
        }
    }
    catch (e) {
        host.log?.warn?.(`forecast plan state write: ${String(e)}`);
        try {
            await (0, state_write_1.setStateIfChanged)(host, states_1.FORECAST_PLAN_STATE_IDS.status, "error");
            await (0, state_write_1.setStateIfChanged)(host, states_1.FORECAST_PLAN_STATE_IDS.reasonDe, `Forecast Plan Fehler: ${String(e)}`.slice(0, 480));
        }
        catch {
            // ignore secondary failure
        }
    }
    return plan;
}
exports.runForecastPlanTick = runForecastPlanTick;
