"use strict";
/**
 * In-Tick Day-Session für Replan-Historie + Tagesabschluss.
 * Persistenz der Evaluation ist restart-sicher; Session-Metadaten sind best-effort.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDayPlanSessionForTest = void 0;
exports.resetDayPlanSessionForTest = resetDayPlanSessionForTest;
exports.getDayPlanSession = getDayPlanSession;
exports.noteUnifiedPlanPublished = noteUnifiedPlanPublished;
exports.sessionSnapshot = sessionSnapshot;
exports.closeSessionIfNeeded = closeSessionIfNeeded;
const build_1 = require("./build");
const close_1 = require("./close");
let session = null;
function resetDayPlanSessionForTest() {
    session = null;
}
function getDayPlanSession() {
    return session ? { ...session, replanReasons: [...session.replanReasons], lastPlan: session.lastPlan } : null;
}
/** @deprecated alias */
exports.getDayPlanSessionForTest = getDayPlanSession;
function noteUnifiedPlanPublished(input) {
    let rolloverFrom = null;
    if (session && session.date !== input.date) {
        rolloverFrom = session;
        session = null;
    }
    if (!session) {
        session = {
            date: input.date,
            timezone: input.timezone,
            initialPlanId: input.plan.planId,
            initialGeneration: input.plan.generation,
            initialExpectedPvKwh: input.expectedPvKwh,
            batteryStartSocPct: input.batteryStartSocPct,
            plannedImmersionTargetTempC: input.immersionTargetTempC,
            replanReasons: [],
            publishCount: 1,
            lastPlan: input.plan,
        };
        return { rolloverFrom };
    }
    session.publishCount += 1;
    session.lastPlan = input.plan;
    session.replanReasons = [...new Set([...session.replanReasons, ...input.replanReasons])];
    return { rolloverFrom };
}
function sessionSnapshot(s) {
    return (0, build_1.snapshotFromUnifiedSession)({
        date: s.date,
        timezone: s.timezone,
        initialPlanId: s.initialPlanId,
        finalPlan: s.lastPlan,
        initialGeneration: s.initialGeneration,
        replanCount: Math.max(0, s.publishCount - 1),
        replanReasons: s.replanReasons,
        initialExpectedPvKwh: s.initialExpectedPvKwh,
        batteryStartSocPct: s.batteryStartSocPct,
        plannedImmersionTargetTempC: s.plannedImmersionTargetTempC,
    });
}
async function closeSessionIfNeeded(input) {
    const snap = sessionSnapshot(input.sessionToClose);
    const result = await (0, close_1.closeDayEvaluationOnce)({
        dayEvalDir: input.dayEvalDir,
        pvBiasDir: input.pvBiasDir,
        thermalDir: input.thermalDir,
        session: snap,
        actuals: input.actuals,
        now: input.now,
    });
    if (result.error) {
        input.log?.warn?.(`day_evaluation close failed: ${result.error}`);
    }
}
