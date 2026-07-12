"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.memoryProbeDelta = exports.logMemoryProbe = exports.formatMemoryProbeLine = exports.captureMemoryProbe = void 0;
const node_v8_1 = __importDefault(require("node:v8"));
function bytesToMiB(bytes) {
    return Math.round((bytes / (1024 * 1024)) * 100) / 100;
}
function captureMemoryProbe(checkpoint, atMs = Date.now()) {
    const usage = process.memoryUsage();
    const resourceUsage = typeof process.resourceUsage === "function" ? process.resourceUsage() : undefined;
    const stats = node_v8_1.default.getHeapStatistics();
    return {
        checkpoint,
        atMs,
        rssMiB: bytesToMiB(usage.rss),
        heapTotalMiB: bytesToMiB(usage.heapTotal),
        heapUsedMiB: bytesToMiB(usage.heapUsed),
        externalMiB: bytesToMiB(usage.external),
        arrayBuffersMiB: bytesToMiB(usage.arrayBuffers ?? 0),
        maxRssMiB: resourceUsage ? bytesToMiB(resourceUsage.maxRSS) : null,
        v8HeapSizeLimitMiB: bytesToMiB(stats.heap_size_limit),
        v8TotalHeapSizeMiB: bytesToMiB(stats.total_heap_size),
        v8UsedHeapSizeMiB: bytesToMiB(stats.used_heap_size),
        v8MallocedMemoryMiB: bytesToMiB(stats.malloced_memory),
        v8ExternalMemoryMiB: bytesToMiB(stats.external_memory),
    };
}
exports.captureMemoryProbe = captureMemoryProbe;
function formatMemoryProbeLine(snapshot) {
    return (`EMS mem[${snapshot.checkpoint}] ` +
        `rss=${snapshot.rssMiB}MiB ` +
        `heapUsed=${snapshot.heapUsedMiB}MiB ` +
        `heapTotal=${snapshot.heapTotalMiB}MiB ` +
        `external=${snapshot.externalMiB}MiB ` +
        `arrayBuffers=${snapshot.arrayBuffersMiB}MiB ` +
        (snapshot.maxRssMiB !== null ? `maxRss=${snapshot.maxRssMiB}MiB ` : "") +
        `v8_used=${snapshot.v8UsedHeapSizeMiB}MiB ` +
        `v8_limit=${snapshot.v8HeapSizeLimitMiB}MiB`);
}
exports.formatMemoryProbeLine = formatMemoryProbeLine;
function logMemoryProbe(log, checkpoint, atMs) {
    const snapshot = captureMemoryProbe(checkpoint, atMs);
    const line = formatMemoryProbeLine(snapshot);
    log?.info?.(line);
    return snapshot;
}
exports.logMemoryProbe = logMemoryProbe;
function memoryProbeDelta(from, to) {
    return {
        rssMiB: Math.round((to.rssMiB - from.rssMiB) * 100) / 100,
        heapUsedMiB: Math.round((to.heapUsedMiB - from.heapUsedMiB) * 100) / 100,
        externalMiB: Math.round((to.externalMiB - from.externalMiB) * 100) / 100,
        arrayBuffersMiB: Math.round((to.arrayBuffersMiB - from.arrayBuffersMiB) * 100) / 100,
    };
}
exports.memoryProbeDelta = memoryProbeDelta;
