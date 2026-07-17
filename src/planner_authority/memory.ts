/** Diagnostic memory helpers — used for authority RSS snapshots, never for control. */

const BYTES_PER_MIB = 1024 * 1024;

export function bytesToMiB(bytes: number): number {
	return Math.round((bytes / BYTES_PER_MIB) * 10) / 10;
}

export interface RssSnapshot {
	rssMiB: number;
	heapUsedMiB: number;
	externalMiB: number;
	capturedAt: string;
}

export function captureRssSnapshot(nowMs: number = Date.now()): RssSnapshot {
	const mem = process.memoryUsage();
	return {
		rssMiB: bytesToMiB(mem.rss),
		heapUsedMiB: bytesToMiB(mem.heapUsed),
		externalMiB: bytesToMiB(mem.external ?? 0),
		capturedAt: new Date(nowMs).toISOString(),
	};
}
