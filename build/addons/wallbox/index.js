"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleWallboxForeignStateChange = exports.stopWallboxModule = exports.initWallboxModule = exports.refreshWallboxEvccTelemetry = void 0;
const evcc_config_1 = require("./evcc_config");
const ensure_evcc_states_1 = require("./ensure_evcc_states");
const evcc_telemetry_1 = require("./evcc_telemetry");
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
    await refreshWallboxEvccTelemetry(host);
    const cfg = (0, evcc_config_1.wallboxEvccTelemetryConfigFromAdapter)(host.config);
    const ids = (0, evcc_config_1.configuredEvccTelemetryStateIds)(cfg);
    for (const id of ids) {
        if (subscribedIds.includes(id))
            continue;
        if (typeof host.subscribeForeignStatesAsync === "function") {
            try {
                await host.subscribeForeignStatesAsync(id, () => scheduleRefresh(host));
                subscribedIds.push(id);
            }
            catch (e) {
                host.log.debug?.(`wallbox evcc subscribe ${id}: ${e}`);
            }
        }
    }
    host.log.info("Wallbox EVCC telemetry module initialized (read-only)");
}
exports.initWallboxModule = initWallboxModule;
function stopWallboxModule() {
    if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
    }
    const host = activeHost;
    if (host && typeof host.unsubscribeForeignStatesAsync === "function") {
        for (const id of subscribedIds) {
            void Promise.resolve(host.unsubscribeForeignStatesAsync(id)).catch(() => undefined);
        }
    }
    subscribedIds.length = 0;
    activeHost = null;
}
exports.stopWallboxModule = stopWallboxModule;
function handleWallboxForeignStateChange(namespace, id) {
    if (!activeHost)
        return;
    const cfg = (0, evcc_config_1.wallboxEvccTelemetryConfigFromAdapter)(activeHost.config);
    const ids = (0, evcc_config_1.configuredEvccTelemetryStateIds)(cfg);
    if (ids.includes(id)) {
        scheduleRefresh(activeHost);
    }
    void namespace;
}
exports.handleWallboxForeignStateChange = handleWallboxForeignStateChange;
