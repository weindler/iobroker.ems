import {
	captureMemoryProbe,
	logMemoryProbe,
	memoryProbeDelta,
	type MemoryProbeLogger,
	type MemoryProbeSnapshot,
} from "./memory_probe";
import { getDuplicateModuleInits, getModuleInitCounts } from "./init_guard";
import { getMemoryInventorySnapshot } from "./memory_inventory";

const startupSnapshots: MemoryProbeSnapshot[] = [];
const delayedProbeTimers: NodeJS.Timeout[] = [];

export function recordStartupMemoryProbe(snapshot: MemoryProbeSnapshot): void {
	startupSnapshots.push(snapshot);
}

export function probeStartupMemory(
	log: MemoryProbeLogger | undefined,
	checkpoint: string,
): MemoryProbeSnapshot {
	const snapshot = logMemoryProbe(log, checkpoint);
	recordStartupMemoryProbe(snapshot);
	return snapshot;
}

export function schedulePostReadyMemoryProbes(log: MemoryProbeLogger | undefined): void {
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

export function clearPostReadyMemoryProbesForTest(): void {
	for (const timer of delayedProbeTimers) {
		clearTimeout(timer);
	}
	delayedProbeTimers.length = 0;
}

export function getStartupMemorySnapshots(): readonly MemoryProbeSnapshot[] {
	return [...startupSnapshots];
}

export function resetStartupMemoryDiagnosticsForTest(): void {
	startupSnapshots.length = 0;
	clearPostReadyMemoryProbesForTest();
}

export interface MemoryDiagnosticReport {
	checkpoints: MemoryProbeSnapshot[];
	largestRssJump: {
		fromCheckpoint: string;
		toCheckpoint: string;
		rssMiB: number;
		heapUsedMiB: number;
	} | null;
	largestHeapJump: {
		fromCheckpoint: string;
		toCheckpoint: string;
		rssMiB: number;
		heapUsedMiB: number;
	} | null;
	duplicateInits: ReturnType<typeof getDuplicateModuleInits>;
	initCounts: Record<string, number>;
	inventoryModules: string[];
	finalExternalMiB: number | null;
	finalArrayBuffersMiB: number | null;
	finalHeapUsedMiB: number | null;
}

export function buildMemoryDiagnosticReport(): MemoryDiagnosticReport {
	const checkpoints = [...startupSnapshots];
	let largestRssJump: MemoryDiagnosticReport["largestRssJump"] = null;
	let largestHeapJump: MemoryDiagnosticReport["largestHeapJump"] = null;

	for (let i = 1; i < checkpoints.length; i++) {
		const delta = memoryProbeDelta(checkpoints[i - 1], checkpoints[i]);
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
	const initCountsObj: Record<string, number> = {};
	for (const [module, count] of getModuleInitCounts()) {
		initCountsObj[module] = count;
	}

	return {
		checkpoints,
		largestRssJump,
		largestHeapJump,
		duplicateInits: getDuplicateModuleInits(),
		initCounts: initCountsObj,
		inventoryModules: [...getMemoryInventorySnapshot().keys()],
		finalExternalMiB: last?.externalMiB ?? null,
		finalArrayBuffersMiB: last?.arrayBuffersMiB ?? null,
		finalHeapUsedMiB: last?.heapUsedMiB ?? null,
	};
}

export function logMemoryDiagnosticReport(log: MemoryProbeLogger | undefined): MemoryDiagnosticReport {
	const report = buildMemoryDiagnosticReport();
	if (report.largestRssJump) {
		log?.info?.(
			`EMS mem-report largest_rss_jump=${report.largestRssJump.rssMiB}MiB ` +
				`heapUsed=${report.largestRssJump.heapUsedMiB}MiB ` +
				`from=${report.largestRssJump.fromCheckpoint} to=${report.largestRssJump.toCheckpoint}`,
		);
	}
	if (report.duplicateInits.length > 0) {
		log?.info?.(
			`EMS mem-report duplicate_inits=${report.duplicateInits.map((m) => `${m.module}x${m.count}`).join(",")}`,
		);
	}
	return report;
}

export function getDelayedProbeTimerCountForTest(): number {
	return delayedProbeTimers.length;
}

export function getDelayedProbeTimersUnrefForTest(): boolean[] {
	return delayedProbeTimers.map((timer) => {
		const refd = (timer as NodeJS.Timeout & { hasRef?: () => boolean }).hasRef;
		return typeof refd === "function" ? !refd.call(timer) : false;
	});
}
