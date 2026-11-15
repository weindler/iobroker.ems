"use strict";
/**
 * Speicher-Diagnose: zeigt, ob der Adapter-Speicher im JavaScript-Heap liegt oder
 * außerhalb (Puffer, Strings aus Socket-Antworten). Nur Messung, keine Steuerung.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MEMORY_DIAG_INTERVAL_MS = exports.APP_MEMORY_STATE = void 0;
exports.buildMemoryDiagnostics = buildMemoryDiagnostics;
exports.APP_MEMORY_STATE = "app.memory_json";
exports.MEMORY_DIAG_INTERVAL_MS = 5 * 60_000;
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
    };
}
