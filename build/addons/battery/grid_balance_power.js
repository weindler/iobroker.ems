"use strict";
/**
 * Grid-balance live power (v0.1.289) — Mode-2 discharge-Override.
 *
 * Formel (Referenzscript): deficitW = max(0, consumptionW − pvW);
 * targetW = clamp(round(deficitW + offsetW), 0, maxW).
 *
 * Deadband-Default 0 W: auch kleine Restnetzbezüge (z. B. 20–48 W) sind
 * ausregelbar. Admin darf bewusst ein Deadband setzen.
 *
 * Keine 8-s-Stabilisierung. Mode-2-Override muss innerhalb von ~10 s
 * erneut geschrieben werden (Keepalive, unabhängig von der Write-Hysterese).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.evaluateGridBalanceTick = exports.gridBalanceSessionReleasePermit = exports.gridBalanceCleanupAllowed = exports.gridBalanceExecutionReleased = exports.gridBalanceSetpointPermit = exports.consumeGridBalanceLiveTest = exports.applyGridBalanceLiveTestPulse = exports.emptyGridBalanceLiveTest = exports.effectiveGridBalanceMaxW = exports.adjustConsumptionForEv = exports.GRID_BALANCE_EV_ACTIVE_MIN_W = exports.GRID_BALANCE_EV_POWER_MAX_AGE_MS = exports.GRID_BALANCE_KEEPALIVE_MAX_MS = exports.GRID_BALANCE_DEADBAND_DEFAULT_W = void 0;
const grid_balance_contract_1 = require("./grid_balance_contract");
exports.GRID_BALANCE_DEADBAND_DEFAULT_W = 0;
/** Sonnen Mode-2 Override erlischt nach ~10 s — Refresh spätestens hier. */
exports.GRID_BALANCE_KEEPALIVE_MAX_MS = 8_000;
exports.GRID_BALANCE_EV_POWER_MAX_AGE_MS = 15_000;
/** Unterhalb gilt chargePower nicht als echte Ladeleistung. */
exports.GRID_BALANCE_EV_ACTIVE_MIN_W = 200;
function adjustConsumptionForEv(input) {
    const consumptionW = Number.isFinite(input.consumptionW) ? Math.max(0, input.consumptionW) : 0;
    const power = input.chargePowerW != null && Number.isFinite(input.chargePowerW) ? input.chargePowerW : null;
    const maxAge = input.maxAgeMs ?? exports.GRID_BALANCE_EV_POWER_MAX_AGE_MS;
    const ageOk = input.chargePowerAgeMs != null && Number.isFinite(input.chargePowerAgeMs) && input.chargePowerAgeMs >= 0 &&
        input.chargePowerAgeMs <= maxAge;
    const powerPositive = power != null && power > 0;
    const vehiclePresent = input.vehicleConnected !== false;
    const evActive = vehiclePresent && (input.charging === true || (power != null && power >= exports.GRID_BALANCE_EV_ACTIVE_MIN_W));
    if (!evActive) {
        return {
            evActive: false,
            evChargePowerW: power,
            evPowerFresh: ageOk && power != null,
            adjustedConsumptionW: consumptionW,
            blockReason: "",
        };
    }
    const freshReal = powerPositive && ageOk;
    if (!freshReal) {
        return {
            evActive: true,
            evChargePowerW: power,
            evPowerFresh: false,
            adjustedConsumptionW: consumptionW,
            blockReason: "ev_power_unknown",
        };
    }
    return {
        evActive: true,
        evChargePowerW: power,
        evPowerFresh: true,
        adjustedConsumptionW: Math.max(0, consumptionW - power),
        blockReason: "",
    };
}
exports.adjustConsumptionForEv = adjustConsumptionForEv;
function effectiveGridBalanceMaxW(input) {
    const configuredMaxW = Math.max(0, Math.round(Number.isFinite(input.configuredMaxW) ? input.configuredMaxW : 0));
    const discharge = input.hardwareMaxDischargeW != null && input.hardwareMaxDischargeW > 0 ? input.hardwareMaxDischargeW : null;
    const charge = input.hardwareMaxChargeW != null && input.hardwareMaxChargeW > 0 ? input.hardwareMaxChargeW : null;
    /** Sonnen Mode-2 discharge-Override; Hardware-Entladegrenze gilt, sonst Ladegrenze. */
    const hardwareMaxW = discharge ?? charge;
    const effectiveMaxW = hardwareMaxW != null ? Math.min(configuredMaxW, Math.round(hardwareMaxW)) : configuredMaxW;
    return { configuredMaxW, hardwareMaxW, effectiveMaxW: Math.max(0, effectiveMaxW) };
}
exports.effectiveGridBalanceMaxW = effectiveGridBalanceMaxW;
function emptyGridBalanceLiveTest() {
    return { armed: false, consumed: false, armedAtMs: null, consumedAtMs: null, result: "" };
}
exports.emptyGridBalanceLiveTest = emptyGridBalanceLiveTest;
function applyGridBalanceLiveTestPulse(prev, armedVal, armedAck, nowMs) {
    if (armedVal === true && armedAck === false) {
        if (prev.consumed) {
            return { ...prev, armed: false, result: "retries_blocked" };
        }
        return {
            armed: true,
            consumed: false,
            armedAtMs: nowMs,
            consumedAtMs: null,
            result: "armed",
        };
    }
    if (armedVal === false && armedAck === false) {
        return { ...emptyGridBalanceLiveTest(), result: "disarmed" };
    }
    return prev;
}
exports.applyGridBalanceLiveTestPulse = applyGridBalanceLiveTestPulse;
function consumeGridBalanceLiveTest(prev, nowMs) {
    if (!prev.armed || prev.consumed)
        return prev;
    return {
        armed: false,
        consumed: true,
        armedAtMs: prev.armedAtMs,
        consumedAtMs: nowMs,
        result: "consumed",
    };
}
exports.consumeGridBalanceLiveTest = consumeGridBalanceLiveTest;
/** Dauerbetrieb oder One-Shot-Session: regulärer Discharge-Setpoint und Mode-2-Keepalive. */
function gridBalanceSetpointPermit(liveTest, ownsSetpoint = false) {
    return grid_balance_contract_1.GRID_BALANCE_EXECUTION_ENABLED || (liveTest.armed && !liveTest.consumed) || (ownsSetpoint && liveTest.consumed);
}
exports.gridBalanceSetpointPermit = gridBalanceSetpointPermit;
/** @deprecated Use gridBalanceSetpointPermit — does not gate the 0-release. */
function gridBalanceExecutionReleased(liveTest) {
    return gridBalanceSetpointPermit(liveTest);
}
exports.gridBalanceExecutionReleased = gridBalanceExecutionReleased;
/** GB beendet sich selbst mit discharge=0, auch wenn Hold/Boost/Netzladung übernehmen. */
function gridBalanceCleanupAllowed(input) {
    if (!input.ownsSetpoint)
        return false;
    if (input.authority === "safety") {
        const reason = input.blockReason ?? "";
        if (reason === "restore_in_progress" || reason === "fault_lockout")
            return false;
        // global_dryrun / addon_dryrun / addon_disabled: reguläres Session-Ende, 0-Release bleibt möglich.
    }
    return true;
}
exports.gridBalanceCleanupAllowed = gridBalanceCleanupAllowed;
/**
 * Session-0-Release: unabhängig von One-Shot `consumed`.
 * Hold / Boost / geplante Netzladung: GB schreibt zuerst discharge=0, danach Mode-Wechsel.
 * Restore/Fault: kein konkurrierendes Cleanup.
 */
