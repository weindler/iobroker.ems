"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.canResetFault = exports.isRelayChatter = exports.recordChatterEvent = exports.checkPowerFault = void 0;
function checkPowerFault(input) {
    const none = { faultCode: "none", faultMessage: "", mismatchSinceMs: input.mismatchSinceMs, lockout: false };
    if (!input.hasPowerMeasurement || input.measuredPowerW === null) {
        return none;
    }
    const { config, nowMs, commandedOn, measuredPowerW, nominalPowerW, switchCommandAtMs } = input;
    if (!commandedOn) {
        const delayMs = config.switchOffCheckDelaySec * 1000;
        if (switchCommandAtMs === null || nowMs - switchCommandAtMs < delayMs) {
            return none;
        }
        if (measuredPowerW > config.powerOffThresholdW) {
            return {
                faultCode: "power_when_off",
                faultMessage: `power_when_off: ${measuredPowerW}W > ${config.powerOffThresholdW}W`,
                mismatchSinceMs: null,
                lockout: true,
            };
        }
        return none;
    }
    if (input.commandedStage <= 0) {
        return none;
    }
    const delayMs = config.switchOnCheckDelaySec * 1000;
    if (switchCommandAtMs === null || nowMs - switchCommandAtMs < delayMs) {
        return none;
    }
    if (measuredPowerW < config.powerOnThresholdW) {
        return {
            faultCode: "no_power_when_on",
            faultMessage: `no_power_when_on: ${measuredPowerW}W < ${config.powerOnThresholdW}W`,
            mismatchSinceMs: null,
            lockout: true,
        };
    }
    if (nominalPowerW > 0) {
        const tol = config.powerTolerancePct / 100;
        const low = nominalPowerW * (1 - tol);
        const high = nominalPowerW * (1 + tol);
        if (measuredPowerW < low || measuredPowerW > high) {
            const since = input.mismatchSinceMs ?? nowMs;
            if (nowMs - since >= config.powerMismatchDurationSec * 1000) {
                return {
                    faultCode: "power_mismatch",
                    faultMessage: `power_mismatch: ${measuredPowerW}W vs nominal ${nominalPowerW}W`,
                    mismatchSinceMs: since,
                    lockout: true,
                };
            }
            return { faultCode: "none", faultMessage: "", mismatchSinceMs: since, lockout: false };
        }
    }
    return { ...none, mismatchSinceMs: null };
}
exports.checkPowerFault = checkPowerFault;
function recordChatterEvent(tracker, nowMs, windowSec) {
    const windowMs = windowSec * 1000;
    const kept = tracker.timestampsMs.filter((t) => nowMs - t <= windowMs);
    return { timestampsMs: [...kept, nowMs] };
}
exports.recordChatterEvent = recordChatterEvent;
function isRelayChatter(tracker, maxChanges) {
    return tracker.timestampsMs.length > maxChanges;
}
exports.isRelayChatter = isRelayChatter;
function canResetFault(input) {
    if (!input.configValid)
        return { ok: false, reason: "invalid_config" };
    if (!input.temperatureValid)
        return { ok: false, reason: "temperature_invalid" };
    if (!input.allStagesOff)
        return { ok: false, reason: "stages_not_off" };
    if (input.chatterActive)
        return { ok: false, reason: "relay_chatter_active" };
    if (input.hasPowerMeasurement && input.measuredPowerW !== null && input.measuredPowerW > input.powerOffThresholdW) {
        return { ok: false, reason: "power_still_present" };
    }
    return { ok: true, reason: "reset_ok" };
}
exports.canResetFault = canResetFault;
