"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleWallboxStateChange = exports.handleWallboxForeignStateChange = exports.stopWallboxModule = exports.initWallboxModule = exports.startWallboxModuleRuntime = exports.ensureWallboxStateTree = exports.ensureWallboxDynamicVehicleProfiles = exports.ensureWallboxStaticStateTree = exports.refreshWallboxEvccTelemetry = void 0;
const evcc_config_1 = require("./evcc_config");
const ensure_evcc_states_1 = require("./ensure_evcc_states");
const evcc_telemetry_1 = require("./evcc_telemetry");
const normalize_1 = require("./normalize");
const charge_hold_1 = require("./charge_hold");
const state_write_1 = require("../../policy/core/state_write");
const governance_1 = require("../governance");
const runtime_surface_1 = require("../runtime_surface");
const execution_mode_1 = require("../../execution_mode");
const tree_paths_1 = require("../../tree_paths");
const states_1 = require("../../operator/daily_plan/states");
const runtime_1 = require("./runtime");
const device_write_1 = require("../../device_write");
const states_2 = require("./runtime/states");
const config_1 = require("../../intent/config");
const evcc_control_config_1 = require("./evcc_control_config");
const control_object_meta_1 = require("./runtime/control_object_meta");
let activeHost = null;
const subscribedIds = [];
let debounceTimer = null;
let periodicTimer = null;
/** EMS-Ownership über die aktive EVCC-Steuerung — Safe-Restore-Pflicht bis geklärt. */
let wallboxOwnership = (0, runtime_1.emptyWallboxOwnership)();
/** Fault/Lockout aus Write-Fehlern oder Feedback-Mismatch/Timeout — sperrt weitere Live-Writes. */
let wallboxFault = (0, runtime_1.emptyWallboxFault)();
/** Feedback-Contract eines zuletzt ausgeführten Writes, wartet auf Rücklese-Bestätigung. */
let pendingWallboxFeedback = null;
const DEBOUNCE_MS = 300;
/** Deterministischer Sicherheits-Tick (Feedback-Timeout/Safe-Restore) unabhängig von EVCC-Telemetrie-Events. */
const SAFETY_TICK_MS = 10_000;
async function writeField(host, stateId, field) {
    if (field.status === "missing" || field.value === null) {
        return;
    }
    const val = field.value;
    await host.setStateAsync(stateId, { val, ack: true });
}
/**
 * Spiegelt einen Planzeit-Feld in einen String-State (role: date).
 * Anders als writeField wird der State bei null/ungültig ausdrücklich auf ""
 * gesetzt, damit kein alter EVCC-Deadline-Zeitstempel stale stehen bleibt.
 */
