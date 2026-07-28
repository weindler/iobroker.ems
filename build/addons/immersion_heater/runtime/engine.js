"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getImmersionDailyPlanContextForTest = exports.getImmersionPersistForTest = exports.resetImmersionRuntimeForTest = exports.stopImmersionRuntimeEngine = exports.initImmersionRuntimeEngine = exports.hydrateImmersionRuntimePersist = exports.handleImmersionFaultReset = exports.runImmersionRuntimeTick = exports.immersionRuntimeWatchedForeignIds = void 0;
const ems_activity_1 = require("../../../ems_activity");
const execution_mode_1 = require("../../../execution_mode");
const device_write_1 = require("../../../device_write");
const governance_1 = require("../../../addons/governance");
const runtime_surface_1 = require("../../../addons/runtime_surface");
const state_write_1 = require("../../../policy/core/state_write");
const constants_1 = require("../../../intent/core/constants");
const tree_paths_1 = require("../../../tree_paths");
const device_config_1 = require("../device_config");
const validate_config_1 = require("../validate_config");
const status_1 = require("../status");
const ensure_states_1 = require("./ensure_states");
const fsm_1 = require("./fsm");
const thermal_forecast_1 = require("../../../operator/planning/thermal_forecast");
const governance_2 = require("../../governance");
const state_util_1 = require("../../../ems_light/state_util");
const safety_1 = require("./safety");
const types_1 = require("./types");
const persist_1 = require("./persist");
const daily_plan_1 = require("./daily_plan");
const states_1 = require("../../../operator/daily_plan/states");
const intent_read_1 = require("./intent_read");
const feedback_1 = require("./feedback");
const consumer_stats_1 = require("../../../learning/consumer_stats");
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
let lastDailyPlanContext = null;
/** Nach Upgrade einmalig Ensure nachziehen (plan_target_*), danach nicht jeden Tick. */
let runtimeStatesEnsuredThisProcess = false;
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
/**
 * Lokaler Sicherheits-Default für den Auto-Modus, wenn der Daily Plan nicht verwendbar ist
 * (Roadmap Block 3.1) — bewusst kein Rückgriff auf den alten Realtime-Planner
 * (`planner.intent.thermal.*`). Ziel ist nur die Pflicht-Untergrenze (`planningMinTempC`,
 * gleiche Schwelle wie die Operator-Pflicht-Contribution), nicht der volle Komfortbereich.
 * Die Stufe nutzt die bereits vorhandene, admin-konfigurierte `forceDefaultStage`.
 */
