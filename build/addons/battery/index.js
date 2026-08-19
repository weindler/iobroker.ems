"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.batteryUnloadRestore = exports.runBatteryControlTick = exports.handleBatteryForeignStateChange = exports.handleBatteryGridBalanceForeignStateChange = exports.handleBatteryAdapterStateChange = exports.stopBatteryModule = exports.initBatteryModule = exports.startBatteryModuleRuntime = exports.ensureBatteryStateTree = exports.__resetBatteryRuntimeForTest = exports.BATTERY_ADDON_ID = void 0;
const governance_1 = require("../governance");
const runtime_surface_1 = require("../runtime_surface");
const ems_activity_1 = require("../../ems_activity");
const execution_mode_1 = require("../../execution_mode");
const tree_paths_1 = require("../../tree_paths");
const config_1 = require("./config");
const intent_1 = require("./core/intent");
const validation_1 = require("./core/validation");
const diagnostics_1 = require("./diagnostics");
const ensure_states_1 = require("./ensure_states");
const ems_mirror_1 = require("./ems_mirror");
const grid_balance_1 = require("./grid_balance");
const grid_balance_contract_1 = require("./grid_balance_contract");
const grid_balance_power_1 = require("./grid_balance_power");
const hold_freshness_1 = require("./hold_freshness");
const barrier_1 = require("../../restore/barrier");
const ensure_evcc_states_1 = require("../wallbox/ensure_evcc_states");
const states_1 = require("../wallbox/runtime/states");
const ensure_states_2 = require("../wallbox/ev_foundation/ensure_states");
const mapping_1 = require("./mapping");
const registry_1 = require("./profiles/registry");
const fsm_1 = require("./runtime/fsm");
const execute_1 = require("./runtime/execute");
const ownership_1 = require("./runtime/ownership");
const safety_1 = require("./runtime/safety");
const setpoint_session_1 = require("./runtime/setpoint_session");
const intent_read_1 = require("./runtime/intent_read");
const grid_balance_watch_1 = require("./runtime/grid_balance_watch");
const states_2 = require("../../operator/daily_plan/states");
const daily_plan_1 = require("./runtime/daily_plan");
const state_write_1 = require("../../policy/core/state_write");
const live_cache_1 = require("../../ems_light/live_cache");
exports.BATTERY_ADDON_ID = "battery";
function batteryControlIntervalMs(config) {
    const sec = config.gridBalance.updateIntervalSec;
    return Math.min(15_000, Math.max(3000, sec * 1000));
}
function clearGridBalanceKeepalive() {
    if (gbKeepaliveTimer) {
        clearTimeout(gbKeepaliveTimer);
        gbKeepaliveTimer = null;
    }
}
function scheduleGridBalanceKeepalive(host) {
    clearGridBalanceKeepalive();
    gbKeepaliveTimer = setTimeout(() => {
        gbKeepaliveTimer = null;
        if (!gridBalanceOwnsSetpoint)
            return;
        void runBatteryControlTick(host).catch((e) => host.log.error(`battery grid_balance keepalive: ${e}`));
    }, grid_balance_power_1.GRID_BALANCE_KEEPALIVE_MAX_MS);
}
let controlTimer = null;
let runtime = (0, fsm_1.initialSonnenRuntime)(Date.now());
let gridBalancePausedByFsm = false;
let ownershipLive = false;
let prevLiveWriteAllowed = false;
let ticking = false;
let lastGridBalanceWriteW = null;
let lastGridBalanceWriteAtMs = null;
let lastGridBalanceAction = "";
let lastGridBalanceActionAt = "";
/** Nach Restart einmal schreiben, auch wenn last_action schon derselbe String ist (sonst bleibt ein alter Timestamp stehen). */
let gridBalanceLastActionAtSynced = false;
let gridBalanceOwnsSetpoint = false;
let gridBalanceLiveTest = (0, grid_balance_power_1.emptyGridBalanceLiveTest)();
let gbKeepaliveTimer = null;
const DAILY_PLAN_TRIGGER_IDS = new Set([
    states_2.DAILY_PLAN_STATE_IDS.revision,
    states_2.DAILY_PLAN_STATE_IDS.status,
    states_2.ALLOCATION_ADDON_STATE_IDS.battery.planJson,
]);
/** Nur für Tests: internen Laufzeitzustand zurücksetzen. */
function __resetBatteryRuntimeForTest(now = Date.now()) {
    runtime = (0, fsm_1.initialSonnenRuntime)(now);
    gridBalancePausedByFsm = false;
    ownershipLive = false;
    prevLiveWriteAllowed = false;
    lastGridBalanceWriteW = null;
    lastGridBalanceWriteAtMs = null;
    lastGridBalanceAction = "";
    lastGridBalanceActionAt = "";
    gridBalanceLastActionAtSynced = false;
    gridBalanceOwnsSetpoint = false;
    gridBalanceLiveTest = (0, grid_balance_power_1.emptyGridBalanceLiveTest)();
    clearGridBalanceKeepalive();
    (0, daily_plan_1.resetBatteryDailyPlanCache)();
    (0, setpoint_session_1.resetBatterySetpointSession)();
}
exports.__resetBatteryRuntimeForTest = __resetBatteryRuntimeForTest;
async function ensureBatteryStateTree(adapter) {
    await (0, ems_mirror_1.ensureBatteryEmsMirrorStates)(adapter);
    await (0, ensure_states_1.ensureBatteryArchitectureStates)(adapter);
}
exports.ensureBatteryStateTree = ensureBatteryStateTree;
async function startBatteryModuleRuntime(adapter) {
    runtime = (0, fsm_1.initialSonnenRuntime)(Date.now());
    gridBalancePausedByFsm = false;
    ownershipLive = false;
    prevLiveWriteAllowed = false;
    lastGridBalanceWriteW = null;
    lastGridBalanceWriteAtMs = null;
    lastGridBalanceAction = "";
    lastGridBalanceActionAt = "";
    gridBalanceLastActionAtSynced = false;
    gridBalanceOwnsSetpoint = false;
    gridBalanceLiveTest = (0, grid_balance_power_1.emptyGridBalanceLiveTest)();
    clearGridBalanceKeepalive();
    (0, setpoint_session_1.resetBatterySetpointSession)();
    const host = adapter;
    for (const relId of ems_mirror_1.EMS_MIRROR_BATTERY_IDS) {
        await adapter.subscribeStatesAsync(relId);
    }
    await adapter.subscribeStatesAsync(ensure_states_1.BAT.control.faultReset);
    await adapter.subscribeStatesAsync(ensure_states_1.BAT.gridBalance.liveTestArmed);
    await adapter.subscribeStatesAsync("live.price.now_ct_per_kwh");
    await adapter.subscribeStatesAsync("planner.constraints.battery_hold_active");
    await adapter.subscribeStatesAsync(states_1.WALLBOX_RUNTIME_STATES.batteryHoldForEvCharge);
    await adapter.subscribeStatesAsync(ensure_states_2.WALLBOX_EV_FOUNDATION_STATES.evExecutionAuthority);
    await adapter.subscribeStatesAsync(ensure_evcc_states_1.WALLBOX_EVCC_STATES.batteryMode);
    await adapter.subscribeStatesAsync(states_1.WALLBOX_RUNTIME_STATES.tibberGridRewardsActive);
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
    clearGridBalanceKeepalive();
    (0, grid_balance_watch_1.clearGridBalanceWatch)();
    lastGridBalanceWriteW = null;
    lastGridBalanceWriteAtMs = null;
    (0, daily_plan_1.resetBatteryDailyPlanCache)();
}
exports.stopBatteryModule = stopBatteryModule;
function handleBatteryAdapterStateChange(adapter, stateId) {
    const ns = `${adapter.namespace}.`;
    const rel = stateId.startsWith(ns) ? stateId.slice(ns.length) : stateId;
    if (rel === ensure_states_1.BAT.control.faultReset ||
        rel === ensure_states_1.BAT.gridBalance.liveTestArmed ||
        rel === "live.price.now_ct_per_kwh" ||
        rel === "planner.constraints.battery_hold_active" ||
        rel === states_1.WALLBOX_RUNTIME_STATES.batteryHoldForEvCharge ||
        rel === ensure_states_2.WALLBOX_EV_FOUNDATION_STATES.evExecutionAuthority ||
        rel === ensure_evcc_states_1.WALLBOX_EVCC_STATES.batteryMode ||
        rel === states_1.WALLBOX_RUNTIME_STATES.tibberGridRewardsActive ||
        (0, execution_mode_1.isExecutionModeStateRelativeId)(rel) ||
        ems_mirror_1.EMS_MIRROR_BATTERY_IDS.includes(rel) ||
        DAILY_PLAN_TRIGGER_IDS.has(rel)) {
        void runBatteryControlTick(adapter).catch((e) => adapter.log.error(`battery state change tick: ${e}`));
    }
}
exports.handleBatteryAdapterStateChange = handleBatteryAdapterStateChange;
/** Reagiert auf Änderungen an gemapptem consumption/PV/SOC/Mode (Netzausgleich on-change). */
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
async function readRelNumberTs(host, id, nowMs) {
    const st = await host.getStateAsync(id);
    if (st?.val == null)
        return { val: null, ageMs: null };
    const n = Number(st.val);
    const val = Number.isFinite(n) ? n : null;
    const ts = typeof st.ts === "number" && Number.isFinite(st.ts) ? st.ts : null;
    const ageMs = ts != null ? Math.max(0, nowMs - ts) : null;
    return { val, ageMs };
}
async function readRelString(host, id) {
    const st = await host.getStateAsync(id);
    if (st?.val == null)
        return null;
    const s = String(st.val).trim();
    return s.length > 0 ? s : null;
}
async function readRelBool(host, id) {
    const st = await host.getStateAsync(id);
    return st?.val === true;
}
async function readRelOptionalBool(host, id) {
    const st = await host.getStateAsync(id);
    if (st?.val === true)
        return true;
    if (st?.val === false)
        return false;
    return null;
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
    try {
        await (0, live_cache_1.refreshLivePowerStrip)(host);
    }
    catch (e) {
        host.log.warn(`live power strip: ${e}`);
    }
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
    if ((0, setpoint_session_1.consumeFailsafeSetpointTakeover)()) {
        runtime = {
            ...runtime,
            state: "completed",
            ownership: (0, ownership_1.emptyOwnership)(),
            effectivePowerW: 0,
        };
        ownershipLive = false;
        gridBalanceOwnsSetpoint = false;
        lastGridBalanceWriteW = null;
        lastGridBalanceWriteAtMs = null;
        clearGridBalanceKeepalive();
        gridBalancePausedByFsm = false;
    }
    const nowMs = Date.now();
    const config = (0, config_1.batteryConfigFromAdapter)(host.config);
    const profile = (0, registry_1.getBatteryProfile)(config.profile);
    const table = (0, mapping_1.batteryMappingFromConfig)(host.config);
    const governanceEnabled = await (0, governance_1.isAddonGovernanceEnabledFromState)((id) => host.getStateAsync(id), exports.BATTERY_ADDON_ID);
    const liveWriteAllowed = await (0, execution_mode_1.isLiveWriteAllowed)((id) => host.getStateAsync(id), exports.BATTERY_ADDON_ID);
    const executionOff = (0, execution_mode_1.isAddonExecutionOff)((await host.getStateAsync((0, tree_paths_1.addonMode)(exports.BATTERY_ADDON_ID)))?.val);
    if (liveWriteAllowed &&
        !prevLiveWriteAllowed &&
        !ownershipLive &&
        (0, fsm_1.isBatterySimulatedProgressState)(runtime.state)) {
        host.log.info("battery: live write enabled — restarting charge sequence (prior dryrun progress discarded)");
        runtime = (0, fsm_1.initialSonnenRuntime)(nowMs);
        gridBalancePausedByFsm = false;
        (0, setpoint_session_1.resetBatterySetpointSession)();
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
    else if (!executionOff && dailyPlanContext.useDailyPlan) {
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
    /*
     * Befund 005: mode=off — keine neue Lade-Strategie.
     * Nur wenn EMS-Ownership noch aktiv: einmalige Steuerungsübergabe (Restore).
     */
    if (executionOff) {
        wantsCharge = false;
        if (runtime.ownership.active || ownershipLive) {
            runtimeDecisionSource = "restore";
            deviceIntent = {
                ...deviceIntent,
                action: "self_consumption",
                maxChargeW: null,
                reason: "Add-on Aus — Ownership-Steuerungsübergabe an Self-Consumption",
            };
        }
        else {
            runtimeDecisionSource = "safe_default";
        }
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
    const [batteryHoldConstraintSt, wallboxBatteryHold, priceNowCt, evccLoadpointMode, evccChargingFlag, evccChargePowerW, evccConnectedFlag, evccBatteryMode, evccBatteryBoost, tibberRewardsRuntime, evAuthority, wallboxEnergySource, globalModeRaw, addonModeRaw,] = await Promise.all([
        host.getStateAsync("planner.constraints.battery_hold_active"),
        readRelBool(host, states_1.WALLBOX_RUNTIME_STATES.batteryHoldForEvCharge),
        readRelNumber(host, "live.price.now_ct_per_kwh"),
        readRelString(host, ensure_evcc_states_1.WALLBOX_EVCC_STATES.loadpointMode),
        readRelBool(host, ensure_evcc_states_1.WALLBOX_EVCC_STATES.charging),
        readRelNumber(host, ensure_evcc_states_1.WALLBOX_EVCC_STATES.chargePowerW),
        readRelOptionalBool(host, ensure_evcc_states_1.WALLBOX_EVCC_STATES.connected),
        readRelString(host, ensure_evcc_states_1.WALLBOX_EVCC_STATES.batteryMode),
        readRelBool(host, ensure_evcc_states_1.WALLBOX_EVCC_STATES.batteryBoost),
        readRelBool(host, states_1.WALLBOX_RUNTIME_STATES.tibberGridRewardsActive),
        readRelString(host, ensure_states_2.WALLBOX_EV_FOUNDATION_STATES.evExecutionAuthority),
        readRelString(host, states_1.WALLBOX_RUNTIME_STATES.energySource),
        host.getStateAsync(tree_paths_1.GLOBAL.executionMode),
        host.getStateAsync((0, tree_paths_1.addonMode)(exports.BATTERY_ADDON_ID)),
    ]);
    const globalLive = (0, execution_mode_1.parseGlobalMode)(globalModeRaw?.val) === "live";
    const addonLive = (0, execution_mode_1.parseAddonMode)(addonModeRaw?.val) === "live";
    const evChargeHold = evccConnectedFlag === false ? false : wallboxBatteryHold;
    const holdSignals = (0, hold_freshness_1.resolveGridBalanceHoldSignals)({
        nowMs,
        constraintHoldState: batteryHoldConstraintSt,
        deviceIntentHold: deviceIntent.action === "hold",
        batteryHoldForEvCharge: evChargeHold,
        evccBatteryMode,
    });
    const evccBatteryModeHold = holdSignals.evccBatteryModeHold;
    const holdPlanned = holdSignals.holdPlanned;
    const holdActive = holdSignals.holdActive;
    if (holdPlanned || holdActive || (evAuthority ?? "").toLowerCase() === "external") {
        wantsCharge = false;
    }
    const evConflict = (0, grid_balance_contract_1.classifyGridBalanceEvConflict)({
        loadpointMode: evccLoadpointMode,
        charging: evccChargingFlag,
        chargePowerW: evccChargePowerW,
        wallboxHold: wallboxBatteryHold,
        batteryBoost: evccBatteryBoost,
        externalAuthority: (evAuthority ?? "").toLowerCase() === "external",
        tibberRewardsActive: tibberRewardsRuntime,
        wallboxEnergySource,
        wallboxAllocatedGridW: null,
        vehicleConnected: evccConnectedFlag,
    });
    const gridBalanceSuppressed = holdActive ||
        holdPlanned ||
        evConflict.conflict ||
        runtime.ownership.active;
    const emsBatteryIntentActive = Boolean(fromManual
        ? wantsCharge
        : dailyPlanDriven
            ? wantsCharge || (runtime.ownership.active && runtime.requestId?.startsWith("daily-plan"))
            : deviceIntent.source === "winter_planner"
                ? wantsCharge || runtime.ownership.active
                : emsMirrorIntentActive && wantsCharge);
    // Grid balance controller — Admin-Schalter ist die einzige Feature-Freigabe.
    const adapterFeature = snapshot.capabilities.control_grid_balance.available;
    await (0, state_write_1.setStateIfChanged)(host, ems_mirror_1.EMS_MIRROR_BATTERY.gridBalanceEnabled, config.gridBalance.enabled);
    const controller = (0, grid_balance_1.resolveController)({
        emsBatteryIntentActive,
        emsGridBalanceEnabled: config.gridBalance.enabled,
        adapterFeatureEnabled: adapterFeature,
        batteryAddonEnabled: governanceEnabled,
        gridBalancePaused: gridBalancePausedByFsm || runtime.ownership.active,
        gridBalanceSuppressed,
    });
    /*
     * Leave-Live / LIVE→OFF: Restore nur wenn EMS zuvor real Ownership hatte (`ownershipLive`).
     * Dryrun-Ownership allein darf nie safetyOverride öffnen (sonst Dryrun→echte Writes).
     */
    const safetyOverride = ownershipLive && !liveWriteAllowed;
    const effectiveLive = liveWriteAllowed || safetyOverride;
    if (executionOff && safetyOverride) {
        host.log.info("battery: Add-on Aus — einmalige Ownership-Steuerungsübergabe (Restore)");
    }
    const targetSocReached = deviceIntent.targetSocPct != null &&
        snapshot.telemetry.socPct != null &&
        snapshot.telemetry.socPct >= deviceIntent.targetSocPct;
    // Hardware-Sicherheitsdecke unabhängig vom Intent-Ziel: nie über den konfigurierten
    // HW-Max-SOC hinaus laden, auch wenn der Intent kein (oder ein höheres) Ziel setzt.
    const safetyBlocked = runtime.ownership.active &&
        snapshot.limits.maxSocPct != null &&
        snapshot.telemetry.socPct != null &&
        snapshot.telemetry.socPct >= snapshot.limits.maxSocPct;
    const stopReasonRaw = (0, safety_1.evaluateStopCondition)({
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
    const setpointHandover = (0, setpoint_session_1.resolveBatterySetpointHandover)({
        hold: holdPlanned || holdActive,
        external: (evAuthority ?? "").toLowerCase() === "external",
        restoreOrFault: (0, barrier_1.isRestoreInProgress)(),
        higherPriority: false,
    });
    const sessionNow = (0, setpoint_session_1.getBatterySetpointSession)();
    const fsmOwnsSetpoint = sessionNow.wrotePositive &&
        (sessionNow.owner === "grid_charge" || sessionNow.owner === "planned_charge");
    let stopReason = stopReasonRaw;
    let stopDisposition;
    const inChargeSequence = runtime.state !== "idle" &&
        runtime.state !== "completed" &&
        runtime.state !== "rejected" &&
        runtime.state !== "lockout" &&
        runtime.state !== "fault";
    if (setpointHandover !== "none" &&
        (runtime.ownership.active || fsmOwnsSetpoint || inChargeSequence)) {
        stopDisposition = "drop_ownership";
        if (!stopReason)
            stopReason = `authority_${setpointHandover}`;
    }
    else if (stopReason) {
        stopDisposition = "release_zero";
    }
    const forceZeroSetpointWrite = stopDisposition === "release_zero" && fsmOwnsSetpoint && sessionNow.setpointW > 0;
    if (forceZeroSetpointWrite) {
        (0, setpoint_session_1.setBatterySetpointSession)((0, setpoint_session_1.markReleasePending)((0, setpoint_session_1.getBatterySetpointSession)(), stopReason ?? "regular_end"));
    }
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
        stopDisposition,
        forceZeroSetpointWrite: stopDisposition === "release_zero" ? forceZeroSetpointWrite : undefined,
    };
    const fsmStateBefore = runtime.state;
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
        if (w.kind === "charge_power") {
            const accepted = result.executed || result.written || result.simulated;
            const owner = (0, setpoint_session_1.setpointOwnerFromAction)(runtime.action) === "none"
                ? "planned_charge"
                : (0, setpoint_session_1.setpointOwnerFromAction)(runtime.action);
            if (accepted && w.value > 0) {
                (0, setpoint_session_1.setBatterySetpointSession)((0, setpoint_session_1.notePositiveSetpointWrite)((0, setpoint_session_1.getBatterySetpointSession)(), owner, w.value, Boolean(result.executed || result.written)));
            }
            if (accepted && w.value === 0) {
                (0, setpoint_session_1.setBatterySetpointSession)((0, setpoint_session_1.applyZeroRelease)((0, setpoint_session_1.getBatterySetpointSession)(), new Date(nowMs).toISOString(), stopReason ?? "regular_end"));
            }
        }
    }
    if (fsmStateBefore === "set_charge_power" &&
        runtime.state === "active" &&
        runtime.effectivePowerW > 0 &&
        !step.writes.some((w) => w.kind === "charge_power" && w.value > 0)) {
        const owner = (0, setpoint_session_1.setpointOwnerFromAction)(runtime.action) === "none"
            ? "planned_charge"
            : (0, setpoint_session_1.setpointOwnerFromAction)(runtime.action);
        (0, setpoint_session_1.setBatterySetpointSession)((0, setpoint_session_1.notePositiveSetpointWrite)((0, setpoint_session_1.getBatterySetpointSession)(), owner, runtime.effectivePowerW, effectiveLive));
    }
    if (stopDisposition === "drop_ownership" && (0, setpoint_session_1.getBatterySetpointSession)().owner !== "none") {
        (0, setpoint_session_1.setBatterySetpointSession)((0, setpoint_session_1.applyHandover)((0, setpoint_session_1.getBatterySetpointSession)(), `handover_${setpointHandover}`));
    }
    if (!runtime.ownership.active) {
        ownershipLive = false;
    }
    // Grid balance: safety + EV-Abzug + Deadband; Writes bei Dauerbetrieb oder Rest-One-Shot.
    const consumption = (await readMappedNumber(host, table, "consumption_w")).val ?? 0;
    const pv = (await readMappedNumber(host, table, "pv_ac_power_w")).val ?? 0;
    const evPower = await readRelNumberTs(host, ensure_evcc_states_1.WALLBOX_EVCC_STATES.chargePowerW, nowMs);
    const armedSt = await host.getStateAsync(ensure_states_1.BAT.gridBalance.liveTestArmed);
    gridBalanceLiveTest = (0, grid_balance_power_1.applyGridBalanceLiveTestPulse)(gridBalanceLiveTest, armedSt?.val, armedSt?.ack, nowMs);
    if (armedSt?.ack === false) {
        await host.setStateAsync(ensure_states_1.BAT.gridBalance.liveTestArmed, {
            val: gridBalanceLiveTest.armed,
            ack: true,
        });
    }
    const offset = snapshot.telemetry.socPct != null && snapshot.telemetry.socPct > config.gridBalance.socThresholdPct
        ? config.gridBalance.offsetHighSocW
        : config.gridBalance.offsetLowSocW;
    const safetyInput = {
        adminEnabled: config.gridBalance.enabled,
        emsMirrorEnabled: config.gridBalance.enabled,
        globalLive,
        addonLive,
        addonEnabled: !executionOff,
        governanceEnabled,
        faultActive: runtime.faultCode !== null,
        lockoutActive: runtime.lockout,
        restoreInProgress: (0, barrier_1.isRestoreInProgress)(),
        sourceStale: snapshot.telemetry.stale,
        sourceOffline: online === false,
        holdPlanned,
        holdActive,
        evccBatteryModeHold,
        plannedBatteryAction: emsBatteryIntentActive,
        ownershipActive: runtime.ownership.active,
        dailyPlanAuthoritative,
        mode1Active: runtime.ownership.active,
        priceNowCt,
        priceMinCt: config.gridBalance.minPriceCtPerKwh,
        evConflictKind: evConflict.kind,
        externalEvAuthority: (evAuthority ?? "").toLowerCase() === "external",
    };
    const gbSession = (0, setpoint_session_1.getBatterySetpointSession)();
    const leavingLiveWithOwnership = gridBalanceOwnsSetpoint &&
        gbSession.owner === "grid_balance" &&
        gbSession.wroteLive &&
        !liveWriteAllowed;
    const mode2Confirmed = snapshot.telemetry.operatingMode === "self_consumption";
    const gbDecision = (0, grid_balance_power_1.evaluateGridBalanceTick)({
        nowMs,
        safety: safetyInput,
        consumptionW: consumption,
        pvAcPowerW: pv,
        charging: evccChargingFlag,
        chargePowerW: evPower.val ?? evccChargePowerW,
        chargePowerAgeMs: evPower.ageMs,
        vehicleConnected: evccConnectedFlag,
        deadbandW: config.gridBalance.deadbandW,
        offsetW: offset,
        configuredMaxW: config.gridBalance.maxTargetW,
        hardwareMaxChargeW: snapshot.limits.maxChargeW,
        hardwareMaxDischargeW: snapshot.limits.maxDischargeW,
        minChangeW: config.gridBalance.minChangeW,
        lastWrittenW: lastGridBalanceWriteW,
        lastWriteAtMs: lastGridBalanceWriteAtMs,
        ownsSetpoint: gridBalanceOwnsSetpoint,
        liveTest: gridBalanceLiveTest,
        controllerIsGridBalance: controller === "grid_balance" && !gridBalancePausedByFsm && !executionOff,
        mode2Confirmed,
        keepaliveMaxMs: grid_balance_power_1.GRID_BALANCE_KEEPALIVE_MAX_MS,
        leavingLiveWithOwnership,
    });
    gridBalanceLiveTest = gbDecision.liveTestNext;
    const gbState = table.set_discharge_power.targetState;
    let gbWouldWrite = false;
    let gbEffective = gbDecision.effectivePowerW;
    if ((gbDecision.shouldWrite || gbDecision.shouldRelease) && gbState.length > 0) {
        if (gbDecision.shouldRelease && (0, setpoint_session_1.getBatterySetpointSession)().owner === "grid_balance") {
            (0, setpoint_session_1.setBatterySetpointSession)((0, setpoint_session_1.markReleasePending)((0, setpoint_session_1.getBatterySetpointSession)(), "grid_balance_idle"));
        }
        const gbReleaseLive = gbDecision.shouldRelease && (0, setpoint_session_1.getBatterySetpointSession)().wroteLive;
        const gbWriteLive = liveWriteAllowed || gbReleaseLive;
        const wr = await (0, execute_1.executeBatteryWrite)(host, {
            kind: "discharge_power",
            stateId: gbState,
            value: gbDecision.writePowerW,
            requestId: "grid_balance",
            reason: gbDecision.shouldRelease
                ? "grid_balance_release"
                : gbDecision.lastAction === "keepalive"
                    ? "grid_balance_keepalive"
                    : "grid_balance",
            expectedFeedback: gbDecision.writePowerW,
            dryrun: !gbWriteLive,
            force: gbDecision.forceWrite === true,
            gate: {
                ...gate,
                globalLive: gbWriteLive,
                intentValid: true,
                fault: false,
                lockout: false,
                targetMappingConfigured: true,
            },
        });
        lastWrite = {
            state: gbState,
            value: gbDecision.writePowerW,
            success: Boolean(wr.executed || wr.written || wr.simulated),
            expected: gbDecision.writePowerW,
        };
        if (wr.executed || wr.written || wr.simulated) {
            gbWouldWrite = gbDecision.shouldWrite;
            gbEffective = gbDecision.shouldRelease ? 0 : gbDecision.writePowerW;
            if (gbDecision.shouldWrite) {
                lastGridBalanceWriteW = gbDecision.writePowerW;
                lastGridBalanceWriteAtMs = nowMs;
                gridBalanceOwnsSetpoint = true;
                (0, setpoint_session_1.setBatterySetpointSession)((0, setpoint_session_1.notePositiveSetpointWrite)((0, setpoint_session_1.getBatterySetpointSession)(), "grid_balance", gbDecision.writePowerW, Boolean(wr.executed || wr.written)));
                if (gbDecision.lastAction !== "keepalive" && !grid_balance_contract_1.GRID_BALANCE_EXECUTION_ENABLED) {
                    gridBalanceLiveTest = (0, grid_balance_power_1.consumeGridBalanceLiveTest)(gridBalanceLiveTest, nowMs);
                }
                scheduleGridBalanceKeepalive(host);
            }
            if (gbDecision.shouldRelease) {
                lastGridBalanceWriteW = null;
                lastGridBalanceWriteAtMs = null;
                gridBalanceOwnsSetpoint = false;
                clearGridBalanceKeepalive();
                (0, setpoint_session_1.setBatterySetpointSession)((0, setpoint_session_1.applyZeroRelease)((0, setpoint_session_1.getBatterySetpointSession)(), new Date(nowMs).toISOString(), "grid_balance_idle"));
            }
        }
        else if (gbDecision.shouldWrite) {
            gridBalanceOwnsSetpoint = false;
            clearGridBalanceKeepalive();
        }
        else if (gbDecision.shouldRelease) {
            gridBalanceOwnsSetpoint = true;
        }
    }
    else if (gbDecision.shouldWrite || gbDecision.shouldRelease) {
        lastGridBalanceWriteW = null;
        lastGridBalanceWriteAtMs = null;
        gridBalanceOwnsSetpoint = false;
        clearGridBalanceKeepalive();
    }
    else {
        gridBalanceOwnsSetpoint = gbDecision.ownsSetpointNext;
        if (!gbDecision.ownsSetpointNext) {
            clearGridBalanceKeepalive();
            lastGridBalanceWriteW = null;
            lastGridBalanceWriteAtMs = null;
            if ((0, setpoint_session_1.getBatterySetpointSession)().owner === "grid_balance") {
                const gbHandover = (0, setpoint_session_1.resolveBatterySetpointHandover)({
                    hold: gbDecision.holdDetected,
                    external: gbDecision.authority === "external_ev",
                    restoreOrFault: gbDecision.authority === "safety" &&
                        (safetyInput.restoreInProgress || safetyInput.faultActive || safetyInput.lockoutActive),
                    higherPriority: gbDecision.authority === "planned_battery",
                });
                const reason = gbHandover === "none" ? "grid_balance_drop" : `handover_${gbHandover}`;
                (0, setpoint_session_1.setBatterySetpointSession)((0, setpoint_session_1.applyHandover)((0, setpoint_session_1.getBatterySetpointSession)(), reason));
            }
        }
    }
    const isoNow = new Date(nowMs).toISOString();
    lastGridBalanceAction = gbDecision.lastAction;
    lastGridBalanceActionAt = isoNow;
    const gbSafety = {
        ...gbDecision.safety,
        ready: gbDecision.ready,
        active: gbDecision.active,
        blockReason: gbDecision.blockReason,
        explain: gbDecision.explain,
    };
    await persist(host, snapshot, {
        nowMs,
        globalLive: liveWriteAllowed,
        governanceEnabled,
        controller,
        lastWrite,
        gb: {
            wouldWrite: gbWouldWrite,
            target: gbDecision.requestedPowerW,
            state: gbState,
            effective: gbEffective,
            importW: gbDecision.rawGridDeltaW,
            safety: gbSafety,
            decision: gbDecision,
        },
        clamps: validation.clamps,
        requestedPowerW: deviceIntent.maxChargeW ?? 0,
        effectiveChargeW,
        action: deviceIntent.action,
        actualMode: modeRead.val,
        actualChargingW: snapshot.telemetry.chargingPowerW,
        dailyPlan: dailyPlanContext,
        decisionSource: runtimeDecisionSource,
        priceNowCt,
        priceMinCt: config.gridBalance.minPriceCtPerKwh,
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
    await set(ensure_states_1.BAT.status.telemetryReady, s.readiness.telemetryReady);
    await set(ensure_states_1.BAT.status.effectiveExecutionMode, s.effectiveExecutionMode);
    await set(ensure_states_1.BAT.status.state, runtime.state);
    await set(ensure_states_1.BAT.status.reason, s.readiness.reason);
    await set(ensure_states_1.BAT.status.fault, runtime.faultCode !== null);
    await set(ensure_states_1.BAT.status.lockout, runtime.lockout);
    await set(ensure_states_1.BAT.runtime.action, runtime.action ?? "");
    await set(ensure_states_1.BAT.runtime.state, runtime.state);
    await set(ensure_states_1.BAT.runtime.ownershipActive, runtime.ownership.active);
    const sp = (0, setpoint_session_1.getBatterySetpointSession)();
    await set(ensure_states_1.BAT.runtime.batterySetpointOwner, sp.owner);
    await set(ensure_states_1.BAT.runtime.batterySetpointKind, sp.kind);
    await set(ensure_states_1.BAT.runtime.batterySetpointW, sp.setpointW);
    const dp = x.dailyPlan;
    await (0, state_write_1.setStateIfChanged)(host, ensure_states_1.BAT.runtime.decisionSource, x.decisionSource);
    await (0, state_write_1.setStateIfChanged)(host, ensure_states_1.BAT.runtime.reasonDe, dp.allocationReasonDe || "");
    await (0, state_write_1.setStateIfChanged)(host, ensure_states_1.BAT.runtime.dailyPlanStatus, dp.dailyPlanStatus);
    await (0, state_write_1.setStateIfChanged)(host, ensure_states_1.BAT.runtime.dailyPlanValid, dp.useDailyPlan);
    await (0, state_write_1.setStateIfChanged)(host, ensure_states_1.BAT.runtime.dailyPlanRevision, dp.dailyPlanRevision ?? 0);
    await (0, state_write_1.setStateIfChanged)(host, ensure_states_1.BAT.runtime.allocatedChargePowerW, dp.allocatedChargePowerW ?? null);
    await (0, state_write_1.setStateIfChanged)(host, ensure_states_1.BAT.runtime.energySource, dp.energySource);
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
    await set(ensure_states_1.BAT.diagnostics.faultCode, runtime.faultCode ?? "");
    await set(ensure_states_1.BAT.diagnostics.faultReason, runtime.faultReason ?? "");
    const d = x.gb.decision;
    await (0, state_write_1.setStateIfChanged)(host, ensure_states_1.BAT.gridBalance.enabled, d.enabled);
    await (0, state_write_1.setStateIfChanged)(host, ensure_states_1.BAT.gridBalance.active, d.active);
    await (0, state_write_1.setStateIfChanged)(host, ensure_states_1.BAT.gridBalance.ready, d.ready);
    await (0, state_write_1.setStateIfChanged)(host, ensure_states_1.BAT.gridBalance.blockReason, d.blockReason);
    await (0, state_write_1.setStateIfChanged)(host, ensure_states_1.BAT.gridBalance.currentPriceCtKwh, x.priceNowCt != null && Number.isFinite(x.priceNowCt) ? Math.round(x.priceNowCt * 10) / 10 : x.priceNowCt);
    await (0, state_write_1.setStateIfChanged)(host, ensure_states_1.BAT.gridBalance.priceMinCtKwh, x.priceMinCt);
    await (0, state_write_1.setStateIfChanged)(host, ensure_states_1.BAT.gridBalance.priceAllowed, d.priceAllowed);
    await (0, state_write_1.setStateIfChanged)(host, ensure_states_1.BAT.gridBalance.gridPowerW, d.rawGridDeltaW);
    await (0, state_write_1.setStateIfChanged)(host, ensure_states_1.BAT.gridBalance.effectivePowerW, d.effectivePowerW);
    await (0, state_write_1.setStateIfChanged)(host, ensure_states_1.BAT.gridBalance.holdDetected, d.holdDetected);
    await (0, state_write_1.setStateIfChanged)(host, ensure_states_1.BAT.gridBalance.evConflict, d.evConflict);
    const actionChanged = await (0, state_write_1.setStateIfChanged)(host, ensure_states_1.BAT.gridBalance.lastAction, lastGridBalanceAction);
    if (actionChanged || !gridBalanceLastActionAtSynced) {
        await host.setStateAsync(ensure_states_1.BAT.gridBalance.lastActionAt, { val: lastGridBalanceActionAt, ack: true });
        gridBalanceLastActionAtSynced = true;
    }
    else {
        const at = await host.getStateAsync(ensure_states_1.BAT.gridBalance.lastActionAt);
        const atVal = at?.val != null ? String(at.val).trim() : "";
        if (!atVal) {
            await host.setStateAsync(ensure_states_1.BAT.gridBalance.lastActionAt, { val: lastGridBalanceActionAt, ack: true });
        }
    }
    await (0, state_write_1.setStateIfChanged)(host, ensure_states_1.BAT.gridBalance.explain, d.explain);
    await (0, state_write_1.setStateIfChanged)(host, ensure_states_1.BAT.gridBalance.liveTestArmed, gridBalanceLiveTest.armed);
    await (0, state_write_1.setStateIfChanged)(host, ensure_states_1.BAT.gridBalance.liveTestArmedAt, gridBalanceLiveTest.armedAtMs != null ? new Date(gridBalanceLiveTest.armedAtMs).toISOString() : "");
    await (0, state_write_1.setStateIfChanged)(host, ensure_states_1.BAT.gridBalance.liveTestResult, gridBalanceLiveTest.result);
}
/** Adapter-Unload: best-effort Safe Restore nur bei aktiver Live-Ownership. */
async function batteryUnloadRestore(host) {
    const session = (0, setpoint_session_1.getBatterySetpointSession)();
    const fsmLive = runtime.ownership.active && ownershipLive;
    const setpointLive = session.wroteLive && session.owner !== "none";
    if (!fsmLive && !setpointLive) {
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
        ownershipValid: runtime.ownership.active || setpointLive,
    };
    try {
        const gbDischarge = session.kind === "discharge" || session.owner === "grid_balance";
        if (setpointLive && gbDischarge) {
            await (0, execute_1.executeBatteryWrite)(host, {
                kind: "discharge_power",
                stateId: table.set_discharge_power.targetState,
                value: 0,
                requestId: "unload",
                reason: "unload_stop_discharge",
                dryrun: false,
                force: true,
                gate,
            });
            (0, setpoint_session_1.setBatterySetpointSession)((0, setpoint_session_1.applyZeroRelease)(session, new Date().toISOString(), "unload_stop"));
        }
        else if (setpointLive || fsmLive) {
            await (0, execute_1.executeBatteryWrite)(host, {
                kind: "charge_power",
                stateId: table.set_charge_power.targetState,
                value: 0,
                requestId: "unload",
                reason: "unload_stop",
                dryrun: false,
                gate,
            });
            (0, setpoint_session_1.setBatterySetpointSession)((0, setpoint_session_1.applyZeroRelease)(session, new Date().toISOString(), "unload_stop"));
        }
        if (fsmLive) {
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
    }
    catch (e) {
        host.log.warn(`battery unload restore best-effort failed: ${String(e)}`);
    }
}
exports.batteryUnloadRestore = batteryUnloadRestore;