async function writeTimeField(host, stateId, field) {
    const val = field.status === "valid" && typeof field.value === "string" ? field.value : "";
    await host.setStateAsync(stateId, { val, ack: true });
}
const WALLBOX_ADDON_ID = "wallbox";
async function resolveChargeModeActive(host, config) {
    const chargeValue = (0, evcc_control_config_1.evccModeChargeValue)(config);
    const intentCfg = (0, config_1.intentEvccConfigFromAdapter)(config);
    if (!chargeValue || !intentCfg.modeStateId)
        return null;
    try {
        const read = typeof host.getForeignStateAsync === "function"
            ? host.getForeignStateAsync.bind(host)
            : host.getStateAsync.bind(host);
        const st = await read(intentCfg.modeStateId);
        if (st?.val === undefined || st.val === null)
            return null;
        return String(st.val) === chargeValue;
    }
    catch {
        return null;
    }
}
async function refreshWallboxDailyPlanRuntime(host, snap) {
    const cfg = (0, evcc_config_1.wallboxEvccTelemetryConfigFromAdapter)(host.config);
    const addonOn = await host.getStateAsync((0, tree_paths_1.addonEnabled)(WALLBOX_ADDON_ID));
    const addonEnabledVal = addonOn?.val !== false;
    const governanceEnabled = await (0, governance_1.isAddonGovernanceEnabledFromState)((id) => host.getStateAsync(id), WALLBOX_ADDON_ID);
    const now = new Date();
    const decision = await (0, runtime_1.resolveWallboxDailyPlanDecision)(host, snap, cfg, now, {
        governanceEnabled,
        addonEnabled: addonEnabledVal,
    });
    await (0, runtime_1.publishWallboxRuntimeStates)(host, decision, governanceEnabled);
    const telemetry = (0, runtime_1.telemetryInputFromSnapshot)(snap, cfg);
    const phases = telemetry.activePhases ?? telemetry.configuredPhases;
    const intent = (0, runtime_1.buildWallboxDispatchIntent)({
        decision,
        governanceEnabled,
        addonEnabled: addonEnabledVal,
        phases,
        now,
    });
    const chargingEnabled = snap.enabled.status === "valid" && typeof snap.enabled.value === "boolean" ? snap.enabled.value : null;
    const dispatch = (0, runtime_1.runWallboxDryrunDispatch)({
        intent,
        decision,
        telemetry,
        config: host.config,
        chargingEnabled,
        governanceEnabled,
    });
    await (0, runtime_1.publishWallboxDispatchStates)(host, decision, dispatch);
    const liveRequested = await (0, execution_mode_1.isLiveWriteAllowed)((id) => host.getStateAsync(id), WALLBOX_ADDON_ID);
    const configRecord = host.config && typeof host.config === "object" ? host.config : {};
    const intentCfg = (0, config_1.intentEvccConfigFromAdapter)(configRecord);
    const targetStateIds = (0, runtime_1.collectConfiguredControlTargetStateIds)(configRecord);
    const objectMetas = await (0, control_object_meta_1.resolveWallboxControlObjectMetas)(typeof host.getObjectAsync === "function" ? host.getObjectAsync.bind(host) : undefined, targetStateIds);
    const mappingSnapshot = (0, runtime_1.buildWallboxControlMappingSnapshot)({
        config: configRecord,
        telemetryCfg: {
            enabledStateId: cfg.enabledStateId,
            maxCurrentAStateId: cfg.maxCurrentAStateId,
            modeReadbackStateId: intentCfg.modeStateId,
        },
        objectMetas,
    });
    const chargeModeActive = await resolveChargeModeActive(host, configRecord);
    const foundation = await (0, runtime_1.runWallboxLiveFoundation)(host, {
        dispatch,
        decision,
        mappingSnapshot,
        chargingEnabled,
        chargeModeActive,
        config: configRecord,
        addonEnabled: addonEnabledVal,
        governanceEnabled,
        liveRequested,
        now,
        faultActive: wallboxFault.active,
    });
    await (0, runtime_1.publishWallboxLiveFoundationStates)(host, foundation);
    await runWallboxSafetyTick(host, foundation, now);
    await (0, runtime_1.publishWallboxSafetyStates)(host, wallboxOwnership, wallboxFault);
    const plannerStatus = (0, runtime_surface_1.plannerStatusFromDailyPlan)({
        governanceEnabled,
        addonEnabled: addonEnabledVal,
        dailyPlanValid: decision.planValid,
        dailyPlanStatus: decision.dailyPlanStatus,
    });
    let intentStatus = "idle";
    if (decision.decisionSource === "mapping_incomplete" ||
        decision.decisionSource === "missing_telemetry" ||
        wallboxFault.active) {
        intentStatus = "blocked";
    }
    else if ((decision.allocatedPowerW ?? 0) > 0 || decision.chargingAllowedByPlan) {
        intentStatus = "active";
    }
    else if (!decision.connected) {
        intentStatus = "none";
    }
    let executionStatus = "idle";
    if (wallboxFault.active) {
        executionStatus = "fault";
    }
    else if (foundation.phase === "live" && foundation.writeAllowed) {
        executionStatus = "live";
    }
    else if (foundation.phase === "dryrun" || !liveRequested) {
        executionStatus = "dryrun";
    }
    else if (!foundation.writeAllowed) {
        executionStatus = "blocked";
    }
    await (0, runtime_surface_1.publishAddonRuntimeSurface)(host, WALLBOX_ADDON_ID, {
        decisionDetail: decision.decisionSource,
        decisionReason: decision.reasonDe,
        nowIso: now.toISOString(),
        plannerStatus,
        intentStatus,
        executionStatus,
        profileReady: foundation.mappingSnapshot.validationIssues.length === 0,
        telemetryReady: decision.decisionSource !== "missing_telemetry",
        fault: wallboxFault.active,
        lockout: false,
    });
}
/**
 * Ownership/Fault/Safe-Restore-Verdrahtung nach jedem Foundation-Lauf:
 * - erfolgreicher Write → Ownership übernehmen, Feedback-Contract zur Prüfung vormerken
 * - Write fehlgeschlagen → Fault/Lockout auslösen
 * - anstehendes Feedback → auswerten; Mismatch/Timeout/Invalid → Fault/Lockout
 * - Kontrolle verlassen (nicht mehr live) während Ownership aktiv → Safe-Restore versuchen
 */
