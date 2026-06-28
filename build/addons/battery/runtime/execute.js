"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.executeBatteryWrite = exports.evaluateFinalWriteGate = void 0;
function evaluateFinalWriteGate(gate) {
    if (!gate.globalLive)
        return { passed: false, rejectCode: "execution_gate_closed" };
    if (!gate.governanceEnabled)
        return { passed: false, rejectCode: "addon_disabled" };
    if (gate.profileId !== "sonnen_em")
        return { passed: false, rejectCode: "profile_not_live_capable" };
    if (!gate.profileLiveControlAvailable)
        return { passed: false, rejectCode: "live_control_unavailable" };
    if (!gate.profileReady)
        return { passed: false, rejectCode: "profile_not_ready" };
    if (!gate.intentValid)
        return { passed: false, rejectCode: "intent_invalid" };
    if (!gate.telemetryReady)
        return { passed: false, rejectCode: "telemetry_stale" };
    if (gate.fault)
        return { passed: false, rejectCode: "fault" };
    if (gate.lockout)
        return { passed: false, rejectCode: "lockout" };
    if (!gate.targetMappingConfigured)
        return { passed: false, rejectCode: "missing_mapping" };
    if (!gate.ownershipValid)
        return { passed: false, rejectCode: "ownership_invalid" };
    return { passed: true, rejectCode: null };
}
exports.evaluateFinalWriteGate = evaluateFinalWriteGate;
/**
 * EINZIGE zentrale Write-Funktion für reale Batterie-Datenpunkte.
 * Dryrun simuliert exakt denselben Ablauf wie Live, schreibt aber nie real.
 */
async function executeBatteryWrite(host, params) {
    const at = new Date().toISOString();
    const base = {
        kind: params.kind,
        stateId: params.stateId,
        value: params.value,
        at,
        expectedFeedback: params.expectedFeedback ?? null,
    };
    if (params.dryrun) {
        host.log.debug(`battery dryrun would_write ${params.kind}=${params.value} → ${params.stateId} (${params.reason})`);
        return { ...base, executed: false, simulated: true, gatePassed: true, rejectCode: null };
    }
    const gate = evaluateFinalWriteGate(params.gate);
    if (!gate.passed) {
        host.log.warn(`battery write blocked (${gate.rejectCode}) ${params.kind}=${params.value} → ${params.stateId}`);
        return { ...base, executed: false, simulated: false, gatePassed: false, rejectCode: gate.rejectCode };
    }
    if (!params.stateId) {
        return { ...base, executed: false, simulated: false, gatePassed: false, rejectCode: "missing_mapping" };
    }
    try {
        await host.setForeignStateAsync(params.stateId, { val: params.value, ack: false });
        host.log.info(`battery LIVE write ${params.kind}=${params.value} → ${params.stateId} (${params.reason})`);
        return { ...base, executed: true, simulated: false, gatePassed: true, rejectCode: null };
    }
    catch (e) {
        host.log.error(`battery write failed ${params.stateId}: ${String(e)}`);
        return {
            ...base,
            executed: false,
            simulated: false,
            gatePassed: true,
            rejectCode: params.kind === "operating_mode" ? "mode_write_failed" : "charge_write_failed",
        };
    }
}
exports.executeBatteryWrite = executeBatteryWrite;
