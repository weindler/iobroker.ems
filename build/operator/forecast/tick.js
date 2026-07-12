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
const plan_store_1 = require("../plan_store");
const states_1 = require("../contributions/flexible/states");
const grid_states_1 = require("../supply/grid_states");
const states_2 = require("./states");
let lastRevisionPayload = "";
let revision = 0;
let lastInputFingerprint = "";
let cachedPeriodicPlan = null;
/** Stable fingerprint: revision counters + learning timestamps (not sliding slot windows). */
async function forecastInputFingerprint(host) {
    const [gridRev, flexRev, pvUpd, houseUpd, weatherUpd] = await Promise.all([
        readNum(host, grid_states_1.GRID_SUPPLY_STATE_IDS.revision),
        readNum(host, states_1.FLEXIBLE_CONTRIBUTIONS_STATE_IDS.revision),
        readStr(host, "learning.pv_bias.last_update_ts"),
        readStr(host, "learning.house_load.last_update"),
        readStr(host, "learning.weather.last_update"),
    ]);
    return [gridRev, flexRev, pvUpd, houseUpd, weatherUpd].join("|");
}
async function loadPlanFromFile(host) {
    const planRaw = await (0, plan_store_1.readForecastPlanFile)(host);
    if (!(0, revision_1.isBootstrapForecastPlanJson)(planRaw))
        return null;
    const plan = (0, revision_1.parseForecastPlanFromJson)(planRaw);
    if (!(0, revision_1.isUsableStoredForecastPlan)(plan))
        return null;
    return plan;
}
function rememberPeriodicPlan(plan, fingerprint) {
    lastInputFingerprint = fingerprint;
    cachedPeriodicPlan = plan;
    lastRevisionPayload = (0, revision_1.forecastPlanRevisionPayload)(plan);
    revision = plan.revision;
}
function resetForecastPlanRevisionForTest() {
    lastRevisionPayload = "";
    revision = 0;
    lastInputFingerprint = "";
    cachedPeriodicPlan = null;
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
    if (semanticPayload === lastRevisionPayload && lastRevisionPayload !== "") {
        return {
            revisionChanged: false,
            nextRevision: revision,
            skipLargeJsonWrites: true,
            deferLargeJsonWrites: false,
            skipReason: "memory_cache",
            storedHash: semanticHash,
        };
    }
    const filePlan = await loadPlanFromFile(host);
    if (filePlan) {
        const fileHash = (0, revision_1.forecastPlanSemanticRevisionHash)(filePlan);
        if (fileHash === semanticHash) {
            lastRevisionPayload = semanticPayload;
            revision = filePlan.revision;
            return {
                revisionChanged: false,
                nextRevision: revision,
                skipLargeJsonWrites: true,
                deferLargeJsonWrites: false,
                skipReason: "file_hash_match",
                storedHash: fileHash,
            };
        }
    }
    const storedHash = await readStr(host, states_2.FORECAST_PLAN_STATE_IDS.semanticRevisionHash);
    if (storedHash === semanticHash) {
        lastRevisionPayload = semanticPayload;
        const storedRevision = await readNum(host, states_2.FORECAST_PLAN_STATE_IDS.revision);
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
    const statusRaw = await readStr(host, states_2.FORECAST_PLAN_STATE_IDS.status);
    if (!statusRaw || statusRaw === "not_initialized")
        return null;
    let planRaw = await (0, plan_store_1.readForecastPlanFile)(host);
    let migratedFromState = false;
    if (!(0, revision_1.isBootstrapForecastPlanJson)(planRaw)) {
        planRaw = await readStr(host, states_2.FORECAST_PLAN_STATE_IDS.planJson);
        migratedFromState = (0, revision_1.isBootstrapForecastPlanJson)(planRaw);
    }
    if (!(0, revision_1.isBootstrapForecastPlanJson)(planRaw))
        return null;
    const plan = (0, revision_1.parseForecastPlanFromJson)(planRaw);
    if (!(0, revision_1.isUsableStoredForecastPlan)(plan))
        return null;
    if (migratedFromState && planRaw) {
        void (0, plan_store_1.writeForecastPlanFile)(host, planRaw).catch((e) => {
            host.log?.warn?.(`forecast plan file migration: ${String(e)}`);
        });
    }
    const storedRevision = await readNum(host, states_2.FORECAST_PLAN_STATE_IDS.revision);
    if (storedRevision !== null && storedRevision >= 0) {
        plan.revision = storedRevision;
        revision = storedRevision;
    }
    lastRevisionPayload = (0, revision_1.forecastPlanRevisionPayload)(plan);
    return plan;
}
async function storedPlanSemanticallyMatches(host, plan, semanticHash) {
    const storedHash = await readStr(host, states_2.FORECAST_PLAN_STATE_IDS.semanticRevisionHash);
    if (storedHash === semanticHash)
        return true;
    const raw = await (0, plan_store_1.readForecastPlanFile)(host);
    const stored = (0, revision_1.parseForecastPlanFromJson)(raw);
    if (!stored)
        return false;
    return (0, revision_1.forecastPlanSemanticRevisionHash)(stored) === semanticHash;
}
function scheduleFirstInstallForecastPersist(host, plan, semanticHash, nextRevision) {
    (0, deferred_writes_1.scheduleDeferredForecastPlanWrite)(host, async () => {
        await persistForecastPlan(host, plan, semanticHash, nextRevision);
    });
}
/** Persist forecast plan — atomic file only (no ioBroker JSON/scalar writes; avoids native RSS spike). */
async function persistForecastPlan(host, plan, semanticHash, nextRevision) {
    const serialized = (0, serialization_1.serializeForecastPlanForWrites)(plan);
    const existingFile = await (0, plan_store_1.readForecastPlanFile)(host);
    if (existingFile === serialized.planJson) {
        host.log?.info?.("forecast plan persist: file bytes unchanged — skip write");
        lastRevisionPayload = (0, revision_1.forecastPlanRevisionPayload)(plan);
        return;
    }
    if (await storedPlanSemanticallyMatches(host, plan, semanticHash)) {
        host.log?.info?.("forecast plan persist: semantically unchanged — skip file write");
        lastRevisionPayload = (0, revision_1.forecastPlanRevisionPayload)(plan);
        return;
    }
    const planBytes = (0, forecast_plan_write_probe_1.utf8Bytes)(serialized.planJson);
    (0, forecast_plan_write_probe_1.logForecastPlanDuplicationReport)(host.log, {
        revisionChanged: true,
        semanticHash,
        fields: [
            {
                stateId: "forecast_plan.json",
                bytes: planBytes,
                slotCount: plan.slots.length,
                contributionCount: plan.contributions.length,
            },
        ],
        totalSerializedBytes: planBytes,
        uniqueSlotBytes: serialized.report.uniqueSlotBytes,
        uniqueContributionBytes: serialized.report.uniqueContributionBytes,
        duplicateSlotBytesVsPlanJson: 0,
        duplicateContributionBytesVsPlanJson: 0,
    });
    host.log?.info?.(`forecast plan file write: bytes=${planBytes} slots=${plan.slots.length}`);
    await (0, plan_store_1.writeForecastPlanFile)(host, serialized.planJson);
    revision = nextRevision;
    lastRevisionPayload = (0, revision_1.forecastPlanRevisionPayload)(plan);
    plan.revision = nextRevision;
}
async function runForecastPlanTick(host, gridForecast, flexibleContributions = [], options = {}) {
    const deferLargeJsonWrites = options.deferLargeJsonWrites ?? !(0, barrier_1.isBootstrapComplete)();
    if (deferLargeJsonWrites && !options.forceRebuild) {
        const cached = await loadCachedForecastPlanForBootstrap(host);
        if (cached) {
            host.log?.info?.(`forecast plan bootstrap: cached plan file revision=${cached.revision} slots=${cached.slots.length} — skip rebuild (periodic tick refreshes)`);
            const fp = await forecastInputFingerprint(host);
            rememberPeriodicPlan(cached, fp);
            return cached;
        }
    }
    const inputFingerprint = await forecastInputFingerprint(host);
    const inputsChanged = lastInputFingerprint !== "" && inputFingerprint !== lastInputFingerprint;
    const persistToDb = options.persistToDb !== false || inputsChanged;
    if ((0, barrier_1.isBootstrapComplete)() &&
        !options.forceRebuild &&
        inputFingerprint === lastInputFingerprint &&
        inputFingerprint !== "") {
        if (cachedPeriodicPlan) {
            host.log?.info?.(`forecast plan periodic: inputs unchanged — skip rebuild (revision=${cachedPeriodicPlan.revision})`);
            return cachedPeriodicPlan;
        }
        const fromFile = await loadPlanFromFile(host);
        if (fromFile) {
            host.log?.info?.(`forecast plan periodic: loaded file revision=${fromFile.revision} — skip rebuild`);
            rememberPeriodicPlan(fromFile, inputFingerprint);
            return fromFile;
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
    if (!resolution.skipLargeJsonWrites && resolution.revisionChanged) {
        if (await storedPlanSemanticallyMatches(host, plan, semanticHash)) {
            resolution = {
                ...resolution,
                skipLargeJsonWrites: true,
                deferLargeJsonWrites: false,
                skipReason: "semantic_plan_match",
            };
        }
    }
    host.log?.info?.([
        "forecast plan write decision:",
        `revisionChanged=${resolution.revisionChanged}`,
        `skipLargeJson=${resolution.skipLargeJsonWrites}`,
        `deferLargeJson=${resolution.deferLargeJsonWrites && !resolution.skipLargeJsonWrites}`,
        `persistToDb=${persistToDb}`,
        `skipReason=${resolution.skipReason}`,
        `storedHash=${resolution.storedHash?.slice(0, 12) ?? "none"}`,
        `computedHash=${semanticHash.slice(0, 12)}`,
    ].join(" "));
    if (persistToDb === false) {
        revision = resolution.nextRevision;
        lastRevisionPayload = semanticPayload;
        plan.revision = resolution.nextRevision;
        rememberPeriodicPlan(plan, inputFingerprint);
        return plan;
    }
    if (deferLargeJsonWrites && !options.forceRebuild) {
        scheduleFirstInstallForecastPersist(host, plan, semanticHash, resolution.nextRevision);
        host.log?.info?.(`forecast plan bootstrap: built_in_memory revision=${plan.revision} — defer file persist until adapter ready`);
        revision = resolution.nextRevision;
        lastRevisionPayload = semanticPayload;
        plan.revision = resolution.nextRevision;
        rememberPeriodicPlan(plan, inputFingerprint);
        return plan;
    }
    try {
        if (resolution.skipLargeJsonWrites) {
            revision = resolution.nextRevision;
            lastRevisionPayload = semanticPayload;
            plan.revision = resolution.nextRevision;
        }
        else {
            await persistForecastPlan(host, plan, semanticHash, resolution.nextRevision);
        }
        rememberPeriodicPlan(plan, inputFingerprint);
    }
    catch (e) {
        host.log?.warn?.(`forecast plan state write: ${String(e)}`);
        try {
            await (0, state_write_1.setStateIfChanged)(host, states_2.FORECAST_PLAN_STATE_IDS.status, "error");
            await (0, state_write_1.setStateIfChanged)(host, states_2.FORECAST_PLAN_STATE_IDS.reasonDe, `Forecast Plan Fehler: ${String(e)}`.slice(0, 480));
        }
        catch {
            // ignore secondary failure
        }
    }
    return plan;
}
exports.runForecastPlanTick = runForecastPlanTick;