async function runWallboxSafetyTick(host, foundation, now) {
    const writeResult = foundation.writeResult;
    if (writeResult?.executed && writeResult.ownershipGranted) {
        wallboxOwnership = (0, runtime_1.grantWallboxOwnership)(foundation.mappingSnapshot.controlModel, foundation.writePlan?.writeScenario ?? null, now.toISOString());
        if (foundation.feedbackContract?.required && writeResult.writeTimestampMs !== null) {
            pendingWallboxFeedback = {
                contract: foundation.feedbackContract,
                writeTimestampMs: writeResult.writeTimestampMs,
            };
        }
    }
    else if (writeResult?.blocked && writeResult.reason === "write_failed") {
        wallboxFault = (0, runtime_1.raiseWallboxFault)("write_failed", "wallbox live write failed", now.toISOString());
        host.log.error("wallbox: Live-Write fehlgeschlagen — Fault/Lockout aktiv, fault_reset zum Zurücksetzen");
    }
    if (pendingWallboxFeedback) {
        const evaluated = await (0, runtime_1.tickWallboxFeedback)(host, pendingWallboxFeedback.contract, pendingWallboxFeedback.writeTimestampMs, now.getTime());
        if ((0, runtime_1.isWallboxFeedbackStatusTerminal)(evaluated.status)) {
            const code = (0, runtime_1.faultCodeForFeedbackStatus)(evaluated.status);
            if (code) {
                wallboxFault = (0, runtime_1.raiseWallboxFault)(code, evaluated.blockReason ?? evaluated.status, now.toISOString());
                host.log.warn(`wallbox: Feedback ${evaluated.status} (${evaluated.blockReason ?? "n/a"}) — Fault/Lockout aktiv`);
            }
            pendingWallboxFeedback = null;
        }
        else {
            pendingWallboxFeedback = { ...pendingWallboxFeedback, contract: evaluated };
        }
    }
    if (foundation.phase !== "live" && wallboxOwnership.active) {
        const restorePlan = (0, runtime_1.planWallboxSafeRestore)(wallboxOwnership, foundation.mappingSnapshot);
        if (restorePlan.required) {
            if (restorePlan.possible && restorePlan.operation) {
                try {
                    const r = await (0, device_write_1.writeForeignIfChanged)(host, {
                        stateId: restorePlan.operation.targetStateId,
                        value: restorePlan.operation.targetValue,
                        reason: "wallbox safe_restore",
                    });
                    host.log.info(`wallbox: Safe-Restore → ${restorePlan.operation.targetValue} (${r.skipped ? "bereits gesetzt" : "geschrieben"})`);
                }
                catch (e) {
                    host.log.error(`wallbox: Safe-Restore-Write fehlgeschlagen: ${String(e)}`);
                }
            }
            else {
                host.log.warn(`wallbox: Safe-Restore nicht möglich (${restorePlan.reason}) — Ownership bleibt bis Mapping korrigiert oder manuell zurückgesetzt`);
                return;
            }
        }
        wallboxOwnership = (0, runtime_1.emptyWallboxOwnership)();
        pendingWallboxFeedback = null;
    }
}
function handleWallboxFaultReset(host) {
    if (!wallboxFault.active)
        return;
    wallboxFault = (0, runtime_1.emptyWallboxFault)();
    pendingWallboxFeedback = null;
    host.log.info("wallbox: Fault/Lockout manuell zurückgesetzt");
    void (0, runtime_1.publishWallboxSafetyStates)(host, wallboxOwnership, wallboxFault).catch(() => undefined);
}
async function readForeignRaw(host, objectId) {
    if (!objectId.trim())
        return null;
    try {
        const st = host.getForeignStateAsync
            ? await host.getForeignStateAsync(objectId)
            : await host.getStateAsync(objectId);
        if (!st || st.val === undefined)
            return null;
        return st.val;
    }
    catch {
        return null;
    }
}
async function publishWallboxBatteryHoldRuntime(host, snap) {
    const holdCfg = (0, evcc_config_1.wallboxHoldSignalConfigFromAdapter)(host.config);
    const externalRaw = await readForeignRaw(host, holdCfg.externalVehicleChargeStateId);
    const tibberRaw = await readForeignRaw(host, holdCfg.tibberGridRewardsActiveStateId);
    const tibberField = holdCfg.tibberGridRewardsActiveStateId
        ? (0, normalize_1.normalizeOptionalBool)(tibberRaw)
        : { value: null, status: "missing", raw: null };
    const tibberActive = tibberField.status === "valid" && tibberField.value === true
        ? true
        : tibberField.status === "valid" && tibberField.value === false
            ? false
            : null;
    const hold = (0, charge_hold_1.resolveWallboxBatteryHold)({
        batteryBoost: snap.battery_boost.status === "valid" ? snap.battery_boost.value : null,
        loadpointMode: snap.loadpoint_mode.status === "valid" ? snap.loadpoint_mode.value : null,
        externalVehicleChargeRaw: externalRaw === null || externalRaw === undefined
            ? null
            : typeof externalRaw === "boolean"
                ? externalRaw
                : String(externalRaw),
        tibberGridRewardsActive: tibberActive,
    });
    await (0, state_write_1.setStateIfChanged)(host, states_2.WALLBOX_RUNTIME_STATES.batteryHoldForEvCharge, hold.hold);
    await (0, state_write_1.setStateIfChanged)(host, states_2.WALLBOX_RUNTIME_STATES.batteryHoldReasonDe, hold.reasonDe);
    await (0, state_write_1.setStateIfChanged)(host, states_2.WALLBOX_RUNTIME_STATES.chargeBoostActive, hold.boostActive);
    await (0, state_write_1.setStateIfChanged)(host, states_2.WALLBOX_RUNTIME_STATES.externalVehicleChargeActive, hold.externalActive);
    await (0, state_write_1.setStateIfChanged)(host, states_2.WALLBOX_RUNTIME_STATES.tibberGridRewardsActive, hold.tibberRewardsActive);
}
async function refreshWallboxEvccTelemetry(host) {
    const cfg = (0, evcc_config_1.wallboxEvccTelemetryConfigFromAdapter)(host.config);
    const snap = await (0, evcc_telemetry_1.readEvccTelemetrySnapshot)(host, cfg, new Date());
    await host.setStateAsync(ensure_evcc_states_1.WALLBOX_EVCC_STATES.snapshotJson, {
        val: JSON.stringify(snap),
        ack: true,
    });
    await host.setStateAsync(ensure_evcc_states_1.WALLBOX_EVCC_STATES.updatedAt, { val: snap.observed_at, ack: true });
    await writeField(host, ensure_evcc_states_1.WALLBOX_EVCC_STATES.enabled, snap.enabled);
    await writeField(host, ensure_evcc_states_1.WALLBOX_EVCC_STATES.connected, snap.connected);
    await writeField(host, ensure_evcc_states_1.WALLBOX_EVCC_STATES.charging, snap.charging);
    await writeField(host, ensure_evcc_states_1.WALLBOX_EVCC_STATES.chargePowerW, snap.charge_power_w);
    await writeField(host, ensure_evcc_states_1.WALLBOX_EVCC_STATES.sessionEnergyKwh, snap.session_energy_kwh);
    await writeField(host, ensure_evcc_states_1.WALLBOX_EVCC_STATES.chargeRemainingEnergyKwh, snap.charge_remaining_energy_kwh);
    await writeField(host, ensure_evcc_states_1.WALLBOX_EVCC_STATES.vehicleSocPct, snap.vehicle_soc_pct);
    await writeField(host, ensure_evcc_states_1.WALLBOX_EVCC_STATES.vehicleName, snap.vehicle_name);
    await writeField(host, ensure_evcc_states_1.WALLBOX_EVCC_STATES.vehicleTitle, snap.vehicle_title);
    await writeField(host, ensure_evcc_states_1.WALLBOX_EVCC_STATES.planActive, snap.plan_active);
    await writeField(host, ensure_evcc_states_1.WALLBOX_EVCC_STATES.planSocPct, snap.plan_soc_pct);
    await writeTimeField(host, ensure_evcc_states_1.WALLBOX_EVCC_STATES.planTime, snap.plan_time);
    await writeTimeField(host, ensure_evcc_states_1.WALLBOX_EVCC_STATES.effectivePlanTime, snap.effective_plan_time);
    await writeField(host, ensure_evcc_states_1.WALLBOX_EVCC_STATES.effectiveLimitSocPct, snap.effective_limit_soc_pct);
    await writeField(host, ensure_evcc_states_1.WALLBOX_EVCC_STATES.batteryBoost, snap.battery_boost);
    await writeField(host, ensure_evcc_states_1.WALLBOX_EVCC_STATES.loadpointMode, snap.loadpoint_mode);
    await writeField(host, ensure_evcc_states_1.WALLBOX_EVCC_STATES.activePhases, snap.active_phases);
    await writeField(host, ensure_evcc_states_1.WALLBOX_EVCC_STATES.configuredPhases, snap.configured_phases);
    await writeField(host, ensure_evcc_states_1.WALLBOX_EVCC_STATES.minCurrentA, snap.min_current_a);
    await writeField(host, ensure_evcc_states_1.WALLBOX_EVCC_STATES.maxCurrentA, snap.max_current_a);
    await writeField(host, ensure_evcc_states_1.WALLBOX_EVCC_STATES.batteryMode, snap.battery_mode);
    await writeField(host, ensure_evcc_states_1.WALLBOX_EVCC_STATES.batteryDischargeControl, snap.battery_discharge_control);
    await publishWallboxBatteryHoldRuntime(host, snap);
    await refreshWallboxDailyPlanRuntime(host, snap);
}
exports.refreshWallboxEvccTelemetry = refreshWallboxEvccTelemetry;
function scheduleRefresh(host) {
    if (debounceTimer)
        clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
        debounceTimer = null;
        void refreshWallboxEvccTelemetry(host).catch((e) => host.log.debug?.(`wallbox evcc refresh: ${e}`));
    }, DEBOUNCE_MS);
}
async function ensureWallboxStaticStateTree(host) {
    await (0, ensure_evcc_states_1.ensureWallboxEvccStates)(host);
    await (0, runtime_1.ensureWallboxRuntimeStates)(host);
}
exports.ensureWallboxStaticStateTree = ensureWallboxStaticStateTree;
/**
 * Phase C (v0.1.227+) — no-op: fat `addons.wallbox.vehicles.*` trees are no longer created.
 * Orphan folders are purged by surface cleanup. Optional capacity/maxW live in `wb_vehicle_map`.
 */
