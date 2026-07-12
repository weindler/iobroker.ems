"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDelayedProbeTimersUnrefForTest = exports.getDelayedProbeTimerCountForTest = exports.logMemoryDiagnosticReport = exports.buildMemoryDiagnosticReport = exports.resetStartupMemoryDiagnosticsForTest = exports.getStartupMemorySnapshots = exports.clearPostReadyMemoryProbesForTest = exports.schedulePostReadyMemoryProbes = exports.probeStartupMemory = exports.recordStartupMemoryProbe = void 0;
const memory_probe_1 = require("./memory_probe");
const init_guard_1 = require("./init_guard");
const memory_inventory_1 = require("./memory_inventory");
const startupSnapshots = [];
const delayedProbeTimers = [];
function recordStartupMemoryProbe(snapshot) {
    startupSnapshots.push(snapshot);
}
exports.recordStartupMemoryProbe = recordStartupMemoryProbe;
function probeStartupMemory(log, checkpoint) {
    const snapshot = (0, memory_probe_1.logMemoryProbe)(log, checkpoint);
    recordStartupMemoryProbe(snapshot);
    return snapshot;
}
exports.probeStartupMemory = probeStartupMemory;
function schedulePostReadyMemoryProbes(log) {
    clearPostReadyMemoryProbesForTest();
    for (const { delayMs, checkpoint } of [
        { delayMs: 30_000, checkpoint: "post_ready_30s" },
        { delayMs: 300_000, checkpoint: "post_ready_5m" },
    ]) {
        const timer = setTimeout(() => {
            probeStartupMemory(log, checkpoint);
        }, delayMs);
        timer.unref();
        delayedProbeTimers.push(timer);
    }
}
exports.schedulePostReadyMemoryProbes = schedulePostReadyMemoryProbes;
function clearPostReadyMemoryProbesForTest() {
    for (const timer of delayedProbeTimers) {
        clearTimeout(timer);
    }
    delayedProbeTimers.length = 0;
}
exports.clearPostReadyMemoryProbesForTest = clearPostReadyMemoryProbesForTest;
function getStartupMemorySnapshots() {
    return [...startupSnapshots];
}
exports.getStartupMemorySnapshots = getStartupMemorySnapshots;
function resetStartupMemoryDiagnosticsForTest() {
    startupSnapshots.length = 0;
    clearPostReadyMemoryProbesForTest();
}
exports.resetStartupMemoryDiagnosticsForTest = resetStartupMemoryDiagnosticsForTest;
function buildMemoryDiagnosticReport() {
    const checkpoints = [...startupSnapshots];
    let largestRssJump = null;
    let largestHeapJump = null;
    for (let i = 1; i < checkpoints.length; i++) {
        const delta = (0, memory_probe_1.memoryProbeDelta)(checkpoints[i - 1], checkpoints[i]);
        if (!largestRssJump || delta.rssMiB > largestRssJump.rssMiB) {
            largestRssJump = {
                fromCheckpoint: checkpoints[i - 1].checkpoint,
                toCheckpoint: checkpoints[i].checkpoint,
                rssMiB: delta.rssMiB,
                heapUsedMiB: delta.heapUsedMiB,
            };
        }
        if (!largestHeapJump || delta.heapUsedMiB > largestHeapJump.heapUsedMiB) {
            largestHeapJump = {
                fromCheckpoint: checkpoints[i - 1].checkpoint,
                toCheckpoint: checkpoints[i].checkpoint,
                rssMiB: delta.rssMiB,
                heapUsedMiB: delta.heapUsedMiB,
            };
        }
    }
    const last = checkpoints[checkpoints.length - 1];
    const initCountsObj = {};
    for (const [module, count] of (0, init_guard_1.getModuleInitCounts)()) {
        initCountsObj[module] = count;
    }
    return {
        checkpoints,
        largestRssJump,
        largestHeapJump,
        duplicateInits: (0, init_guard_1.getDuplicateModuleInits)(),
        initCounts: initCountsObj,
        inventoryModules: [...(0, memory_inventory_1.getMemoryInventorySnapshot)().keys()],
        finalExternalMiB: last?.externalMiB ?? null,
        finalArrayBuffersMiB: last?.arrayBuffersMiB ?? null,
        finalHeapUsedMiB: last?.heapUsedMiB ?? null,
    };
}
exports.buildMemoryDiagnosticReport = buildMemoryDiagnosticReport;
function logMemoryDiagnosticReport(log) {
    const report = buildMemoryDiagnosticReport();
    if (report.largestRssJump) {
        log?.info?.(`EMS mem-report largest_rss_jump=${report.largestRssJump.rssMiB}MiB ` +
            `heapUsed=${report.largestRssJump.heapUsedMiB}MiB ` +
            `from=${report.largestRssJump.fromCheckpoint} to=${report.largestRssJump.toCheckpoint}`);
    }
    if (report.duplicateInits.length > 0) {
        log?.info?.(`EMS mem-report duplicate_inits=${report.duplicateInits.map((m) => `${m.module}x${m.count}`).join(",")}`);
    }
    return report;
}
exports.logMemoryDiagnosticReport = logMemoryDiagnosticReport;
function getDelayedProbeTimerCountForTest() {
    return delayedProbeTimers.length;
}
exports.getDelayedProbeTimerCountForTest = getDelayedProbeTimerCountForTest;
function getDelayedProbeTimersUnrefForTest() {
    return delayedProbeTimers.map((timer) => {
        const refd = timer.hasRef;
        return typeof refd === "function" ? !refd.call(timer) : false;
    });
}
exports.getDelayedProbeTimersUnrefForTest = getDelayedProbeTimersUnrefForTest;
