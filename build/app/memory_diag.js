"use strict";
/**
 * Speicher-Diagnose: zeigt, ob der Adapter-Speicher im JavaScript-Heap liegt oder
 * außerhalb (Puffer, Strings aus Socket-Antworten). Nur Messung, keine Steuerung.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MEMORY_DIAG_INTERVAL_MS = exports.APP_MEMORY_STATE = void 0;
exports.markMemoryPhase = markMemoryPhase;
exports.getMemoryPhases = getMemoryPhases;
exports.recordMemorySample = recordMemorySample;
exports.getMemorySeries = getMemorySeries;
exports.tickProfileStart = tickProfileStart;
exports.tickProfileMark = tickProfileMark;
exports.tickProfileEnd = tickProfileEnd;
exports.getLearningTickProfile = getLearningTickProfile;
exports.buildMemoryDiagnostics = buildMemoryDiagnostics;
exports.APP_MEMORY_STATE = "app.memory_json";
exports.MEMORY_DIAG_INTERVAL_MS = 5 * 60_000;
const phases = [];
const MAX_PHASES = 90;
/** Merkt sich den Speicherstand nach einem Startschritt (nur Messung). */
function markMemoryPhase(step, usage = process.memoryUsage(), uptimeSec = process.uptime()) {
    if (phases.length >= MAX_PHASES)
        return;
    phases.push({ step, heapUsedMb: mb(usage.heapUsed), rssMb: mb(usage.rss), atSec: Math.round(uptimeSec) });
}
function getMemoryPhases() {
    return phases.slice();
}
/** Minütlicher Verlauf [Minuten seit Start, RSS MB, Heap MB] — zeigt, wann Sprünge entstehen. */
const series = [];
const MAX_SERIES = 180;
function recordMemorySample(usage = process.memoryUsage(), uptimeSec = process.uptime()) {
    series.push([Math.round((uptimeSec / 60) * 10) / 10, Math.round(usage.rss / MB), Math.round(usage.heapUsed / MB)]);
    if (series.length > MAX_SERIES)
        series.shift();
}
function getMemorySeries() {
    return series.slice();
}
const TICK_SAMPLE_MS = 100;
let tickTimer = null;
let tickSteps = [];
let tickStartedMs = 0;
let tickLastMs = 0;
let tickPeakRss = 0;
let tickPeakHeap = 0;
let tickTrigger = "";
let lastTickProfile = null;
function tickSample() {
    const u = process.memoryUsage();
    if (u.rss > tickPeakRss)
        tickPeakRss = u.rss;
    if (u.heapUsed > tickPeakHeap)
        tickPeakHeap = u.heapUsed;
}
function tickProfileStart(trigger, nowMs = Date.now()) {
    if (tickTimer)
        clearInterval(tickTimer);
    tickSteps = [];
    tickStartedMs = nowMs;
    tickLastMs = nowMs;
    tickPeakRss = 0;
    tickPeakHeap = 0;
    tickTrigger = trigger;
    tickSample();
    tickTimer = setInterval(tickSample, TICK_SAMPLE_MS);
    tickTimer.unref?.();
}
function tickProfileMark(step, nowMs = Date.now()) {
    if (!tickTimer)
        return;
    tickSample();
    const u = process.memoryUsage();
    if (tickSteps.length < 60) {
        tickSteps.push({
            step,
            ms: nowMs - tickLastMs,
            rssMb: mb(u.rss),
            heapMb: mb(u.heapUsed),
            peakRssMb: mb(tickPeakRss),
            peakHeapMb: mb(tickPeakHeap),
        });
    }
    tickLastMs = nowMs;
    tickPeakRss = u.rss;
    tickPeakHeap = u.heapUsed;
}
function tickProfileEnd(nowMs = Date.now()) {
    if (!tickTimer)
        return;
    tickSample();
    clearInterval(tickTimer);
    tickTimer = null;
    lastTickProfile = {
        startedAt: new Date(tickStartedMs).toISOString(),
        trigger: tickTrigger,
        totalMs: nowMs - tickStartedMs,
        peakRssMb: Math.max(0, ...tickSteps.map((x) => x.peakRssMb)),
        steps: tickSteps,
    };
}
function getLearningTickProfile() {
    return lastTickProfile;
}
const MB = 1024 * 1024;
const mb = (n) => Math.round((n / MB) * 10) / 10;
function buildMemoryDiagnostics(usage, nowMs, uptimeSec, previousPeakMb) {
    const rssMb = mb(usage.rss);
    const outside = mb(usage.rss - usage.heapTotal);
    let hintDe;
    if (rssMb < 250)
        hintDe = "Speicherverbrauch unauffällig.";
    else if (mb(usage.external + usage.arrayBuffers) > outside * 0.5)
        hintDe = "Viel Speicher liegt in Puffern (z. B. große Antworten vom History-Adapter).";
    else
        hintDe = "Der Speicher liegt überwiegend außerhalb von JavaScript-Heap und Puffern (Fragmentierung nach großen Lernläufen).";
    return {
        updatedAt: new Date(nowMs).toISOString(),
        uptimeMin: Math.round(uptimeSec / 60),
        rssMb,
        heapUsedMb: mb(usage.heapUsed),
        heapTotalMb: mb(usage.heapTotal),
        externalMb: mb(usage.external),
        arrayBuffersMb: mb(usage.arrayBuffers),
        outsideHeapMb: outside,
        rssPeakMb: Math.max(previousPeakMb, rssMb),
        hintDe,
        startupPhases: getMemoryPhases(),
        series: getMemorySeries(),
        learningTick: getLearningTickProfile(),
    };
}
