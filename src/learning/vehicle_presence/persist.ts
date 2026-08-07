import * as fs from "node:fs/promises";
import * as path from "node:path";
import { atomicWriteFile } from "../../persistence/atomic_write";
import { MODULE_TAG, PERSIST_FILE } from "./constants";
import { emptyVehiclePresenceStore, type VehiclePresenceLearningStore } from "./types";

/**
 * v1 flat buckets (Tick-Inflation möglich) werden verworfen — kein Trust in alte Counts.
 * Nur schemaVersion 2 mit profiles wird geladen.
 */
export function normalizeVehiclePresenceStore(raw: unknown): VehiclePresenceLearningStore | null {
	if (!raw || typeof raw !== "object") return null;
	const o = raw as Record<string, unknown>;
	if (o.module !== MODULE_TAG) return null;
	if (o.schemaVersion === 2 && o.profiles && typeof o.profiles === "object") {
		return {
			module: MODULE_TAG,
			schemaVersion: 2,
			updatedAtIso: typeof o.updatedAtIso === "string" ? o.updatedAtIso : new Date().toISOString(),
			profiles: o.profiles as VehiclePresenceLearningStore["profiles"],
		};
	}
	return null;
}

export async function readVehiclePresencePersist(
	baseDir: string,
): Promise<VehiclePresenceLearningStore | null> {
	try {
		const raw = await fs.readFile(path.join(baseDir, PERSIST_FILE), "utf8");
		return normalizeVehiclePresenceStore(JSON.parse(raw));
	} catch {
		return null;
	}
}

export async function writeVehiclePresencePersist(
	baseDir: string,
	store: VehiclePresenceLearningStore,
): Promise<void> {
	await fs.mkdir(baseDir, { recursive: true });
	const payload: VehiclePresenceLearningStore = {
		...store,
		module: MODULE_TAG,
		schemaVersion: 2,
	};
	await atomicWriteFile(path.join(baseDir, PERSIST_FILE), `${JSON.stringify(payload, null, 2)}\n`);
}

export async function loadOrEmptyVehiclePresenceStore(
	baseDir: string | null | undefined,
): Promise<VehiclePresenceLearningStore> {
	if (!baseDir) return emptyVehiclePresenceStore();
	return (await readVehiclePresencePersist(baseDir)) ?? emptyVehiclePresenceStore();
}
