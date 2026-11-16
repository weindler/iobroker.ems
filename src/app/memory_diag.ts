/**
 * Speicher-Diagnose: zeigt, ob der Adapter-Speicher im JavaScript-Heap liegt oder
 * außerhalb (Puffer, Strings aus Socket-Antworten). Nur Messung, keine Steuerung.
 */

export const APP_MEMORY_STATE = "app.memory_json";
export const MEMORY_DIAG_INTERVAL_MS = 5 * 60_000;

export type MemoryPhase = { step: string; heapUsedMb: number; rssMb: number; atSec: number };

const phases: MemoryPhase[] = [];
const MAX_PHASES = 90;

/** Merkt sich den Speicherstand nach einem Startschritt (nur Messung). */
export function markMemoryPhase(step: string, usage: Usage = process.memoryUsage(), uptimeSec: number = process.uptime()): void {
	if (phases.length >= MAX_PHASES) return;
	phases.push({ step, heapUsedMb: mb(usage.heapUsed), rssMb: mb(usage.rss), atSec: Math.round(uptimeSec) });
}

export function getMemoryPhases(): MemoryPhase[] {
	return phases.slice();
}

/** Minütlicher Verlauf [Minuten seit Start, RSS MB, Heap MB] — zeigt, wann Sprünge entstehen. */
const series: Array<[number, number, number]> = [];
const MAX_SERIES = 180;

export function recordMemorySample(usage: Usage = process.memoryUsage(), uptimeSec: number = process.uptime()): void {
	series.push([Math.round((uptimeSec / 60) * 10) / 10, Math.round(usage.rss / MB), Math.round(usage.heapUsed / MB)]);
	if (series.length > MAX_SERIES) series.shift();
}

export function getMemorySeries(): Array<[number, number, number]> {
	return series.slice();
}

/**
 * Messung des stündlichen Lernlaufs: pro Schritt Dauer, Speicher danach und Spitzenwert (RSS/Heap)
 * seit dem vorigen Schritt. Zeigt, welches Lernmodul die Stundenspitze verursacht.
 */
export type LearningTickStep = { step: string; ms: number; rssMb: number; heapMb: number; peakRssMb: number; peakHeapMb: number };
export type LearningTickProfile = { startedAt: string; trigger: string; totalMs: number; peakRssMb: number; steps: LearningTickStep[] };

const TICK_SAMPLE_MS = 100;
let tickTimer: NodeJS.Timeout | null = null;
let tickSteps: LearningTickStep[] = [];
let tickStartedMs = 0;
let tickLastMs = 0;
let tickPeakRss = 0;
let tickPeakHeap = 0;
let tickTrigger = "";
let lastTickProfile: LearningTickProfile | null = null;

function tickSample(): void {
	const u = process.memoryUsage();
	if (u.rss > tickPeakRss) tickPeakRss = u.rss;
	if (u.heapUsed > tickPeakHeap) tickPeakHeap = u.heapUsed;
}

export function tickProfileStart(trigger: string, nowMs: number = Date.now()): void {
	if (tickTimer) clearInterval(tickTimer);
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

export function tickProfileMark(step: string, nowMs: number = Date.now()): void {
	if (!tickTimer) return;
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

export function tickProfileEnd(nowMs: number = Date.now()): void {
	if (!tickTimer) return;
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

export function getLearningTickProfile(): LearningTickProfile | null {
	return lastTickProfile;
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
	/** [Minuten seit Start, RSS MB, Heap MB], eine Zeile pro Minute (letzte 3 Stunden). */
	series: Array<[number, number, number]>;
	/** Letzter Lernlauf, Schritt für Schritt (Dauer, Speicher, Spitze). */
	learningTick: LearningTickProfile | null;
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
		series: getMemorySeries(),
		learningTick: getLearningTickProfile(),
	};
}