function gridBalanceSessionReleasePermit(input) {
    if (!gridBalanceCleanupAllowed(input))
        return false;
    const liveOk = (input.globalLive && input.addonLive) || input.leavingLiveWithOwnership === true;
    return liveOk && !input.faultActive && !input.lockoutActive && !input.restoreInProgress;
}
exports.gridBalanceSessionReleasePermit = gridBalanceSessionReleasePermit;
function roundW(n) {
    return Math.max(0, Math.round(n));
}
function evaluateGridBalanceTick(input) {
    const liveTestPermit = gridBalanceSetpointPermit(input.liveTest, input.ownsSetpoint);
    const safety = (0, grid_balance_contract_1.evaluateGridBalanceSafety)({ ...input.safety, liveTestPermit });
    const ev = adjustConsumptionForEv({
        consumptionW: input.consumptionW,
        charging: input.charging,
        chargePowerW: input.chargePowerW,
        chargePowerAgeMs: input.chargePowerAgeMs,
        vehicleConnected: input.vehicleConnected,
    });
    const pvPowerW = Number.isFinite(input.pvAcPowerW) ? Math.max(0, input.pvAcPowerW) : 0;
    const rawGridDeltaW = roundW(ev.adjustedConsumptionW - pvPowerW);
    const deadbandW = Math.max(0, Math.round(input.deadbandW));
    const max = effectiveGridBalanceMaxW({
        configuredMaxW: input.configuredMaxW,
        hardwareMaxChargeW: input.hardwareMaxChargeW,
        hardwareMaxDischargeW: input.hardwareMaxDischargeW,
    });
    const exceeds = rawGridDeltaW > deadbandW;
    const unclamped = exceeds ? roundW(rawGridDeltaW + Math.max(0, input.offsetW)) : 0;
    const requestedPowerW = Math.min(max.effectiveMaxW, unclamped);
    const minBenefitW = deadbandW;
    let blockReason = safety.blockReason;
    if (!blockReason && !input.mode2Confirmed)
        blockReason = "mode_not_self_consumption";
    if (!blockReason && ev.blockReason)
        blockReason = ev.blockReason;
    if (!blockReason && !exceeds)
        blockReason = "inside_deadband";
    if (!blockReason && max.effectiveMaxW <= 0) {
        blockReason =
            input.configuredMaxWZeroFromPlanner === true && input.configuredMaxW <= 0
                ? "planner_budget_zero"
                : "no_hardware_headroom";
    }
    if (!blockReason && minBenefitW > 0 && requestedPowerW < minBenefitW)
        blockReason = "below_min_benefit";
    if (!blockReason && !input.controllerIsGridBalance)
        blockReason = "controller_not_grid_balance";
    const powerEligible = blockReason === "";
    const ready = safety.policyAllowed && ev.blockReason === "" && powerEligible;
    const writeAllowed = safety.writeAllowed && powerEligible;
    let shouldWrite = false;
    let shouldRelease = false;
    let forceWrite = false;
    let writePowerW = 0;
    let ownsNext = input.ownsSetpoint;
    const liveTestNext = input.liveTest;
    let lastAction = "idle";
    let effectivePowerW = 0;
    const keepaliveMaxMs = input.keepaliveMaxMs ?? exports.GRID_BALANCE_KEEPALIVE_MAX_MS;
    const elapsedSinceWrite = input.lastWriteAtMs != null && Number.isFinite(input.lastWriteAtMs) ? input.nowMs - input.lastWriteAtMs : null;
    const keepaliveDue = input.ownsSetpoint &&
        requestedPowerW > 0 &&
        writeAllowed &&
        (elapsedSinceWrite === null || elapsedSinceWrite >= keepaliveMaxMs);
    const releasePermit = gridBalanceSessionReleasePermit({
        ownsSetpoint: input.ownsSetpoint,
        holdDetected: safety.holdDetected,
        authority: safety.authority,
        globalLive: input.safety.globalLive,
        addonLive: input.safety.addonLive,
        faultActive: input.safety.faultActive,
        lockoutActive: input.safety.lockoutActive,
        restoreInProgress: input.safety.restoreInProgress,
        blockReason: safety.blockReason,
        leavingLiveWithOwnership: input.leavingLiveWithOwnership === true,
    });
    if (!safety.policyAllowed ||
        !input.mode2Confirmed ||
        ev.blockReason ||
        !input.controllerIsGridBalance) {
        if (releasePermit) {
            shouldRelease = true;
            writePowerW = 0;
            ownsNext = false;
            lastAction = "released";
        }
        else {
            ownsNext = false;
            lastAction = "blocked";
            if (!safety.writeAllowed && safety.policyAllowed && !ev.blockReason && input.mode2Confirmed) {
                lastAction = grid_balance_contract_1.GRID_BALANCE_EXECUTION_ENABLED ? "idle" : "diagnosis_only";
            }
        }
    }
    else if (blockReason === "inside_deadband" || blockReason === "below_min_benefit") {
        if (releasePermit) {
            shouldRelease = true;
            writePowerW = 0;
            ownsNext = false;
            lastAction = "released";
        }
        else if (blockReason === "inside_deadband") {
            lastAction = "inside_deadband";
        }
        else {
            lastAction = "blocked";
        }
    }
    else if (writeAllowed && requestedPowerW > 0) {
        const minChange = Math.max(0, input.minChangeW);
        const firstWrite = !input.ownsSetpoint || input.lastWrittenW === null;
        const delta = firstWrite ? Number.POSITIVE_INFINITY : Math.abs(requestedPowerW - (input.lastWrittenW ?? 0));
        const materialChange = delta >= minChange;
        if (firstWrite || materialChange || keepaliveDue) {
            shouldWrite = true;
            forceWrite = true;
            writePowerW = requestedPowerW;
            effectivePowerW = requestedPowerW;
            ownsNext = true;
            lastAction = !firstWrite && !materialChange && keepaliveDue ? "keepalive" : "written";
        }
        else {
            effectivePowerW = input.lastWrittenW ?? 0;
            lastAction = "idle";
        }
    }
    else if (powerEligible && !safety.writeAllowed) {
        lastAction = input.ownsSetpoint ? "idle" : grid_balance_contract_1.GRID_BALANCE_EXECUTION_ENABLED ? "idle" : "diagnosis_only";
        effectivePowerW = input.ownsSetpoint ? (input.lastWrittenW ?? requestedPowerW) : requestedPowerW;
    }
    const active = shouldWrite || (ownsNext && lastAction !== "released" && lastAction !== "blocked");
    const explain = (0, grid_balance_contract_1.formatGridBalanceExplain)({
        enabled: safety.enabled,
        blockReason,
        priceNowCt: input.safety.priceNowCt,
        priceMinCt: input.safety.priceMinCt,
        gridImportW: rawGridDeltaW,
        active,
        mode2Confirmed: input.mode2Confirmed,
        dischargeW: effectivePowerW || requestedPowerW,
    });
    return {
        enabled: safety.enabled,
        active,
        ready,
        blockReason,
        currentPriceCt: input.safety.priceNowCt,
        priceMinCt: input.safety.priceMinCt,
        priceAllowed: safety.priceAllowed,
        authority: safety.authority,
        holdDetected: safety.holdDetected,
        evConflict: safety.evConflict,
        explain,
        rawConsumptionW: roundW(Number.isFinite(input.consumptionW) ? Math.max(0, input.consumptionW) : 0),
        evChargePowerW: ev.evChargePowerW,
        adjustedConsumptionW: roundW(ev.adjustedConsumptionW),
        pvPowerW: roundW(pvPowerW),
        rawGridDeltaW,
        deadbandW,
        requestedPowerW,
        configuredMaxW: max.configuredMaxW,
        hardwareMaxW: max.hardwareMaxW,
        effectiveMaxW: max.effectiveMaxW,
        effectivePowerW,
        ownership: ownsNext,
        shouldWrite,
        shouldRelease,
        forceWrite,
        writePowerW,
        writeKind: "discharge",
        ownsSetpointNext: ownsNext,
        liveTestNext,
        lastAction,
        mode2Confirmed: input.mode2Confirmed,
        keepaliveDue,
        safety,
        evConflictKind: input.safety.evConflictKind,
    };
}
exports.evaluateGridBalanceTick = evaluateGridBalanceTick;
