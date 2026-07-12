import { randomUUID } from "node:crypto";
import { stableJsonStringify } from "../backup/schema";
import { atomicWriteJson } from "../persistence/atomic_write";

export const MANIFEST_FORMAT = "ems-light-instance-data";
export const MANIFEST_FORMAT_VERSION = 1;
export const PERSISTENCE_SCHEMA_VERSION = 1;

export interface ManifestTransactionFence {
	transactionId: string;
	status: "prepared" | "applying" | "committed" | "rolled_back";
}

export interface EmsInstanceManifest {
	format: typeof MANIFEST_FORMAT;
	formatVersion: typeof MANIFEST_FORMAT_VERSION;
	adapter: "ems";
	instance: number;
	namespace: string;
	adapterVersion: string;
	persistenceSchemaVersion: typeof PERSISTENCE_SCHEMA_VERSION;
	dataEpoch: string;
	checkpointGeneration: number;
	checkpointId: string;
	transactionFence: ManifestTransactionFence | null;
	createdAt: string;
	updatedAt: string;
}

export function newDataEpoch(): string {
	return randomUUID();
}

export function newCheckpointId(): string {
	return randomUUID();
}

export function createInitialManifest(input: {
	instance: number;
	namespace: string;
	adapterVersion: string;
}): EmsInstanceManifest {
	const now = new Date().toISOString();
	return {
		format: MANIFEST_FORMAT,
		formatVersion: MANIFEST_FORMAT_VERSION,
		adapter: "ems",
		instance: input.instance,
		namespace: input.namespace,
		adapterVersion: input.adapterVersion,
		persistenceSchemaVersion: PERSISTENCE_SCHEMA_VERSION,
		dataEpoch: newDataEpoch(),
		checkpointGeneration: 1,
		checkpointId: newCheckpointId(),
		transactionFence: null,
		createdAt: now,
		updatedAt: now,
	};
}

export async function writeManifestAtomic(manifestPath: string, manifest: EmsInstanceManifest): Promise<void> {
	const payload = { ...manifest, updatedAt: new Date().toISOString() };
	await atomicWriteJson(manifestPath, payload, stableJsonStringify, (parsed) => {
		validateManifest(parsed);
	});
}

export function validateManifest(raw: unknown): EmsInstanceManifest {
	if (!raw || typeof raw !== "object") {
		throw new Error("manifest_invalid");
	}
	const m = raw as Partial<EmsInstanceManifest>;
	if (m.format !== MANIFEST_FORMAT) throw new Error("manifest_invalid_format");
	if (m.formatVersion !== MANIFEST_FORMAT_VERSION) throw new Error("manifest_unsupported_format_version");
	if (m.adapter !== "ems") throw new Error("manifest_invalid_adapter");
	if (typeof m.instance !== "number" || m.instance < 0) throw new Error("manifest_invalid_instance");
	if (typeof m.namespace !== "string" || !m.namespace.startsWith("ems.")) throw new Error("manifest_invalid_namespace");
	if (typeof m.adapterVersion !== "string") throw new Error("manifest_invalid");
	if (m.persistenceSchemaVersion !== PERSISTENCE_SCHEMA_VERSION) {
		throw new Error("manifest_unsupported_persistence_schema");
	}
	if (typeof m.dataEpoch !== "string" || !m.dataEpoch) throw new Error("manifest_invalid_epoch");
	if (typeof m.checkpointGeneration !== "number" || m.checkpointGeneration < 1) {
		throw new Error("manifest_invalid_checkpoint_generation");
	}
	if (typeof m.checkpointId !== "string" || !m.checkpointId) throw new Error("manifest_invalid_checkpoint_id");
	if (m.transactionFence != null) {
		const fence = m.transactionFence as Partial<ManifestTransactionFence>;
		if (typeof fence.transactionId !== "string" || !fence.transactionId) {
			throw new Error("manifest_invalid_fence");
		}
	}
	return m as EmsInstanceManifest;
}

export function manifestMatchesInstance(manifest: EmsInstanceManifest, namespace: string, instance: number): boolean {
	return manifest.namespace === namespace && manifest.instance === instance;
}

export async function beginRestoreTransactionFence(
	manifestPath: string,
	manifest: EmsInstanceManifest,
	transactionId: string,
): Promise<EmsInstanceManifest> {
	const next: EmsInstanceManifest = {
		...manifest,
		checkpointGeneration: manifest.checkpointGeneration + 1,
		checkpointId: newCheckpointId(),
		transactionFence: { transactionId, status: "prepared" },
	};
	await writeManifestAtomic(manifestPath, next);
	return next;
}

export async function finalizeRestoreTransactionFence(
	manifestPath: string,
	manifest: EmsInstanceManifest,
	outcome: "committed" | "rolled_back",
): Promise<EmsInstanceManifest> {
	const next: EmsInstanceManifest = {
		...manifest,
		checkpointGeneration: manifest.checkpointGeneration + 1,
		checkpointId: newCheckpointId(),
		transactionFence: null,
	};
	void outcome;
	await writeManifestAtomic(manifestPath, next);
	return next;
}
