import * as fs from "node:fs/promises";
import { atomicWriteJson } from "../persistence/atomic_write";
import { stableJsonStringify } from "../backup/schema";

export interface BootGuardRecord {
	dataEpoch: string;
	highestCheckpointGeneration: number;
	checkpointId: string;
	adapterVersion: string;
	lastSuccessfulBootstrapAt: string;
}

export async function readBootGuard(bootGuardPath: string): Promise<BootGuardRecord | null> {
	try {
		const raw = await fs.readFile(bootGuardPath, "utf8");
		return JSON.parse(raw) as BootGuardRecord;
	} catch {
		return null;
	}
}

export async function writeBootGuardAtomic(bootGuardPath: string, record: BootGuardRecord): Promise<void> {
	await atomicWriteJson(bootGuardPath, record, stableJsonStringify);
}

export type RestoreDetection =
	| "none"
	| "first_start"
	| "new_host"
	| "normal_restart"
	| "rollback_suspected"
	| "foreign_timeline"
	| "manifest_invalid"
	| "journal_quarantined"
	| "migration_failed";

export function diagnoseRestoreDetection(input: {
	bootGuard: BootGuardRecord | null;
	manifestEpoch: string;
	manifestGeneration: number;
	manifestCheckpointId: string;
}): RestoreDetection {
	if (!input.bootGuard) {
		return "first_start";
	}
	if (input.bootGuard.dataEpoch !== input.manifestEpoch) {
		return "foreign_timeline";
	}
	if (input.manifestGeneration < input.bootGuard.highestCheckpointGeneration) {
		return "rollback_suspected";
	}
	if (
		input.manifestGeneration === input.bootGuard.highestCheckpointGeneration &&
		input.manifestCheckpointId === input.bootGuard.checkpointId
	) {
		return "normal_restart";
	}
	return "none";
}
