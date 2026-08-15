"use strict";
/**
 * One EV-execution tick: desired → authority → gates → machine → optional button write.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.evExecutionBooted = exports.tickEvExecution = exports.peekEvLiveTestState = exports.peekEvExecutionSession = exports.replaceEvLiveTestState = exports.replaceEvExecutionSession = exports.resetEvExecutionSession = void 0;
const barrier_1 = require("../../../../restore/barrier");
const execution_mode_1 = require("../../../../execution_mode");
const tree_paths_1 = require("../../../../tree_paths");
const state_write_1 = require("../../../../policy/core/state_write");
const evcc_config_1 = require("../../evcc_config");
const evcc_mode_control_1 = require("../../evcc_mode_control");
const evcc_button_trigger_1 = require("../../runtime/evcc_button_trigger");
const authority_1 = require("../decision/authority");
const write_allowlist_1 = require("../write_allowlist");
const ensure_states_1 = require("../ensure_states");
const authority_2 = require("./authority");
const desired_mode_1 = require("./desired_mode");
const freshness_1 = require("./freshness");
const gates_1 = require("./gates");
const machine_1 = require("./machine");
const ownership_1 = require("./ownership");
const live_test_1 = require("./live_test");
const types_1 = require("./types");
const write_1 = require("./write");
let session = (0, types_1.emptyEvExecutionSession)();
let liveTest = (0, live_test_1.emptyEvLiveTestState)();
let booted = false;
function resetEvExecutionSession() {
    session = (0, types_1.emptyEvExecutionSession)();
    liveTest = (0, live_test_1.emptyEvLiveTestState)();
    booted = false;
}
exports.resetEvExecutionSession = resetEvExecutionSession;
/** Test helper — never used to reconstruct ownership after a real restart. */
function replaceEvExecutionSession(next) {
    session = next;
}
exports.replaceEvExecutionSession = replaceEvExecutionSession;
function replaceEvLiveTestState(next) {
    liveTest = next;
}
exports.replaceEvLiveTestState = replaceEvLiveTestState;
function peekEvExecutionSession() {
    return session;
}
exports.peekEvExecutionSession = peekEvExecutionSession;
function peekEvLiveTestState() {
    return liveTest;
}
exports.peekEvLiveTestState = peekEvLiveTestState;
function isoOrEmpty(ms) {
    if (ms == null || !Number.isFinite(ms))
        return "";
    return new Date(ms).toISOString();
}
async function publishSession(host, s, extra) {
    const st = ensure_states_1.WALLBOX_EV_FOUNDATION_STATES;
    await (0, state_write_1.setStateIfChanged)(host, st.evExecutionEnabled, extra.enabled);
    await (0, state_write_1.setStateIfChanged)(host, st.evExecutionAuthority, s.authority);
    await (0, state_write_1.setStateIfChanged)(host, st.evExecutionReady, extra.ready);
    await (0, state_write_1.setStateIfChanged)(host, st.evExecutionBlockReason, s.blockReason);
    await (0, state_write_1.setStateIfChanged)(host, st.evExecutionDesiredMode, extra.desired ?? "");
    await (0, state_write_1.setStateIfChanged)(host, st.evExecutionDesiredReason, s.desiredReason);
    await (0, state_write_1.setStateIfChanged)(host, st.evExecutionActualMode, extra.actual ?? "");
    await (0, state_write_1.setStateIfChanged)(host, st.evExecutionSourceFresh, s.sourceFresh);
    await (0, state_write_1.setStateIfChanged)(host, st.evExecutionOwnership, s.ownership);
    await (0, state_write_1.setStateIfChanged)(host, st.evExecutionOwnedMode, s.ownedMode ?? "");
    await (0, state_write_1.setStateIfChanged)(host, st.evExecutionOwnedSince, isoOrEmpty(s.ownedSinceMs));
    await (0, state_write_1.setStateIfChanged)(host, st.evExecutionReleaseReason, s.releaseReason);
    await (0, state_write_1.setStateIfChanged)(host, st.evExecutionPendingMode, s.pendingMode ?? "");
    await (0, state_write_1.setStateIfChanged)(host, st.evExecutionPendingSince, isoOrEmpty(s.pendingSinceMs));
    await (0, state_write_1.setStateIfChanged)(host, st.evExecutionLastCommand, s.lastCommand ?? "");
    await (0, state_write_1.setStateIfChanged)(host, st.evExecutionLastCommandAt, isoOrEmpty(s.lastCommandAtMs));
    await (0, state_write_1.setStateIfChanged)(host, st.evExecutionLastFeedbackAt, isoOrEmpty(s.lastFeedbackAtMs));
    await (0, state_write_1.setStateIfChanged)(host, st.evExecutionRetryCount, s.retryCount);
    await (0, state_write_1.setStateIfChanged)(host, st.evExecutionLastResult, s.lastResult);
    await (0, state_write_1.setStateIfChanged)(host, st.evExecutionFailsafeReason, s.failsafeReason);
    await (0, state_write_1.setStateIfChanged)(host, st.evExecutionPhase, s.phase);
    await (0, state_write_1.setStateIfChanged)(host, st.evExecutionExplain, s.explain);
    await (0, state_write_1.setStateIfChanged)(host, st.evExecutionLiveTestConsumed, liveTest.consumed);
    await (0, state_write_1.setStateIfChanged)(host, st.evExecutionLiveTestArmedAt, isoOrEmpty(liveTest.armedAtMs));
    await (0, state_write_1.setStateIfChanged)(host, st.evExecutionLiveTestConsumedAt, isoOrEmpty(liveTest.consumedAtMs));
    await (0, state_write_1.setStateIfChanged)(host, st.evExecutionLiveTestCommand, liveTest.command ?? "");
    await (0, state_write_1.setStateIfChanged)(host, st.evExecutionLiveTestResult, liveTest.result);
    await (0, state_write_1.setStateIfChanged)(host, st.evExecutionLiveTestBlockReason, liveTest.blockReason);
}
async function readModeFeedback(host, stateId, snapMode) {
    if (!stateId) {
        return { raw: snapMode, tsMs: null, missing: snapMode == null, invalid: false };
    }
    try {
        const st = host.getForeignStateAsync
            ? await host.getForeignStateAsync(stateId)
            : await host.getStateAsync(stateId);
        if (!st || st.val === undefined || st.val === null || String(st.val).trim() === "") {
            return { raw: snapMode, tsMs: typeof st?.ts === "number" ? st.ts : null, missing: snapMode == null, invalid: false };
        }
        const raw = String(st.val);
        const tsMs = typeof st.ts === "number" && Number.isFinite(st.ts) ? st.ts : typeof st.lc === "number" ? st.lc : null;
        const normalized = (0, evcc_button_trigger_1.normalizeEvccFeedbackMode)(raw);
        return { raw, tsMs, missing: false, invalid: normalized == null };
    }
    catch {
        return { raw: snapMode, tsMs: null, missing: snapMode == null, invalid: false };
    }
}
async function readStateTs(host, stateId) {
    if (!stateId)
        return null;
    try {
        const st = host.getForeignStateAsync
            ? await host.getForeignStateAsync(stateId)
            : await host.getStateAsync(stateId);
        if (!st)
            return null;
        if (typeof st.ts === "number" && Number.isFinite(st.ts))
            return st.ts;
        if (typeof st.lc === "number" && Number.isFinite(st.lc))
            return st.lc;
        return null;
    }
    catch {
        return null;
    }
}
async function tickEvExecution(host, input) {
    const nowMs = input.nowMs;
    const contract = (0, evcc_mode_control_1.resolveEvccModeControlContract)(host.config ?? {});
    const projection = (0, desired_mode_1.projectDesiredEvccMode)({
        intentAction: input.intent.action,
        energySource: input.intent.source !== "none" ? input.intent.source : input.planDecision.energySource,
        chargingAllowed: input.planDecision.chargingAllowedByPlan,
        allocatedPowerW: input.planDecision.allocatedPowerW,
        dailyPlanStatus: input.planDecision.dailyPlanStatus,
        decisionSource: input.planDecision.decisionSource,
        planValid: input.planDecision.planValid,
        useDailyPlan: input.planDecision.useDailyPlan,
    });
    const snapMode = input.snap.loadpoint_mode.status === "valid" ? input.snap.loadpoint_mode.value : null;
    const fb = await readModeFeedback(host, contract.modeFeedbackStateId, snapMode);
    const actual = (0, evcc_button_trigger_1.normalizeEvccFeedbackMode)(fb.raw);
    const telCfg = (0, evcc_config_1.wallboxEvccTelemetryConfigFromAdapter)(host.config ?? {});
    const heartbeatIds = [
        telCfg.chargePowerWStateId,
        telCfg.chargingStateId,
        telCfg.connectedStateId,
        telCfg.offeredCurrentAStateId,
    ].filter((id) => id.length > 0);
    const heartbeatTs = (0, freshness_1.maxFiniteTs)(await Promise.all(heartbeatIds.map((id) => readStateTs(host, id))));
    const source = (0, freshness_1.evaluateEvccSourceFreshness)({
        connectionValue: input.snap.connection.status === "valid" ? input.snap.connection.value : null,
        connectionKnown: input.snap.connection.status === "valid",
        heartbeatTsMs: heartbeatTs,
        heartbeatConfigured: heartbeatIds.length > 0,
        nowMs,
    });
    const globalSt = await host.getStateAsync(tree_paths_1.GLOBAL.executionMode);
    const addonModeSt = await host.getStateAsync((0, tree_paths_1.addonMode)("wallbox"));
    const addonEnSt = await host.getStateAsync((0, tree_paths_1.addonEnabled)("wallbox"));
    const globalLive = (0, execution_mode_1.parseGlobalMode)(globalSt?.val) === "live";
    const addonLive = (0, execution_mode_1.parseAddonMode)(addonModeSt?.val) === "live";
    const addonEnabledVal = addonEnSt?.val !== false && input.addonEnabled;
    const liveAllowed = await (0, execution_mode_1.isLiveWriteAllowed)((id) => host.getStateAsync(id), "wallbox");
    const stIds = ensure_states_1.WALLBOX_EV_FOUNDATION_STATES;
    if (!booted) {
        liveTest = (0, live_test_1.emptyEvLiveTestState)();
        await host.setStateAsync(stIds.evExecutionLiveTestArmed, { val: false, ack: true });
        await host.setStateAsync(stIds.evExecutionLiveTestDisarm, { val: false, ack: true });
    }
    else {
        const armSt = await host.getStateAsync(stIds.evExecutionLiveTestArmed);
        const disarmSt = await host.getStateAsync(stIds.evExecutionLiveTestDisarm);
        const before = liveTest;
        liveTest = (0, live_test_1.applyEvLiveTestOperatorInputs)({
            prev: liveTest,
            armedVal: armSt?.val,
            armedAck: armSt?.ack,
            disarmVal: disarmSt?.val,
            nowMs,
        });
        if (disarmSt?.val === true) {
            await host.setStateAsync(stIds.evExecutionLiveTestDisarm, { val: false, ack: true });
        }
        if (armSt?.val === true && armSt.ack === false && liveTest.armed) {
            await host.setStateAsync(stIds.evExecutionLiveTestArmed, { val: true, ack: true });
        }
        else if (armSt?.val === false && armSt.ack === false) {
            await host.setStateAsync(stIds.evExecutionLiveTestArmed, { val: false, ack: true });
        }
        else if (before.armed && !liveTest.armed && !liveTest.consumed) {
            await host.setStateAsync(stIds.evExecutionLiveTestArmed, { val: false, ack: true });
        }
    }
    const stabilized = (0, authority_2.stabilizeExecutionAuthority)({
        raw: input.model.externalAuthorityState,
        externalExpected: (0, authority_1.externalControlExpected)(input.model),
        prevAuthority: session.authority,
        lastExternalHoldAtMs: session.lastExternalHoldAtMs,
        lastInactiveSinceMs: session.lastInactiveSinceMs,
        nowMs,
    });
    session = {
        ...session,
        authority: stabilized.authority,
        lastExternalHoldAtMs: stabilized.lastExternalHoldAtMs,
        lastInactiveSinceMs: stabilized.lastInactiveSinceMs,
        sourceFresh: source.fresh,
    };
    session = (0, ownership_1.dropExecutionOwnership)(session, {
        authority: stabilized.authority,
        actualMode: actual,
    });
    const resolved = (0, ownership_1.resolveDesiredWithOwnership)({
        projection,
        ownership: session.ownership,
        ownedMode: session.ownedMode,
        planValid: input.planDecision.planValid,
        useDailyPlan: input.planDecision.useDailyPlan,
        authority: stabilized.authority,
    });
    const desired = resolved.desired;
    if (resolved.action === "release_off") {
        session.releaseReason = "release_off";
    }
    session.desiredReason = resolved.reason;
    const pendingActive = session.pendingMode != null &&
        (session.phase === "command_sent" || session.phase === "awaiting_feedback" || session.phase === "retry");
    const livePermit = (0, live_test_1.evaluateEvLiveTestPermit)({
        liveTest,
        desiredMode: desired,
        pendingMode: session.pendingMode,
        pendingActive,
    });
    liveTest = { ...liveTest, blockReason: livePermit.blockReason };
    const gates = (0, gates_1.evaluateEvExecutionGates)({
        featureEnabled: write_allowlist_1.EV_EXECUTION_PHASE5_ENABLED,
        globalLive: globalLive && liveAllowed === true ? true : globalLive,
        addonLive,
        addonEnabled: addonEnabledVal,
        governanceEnabled: input.governanceEnabled,
        authority: stabilized.authority,
        authorityFailsafeReason: stabilized.failsafeReason,
        buttonsReady: contract.buttonsReady,
        resolvedVariant: contract.resolvedVariant,
        desiredMode: desired,
        actualMissing: fb.missing || actual == null,
        actualInvalid: fb.invalid,
        sourceStale: source.reason === "evcc_source_stale",
        sourceOffline: source.reason === "evcc_source_offline",
        faultActive: input.faultActive,
        restoreInProgress: (0, barrier_1.isRestoreInProgress)(),
        liveTestPermit: livePermit.permit,
        liveTestBlockReason: livePermit.blockReason === "live_test_not_armed" || !livePermit.blockReason
            ? "feature_gate"
            : livePermit.blockReason,
    });
    const writeAllowed = gates.writeAllowed && liveAllowed;
    if (!liveTest.consumed && liveTest.armed && !writeAllowed && gates.blockReason) {
        liveTest = { ...liveTest, blockReason: gates.blockReason };
    }
    const stepped = (0, machine_1.stepEvExecution)(session, {
        nowMs,
        desiredMode: desired,
        actualMode: actual,
        writeAllowed,
        blockReason: gates.blockReason,
        failsafeReason: gates.failsafeReason,
        authorityIsEms: stabilized.authority === "ems",
        modeTsMs: fb.tsMs,
        desiredReason: resolved.reason,
        retriesBlocked: liveTest.retriesBlocked,
    });
    session = stepped.session;
    session.sourceFresh = source.fresh;
    session.desiredReason = resolved.reason;
    if (liveTest.consumed) {
        if (session.phase === "confirmed" && session.lastResult === "confirmed") {
            liveTest = (0, live_test_1.markEvLiveTestResult)(liveTest, "feedback_confirmed");
        }
        else if (session.phase === "failsafe" || session.failsafeReason) {
            liveTest = (0, live_test_1.markEvLiveTestResult)(liveTest, "feedback_failed");
        }
        else if (session.phase === "awaiting_feedback" ||
            session.phase === "command_sent" ||
            session.phase === "retry") {
            liveTest = (0, live_test_1.markEvLiveTestResult)(liveTest, "awaiting_feedback");
        }
    }
    session.explain = (0, gates_1.formatEvExecutionExplain)({
        desired,
        actual,
        authority: session.authority,
        phase: session.phase,
        blockReason: session.blockReason || gates.blockReason,
        failsafeReason: session.failsafeReason || gates.failsafeReason,
        writeAllowed,
        desiredReason: resolved.reason,
        sourceFresh: source.fresh,
        ownership: session.ownership,
        ownedMode: session.ownedMode,
        releaseReason: session.releaseReason,
        action: resolved.action,
        liveTestArmed: liveTest.armed,
        liveTestConsumed: liveTest.consumed,
        liveTestCommand: liveTest.command,
        liveTestResult: liveTest.result,
        lastResult: session.lastResult,
    });
    if (!session.blockReason && gates.blockReason && !writeAllowed && desired !== "noop") {
        session.blockReason = gates.blockReason;
    }
    if (stepped.writeMode && writeAllowed && host.setForeignStateAsync && host.getForeignStateAsync) {
        const writeHost = {
            getForeignStateAsync: host.getForeignStateAsync,
            setForeignStateAsync: host.setForeignStateAsync,
            log: host.log,
        };
        const wr = await (0, write_1.executeEvccButtonWrite)(writeHost, {
            contract,
            mode: stepped.writeMode,
            writeAllowed: true,
            liveTestPermit: livePermit.permit,
        });
        if (wr.written && livePermit.consumeOnSuccessfulWrite) {
            liveTest = (0, live_test_1.consumeEvLiveTest)(liveTest, stepped.writeMode, nowMs);
            await host.setStateAsync(stIds.evExecutionLiveTestArmed, { val: false, ack: true });
            liveTest = (0, live_test_1.markEvLiveTestResult)(liveTest, "awaiting_feedback");
            session.explain = (0, gates_1.formatEvExecutionExplain)({
                desired,
                actual,
                authority: session.authority,
                phase: session.phase,
                blockReason: session.blockReason || gates.blockReason,
                failsafeReason: session.failsafeReason || gates.failsafeReason,
                writeAllowed,
                desiredReason: resolved.reason,
                sourceFresh: source.fresh,
                ownership: session.ownership,
                ownedMode: session.ownedMode,
                releaseReason: session.releaseReason,
                action: resolved.action,
                liveTestArmed: liveTest.armed,
                liveTestConsumed: liveTest.consumed,
                liveTestCommand: liveTest.command,
                liveTestResult: liveTest.result,
                lastResult: session.lastResult,
            });
        }
        else if (wr.blocked || !wr.written) {
            session.lastResult = wr.reason;
            if (wr.reason === "feature_gate" || wr.reason === "write_not_allowed") {
                session.blockReason = wr.reason;
            }
        }
    }
    booted = true;
    await publishSession(host, session, {
        enabled: write_allowlist_1.EV_EXECUTION_PHASE5_ENABLED,
        ready: gates.ready,
        desired,
        actual,
    });
    return session;
}
exports.tickEvExecution = tickEvExecution;
function evExecutionBooted() {
    return booted;
}
exports.evExecutionBooted = evExecutionBooted;
