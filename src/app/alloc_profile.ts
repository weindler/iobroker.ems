/**
 * Zeitlich begrenzte Allokations-Messung (Node-Inspector, Sampling-Heap-Profiler).
 * Zeigt, welche Funktionen am meisten Speicher anfordern (auch kurzlebigen Müll).
 * Läuft nur in den ersten Minuten nach dem Adapterstart und stoppt dann von selbst.
 */
import * as inspector from "node:inspector";

export const APP_ALLOC_PROFILE_STATE = "app.alloc_profile_json";
export const ALLOC_PROFILE_MAX_MS = 25 * 60 * 1000;
const SAMPLING_INTERVAL_BYTES = 262_144;

export interface AllocTopEntry {
	fn: string;
	file: string;
	line: number;
	mb: number;
}
export interface AllocProfileSnapshot {
	updatedAt: string;
	sinceSec: number;
	running: boolean;
	totalMb: number;
	top: AllocTopEntry[];
	topFiles: Array<{ file: string; mb: number }>;
}

interface ProfileNode {
	callFrame: { functionName: string; url: string; lineNumber: number };
	selfSize: number;
	children?: ProfileNode[];
}

function shortFile(url: string): string {
	const i = url.lastIndexOf("/build/");
	if (i >= 0) return url.slice(i + 7);
	const j = url.lastIndexOf("/node_modules/");
	if (j >= 0) return "node_modules/" + url.slice(j + 14);
	return url.replace(/^node:/, "node:") || "(intern)";
}

/** Profilbaum zu den größten Verursachern zusammenfassen (rein, testbar). */
export function summarizeAllocProfile(head: ProfileNode, topN = 14): { totalMb: number; top: AllocTopEntry[]; topFiles: Array<{ file: string; mb: number }> } {
	const byFn = new Map<string, AllocTopEntry & { bytes: number }>();
	const byFile = new Map<string, number>();
	let total = 0;
	const stack: ProfileNode[] = [head];
	while (stack.length) {
		const n = stack.pop()!;
		if (n.selfSize > 0) {
			const file = shortFile(n.callFrame.url);
			const fn = n.callFrame.functionName || "(anonym)";
			const key = `${fn}|${file}|${n.callFrame.lineNumber}`;
			const cur = byFn.get(key) ?? { fn, file, line: n.callFrame.lineNumber + 1, mb: 0, bytes: 0 };
			cur.bytes += n.selfSize;
			byFn.set(key, cur);
			byFile.set(file, (byFile.get(file) ?? 0) + n.selfSize);
			total += n.selfSize;
		}
		if (n.children) for (const c of n.children) stack.push(c);
	}
	const mb = (b: number) => Math.round((b / 1_048_576) * 10) / 10;
	return {
		totalMb: mb(total),
		top: [...byFn.values()]
			.sort((a, b) => b.bytes - a.bytes)
			.slice(0, topN)
			.map((e) => ({ fn: e.fn, file: e.file, line: e.line, mb: mb(e.bytes) })),
		topFiles: [...byFile.entries()]
			.sort((a, b) => b[1] - a[1])
			.slice(0, 8)
			.map(([file, b]) => ({ file, mb: mb(b) })),
	};
}

let session: inspector.Session | null = null;
let startedMs = 0;

export function startAllocProfile(nowMs = Date.now()): boolean {
	if (session) return true;
	try {
		const s = new inspector.Session();
		s.connect();
		s.post("HeapProfiler.startSampling", {
			samplingInterval: SAMPLING_INTERVAL_BYTES,
			includeObjectsCollectedByMajorGC: true,
			includeObjectsCollectedByMinorGC: true,
		} as never);
		session = s;
		startedMs = nowMs;
		return true;
	} catch {
		session = null;
		return false;
	}
}

export function allocProfileRunning(): boolean {
	return session !== null;
}

/** Zwischenstand lesen; stoppt die Messung nach ALLOC_PROFILE_MAX_MS. */
export function snapshotAllocProfile(nowMs = Date.now()): Promise<AllocProfileSnapshot | null> {
	const s = session;
	if (!s) return Promise.resolve(null);
	const stop = nowMs - startedMs >= ALLOC_PROFILE_MAX_MS;
	return new Promise((resolve) => {
		s.post("HeapProfiler.getSamplingProfile", (err, res) => {
			if (err || !res) {
				resolve(null);
				return;
			}
			const sum = summarizeAllocProfile((res as { profile: { head: ProfileNode } }).profile.head);
			if (stop) {
				try {
					s.post("HeapProfiler.stopSampling", () => undefined);
					s.disconnect();
				} catch {
					/* ignorieren */
				}
				session = null;
			}
			resolve({
				updatedAt: new Date(nowMs).toISOString(),
				sinceSec: Math.round((nowMs - startedMs) / 1000),
				running: !stop,
				...sum,
			});
		});
	});
}

export function stopAllocProfile(): void {
	if (!session) return;
	try {
		session.post("HeapProfiler.stopSampling", () => undefined);
		session.disconnect();
	} catch {
		/* ignorieren */
	}
	session = null;
}
