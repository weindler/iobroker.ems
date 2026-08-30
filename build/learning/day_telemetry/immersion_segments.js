"use strict";
/**
 * Immersion (Heizstab) Run Segments — additiv, analog Climate Run Segments.
 * Segmentgrenze = on/off-Wechsel (immersionRuntimeOn). Kontext-Felder (decisionSource,
 * forcedMode, hygieneStatusDe, ownershipOwner) sind Live-Mirror bereits vorhandener
 * Runtime-States zum Startzeitpunkt des Segments — kein Recompute, keine rückwirkende
 * Rekonstruktion aus heutigem State.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.advanceImmersionSegment = exports.closeImmersionSegment = void 0;
/** Schließt offenes Segment und hängt es an die Liste. */
function closeImmersionSegment(open, endTs, list) {
    if (!open || endTs <= open.startTs || !(open.runtimeSec > 0))
        return list;
    return [
        ...list,
        {
            startTs: open.startTs,
            endTs,
            energyKwh: open.energyKwh,
            runtimeSec: open.runtimeSec,
            valid: true,
            rejectReason: null,
            decisionSource: open.decisionSource,
            forcedMode: open.forcedMode,
            hygieneStatusDe: open.hygieneStatusDe,
            ownershipOwner: open.ownershipOwner,
        },
    ];
}
exports.closeImmersionSegment = closeImmersionSegment;
/**
 * Aktualisiert laufendes Segment mit Messprobe.
 * Bei on→off: Segment schließen. Bei off→on: neues Segment öffnen (Kontext bei Start einfrieren).
 * Kontext wird während eines laufenden Segments NICHT nachträglich überschrieben — er
 * repräsentiert die Lage zum Startzeitpunkt des Laufs.
 */
function advanceImmersionSegment(open, nowTs, on, deltaKwh, deltaRuntimeSec, context, list) {
    if (!on) {
        return { open: null, list: closeImmersionSegment(open, nowTs, list) };
    }
    if (!open) {
        return {
            open: {
                ...context,
                startTs: nowTs,
                energyKwh: Math.max(0, deltaKwh),
                runtimeSec: Math.max(0, deltaRuntimeSec),
            },
            list,
        };
    }
    return {
        open: {
            ...open,
            energyKwh: open.energyKwh + Math.max(0, deltaKwh),
            runtimeSec: open.runtimeSec + Math.max(0, deltaRuntimeSec),
        },
        list,
    };
}
exports.advanceImmersionSegment = advanceImmersionSegment;
