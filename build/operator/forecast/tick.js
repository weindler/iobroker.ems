"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runForecastPlanTick = exports.resolveForecastRevisionChangeForTest = exports.forecastPlanRevisionForTest = exports.resetForecastPlanRevisionForTest = void 0;
const forecast_plan_write_probe_1 = require("../../diagnostics/forecast_plan_write_probe");
const state_write_1 = require("../../policy/core/state_write");
const read_1 = require("../contributions/read");
const build_1 = require("./build");
const revision_1 = require("./revision");
const serialization_1 = require("./serialization");
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
async function readStr(host, relId) {
    try {
        const st = await host.getStateAsync(relId);
        if (st?.val == null || st.val === "")
            return null;
        return String(st.val);
    }
    catch {
        return null;
    }
}
async function readNum(host, relId) {
    const raw = await readStr(host, relId);
    if (raw === null)
        return null;
    const n = parseFloat(raw);
    return Number.isFinite(n) ? n : null;
}
async function resolveForecastRevisionChange(host, semanticPayload, semanticHash) {
    if (semanticPayload === lastRevisionPayload && lastRevisionPayload !== "") {
        return { revisionChanged: false, nextRevision: revision };
    }
    const storedHash = await readStr(host, states_1.FORECAST_PLAN_STATE_IDS.semanticRevisionHash);
    if (storedHash === semanticHash) {
        lastRevisionPayload = semanticPayload;
        const storedRevision = await readNum(host, states_1.FORECAST_PLAN_STATE_IDS.revision);
        if (storedRevision !== null && storedRevision >= 0) {
            revision = storedRevision;
        }
        return { revisionChanged: false, nextRevision: revision };
    }
    return {
        revisionChanged: true,
        nextRevision: revision + 1,
    };
}
/** @internal test hook */
async function resolveForecastRevisionChangeForTest(host, semanticPayload, semanticHash) {
    return resolveForecastRevisionChange(host, semanticPayload, semanticHash);
}
exports.resolveForecastRevisionChangeForTest = resolveForecastRevisionChangeForTest;
async function writeScalarState(host, stateId, val, writeOpts, revisionRequired) {
    const meta = {
        stateId,
        revisionRequired,
        skipRead: writeOpts?.skipRead === true,
    };
    (0, forecast_plan_write_probe_1.logForecastPlanWriteProbe)(host.log, "before_write", meta);
    await (0, state_write_1.setStateIfChanged)(host, stateId, val, writeOpts);
    (0, forecast_plan_write_probe_1.logForecastPlanWriteProbe)(host.log, "after_write", meta);
}
async function writeJsonState(host, stateId, json, writeOpts, revisionRequired, counts, dup) {
    const bytes = (0, forecast_plan_write_probe_1.utf8Bytes)(json);
    const meta = {
        stateId,
        revisionRequired,
        skipRead: writeOpts?.skipRead === true,
        slotCount: counts?.slotCount,
        contributionCount: counts?.contributionCount,
        duplicateSlotsVsPlanJson: dup?.duplicateSlotsVsPlanJson,
        duplicateContributionsVsPlanJson: dup?.duplicateContributionsVsPlanJson,
    };
    (0, forecast_plan_write_probe_1.logForecastPlanWriteProbe)(host.log, "before_payload", meta);
    (0, forecast_plan_write_probe_1.logForecastPlanWriteProbe)(host.log, "after_stringify", meta, { bytes });
    (0, forecast_plan_write_probe_1.logForecastPlanWriteProbe)(host.log, "before_setState", meta, { bytes });
    await (0, state_write_1.setStateIfChanged)(host, stateId, json, writeOpts);
    (0, forecast_plan_write_probe_1.logForecastPlanWriteProbe)(host.log, "after_setState", meta, { bytes });
}
async function runForecastPlanTick(host, gridForecast, flexibleContributions = []) {
    const now = new Date();
    const collected = await (0, read_1.collectContributions)(host, now, gridForecast);
    const contributions = [...collected.contributions, ...flexibleContributions];
    const plan = (0, build_1.buildForecastPlan)({
        now,
        timezone: collected.timezone,
        contributions,
    });
    const semanticPayload = (0, revision_1.forecastPlanRevisionPayload)(plan);
    const semanticHash = (0, revision_1.forecastPlanSemanticRevisionHash)(plan);
    const { revisionChanged, nextRevision } = await resolveForecastRevisionChange(host, semanticPayload, semanticHash);
    plan.revision = nextRevision;
    const writeOpts = revisionChanged ? { skipRead: true } : undefined;
    try {
        await writeScalarState(host, states_1.FORECAST_PLAN_STATE_IDS.status, plan.status, writeOpts, revisionChanged);
        await writeScalarState(host, states_1.FORECAST_PLAN_STATE_IDS.generatedAt, plan.generatedAt, undefined, false);
        await writeScalarState(host, states_1.FORECAST_PLAN_STATE_IDS.validUntil, plan.validUntil ?? "", writeOpts, revisionChanged);
        await writeScalarState(host, states_1.FORECAST_PLAN_STATE_IDS.horizonStart, plan.horizonStart, undefined, false);
        await writeScalarState(host, states_1.FORECAST_PLAN_STATE_IDS.horizonEnd, plan.horizonEnd, writeOpts, revisionChanged);
        await writeScalarState(host, states_1.FORECAST_PLAN_STATE_IDS.slotMinutes, plan.slotMinutes, writeOpts, revisionChanged);
        if (revisionChanged) {
            const serialized = (0, serialization_1.serializeForecastPlanForWrites)(plan);
            (0, forecast_plan_write_probe_1.logForecastPlanDuplicationReport)(host.log, {
                revisionChanged,
                semanticHash,
                fields: serialized.report.fields.map((f) => ({
                    stateId: f.stateId,
                    bytes: f.bytes,
                    slotCount: f.slotCount,
                    contributionCount: f.contributionCount,
                })),
                totalSerializedBytes: serialized.report.totalSerializedBytes,
                uniqueSlotBytes: serialized.report.uniqueSlotBytes,
                uniqueContributionBytes: serialized.report.uniqueContributionBytes,
                duplicateSlotBytesVsPlanJson: serialized.report.duplicateSlotBytesVsPlanJson,
                duplicateContributionBytesVsPlanJson: serialized.report.duplicateContributionBytesVsPlanJson,
            });
            await writeJsonState(host, states_1.FORECAST_PLAN_STATE_IDS.activeContributorsJson, serialized.activeContributorsJson, writeOpts, true);
            await writeJsonState(host, states_1.FORECAST_PLAN_STATE_IDS.excludedContributorsJson, serialized.excludedContributorsJson, writeOpts, true);
            await writeJsonState(host, states_1.FORECAST_PLAN_STATE_IDS.daysJson, serialized.daysJson, writeOpts, true);
            await writeJsonState(host, states_1.FORECAST_PLAN_STATE_IDS.slotsJson, serialized.slotsJson, writeOpts, true, { slotCount: plan.slots.length });
            await writeJsonState(host, states_1.FORECAST_PLAN_STATE_IDS.contributionsJson, serialized.contributionsJson, writeOpts, true, { contributionCount: plan.contributions.length });
            await writeJsonState(host, states_1.FORECAST_PLAN_STATE_IDS.planJson, serialized.planJson, writeOpts, true, { slotCount: plan.slots.length, contributionCount: plan.contributions.length }, {
                duplicateSlotsVsPlanJson: serialized.report.duplicateSlotBytesVsPlanJson,
                duplicateContributionsVsPlanJson: serialized.report.duplicateContributionBytesVsPlanJson,
            });
        }
        await writeScalarState(host, states_1.FORECAST_PLAN_STATE_IDS.reasonDe, plan.reasonDe, writeOpts, revisionChanged);
        await writeScalarState(host, states_1.FORECAST_PLAN_STATE_IDS.revision, nextRevision, writeOpts, revisionChanged);
        // Persist semantic hash only after all other writes succeeded.
        await writeScalarState(host, states_1.FORECAST_PLAN_STATE_IDS.semanticRevisionHash, semanticHash, writeOpts, revisionChanged);
        if (revisionChanged) {
            revision = nextRevision;
            lastRevisionPayload = semanticPayload;
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
