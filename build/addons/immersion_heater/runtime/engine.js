"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getImmersionPersistForTest = exports.resetImmersionRuntimeForTest = exports.stopImmersionRuntimeEngine = exports.initImmersionRuntimeEngine = exports.handleImmersionFaultReset = exports.runImmersionRuntimeTick = exports.immersionRuntimeWatchedForeignIds = void 0;
const execution_mode_1 = require("../../../execution_mode");
const state_write_1 = require("../../../policy/core/state_write");
const constants_1 = require("../../../intent/core/constants");
const tree_paths_1 = require("../../../tree_paths");
const device_config_1 = require("../device_config");
const validate_config_1 = require("../validate_config");
const status_1 = require("../status");
const ensure_states_1 = require("./ensure_states");
const fsm_1 = require("./fsm");
const safety_1 = require("./safety");
const types_1 = require("./types");
const persist_1 = require("./persist");
const intent_read_1 = require("./intent_read");
const feedback_1 = require("./feedback");
let engineActive = false;
let hostRef = null;
let persist = (0, persist_1.emptyPersist)();
let tickTimer = null;
let mismatchSinceMs = null;
/** Zeitpunkte, zu denen EMS im Live-Modus selbst EIN/AUS auf das Relais geschrieben hat. */
let emsOnWriteAtMs = null;
let emsOffWriteAtMs = null;
let chatter = { timestampsMs: [] };
/** -1 = noch nie geschrieben → erster Tick stellt EMS-Besitz her (Live schreibt aktuellen Stand). */
let lastCommandedStage = -1;
const subscribedIds = [];
const TICK_MS = 5_000;
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
        void runImmersionRuntimeTick(hostRef).catch((e) => hostRef?.log.warn(`immersion runtime tick: ${e}`));
    }, TICK_MS);
}
async function readForeignNum(host, id) {
    try {
        const reader = host.getForeignStateAsync ?? host.getStateAsync;
        const st = await reader(id);
        if (!st)
            return { value: null, tsMs: null };
        const n = typeof st.val === "number" ? st.val : parseFloat(String(st.val ?? ""));
        const tsMs = st.ts ? new Date(st.ts).getTime() : Date.now();
        return { value: Number.isFinite(n) ? n : null, tsMs };
    }
    catch {
        return { value: null, tsMs: null };
    }
}
async function readForeignRaw(host, id) {
    try {
        const reader = host.getForeignStateAsync ?? host.getStateAsync;
        const st = await reader(id);
        return st ? st.val : null;
    }
    catch {
        return null;
    }
}
/** Liest die konfigurierten Stage-Feedback-States aktiv und normalisiert sie. */
async function readFeedbackReadings(host, config) {
    const readings = [];
    for (const stage of config.stages) {
        if (!stage.feedbackStateId)
            continue;
        const raw = await readForeignRaw(host, stage.feedbackStateId);
        readings.push({ index: stage.index, active: (0, feedback_1.normalizeFeedbackActive)(raw) });
    }
    return readings;
}
/** Konfigurierte Fremd-States, deren Änderung einen Runtime-Tick auslösen soll. */
function immersionRuntimeWatchedForeignIds(config) {
    const ids = new Set();
    if (config.bufferTempStateId)
        ids.add(config.bufferTempStateId);
    if (config.actualPowerStateId)
        ids.add(config.actualPowerStateId);
    for (const stage of config.stages) {
        if (stage.feedbackStateId)
            ids.add(stage.feedbackStateId);
    }
    return [...ids];
}
exports.immersionRuntimeWatchedForeignIds = immersionRuntimeWatchedForeignIds;
async function submitAutoRevertToAuto(host, now) {
    const issuedAt = now.toISOString();
    const raw = {
        schema_version: constants_1.INTENT_SCHEMA_VERSION,
        request_id: `auto-revert-${issuedAt}`,
        issued_at: issuedAt,
        owner: { type: "ems_ui", id: "immersion_runtime" },
        values: { operating_request: (0, fsm_1.controlModeToOperatingRequest)("auto") },
        clear_fields: ["target_temperature_c", "ready_at"],
    };
    await host.setStateAsync(constants_1.IOBROKER_THERMAL_REQUEST_STATE, { val: JSON.stringify(raw), ack: false });
}
async function readBool(host, id) {
    const st = await host.getStateAsync(id);
    return st?.val === true;
}
async function applyStageWrites(host, stageIndex, live) {
    // Dryrun: EMS besitzt das Relais nicht — keine physischen Writes.
    if (!live)
        return;
    const config = (0, device_config_1.immersionDeviceConfigFromAdapter)(host.config);
    for (const stage of config.stages) {
        if (!stage.setStateId)
            continue;
        const on = stage.index === stageIndex;
        if (!host.setForeignStateAsync)
            continue;
        try {
            await host.setForeignStateAsync(stage.setStateId, { val: on, ack: true });
        }
        catch (e) {
            host.log.error?.(`immersion write stage ${stage.index}: ${e}`);
            persist.faultLockout = true;
            persist.faultCode = "write_failed";
            persist.faultSince = new Date().toISOString();
        }
    }
}
async function runImmersionRuntimeTick(host) {
    const now = new Date();
    const nowMs = now.getTime();
    const config = (0, device_config_1.immersionDeviceConfigFromAdapter)(host.config);
    const validation = (0, validate_config_1.validateImmersionDeviceConfig)(config);
    const enabled = await readBool(host, (0, tree_paths_1.addonEnabled)("immersion_heater"));
    const available = await readBool(host, (0, tree_paths_1.addonAvailable)("immersion_heater"));
    const live = await (0, execution_mode_1.isLiveWriteAllowed)((id) => host.getStateAsync(id), "immersion_heater");
    const failsafeActive = await readBool(host, status_1.IMMERSION_STATUS_STATES.failsafeActive);
    const intentRaw = await host.getStateAsync("user_intent.thermal.resolved_json");
    const intent = (0, intent_read_1.parseResolvedIntentJson)(intentRaw?.val);
    let resolvedMode = (0, intent_read_1.resolvedModeFromIntent)(intent);
    let forceTarget = (0, intent_read_1.forceTargetFromIntent)(intent);
    let forceUntil = (0, intent_read_1.forceUntilFromIntent)(intent);
    if (forceUntil && (0, persist_1.isForceExpired)(forceUntil, nowMs)) {
        forceUntil = null;
    }
    let tempVal = null;
    let tempObsMs = null;
    if (config.bufferTempEnabled && config.bufferTempStateId) {
        const tr = await readForeignNum(host, config.bufferTempStateId);
        tempVal = tr.value;
        tempObsMs = tr.tsMs;
    }
    const temperature = (0, fsm_1.evaluateTemperature)(tempVal, tempObsMs, nowMs, config);
    const powerRead = config.actualPowerStateId ? await readForeignNum(host, config.actualPowerStateId) : { value: null, tsMs: null };
    const measuredPower = powerRead.value;
    const hasPower = Boolean(config.actualPowerStateId);
    const fsm = (0, fsm_1.runImmersionFsm)({
        nowMs,
        addonEnabled: enabled,
        addonAvailable: available,
        configValid: validation.valid,
        executionLive: live,
        failsafeActive,
        resolvedMode,
        forceTargetTempC: forceTarget,
        forceUntilMs: forceUntil ? Date.parse(forceUntil) : null,
        temperature,
        measuredPowerW: measuredPower,
        hasPowerMeasurement: hasPower,
        persist,
        config,
        faultLockout: persist.faultLockout,
        faultCode: persist.faultCode,
    });
    if (fsm.autoRevertToAuto) {
        resolvedMode = "auto";
        await submitAutoRevertToAuto(host, now);
    }
    const commandedStage = fsm.faultLockout ? 0 : fsm.commandedStage;
    const effectiveStage = persist.faultLockout || failsafeActive || resolvedMode === "off" ? 0 : commandedStage;
    const commandedOn = effectiveStage > 0;
    // Realer Relais-Übergang → Buchhaltung, Chatter, physischer Write (nur Live) + Write-Zeitstempel.
    if (effectiveStage !== lastCommandedStage) {
        if (effectiveStage === 0) {
            persist.lastOffAtMs = nowMs;
            persist.pauseUntilMs = nowMs + config.minimumPauseSec * 1000;
        }
        else {
            persist.lastSwitchAtMs = nowMs;
        }
        chatter = (0, safety_1.recordChatterEvent)(chatter, nowMs, config.relayChatterWindowSec);
        await applyStageWrites(host, effectiveStage, live);
        if (live) {
            if (effectiveStage === 0)
                emsOffWriteAtMs = nowMs;
            else
                emsOnWriteAtMs = nowMs;
        }
        lastCommandedStage = effectiveStage;
    }
    if ((0, safety_1.isRelayChatter)(chatter, config.relayChatterMaxChanges)) {
        persist.faultLockout = true;
        persist.faultCode = "relay_chatter";
        persist.faultSince = now.toISOString();
    }
    const feedbackReadings = await readFeedbackReadings(host, config);
    const hasFeedbackConfig = config.stages.some((s) => Boolean(s.feedbackStateId));
    const feedbackStage = hasFeedbackConfig ? (0, feedback_1.feedbackStageFromReadings)(feedbackReadings) : effectiveStage;
    const feedbackActive = feedbackStage > 0;
    const powerActive = hasPower && measuredPower !== null && measuredPower > config.powerOnThresholdW;
    const powerCheck = (0, safety_1.checkPowerFault)({
        nowMs,
        executionLive: live,
        commandedOn,
        commandedStage: effectiveStage,
        nominalPowerW: fsm.commandedPowerW,
        measuredPowerW: measuredPower,
        hasPowerMeasurement: hasPower,
        feedbackActive,
        emsOnWriteAtMs,
        emsOffWriteAtMs,
        mismatchSinceMs,
        config,
    });
    mismatchSinceMs = powerCheck.mismatchSinceMs;
    if (powerCheck.lockout) {
        persist.faultLockout = true;
        persist.faultCode = powerCheck.faultCode;
        persist.faultSince = now.toISOString();
    }
    let powerVerificationStatus = persist.faultLockout ? "fault" : fsm.powerVerificationStatus;
    const externalStatus = (0, feedback_1.externalOnStatus)({ commandedStage: effectiveStage, feedbackActive, powerActive });
    if (externalStatus && !persist.faultLockout) {
        powerVerificationStatus = externalStatus;
    }
    persist.commandedStage = effectiveStage;
    persist.resolvedMode = resolvedMode;
    persist.forceTargetTempC = forceTarget;
    persist.forceUntil = forceUntil;
    persist.minRuntimeUntilMs = fsm.minRuntimeUntilMs;
    persist.pauseUntilMs = fsm.pauseUntilMs;
    const minRuntimeRem = persist.minRuntimeUntilMs ? Math.max(0, Math.ceil((persist.minRuntimeUntilMs - nowMs) / 1000)) : 0;
    const minPauseRem = persist.pauseUntilMs ? Math.max(0, Math.ceil((persist.pauseUntilMs - nowMs) / 1000)) : 0;
    const snapshot = {
        schema_version: 1,
        available: fsm.available && !persist.faultLockout,
        state: persist.faultLockout ? "fault_lockout" : fsm.state,
        requested_mode: resolvedMode,
        resolved_mode: resolvedMode,
        buffer_temperature_c: temperature.valueC,
        temperature_status: temperature.status,
        planning_min_temp_c: config.planningMinTempC,
        planning_max_temp_c: config.planningMaxTempC,
        force_target_temp_c: forceTarget,
        force_until: forceUntil,
        commanded_stage: persist.faultLockout ? 0 : effectiveStage,
        commanded_power_w: !persist.faultLockout && effectiveStage > 0 ? fsm.commandedPowerW : 0,
        feedback_stage: feedbackStage,
        measured_power_w: measuredPower,
        power_verification_status: powerVerificationStatus,
        minimum_runtime_remaining_sec: minRuntimeRem,
        minimum_pause_remaining_sec: minPauseRem,
        last_switch_at: persist.lastSwitchAtMs ? new Date(persist.lastSwitchAtMs).toISOString() : null,
        fault_active: persist.faultLockout,
        fault_code: persist.faultCode,
        fault_since: persist.faultSince,
        fault_message: persist.faultLockout ? persist.faultCode : "",
        reason: fsm.reason,
        execution_mode: live ? "live" : "dryrun",
        updated_at: now.toISOString(),
    };
    await publishRuntime(host, snapshot);
    const dataDir = host.getAbsolutePath?.("immersion_heater");
    if (dataDir) {
        await (0, persist_1.writeRuntimePersist)(dataDir, persist);
    }
    scheduleTick();
}
exports.runImmersionRuntimeTick = runImmersionRuntimeTick;
async function publishRuntime(host, s) {
    await (0, state_write_1.setStateIfChanged)(host, types_1.IMMERSION_RUNTIME_STATES.available, s.available);
    await (0, state_write_1.setStateIfChanged)(host, types_1.IMMERSION_RUNTIME_STATES.state, s.state);
    await (0, state_write_1.setStateIfChanged)(host, types_1.IMMERSION_RUNTIME_STATES.requestedMode, s.requested_mode);
    await (0, state_write_1.setStateIfChanged)(host, types_1.IMMERSION_RUNTIME_STATES.resolvedMode, s.resolved_mode);
    await (0, state_write_1.setStateIfChanged)(host, types_1.IMMERSION_RUNTIME_STATES.bufferTemperatureC, s.buffer_temperature_c ?? "");
    await (0, state_write_1.setStateIfChanged)(host, types_1.IMMERSION_RUNTIME_STATES.temperatureStatus, s.temperature_status);
    await (0, state_write_1.setStateIfChanged)(host, types_1.IMMERSION_RUNTIME_STATES.planningMinTempC, s.planning_min_temp_c);
    await (0, state_write_1.setStateIfChanged)(host, types_1.IMMERSION_RUNTIME_STATES.planningMaxTempC, s.planning_max_temp_c);
    await (0, state_write_1.setStateIfChanged)(host, types_1.IMMERSION_RUNTIME_STATES.forceTargetTempC, s.force_target_temp_c ?? "");
    await (0, state_write_1.setStateIfChanged)(host, types_1.IMMERSION_RUNTIME_STATES.forceUntil, s.force_until ?? "");
    await (0, state_write_1.setStateIfChanged)(host, types_1.IMMERSION_RUNTIME_STATES.commandedStage, s.commanded_stage);
    await (0, state_write_1.setStateIfChanged)(host, types_1.IMMERSION_RUNTIME_STATES.commandedPowerW, s.commanded_power_w);
    await (0, state_write_1.setStateIfChanged)(host, types_1.IMMERSION_RUNTIME_STATES.feedbackStage, s.feedback_stage);
    await (0, state_write_1.setStateIfChanged)(host, types_1.IMMERSION_RUNTIME_STATES.measuredPowerW, s.measured_power_w ?? "");
    await (0, state_write_1.setStateIfChanged)(host, types_1.IMMERSION_RUNTIME_STATES.powerVerificationStatus, s.power_verification_status);
    await (0, state_write_1.setStateIfChanged)(host, types_1.IMMERSION_RUNTIME_STATES.minRuntimeRemainingSec, s.minimum_runtime_remaining_sec);
    await (0, state_write_1.setStateIfChanged)(host, types_1.IMMERSION_RUNTIME_STATES.minPauseRemainingSec, s.minimum_pause_remaining_sec);
    await (0, state_write_1.setStateIfChanged)(host, types_1.IMMERSION_RUNTIME_STATES.lastSwitchAt, s.last_switch_at ?? "");
    await (0, state_write_1.setStateIfChanged)(host, types_1.IMMERSION_RUNTIME_STATES.faultActive, s.fault_active);
    await (0, state_write_1.setStateIfChanged)(host, types_1.IMMERSION_RUNTIME_STATES.faultCode, s.fault_code);
    await (0, state_write_1.setStateIfChanged)(host, types_1.IMMERSION_RUNTIME_STATES.faultSince, s.fault_since ?? "");
    await (0, state_write_1.setStateIfChanged)(host, types_1.IMMERSION_RUNTIME_STATES.faultMessage, s.fault_message);
    await (0, state_write_1.setStateIfChanged)(host, types_1.IMMERSION_RUNTIME_STATES.reason, s.reason);
    await (0, state_write_1.setStateIfChanged)(host, types_1.IMMERSION_RUNTIME_STATES.snapshotJson, JSON.stringify(s));
}
async function handleImmersionFaultReset(host, ack) {
    if (ack === true)
        return;
    const config = (0, device_config_1.immersionDeviceConfigFromAdapter)(host.config);
    const validation = (0, validate_config_1.validateImmersionDeviceConfig)(config);
    const measured = config.actualPowerStateId ? (await readForeignNum(host, config.actualPowerStateId)).value : null;
    const reset = (0, safety_1.canResetFault)({
        allStagesOff: lastCommandedStage <= 0,
        measuredPowerW: measured,
        hasPowerMeasurement: Boolean(config.actualPowerStateId),
        powerOffThresholdW: config.powerOffThresholdW,
        configValid: validation.valid,
        temperatureValid: true,
        chatterActive: (0, safety_1.isRelayChatter)(chatter, config.relayChatterMaxChanges),
    });
    if (reset.ok) {
        persist.faultLockout = false;
        persist.faultCode = "none";
        persist.faultSince = null;
        chatter = { timestampsMs: [] };
        host.log.info("immersion_heater: fault reset accepted");
    }
    else {
        host.log.warn(`immersion_heater: fault reset rejected: ${reset.reason}`);
    }
    await host.setStateAsync(types_1.IMMERSION_RUNTIME_STATES.faultReset, { val: false, ack: true });
    await runImmersionRuntimeTick(host);
}
exports.handleImmersionFaultReset = handleImmersionFaultReset;
async function initImmersionRuntimeEngine(host) {
    if (engineActive && hostRef === host)
        return;
    engineActive = true;
    hostRef = host;
    await (0, ensure_states_1.ensureImmersionRuntimeStates)(host);
    const dataDir = host.getAbsolutePath?.("immersion_heater");
    if (dataDir) {
        const loaded = await (0, persist_1.readRuntimePersist)(dataDir);
        if (loaded) {
            persist = loaded;
            if (persist.forceUntil && (0, persist_1.isForceExpired)(persist.forceUntil, Date.now())) {
                persist.forceUntil = null;
                persist.resolvedMode = "auto";
            }
        }
    }
    const config = (0, device_config_1.immersionDeviceConfigFromAdapter)(host.config);
    const subs = new Set([
        "user_intent.thermal.resolved_json",
        types_1.IMMERSION_RUNTIME_STATES.faultReset,
        (0, tree_paths_1.addonEnabled)("immersion_heater"),
        (0, tree_paths_1.addonAvailable)("immersion_heater"),
    ]);
    if (config.bufferTempStateId)
        subs.add(config.bufferTempStateId);
    if (config.actualPowerStateId)
        subs.add(config.actualPowerStateId);
    for (const s of config.stages) {
        if (s.feedbackStateId)
            subs.add(s.feedbackStateId);
    }
    if (host.subscribeStatesAsync) {
        for (const id of subs) {
            if (!id.startsWith("user_intent") && !id.startsWith("addons."))
                continue;
            if (subscribedIds.includes(id))
                continue;
            await host.subscribeStatesAsync(id);
            subscribedIds.push(id);
        }
    }
    if (host.subscribeForeignStatesAsync) {
        for (const id of subs) {
            if (id.startsWith("user_intent") || id.startsWith("addons."))
                continue;
            if (subscribedIds.includes(id))
                continue;
            await host.subscribeForeignStatesAsync(id);
            subscribedIds.push(id);
        }
    }
    await runImmersionRuntimeTick(host);
    host.log.info("immersion_heater: runtime engine initialized");
}
exports.initImmersionRuntimeEngine = initImmersionRuntimeEngine;
function stopImmersionRuntimeEngine() {
    const host = hostRef;
    clearTick();
    if (host?.unsubscribeStatesAsync) {
        for (const id of subscribedIds) {
            if (id.startsWith("user_intent") || id.startsWith("addons.")) {
                void host.unsubscribeStatesAsync(id).catch((e) => host.log.debug?.(`immersion unsub ${id}: ${e}`));
            }
        }
    }
    if (host?.unsubscribeForeignStatesAsync) {
        for (const id of subscribedIds) {
            if (!id.startsWith("user_intent") && !id.startsWith("addons.")) {
                void host.unsubscribeForeignStatesAsync(id).catch((e) => host.log.debug?.(`immersion foreign unsub ${id}: ${e}`));
            }
        }
    }
    engineActive = false;
    hostRef = null;
    persist = (0, persist_1.emptyPersist)();
    lastCommandedStage = -1;
    emsOnWriteAtMs = null;
    emsOffWriteAtMs = null;
    mismatchSinceMs = null;
    subscribedIds.length = 0;
    chatter = { timestampsMs: [] };
}
exports.stopImmersionRuntimeEngine = stopImmersionRuntimeEngine;
function resetImmersionRuntimeForTest() {
    stopImmersionRuntimeEngine();
}
exports.resetImmersionRuntimeForTest = resetImmersionRuntimeForTest;
function getImmersionPersistForTest() {
    return persist;
}
exports.getImmersionPersistForTest = getImmersionPersistForTest;
