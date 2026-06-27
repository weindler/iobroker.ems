"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resetIntentEngineForTest = exports.getLastResolvedWallboxIntentForTest = exports.stopIntentEngine = exports.handleIntentStateChange = exports.initIntentEngine = exports.runIntentEngine = void 0;
const state_write_1 = require("../policy/core/state_write");
const revision_1 = require("./core/revision");
const constants_1 = require("./core/constants");
const config_1 = require("./config");
const ensure_states_1 = require("./ensure_states");
const persist_1 = require("./persist");
const evcc_1 = require("./sources/evcc");
const admin_1 = require("./sources/admin");
const iobroker_1 = require("./sources/iobroker");
const resolve_1 = require("./wallbox/resolve");
const validation_1 = require("./wallbox/validation");
const types_1 = require("./wallbox/types");
let engineActive = false;
let patternSubscribed = false;
let subscribedHost = null;
let lastResolved = null;
let iobrokerSnapshot = null;
let lastRequestId = null;
let evccDebounceTimer = null;
const subscribedPatterns = [];
const subscribedForeignIds = [];
function clearEvccDebounce() {
    if (evccDebounceTimer) {
        clearTimeout(evccDebounceTimer);
        evccDebounceTimer = null;
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
async function writeMirrorStates(host, intent) {
    const summaryJson = JSON.stringify(intent.source_summary);
    await (0, state_write_1.setStateIfChanged)(host, "user_intent.wallbox.resolved_json", JSON.stringify(intent));
    await (0, state_write_1.setStateIfChanged)(host, "user_intent.wallbox.revision", intent.revision);
    await (0, state_write_1.setStateIfChanged)(host, "user_intent.wallbox.intent_state", intent.intent_state);
    await (0, state_write_1.setStateIfChanged)(host, "user_intent.wallbox.last_changed", (0, validation_1.lastChangedAt)(intent));
    await (0, state_write_1.setStateIfChanged)(host, "user_intent.wallbox.manual_override_active", intent.manual_override.active);
    await (0, state_write_1.setStateIfChanged)(host, "user_intent.wallbox.source_summary", summaryJson);
    await (0, state_write_1.setStateIfChanged)(host, "user_intent.status", "ready");
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
    const evcc = await (0, evcc_1.readEvccIntentSnapshot)(host, evccCfg, adminCfg.timezone, now);
    const admin = (0, admin_1.buildAdminIntentSnapshot)(adminCfg, now);
    const override = (0, iobroker_1.snapshotToManualOverride)(iobrokerSnapshot);
    const resolved = (0, resolve_1.resolveWallboxIntent)({
        now,
        previous: lastResolved,
        evcc,
        iobroker: iobrokerSnapshot,
        admin,
        override,
    });
    const changed = (0, revision_1.semanticIntentChanged)(lastResolved, resolved);
    if (changed) {
        host.log.info(`User Intent revision: ${lastResolved?.revision ?? 0} -> ${resolved.revision} (${resolved.intent_state})`);
    }
    lastResolved = resolved;
    await writeMirrorStates(host, resolved);
    await writeSourceSnapshots(host, evcc, admin);
    await (0, state_write_1.setStateIfChanged)(host, "user_intent.wallbox.diagnostics.last_resolution_json", JSON.stringify({ revision: resolved.revision, intent_state: resolved.intent_state, at: now.toISOString() }));
    const dataDir = host.getAbsolutePath?.("intent");
    if (dataDir && changed) {
        await (0, persist_1.writeIntentPersist)(dataDir, {
            revision: resolved.revision,
            resolved,
            lastRequestId,
            iobrokerSnapshot,
        });
    }
    return resolved;
}
exports.runIntentEngine = runIntentEngine;
async function processPendingIobrokerRequest(host, state) {
    if (!state || state.ack === true) {
        return;
    }
    const adminCfg = (0, config_1.intentAdminConfigFromAdapter)(host.config);
    const out = (0, iobroker_1.processIobrokerWallboxRequest)({
        raw: state.val,
        ack: state.ack,
        now: new Date(),
        admin: adminCfg,
        lastRequestId,
        currentRevision: lastResolved?.revision ?? 0,
        existingSnapshot: iobrokerSnapshot,
    });
    await (0, state_write_1.setStateIfChanged)(host, constants_1.IOBROKER_WALLBOX_RESULT_STATE, JSON.stringify(out.result));
    if (out.accepted && out.snapshot) {
        iobrokerSnapshot = out.snapshot;
        lastRequestId = out.result.request_id;
        host.log.info(`User Intent request ${out.result.status}: ${out.result.request_id}`);
        await host.setStateAsync(constants_1.IOBROKER_WALLBOX_REQUEST_STATE, { val: state.val, ack: true });
        await runIntentEngine(host);
    }
    else if (out.result.status === "duplicate") {
        await host.setStateAsync(constants_1.IOBROKER_WALLBOX_REQUEST_STATE, { val: state.val, ack: true });
        host.log.debug?.(`User Intent duplicate request: ${out.result.request_id}`);
    }
}
async function initIntentEngine(host) {
    if (engineActive && subscribedHost === host) {
        return;
    }
    host.log.info(`User Intent Engine init start (${constants_1.INTENT_ENGINE_VERSION})`);
    engineActive = true;
    subscribedHost = host;
    const now = new Date();
    // Schritt 1 (verbindlich): States anlegen. Muss als Erstes und unabhängig von
    // allem Weiteren passieren, damit der user_intent-Baum immer existiert.
    await (0, ensure_states_1.ensureIntentStates)(host);
    host.log.info("User Intent states ensured");
    // Schritt 2: persistierten Zustand laden (Fehler nicht fatal).
    try {
        const dataDir = host.getAbsolutePath?.("intent");
        if (dataDir) {
            const persisted = await (0, persist_1.readIntentPersist)(dataDir);
            if (persisted) {
                lastResolved = persisted.resolved;
                lastRequestId = persisted.lastRequestId;
                iobrokerSnapshot = persisted.iobrokerSnapshot;
            }
        }
    }
    catch (e) {
        host.log.warn(`Intent persist load failed: ${e}`);
    }
    if (!lastResolved) {
        lastResolved = (0, types_1.emptyResolvedWallboxIntent)(now);
    }
    // Schritt 3: erste Auflösung (Fehler nicht fatal — States existieren bereits).
    try {
        await runIntentEngine(host);
    }
    catch (e) {
        (host.log.error ?? host.log.warn)(`User Intent first resolution failed: ${e}`);
    }
    // Schritt 4: Subscriptions (jede isoliert; Fehler dürfen den Init nicht abbrechen).
    try {
        const evccCfg = (0, config_1.intentEvccConfigFromAdapter)(host.config);
        const foreignIds = (0, config_1.configuredEvccStateIds)(evccCfg);
        for (const id of foreignIds) {
            if (subscribedForeignIds.includes(id))
                continue;
            if (typeof host.subscribeForeignStatesAsync === "function") {
                try {
                    await host.subscribeForeignStatesAsync(id, () => scheduleEvccRerun(host));
                    subscribedForeignIds.push(id);
                }
                catch (e) {
                    host.log.debug?.(`Intent EVCC subscribe ${id}: ${e}`);
                }
            }
        }
        const requestPattern = constants_1.IOBROKER_WALLBOX_REQUEST_STATE;
        if (!subscribedPatterns.includes(requestPattern) && typeof host.subscribeStatesAsync === "function") {
            patternSubscribed = true;
            await host.subscribeStatesAsync(requestPattern);
            subscribedPatterns.push(requestPattern);
        }
    }
    catch (e) {
        host.log.warn(`Intent subscriptions failed: ${e}`);
    }
    // Schritt 5: evtl. anstehenden Request verarbeiten (Fehler nicht fatal).
    try {
        const pending = await host.getStateAsync(constants_1.IOBROKER_WALLBOX_REQUEST_STATE);
        await processPendingIobrokerRequest(host, pending ?? null);
    }
    catch (e) {
        host.log.warn(`Intent pending request handling failed: ${e}`);
    }
    host.log.info("User Intent Engine initialized");
}
exports.initIntentEngine = initIntentEngine;
function handleIntentStateChange(namespace, id, state) {
    if (!engineActive || !subscribedHost) {
        return;
    }
    const host = subscribedHost;
    const fullRequest = `${namespace}.${constants_1.IOBROKER_WALLBOX_REQUEST_STATE}`;
    if (id === fullRequest) {
        void processPendingIobrokerRequest(host, state).catch((e) => host.log.warn(`Intent request: ${e}`));
        return;
    }
    const evccCfg = (0, config_1.intentEvccConfigFromAdapter)(host.config);
    const foreignIds = (0, config_1.configuredEvccStateIds)(evccCfg);
    if (foreignIds.includes(id)) {
        scheduleEvccRerun(host);
    }
}
exports.handleIntentStateChange = handleIntentStateChange;
function stopIntentEngine() {
    const host = subscribedHost;
    clearEvccDebounce();
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
    patternSubscribed = false;
    engineActive = false;
    subscribedHost = null;
    lastResolved = null;
    iobrokerSnapshot = null;
    lastRequestId = null;
    subscribedPatterns.length = 0;
    subscribedForeignIds.length = 0;
}
exports.stopIntentEngine = stopIntentEngine;
function getLastResolvedWallboxIntentForTest() {
    return lastResolved;
}
exports.getLastResolvedWallboxIntentForTest = getLastResolvedWallboxIntentForTest;
function resetIntentEngineForTest() {
    stopIntentEngine();
}
exports.resetIntentEngineForTest = resetIntentEngineForTest;