async function ensureWallboxDynamicVehicleProfiles(_host) {
    void _host;
}
exports.ensureWallboxDynamicVehicleProfiles = ensureWallboxDynamicVehicleProfiles;
async function ensureWallboxStateTree(host) {
    await ensureWallboxStaticStateTree(host);
    await ensureWallboxDynamicVehicleProfiles(host);
}
exports.ensureWallboxStateTree = ensureWallboxStateTree;
async function startWallboxModuleRuntime(host) {
    if (activeHost === host)
        return;
    activeHost = host;
    await refreshWallboxEvccTelemetry(host);
    const cfg = (0, evcc_config_1.wallboxEvccTelemetryConfigFromAdapter)(host.config);
    const ids = new Set((0, evcc_config_1.configuredEvccTelemetryStateIds)(cfg));
    for (const id of (0, evcc_config_1.configuredWallboxHoldSignalStateIds)((0, evcc_config_1.wallboxHoldSignalConfigFromAdapter)(host.config))) {
        ids.add(id);
    }
    ids.add((0, tree_paths_1.addonEnabled)(WALLBOX_ADDON_ID));
    ids.add((0, governance_1.addonGovernanceEnabledState)(WALLBOX_ADDON_ID));
    ids.add(tree_paths_1.GLOBAL.executionMode);
    ids.add((0, tree_paths_1.addonMode)(WALLBOX_ADDON_ID));
    ids.add(states_1.DAILY_PLAN_STATE_IDS.revision);
    ids.add(states_1.DAILY_PLAN_STATE_IDS.status);
    ids.add(states_1.ALLOCATION_ADDON_STATE_IDS.wallbox.planJson);
    ids.add(states_2.WALLBOX_RUNTIME_STATES.faultReset);
    for (const id of ids) {
        if (subscribedIds.includes(id))
            continue;
        const isForeign = !id.startsWith("addons.") && !id.startsWith("planner.");
        if (isForeign) {
            if (typeof host.subscribeForeignStatesAsync === "function") {
                try {
                    await host.subscribeForeignStatesAsync(id);
                    subscribedIds.push(id);
                }
                catch (e) {
                    host.log.debug?.(`wallbox evcc subscribe ${id}: ${e}`);
                }
            }
        }
        else if (typeof host.subscribeStatesAsync === "function") {
            try {
                await host.subscribeStatesAsync(id);
                subscribedIds.push(id);
            }
            catch (e) {
                host.log.debug?.(`wallbox subscribe ${id}: ${e}`);
            }
        }
    }
    if (periodicTimer)
        clearInterval(periodicTimer);
    periodicTimer = setInterval(() => {
        if (!activeHost)
            return;
        void refreshWallboxEvccTelemetry(activeHost).catch((e) => activeHost?.log.debug?.(`wallbox safety tick: ${e}`));
    }, SAFETY_TICK_MS);
    host.log.debug("Wallbox EVCC telemetry module initialized (EVCC-Live-Foundation aktiv)");
}
exports.startWallboxModuleRuntime = startWallboxModuleRuntime;
async function initWallboxModule(host) {
    await ensureWallboxStateTree(host);
    await startWallboxModuleRuntime(host);
}
exports.initWallboxModule = initWallboxModule;
function stopWallboxModule() {
    if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
    }
    if (periodicTimer) {
        clearInterval(periodicTimer);
        periodicTimer = null;
    }
    const host = activeHost;
    if (host) {
        if (typeof host.unsubscribeStatesAsync === "function") {
            for (const id of subscribedIds) {
                if (id.startsWith("addons.") || id.startsWith("planner.")) {
                    void Promise.resolve(host.unsubscribeStatesAsync(id)).catch(() => undefined);
                }
            }
        }
        if (typeof host.unsubscribeForeignStatesAsync === "function") {
            for (const id of subscribedIds) {
                if (!id.startsWith("addons.") && !id.startsWith("planner.")) {
                    void Promise.resolve(host.unsubscribeForeignStatesAsync(id)).catch(() => undefined);
                }
            }
        }
    }
    subscribedIds.length = 0;
    activeHost = null;
    (0, runtime_1.resetWallboxDailyPlanCache)();
    (0, runtime_1.resetWallboxDispatchCache)();
    wallboxOwnership = (0, runtime_1.emptyWallboxOwnership)();
    wallboxFault = (0, runtime_1.emptyWallboxFault)();
    pendingWallboxFeedback = null;
}
exports.stopWallboxModule = stopWallboxModule;
const DAILY_PLAN_TRIGGER_IDS = new Set([
    states_1.DAILY_PLAN_STATE_IDS.revision,
    states_1.DAILY_PLAN_STATE_IDS.status,
    states_1.ALLOCATION_ADDON_STATE_IDS.wallbox.planJson,
    (0, tree_paths_1.addonEnabled)(WALLBOX_ADDON_ID),
    (0, governance_1.addonGovernanceEnabledState)(WALLBOX_ADDON_ID),
    tree_paths_1.GLOBAL.executionMode,
    (0, tree_paths_1.addonMode)(WALLBOX_ADDON_ID),
]);
function handleWallboxForeignStateChange(namespace, id) {
    if (!activeHost)
        return;
    const cfg = (0, evcc_config_1.wallboxEvccTelemetryConfigFromAdapter)(activeHost.config);
    const ids = (0, evcc_config_1.configuredEvccTelemetryStateIds)(cfg);
    if (ids.includes(id)) {
        scheduleRefresh(activeHost);
        return;
    }
    void namespace;
}
exports.handleWallboxForeignStateChange = handleWallboxForeignStateChange;
function handleWallboxStateChange(namespace, id) {
    if (!activeHost)
        return;
    const ns = `${namespace}.`;
    const bareId = id.startsWith(ns) ? id.slice(ns.length) : id;
    if (bareId === states_2.WALLBOX_RUNTIME_STATES.faultReset) {
        void activeHost.getStateAsync(states_2.WALLBOX_RUNTIME_STATES.faultReset).then((st) => {
            if (st?.val === true && activeHost) {
                handleWallboxFaultReset(activeHost);
                void activeHost.setStateAsync(states_2.WALLBOX_RUNTIME_STATES.faultReset, { val: false, ack: true });
            }
        });
        return;
    }
    if (DAILY_PLAN_TRIGGER_IDS.has(bareId)) {
        scheduleRefresh(activeHost);
    }
}
exports.handleWallboxStateChange = handleWallboxStateChange;
