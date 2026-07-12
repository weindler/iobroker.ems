"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.utf8Bytes = exports.logForecastPlanDuplicationReport = exports.logForecastPlanWriteProbe = void 0;
const memory_probe_1 = require("./memory_probe");
function utf8Bytes(value) {
    return Buffer.byteLength(value, "utf8");
}
exports.utf8Bytes = utf8Bytes;
function formatProbeLine(phase, meta, snapshot, extra) {
    const parts = [
        `EMS mem-forecast-write[${meta.stateId}]`,
        `phase=${phase}`,
        `bytes=${extra?.bytes ?? ""}`,
        `revisionRequired=${meta.revisionRequired}`,
        `skipRead=${meta.skipRead}`,
        meta.slotCount !== undefined ? `slots=${meta.slotCount}` : null,
        meta.contributionCount !== undefined ? `contributions=${meta.contributionCount}` : null,
        meta.duplicateSlotsVsPlanJson !== undefined ? `dupSlotsVsPlan=${meta.duplicateSlotsVsPlanJson}` : null,
        meta.duplicateContributionsVsPlanJson !== undefined
            ? `dupContribVsPlan=${meta.duplicateContributionsVsPlanJson}`
            : null,
        `rss=${snapshot.rssMiB}MiB`,
        `heapUsed=${snapshot.heapUsedMiB}MiB`,
        `external=${snapshot.externalMiB}MiB`,
        `arrayBuffers=${snapshot.arrayBuffersMiB}MiB`,
    ].filter((p) => p !== null && !p.endsWith("="));
    return parts.join(" ");
}
function logForecastPlanWriteProbe(log, phase, meta, extra) {
    const snapshot = (0, memory_probe_1.captureMemoryProbe)(`forecast_write:${meta.stateId}:${phase}`);
    log?.info?.(formatProbeLine(phase, meta, snapshot, extra));
    return snapshot;
}
exports.logForecastPlanWriteProbe = logForecastPlanWriteProbe;
function logForecastPlanDuplicationReport(log, report) {
    const lines = [
        `EMS mem-forecast-dup revisionChanged=${report.revisionChanged} semanticHash=${report.semanticHash.slice(0, 12)}`,
        `totalSerializedBytes=${report.totalSerializedBytes}`,
        `uniqueSlotBytes=${report.uniqueSlotBytes}`,
        `uniqueContributionBytes=${report.uniqueContributionBytes}`,
        `duplicateSlotBytesVsPlanJson=${report.duplicateSlotBytesVsPlanJson}`,
        `duplicateContributionBytesVsPlanJson=${report.duplicateContributionBytesVsPlanJson}`,
        ...report.fields.map((f) => `  ${f.stateId} bytes=${f.bytes}` +
            (f.slotCount !== undefined ? ` slots=${f.slotCount}` : "") +
            (f.contributionCount !== undefined ? ` contributions=${f.contributionCount}` : "")),
    ];
    for (const line of lines) {
        log?.info?.(line);
    }
}
exports.logForecastPlanDuplicationReport = logForecastPlanDuplicationReport;
