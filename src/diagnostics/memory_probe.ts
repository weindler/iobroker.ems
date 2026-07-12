import v8 from "node:v8";

export interface MemoryProbeSnapshot {
	checkpoint: string;
	atMs: number;
	rssMiB: number;
	heapTotalMiB: number;
	heapUsedMiB: number;
	externalMiB: number;
	arrayBuffersMiB: number;
	maxRssMiB: number | null;
	v8HeapSizeLimitMiB: number;
	v8TotalHeapSizeMiB: number;
	v8UsedHeapSizeMiB: number;
	v8MallocedMemoryMiB: number;
	v8ExternalMemoryMiB: number;
}

function bytesToMiB(bytes: number): number {
	return Math.round((bytes / (1024 * 1024)) * 100) / 100;
}

export function captureMemoryProbe(checkpoint: string, atMs = Date.now()): MemoryProbeSnapshot {
	const usage = process.memoryUsage();
	const resourceUsage =
		typeof process.resourceUsage === "function" ? process.resourceUsage() : undefined;
	const stats = v8.getHeapStatistics();
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

export function formatMemoryProbeLine(snapshot: MemoryProbeSnapshot): string {
	return (
		`EMS mem[${snapshot.checkpoint}] ` +
		`rss=${snapshot.rssMiB}MiB ` +
		`heapUsed=${snapshot.heapUsedMiB}MiB ` +
		`heapTotal=${snapshot.heapTotalMiB}MiB ` +
		`external=${snapshot.externalMiB}MiB ` +
		`arrayBuffers=${snapshot.arrayBuffersMiB}MiB ` +
		(snapshot.maxRssMiB !== null ? `maxRss=${snapshot.maxRssMiB}MiB ` : "") +
		`v8_used=${snapshot.v8UsedHeapSizeMiB}MiB ` +
		`v8_limit=${snapshot.v8HeapSizeLimitMiB}MiB`
	);
}

export type MemoryProbeLogger = {
	info?: (msg: string) => void;
	debug?: (msg: string) => void;
};

export function logMemoryProbe(
	log: MemoryProbeLogger | undefined,
	checkpoint: string,
	atMs?: number,
): MemoryProbeSnapshot {
	const snapshot = captureMemoryProbe(checkpoint, atMs);
	const line = formatMemoryProbeLine(snapshot);
	log?.info?.(line);
	return snapshot;
}

export function memoryProbeDelta(
	from: MemoryProbeSnapshot,
	to: MemoryProbeSnapshot,
): { rssMiB: number; heapUsedMiB: number; externalMiB: number; arrayBuffersMiB: number } {
	return {
		rssMiB: Math.round((to.rssMiB - from.rssMiB) * 100) / 100,
		heapUsedMiB: Math.round((to.heapUsedMiB - from.heapUsedMiB) * 100) / 100,
		externalMiB: Math.round((to.externalMiB - from.externalMiB) * 100) / 100,
		arrayBuffersMiB: Math.round((to.arrayBuffersMiB - from.arrayBuffersMiB) * 100) / 100,
	};
}
