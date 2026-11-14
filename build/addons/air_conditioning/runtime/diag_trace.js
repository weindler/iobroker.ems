"use strict";
/**
 * Kompaktes Transition-Logging für Climate ON→OFF-Realfälle.
 * Nur an START / feedback-ON / STOP / switch_off — kein Dauer-Spam.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatAcCoolingDiagLine = formatAcCoolingDiagLine;
exports.logAcCoolingDiag = logAcCoolingDiag;
function shortReason(reasonDe) {
    const t = reasonDe.trim().replace(/\s+/g, " ");
    return t.length <= 140 ? t : `${t.slice(0, 137)}...`;
}
/** Eine Zeile — Realfall ON→OFF anhand einer Logsequenz nachvollziehbar. */
function formatAcCoolingDiagLine(s) {
    const slot = s.slotStartIso || s.slotEndIso ? `${s.slotStartIso ?? "?"}->${s.slotEndIso ?? "?"}` : "none";
    const alloc = s.allocatedPowerW == null ? "null" : String(s.allocatedPowerW);
    const rev = s.dailyPlanRevision == null ? "null" : String(s.dailyPlanRevision);
    return (`ac unit ${s.unitIndex}: diag ${s.tag}` +
        ` | t=${new Date(s.nowMs).toISOString()}` +
        ` slot=${slot}` +
        ` allocW=${alloc}` +
        ` rev=${rev}` +
        ` status=${s.dailyPlanStatus}` +
        ` desired=${s.desired}` +
        ` lastDesired=${s.lastDesired ?? "null"}` +
        ` cmdGen=${s.commandGeneration}` +
        ` stopGen=${s.stopArmedGeneration ?? "null"}` +
        ` fb=${s.feedback}` +
        ` src=${s.decisionSource}` +
        ` allowStart=${s.allowStart}` +
        ` allowStop=${s.allowStop}` +
        ` demandStop=${s.demandStop}` +
        ` plannerOff=${s.plannerOff}` +
        ` | ${shortReason(s.reasonDe)}`);
}
function logAcCoolingDiag(log, snapshot) {
    log.info(formatAcCoolingDiagLine(snapshot));
}