function safeDefaultAutoTarget(config) {
    return { stage: config.forceDefaultStage, targetTempC: config.planningMinTempC };
}
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
async function readLocalNum(host, id) {
    try {
        const st = await host.getStateAsync(id);
        return (0, state_util_1.asNum)(st?.val);
    }
    catch {
        return null;
    }
}
async function readLocalStr(host, id) {
    try {
        const st = await host.getStateAsync(id);
        if (st?.val === null || st?.val === undefined || st.val === "")
            return null;
        return String(st.val);
    }
    catch {
        return null;
    }
}
/** Forecast-/Force-Tagesziel für VIS und FSM-Ceiling (nicht die harte Planungsobergrenze allein). */
async function resolveImmersionPlanTarget(host, config, bufferTempC, resolvedMode, forceTarget) {
    if (resolvedMode === "off") {
        return { targetTempC: null, reasonDe: "Modus off — kein Heiz-Tagesziel." };
    }
    if (resolvedMode === "force") {
        const t = forceTarget ?? config.planningMaxTempC;
        return { targetTempC: t, reasonDe: `Force-Ziel ${t} °C.` };
    }
    const [pvToday, pvTomorrow, pvStatus, aiAllowed] = await Promise.all([
        readLocalNum(host, "learning.pv_bias.corrected_today_kwh"),
        readLocalNum(host, "learning.pv_bias.corrected_tomorrow_kwh"),
        readLocalStr(host, "learning.pv_bias.status"),
        readBool(host, (0, governance_2.addonGovernanceAiAllowedState)("immersion_heater")),
    ]);
    const forecast = (0, thermal_forecast_1.resolveThermalForecastTarget)({
        config,
        bufferTempC,
        pvTodayKwh: pvToday,
        pvTomorrowKwh: pvTomorrow,
        pvBiasStatus: pvStatus,
        forecastModeEnabled: config.forecastModeEnabled,
        aiOptimizationAllowed: aiAllowed,
    });
    return { targetTempC: forecast.targetTempC, reasonDe: forecast.targetReasonDe };
}
async function applyStageWrites(host, stageIndex, live) {
    // Dryrun: EMS besitzt das Relais nicht — keine physischen Writes.
    if (!live)
        return;
    const governanceEnabled = await (0, governance_1.isAddonGovernanceEnabledFromState)((id) => host.getStateAsync(id), "immersion_heater");
    if (!governanceEnabled)
        return;
    const config = (0, device_config_1.immersionDeviceConfigFromAdapter)(host.config);
    for (const stage of config.stages) {
        if (!stage.setStateId)
            continue;
        const on = stage.index === stageIndex;
        if (!host.setForeignStateAsync)
            continue;
        try {
            const writeResult = await (0, device_write_1.writeForeignIfChanged)({
                getForeignStateAsync: (id) => host.getForeignStateAsync(id),
                setForeignStateAsync: async (id, state) => {
                    if (state && typeof state === "object" && "val" in state) {
                        await host.setForeignStateAsync(id, state);
                        return;
                    }
                    await host.setForeignStateAsync(id, { val: state ?? null, ack: false });
                },
                log: {
                    info: (m) => host.log.debug?.(m),
                    warn: (m) => host.log.warn?.(m),
                    error: (m) => host.log.error?.(m),
                    debug: (m) => host.log.debug?.(m),
                },
            }, {
                stateId: stage.setStateId,
                value: on,
                reason: `immersion stage ${stage.index}`,
            });
            if (writeResult.skipped) {
                host.log.debug?.(`immersion stage ${stage.index} already ${on ? "ON" : "OFF"} — skip`);
            }
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
    (0, ems_activity_1.touchEmsActivity)();
    if (!runtimeStatesEnsuredThisProcess) {
        await (0, ensure_states_1.ensureImmersionRuntimeStates)(host);
        runtimeStatesEnsuredThisProcess = true;
    }
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
    let powerObservedAtMs = null;
    if (config.actualPowerStateId) {
        try {
            const reader = host.getForeignStateAsync ?? host.getStateAsync;
            const powerSt = await reader(config.actualPowerStateId);
            powerObservedAtMs = powerSt?.ts ? new Date(powerSt.ts).getTime() : null;
        }
        catch {
            powerObservedAtMs = null;
        }
    }
    let autoDecisionSource = "thermal_fallback";
    let dailyPlanContext = null;
    let plannerCommandedStage = 0;
    const planTarget = await resolveImmersionPlanTarget(host, config, temperature.valueC, resolvedMode, forceTarget);
    let plannerTargetTempC = planTarget.targetTempC;
    if (resolvedMode === "auto") {
        dailyPlanContext = await (0, daily_plan_1.resolveImmersionDailyPlanAllocation)(host, config, now);
        lastDailyPlanContext = dailyPlanContext;
        if (dailyPlanContext.useDailyPlan) {
            // Daily Plan besitzt den Slot: Stufe aus Allocation (0 = absichtlich aus).
            // FSM-Ceiling = Forecast-Tagesziel (nicht pauschal planningMax).
            plannerCommandedStage = dailyPlanContext.commandedStage;
            plannerTargetTempC = planTarget.targetTempC;
            autoDecisionSource = "daily_plan";
        }
        else {
            // Daily Plan nicht verwendbar (missing/expired/wrong_date/…) — lokaler
            // Sicherheits-Default: nur die Pflicht-Untergrenze halten.
            const safeDefault = safeDefaultAutoTarget(config);
            plannerCommandedStage = safeDefault.stage;
            plannerTargetTempC = safeDefault.targetTempC;
            autoDecisionSource = "thermal_fallback";
        }
    }
    else if (resolvedMode === "force") {
        plannerTargetTempC = planTarget.targetTempC;
    }
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
        plannerCommandedStage,
        plannerTargetTempC,
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
        powerObservedAtMs,
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
    persist.autoTargetReached = fsm.autoTargetReached;
    const minRuntimeRem = persist.minRuntimeUntilMs ? Math.max(0, Math.ceil((persist.minRuntimeUntilMs - nowMs) / 1000)) : 0;
    const minPauseRem = persist.pauseUntilMs ? Math.max(0, Math.ceil((persist.pauseUntilMs - nowMs) / 1000)) : 0;
    const decisionSource = (0, daily_plan_1.resolveImmersionDecisionSource)(resolvedMode, failsafeActive, persist.faultLockout, fsm.state, autoDecisionSource);
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
        plan_target_temp_c: resolvedMode === "auto" && autoDecisionSource === "thermal_fallback"
            ? plannerTargetTempC
            : planTarget.targetTempC,
        plan_target_reason_de: resolvedMode === "auto" && autoDecisionSource === "thermal_fallback"
            ? `Sicherheits-Default ${plannerTargetTempC ?? config.planningMinTempC} °C (Daily Plan nicht nutzbar).`
            : planTarget.reasonDe,
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
    await publishRuntime(host, snapshot, decisionSource, dailyPlanContext);
    await (0, consumer_stats_1.tickConsumerStats)(host, {
        consumerKey: "immersion_heater",
        nowMs,
        deviceActive: effectiveStage > 0 && !persist.faultLockout,
        countable: effectiveStage > 0 && !persist.faultLockout,
        measuredPowerW: measuredPower,
        commandedPowerW: !persist.faultLockout && effectiveStage > 0 ? fsm.commandedPowerW : 0,
        powerOnThresholdW: config.powerOnThresholdW,
    });
    const dataDir = host.getAbsolutePath?.("immersion_heater");
    if (dataDir) {
        await (0, persist_1.writeRuntimePersist)(dataDir, persist);
    }
    scheduleTick();
}
exports.runImmersionRuntimeTick = runImmersionRuntimeTick;
async function publishRuntime(host, s, decisionSource, dailyPlan) {
    await (0, state_write_1.setStateIfChanged)(host, types_1.IMMERSION_RUNTIME_STATES.available, s.available);
    await (0, state_write_1.setStateIfChanged)(host, types_1.IMMERSION_RUNTIME_STATES.state, s.state);
    await (0, state_write_1.setStateIfChanged)(host, types_1.IMMERSION_RUNTIME_STATES.requestedMode, s.requested_mode);
    await (0, state_write_1.setStateIfChanged)(host, types_1.IMMERSION_RUNTIME_STATES.resolvedMode, s.resolved_mode);
    await (0, state_write_1.setStateIfChanged)(host, types_1.IMMERSION_RUNTIME_STATES.bufferTemperatureC, s.buffer_temperature_c ?? null);
    await (0, state_write_1.setStateIfChanged)(host, types_1.IMMERSION_RUNTIME_STATES.temperatureStatus, s.temperature_status);
    await (0, state_write_1.setStateIfChanged)(host, types_1.IMMERSION_RUNTIME_STATES.planningMinTempC, s.planning_min_temp_c);
    await (0, state_write_1.setStateIfChanged)(host, types_1.IMMERSION_RUNTIME_STATES.planningMaxTempC, s.planning_max_temp_c);
    await (0, state_write_1.setOptionalNumberIfChanged)(host, types_1.IMMERSION_RUNTIME_STATES.planTargetTempC, s.plan_target_temp_c);
    await (0, state_write_1.setStateIfChanged)(host, types_1.IMMERSION_RUNTIME_STATES.planTargetReasonDe, s.plan_target_reason_de || "");
    await (0, state_write_1.setStateIfChanged)(host, types_1.IMMERSION_RUNTIME_STATES.forceTargetTempC, s.force_target_temp_c ?? null);
    await (0, state_write_1.setStateIfChanged)(host, types_1.IMMERSION_RUNTIME_STATES.forceUntil, s.force_until ?? "");
    await (0, state_write_1.setStateIfChanged)(host, types_1.IMMERSION_RUNTIME_STATES.commandedStage, s.commanded_stage);
    await (0, state_write_1.setStateIfChanged)(host, types_1.IMMERSION_RUNTIME_STATES.commandedPowerW, s.commanded_power_w);
    await (0, state_write_1.setStateIfChanged)(host, types_1.IMMERSION_RUNTIME_STATES.feedbackStage, s.feedback_stage);
    await (0, state_write_1.setStateIfChanged)(host, types_1.IMMERSION_RUNTIME_STATES.measuredPowerW, s.measured_power_w ?? null);
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
    await (0, state_write_1.setStateIfChanged)(host, types_1.IMMERSION_RUNTIME_STATES.decisionSource, decisionSource);
    await (0, state_write_1.setStateIfChanged)(host, types_1.IMMERSION_RUNTIME_STATES.dailyPlanStatus, dailyPlan?.dailyPlanStatus ?? "daily_plan_missing");
    await (0, state_write_1.setStateIfChanged)(host, types_1.IMMERSION_RUNTIME_STATES.dailyPlanRevision, dailyPlan?.dailyPlanRevision ?? 0);
    await (0, state_write_1.setStateIfChanged)(host, types_1.IMMERSION_RUNTIME_STATES.dailyPlanSlotStart, dailyPlan?.slotStartIso ?? "");
    await (0, state_write_1.setStateIfChanged)(host, types_1.IMMERSION_RUNTIME_STATES.dailyPlanSlotEnd, dailyPlan?.slotEndIso ?? "");
    await (0, state_write_1.setStateIfChanged)(host, types_1.IMMERSION_RUNTIME_STATES.allocatedPowerW, dailyPlan?.allocatedPowerW ?? null);
    await (0, state_write_1.setStateIfChanged)(host, types_1.IMMERSION_RUNTIME_STATES.mandatoryAllocatedPowerW, dailyPlan?.mandatoryAllocatedPowerW ?? null);
    await (0, state_write_1.setStateIfChanged)(host, types_1.IMMERSION_RUNTIME_STATES.flexibleAllocatedPowerW, dailyPlan?.flexibleAllocatedPowerW ?? null);
    await (0, state_write_1.setStateIfChanged)(host, types_1.IMMERSION_RUNTIME_STATES.allocationStatus, dailyPlan?.allocationStatus ?? "unknown");
    await (0, state_write_1.setStateIfChanged)(host, types_1.IMMERSION_RUNTIME_STATES.allocationReasonDe, dailyPlan?.allocationReasonDe ?? "");
    const governanceOn = await (0, governance_1.isAddonGovernanceEnabledFromState)((id) => host.getStateAsync(id), "immersion_heater");
    const lockout = s.state === "fault_lockout" || decisionSource === "lockout";
    let intentStatus = "idle";
    if (s.fault_active || lockout || decisionSource === "safety") {
        intentStatus = "blocked";
    }
    else if (s.commanded_stage > 0) {
        intentStatus = "active";
    }
    else if (s.resolved_mode === "off") {
        intentStatus = "none";
    }
    let executionStatus = s.execution_mode === "live" ? "live" : "dryrun";
    if (s.fault_active) {
        executionStatus = "fault";
    }
    else if (lockout) {
        executionStatus = "lockout";
    }
    await (0, runtime_surface_1.publishAddonRuntimeSurface)(host, "immersion_heater", {
        decisionDetail: decisionSource,
        decisionReason: s.reason || dailyPlan?.allocationReasonDe || "",
        nowIso: s.updated_at,
        plannerStatus: (0, runtime_surface_1.plannerStatusFromDailyPlan)({
            governanceEnabled: governanceOn,
            useDailyPlan: dailyPlan?.useDailyPlan === true,
            dailyPlanStatus: dailyPlan?.dailyPlanStatus ?? null,
        }),
        intentStatus,
        executionStatus,
        profileReady: s.available === true,
        telemetryReady: s.temperature_status === "valid",
        fault: s.fault_active,
        lockout,
    });
}
async function handleImmersionFaultReset(host, state) {
    if (!state || state.val !== true)
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
        faultCode: persist.faultCode,
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
let immersionPersistHydrated = false;
/** Phase D — Heizstab-Runtime-Persistenz von Disk laden (ohne Subscriptions/Ticks). */
async function hydrateImmersionRuntimePersist(host) {
    if (immersionPersistHydrated) {
        return;
    }
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
    immersionPersistHydrated = true;
}
exports.hydrateImmersionRuntimePersist = hydrateImmersionRuntimePersist;
async function initImmersionRuntimeEngine(host) {
    // Ensure immer — auch bei erneutem Init nach Adapter-Update (neue States wie plan_target_*).
    await (0, ensure_states_1.ensureImmersionRuntimeStates)(host);
    runtimeStatesEnsuredThisProcess = true;
    if (engineActive && hostRef === host)
        return;
    engineActive = true;
    hostRef = host;
    await (0, consumer_stats_1.initConsumerStatsForAddon)(host, "immersion_heater");
    await hydrateImmersionRuntimePersist(host);
    const config = (0, device_config_1.immersionDeviceConfigFromAdapter)(host.config);
    const subs = new Set([
        "user_intent.thermal.resolved_json",
        types_1.IMMERSION_RUNTIME_STATES.faultReset,
        (0, tree_paths_1.addonEnabled)("immersion_heater"),
        (0, tree_paths_1.addonAvailable)("immersion_heater"),
        states_1.DAILY_PLAN_STATE_IDS.revision,
        states_1.DAILY_PLAN_STATE_IDS.status,
        states_1.ALLOCATION_ADDON_STATE_IDS.immersion_heater.planJson,
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
    host.log.debug?.("immersion_heater: runtime engine initialized");
}
exports.initImmersionRuntimeEngine = initImmersionRuntimeEngine;
function stopImmersionRuntimeEngine() {
    const host = hostRef;
    clearTick();
    if (host) {
        void (0, consumer_stats_1.flushConsumerStatsPersist)(host).catch((e) => host.log.debug?.(`immersion stats flush: ${e}`));
    }
    (0, consumer_stats_1.resetConsumerStatsCache)();
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
    immersionPersistHydrated = false;
    runtimeStatesEnsuredThisProcess = false;
    persist = (0, persist_1.emptyPersist)();
    lastCommandedStage = -1;
    lastDailyPlanContext = null;
    (0, daily_plan_1.resetImmersionDailyPlanCache)();
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
function getImmersionDailyPlanContextForTest() {
    return lastDailyPlanContext;
}
exports.getImmersionDailyPlanContextForTest = getImmersionDailyPlanContextForTest;
