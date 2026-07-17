"use strict";
/** Diagnostic memory helpers — used for authority RSS snapshots, never for control. */
Object.defineProperty(exports, "__esModule", { value: true });
exports.captureRssSnapshot = exports.bytesToMiB = void 0;
const BYTES_PER_MIB = 1024 * 1024;
function bytesToMiB(bytes) {
    return Math.round((bytes / BYTES_PER_MIB) * 10) / 10;
}
exports.bytesToMiB = bytesToMiB;
function captureRssSnapshot(nowMs = Date.now()) {
    const mem = process.memoryUsage();
    return {
        rssMiB: bytesToMiB(mem.rss),
        heapUsedMiB: bytesToMiB(mem.heapUsed),
        externalMiB: bytesToMiB(mem.external ?? 0),
        capturedAt: new Date(nowMs).toISOString(),
    };
}
exports.captureRssSnapshot = captureRssSnapshot;
