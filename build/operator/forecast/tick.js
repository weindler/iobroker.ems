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
async function loadCachedForecastPlanForBootstrap(host) {
    const statusRaw = await readStr(host, states_1.FORECAST_PLAN_STATE_IDS.status);
    if (!statusRaw || statusRaw === "not_initialized")
        return null;
    const planRaw = await readStr(host, states_1.FORECAST_PLAN_STATE_IDS.planJson);
    if (!(0, revision_1.isBootstrapForecastPlanJson)(planRaw))
        return null;
    const plan = (0, revision_1.parseForecastPlanFromJson)(planRaw);
    if (!(0, revision_1.isUsableStoredForecastPlan)(plan))
        return null;
    const storedRevision = await readNum(host, states_1.FORECAST_PLAN_STATE_IDS.revision);
    if (storedRevision !== null && storedRevision >= 0) {
        plan.revision = storedRevision;
        revision = storedRevision;
    }
    lastRevisionPayload = (0, revision_1.forecastPlanRevisionPayload)(plan);
    return plan;
}
async function storedPlanJsonMatches(host, planJson) {
    const stored = await readStr(host, states_1.FORECAST_PLAN_STATE_IDS.planJson);
    return stored === planJson;
}
function scheduleFirstInstallForecastPersist(host, plan, semanticHash, nextRevision) {
    (0, deferred_writes_1.scheduleDeferredForecastPlanWrite)(host, async () => {
        await persistForecastPlan(host, plan, semanticHash, nextRevision);
    });
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
async function writeJsonState(host, stateId, json, revisionRequired, counts) {
    const bytes = (0, forecast_plan_write_probe_1.utf8Bytes)(json);
    const meta = {
        stateId,
        revisionRequired,
        skipRead: false,
        slotCount: counts?.slotCount,
        contributionCount: counts?.contributionCount,
    };
    (0, forecast_plan_write_probe_1.logForecastPlanWriteProbe)(host.log, "before_payload", meta);
    (0, forecast_plan_write_probe_1.logForecastPlanWriteProbe)(host.log, "after_stringify", meta, { bytes });
    (0, forecast_plan_write_probe_1.logForecastPlanWriteProbe)(host.log, "before_setState", meta, { bytes });
    await (0, state_write_1.setStateIfChanged)(host, stateId, json);
    (0, forecast_plan_write_probe_1.logForecastPlanWriteProbe)(host.log, "after_setState", meta, { bytes });
}
/** Persist forecast plan — single plan_json IPC write (no duplicate mirror states). */
async function persistForecastPlan(host, plan, semanticHash, nextRevision) {
    const serialized = (0, serialization_1.serializeForecastPlanForWrites)(plan);
    if (await storedPlanJsonMatches(host, serialized.planJson)) {
        host.log?.info?.("forecast plan persist: plan_json unchanged — skip IPC write");
        await writeScalarState(host, states_1.FORECAST_PLAN_STATE_IDS.generatedAt, plan.generatedAt, undefined, false);
        if ((await readStr(host, states_1.FORECAST_PLAN_STATE_IDS.semanticRevisionHash)) !== semanticHash) {
            await writeScalarState(host, states_1.FORECAST_PLAN_STATE_IDS.semanticRevisionHash, semanticHash, undefined, true);
        }
        lastRevisionPayload = (0, revision_1.forecastPlanRevisionPayload)(plan);
        return;
    }
    (0, forecast_plan_write_probe_1.logForecastPlanDuplicationReport)(host.log, {
        revisionChanged: true,
        semanticHash,
        fields: [
            {
                stateId: "plan_json",
                bytes: serialized.report.fields.find((f) => f.stateId === "plan_json")?.bytes ?? (0, forecast_plan_write_probe_1.utf8Bytes)(serialized.planJson),
                slotCount: plan.slots.length,
                contributionCount: plan.contributions.length,
            },
        ],
        totalSerializedBytes: (0, forecast_plan_write_probe_1.utf8Bytes)(serialized.planJson),
        uniqueSlotBytes: serialized.report.uniqueSlotBytes,
        uniqueContributionBytes: serialized.report.uniqueContributionBytes,
        duplicateSlotBytesVsPlanJson: 0,
        duplicateContributionBytesVsPlanJson: 0,
    });
    await writeScalarState(host, states_1.FORECAST_PLAN_STATE_IDS.status, plan.status, undefined, true);
    await writeScalarState(host, states_1.FORECAST_PLAN_STATE_IDS.generatedAt, plan.generatedAt, undefined, false);
    await writeScalarState(host, states_1.FORECAST_PLAN_STATE_IDS.validUntil, plan.validUntil ?? "", undefined, true);
    await writeScalarState(host, states_1.FORECAST_PLAN_STATE_IDS.horizonStart, plan.horizonStart, undefined, false);
    await writeScalarState(host, states_1.FORECAST_PLAN_STATE_IDS.horizonEnd, plan.horizonEnd, undefined, true);
    await writeScalarState(host, states_1.FORECAST_PLAN_STATE_IDS.slotMinutes, plan.slotMinutes, undefined, true);
    await writeScalarState(host, states_1.FORECAST_PLAN_STATE_IDS.reasonDe, plan.reasonDe, undefined, true);
    await writeJsonState(host, states_1.FORECAST_PLAN_STATE_IDS.planJson, serialized.planJson, true, { slotCount: plan.slots.length, contributionCount: plan.contributions.length });
    await writeScalarState(host, states_1.FORECAST_PLAN_STATE_IDS.revision, nextRevision, undefined, true);
    await writeScalarState(host, states_1.FORECAST_PLAN_STATE_IDS.semanticRevisionHash, semanticHash, undefined, true);
    revision = nextRevision;
    lastRevisionPayload = (0, revision_1.forecastPlanRevisionPayload)(plan);
    plan.revision = nextRevision;
}
async function runForecastPlanTick(host, gridForecast, flexibleContributions = [], options = {}) {
    const deferLargeJsonWrites = options.deferLargeJsonWrites ?? !(0, barrier_1.isBootstrapComplete)();
    if (deferLargeJsonWrites && !options.forceRebuild) {
        const cached = await loadCachedForecastPlanForBootstrap(host);
        if (cached) {
            host.log?.info?.(`forecast plan bootstrap: cached plan_json revision=${cached.revision} slots=${cached.slots.length} — skip rebuild (periodic tick refreshes)`);
            return cached;
        }
    }
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
    let resolution = await resolveForecastRevisionChange(host, semanticPayload, semanticHash, deferLargeJsonWrites);
    plan.revision = resolution.nextRevision;
    let serialized = null;
    if (!resolution.skipLargeJsonWrites && resolution.revisionChanged) {
        serialized = (0, serialization_1.serializeForecastPlanForWrites)(plan);
        if (await storedPlanJsonMatches(host, serialized.planJson)) {
            resolution = {
                ...resolution,
                skipLargeJsonWrites: true,
                deferLargeJsonWrites: false,
                skipReason: "plan_json_match",
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
    if (deferLargeJsonWrites && !options.forceRebuild) {
        scheduleFirstInstallForecastPersist(host, plan, semanticHash, resolution.nextRevision);
        host.log?.info?.(`forecast plan bootstrap: built_in_memory revision=${plan.revision} — defer plan_json until adapter ready`);
        revision = resolution.nextRevision;
        lastRevisionPayload = semanticPayload;
        return plan;
    }
    try {
        if (resolution.skipLargeJsonWrites) {
            await writeScalarState(host, states_1.FORECAST_PLAN_STATE_IDS.generatedAt, plan.generatedAt, undefined, false);
            if (resolution.storedHash !== semanticHash) {
                await writeScalarState(host, states_1.FORECAST_PLAN_STATE_IDS.semanticRevisionHash, semanticHash, undefined, true);
            }
            if (resolution.revisionChanged) {
                await writeScalarState(host, states_1.FORECAST_PLAN_STATE_IDS.revision, resolution.nextRevision, undefined, true);
                revision = resolution.nextRevision;
                lastRevisionPayload = semanticPayload;
            }
        }
        else {
            await persistForecastPlan(host, plan, semanticHash, resolution.nextRevision);
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
