"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.acRuntimeWatchedForeignIds = exports.stopAcRuntimeEngine = exports.initAcRuntimeEngine = exports.hydrateAcRuntimePersist = exports.runAcRuntimeTick = void 0;
const ems_activity_1 = require("../../../ems_activity");
const execution_mode_1 = require("../../../execution_mode");
const state_util_1 = require("../../../ems_light/state_util");
const state_write_1 = require("../../../policy/core/state_write");
const tree_paths_1 = require("../../../tree_paths");
const consumer_stats_1 = require("../../../learning/consumer_stats");
const governance_1 = require("../../../addons/governance");
const runtime_surface_1 = require("../../../addons/runtime_surface");
const states_1 = require("../../../operator/daily_plan/states");
const constants_1 = require("../constants");
const configured_1 = require("../configured");
const config_1 = require("../config");
const registry_1 = require("../profiles/registry");
const types_1 = require("../profiles/types");
const ensure_states_1 = require("./ensure_states");
const daily_plan_1 = require("./daily_plan");
const fsm_1 = require("./fsm");
const persist_1 = require("./persist");
const persist_io_1 = require("./persist_io");
const sequences_1 = require("./sequences");
const stats_active_1 = require("./stats_active");
const cleaning_1 = require("./cleaning");
const time_1 = require("./time");
let engineActive = false;
let hostRef = null;
let persist = { version: 1, units: {} };
let tickTimer = null;
let tickRunning = false;
const subscribedIds = [];
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
    const up = persist.units[index];
    if (up.lastModePurpose === undefined) {
        up.lastModePurpose = null;
    }
    return up;
}
function allocatedPowerW(runningCount, outdoorMax, unitEstimated) {
    if (runningCount <= 0)
        return 0;
    if (runningCount === 1)
        return unitEstimated;
    return Math.min(unitEstimated, Math.round(outdoorMax / runningCount));
}
function stopRetryReady(up, nowMs) {
    return !up.lastStopAtMs || nowMs - up.lastStopAtMs >= constants_1.AC_STOP_RETRY_MS;
}
function scheduleCleaningAfterStop(host, unit, up, nowMs, purpose) {
    if (!(0, config_1.acCleaningAfterPurpose)(unit, purpose) || up.cleaningActive) {
        return;
    }
    if (up.cleaningPendingUntilMs && up.cleaningPendingUntilMs > nowMs) {
        return;
    }
    // Abort/short cool runs must not trigger auto-clean (would loop with immediate re-stop).
    if (up.lastStartAtMs != null) {
        const coolRuntimeMs = nowMs - up.lastStartAtMs;
        if (coolRuntimeMs < constants_1.AC_CLEANING_MIN_COOL_RUNTIME_MS) {
            host.log.info(`ac unit ${unit.index}: cleaning skipped — cool run too short (${Math.round(coolRuntimeMs / 1000)}s < ${Math.round(constants_1.AC_CLEANING_MIN_COOL_RUNTIME_MS / 1000)}s)`);
            return;
        }
    }
    up.cleaningPendingUntilMs = nowMs + unit.cleaningDelayMin * 60_000;
    const at = new Date(up.cleaningPendingUntilMs).toLocaleTimeString("de-AT", { hour: "2-digit", minute: "2-digit" });
    const why = purpose ?? "unknown";
    host.log.info(`ac unit ${unit.index}: cleaning scheduled in ${unit.cleaningDelayMin} min (at ~${at}, after ${why})`);
}
async function waitForFeedbackOff(host, fbId) {
    if (!fbId) {
        return { off: false, value: null };
    }
    for (let attempt = 0; attempt < constants_1.AC_FEEDBACK_POLL_ATTEMPTS; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, constants_1.AC_FEEDBACK_POLL_MS));
        const fb = await readForeign(host, fbId);
        if ((0, time_1.switchIsOff)(fb.value)) {
            return { off: true, value: fb.value };
        }
    }
    const fb = await readForeign(host, fbId);
    return { off: (0, time_1.switchIsOff)(fb.value), value: fb.value };
}
async function waitForFeedbackOn(host, fbId) {
    if (!fbId) {
        return { on: false, value: null };
    }
    for (let attempt = 0; attempt < constants_1.AC_FEEDBACK_POLL_ATTEMPTS; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, constants_1.AC_FEEDBACK_POLL_MS));
        const fb = await readForeign(host, fbId);
        if ((0, time_1.switchIsOn)(fb.value)) {
            return { on: true, value: fb.value };
        }
    }
    const fb = await readForeign(host, fbId);
    return { on: (0, time_1.switchIsOn)(fb.value), value: fb.value };
}
async function stopUnit(host, unit, table, live, up) {
    const profile = (0, registry_1.getAcProfile)(unit.profileId);
    const steps = profile.coolingStopSequence?.() ?? [{ kind: "switch_off" }];
    host.log.info(`ac unit ${unit.index}: stop sequence starting (${live ? "live" : "dryrun"})`);
    await (0, sequences_1.executeAcWriteSteps)(host, unit.index, table, steps, live, host.log);
    up.lastStopAtMs = Date.now();
    if (!live) {
        up.running = false;
        const purpose = up.lastModePurpose;
        scheduleCleaningAfterStop(host, unit, up, up.lastStopAtMs, purpose);
        up.lastModePurpose = null;
        return;
    }
    const fbId = (0, sequences_1.resolveAcMappingTarget)(table, unit.index, "feedback_switch");
    // Sofort prüfen, dann kurze Poll-Schleife; bei Bedarf zweite Off-Welle.
    let fbValue = fbId ? (await readForeign(host, fbId)).value : null;
    if (fbId && (0, time_1.switchIsOn)(fbValue)) {
        fbValue = (await waitForFeedbackOff(host, fbId)).value;
    }
    if (fbId && (0, time_1.switchIsOn)(fbValue)) {
        host.log.warn(`ac unit ${unit.index}: still on after first stop — retry switch_off`);
        await (0, sequences_1.writeAcUnitSwitchOff)(host, unit.index, table, true, host.log);
        const refreshId = (0, sequences_1.resolveAcMappingTarget)(table, unit.index, "cmd_refresh");
        if (refreshId) {
            await (0, sequences_1.executeAcWriteSteps)(host, unit.index, table, [{ kind: "toggle", role: "cmd_refresh" }], true, host.log);
        }
        fbValue = (await waitForFeedbackOff(host, fbId)).value;
    }
    if (!fbId || (0, time_1.switchIsOff)(fbValue)) {
        up.running = false;
        host.log.info(`ac unit ${unit.index}: stop (live) — feedback ${fbId ? `off (${String(fbValue ?? "")})` : "unmapped"}`);
        const purpose = up.lastModePurpose;
        scheduleCleaningAfterStop(host, unit, up, up.lastStopAtMs, purpose);
        up.lastModePurpose = null;
    }
    else {
        up.running = true;
        host.log.warn(`ac unit ${unit.index}: stop sent but feedback still on (last=${String(fbValue ?? "")}) — check mapping cmd_switch_off/on → SmartThings switch; cleaning not scheduled`);
    }
}
async function applyModePurposeWhileRunning(host, unit, table, live, up, modePurpose) {
    if (up.lastModePurpose === modePurpose) {
        return;
    }
    const { mode, fanMode, fanSpeed } = (0, types_1.modeStringsForPurpose)(unit, modePurpose);
    if (!(0, config_1.acModeCommandEnabled)(mode)) {
        return;
    }
    const steps = [
        { kind: "set", role: "cmd_set_mode", value: mode },
        { kind: "set", role: "cmd_set_fan_mode", value: fanMode },
        ...(0, types_1.optionalStep)("cmd_set_fan_speed", fanSpeed),
    ];
    await (0, sequences_1.executeAcWriteSteps)(host, unit.index, table, steps, live, host.log);
    up.lastModePurpose = modePurpose;
    if (live) {
        host.log.info(`ac unit ${unit.index}: mode → ${modePurpose} (${mode})`);
    }
}
async function startUnit(host, unit, table, live, up, modePurpose) {
    const profile = (0, registry_1.getAcProfile)(unit.profileId);
    const steps = profile.coolingStartSequence(unit, modePurpose);
    await (0, sequences_1.executeAcWriteSteps)(host, unit.index, table, steps, live, host.log);
    up.lastStartAtMs = Date.now();
    up.lastModePurpose = modePurpose;
    if (!live) {
        up.running = true;
        return;
    }
    const fbId = (0, sequences_1.resolveAcMappingTarget)(table, unit.index, "feedback_switch");
    const fb = await waitForFeedbackOn(host, fbId);
    if (fb.on) {
        up.running = true;
        host.log.info(`ac unit ${unit.index}: started — feedback on`);
    }
    else {
        up.running = false;
        host.log.warn(`ac unit ${unit.index}: start sequence sent but feedback still off after ${Math.round((constants_1.AC_FEEDBACK_POLL_MS * constants_1.AC_FEEDBACK_POLL_ATTEMPTS) / 1000)}s (last=${String(fb.value ?? "")})`);
    }
}
async function finishCleaning(host, unit, table, live, up, reason, sendStop, allowWrite) {
    if (sendStop && live && allowWrite) {
        const profile = (0, registry_1.getAcProfile)(unit.profileId);
        await (0, sequences_1.executeAcWriteSteps)(host, unit.index, table, profile.cleaningStopSequence(), true, host.log);
    }
    up.cleaningActive = false;
    up.cleaningStartedAtMs = null;
    up.cleaningSawOperatingActive = false;
    up.cleaningSawProgressActive = false;
    up.cleaningStartProgressPct = null;
    up.cleaningLastRefreshAtMs = null;
    host.log.info(`ac unit ${unit.index}: cleaning finished — ${reason}`);
}
async function tickCleaning(host, unit, table, live, up, nowMs, cleaningStateRaw, cleaningModeRaw, cleaningProgressPct, allowNewCleaning, unitFeedbackOn) {
    const pending = up.cleaningPendingUntilMs;
    if (pending && nowMs >= pending && !up.cleaningActive) {
        if (!allowNewCleaning) {
            up.cleaningPendingUntilMs = null;
            host.log.debug?.(`ac unit ${unit.index}: cleaning skipped — governance/add-on block`);
            return;
        }
        // Gerät muss aus sein — sonst startet Samsung oft keine echte Reinigung, EMS-Flag hängt.
        if (unitFeedbackOn) {
            host.log.info(`ac unit ${unit.index}: cleaning waiting — unit still on`);
            return;
        }
        up.cleaningPendingUntilMs = null;
        const profile = (0, registry_1.getAcProfile)(unit.profileId);
        if (live) {
            await (0, sequences_1.executeAcWriteSteps)(host, unit.index, table, profile.cleaningStartSequence(), true, host.log);
            const refreshId = (0, sequences_1.resolveAcMappingTarget)(table, unit.index, "cmd_refresh");
            if (refreshId) {
                await (0, sequences_1.executeAcWriteSteps)(host, unit.index, table, [{ kind: "toggle", role: "cmd_refresh" }], true, host.log);
            }
            host.log.info(`ac unit ${unit.index}: cleaning started (live)`);
        }
        else {
            host.log.info(`ac unit ${unit.index}: cleaning started (dryrun)`);
        }
        up.cleaningActive = true;
        up.cleaningStartedAtMs = nowMs;
        up.cleaningSawOperatingActive = false;
        up.cleaningSawProgressActive = false;
        up.cleaningStartProgressPct = null;
        up.cleaningLastRefreshAtMs = nowMs;
    }
    if (!up.cleaningActive || !up.cleaningStartedAtMs) {
        return;
    }
    const cleaningWritesAllowed = live && (allowNewCleaning || up.cleaningActive);
    const stateFbId = (0, sequences_1.resolveAcMappingTarget)(table, unit.index, "feedback_cleaning_state");
    const modeFbId = (0, sequences_1.resolveAcMappingTarget)(table, unit.index, "feedback_cleaning_mode");
    const progressFbId = (0, sequences_1.resolveAcMappingTarget)(table, unit.index, "feedback_cleaning_progress");
    const hasCleaningFeedback = Boolean(stateFbId || modeFbId || progressFbId);
    const refreshId = (0, sequences_1.resolveAcMappingTarget)(table, unit.index, "cmd_refresh");
    const lastRefresh = up.cleaningLastRefreshAtMs ?? up.cleaningStartedAtMs;
    if (cleaningWritesAllowed && refreshId && nowMs - lastRefresh >= constants_1.AC_CLEANING_REFRESH_MS) {
        await (0, sequences_1.executeAcWriteSteps)(host, unit.index, table, [{ kind: "toggle", role: "cmd_refresh" }], true, host.log);
        up.cleaningLastRefreshAtMs = nowMs;
    }
    const elapsedSec = Math.round((nowMs - up.cleaningStartedAtMs) / 1000);
    if (hasCleaningFeedback) {
        if (up.cleaningStartProgressPct == null && cleaningProgressPct != null) {
            up.cleaningStartProgressPct = cleaningProgressPct;
        }
        if ((0, cleaning_1.shouldMarkCleaningOperatingActive)(cleaningStateRaw, elapsedSec)) {
            up.cleaningSawOperatingActive = true;
        }
        if ((0, cleaning_1.shouldMarkCleaningProgressActive)(cleaningProgressPct)) {
            up.cleaningSawProgressActive = true;
        }
        if ((0, cleaning_1.isCleaningStuckNeverEngaged)({
            operatingStateRaw: cleaningStateRaw,
            sawOperatingActive: up.cleaningSawOperatingActive,
            sawProgressActive: up.cleaningSawProgressActive,
            elapsedSec,
        })) {
            await finishCleaning(host, unit, table, live, up, `abort — never engaged (operatingState=${String(cleaningStateRaw ?? "?")}, unit=${unitFeedbackOn ? "on" : "off"}, ${elapsedSec}s)`, true, cleaningWritesAllowed);
            return;
        }
        if (progressFbId &&
            (0, cleaning_1.isCleaningFinishedByProgress)({
                progressPct: cleaningProgressPct,
                sawProgressActive: up.cleaningSawProgressActive,
                sawOperatingActive: up.cleaningSawOperatingActive,
                startProgressPct: up.cleaningStartProgressPct,
                elapsedSec,
            })) {
            await finishCleaning(host, unit, table, live, up, `feedback (progress=${cleaningProgressPct ?? "?"}%, ${elapsedSec}s)`, true, cleaningWritesAllowed);
            return;
        }
        if ((0, cleaning_1.isCleaningFinishedByFeedback)({
            operatingStateRaw: cleaningStateRaw,
            modeRaw: cleaningModeRaw,
            sawOperatingActive: up.cleaningSawOperatingActive,
            elapsedSec,
        })) {
            const op = String(cleaningStateRaw ?? "");
            const mode = String(cleaningModeRaw ?? "");
            await finishCleaning(host, unit, table, live, up, `feedback (operatingState=${op || "?"}, mode=${mode || "?"}, ${elapsedSec}s)`, true, cleaningWritesAllowed);
            return;
        }
    }
    else if ((0, cleaning_1.isCleaningStuckNeverEngaged)({
        operatingStateRaw: cleaningStateRaw,
        sawOperatingActive: false,
        sawProgressActive: false,
        elapsedSec,
    })) {
        // Kein Cleaning-Feedback gemappt — nach Stuck-Zeit Flag trotzdem freigeben.
        await finishCleaning(host, unit, table, live, up, `abort — no cleaning feedback mapped (${elapsedSec}s)`, false, cleaningWritesAllowed);
        return;
    }
    const timeoutMs = unit.cleaningDurationMin * 60_000;
    if (unit.cleaningDurationMin > 0 && nowMs >= up.cleaningStartedAtMs + timeoutMs) {
        await finishCleaning(host, unit, table, live, up, `timeout (${unit.cleaningDurationMin} min)`, true, cleaningWritesAllowed);
    }
}
async function runAcRuntimeTick(host) {
    if (tickRunning)
        return;
    tickRunning = true;
    try {
        await runAcRuntimeTickBody(host);
    }
    finally {
        tickRunning = false;
    }
}
exports.runAcRuntimeTick = runAcRuntimeTick;
async function runAcRuntimeTickBody(host) {
    (0, ems_activity_1.touchEmsActivity)();
    const now = new Date();
    const nowMs = now.getTime();
    const config = (0, config_1.acGlobalConfigFromAdapter)(host.config);
    const configRecord = host.config && typeof host.config === "object" ? host.config : {};
    const mappingTable = (0, sequences_1.buildAcMappingTableFromConfig)(configRecord);
    const addonOn = await host.getStateAsync((0, tree_paths_1.addonEnabled)(constants_1.AC_ADDON_ID));
    const addonEnabledVal = addonOn?.val !== false;
    const governanceEnabled = await (0, governance_1.isAddonGovernanceEnabledFromState)((id) => host.getStateAsync(id), "climate");
    const live = await (0, execution_mode_1.isLiveWriteAllowed)((id) => host.getStateAsync(id), constants_1.AC_ADDON_ID);
    const allowNewCleaning = governanceEnabled && addonEnabledVal;
    // Disabled units that still have objects (e.g. just turned off): close sticky stats / optional stop.
    // Unconfigured placeholders are not ensured and are removed by surface cleanup.
    for (const unit of config.units.filter((u) => !u.enabled)) {
        const ids = (0, ensure_states_1.acUnitRuntimeStates)(unit.index);
        const exists = await host.getStateAsync(ids.state);
        if (!exists) {
            continue;
        }
        const up = unitPersist(unit.index);
        const fbId = (0, sequences_1.resolveAcMappingTarget)(mappingTable, unit.index, "feedback_switch");
        const fb = await readForeign(host, fbId);
        if ((0, stats_active_1.closeAcUnitStatsSession)(up, nowMs)) {
            host.log.debug?.(`ac unit ${unit.index}: stats session closed (unit disabled in config)`);
        }
        if ((0, time_1.switchIsOn)(fb.value) && stopRetryReady(up, nowMs)) {
            await stopUnit(host, unit, mappingTable, live, up);
        }
        await (0, consumer_stats_1.tickConsumerStats)(host, {
            consumerKey: (0, constants_1.acUnitConsumerKey)(unit.index),
            nowMs,
            deviceActive: false,
            countable: false,
            measuredPowerW: null,
            commandedPowerW: 0,
        });
    }
    const activeUnits = config.units.filter((u) => u.enabled);
    let runningCount = 0;
    let anyDailyPlanActive = false;
    let maxDailyPlanRevision = 0;
    const summaryReasons = [];
    let primaryDecisionDetail = "safe_default";
    let anyTelemetryReady = false;
    let anyFault = false;
    let anyLockout = false;
    for (const unit of activeUnits) {
        const tempId = (0, sequences_1.resolveAcMappingTarget)(mappingTable, unit.index, "room_temp");
        const humId = (0, sequences_1.resolveAcMappingTarget)(mappingTable, unit.index, "room_humidity");
        const fbId = (0, sequences_1.resolveAcMappingTarget)(mappingTable, unit.index, "feedback_switch");
        const cleaningStateId = (0, sequences_1.resolveAcMappingTarget)(mappingTable, unit.index, "feedback_cleaning_state");
        const cleaningModeId = (0, sequences_1.resolveAcMappingTarget)(mappingTable, unit.index, "feedback_cleaning_mode");
        const cleaningProgressId = (0, sequences_1.resolveAcMappingTarget)(mappingTable, unit.index, "feedback_cleaning_progress");
        const temp = await readForeign(host, tempId);
        const hum = await readForeign(host, humId);
        const fb = await readForeign(host, fbId);
        const cleaningState = await readForeign(host, cleaningStateId);
        const cleaningMode = await readForeign(host, cleaningModeId);
        const cleaningProgress = await readForeign(host, cleaningProgressId);
        const up = unitPersist(unit.index);
        if ((0, time_1.switchIsOn)(fb.value))
            runningCount += 1;
        await tickCleaning(host, unit, mappingTable, live, up, nowMs, cleaningState.value, cleaningMode.value, cleaningProgress.num, allowNewCleaning, (0, time_1.switchIsOn)(fb.value));
        // Cleaning-Flag sperrt FSM-Stop — Gerät trotzdem ausschalten, sonst Deadlock.
        if (up.cleaningActive &&
            (0, time_1.switchIsOn)(fb.value) &&
            stopRetryReady(up, nowMs) &&
            live &&
            governanceEnabled &&
            addonEnabledVal) {
            host.log.info(`ac unit ${unit.index}: stop while cleaning flag set (device still on)`);
            await stopUnit(host, unit, mappingTable, true, up);
        }
        if (!addonEnabledVal && (0, time_1.switchIsOn)(fb.value) && stopRetryReady(up, nowMs)) {
            await stopUnit(host, unit, mappingTable, live, up);
        }
        const fsm = (0, fsm_1.evaluateAcUnitFsm)({
            now,
            addonEnabled: addonEnabledVal && governanceEnabled,
            unit,
            roomTempC: temp.num,
            roomHumidityPct: hum.num,
            feedbackSwitchRaw: fb.value,
            cleaningActive: up.cleaningActive,
        });
        const consumerStats = await (0, consumer_stats_1.peekConsumerStatsEntry)(host, (0, constants_1.acUnitConsumerKey)(unit.index));
        const dailyPlan = await (0, daily_plan_1.resolveAcUnitDailyPlanAllocation)(host, unit, consumerStats, now);
        if (dailyPlan.useDailyPlan) {
            anyDailyPlanActive = true;
            if (dailyPlan.dailyPlanRevision !== null) {
                maxDailyPlanRevision = Math.max(maxDailyPlanRevision, dailyPlan.dailyPlanRevision);
            }
        }
        const startRetryReady = !up.lastStartAtMs || nowMs - up.lastStartAtMs >= constants_1.AC_START_RETRY_MS;
        const permission = (0, daily_plan_1.evaluateAcCoolingPermission)({
            unitEnabled: unit.enabled,
            governanceEnabled,
            addonEnabled: addonEnabledVal,
            cleaningActive: up.cleaningActive,
            fsm,
            dailyPlan,
            startRetryReady,
            stopRetryReady: stopRetryReady(up, nowMs),
        });
        if (permission.allowStop) {
            if ((0, time_1.switchIsOn)(fb.value)) {
                if (stopRetryReady(up, nowMs)) {
                    if (up.lastStopAtMs) {
                        host.log.info(`ac unit ${unit.index}: retry stop (${Math.round((nowMs - up.lastStopAtMs) / 1000)}s since last attempt)`);
                    }
                    await stopUnit(host, unit, mappingTable, live && permission.deviceWritesAllowed, up);
                }
            }
            else {
                up.running = false;
            }
        }
        else if (fsm.demandStop) {
            // Governance blockiert Stop-Writes — laufende Unit nicht blind abschalten.
        }
        else if (permission.allowStart && (0, time_1.switchIsOff)(fb.value)) {
            if (live) {
                if (startRetryReady) {
                    if (up.lastStartAtMs) {
                        host.log.info(`ac unit ${unit.index}: retry start (${Math.round((nowMs - up.lastStartAtMs) / 1000)}s since last attempt)`);
                    }
                    await startUnit(host, unit, mappingTable, live && permission.deviceWritesAllowed, up, fsm.modePurpose);
                }
            }
            else if (!up.running) {
                await startUnit(host, unit, mappingTable, false, up, fsm.modePurpose);
            }
        }
        else if ((0, time_1.switchIsOn)(fb.value) &&
            !fsm.demandStop &&
            !up.cleaningActive &&
            permission.deviceWritesAllowed) {
            await applyModePurposeWhileRunning(host, unit, mappingTable, live, up, fsm.modePurpose);
        }
        summaryReasons.push(`U${unit.index}: ${permission.reasonDe}`);
        if (primaryDecisionDetail === "safe_default") {
            primaryDecisionDetail = permission.decisionSource;
        }
        if (temp.num != null) {
            anyTelemetryReady = true;
        }
        if (permission.decisionSource === "fault") {
            anyFault = true;
        }
        if (permission.decisionSource === "lockout") {
            anyLockout = true;
        }
        if ((0, time_1.switchIsOn)(fb.value)) {
            up.running = true;
        }
        else if (live && (0, time_1.switchIsOff)(fb.value)) {
            up.running = false;
        }
        const ids = (0, ensure_states_1.acUnitRuntimeStates)(unit.index);
        const fbOn = (0, time_1.switchIsOn)(fb.value);
        const deviceActive = (0, stats_active_1.acStatsDeviceActive)(up, fbOn, up.running, nowMs);
        // Live + feedback off: do not keep a forever-open stats session after the start grace.
        if (!fbOn && !deviceActive && up.lastStartAtMs && (up.lastStopAtMs == null || up.lastStopAtMs < up.lastStartAtMs)) {
            (0, stats_active_1.closeAcUnitStatsSession)(up, nowMs);
        }
        const estPower = deviceActive
            ? allocatedPowerW(runningCount || 1, config.outdoorMaxPowerW, (0, config_1.acEstimatedPowerForPurpose)(unit, fsm.modePurpose))
            : 0;
        await (0, state_write_1.setStateIfChanged)(host, ids.name, unit.name);
        await (0, state_write_1.setStateIfChanged)(host, ids.state, fsm.state);
        await (0, state_write_1.setStateIfChanged)(host, ids.reasonDe, permission.reasonDe);
        await (0, state_write_1.setStateIfChanged)(host, ids.roomTempC, temp.num ?? null);
        await (0, state_write_1.setStateIfChanged)(host, ids.roomHumidityPct, hum.num ?? null);
        await (0, state_write_1.setStateIfChanged)(host, ids.feedbackSwitch, fb.value == null ? "" : String(fb.value));
        await (0, state_write_1.setStateIfChanged)(host, ids.running, fbOn);
        await (0, state_write_1.setStateIfChanged)(host, ids.cleaningActive, up.cleaningActive);
        await (0, state_write_1.setStateIfChanged)(host, ids.feedbackCleaningState, cleaningState.value == null ? "" : String(cleaningState.value));
        await (0, state_write_1.setStateIfChanged)(host, ids.feedbackCleaningMode, cleaningMode.value == null ? "" : String(cleaningMode.value));
        await (0, state_write_1.setStateIfChanged)(host, ids.feedbackCleaningProgressPct, cleaningProgress.num ?? null);
        await (0, state_write_1.setStateIfChanged)(host, ids.modePurpose, fsm.modePurpose);
        await (0, state_write_1.setStateIfChanged)(host, ids.estimatedPowerW, estPower);
        await (0, state_write_1.setStateIfChanged)(host, ids.decisionSource, permission.decisionSource);
        await (0, state_write_1.setStateIfChanged)(host, ids.dailyPlanStatus, dailyPlan.dailyPlanStatus);
        await (0, state_write_1.setStateIfChanged)(host, ids.dailyPlanRevision, dailyPlan.dailyPlanRevision ?? 0);
        await (0, state_write_1.setStateIfChanged)(host, ids.dailyPlanSlotStart, dailyPlan.slotStartIso ?? "");
        await (0, state_write_1.setStateIfChanged)(host, ids.dailyPlanSlotEnd, dailyPlan.slotEndIso ?? "");
        await (0, state_write_1.setStateIfChanged)(host, ids.allocatedPowerW, dailyPlan.allocatedPowerW ?? null);
        await (0, state_write_1.setStateIfChanged)(host, ids.expectedPowerW, dailyPlan.expectedPowerW ?? null);
        await (0, state_write_1.setStateIfChanged)(host, ids.powerModelSource, dailyPlan.powerModelSource);
        await (0, state_write_1.setStateIfChanged)(host, ids.allocationStatus, dailyPlan.allocationStatus);
        await (0, state_write_1.setStateIfChanged)(host, ids.allocationReasonDe, dailyPlan.allocationReasonDe);
        await (0, state_write_1.setStateIfChanged)(host, ids.governanceAllowed, governanceEnabled);
        await (0, consumer_stats_1.tickConsumerStats)(host, {
            consumerKey: (0, constants_1.acUnitConsumerKey)(unit.index),
            nowMs,
            deviceActive,
            countable: deviceActive,
            measuredPowerW: null,
            commandedPowerW: estPower,
        });
    }
    await (0, state_write_1.setStateIfChanged)(host, `${ensure_states_1.AC_RUNTIME_BASE}.outdoor_allocated_power_w`, config.outdoorMaxPowerW);
    await (0, state_write_1.setStateIfChanged)(host, ensure_states_1.AC_RUNTIME_SUMMARY_STATES.governanceAllowed, governanceEnabled);
    await (0, state_write_1.setStateIfChanged)(host, ensure_states_1.AC_RUNTIME_SUMMARY_STATES.dailyPlanActive, anyDailyPlanActive);
    await (0, state_write_1.setStateIfChanged)(host, ensure_states_1.AC_RUNTIME_SUMMARY_STATES.dailyPlanRevision, maxDailyPlanRevision);
    const summaryReason = !governanceEnabled
        ? "Klima-Governance deaktiviert — keine EMS-Steueraktion."
        : summaryReasons.slice(0, 3).join(" | ") || "Klima Runtime aktiv.";
    await (0, state_write_1.setStateIfChanged)(host, ensure_states_1.AC_RUNTIME_SUMMARY_STATES.reasonDe, summaryReason);
    const decisionDetail = !governanceEnabled
        ? "governance_disabled"
        : !addonEnabledVal
            ? "unit_disabled"
            : primaryDecisionDetail;
    let intentStatus = "idle";
    if (!governanceEnabled || !addonEnabledVal) {
        intentStatus = "none";
    }
    else if (anyFault || anyLockout) {
        intentStatus = "blocked";
    }
    else if (runningCount > 0 || anyDailyPlanActive) {
        intentStatus = "active";
    }
    let executionStatus = live ? "live" : "dryrun";
    if (anyFault) {
        executionStatus = "fault";
    }
    else if (anyLockout) {
        executionStatus = "lockout";
    }
    await (0, runtime_surface_1.publishAddonRuntimeSurface)(host, constants_1.AC_ADDON_ID, {
        decisionDetail,
        decisionReason: summaryReason,
        nowIso: new Date(nowMs).toISOString(),
        plannerStatus: (0, runtime_surface_1.plannerStatusFromDailyPlan)({
            governanceEnabled: governanceEnabled && addonEnabledVal,
            useDailyPlan: anyDailyPlanActive,
            dailyPlanValid: anyDailyPlanActive,
            dailyPlanStatus: anyDailyPlanActive ? "valid" : "missing",
        }),
        intentStatus,
        executionStatus,
        profileReady: (0, configured_1.configuredAcUnitIndexes)(host.config).length > 0,
        telemetryReady: anyTelemetryReady || activeUnits.length === 0,
        fault: anyFault,
        lockout: anyLockout,
    });
    const dataDir = host.getAbsolutePath?.("air_conditioning");
    if (dataDir) {
        await (0, persist_io_1.writeAcRuntimePersist)(dataDir, persist);
    }
    scheduleTick();
}
let acPersistHydrated = false;
/** Phase D — Klima-Runtime-Persistenz von Disk laden (ohne Subscriptions/Ticks). */
async function hydrateAcRuntimePersist(host) {
    if (acPersistHydrated) {
        return;
    }
    const dataDir = host.getAbsolutePath?.("air_conditioning");
    if (dataDir) {
        persist = await (0, persist_io_1.readAcRuntimePersist)(dataDir);
    }
    acPersistHydrated = true;
}
exports.hydrateAcRuntimePersist = hydrateAcRuntimePersist;
async function initAcRuntimeEngine(host) {
    if (engineActive && hostRef === host)
        return;
    engineActive = true;
    hostRef = host;
    await (0, ensure_states_1.ensureAcRuntimeStates)(host);
    for (const i of (0, configured_1.configuredAcUnitIndexes)(host.config)) {
        await (0, consumer_stats_1.initConsumerStatsForKey)(host, (0, constants_1.acUnitConsumerKey)(i));
    }
    await hydrateAcRuntimePersist(host);
    const cfg = (0, config_1.acGlobalConfigFromAdapter)(host.config);
    const configRecord = host.config && typeof host.config === "object" ? host.config : {};
    const mappingTable = (0, sequences_1.buildAcMappingTableFromConfig)(configRecord);
    const subs = new Set([
        (0, tree_paths_1.addonEnabled)(constants_1.AC_ADDON_ID),
        (0, tree_paths_1.addonAvailable)(constants_1.AC_ADDON_ID),
        (0, governance_1.addonGovernanceEnabledState)("climate"),
        states_1.DAILY_PLAN_STATE_IDS.revision,
        states_1.DAILY_PLAN_STATE_IDS.status,
        states_1.ALLOCATION_ADDON_STATE_IDS.air_conditioning.planJson,
    ]);
    if (host.subscribeStatesAsync) {
        for (const id of subs) {
            if (subscribedIds.includes(id))
                continue;
            await host.subscribeStatesAsync(id);
            subscribedIds.push(id);
        }
    }
    for (const unit of cfg.units.filter((u) => u.enabled)) {
        for (const role of constants_1.AC_WATCH_MAPPING_ROLES) {
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
    acPersistHydrated = false;
    subscribedIds.length = 0;
    (0, daily_plan_1.resetAcDailyPlanCache)();
}
exports.stopAcRuntimeEngine = stopAcRuntimeEngine;
function acRuntimeWatchedForeignIds(config) {
    const configRecord = config && typeof config === "object" ? config : {};
    const mappingTable = (0, sequences_1.buildAcMappingTableFromConfig)(configRecord);
    const cfg = (0, config_1.acGlobalConfigFromAdapter)(config);
    const ids = [];
    for (const unit of cfg.units.filter((u) => u.enabled)) {
        for (const role of constants_1.AC_WATCH_MAPPING_ROLES) {
            const id = (0, sequences_1.resolveAcMappingTarget)(mappingTable, unit.index, role);
            if (id)
                ids.push(id);
        }
    }
    return ids;
}
exports.acRuntimeWatchedForeignIds = acRuntimeWatchedForeignIds;
