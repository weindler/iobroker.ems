"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.acRuntimeWatchedForeignIds = exports.stopAcRuntimeEngine = exports.initAcRuntimeEngine = exports.runAcRuntimeTick = void 0;
const ems_activity_1 = require("../../../ems_activity");
const execution_mode_1 = require("../../../execution_mode");
const state_util_1 = require("../../../ems_light/state_util");
const state_write_1 = require("../../../policy/core/state_write");
const tree_paths_1 = require("../../../tree_paths");
const consumer_stats_1 = require("../../../learning/consumer_stats");
const constants_1 = require("../constants");
const config_1 = require("../config");
const registry_1 = require("../profiles/registry");
const ensure_states_1 = require("./ensure_states");
const fsm_1 = require("./fsm");
const persist_1 = require("./persist");
const persist_io_1 = require("./persist_io");
const sequences_1 = require("./sequences");
const time_1 = require("./time");
let engineActive = false;
let hostRef = null;
let persist = { version: 1, units: {} };
let tickTimer = null;
const subscribedIds = [];
let cleaningPendingUntilMs = {};
function clearTick() {
    if (tickTimer) {
        clearTimeout(tickTimer);
        tickTimer = null;
    }
}
function scheduleTick() {
    clearTick();
    if (!engineActive)
        return;
    tickTimer = setTimeout(() => {
        tickTimer = null;
        if (!engineActive || !hostRef)
            return;
        void runAcRuntimeTick(hostRef).catch((e) => hostRef?.log.warn(`ac runtime tick: ${e}`));
    }, constants_1.AC_TICK_MS);
}
async function readForeign(host, id) {
    if (!id)
        return { value: null, num: null };
    try {
        const reader = host.getForeignStateAsync ?? host.getStateAsync;
        const st = await reader(id);
        return { value: st?.val ?? null, num: (0, state_util_1.asNum)(st?.val) };
    }
    catch {
        return { value: null, num: null };
    }
}
function unitPersist(index) {
    if (!persist.units[index]) {
        persist.units[index] = (0, persist_1.emptyUnitPersist)(index);
    }
    return persist.units[index];
}
function allocatedPowerW(runningCount, outdoorMax, unitEstimated) {
    if (runningCount <= 0)
        return 0;
    if (runningCount === 1)
        return unitEstimated;
    return Math.min(unitEstimated, Math.round(outdoorMax / runningCount));
}
async function stopUnit(host, unit, table, live, up) {
    const offId = (0, sequences_1.resolveAcMappingTarget)(table, unit.index, "cmd_switch_off");
    const refreshId = (0, sequences_1.resolveAcMappingTarget)(table, unit.index, "cmd_refresh");
    if (live && offId) {
        await (0, sequences_1.executeAcWriteSteps)(host, unit.index, table, [{ kind: "toggle", role: "cmd_switch_off" }], true, host.log);
        if (refreshId) {
            await (0, sequences_1.executeAcWriteSteps)(host, unit.index, table, [{ kind: "toggle", role: "cmd_refresh" }], true, host.log);
        }
    }
    else if (!live) {
        host.log.info(`ac dryrun unit ${unit.index}: stop`);
    }
    up.running = false;
    up.lastStopAtMs = Date.now();
    if (unit.cleaningAfterRun) {
        cleaningPendingUntilMs[unit.index] = Date.now() + unit.cleaningDelayMin * 60_000;
    }
}
async function startUnit(host, unit, table, live, up, modePurpose) {
    const profile = (0, registry_1.getAcProfile)(unit.profileId);
    const steps = profile.coolingStartSequence(unit, modePurpose);
    await (0, sequences_1.executeAcWriteSteps)(host, unit.index, table, steps, live, host.log);
    up.running = true;
    up.lastStartAtMs = Date.now();
}
async function tickCleaning(host, unit, table, live, up, nowMs) {
    const pending = cleaningPendingUntilMs[unit.index];
    if (pending && nowMs >= pending && !up.cleaningActive) {
        delete cleaningPendingUntilMs[unit.index];
        const profile = (0, registry_1.getAcProfile)(unit.profileId);
        await (0, sequences_1.executeAcWriteSteps)(host, unit.index, table, profile.cleaningStartSequence(), live, host.log);
        up.cleaningActive = true;
        up.cleaningStartedAtMs = nowMs;
    }
    if (up.cleaningActive && up.cleaningStartedAtMs) {
        const endMs = up.cleaningStartedAtMs + unit.cleaningDurationMin * 60_000;
        if (nowMs >= endMs) {
            const profile = (0, registry_1.getAcProfile)(unit.profileId);
            await (0, sequences_1.executeAcWriteSteps)(host, unit.index, table, profile.cleaningStopSequence(), live, host.log);
            up.cleaningActive = false;
            up.cleaningStartedAtMs = null;
        }
    }
}
async function runAcRuntimeTick(host) {
    (0, ems_activity_1.touchEmsActivity)();
    const now = new Date();
    const nowMs = now.getTime();
    const config = (0, config_1.acGlobalConfigFromAdapter)(host.config);
    const configRecord = host.config && typeof host.config === "object" ? host.config : {};
    const mappingTable = (0, sequences_1.buildAcMappingTableFromConfig)(configRecord);
    const addonOn = await host.getStateAsync((0, tree_paths_1.addonEnabled)(constants_1.AC_ADDON_ID));
    const addonEnabledVal = addonOn?.val !== false;
    const live = await (0, execution_mode_1.isLiveWriteAllowed)((id) => host.getStateAsync(id), constants_1.AC_ADDON_ID);
    const activeUnits = config.units.filter((u) => u.enabled);
    let runningCount = 0;
    for (const unit of activeUnits) {
        const tempId = (0, sequences_1.resolveAcMappingTarget)(mappingTable, unit.index, "room_temp");
        const humId = (0, sequences_1.resolveAcMappingTarget)(mappingTable, unit.index, "room_humidity");
        const fbId = (0, sequences_1.resolveAcMappingTarget)(mappingTable, unit.index, "feedback_switch");
        const temp = await readForeign(host, tempId);
        const hum = await readForeign(host, humId);
        const fb = await readForeign(host, fbId);
        const up = unitPersist(unit.index);
        if ((0, time_1.switchIsOn)(fb.value))
            runningCount += 1;
        await tickCleaning(host, unit, mappingTable, live, up, nowMs);
        if (!addonEnabledVal && (0, time_1.switchIsOn)(fb.value)) {
            await stopUnit(host, unit, mappingTable, live, up);
        }
        const fsm = (0, fsm_1.evaluateAcUnitFsm)({
            now,
            addonEnabled: addonEnabledVal,
            unit,
            roomTempC: temp.num,
            roomHumidityPct: hum.num,
            feedbackSwitchRaw: fb.value,
            cleaningActive: up.cleaningActive,
        });
        if (fsm.demandStop) {
            if ((0, time_1.switchIsOn)(fb.value)) {
                await stopUnit(host, unit, mappingTable, live, up);
            }
            else {
                up.running = false;
            }
        }
        else if (fsm.demandStart && (0, time_1.switchIsOff)(fb.value) && !up.running) {
            await startUnit(host, unit, mappingTable, live, up, fsm.modePurpose);
        }
        const ids = (0, ensure_states_1.acUnitRuntimeStates)(unit.index);
        const estPower = allocatedPowerW(runningCount || ((0, time_1.switchIsOn)(fb.value) ? 1 : 0), config.outdoorMaxPowerW, unit.estimatedPowerW);
        await (0, state_write_1.setStateIfChanged)(host, ids.state, fsm.state);
        await (0, state_write_1.setStateIfChanged)(host, ids.reasonDe, fsm.reasonDe);
        await (0, state_write_1.setStateIfChanged)(host, ids.roomTempC, temp.num ?? "");
        await (0, state_write_1.setStateIfChanged)(host, ids.roomHumidityPct, hum.num ?? "");
        await (0, state_write_1.setStateIfChanged)(host, ids.feedbackSwitch, fb.value == null ? "" : String(fb.value));
        await (0, state_write_1.setStateIfChanged)(host, ids.running, (0, time_1.switchIsOn)(fb.value));
        await (0, state_write_1.setStateIfChanged)(host, ids.cleaningActive, up.cleaningActive);
        await (0, state_write_1.setStateIfChanged)(host, ids.modePurpose, fsm.modePurpose);
        await (0, state_write_1.setStateIfChanged)(host, ids.estimatedPowerW, estPower);
        const deviceActive = (0, time_1.switchIsOn)(fb.value);
        const countable = live && deviceActive;
        await (0, consumer_stats_1.tickConsumerStats)(host, {
            consumerKey: (0, constants_1.acUnitConsumerKey)(unit.index),
            nowMs,
            deviceActive,
            countable,
            measuredPowerW: null,
            commandedPowerW: estPower,
        });
    }
    await (0, state_write_1.setStateIfChanged)(host, `${ensure_states_1.AC_RUNTIME_BASE}.outdoor_allocated_power_w`, config.outdoorMaxPowerW);
    const dataDir = host.getAbsolutePath?.("air_conditioning");
    if (dataDir) {
        await (0, persist_io_1.writeAcRuntimePersist)(dataDir, persist);
    }
    scheduleTick();
}
exports.runAcRuntimeTick = runAcRuntimeTick;
async function initAcRuntimeEngine(host) {
    if (engineActive && hostRef === host)
        return;
    engineActive = true;
    hostRef = host;
    await (0, ensure_states_1.ensureAcRuntimeStates)(host);
    for (let i = 1; i <= 5; i++) {
        await (0, consumer_stats_1.initConsumerStatsForKey)(host, (0, constants_1.acUnitConsumerKey)(i));
    }
    const dataDir = host.getAbsolutePath?.("air_conditioning");
    if (dataDir) {
        persist = await (0, persist_io_1.readAcRuntimePersist)(dataDir);
    }
    const cfg = (0, config_1.acGlobalConfigFromAdapter)(host.config);
    const configRecord = host.config && typeof host.config === "object" ? host.config : {};
    const mappingTable = (0, sequences_1.buildAcMappingTableFromConfig)(configRecord);
    const subs = new Set([(0, tree_paths_1.addonEnabled)(constants_1.AC_ADDON_ID), (0, tree_paths_1.addonAvailable)(constants_1.AC_ADDON_ID)]);
    if (host.subscribeStatesAsync) {
        for (const id of subs) {
            if (subscribedIds.includes(id))
                continue;
            await host.subscribeStatesAsync(id);
            subscribedIds.push(id);
        }
    }
    for (const unit of cfg.units.filter((u) => u.enabled)) {
        for (const role of constants_1.AC_MAPPING_ROLES) {
            const id = (0, sequences_1.resolveAcMappingTarget)(mappingTable, unit.index, role);
            if (id)
                subs.add(id);
        }
    }
    if (host.subscribeForeignStatesAsync) {
        for (const id of subs) {
            if (id.startsWith("addons."))
                continue;
            if (subscribedIds.includes(id))
                continue;
            await host.subscribeForeignStatesAsync(id);
            subscribedIds.push(id);
        }
    }
    await runAcRuntimeTick(host);
    host.log.info("air_conditioning: runtime engine initialized");
}
exports.initAcRuntimeEngine = initAcRuntimeEngine;
function stopAcRuntimeEngine() {
    const host = hostRef;
    clearTick();
    if (host) {
        void (0, consumer_stats_1.flushConsumerStatsPersist)(host).catch((e) => host.log.debug?.(`ac stats flush: ${e}`));
    }
    (0, consumer_stats_1.resetConsumerStatsCache)();
    if (host?.unsubscribeForeignStatesAsync) {
        for (const id of subscribedIds) {
            if (!id.startsWith("addons.")) {
                void host.unsubscribeForeignStatesAsync(id).catch(() => undefined);
            }
        }
    }
    engineActive = false;
    hostRef = null;
    persist = { version: 1, units: {} };
    subscribedIds.length = 0;
    cleaningPendingUntilMs = {};
}
exports.stopAcRuntimeEngine = stopAcRuntimeEngine;
function acRuntimeWatchedForeignIds(config) {
    const configRecord = config && typeof config === "object" ? config : {};
    const mappingTable = (0, sequences_1.buildAcMappingTableFromConfig)(configRecord);
    const cfg = (0, config_1.acGlobalConfigFromAdapter)(config);
    const ids = [];
    for (const unit of cfg.units.filter((u) => u.enabled)) {
        for (const role of constants_1.AC_MAPPING_ROLES) {
            const id = (0, sequences_1.resolveAcMappingTarget)(mappingTable, unit.index, role);
            if (id)
                ids.push(id);
        }
    }
    return ids;
}
exports.acRuntimeWatchedForeignIds = acRuntimeWatchedForeignIds;
