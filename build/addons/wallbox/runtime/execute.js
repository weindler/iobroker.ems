"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runWallboxLiveFoundation = exports.resolveWallboxRuntimePhase = exports.executeWallboxWrite = exports.WALLBOX_LIVE_WRITE_RELEASED = void 0;
const command_1 = require("./command");
const write_plan_1 = require("./write_plan");
const feedback_1 = require("./feedback");
const feedback_config_1 = require("./feedback_config");
const barrier_1 = require("../../../restore/barrier");
const device_write_1 = require("../../../device_write");
const write_allowlist_1 = require("../ev_foundation/write_allowlist");
/**
 * Release-Freigabe für reale Wallbox-/EVCC-Writes — Master-Kill-Switch.
 * v0.1.176: kontrolliert geöffnet, nachdem echte Writes, Feedback-Loop und
 * Safety-Schicht (Fault/Lockout, Ownership, Safe-Restore) verdrahtet sind.
 * Nur der EVCC-Steuerpfad ist live-eligible (`writePlan.liveEligible`); legacy_direct
 * bleibt strukturell dryrun/diagnostisch (siehe control_mapping.ts).
 */
exports.WALLBOX_LIVE_WRITE_RELEASED = true;
function blockedResult(reason) {
    return {
        attempted: false,
        executed: false,
        blocked: true,
        reason,
        operationResults: [],
        ownershipGranted: false,
        writeTimestampMs: null,
    };
}
/**
 * EINZIGE zentrale Write-Funktion für Wallbox-/EVCC-Steuerdatenpunkte.
 * Nur der EVCC-Steuerpfad ist live-eligible; legacy_direct bleibt strukturell blockiert.
 */
async function executeWallboxWrite(host, input) {
    const { candidate, writePlan, phase, liveRequested, faultActive } = input;
    if ((0, barrier_1.isRestoreInProgress)()) {
        return blockedResult("restore_in_progress");
    }
    if (phase === "observe") {
        return blockedResult("observe_mode");
    }
    if (phase === "dryrun" || !liveRequested) {
        return blockedResult("execution_gate_closed");
    }
    if (faultActive) {
        return blockedResult("fault_lockout");
    }
    if (candidate.blocked) {
        return blockedResult(candidate.blockReason ?? "candidate_blocked");
    }
    if (!writePlan || !writePlan.contractReady) {
        return blockedResult(writePlan?.blockReason ?? "write_contract_incomplete");
    }
    if (!writePlan.liveEligible) {
        return blockedResult(writePlan.controlPathReason ?? "not_live_eligible");
    }
    if (!exports.WALLBOX_LIVE_WRITE_RELEASED) {
        return blockedResult("release_gate_closed");
    }
    if (writePlan.operations.length === 0) {
        return blockedResult("no_operations");
    }
    const operations = [...writePlan.operations].sort((a, b) => a.sequence - b.sequence || a.role.localeCompare(b.role));
    const operationResults = [];
    let anyWritten = false;
    let requiredFailed = false;
    for (const op of operations) {
        try {
            const r = await (0, device_write_1.writeForeignIfChanged)(host, {
                stateId: op.targetStateId,
                value: op.targetValue,
                reason: `wallbox ${writePlan.action}/${op.role}`,
            });
            operationResults.push({
                role: op.role,
                targetStateId: op.targetStateId,
                written: r.written,
                skipped: r.skipped,
                required: op.required,
                error: null,
            });
            if (r.written)
                anyWritten = true;
        }
        catch (e) {
            host.log?.error?.(`wallbox write failed ${op.targetStateId}: ${String(e)}`);
            operationResults.push({
                role: op.role,
                targetStateId: op.targetStateId,
                written: false,
                skipped: false,
                required: op.required,
                error: String(e),
            });
            if (op.required)
                requiredFailed = true;
        }
    }
    if (requiredFailed) {
        return {
            attempted: true,
            executed: false,
            blocked: true,
            reason: "write_failed",
            operationResults,
            ownershipGranted: false,
            writeTimestampMs: null,
        };
    }
    const nowMs = Date.now();
    host.log?.debug?.(`wallbox LIVE write ${writePlan.action} (${writePlan.writeScenario ?? "n/a"}) → ${operations.map((o) => o.role).join(",")}`);
    return {
        attempted: true,
        executed: true,
        blocked: false,
        reason: anyWritten ? "executed" : "already_at_target",
        operationResults,
        ownershipGranted: true,
        writeTimestampMs: nowMs,
    };
}
exports.executeWallboxWrite = executeWallboxWrite;
function resolveWallboxRuntimePhase(input) {
    if (!input.addonEnabled || !input.governanceEnabled) {
        return "observe";
    }
    /** Befund 005: Off = EVCC autonom — keine EMS-Steuerung, kein Dryrun-Dispatch-Write. */
    if (input.addonExecutionOff === true) {
        return "observe";
    }
    if (!input.liveRequested) {
        return "dryrun";
    }
    return "live";
}
exports.resolveWallboxRuntimePhase = resolveWallboxRuntimePhase;
async function runWallboxLiveFoundation(host, input) {
    const addonExecutionOff = input.addonExecutionOff === true;
    const phase = resolveWallboxRuntimePhase({
        addonEnabled: input.addonEnabled,
        governanceEnabled: input.governanceEnabled,
        liveRequested: input.liveRequested,
        addonExecutionOff,
    });
    if (phase === "observe") {
        return {
            phase,
            liveRequested: input.liveRequested,
            addonExecutionOff,
            candidate: null,
            writePlan: null,
            feedbackContract: null,
            mappingSnapshot: input.mappingSnapshot,
            writeResult: null,
            liveWriteReleased: exports.WALLBOX_LIVE_WRITE_RELEASED,
            writeAllowed: false,
        };
    }
    const candidate = (0, command_1.buildWallboxCommandCandidate)({
        dispatch: input.dispatch,
        decision: input.decision,
        now: input.now,
    });
    const writePlan = (0, write_plan_1.buildWallboxWritePlan)({
        candidate,
        mapping: input.mappingSnapshot,
        chargingEnabled: input.chargingEnabled,
        chargeModeActive: input.chargeModeActive,
        now: input.now,
    });
    const feedbackConfig = (0, feedback_config_1.wallboxFeedbackConfigFromAdapter)(input.config);
    const feedbackContract = (0, feedback_1.buildWallboxFeedbackContract)({
        writePlan,
        feedbackConfig,
        now: input.now,
    });
    let writeResult = null;
    if (phase === "live") {
        if (write_allowlist_1.EV_EXECUTION_PHASE5_ENABLED) {
            writeResult = blockedResult("ev_execution_owns_writes");
        }
        else {
            writeResult = await executeWallboxWrite(host, {
                candidate,
                writePlan,
                phase,
                liveRequested: input.liveRequested,
                faultActive: input.faultActive,
            });
        }
    }
    return {
        phase,
        liveRequested: input.liveRequested,
        addonExecutionOff,
        candidate,
        writePlan,
        feedbackContract,
        mappingSnapshot: input.mappingSnapshot,
        writeResult,
        liveWriteReleased: exports.WALLBOX_LIVE_WRITE_RELEASED,
        writeAllowed: exports.WALLBOX_LIVE_WRITE_RELEASED && writePlan.liveEligible && phase === "live",
    };
}
exports.runWallboxLiveFoundation = runWallboxLiveFoundation;
