"use strict";
/**
 * Climate Run Segments — Segmentbildung bei Mode/Unit/Group/Validity-Wechsel.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.advanceClimateSegment = exports.closeClimateSegment = void 0;
function keyEqual(a, b) {
    return (a.sharedPowerGroupId === b.sharedPowerGroupId &&
        a.mode === b.mode &&
        a.activeUnitCombination === b.activeUnitCombination &&
        a.valid === b.valid);
}
/** Schließt offenes Segment und hängt es an die Liste. */
function closeClimateSegment(open, endTs, list) {
    if (!open || endTs <= open.startTs)
        return list;
    return [
        ...list,
        {
            startTs: open.startTs,
            endTs,
            sharedPowerGroupId: open.sharedPowerGroupId,
            mode: open.mode,
            activeUnitCombination: open.activeUnitCombination,
            energyKwh: open.energyKwh,
            runtimeSec: open.runtimeSec,
            valid: open.valid,
            rejectReason: open.rejectReason,
        },
    ];
}
exports.closeClimateSegment = closeClimateSegment;
/**
 * Aktualisiert laufendes Segment mit Messprobe.
 * Bei Key-Wechsel: altes schließen, neues öffnen.
 */
function advanceClimateSegment(open, nowTs, key, deltaKwh, deltaRuntimeSec, rejectReason, list) {
    if (key.activeUnitCombination === "none" || !key.activeUnitCombination) {
        /* idle — laufendes Segment schließen */
        return { open: null, list: closeClimateSegment(open, nowTs, list) };
    }
    if (!open) {
        return {
            open: {
                ...key,
                startTs: nowTs,
                energyKwh: Math.max(0, deltaKwh),
                runtimeSec: Math.max(0, deltaRuntimeSec),
                rejectReason,
            },
            list,
        };
    }
    if (!keyEqual(open, key)) {
        const closed = closeClimateSegment(open, nowTs, list);
        return {
            open: {
                ...key,
                startTs: nowTs,
                energyKwh: Math.max(0, deltaKwh),
                runtimeSec: Math.max(0, deltaRuntimeSec),
                rejectReason,
            },
            list: closed,
        };
    }
    return {
        open: {
            ...open,
            energyKwh: open.energyKwh + Math.max(0, deltaKwh),
            runtimeSec: open.runtimeSec + Math.max(0, deltaRuntimeSec),
            rejectReason: rejectReason ?? open.rejectReason,
        },
        list,
    };
}
exports.advanceClimateSegment = advanceClimateSegment;
