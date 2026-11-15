/**
 * Speicher-Diagnose: zeigt, ob der Adapter-Speicher im JavaScript-Heap liegt oder
 * außerhalb (Puffer, Strings aus Socket-Antworten). Nur Messung, keine Steuerung.
 */

export const APP_MEMORY_STATE = "app.memory_json";
export const MEMORY_DIAG_INTERVAL_MS = 5 * 60_000;

export type MemoryPhase = { step: string; heapUsedMb: number; rssMb: number; atSec: number };

const phases: MemoryPhase[] = [];
const MAX_PHASES = 60;

/** Merkt sich den Speicherstand nach einem Startschritt (nur Messung). */
export function markMemoryPhase(step: string, usage: Usage = process.memoryUsage(), uptimeSec: number = process.uptime()): void {
	if (phases.length >= MAX_PHASES) return;
	phases.push({ step, heapUsedMb: mb(usage.heapUsed), rssMb: mb(usage.rss), atSec: Math.round(uptimeSec) });
}

export function getMemoryPhases(): MemoryPhase[] {
	return phases.slice();
}

export type MemoryDiagnostics = {
	updatedAt: string;
	uptimeMin: number;
	rssMb: number;
	heapUsedMb: number;
	heapTotalMb: number;
	externalMb: number;
	arrayBuffersMb: number;
	/** RSS minus Heap: Speicher, den der JS-Garbage-Collector nicht steuert. */
	outsideHeapMb: number;
	rssPeakMb: number;
	hintDe: string;
	startupPhases: MemoryPhase[];
};

type Usage = { rss: number; heapUsed: number; heapTotal: number; external: number; arrayBuffers: number };

const MB = 1024 * 1024;
const mb = (n: number): number => Math.round((n / MB) * 10) / 10;

export function buildMemoryDiagnostics(usage: Usage, nowMs: number, uptimeSec: number, previousPeakMb: number): MemoryDiagnostics {
	const rssMb = mb(usage.rss);
	const outside = mb(usage.rss - usage.heapTotal);
	let hintDe: string;
	if (rssMb < 250) hintDe = "Speicherverbrauch unauffällig.";
	else if (mb(usage.external + usage.arrayBuffers) > outside * 0.5)
		hintDe = "Viel Speicher liegt in Puffern (z. B. große Antworten vom History-Adapter).";
	else hintDe = "Der Speicher liegt überwiegend außerhalb von JavaScript-Heap und Puffern (Fragmentierung nach großen Lernläufen).";
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
	};
}
