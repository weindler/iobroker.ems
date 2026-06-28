"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resetIntentEngineForTest = exports.getLastResolvedWallboxIntentForTest = exports.stopIntentEngine = exports.handleIntentStateChange = exports.initIntentEngine = exports.submitThermalControlFromRuntime = exports.runIntentEngine = void 0;
const state_write_1 = require("../policy/core/state_write");
const addon_active_1 = require("./core/addon_active");
const aggregate_1 = require("./core/aggregate");
const expiry_1 = require("./core/expiry");
const revision_1 = require("./core/revision");
const constants_1 = require("./core/constants");
const config_1 = require("./config");
const ensure_states_1 = require("./ensure_states");
const persist_1 = require("./persist");
const evcc_1 = require("./sources/evcc");
const admin_1 = require("./sources/admin");
const iobroker_1 = require("./sources/iobroker");
const iobroker_thermal_1 = require("./sources/iobroker_thermal");
const iobroker_battery_1 = require("./sources/iobroker_battery");
const resolve_1 = require("./wallbox/resolve");
const validation_1 = require("./wallbox/validation");
const types_1 = require("./wallbox/types");
const resolve_2 = require("./thermal/resolve");
const validation_2 = require("./thermal/validation");
const types_2 = require("./thermal/types");
const resolve_3 = require("./battery/resolve");
const validation_3 = require("./battery/validation");
const types_3 = require("./battery/types");
const index_1 = require("../addons/immersion_heater/index");
const control_1 = require("./thermal/control");
let engineActive = false;
let subscribedHost = null;
let lastWallbox = null;
let lastThermal = null;
let lastBattery = null;
let lastResolvedAll = null;
let wallboxSnapshot = null;
let thermalSnapshot = null;
let batterySnapshot = null;
let lastRequestIds = { wallbox: null, thermal: null, battery: null };
let evccDebounceTimer = null;
let expiryTimer = null;
const subscribedPatterns = [];
const subscribedForeignIds = [];
function clearEvccDebounce() {
    if (evccDebounceTimer) {
        clearTimeout(evccDebounceTimer);
        evccDebounceTimer = null;
    }
}
function clearExpiryTimer() {
    if (expiryTimer) {
        clearTimeout(expiryTimer);
        expiryTimer = null;
    }
}
function scheduleEvccRerun(host) {
    if (!engineActive)
        return;
    clearEvccDebounce();
    evccDebounceTimer = setTimeout(() => {
        evccDebounceTimer = null;
        if (!engineActive)
            return;
        void runIntentEngine(host).catch((e) => host.log.warn(`Intent Engine EVCC re-run: ${e}`));
    }, constants_1.EVCC_INTENT_DEBOUNCE_MS);
}
function scheduleExpiryRerun(host, now) {
    clearExpiryTimer();
    if (!engineActive)
        return;
    const times = (0, expiry_1.collectExpiryTimes)(now, [
        (0, iobroker_1.snapshotToManualOverride)(wallboxSnapshot),
        (0, iobroker_thermal_1.snapshotToThermalManualOverride)(thermalSnapshot),
        (0, iobroker_battery_1.snapshotToBatteryManualOverride)(batterySnapshot),
    ]);
    const delay = (0, expiry_1.nextExpiryDelayMs)(now, times);
    if (delay === null)
        return;
    expiryTimer = setTimeout(() => {
        expiryTimer = null;
        if (!engineActive)
            return;
        void runIntentEngine(host).catch((e) => host.log.warn(`Intent Engine expiry re-run: ${e}`));
    }, delay);
}
async function writeWallboxMirror(host, intent) {
    await (0, state_write_1.setStateIfChanged)(host, "user_intent.wallbox.resolved_json", JSON.stringify(intent));
    await (0, state_write_1.setStateIfChanged)(host, "user_intent.wallbox.revision", intent.revision);
    await (0, state_write_1.setStateIfChanged)(host, "user_intent.wallbox.intent_state", intent.intent_state);
    await (0, state_write_1.setStateIfChanged)(host, "user_intent.wallbox.last_changed", (0, validation_1.lastChangedAt)(intent));
    await (0, state_write_1.setStateIfChanged)(host, "user_intent.wallbox.manual_override_active", intent.manual_override.active);
    await (0, state_write_1.setStateIfChanged)(host, "user_intent.wallbox.source_summary", JSON.stringify(intent.source_summary));
}
async function writeThermalMirror(host, intent) {
    await (0, state_write_1.setStateIfChanged)(host, "user_intent.thermal.resolved_json", JSON.stringify(intent));
    await (0, state_write_1.setStateIfChanged)(host, "user_intent.thermal.revision", intent.revision);
    await (0, state_write_1.setStateIfChanged)(host, "user_intent.thermal.intent_state", intent.intent_state);
    await (0, state_write_1.setStateIfChanged)(host, "user_intent.thermal.last_changed", (0, validation_2.lastThermalChangedAt)(intent));
    await (0, state_write_1.setStateIfChanged)(host, "user_intent.thermal.manual_override_active", intent.manual_override.active);
    await (0, state_write_1.setStateIfChanged)(host, "user_intent.thermal.source_summary", JSON.stringify(intent.source_summary));
}
async function writeBatteryMirror(host, intent) {
    await (0, state_write_1.setStateIfChanged)(host, "user_intent.battery.resolved_json", JSON.stringify(intent));
    await (0, state_write_1.setStateIfChanged)(host, "user_intent.battery.revision", intent.revision);
    await (0, state_write_1.setStateIfChanged)(host, "user_intent.battery.intent_state", intent.intent_state);
    await (0, state_write_1.setStateIfChanged)(host, "user_intent.battery.last_changed", (0, validation_3.lastBatteryChangedAt)(intent));
    await (0, state_write_1.setStateIfChanged)(host, "user_intent.battery.manual_override_active", intent.manual_override.active);
    await (0, state_write_1.setStateIfChanged)(host, "user_intent.battery.source_summary", JSON.stringify(intent.source_summary));
}
async function writeSourceSnapshots(host, evcc, admin) {
    await (0, state_write_1.setStateIfChanged)(host, "user_intent.wallbox.sources.evcc.snapshot_json", JSON.stringify(evcc));
    await (0, state_write_1.setStateIfChanged)(host, "user_intent.wallbox.sources.evcc.status", evcc.status);
    await (0, state_write_1.setStateIfChanged)(host, "user_intent.wallbox.sources.evcc.last_observed", evcc.observed_at);
    await (0, state_write_1.setStateIfChanged)(host, "user_intent.wallbox.sources.admin.snapshot_json", JSON.stringify(admin));
}
async function runIntentEngine(host) {
    const now = new Date();
    await (0, ensure_states_1.ensureIntentStates)(host);
    const adminCfg = (0, config_1.intentAdminConfigFromAdapter)(host.config);
    const evccCfg = (0, config_1.intentEvccConfigFromAdapter)(host.config);
    const [evcc, wallboxActive, thermalActive, batteryActive] = await Promise.all([
        (0, evcc_1.readEvccIntentSnapshot)(host, evccCfg, adminCfg.timezone, now),
        (0, addon_active_1.isAddonIntentActive)(host, "wallbox"),
        (0, addon_active_1.isAddonIntentActive)(host, index_1.IMMERSION_ADDON_ID),
        (0, addon_active_1.isAddonIntentActive)(host, "battery"),
    ]);
    const admin = (0, admin_1.buildAdminIntentSnapshot)(adminCfg, now);
    const wallboxOverride = (0, iobroker_1.snapshotToManualOverride)(wallboxSnapshot);
    const thermalOverride = (0, iobroker_thermal_1.snapshotToThermalManualOverride)(thermalSnapshot);
    const batteryOverride = (0, iobroker_battery_1.snapshotToBatteryManualOverride)(batterySnapshot);
    const wallbox = (0, resolve_1.resolveWallboxIntent)({
        now,
        previous: lastWallbox,
        evcc,
        iobroker: wallboxSnapshot,
        admin,
        override: wallboxOverride,
        active: wallboxActive,
    });
    const thermal = (0, resolve_2.resolveThermalIntent)({
        now,
        previous: lastThermal,
        iobroker: thermalSnapshot,
        override: thermalOverride,
        active: thermalActive,
    });
    const battery = (0, resolve_3.resolveBatteryIntent)({
        now,
        previous: lastBattery,
        iobroker: batterySnapshot,
        override: batteryOverride,
        active: batteryActive,
    });
    const domains = {
        wallbox,
        thermal,
        battery,
    };
    const resolvedAll = (0, aggregate_1.buildResolvedAllIntent)(lastResolvedAll, domains, now);
    const wallboxChanged = (0, revision_1.semanticIntentChanged)(lastWallbox, wallbox);
    const thermalChanged = lastThermal?.revision !== thermal.revision;
    const batteryChanged = lastBattery?.revision !== battery.revision;
    const aggregateChanged = lastResolvedAll?.revision !== resolvedAll.revision;
    if (wallboxChanged) {
        host.log.info(`User Intent wallbox revision: ${lastWallbox?.revision ?? 0} -> ${wallbox.revision} (${wallbox.intent_state})`);
    }
    if (thermalChanged) {
        host.log.info(`User Intent thermal revision: ${lastThermal?.revision ?? 0} -> ${thermal.revision} (${thermal.intent_state})`);
    }
    if (batteryChanged) {
        host.log.info(`User Intent battery revision: ${lastBattery?.revision ?? 0} -> ${battery.revision} (${battery.intent_state})`);
    }
    if (aggregateChanged && !wallboxChanged && !thermalChanged && !batteryChanged) {
        host.log.debug?.(`User Intent aggregate revision: ${lastResolvedAll?.revision ?? 0} -> ${resolvedAll.revision}`);
    }
    lastWallbox = wallbox;
    lastThermal = thermal;
    lastBattery = battery;
    lastResolvedAll = resolvedAll;
    await writeWallboxMirror(host, wallbox);
    await writeThermalMirror(host, thermal);
    await writeBatteryMirror(host, battery);
    await (0, state_write_1.setStateIfChanged)(host, "user_intent.resolved_all_json", JSON.stringify(resolvedAll));
    await (0, state_write_1.setStateIfChanged)(host, "user_intent.resolved_all.revision", resolvedAll.revision);
    await writeSourceSnapshots(host, evcc, admin);
    await (0, state_write_1.setStateIfChanged)(host, "user_intent.status", "ready");
    const diag = {
        revision: resolvedAll.revision,
        wallbox: wallbox.intent_state,
        thermal: thermal.intent_state,
        battery: battery.intent_state,
        at: now.toISOString(),
    };
    await (0, state_write_1.setStateIfChanged)(host, "user_intent.wallbox.diagnostics.last_resolution_json", JSON.stringify(diag));
    const dataDir = host.getAbsolutePath?.("intent");
    const anyChanged = wallboxChanged || thermalChanged || batteryChanged || aggregateChanged;
    if (dataDir && anyChanged) {
        await (0, persist_1.writeIntentPersist)(dataDir, {
            wallbox,
            thermal,
            battery,
            resolvedAll,
            lastRequestIds,
            wallboxSnapshot,
            thermalSnapshot,
            batterySnapshot,
        });
    }
    scheduleExpiryRerun(host, now);
    return { wallbox, thermal, battery, resolvedAll };
}
exports.runIntentEngine = runIntentEngine;
async function processDomainRequest(host, domain, state, requestState, resultState) {
    if (!state || state.ack === true)
        return;
    const adminCfg = (0, config_1.intentAdminConfigFromAdapter)(host.config);
    const now = new Date();
    if (domain === "wallbox") {
        const out = (0, iobroker_1.processIobrokerWallboxRequest)({
            raw: state.val,
            ack: state.ack,
            now,
            admin: adminCfg,
            lastRequestId: lastRequestIds.wallbox,
            currentRevision: lastWallbox?.revision ?? 0,
            existingSnapshot: wallboxSnapshot,
        });
        await (0, state_write_1.setStateIfChanged)(host, resultState, JSON.stringify(out.result));
        if (out.accepted && out.snapshot) {
            wallboxSnapshot = out.snapshot;
            lastRequestIds.wallbox = out.result.request_id;
            host.log.info(`User Intent wallbox request ${out.result.status}: ${out.result.request_id}`);
            await host.setStateAsync(requestState, { val: state.val, ack: true });
            await runIntentEngine(host);
        }
        else if (out.result.status === "duplicate") {
            await host.setStateAsync(requestState, { val: state.val, ack: true });
            host.log.debug?.(`User Intent wallbox duplicate: ${out.result.request_id}`);
        }
        return;
    }
    if (domain === "thermal") {
        const out = (0, iobroker_thermal_1.processIobrokerThermalRequest)({
            raw: state.val,
            ack: state.ack,
            now,
            admin: adminCfg,
            lastRequestId: lastRequestIds.thermal,
            currentRevision: lastThermal?.revision ?? 0,
            existingSnapshot: thermalSnapshot,
        });
        await (0, state_write_1.setStateIfChanged)(host, resultState, JSON.stringify(out.result));
        if (out.accepted && out.snapshot) {
            thermalSnapshot = out.snapshot;
            lastRequestIds.thermal = out.result.request_id;
            host.log.info(`User Intent thermal request ${out.result.status}: ${out.result.request_id}`);
            await host.setStateAsync(requestState, { val: state.val, ack: true });
            await runIntentEngine(host);
        }
        else if (out.result.status === "duplicate") {
            await host.setStateAsync(requestState, { val: state.val, ack: true });
            host.log.debug?.(`User Intent thermal duplicate: ${out.result.request_id}`);
        }
        return;
    }
    if (domain === "battery") {
        const out = (0, iobroker_battery_1.processIobrokerBatteryRequest)({
            raw: state.val,
            ack: state.ack,
            now,
            admin: adminCfg,
            lastRequestId: lastRequestIds.battery,
            currentRevision: lastBattery?.revision ?? 0,
            existingSnapshot: batterySnapshot,
        });
        await (0, state_write_1.setStateIfChanged)(host, resultState, JSON.stringify(out.result));
        if (out.accepted && out.snapshot) {
            batterySnapshot = out.snapshot;
            lastRequestIds.battery = out.result.request_id;
            host.log.info(`User Intent battery request ${out.result.status}: ${out.result.request_id}`);
            await host.setStateAsync(requestState, { val: state.val, ack: true });
            await runIntentEngine(host);
        }
        else if (out.result.status === "duplicate") {
            await host.setStateAsync(requestState, { val: state.val, ack: true });
            host.log.debug?.(`User Intent battery duplicate: ${out.result.request_id}`);
        }
    }
}
async function processThermalControlChange(host, triggerId, state) {
    if (!state || state.ack === true)
        return;
    const relTrigger = triggerId.includes(".") ? triggerId.split(".").slice(-4).join(".") : triggerId;
    const isModeChange = relTrigger === control_1.THERMAL_CONTROL_REQUESTED_MODE || triggerId.endsWith(control_1.THERMAL_CONTROL_REQUESTED_MODE);
    const modeSt = await host.getStateAsync(control_1.THERMAL_CONTROL_REQUESTED_MODE);
    const mode = isModeChange ? (0, control_1.parseControlMode)(state.val) : (0, control_1.parseControlMode)(modeSt?.val);
    if (!mode) {
        await (0, state_write_1.setStateIfChanged)(host, control_1.THERMAL_CONTROL_LAST_RESULT, JSON.stringify((0, control_1.controlResult)("rejected_invalid", ["invalid_mode"], "")));
        if (triggerId.endsWith(control_1.THERMAL_CONTROL_REQUESTED_MODE)) {
            await host.setStateAsync(control_1.THERMAL_CONTROL_REQUESTED_MODE, { val: state.val, ack: true });
        }
        return;
    }
    const forceTargetSt = await host.getStateAsync(control_1.THERMAL_CONTROL_FORCE_TARGET);
    const forceUntilSt = await host.getStateAsync(control_1.THERMAL_CONTROL_FORCE_UNTIL);
    const targetVal = (0, control_1.validateForceTarget)(forceTargetSt?.val, host.config);
    if (!targetVal.ok) {
        await (0, state_write_1.setStateIfChanged)(host, control_1.THERMAL_CONTROL_LAST_RESULT, JSON.stringify((0, control_1.controlResult)("rejected_invalid", [targetVal.error], "")));
        await host.setStateAsync(triggerId.replace(`${host.namespace}.`, ""), { val: state.val, ack: true });
        return;
    }
    const now = new Date();
    const issuedAt = now.toISOString();
    const requestId = `control-${issuedAt}-${Math.random().toString(36).slice(2, 8)}`;
    const raw = (0, control_1.buildControlThermalRequest)({
        mode,
        forceTargetTempC: mode === "force" ? targetVal.value : null,
        forceUntil: typeof forceUntilSt?.val === "string" && forceUntilSt.val.trim() ? forceUntilSt.val.trim() : null,
        config: host.config,
        issuedAt,
    });
    raw.request_id = requestId;
    const adminCfg = (0, config_1.intentAdminConfigFromAdapter)(host.config);
    const out = (0, iobroker_thermal_1.processIobrokerThermalRequest)({
        raw,
        ack: false,
        now,
        admin: adminCfg,
        lastRequestId: lastRequestIds.thermal,
        currentRevision: lastThermal?.revision ?? 0,
        existingSnapshot: thermalSnapshot,
    });
    await (0, state_write_1.setStateIfChanged)(host, control_1.THERMAL_CONTROL_LAST_RESULT, JSON.stringify(out.result));
    if (out.accepted && out.snapshot) {
        thermalSnapshot = out.snapshot;
        lastRequestIds.thermal = out.result.request_id;
        await host.setStateAsync(control_1.THERMAL_CONTROL_REQUESTED_MODE, { val: mode, ack: true });
        if (mode === "force" && targetVal.value !== null) {
            await host.setStateAsync(control_1.THERMAL_CONTROL_FORCE_TARGET, { val: targetVal.value, ack: true });
        }
        if (forceUntilSt?.val) {
            await host.setStateAsync(control_1.THERMAL_CONTROL_FORCE_UNTIL, { val: forceUntilSt.val, ack: true });
        }
        await runIntentEngine(host);
    }
}
/** Runtime auto-revert (Force → Auto) mit Intent-Revision. */
async function submitThermalControlFromRuntime(host, mode) {
    await host.setStateAsync(control_1.THERMAL_CONTROL_REQUESTED_MODE, { val: mode, ack: false });
    await processThermalControlChange(host, control_1.THERMAL_CONTROL_REQUESTED_MODE, {
        val: mode,
        ack: false,
    });
}
exports.submitThermalControlFromRuntime = submitThermalControlFromRuntime;
async function initIntentEngine(host) {
    if (engineActive && subscribedHost === host) {
        return;
    }
    host.log.info(`User Intent Engine init start (${constants_1.INTENT_ENGINE_VERSION})`);
    engineActive = true;
    subscribedHost = host;
    const now = new Date();
    await (0, ensure_states_1.ensureIntentStates)(host);
    host.log.info("User Intent states ensured");
    try {
        const dataDir = host.getAbsolutePath?.("intent");
        if (dataDir) {
            const persisted = await (0, persist_1.readIntentPersist)(dataDir);
            if (persisted) {
                lastWallbox = persisted.wallbox;
                lastThermal = persisted.thermal;
                lastBattery = persisted.battery;
                lastResolvedAll = persisted.resolvedAll;
                lastRequestIds = persisted.lastRequestIds;
                wallboxSnapshot = persisted.wallboxSnapshot;
                thermalSnapshot = persisted.thermalSnapshot;
                batterySnapshot = persisted.batterySnapshot;
            }
        }
    }
    catch (e) {
        host.log.warn(`Intent persist load failed: ${e}`);
    }
    if (!lastWallbox)
        lastWallbox = (0, types_1.emptyResolvedWallboxIntent)(now);
    if (!lastThermal)
        lastThermal = (0, types_2.emptyResolvedThermalIntent)(now, constants_1.THERMAL_TARGET_ID);
    if (!lastBattery)
        lastBattery = (0, types_3.emptyResolvedBatteryIntent)(now, "main");
    try {
        await runIntentEngine(host);
    }
    catch (e) {
        (host.log.error ?? host.log.warn)(`User Intent first resolution failed: ${e}`);
    }
    try {
        const evccCfg = (0, config_1.intentEvccConfigFromAdapter)(host.config);
        const foreignIds = (0, config_1.configuredEvccStateIds)(evccCfg);
        for (const id of foreignIds) {
            if (subscribedForeignIds.includes(id))
                continue;
            if (typeof host.subscribeForeignStatesAsync === "function") {
                try {
                    // Kein Callback übergeben: ioBroker interpretiert eine Funktion als
                    // internen Completion-Callback, wodurch das Promise nie auflöst.
                    // EVCC-Änderungen laufen über onStateChange -> handleIntentStateChange.
                    await host.subscribeForeignStatesAsync(id);
                    subscribedForeignIds.push(id);
                }
                catch (e) {
                    host.log.debug?.(`Intent EVCC subscribe ${id}: ${e}`);
                }
            }
        }
        const requestPatterns = [
            constants_1.IOBROKER_WALLBOX_REQUEST_STATE,
            constants_1.IOBROKER_THERMAL_REQUEST_STATE,
            constants_1.IOBROKER_BATTERY_REQUEST_STATE,
            control_1.THERMAL_CONTROL_REQUESTED_MODE,
            control_1.THERMAL_CONTROL_FORCE_TARGET,
            control_1.THERMAL_CONTROL_FORCE_UNTIL,
        ];
        if (typeof host.subscribeStatesAsync === "function") {
            for (const pattern of requestPatterns) {
                if (subscribedPatterns.includes(pattern))
                    continue;
                await host.subscribeStatesAsync(pattern);
                subscribedPatterns.push(pattern);
            }
        }
    }
    catch (e) {
        host.log.warn(`Intent subscriptions failed: ${e}`);
    }
    try {
        await processDomainRequest(host, "wallbox", (await host.getStateAsync(constants_1.IOBROKER_WALLBOX_REQUEST_STATE)) ?? null, constants_1.IOBROKER_WALLBOX_REQUEST_STATE, constants_1.IOBROKER_WALLBOX_RESULT_STATE);
        await processDomainRequest(host, "thermal", (await host.getStateAsync(constants_1.IOBROKER_THERMAL_REQUEST_STATE)) ?? null, constants_1.IOBROKER_THERMAL_REQUEST_STATE, constants_1.IOBROKER_THERMAL_RESULT_STATE);
        await processDomainRequest(host, "battery", (await host.getStateAsync(constants_1.IOBROKER_BATTERY_REQUEST_STATE)) ?? null, constants_1.IOBROKER_BATTERY_REQUEST_STATE, constants_1.IOBROKER_BATTERY_RESULT_STATE);
    }
    catch (e) {
        host.log.warn(`Intent pending request handling failed: ${e}`);
    }
    host.log.info("User Intent Engine initialized");
}
exports.initIntentEngine = initIntentEngine;
const REQUEST_HANDLERS = {
    [constants_1.IOBROKER_WALLBOX_REQUEST_STATE]: {
        domain: "wallbox",
        request: constants_1.IOBROKER_WALLBOX_REQUEST_STATE,
        result: constants_1.IOBROKER_WALLBOX_RESULT_STATE,
    },
    [constants_1.IOBROKER_THERMAL_REQUEST_STATE]: {
        domain: "thermal",
        request: constants_1.IOBROKER_THERMAL_REQUEST_STATE,
        result: constants_1.IOBROKER_THERMAL_RESULT_STATE,
    },
    [constants_1.IOBROKER_BATTERY_REQUEST_STATE]: {
        domain: "battery",
        request: constants_1.IOBROKER_BATTERY_REQUEST_STATE,
        result: constants_1.IOBROKER_BATTERY_RESULT_STATE,
    },
};
function handleIntentStateChange(namespace, id, state) {
    if (!engineActive || !subscribedHost)
        return;
    const host = subscribedHost;
    for (const [suffix, cfg] of Object.entries(REQUEST_HANDLERS)) {
        if (id === `${namespace}.${suffix}`) {
            void processDomainRequest(host, cfg.domain, state, cfg.request, cfg.result).catch((e) => host.log.warn(`Intent request ${cfg.domain}: ${e}`));
            return;
        }
    }
    const evccCfg = (0, config_1.intentEvccConfigFromAdapter)(host.config);
    const foreignIds = (0, config_1.configuredEvccStateIds)(evccCfg);
    if (foreignIds.includes(id)) {
        scheduleEvccRerun(host);
        return;
    }
    const controlSuffixes = [control_1.THERMAL_CONTROL_REQUESTED_MODE, control_1.THERMAL_CONTROL_FORCE_TARGET, control_1.THERMAL_CONTROL_FORCE_UNTIL];
    for (const suffix of controlSuffixes) {
        if (id === `${namespace}.${suffix}`) {
            void processThermalControlChange(host, id, state).catch((e) => host.log.warn(`Intent thermal control: ${e}`));
            return;
        }
    }
}
exports.handleIntentStateChange = handleIntentStateChange;
function stopIntentEngine() {
    const host = subscribedHost;
    clearEvccDebounce();
    clearExpiryTimer();
    if (host?.unsubscribeStatesAsync) {
        for (const pattern of subscribedPatterns) {
            void host.unsubscribeStatesAsync(pattern).catch((e) => host.log.debug?.(`Intent unsubscribe ${pattern}: ${e}`));
        }
    }
    if (host?.unsubscribeForeignStatesAsync) {
        for (const id of subscribedForeignIds) {
            void host.unsubscribeForeignStatesAsync(id).catch((e) => host.log.debug?.(`Intent foreign unsubscribe ${id}: ${e}`));
        }
    }
    engineActive = false;
    subscribedHost = null;
    lastWallbox = null;
    lastThermal = null;
    lastBattery = null;
    lastResolvedAll = null;
    wallboxSnapshot = null;
    thermalSnapshot = null;
    batterySnapshot = null;
    lastRequestIds = { wallbox: null, thermal: null, battery: null };
    subscribedPatterns.length = 0;
    subscribedForeignIds.length = 0;
}
exports.stopIntentEngine = stopIntentEngine;
function getLastResolvedWallboxIntentForTest() {
    return lastWallbox;
}
exports.getLastResolvedWallboxIntentForTest = getLastResolvedWallboxIntentForTest;
function resetIntentEngineForTest() {
    stopIntentEngine();
}
exports.resetIntentEngineForTest = resetIntentEngineForTest;
