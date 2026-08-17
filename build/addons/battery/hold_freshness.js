"use strict";
/**
 * Grid-Balance Hold: nur nachweislich aktuelle Signale.
 * Planner-Constraint-States dürfen nicht monatealte true-Werte behalten
 * (`setStateIfChanged` schreibt bei gleichem val nicht und lässt `ts` alt).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveGridBalanceHoldSignals = exports.isEvccBatteryHoldMode = exports.isFreshTrue = exports.PLANNER_HOLD_CONSTRAINT_MAX_AGE_MS = void 0;
exports.PLANNER_HOLD_CONSTRAINT_MAX_AGE_MS = 15 * 60 * 1000;
function isFreshTrue(st, nowMs, maxAgeMs = exports.PLANNER_HOLD_CONSTRAINT_MAX_AGE_MS) {
    if (!st || st.val !== true)
        return false;
    const ts = typeof st.ts === "number" && Number.isFinite(st.ts) ? st.ts : null;
    if (ts === null)
        return false;
    return nowMs - ts <= maxAgeMs;
}
exports.isFreshTrue = isFreshTrue;
/** EVCC battery_mode Hold — aktuell hold / holdcharge, nicht historische Constraint-States. */
function isEvccBatteryHoldMode(mode) {
    const m = String(mode ?? "").trim().toLowerCase();
    return m === "hold" || m === "holdcharge";
}
exports.isEvccBatteryHoldMode = isEvccBatteryHoldMode;
function resolveGridBalanceHoldSignals(input) {
    const constraintHoldFresh = isFreshTrue(input.constraintHoldState, input.nowMs);
    const evccBatteryModeHold = isEvccBatteryHoldMode(input.evccBatteryMode);
    const holdPlanned = input.deviceIntentHold === true;
    const holdActive = constraintHoldFresh ||
        input.batteryHoldForEvCharge === true ||
        evccBatteryModeHold;
    return {
        constraintHoldFresh,
        evccBatteryModeHold,
        holdPlanned,
        holdActive,
        holdDetected: holdPlanned || holdActive,
    };
}
exports.resolveGridBalanceHoldSignals = resolveGridBalanceHoldSignals;
