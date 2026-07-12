"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runForecastPlanTick = exports.resolveForecastRevisionChangeForTest = exports.forecastPlanRevisionForTest = exports.resetForecastPlanRevisionForTest = void 0;
const forecast_plan_write_probe_1 = require("../../diagnostics/forecast_plan_write_probe");
const barrier_1 = require("../../bootstrap/barrier");
const state_write_1 = require("../../policy/core/state_write");
const read_1 = require("../contributions/read");
const build_1 = require("./build");
const revision_1 = require("./revision");
const deferred_writes_1 = require("./deferred_writes");
const serialization_1 = require("./serialization");
const states_1 = require("./states");
let lastRevisionPayload = "";
let revision = 0;
function resetForecastPlanRevisionForTest() {
    lastRevisionPayload = "";
    revision = 0;
    (0, deferred_writes_1.clearDeferredForecastPlanWriteForTest)();
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
async function resolveForecastRevisionChange(host, semanticPayload, semanticHash, deferLargeJsonWrites) {
    const storedHash = await readStr(host, states_1.FORECAST_PLAN_STATE_IDS.semanticRevisionHash);
    if (semanticPayload === lastRevisionPayload && lastRevisionPayload !== "") {
        return {
            revisionChanged: false,
            nextRevision: revision,
            skipLargeJsonWrites: true,
            deferLargeJsonWrites: false,
            skipReason: "memory_cache",
            storedHash,
        };
    }
    if (storedHash === semanticHash) {
        lastRevisionPayload = semanticPayload;
        const storedRevision = await readNum(host, states_1.FORECAST_PLAN_STATE_IDS.revision);
        if (storedRevision !== null && storedRevision >= 0) {
            revision = storedRevision;
        }
        return {
            revisionChanged: false,
            nextRevision: revision,
            skipLargeJsonWrites: true,
            deferLargeJsonWrites: false,
            skipReason: "stored_hash_match",
            storedHash,
        };
    }
    return {
        revisionChanged: true,
        nextRevision: revision + 1,
        skipLargeJsonWrites: false,
        deferLargeJsonWrites: deferLargeJsonWrites,
        skipReason: "semantic_hash_changed",
        storedHash,
    };
}
/** @internal test hook */
async function resolveForecastRevisionChangeForTest(host, semanticPayload, semanticHash, deferLargeJsonWrites = false) {
    return resolveForecastRevisionChange(host, semanticPayload, semanticHash, deferLargeJsonWrites);
}
exports.resolveForecastRevisionChangeForTest = resolveForecastRevisionChangeForTest;
async function allMirrorJsonMatches(host, serialized) {
    const pairs = [
        [states_1.FORECAST_PLAN_STATE_IDS.activeContributorsJson, serialized.activeContributorsJson],
        [states_1.FORECAST_PLAN_STATE_IDS.excludedContributorsJson, serialized.excludedContributorsJson],
        [states_1.FORECAST_PLAN_STATE_IDS.daysJson, serialized.daysJson],
        [states_1.FORECAST_PLAN_STATE_IDS.slotsJson, serialized.slotsJson],
        [states_1.FORECAST_PLAN_STATE_IDS.contributionsJson, serialized.contributionsJson],
        [states_1.FORECAST_PLAN_STATE_IDS.planJson, serialized.planJson],
    ];
    for (const [stateId, json] of pairs) {
        const stored = await readStr(host, stateId);
        if (stored !== json)
            return false;
    }
    return true;
}
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
async function writeJsonState(host, stateId, json, revisionRequired, counts, dup) {
    const bytes = (0, forecast_plan_write_probe_1.utf8Bytes)(json);
    const meta = {
        stateId,
        revisionRequired,
        skipRead: false,
        slotCount: counts?.slotCount,
        contributionCount: counts?.contributionCount,
        duplicateSlotsVsPlanJson: dup?.duplicateSlotsVsPlanJson,
        duplicateContributionsVsPlanJson: dup?.duplicateContributionsVsPlanJson,
    };
    (0, forecast_plan_write_probe_1.logForecastPlanWriteProbe)(host.log, "before_payload", meta);
    (0, forecast_plan_write_probe_1.logForecastPlanWriteProbe)(host.log, "after_stringify", meta, { bytes });
    (0, forecast_plan_write_probe_1.logForecastPlanWriteProbe)(host.log, "before_setState", meta, { bytes });
    await (0, state_write_1.setStateIfChanged)(host, stateId, json);
    (0, forecast_plan_write_probe_1.logForecastPlanWriteProbe)(host.log, "after_setState", meta, { bytes });
}
async function writeLargeJsonStates(host, plan, serialized, semanticHash, nextRevision) {
    (0, forecast_plan_write_probe_1.logForecastPlanDuplicationReport)(host.log, {
        revisionChanged: true,
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
    await writeJsonState(host, states_1.FORECAST_PLAN_STATE_IDS.activeContributorsJson, serialized.activeContributorsJson, true);
    await writeJsonState(host, states_1.FORECAST_PLAN_STATE_IDS.excludedContributorsJson, serialized.excludedContributorsJson, true);
    await writeJsonState(host, states_1.FORECAST_PLAN_STATE_IDS.daysJson, serialized.daysJson, true);
    await writeJsonState(host, states_1.FORECAST_PLAN_STATE_IDS.slotsJson, serialized.slotsJson, true, { slotCount: plan.slots.length });
    await writeJsonState(host, states_1.FORECAST_PLAN_STATE_IDS.contributionsJson, serialized.contributionsJson, true, { contributionCount: plan.contributions.length });
    await writeJsonState(host, states_1.FORECAST_PLAN_STATE_IDS.planJson, serialized.planJson, true, { slotCount: plan.slots.length, contributionCount: plan.contributions.length }, {
        duplicateSlotsVsPlanJson: serialized.report.duplicateSlotBytesVsPlanJson,
        duplicateContributionsVsPlanJson: serialized.report.duplicateContributionBytesVsPlanJson,
    });
    await writeScalarState(host, states_1.FORECAST_PLAN_STATE_IDS.revision, nextRevision, undefined, true);
    await writeScalarState(host, states_1.FORECAST_PLAN_STATE_IDS.semanticRevisionHash, semanticHash, undefined, true);
    revision = nextRevision;
    lastRevisionPayload = (0, revision_1.forecastPlanRevisionPayload)(plan);
}
async function runForecastPlanTick(host, gridForecast, flexibleContributions = [], options = {}) {
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
    const deferLargeJsonWrites = options.deferLargeJsonWrites ?? !(0, barrier_1.isBootstrapComplete)();
    let resolution = await resolveForecastRevisionChange(host, semanticPayload, semanticHash, deferLargeJsonWrites);
    plan.revision = resolution.nextRevision;
    let serialized = null;
    if (!resolution.skipLargeJsonWrites && resolution.revisionChanged) {
        serialized = (0, serialization_1.serializeForecastPlanForWrites)(plan);
        if (await allMirrorJsonMatches(host, serialized)) {
            resolution = {
                ...resolution,
                skipLargeJsonWrites: true,
                deferLargeJsonWrites: false,
                skipReason: "mirror_json_match",
            };
        }
    }
    host.log?.info?.([
        "forecast plan write decision:",
        `revisionChanged=${resolution.revisionChanged}`,
        `skipLargeJson=${resolution.skipLargeJsonWrites}`,
        `deferLargeJson=${resolution.deferLargeJsonWrites && !resolution.skipLargeJsonWrites}`,
        `skipReason=${resolution.skipReason}`,
        `storedHash=${resolution.storedHash?.slice(0, 12) ?? "none"}`,
        `computedHash=${semanticHash.slice(0, 12)}`,
    ].join(" "));
    try {
        await writeScalarState(host, states_1.FORECAST_PLAN_STATE_IDS.status, plan.status, undefined, resolution.revisionChanged);
        await writeScalarState(host, states_1.FORECAST_PLAN_STATE_IDS.generatedAt, plan.generatedAt, undefined, false);
        await writeScalarState(host, states_1.FORECAST_PLAN_STATE_IDS.validUntil, plan.validUntil ?? "", undefined, resolution.revisionChanged);
        await writeScalarState(host, states_1.FORECAST_PLAN_STATE_IDS.horizonStart, plan.horizonStart, undefined, false);
        await writeScalarState(host, states_1.FORECAST_PLAN_STATE_IDS.horizonEnd, plan.horizonEnd, undefined, resolution.revisionChanged);
        await writeScalarState(host, states_1.FORECAST_PLAN_STATE_IDS.slotMinutes, plan.slotMinutes, undefined, resolution.revisionChanged);
        await writeScalarState(host, states_1.FORECAST_PLAN_STATE_IDS.reasonDe, plan.reasonDe, undefined, resolution.revisionChanged);
        if (resolution.skipLargeJsonWrites) {
            if (resolution.storedHash !== semanticHash) {
                await writeScalarState(host, states_1.FORECAST_PLAN_STATE_IDS.semanticRevisionHash, semanticHash, undefined, true);
            }
            if (resolution.revisionChanged) {
                await writeScalarState(host, states_1.FORECAST_PLAN_STATE_IDS.revision, resolution.nextRevision, undefined, true);
                revision = resolution.nextRevision;
                lastRevisionPayload = semanticPayload;
            }
        }
        else if (resolution.deferLargeJsonWrites && serialized) {
            const capturedPlan = plan;
            const capturedSerialized = serialized;
            const capturedRevision = resolution.nextRevision;
            (0, deferred_writes_1.scheduleDeferredForecastPlanWrite)(host, async () => {
                await writeLargeJsonStates(host, capturedPlan, capturedSerialized, semanticHash, capturedRevision);
                await writeScalarState(host, states_1.FORECAST_PLAN_STATE_IDS.status, capturedPlan.status, undefined, true);
                await writeScalarState(host, states_1.FORECAST_PLAN_STATE_IDS.validUntil, capturedPlan.validUntil ?? "", undefined, true);
                await writeScalarState(host, states_1.FORECAST_PLAN_STATE_IDS.horizonEnd, capturedPlan.horizonEnd, undefined, true);
                await writeScalarState(host, states_1.FORECAST_PLAN_STATE_IDS.slotMinutes, capturedPlan.slotMinutes, undefined, true);
                await writeScalarState(host, states_1.FORECAST_PLAN_STATE_IDS.reasonDe, capturedPlan.reasonDe, undefined, true);
            });
            revision = resolution.nextRevision;
            lastRevisionPayload = semanticPayload;
        }
        else if (serialized) {
            await writeLargeJsonStates(host, plan, serialized, semanticHash, resolution.nextRevision);
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
