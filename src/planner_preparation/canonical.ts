import { createHash } from "node:crypto";
import { PREPARATION_REVISION_EXCLUDED_KEYS } from "./constants";
import type { PlannerPreparedInput } from "./types";

function isPlainObject(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function sortKeysDeep(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map(sortKeysDeep);
	}
	if (!isPlainObject(value)) {
		return value;
	}
	const out: Record<string, unknown> = {};
	for (const key of Object.keys(value).sort()) {
		if ((PREPARATION_REVISION_EXCLUDED_KEYS as readonly string[]).includes(key)) {
			continue;
		}
		out[key] = sortKeysDeep(value[key]);
	}
	return out;
}

export function canonicalPreparedPayload(prepared: PlannerPreparedInput): unknown {
	const clone = JSON.parse(JSON.stringify(prepared)) as Record<string, unknown>;
	for (const key of PREPARATION_REVISION_EXCLUDED_KEYS) {
		delete clone[key];
	}
	return sortKeysDeep(clone);
}

export function canonicalPreparedJson(prepared: PlannerPreparedInput): string {
	return JSON.stringify(canonicalPreparedPayload(prepared));
}

export function computePreparationRevision(prepared: PlannerPreparedInput): string {
	return createHash("sha256").update(canonicalPreparedJson(prepared)).digest("hex");
}
