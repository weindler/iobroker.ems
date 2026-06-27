import { createHash } from "node:crypto";
import { POLICY_SCHEMA_VERSION } from "./constants";
import { sortKeysDeep } from "./normalize";
import type { PolicyRevisionPayload, PolicySnapshot, PolicyValidationResult } from "./types";

export function stableStringify(value: unknown): string {
	return JSON.stringify(sortKeysDeep(value));
}

export function computePolicyRevisionHash(
	snapshot: PolicySnapshot,
	validation?: PolicyValidationResult,
): string {
	const payload: PolicyRevisionPayload = {
		schemaVersion: POLICY_SCHEMA_VERSION,
		content: {
			meta: snapshot.meta,
			capabilities: snapshot.capabilities,
			limits: snapshot.limits,
			preferences: snapshot.preferences,
			protection: snapshot.protection,
			economics: snapshot.economics,
			status: snapshot.status,
			provenance: snapshot.provenance,
			validation: {
				valid: validation?.valid ?? snapshot.validation.valid,
				status: validation?.status ?? snapshot.validation.status,
				issues: validation?.issues ?? snapshot.validation.issues,
			},
		},
	};
	return createHash("sha256").update(stableStringify(payload), "utf8").digest("hex");
}

export function revisionFromHash(hash: string): string {
	return hash.slice(0, 16);
}
