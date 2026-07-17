import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
	TAKEOVER_RETENTION_MAX_AGE_MS,
	TAKEOVER_RETENTION_MAX_RECENT,
	TAKEOVER_RETENTION_MAX_TOTAL_BYTES,
} from "./constants";

export interface CandidateRetentionOptions {
	candidateRootDir: string;
	/** Job ids that must never be deleted (active). */
	protectedJobIds?: ReadonlySet<string> | readonly string[];
	/** Prefer keeping these directories even if older. */
	keepJobIds?: ReadonlySet<string> | readonly string[];
	nowMs?: number;
	maxRecent?: number;
	maxAgeMs?: number;
	maxTotalBytes?: number;
}

export interface CandidateRetentionResult {
	deleted: string[];
	kept: string[];
	errors: string[];
	totalBytesAfter: number;
}

function toSet(v: ReadonlySet<string> | readonly string[] | undefined): Set<string> {
	if (!v) return new Set();
	return v instanceof Set ? new Set(v) : new Set(v);
}

/**
 * Prune candidate job directories under runtime candidate root.
 * Never touches canonical paths. Never deletes protected (active) jobs.
 * Failures are isolated into errors[].
 */
export async function retainPlannerCandidates(options: CandidateRetentionOptions): Promise<CandidateRetentionResult> {
	const root = options.candidateRootDir;
	const protectedIds = toSet(options.protectedJobIds);
	const keepIds = toSet(options.keepJobIds);
	const nowMs = options.nowMs ?? Date.now();
	const maxRecent = options.maxRecent ?? TAKEOVER_RETENTION_MAX_RECENT;
	const maxAgeMs = options.maxAgeMs ?? TAKEOVER_RETENTION_MAX_AGE_MS;
	const maxTotalBytes = options.maxTotalBytes ?? TAKEOVER_RETENTION_MAX_TOTAL_BYTES;

	const deleted: string[] = [];
	const kept: string[] = [];
	const errors: string[] = [];

	let entries: Array<{ name: string; mtimeMs: number; size: number }> = [];
	try {
		const names = await fs.readdir(root);
		for (const name of names) {
			const full = path.join(root, name);
			try {
				const st = await fs.stat(full);
				if (!st.isDirectory()) continue;
				entries.push({ name, mtimeMs: st.mtimeMs, size: await dirSize(full) });
			} catch (e) {
				errors.push(`${name}:${String(e)}`);
			}
		}
	} catch (e) {
		return { deleted, kept, errors: [`readdir:${String(e)}`], totalBytesAfter: 0 };
	}

	entries.sort((a, b) => b.mtimeMs - a.mtimeMs);

	const mustKeep = new Set<string>([...protectedIds, ...keepIds]);
	// Always keep newest recent window
	for (let i = 0; i < Math.min(maxRecent, entries.length); i++) {
		mustKeep.add(entries[i]!.name);
	}

	let totalBytes = entries.reduce((s, e) => s + e.size, 0);
	for (const entry of entries) {
		const age = nowMs - entry.mtimeMs;
		const overAge = age > maxAgeMs;
		const overBytes = totalBytes > maxTotalBytes;
		const overCount = entries.filter((e) => !deleted.includes(e.name)).length > maxRecent;
		const forcedKeep = mustKeep.has(entry.name) || protectedIds.has(entry.name);
		if (forcedKeep) {
			kept.push(entry.name);
			continue;
		}
		if (overAge || (overBytes && overCount) || overCount) {
			try {
				await fs.rm(path.join(root, entry.name), { recursive: true, force: true });
				deleted.push(entry.name);
				totalBytes -= entry.size;
			} catch (e) {
				errors.push(`${entry.name}:${String(e)}`);
				kept.push(entry.name);
			}
		} else {
			kept.push(entry.name);
		}
	}

	return { deleted, kept, errors, totalBytesAfter: Math.max(0, totalBytes) };
}

async function dirSize(dir: string): Promise<number> {
	let total = 0;
	const stack = [dir];
	while (stack.length) {
		const cur = stack.pop()!;
		const names = await fs.readdir(cur);
		for (const name of names) {
			const full = path.join(cur, name);
			const st = await fs.stat(full);
			if (st.isDirectory()) stack.push(full);
			else total += st.size;
		}
	}
	return total;
}
