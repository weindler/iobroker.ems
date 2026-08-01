"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.batteryUnloadRestore = exports.runBatteryControlTick = exports.handleBatteryForeignStateChange = exports.handleBatteryGridBalanceForeignStateChange = exports.handleBatteryAdapterStateChange = exports.stopBatteryModule = exports.initBatteryModule = exports.startBatteryModuleRuntime = exports.ensureBatteryStateTree = exports.__resetBatteryRuntimeForTest = exports.BATTERY_ADDON_ID = void 0;
const governance_1 = require("../governance");
const runtime_surface_1 = require("../runtime_surface");
const ems_activity_1 = require("../../ems_activity");
const execution_mode_1 = require("../../execution_mode");
const mapping_sync_1 = require("../../mapping_sync");
const config_1 = require("./config");
const intent_1 = require("./core/intent");
const validation_1 = require("./core/validation");
const diagnostics_1 = require("./diagnostics");
const ensure_states_1 = require("./ensure_states");
const ems_mirror_1 = require("./ems_mirror");
const grid_balance_1 = require("./grid_balance");
const battery_winter_price_inputs_1 = require("../../planner/battery_winter_price_inputs");
const mapping_1 = require("./mapping");
const registry_1 = require("./profiles/registry");
const fsm_1 = require("./runtime/fsm");
const execute_1 = require("./runtime/execute");
const ownership_1 = require("./runtime/ownership");
const safety_1 = require("./runtime/safety");
const intent_read_1 = require("./runtime/intent_read");
const grid_balance_watch_1 = require("./runtime/grid_balance_watch");
const states_1 = require("../../operator/daily_plan/states");
const daily_plan_1 = require("./runtime/daily_plan");
const state_write_1 = require("../../policy/core/state_write");
exports.BATTERY_ADDON_ID = "battery";
function batteryControlIntervalMs(config) {
    const sec = config.gridBalance.updateIntervalSec;
    return Math.min(15_000, Math.max(3000, sec * 1000));
}
let controlTimer = null;
let runtime = (0, fsm_1.initialSonnenRuntime)(Date.now());
let gridBalancePausedByFsm = false;
let ownershipLive = false;
let prevLiveWriteAllowed = false;
let ticking = false;
let lastGridBalanceWriteW = null;
const DAILY_PLAN_TRIGGER_IDS = new Set([
    states_1.DAILY_PLAN_STATE_IDS.revision,
    states_1.DAILY_PLAN_STATE_IDS.status,
    states_1.ALLOCATION_ADDON_STATE_IDS.battery.planJson,
]);
/** Nur für Tests: internen Laufzeitzustand zurücksetzen. */
function __resetBatteryRuntimeForTest(now = Date.now()) {
    runtime = (0, fsm_1.initialSonnenRuntime)(now);
    gridBalancePausedByFsm = false;
    ownershipLive = false;
    prevLiveWriteAllowed = false;
    lastGridBalanceWriteW = null;
    (0, daily_plan_1.resetBatteryDailyPlanCache)();
}
exports.__resetBatteryRuntimeForTest = __resetBatteryRuntimeForTest;
async function ensureBatteryStateTree(adapter) {
    await (0, mapping_sync_1.ensureAddonMappingStates)(adapter, exports.BATTERY_ADDON_ID, (0, mapping_1.batteryMappingCommandsForEnsure)(adapter.config));
    await (0, ems_mirror_1.ensureBatteryEmsMirrorStates)(adapter);
    await (0, ensure_states_1.ensureBatteryArchitectureStates)(adapter);
}
exports.ensureBatteryStateTree = ensureBatteryStateTree;
async function startBatteryModuleRuntime(adapter) {
    await (0, mapping_sync_1.syncNativeMappingToStates)(adapter, exports.BATTERY_ADDON_ID, mapping_1.batteryMappingNativeFromConfig);
    runtime = (0, fsm_1.initialSonnenRuntime)(Date.now());
    gridBalancePausedByFsm = false;
    ownershipLive = false;
    prevLiveWriteAllowed = false;
    const host = adapter;
    for (const relId of ems_mirror_1.EMS_MIRROR_BATTERY_IDS) {
        await adapter.subscribeStatesAsync(relId);
    }
    await adapter.subscribeStatesAsync(ensure_states_1.BAT.control.faultReset);
    for (const id of DAILY_PLAN_TRIGGER_IDS) {
        await adapter.subscribeStatesAsync(id);
    }
    await detectForeignOwnershipOnStart(host);
    const config = (0, config_1.batteryConfigFromAdapter)(host.config);
    const table = (0, mapping_1.batteryMappingFromConfig)(host.config);
    if (config.gridBalance.enabled) {
        await (0, grid_balance_watch_1.setupGridBalanceWatch)(adapter, table);
    }
    const intervalMs = batteryControlIntervalMs(config);
    controlTimer = setInterval(() => {
        void runBatteryControlTick(host).catch((e) => adapter.log.error(`battery tick: ${e}`));
    }, intervalMs);
    void runBatteryControlTick(host).catch((e) => adapter.log.error(`battery tick (startup): ${e}`));
    return null;
}
exports.startBatteryModuleRuntime = startBatteryModuleRuntime;
async function initBatteryModule(adapter) {
    await ensureBatteryStateTree(adapter);
    return startBatteryModuleRuntime(adapter);
}
exports.initBatteryModule = initBatteryModule;
function stopBatteryModule(_timer) {
    if (controlTimer) {
        clearInterval(controlTimer);
        controlTimer = null;
    }
    (0, grid_balance_watch_1.clearGridBalanceWatch)();
    lastGridBalanceWriteW = null;
    (0, daily_plan_1.resetBatteryDailyPlanCache)();
}
exports.stopBatteryModule = stopBatteryModule;
function handleBatteryAdapterStateChange(adapter, stateId) {
    const ns = `${adapter.namespace}.`;
    const rel = stateId.startsWith(ns) ? stateId.slice(ns.length) : stateId;
    if (rel === ensure_states_1.BAT.control.faultReset ||
        (0, execution_mode_1.isExecutionModeStateRelativeId)(rel) ||
        ems_mirror_1.EMS_MIRROR_BATTERY_IDS.includes(rel) ||
        DAILY_PLAN_TRIGGER_IDS.has(rel)) {
        void runBatteryControlTick(adapter).catch((e) => adapter.log.error(`battery state change tick: ${e}`));
    }
}
exports.handleBatteryAdapterStateChange = handleBatteryAdapterStateChange;
/** Reagiert auf Änderungen an gemapptem consumption_w / pv_ac_power_w (Netzausgleich on-change). */
function handleBatteryGridBalanceForeignStateChange(adapter, stateId) {
    if (!(0, grid_balance_watch_1.isGridBalanceWatchState)(stateId)) {
        return;
    }
    (0, grid_balance_watch_1.scheduleGridBalanceTick)(adapter, runBatteryControlTick);
}
exports.handleBatteryGridBalanceForeignStateChange = handleBatteryGridBalanceForeignStateChange;
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
    (0, ems_activity_1.touchEmsActivity)();
    const nowMs = Date.now();
    const config = (0, config_1.batteryConfigFromAdapter)(host.config);
    const profile = (0, registry_1.getBatteryProfile)(config.profile);
    const table = (0, mapping_1.batteryMappingFromConfig)(host.config);
    const governanceEnabled = await (0, governance_1.isAddonGovernanceEnabledFromState)((id) => host.getStateAsync(id), exports.BATTERY_ADDON_ID);
    const liveWriteAllowed = await (0, execution_mode_1.isLiveWriteAllowed)((id) => host.getStateAsync(id), exports.BATTERY_ADDON_ID);
    if (liveWriteAllowed &&
        !prevLiveWriteAllowed &&
        !ownershipLive &&
        (0, fsm_1.isBatterySimulatedProgressState)(runtime.state)) {
        host.log.info("battery: live write enabled — restarting charge sequence (prior dryrun progress discarded)");
        runtime = (0, fsm_1.initialSonnenRuntime)(nowMs);
        gridBalancePausedByFsm = false;
    }
    prevLiveWriteAllowed = liveWriteAllowed;
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
        globalLive: liveWriteAllowed,
        governanceEnabled,
        requiredValues: ["soc", "power"],
    });
    // Device intent: manual user intent → daily plan → EMS mirror / safe default (Block 5: no winter/legacy planner).
    const resolvedRaw = await host.getStateAsync("user_intent.battery.resolved_json");
    const resolvedIntent = (0, intent_read_1.parseResolvedBatteryIntentJson)(resolvedRaw?.val);
    const fromManual = resolvedIntent && (0, intent_read_1.resolvedIntentHasManualPriority)(resolvedIntent)
        ? (0, intent_read_1.deviceIntentFromResolvedBattery)(resolvedIntent)
        : null;
    const topOffActive = resolvedIntent?.top_off_requested.status === "valid" && resolvedIntent.top_off_requested.value === true;
    const targetSocFromIntent = resolvedIntent?.target_soc_pct.status === "valid" ? resolvedIntent.target_soc_pct.value : null;
    const dailyPlanContext = await (0, daily_plan_1.resolveBatteryDailyPlanAllocation)(host, profile, snapshot.limits, {
        now: new Date(nowMs),
        socPct: snapshot.telemetry.socPct,
        topOffActive,
        targetSocFromIntent,
        governanceEnabled,
    });
    let deviceIntent;
    let wantsCharge;
    let requestId;
    let runtimeDecisionSource = dailyPlanContext.decisionSource;
    if (fromManual?.intent) {
        deviceIntent = fromManual.intent;
        wantsCharge = fromManual.wantsCharge;
        requestId = deviceIntent.requestId;
        runtimeDecisionSource = "manual_user_intent";
        if (wantsCharge && (deviceIntent.maxChargeW ?? 0) <= 0) {
            const mirrorW = await readRelNumber(host, ems_mirror_1.EMS_MIRROR_BATTERY.chargePowerWRequest);
            if (mirrorW != null && mirrorW > 0) {
                deviceIntent = { ...deviceIntent, maxChargeW: mirrorW };
            }
        }
    }
    else if (dailyPlanContext.useDailyPlan) {
        deviceIntent = (0, daily_plan_1.deviceIntentFromDailyPlan)(dailyPlanContext, nowMs);
        wantsCharge = dailyPlanContext.chargingAllowed && (dailyPlanContext.effectiveChargePowerW ?? 0) > 0;
        requestId = deviceIntent.requestId;
        runtimeDecisionSource = dailyPlanContext.decisionSource;
    }
    else if (runtime.ownership.active && runtime.requestId?.startsWith("winter-planner")) {
        // Cleanup ownership from pre-Block-5 installs that still hold a winter-planner request.
        requestId = runtime.requestId ?? `winter-planner-${nowMs}`;
        wantsCharge = false;
        runtimeDecisionSource = "restore";
        deviceIntent = {
            requestId,
            action: "self_consumption",
            targetSocPct: null,
            maxChargeW: null,
            maxDischargeW: null,
            energySource: "any",
            validFrom: null,
            validUntil: null,
            issuedAt: new Date(nowMs).toISOString(),
            reason: "Legacy Winter-Ownership beendet — Rückkehr Mode 2",
            source: "winter_planner",
        };
    }
    else {
        const intentActive = await readRelBool(host, ems_mirror_1.EMS_MIRROR_BATTERY.batteryIntentActive);
        const modeTarget = await readRelNumber(host, ems_mirror_1.EMS_MIRROR_BATTERY.operatingModeTarget);
        const chargeReq = await readRelNumber(host, ems_mirror_1.EMS_MIRROR_BATTERY.chargePowerWRequest);
        wantsCharge = intentActive && modeTarget === 1 && (chargeReq ?? 0) > 0;
        requestId = `bat-${(await readRelNumber(host, ems_mirror_1.EMS_MIRROR_BATTERY.modeRequestId)) ?? 0}`;
        deviceIntent = {
            requestId,
            action: wantsCharge ? "charge" : "self_consumption",
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
        runtimeDecisionSource = wantsCharge ? "legacy_planner_fallback" : "safe_default";
        dailyPlanContext.legacyFallbackActive = !dailyPlanContext.useDailyPlan;
        dailyPlanContext.legacyFallbackSource = wantsCharge ? "ems_mirror" : "safe_default";
        dailyPlanContext.legacyFallbackReasonDe = dailyPlanContext.allocationReasonDe;
    }
    if (runtime.faultCode !== null)
        runtimeDecisionSource = "fault";
    if (runtime.lockout)
        runtimeDecisionSource = "lockout";
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
    const emsMirrorIntentActive = await readRelBool(host, ems_mirror_1.EMS_MIRROR_BATTERY.batteryIntentActive);
    const dailyPlanDriven = deviceIntent.source === "daily_plan";
    const dailyPlanAuthoritative = (0, daily_plan_1.isBatteryDailyPlanAuthoritative)(dailyPlanContext);
    const [batteryHoldActive, wallboxBatteryHold, priceNowCt] = await Promise.all([
        readRelBool(host, "planner.constraints.battery_hold_active"),
        readRelBool(host, "addons.wallbox.runtime.battery_hold_for_ev_charge"),
        readRelNumber(host, "live.price.now_ct_per_kwh"),
    ]);
    /** Nur Boost/externes Laden — nicht jedes EVCC-Laden (MinPV/PV). */
    const evccCharging = wallboxBatteryHold;
    const gridBalanceSuppressed = batteryHoldActive || evccCharging || runtime.ownership.active || dailyPlanAuthoritative;
    const emsBatteryIntentActive = Boolean(fromManual
        ? wantsCharge
        : dailyPlanDriven
            ? wantsCharge || (runtime.ownership.active && runtime.requestId?.startsWith("daily-plan"))
            : deviceIntent.source === "winter_planner"
                ? wantsCharge || runtime.ownership.active
                : emsMirrorIntentActive && wantsCharge);
    // Grid balance controller.
    const adapterFeature = snapshot.capabilities.control_grid_balance.available;
    const emsGb = await readRelBool(host, ems_mirror_1.EMS_MIRROR_BATTERY.gridBalanceEnabled);
    const controller = (0, grid_balance_1.resolveController)({
        emsBatteryIntentActive,
        emsGridBalanceEnabled: emsGb,
        adapterFeatureEnabled: adapterFeature,
        batteryAddonEnabled: governanceEnabled,
        gridBalancePaused: gridBalancePausedByFsm || runtime.ownership.active,
        gridBalanceSuppressed,
    });
    const safetyOverride = ownershipLive && !liveWriteAllowed;
    const effectiveLive = liveWriteAllowed || safetyOverride;
    const targetSocReached = deviceIntent.targetSocPct != null &&
        snapshot.telemetry.socPct != null &&
        snapshot.telemetry.socPct >= deviceIntent.targetSocPct;
    // Hardware-Sicherheitsdecke unabhängig vom Intent-Ziel: nie über den konfigurierten
    // HW-Max-SOC hinaus laden, auch wenn der Intent kein (oder ein höheres) Ziel setzt.
    const safetyBlocked = runtime.ownership.active &&
        snapshot.limits.maxSocPct != null &&
        snapshot.telemetry.socPct != null &&
        snapshot.telemetry.socPct >= snapshot.limits.maxSocPct;
    const stopReason = (0, safety_1.evaluateStopCondition)({
        targetSocReached,
        intentExpired: deviceIntent.validUntil != null && Date.parse(deviceIntent.validUntil) <= nowMs,
        intentRevoked: runtime.ownership.active && !wantsCharge,
        addonDisabled: !governanceEnabled,
        globalLeftLive: ownershipLive && !liveWriteAllowed,
        safetyBlocked,
        telemetryStale: runtime.ownership.active && snapshot.telemetry.stale,
        communicationLost: runtime.ownership.active && online === false,
        fault: runtime.faultCode !== null,
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
    // Sicherheits-/Restore-Writes (stop_charge…restore_grid_balance) müssen auch bei
    // aktivem Fault/Lockout durchkommen — sonst bleibt die Batterie im unsicheren
    // Zustand hängen, weil genau diese Writes den Fault erst kontrolliert beenden.
    const safetyWrite = (0, fsm_1.isBatterySafetyWriteState)(runtime.state) && runtime.ownership.active;
    const foreignOwnershipConflict = (0, ownership_1.isForeignManualControl)({
        currentMode: modeRead.val,
        manualModeValue: config.sonnenModeValues.manual,
        ownership: runtime.ownership,
    });
    const gate = {
        globalLive: effectiveLive,
        governanceEnabled,
        profileId: config.profile,
        profileLiveControlAvailable: snapshot.capabilities.live_control.available,
        profileReady: snapshot.readiness.liveReady,
        intentValid: intentValid || safetyOverride || safetyWrite,
        telemetryReady: snapshot.readiness.telemetryReady,
        fault: runtime.faultCode !== null && !safetyWrite,
        lockout: runtime.lockout && !safetyWrite,
        targetMappingConfigured: true,
        ownershipValid: !foreignOwnershipConflict,
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
            numericTolerance: w.kind === "charge_power" ? config.feedbackTolerance.absoluteW : 0,
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
        const priceSlots = config.gridBalance.priceGateEnabled && config.gridBalance.priceMedianFactor > 0
            ? await (0, battery_winter_price_inputs_1.readTibber15MinPriceSlots)({ ...host, config: host.config, getForeignStateAsync: (id) => host.getForeignStateAsync(id) }, new Date(nowMs))
            : [];
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
            evccCharging,
            batteryHoldActive,
            winterGridPlanActive: false,
            mode1Active: runtime.ownership.active,
            dailyPlanAuthoritative,
            priceNowCt,
            priceMedianCt: (0, grid_balance_1.medianCtFromPriceSlots)(priceSlots),
            priceGate: {
                enabled: config.gridBalance.priceGateEnabled,
                maxPriceCtPerKwh: config.gridBalance.maxPriceCtPerKwh,
                medianFactor: config.gridBalance.priceMedianFactor,
            },
        });
        if (result.gatePassed) {
            gbTarget = Math.min(config.gridBalance.maxTargetW, result.targetBatteryChargingW);
            gbState = table.set_charge_power.targetState;
            const minChange = config.gridBalance.minChangeW;
            const delta = lastGridBalanceWriteW === null ? Number.POSITIVE_INFINITY : Math.abs(gbTarget - lastGridBalanceWriteW);
            const shouldWrite = gbState.length > 0 && delta >= minChange;
            gbWouldWrite = shouldWrite;
            if (shouldWrite) {
                await (0, execute_1.executeBatteryWrite)(host, {
                    kind: "charge_power",
                    stateId: gbState,
                    value: gbTarget,
                    requestId: "grid_balance",
                    reason: "grid_balance",
                    expectedFeedback: gbTarget,
                    dryrun: !liveWriteAllowed,
                    gate: { ...gate, targetMappingConfigured: true },
                });
                lastGridBalanceWriteW = gbTarget;
            }
        }
        else {
            lastGridBalanceWriteW = null;
        }
    }
    await persist(host, snapshot, {
        nowMs,
        globalLive: liveWriteAllowed,
        governanceEnabled,
        controller,
        lastWrite,
        gb: { wouldWrite: gbWouldWrite, target: gbTarget, state: gbState },
        clamps: validation.clamps,
        requestedPowerW: deviceIntent.maxChargeW ?? 0,
        effectiveChargeW,
        action: deviceIntent.action,
        actualMode: modeRead.val,
        actualChargingW: snapshot.telemetry.chargingPowerW,
        dailyPlan: dailyPlanContext,
        decisionSource: runtimeDecisionSource,
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
    const dp = x.dailyPlan;
    await (0, state_write_1.setStateIfChanged)(host, ensure_states_1.BAT.runtime.decisionSource, x.decisionSource);
    await (0, state_write_1.setStateIfChanged)(host, ensure_states_1.BAT.runtime.reasonDe, dp.allocationReasonDe || "");
    await (0, state_write_1.setStateIfChanged)(host, ensure_states_1.BAT.runtime.dailyPlanStatus, dp.dailyPlanStatus);
    await (0, state_write_1.setStateIfChanged)(host, ensure_states_1.BAT.runtime.dailyPlanAuthoritative, dp.dailyPlanAuthoritative);
    await (0, state_write_1.setStateIfChanged)(host, ensure_states_1.BAT.runtime.dailyPlanValid, dp.useDailyPlan);
    await (0, state_write_1.setStateIfChanged)(host, ensure_states_1.BAT.runtime.dailyPlanRevision, dp.dailyPlanRevision ?? 0);
    await (0, state_write_1.setStateIfChanged)(host, ensure_states_1.BAT.runtime.dailyPlanSlotStart, dp.slotStartIso ?? "");
    await (0, state_write_1.setStateIfChanged)(host, ensure_states_1.BAT.runtime.dailyPlanSlotEnd, dp.slotEndIso ?? "");
    await (0, state_write_1.setStateIfChanged)(host, ensure_states_1.BAT.runtime.allocationStatus, dp.allocationStatus);
    await (0, state_write_1.setStateIfChanged)(host, ensure_states_1.BAT.runtime.allocatedChargePowerW, dp.allocatedChargePowerW ?? null);
    await (0, state_write_1.setStateIfChanged)(host, ensure_states_1.BAT.runtime.allocatedEnergyKwh, dp.allocatedEnergyKwh ?? null);
    await (0, state_write_1.setStateIfChanged)(host, ensure_states_1.BAT.runtime.allocatedPvPowerW, dp.pvPowerW ?? null);
    await (0, state_write_1.setStateIfChanged)(host, ensure_states_1.BAT.runtime.allocatedGridPowerW, dp.gridPowerW ?? null);
    await (0, state_write_1.setStateIfChanged)(host, ensure_states_1.BAT.runtime.energySource, dp.energySource);
    await (0, state_write_1.setStateIfChanged)(host, ensure_states_1.BAT.runtime.estimatedCostCt, dp.estimatedCostCt ?? null);
    await (0, state_write_1.setStateIfChanged)(host, ensure_states_1.BAT.runtime.requestedChargePowerW, dp.requestedChargePowerW ?? null);
    await (0, state_write_1.setStateIfChanged)(host, ensure_states_1.BAT.runtime.effectiveChargePowerW, dp.effectiveChargePowerW ?? null);
    await (0, state_write_1.setStateIfChanged)(host, ensure_states_1.BAT.runtime.chargePowerCapped, dp.chargePowerCapped);
    await (0, state_write_1.setStateIfChanged)(host, ensure_states_1.BAT.runtime.topOffActive, dp.topOffActive);
    await (0, state_write_1.setStateIfChanged)(host, ensure_states_1.BAT.runtime.legacyFallbackActive, dp.legacyFallbackActive);
    await (0, state_write_1.setStateIfChanged)(host, ensure_states_1.BAT.runtime.legacyFallbackSource, dp.legacyFallbackSource);
    await (0, state_write_1.setStateIfChanged)(host, ensure_states_1.BAT.runtime.legacyFallbackReasonDe, dp.legacyFallbackReasonDe);
    await (0, state_write_1.setStateIfChanged)(host, ensure_states_1.BAT.runtime.dailyPlanBlocksGridBalance, dp.dailyPlanBlocksGridBalance);
    await (0, state_write_1.setStateIfChanged)(host, ensure_states_1.BAT.runtime.runtimeControlAvailable, dp.runtimeControlAvailable);
    const fault = runtime.faultCode !== null;
    const lockout = runtime.lockout === true;
    let intentStatus = "idle";
    if (fault || lockout || x.decisionSource === "safety") {
        intentStatus = "blocked";
    }
    else if ((0, intent_1.isChargingAction)(x.action) || (x.requestedPowerW ?? 0) > 0) {
        intentStatus = "active";
    }
    else if (x.decisionSource === "addon_disabled" || x.decisionSource === "governance_disabled") {
        intentStatus = "none";
    }
    let executionStatus = x.globalLive ? "live" : "dryrun";
    if (fault) {
        executionStatus = "fault";
    }
    else if (lockout) {
        executionStatus = "lockout";
    }
    await (0, runtime_surface_1.publishAddonRuntimeSurface)(host, "battery", {
        decisionDetail: x.decisionSource,
        decisionReason: dp.allocationReasonDe || s.readiness.reason || "",
        nowIso: iso,
        plannerStatus: (0, runtime_surface_1.plannerStatusFromDailyPlan)({
            governanceEnabled: x.governanceEnabled,
            useDailyPlan: dp.useDailyPlan,
            dailyPlanValid: dp.useDailyPlan,
            dailyPlanStatus: dp.dailyPlanStatus,
        }),
        intentStatus,
        executionStatus,
        profileReady: s.readiness.dryrunReady || s.readiness.liveReady || s.readiness.controlReady,
        telemetryReady: s.readiness.telemetryReady,
        fault,
        lockout,
    });
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
    // Unload-Restore ist selbst der Safety-Write-Pfad (Gegenstück zu safetyWrite im Tick) —
    // Fault/Lockout darf ihn nicht blockieren, sonst bleibt die Batterie beim Adapter-Stop
    // im unsicheren Zustand hängen. Ownership ist durch die Precondition oben bereits belegt.
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
        ownershipValid: runtime.ownership.active,
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
