"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleWallboxStateChange = exports.handleWallboxForeignStateChange = exports.stopWallboxModule = exports.initWallboxModule = exports.refreshWallboxEvccTelemetry = void 0;
const evcc_config_1 = require("./evcc_config");
const ensure_evcc_states_1 = require("./ensure_evcc_states");
const evcc_telemetry_1 = require("./evcc_telemetry");
const governance_1 = require("../governance");
const execution_mode_1 = require("../../execution_mode");
const tree_paths_1 = require("../../tree_paths");
const states_1 = require("../../operator/daily_plan/states");
const runtime_1 = require("./runtime");
const config_1 = require("../../intent/config");
const evcc_control_config_1 = require("./evcc_control_config");
const control_object_meta_1 = require("./runtime/control_object_meta");
let activeHost = null;
const subscribedIds = [];
let debounceTimer = null;
const DEBOUNCE_MS = 300;
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
    const foundation = await (0, runtime_1.runWallboxLiveFoundation)({
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
    });
    await (0, runtime_1.publishWallboxLiveFoundationStates)(host, foundation);
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
    await writeField(host, ensure_evcc_states_1.WALLBOX_EVCC_STATES.vehicleSocPct, snap.vehicle_soc_pct);
    await writeField(host, ensure_evcc_states_1.WALLBOX_EVCC_STATES.planActive, snap.plan_active);
    await writeField(host, ensure_evcc_states_1.WALLBOX_EVCC_STATES.planSocPct, snap.plan_soc_pct);
    await writeTimeField(host, ensure_evcc_states_1.WALLBOX_EVCC_STATES.planTime, snap.plan_time);
    await writeTimeField(host, ensure_evcc_states_1.WALLBOX_EVCC_STATES.effectivePlanTime, snap.effective_plan_time);
    await writeField(host, ensure_evcc_states_1.WALLBOX_EVCC_STATES.activePhases, snap.active_phases);
    await writeField(host, ensure_evcc_states_1.WALLBOX_EVCC_STATES.configuredPhases, snap.configured_phases);
    await writeField(host, ensure_evcc_states_1.WALLBOX_EVCC_STATES.minCurrentA, snap.min_current_a);
    await writeField(host, ensure_evcc_states_1.WALLBOX_EVCC_STATES.maxCurrentA, snap.max_current_a);
    await writeField(host, ensure_evcc_states_1.WALLBOX_EVCC_STATES.batteryMode, snap.battery_mode);
    await writeField(host, ensure_evcc_states_1.WALLBOX_EVCC_STATES.batteryDischargeControl, snap.battery_discharge_control);
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
async function initWallboxModule(host) {
    if (activeHost === host)
        return;
    activeHost = host;
    await (0, ensure_evcc_states_1.ensureWallboxEvccStates)(host);
    await (0, runtime_1.ensureWallboxRuntimeStates)(host);
    await refreshWallboxEvccTelemetry(host);
    const cfg = (0, evcc_config_1.wallboxEvccTelemetryConfigFromAdapter)(host.config);
    const ids = new Set((0, evcc_config_1.configuredEvccTelemetryStateIds)(cfg));
    ids.add((0, tree_paths_1.addonEnabled)(WALLBOX_ADDON_ID));
    ids.add((0, governance_1.addonGovernanceEnabledState)(WALLBOX_ADDON_ID));
    ids.add(tree_paths_1.GLOBAL.executionMode);
    ids.add((0, tree_paths_1.addonMode)(WALLBOX_ADDON_ID));
    ids.add(states_1.DAILY_PLAN_STATE_IDS.revision);
    ids.add(states_1.DAILY_PLAN_STATE_IDS.status);
    ids.add(states_1.ALLOCATION_ADDON_STATE_IDS.wallbox.planJson);
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
    host.log.debug("Wallbox EVCC telemetry module initialized (read-only)");
}
exports.initWallboxModule = initWallboxModule;
function stopWallboxModule() {
    if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
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
    if (DAILY_PLAN_TRIGGER_IDS.has(bareId)) {
        scheduleRefresh(activeHost);
    }
}
exports.handleWallboxStateChange = handleWallboxStateChange;
