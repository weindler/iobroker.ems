"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runWallboxLiveFoundation = exports.resolveWallboxRuntimePhase = exports.executeWallboxWrite = exports.WALLBOX_LIVE_WRITE_RELEASED = void 0;
const command_1 = require("./command");
const write_plan_1 = require("./write_plan");
/** Release-Freigabe für reale Wallbox-/EVCC-Writes — in v0.1.135 geschlossen. */
exports.WALLBOX_LIVE_WRITE_RELEASED = false;
/**
 * EINZIGE zentrale Write-Funktion für Wallbox-/EVCC-Steuerdatenpunkte.
 * In v0.1.135 werden keine externen Writes ausgeführt — Release-Gate geschlossen.
 */
async function executeWallboxWrite(input) {
    const { candidate, writePlan, phase, liveRequested } = input;
    if (phase === "observe") {
        return {
            attempted: false,
            executed: false,
            blocked: true,
            reason: "observe_mode",
        };
    }
    if (phase === "dryrun" || !liveRequested) {
        return {
            attempted: false,
            executed: false,
            blocked: true,
            reason: "execution_gate_closed",
        };
    }
    if (candidate.blocked) {
        return {
            attempted: false,
            executed: false,
            blocked: true,
            reason: candidate.blockReason ?? "candidate_blocked",
        };
    }
    if (writePlan && !writePlan.contractReady) {
        return {
            attempted: false,
            executed: false,
            blocked: true,
            reason: writePlan.blockReason ?? "write_contract_incomplete",
        };
    }
    if (!exports.WALLBOX_LIVE_WRITE_RELEASED) {
        return {
            attempted: false,
            executed: false,
            blocked: true,
            reason: "release_gate_closed",
        };
    }
    // Zukünftiger Live-Block: Write-Plan-Operationen ausführen.
    return {
        attempted: false,
        executed: false,
        blocked: true,
        reason: "release_gate_closed",
    };
}
exports.executeWallboxWrite = executeWallboxWrite;
function resolveWallboxRuntimePhase(input) {
    if (!input.addonEnabled || !input.governanceEnabled) {
        return "observe";
    }
    if (!input.liveRequested) {
        return "dryrun";
    }
    return "live";
}
exports.resolveWallboxRuntimePhase = resolveWallboxRuntimePhase;
async function runWallboxLiveFoundation(input) {
    const phase = resolveWallboxRuntimePhase({
        addonEnabled: input.addonEnabled,
        governanceEnabled: input.governanceEnabled,
        liveRequested: input.liveRequested,
    });
    if (phase === "observe") {
        return {
            phase,
            liveRequested: input.liveRequested,
            candidate: null,
            writePlan: null,
            mappingSnapshot: input.mappingSnapshot,
            writeResult: null,
            liveWriteReleased: false,
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
    let writeResult = null;
    if (phase === "live") {
        writeResult = await executeWallboxWrite({
            candidate,
            writePlan,
            phase,
            liveRequested: input.liveRequested,
        });
    }
    return {
        phase,
        liveRequested: input.liveRequested,
        candidate,
        writePlan,
        mappingSnapshot: input.mappingSnapshot,
        writeResult,
        liveWriteReleased: false,
        writeAllowed: false,
    };
}
exports.runWallboxLiveFoundation = runWallboxLiveFoundation;
