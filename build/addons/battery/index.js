"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.batteryUnloadRestore = exports.runBatteryControlTick = exports.handleBatteryForeignStateChange = exports.handleBatteryAdapterStateChange = exports.stopBatteryModule = exports.initBatteryModule = exports.__resetBatteryRuntimeForTest = exports.BATTERY_ADDON_ID = void 0;
const governance_1 = require("../governance");
const tree_paths_1 = require("../../tree_paths");
const execution_mode_1 = require("../../execution_mode");
const mapping_sync_1 = require("../../mapping_sync");
const config_1 = require("./config");
const intent_1 = require("./core/intent");
const validation_1 = require("./core/validation");
const diagnostics_1 = require("./diagnostics");
const ensure_states_1 = require("./ensure_states");
const ems_mirror_1 = require("./ems_mirror");
const grid_balance_1 = require("./grid_balance");
const mapping_1 = require("./mapping");
const registry_1 = require("./profiles/registry");
const fsm_1 = require("./runtime/fsm");
const execute_1 = require("./runtime/execute");
const ownership_1 = require("./runtime/ownership");
const safety_1 = require("./runtime/safety");
exports.BATTERY_ADDON_ID = "battery";
const CONTROL_INTERVAL_MS = 5000;
let controlTimer = null;
let runtime = (0, fsm_1.initialSonnenRuntime)(Date.now());
let gridBalancePausedByFsm = false;
let ownershipLive = false;
let ticking = false;
/** Nur für Tests: internen Laufzeitzustand zurücksetzen. */
function __resetBatteryRuntimeForTest(now = Date.now()) {
    runtime = (0, fsm_1.initialSonnenRuntime)(now);
    gridBalancePausedByFsm = false;
    ownershipLive = false;
}
exports.__resetBatteryRuntimeForTest = __resetBatteryRuntimeForTest;
async function initBatteryModule(adapter) {
    await (0, mapping_sync_1.ensureAddonMappingStates)(adapter, exports.BATTERY_ADDON_ID, mapping_1.BATTERY_MAPPING_ROLES);
    await (0, mapping_sync_1.syncNativeMappingToStates)(adapter, exports.BATTERY_ADDON_ID, mapping_1.batteryMappingNativeFromConfig);
    await (0, ems_mirror_1.ensureBatteryEmsMirrorStates)(adapter);
    await (0, ensure_states_1.ensureBatteryArchitectureStates)(adapter);
    runtime = (0, fsm_1.initialSonnenRuntime)(Date.now());
    gridBalancePausedByFsm = false;
    ownershipLive = false;
    const host = adapter;
    for (const relId of ems_mirror_1.EMS_MIRROR_BATTERY_IDS) {
        await adapter.subscribeStatesAsync(relId);
    }
    await adapter.subscribeStatesAsync(ensure_states_1.BAT.control.faultReset);
    await detectForeignOwnershipOnStart(host);
    controlTimer = setInterval(() => {
        void runBatteryControlTick(host).catch((e) => adapter.log.error(`battery tick: ${e}`));
    }, CONTROL_INTERVAL_MS);
    void runBatteryControlTick(host).catch((e) => adapter.log.error(`battery tick (startup): ${e}`));
    return null;
}
exports.initBatteryModule = initBatteryModule;
function stopBatteryModule(_timer) {
    if (controlTimer) {
        clearInterval(controlTimer);
        controlTimer = null;
    }
}
exports.stopBatteryModule = stopBatteryModule;
function handleBatteryAdapterStateChange(adapter, stateId) {
    const ns = `${adapter.namespace}.`;
    const rel = stateId.startsWith(ns) ? stateId.slice(ns.length) : stateId;
    if (rel === ensure_states_1.BAT.control.faultReset || ems_mirror_1.EMS_MIRROR_BATTERY_IDS.includes(rel)) {
        void runBatteryControlTick(adapter).catch((e) => adapter.log.error(`battery state change tick: ${e}`));
    }
}
exports.handleBatteryAdapterStateChange = handleBatteryAdapterStateChange;
/** @deprecated use handleBatteryAdapterStateChange */
function handleBatteryForeignStateChange(adapter, stateId) {
    handleBatteryAdapterStateChange(adapter, stateId);
}
exports.handleBatteryForeignStateChange = handleBatteryForeignStateChange;
// ---------------------------------------------------------------------------
async function readForeign(host, id) {
    const t = id.trim();
    if (!t)
        return null;
    try {
        const st = await host.getForeignStateAsync(t);
        if (!st || st.val === undefined || st.val === null)
            return null;
        return { val: st.val, ts: typeof st.ts === "number" ? st.ts : Date.now() };
    }
    catch {
        return null;
    }
}
async function readMappedNumber(host, table, role) {
    const slot = table[role];
    if (!slot || !slot.enabled || !slot.targetState)
        return { val: null, ts: null };
    const r = await readForeign(host, slot.targetState);
    if (!r)
        return { val: null, ts: null };
    const n = Number(r.val);
    return { val: Number.isFinite(n) ? n : null, ts: r.ts };
}
async function readMappedBool(host, table, role) {
    const slot = table[role];
    if (!slot || !slot.enabled || !slot.targetState)
        return null;
    const r = await readForeign(host, slot.targetState);
    if (!r)
        return null;
    return r.val === true || r.val === 1 || r.val === "true";
}
async function readRelNumber(host, id) {
    const st = await host.getStateAsync(id);
    if (st?.val == null)
        return null;
    const n = Number(st.val);
    return Number.isFinite(n) ? n : null;
}
async function readRelBool(host, id) {
    const st = await host.getStateAsync(id);
    return st?.val === true;
}
async function detectForeignOwnershipOnStart(host) {
    const config = (0, config_1.batteryConfigFromAdapter)(host.config);
    if (config.profile !== "sonnen_em")
        return;
    const table = (0, mapping_1.batteryMappingFromConfig)(host.config);
    const mode = await readMappedNumber(host, table, "operating_mode_read");
    if ((0, ownership_1.isForeignManualControl)({
        currentMode: mode.val,
        manualModeValue: config.sonnenModeValues.manual,
        ownership: runtime.ownership,
    })) {
        host.log.warn("battery: device already in manual mode at startup without EMS ownership — live control degraded, awaiting user decision");
        runtime.faultCode = "foreign_manual_control";
        runtime.faultReason = "manual_mode_without_ownership";
        runtime.faultSinceMs = Date.now();
    }
}
function buildReading(host, table, config, profileNormalizeMode, raw) {
    void host;
    void table;
    void config;
    const ts = [raw.soc.ts, raw.power.ts].filter((t) => t !== null);
    return {
        socPct: raw.soc.val,
        powerW: raw.power.val,
        chargingPowerW: raw.charging.val,
        dischargingPowerW: raw.discharging.val,
        capacityNetKwh: raw.capacity.val,
        operatingMode: profileNormalizeMode(raw.mode.val),
        online: raw.online,
        updatedAtMs: ts.length ? Math.max(...ts) : null,
    };
}
async function runBatteryControlTick(host) {
    if (ticking)
        return;
    ticking = true;
    try {
        await controlTickInner(host);
    }
    finally {
        ticking = false;
    }
}
exports.runBatteryControlTick = runBatteryControlTick;
async function controlTickInner(host) {
    const nowMs = Date.now();
    const config = (0, config_1.batteryConfigFromAdapter)(host.config);
    const profile = (0, registry_1.getBatteryProfile)(config.profile);
    const table = (0, mapping_1.batteryMappingFromConfig)(host.config);
    const governanceEnabled = await (0, governance_1.isAddonGovernanceEnabledFromState)((id) => host.getStateAsync(id), exports.BATTERY_ADDON_ID);
    const globalStateRaw = await host.getStateAsync(tree_paths_1.GLOBAL.executionMode);
    const globalLive = (0, execution_mode_1.parseMode)(globalStateRaw?.val) === "live";
    // Fault reset button.
    if (await readRelBool(host, ensure_states_1.BAT.control.faultReset)) {
        runtime = (0, fsm_1.clearBatteryFault)(runtime, nowMs);
        await host.setStateAsync(ensure_states_1.BAT.control.faultReset, { val: false, ack: true });
    }
    // Telemetry.
    const soc = await readMappedNumber(host, table, "soc_pct");
    const power = await readMappedNumber(host, table, "power_w");
    const charging = await readMappedNumber(host, table, "charging_power_w");
    const discharging = await readMappedNumber(host, table, "discharging_power_w");
    const capacityMapped = await readMappedNumber(host, table, "capacity_kwh");
    const modeRead = await readMappedNumber(host, table, "operating_mode_read");
    const online = await readMappedBool(host, table, "online");
    const reading = buildReading(host, table, config, (raw) => profile.normalizeOperatingMode(raw, { config, mapping: table, limits: config.limits }), { soc, power, charging, discharging, capacity: capacityMapped, mode: modeRead, online });
    const snapshot = (0, diagnostics_1.assembleBatterySnapshot)({
        config,
        mapping: table,
        profile,
        reading,
        mappedCapacityKwh: capacityMapped.val,
        nowMs,
        globalLive,
        governanceEnabled,
        requiredValues: ["soc", "power"],
    });
    // EMS-mirror device intent.
    const intentActive = await readRelBool(host, ems_mirror_1.EMS_MIRROR_BATTERY.batteryIntentActive);
    const modeTarget = await readRelNumber(host, ems_mirror_1.EMS_MIRROR_BATTERY.operatingModeTarget);
    const chargeReq = await readRelNumber(host, ems_mirror_1.EMS_MIRROR_BATTERY.chargePowerWRequest);
    const wantsCharge = intentActive && modeTarget === 1 && (chargeReq ?? 0) > 0;
    const action = wantsCharge ? "charge" : "self_consumption";
    const requestId = `bat-${(await readRelNumber(host, ems_mirror_1.EMS_MIRROR_BATTERY.modeRequestId)) ?? 0}`;
    const deviceIntent = {
        requestId,
        action,
        targetSocPct: null,
        maxChargeW: chargeReq,
        maxDischargeW: null,
        energySource: "any",
        validFrom: null,
        validUntil: null,
        issuedAt: new Date(nowMs).toISOString(),
        reason: `mirror intent_active=${intentActive} mode=${modeTarget}`,
        source: "ems_mirror",
    };
    const telemetryFresh = !snapshot.telemetry.stale && snapshot.quality.socValid && snapshot.quality.powerValid;
    const validation = (0, validation_1.validateBatteryIntent)({
        intent: deviceIntent,
        limits: snapshot.limits,
        capabilities: snapshot.capabilities,
        governanceEnabled,
        telemetrySocValid: snapshot.quality.socValid,
        telemetryFreshForAction: telemetryFresh,
        fault: runtime.faultCode !== null,
        lockout: runtime.lockout,
    });
    const intentValid = validation.accepted && wantsCharge && profile.supportsLive;
    const effectiveChargeW = validation.effectiveChargeW ?? 0;
    // Grid balance controller.
    const adapterFeature = snapshot.capabilities.control_grid_balance.available;
    const emsGb = await readRelBool(host, ems_mirror_1.EMS_MIRROR_BATTERY.gridBalanceEnabled);
    const controller = (0, grid_balance_1.resolveController)({
        emsBatteryIntentActive: intentActive,
        emsGridBalanceEnabled: emsGb,
        adapterFeatureEnabled: adapterFeature,
        batteryAddonEnabled: governanceEnabled,
        gridBalancePaused: gridBalancePausedByFsm || runtime.ownership.active,
    });
    const safetyOverride = ownershipLive && !globalLive;
    const effectiveLive = globalLive || safetyOverride;
    const targetSocReached = deviceIntent.targetSocPct != null &&
        snapshot.telemetry.socPct != null &&
        snapshot.telemetry.socPct >= deviceIntent.targetSocPct;
    const stopReason = (0, safety_1.evaluateStopCondition)({
        targetSocReached,
        intentExpired: false,
        intentRevoked: runtime.ownership.active && !wantsCharge,
        addonDisabled: !governanceEnabled,
        globalLeftLive: ownershipLive && !globalLive,
        safetyBlocked: false,
        telemetryStale: runtime.ownership.active && snapshot.telemetry.stale,
        communicationLost: runtime.ownership.active && online === false,
        fault: false,
        unloading: false,
        higherPriorityIntent: false,
    });
    const ctx = {
        nowMs,
        intentValid,
        chargingActionRequested: wantsCharge,
        action: deviceIntent.action,
        requestId,
        effectiveChargeW,
        targetSocPct: deviceIntent.targetSocPct,
        stopReason,
        actualMode: modeRead.val,
        actualChargingW: snapshot.telemetry.chargingPowerW,
        socPct: snapshot.telemetry.socPct,
        modeValues: config.sonnenModeValues,
        sequence: config.sequence,
        tolerance: config.feedbackTolerance,
        gridBalanceActive: controller === "grid_balance",
        simulateFeedback: !effectiveLive,
    };
    const step = profile.supportsLive ? (0, fsm_1.stepSonnenFsm)(runtime, ctx) : { runtime, writes: [], gridBalance: null, log: null, transitioned: false };
    runtime = step.runtime;
    if (step.gridBalance === "pause")
        gridBalancePausedByFsm = true;
    if (step.gridBalance === "restore")
        gridBalancePausedByFsm = false;
    if (step.log)
        host.log[step.log.level](step.log.msg);
    // Apply FSM writes through the single central write function.
    const gate = {
        globalLive: effectiveLive,
        governanceEnabled,
        profileId: config.profile,
        profileLiveControlAvailable: snapshot.capabilities.live_control.available,
        profileReady: snapshot.readiness.liveReady,
        intentValid: intentValid || safetyOverride,
        telemetryReady: snapshot.readiness.telemetryReady,
        fault: false,
        lockout: false,
        targetMappingConfigured: true,
        ownershipValid: true,
    };
    let lastWrite = null;
    for (const w of step.writes) {
        const stateId = w.kind === "operating_mode" ? table.set_operating_mode.targetState : table.set_charge_power.targetState;
        const result = await (0, execute_1.executeBatteryWrite)(host, {
            kind: w.kind,
            stateId,
            value: w.value,
            requestId,
            reason: `fsm:${runtime.state}`,
            expectedFeedback: w.expectedFeedback,
            dryrun: !effectiveLive,
            gate: { ...gate, targetMappingConfigured: stateId.length > 0 },
        });
        lastWrite = { state: stateId, value: w.value, success: result.executed, expected: result.expectedFeedback };
        if (result.executed && w.kind === "operating_mode" && w.value === config.sonnenModeValues.manual) {
            ownershipLive = true;
        }
    }
    if (!runtime.ownership.active) {
        ownershipLive = false;
    }
    // Grid balance write path (only when EMS-FSM not owning the battery).
    let gbWouldWrite = false;
    let gbTarget = 0;
    let gbState = "";
    if (controller === "grid_balance" && !runtime.ownership.active && !gridBalancePausedByFsm) {
        const consumption = (await readMappedNumber(host, table, "consumption_w")).val ?? 0;
        const pv = (await readMappedNumber(host, table, "pv_ac_power_w")).val ?? 0;
        const capacityWh = (snapshot.capacity.effectiveKwh ?? 0) * 1000;
        const restKwh = (await readRelNumber(host, ems_mirror_1.EMS_MIRROR_BATTERY.effectivePvRestOfDayKwh)) ?? 0;
        const snow = await readRelBool(host, ems_mirror_1.EMS_MIRROR_BATTERY.snowCoverSuspected);
        const result = (0, grid_balance_1.computeGridBalanceTarget)({
            effectiveRestOfDayKwh: restKwh,
            capacityWh,
            snowCoverSuspected: snow,
            consumptionW: consumption,
            pvAcPowerW: pv,
            socPct: snapshot.telemetry.socPct,
            emsGridBalanceEnabled: emsGb,
            adapterFeatureEnabled: adapterFeature,
            controller,
            offsetHighSocW: config.gridBalance.offsetHighSocW,
            offsetLowSocW: config.gridBalance.offsetLowSocW,
            socThresholdPct: config.gridBalance.socThresholdPct,
        });
        if (result.gatePassed) {
            gbTarget = Math.min(config.gridBalance.maxTargetW, result.targetBatteryChargingW);
            gbState = table.set_charge_power.targetState;
            gbWouldWrite = gbState.length > 0;
            await (0, execute_1.executeBatteryWrite)(host, {
                kind: "charge_power",
                stateId: gbState,
                value: gbTarget,
                requestId: "grid_balance",
                reason: "grid_balance",
                expectedFeedback: gbTarget,
                dryrun: !globalLive,
                gate: { ...gate, targetMappingConfigured: gbWouldWrite },
            });
        }
    }
    await persist(host, snapshot, {
        nowMs,
        globalLive,
        controller,
        lastWrite,
        gb: { wouldWrite: gbWouldWrite, target: gbTarget, state: gbState },
        clamps: validation.clamps,
        requestedPowerW: chargeReq ?? 0,
        effectiveChargeW,
        action,
        actualMode: modeRead.val,
        actualChargingW: snapshot.telemetry.chargingPowerW,
    });
}
async function persist(host, s, x) {
    const iso = new Date(x.nowMs).toISOString();
    const set = (id, val) => host.setStateAsync(id, { val, ack: true });
    await set(ensure_states_1.BAT.identity.manufacturer, s.identity.manufacturer);
    await set(ensure_states_1.BAT.identity.model, s.identity.model);
    await set(ensure_states_1.BAT.identity.controllerProfile, s.identity.controllerProfile);
    await set(ensure_states_1.BAT.identity.capacityNetKwh, s.identity.capacityNetKwh);
    await set(ensure_states_1.BAT.identity.capacitySource, s.identity.capacitySource);
    await set(ensure_states_1.BAT.telemetry.socPct, s.telemetry.socPct);
    await set(ensure_states_1.BAT.telemetry.powerW, s.telemetry.powerW);
    await set(ensure_states_1.BAT.telemetry.chargingPowerW, s.telemetry.chargingPowerW);
    await set(ensure_states_1.BAT.telemetry.dischargingPowerW, s.telemetry.dischargingPowerW);
    await set(ensure_states_1.BAT.telemetry.capacityEffectiveKwh, s.capacity.effectiveKwh);
    await set(ensure_states_1.BAT.telemetry.operatingMode, s.telemetry.operatingMode);
    await set(ensure_states_1.BAT.telemetry.online, s.telemetry.online);
    await set(ensure_states_1.BAT.telemetry.valid, s.telemetry.valid);
    await set(ensure_states_1.BAT.telemetry.stale, s.telemetry.stale);
    if (s.telemetry.updatedAt)
        await set(ensure_states_1.BAT.telemetry.lastUpdate, s.telemetry.updatedAt);
    await set(ensure_states_1.BAT.status.profile, s.profileId);
    await set(ensure_states_1.BAT.status.profileLoaded, true);
    await set(ensure_states_1.BAT.status.telemetryReady, s.readiness.telemetryReady);
    await set(ensure_states_1.BAT.status.controlReady, s.readiness.controlReady);
    await set(ensure_states_1.BAT.status.dryrunReady, s.readiness.dryrunReady);
    await set(ensure_states_1.BAT.status.liveReady, s.readiness.liveReady);
    await set(ensure_states_1.BAT.status.effectiveExecutionMode, s.effectiveExecutionMode);
    await set(ensure_states_1.BAT.status.state, runtime.state);
    await set(ensure_states_1.BAT.status.reason, s.readiness.reason);
    await set(ensure_states_1.BAT.status.fault, runtime.faultCode !== null);
    await set(ensure_states_1.BAT.status.lockout, runtime.lockout);
    await set(ensure_states_1.BAT.capabilities.readSoc, s.capabilities.read_soc.available);
    await set(ensure_states_1.BAT.capabilities.readPower, s.capabilities.read_power.available);
    await set(ensure_states_1.BAT.capabilities.setOperatingMode, s.capabilities.set_operating_mode.available);
    await set(ensure_states_1.BAT.capabilities.setChargePower, s.capabilities.set_charge_power.available);
    await set(ensure_states_1.BAT.capabilities.setDischargePower, s.capabilities.set_discharge_power.available);
    await set(ensure_states_1.BAT.capabilities.controlGridBalance, s.capabilities.control_grid_balance.available);
    await set(ensure_states_1.BAT.capabilities.safeRestore, s.capabilities.safe_restore.available);
    await set(ensure_states_1.BAT.capabilities.liveControl, s.capabilities.live_control.available);
    await set(ensure_states_1.BAT.limits.hardwareMaxChargeW, s.limits.maxChargeW);
    await set(ensure_states_1.BAT.limits.hardwareMaxDischargeW, s.limits.maxDischargeW);
    await set(ensure_states_1.BAT.limits.hardwareMinSocPct, s.limits.minSocPct);
    await set(ensure_states_1.BAT.limits.hardwareMaxSocPct, s.limits.maxSocPct);
    await set(ensure_states_1.BAT.limits.effectiveMaxChargeW, x.effectiveChargeW);
    await set(ensure_states_1.BAT.limits.effectiveMaxDischargeW, 0);
    await set(ensure_states_1.BAT.limits.effectiveReason, x.clamps.map((c) => `${c.field}:${c.reason}`).join(",") || "ok");
    await set(ensure_states_1.BAT.runtime.requestId, runtime.requestId ?? "");
    await set(ensure_states_1.BAT.runtime.action, runtime.action ?? "");
    await set(ensure_states_1.BAT.runtime.state, runtime.state);
    await set(ensure_states_1.BAT.runtime.step, runtime.state);
    await set(ensure_states_1.BAT.runtime.requestedPowerW, x.requestedPowerW);
    await set(ensure_states_1.BAT.runtime.effectivePowerW, runtime.effectivePowerW);
    await set(ensure_states_1.BAT.runtime.targetSocPct, runtime.targetSocPct);
    await set(ensure_states_1.BAT.runtime.startedAt, runtime.ownership.startedAt ?? "");
    await set(ensure_states_1.BAT.runtime.lastTransitionAt, iso);
    await set(ensure_states_1.BAT.runtime.reason, runtime.faultReason ?? s.readiness.reason);
    await set(ensure_states_1.BAT.runtime.ownershipActive, runtime.ownership.active);
    const wouldWrite = !x.globalLive && ((0, intent_1.isChargingAction)(x.action) || x.gb.wouldWrite);
    await set(ensure_states_1.BAT.dryrun.wouldWrite, wouldWrite);
    await set(ensure_states_1.BAT.dryrun.wouldWriteState, x.gb.state || x.lastWrite?.state || "");
    await set(ensure_states_1.BAT.dryrun.wouldWriteValue, x.gb.wouldWrite ? x.gb.target : x.lastWrite?.value ?? null);
    await set(ensure_states_1.BAT.dryrun.sequenceStep, runtime.state);
    await set(ensure_states_1.BAT.dryrun.requestedAction, x.action);
    await set(ensure_states_1.BAT.dryrun.requestedPowerW, x.requestedPowerW);
    await set(ensure_states_1.BAT.dryrun.effectivePowerW, x.effectiveChargeW);
    await set(ensure_states_1.BAT.dryrun.wouldRestore, !x.globalLive && runtime.ownership.active);
    await set(ensure_states_1.BAT.dryrun.reason, `controller=${x.controller}`);
    await set(ensure_states_1.BAT.dryrun.updatedAt, iso);
    await set(ensure_states_1.BAT.diagnostics.missingMappings, s.missingMappings.join(",") || "");
    if (x.lastWrite) {
        await set(ensure_states_1.BAT.diagnostics.lastWriteState, x.lastWrite.state);
        await set(ensure_states_1.BAT.diagnostics.lastWriteValue, x.lastWrite.value);
        await set(ensure_states_1.BAT.diagnostics.lastWriteAt, iso);
        await set(ensure_states_1.BAT.diagnostics.lastWriteSuccess, x.lastWrite.success);
        await set(ensure_states_1.BAT.diagnostics.expectedFeedback, x.lastWrite.expected);
    }
    await set(ensure_states_1.BAT.diagnostics.actualFeedback, x.actualChargingW);
    await set(ensure_states_1.BAT.diagnostics.lastFeedbackAt, iso);
    await set(ensure_states_1.BAT.diagnostics.faultCode, runtime.faultCode ?? "");
    await set(ensure_states_1.BAT.diagnostics.faultReason, runtime.faultReason ?? "");
}
/** Adapter-Unload: best-effort Safe Restore nur bei aktiver Live-Ownership. */
async function batteryUnloadRestore(host) {
    if (!runtime.ownership.active || !ownershipLive) {
        return;
    }
    const config = (0, config_1.batteryConfigFromAdapter)(host.config);
    const table = (0, mapping_1.batteryMappingFromConfig)(host.config);
    const gate = {
        globalLive: true,
        governanceEnabled: true,
        profileId: config.profile,
        profileLiveControlAvailable: true,
        profileReady: true,
        intentValid: true,
        telemetryReady: true,
        fault: false,
        lockout: false,
        targetMappingConfigured: true,
        ownershipValid: true,
    };
    try {
        await (0, execute_1.executeBatteryWrite)(host, {
            kind: "charge_power",
            stateId: table.set_charge_power.targetState,
            value: 0,
            requestId: "unload",
            reason: "unload_stop",
            dryrun: false,
            gate,
        });
        await (0, execute_1.executeBatteryWrite)(host, {
            kind: "operating_mode",
            stateId: table.set_operating_mode.targetState,
            value: config.sonnenModeValues.selfConsumption,
            requestId: "unload",
            reason: "unload_restore",
            dryrun: false,
            gate,
        });
    }
    catch (e) {
        host.log.warn(`battery unload restore best-effort failed: ${String(e)}`);
    }
}
exports.batteryUnloadRestore = batteryUnloadRestore;
