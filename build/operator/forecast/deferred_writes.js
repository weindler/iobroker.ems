"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.flushDeferredForecastPlanWrites = exports.hasDeferredForecastPlanWrite = exports.clearDeferredForecastPlanWriteForTest = exports.scheduleDeferredForecastPlanWrite = void 0;
let pending = null;
function scheduleDeferredForecastPlanWrite(host, run) {
    pending = { host, run };
}
exports.scheduleDeferredForecastPlanWrite = scheduleDeferredForecastPlanWrite;
function clearDeferredForecastPlanWriteForTest() {
    pending = null;
}
exports.clearDeferredForecastPlanWriteForTest = clearDeferredForecastPlanWriteForTest;
function hasDeferredForecastPlanWrite() {
    return pending !== null;
}
exports.hasDeferredForecastPlanWrite = hasDeferredForecastPlanWrite;
/** Runs a previously deferred forecast JSON write (e.g. after adapter ready). */
async function flushDeferredForecastPlanWrites() {
    const job = pending;
    pending = null;
    if (!job)
        return;
    await job.run();
}
exports.flushDeferredForecastPlanWrites = flushDeferredForecastPlanWrites;
