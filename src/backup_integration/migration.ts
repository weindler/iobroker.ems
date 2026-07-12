import * as fs from "node:fs/promises";
import * as path from "node:path";
import { atomicWriteJson } from "../persistence/atomic_write";
import { stableJsonStringify } from "../backup/schema";
import type { EmsPathLayout } from "./paths";

export type MigrationStatusValue = "pending" | "in_progress" | "completed" | "failed";

export interface MigrationStatusRecord {
	schema_version: 1;
	status: MigrationStatusValue;
	started_at: string | null;
	completed_at: string | null;
	last_error: string | null;
	moved_entries: string[];
}

export function emptyMigrationStatus(): MigrationStatusRecord {
	return {
		schema_version: 1,
		status: "pending",
		started_at: null,
		completed_at: null,
		last_error: null,
		moved_entries: [],
	};
}

export async function readMigrationStatus(migrationStatusPath: string): Promise<MigrationStatusRecord | null> {
	try {
		const raw = await fs.readFile(migrationStatusPath, "utf8");
		return JSON.parse(raw) as MigrationStatusRecord;
	} catch {
		return null;
	}
}

async function writeMigrationStatus(migrationStatusPath: string, record: MigrationStatusRecord): Promise<void> {
	await atomicWriteJson(migrationStatusPath, record, stableJsonStringify);
}

interface MoveSpec {
	key: string;
	legacyRelative: string;
	targetRelative: string;
}

const RUNTIME_MOVE_SPECS: readonly MoveSpec[] = [
	{ key: "intent", legacyRelative: "intent", targetRelative: "runtime/intent" },
	{ key: "global_modes", legacyRelative: "global_modes", targetRelative: "runtime/global_modes" },
	{ key: "immersion_heater", legacyRelative: "immersion_heater", targetRelative: "runtime/addons/immersion_heater" },
	{ key: "air_conditioning", legacyRelative: "air_conditioning", targetRelative: "runtime/addons/air_conditioning" },
	{ key: "exports", legacyRelative: "exports", targetRelative: "exports" },
	{ key: "restore_inbox", legacyRelative: "restore/inbox", targetRelative: "restore/inbox" },
];

async function pathExists(p: string): Promise<boolean> {
	try {
		await fs.access(p);
		return true;
	} catch {
		return false;
	}
}

async function dirEmpty(p: string): Promise<boolean> {
	try {
		const entries = await fs.readdir(p);
		return entries.length === 0;
	} catch {
		return true;
	}
}

async function moveDirectoryAtomic(source: string, target: string): Promise<void> {
	if (!(await pathExists(source))) {
		return;
	}
	await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
	if (await pathExists(target)) {
		if (await dirEmpty(target)) {
			await fs.rmdir(target).catch(() => undefined);
		} else {
			throw new Error(`migration_target_conflict:${target}`);
		}
	}
	await fs.rename(source, target);
}

export interface MigrationResult {
	ok: boolean;
	status: MigrationStatusValue;
	error?: string;
}

export async function runRuntimeMigration(
	layout: EmsPathLayout,
	options: { skipTransactions?: boolean } = {},
): Promise<MigrationResult> {
	const existing = (await readMigrationStatus(layout.migrationStatusPath)) ?? emptyMigrationStatus();
	if (existing.status === "completed") {
		return { ok: true, status: "completed" };
	}

	const inProgress: MigrationStatusRecord = {
		...existing,
		status: "in_progress",
		started_at: existing.started_at ?? new Date().toISOString(),
		last_error: null,
	};
	await writeMigrationStatus(layout.migrationStatusPath, inProgress);

	try {
		const stagingRoot = path.join(layout.runtimeTempDir, "migration-staging");
		if (await pathExists(stagingRoot)) {
			await fs.rm(stagingRoot, { recursive: true, force: true });
		}

		const moved: string[] = [...existing.moved_entries];

		for (const spec of RUNTIME_MOVE_SPECS) {
			const legacy = path.join(layout.durableDataDir, spec.legacyRelative);
			const target = path.join(layout.runtimeDataDir, spec.targetRelative);
			if (!(await pathExists(legacy))) {
				continue;
			}
			if (await pathExists(target) && !(await dirEmpty(target))) {
				throw new Error(`migration_target_conflict:${spec.key}`);
			}
			await moveDirectoryAtomic(legacy, target);
			moved.push(spec.key);
		}

		if (!options.skipTransactions) {
			const legacyTx = layout.legacyTransactionsDir;
			const targetTx = layout.runtimeTransactionsDir;
			if (await pathExists(legacyTx)) {
				if (await pathExists(targetTx) && !(await dirEmpty(targetTx))) {
					throw new Error("migration_target_conflict:restore_transactions");
				}
				await moveDirectoryAtomic(legacyTx, targetTx);
				moved.push("restore_transactions");
			}
			const legacyRestoreRoot = path.join(layout.durableDataDir, "restore");
			if (await pathExists(legacyRestoreRoot) && (await dirEmpty(legacyRestoreRoot))) {
				await fs.rmdir(legacyRestoreRoot).catch(() => undefined);
			}
		}

		const completed: MigrationStatusRecord = {
			schema_version: 1,
			status: "completed",
			started_at: inProgress.started_at,
			completed_at: new Date().toISOString(),
			last_error: null,
			moved_entries: [...new Set(moved)],
		};
		await writeMigrationStatus(layout.migrationStatusPath, completed);
		return { ok: true, status: "completed" };
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		const failed: MigrationStatusRecord = {
			...inProgress,
			status: "failed",
			last_error: msg,
		};
		await writeMigrationStatus(layout.migrationStatusPath, failed).catch(() => undefined);
		return { ok: false, status: "failed", error: msg };
	}
}

export async function legacyRuntimePathsRemain(layout: EmsPathLayout): Promise<string[]> {
	const remain: string[] = [];
	for (const spec of RUNTIME_MOVE_SPECS) {
		if (await pathExists(path.join(layout.durableDataDir, spec.legacyRelative))) {
			remain.push(spec.legacyRelative);
		}
	}
	if (await pathExists(layout.legacyTransactionsDir)) {
		remain.push("restore/transactions");
	}
	return remain;
}
