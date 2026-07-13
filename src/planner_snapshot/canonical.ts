import { createHash } from "node:crypto";
import { INPUT_REVISION_EXCLUDED_KEYS } from "./constants";
import type { PlannerInputSnapshot } from "./types";

function isPlainObject(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Deterministic key order for JSON serialization. */
export function sortKeysDeep(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map(sortKeysDeep);
	}
	if (!isPlainObject(value)) {
		return value;
	}
	const out: Record<string, unknown> = {};
	for (const key of Object.keys(value).sort()) {
		if ((INPUT_REVISION_EXCLUDED_KEYS as readonly string[]).includes(key)) {
			continue;
		}
		out[key] = sortKeysDeep(value[key]);
	}
	return out;
}

export function canonicalSnapshotPayload(snapshot: PlannerInputSnapshot): unknown {
	const clone = JSON.parse(JSON.stringify(snapshot)) as Record<string, unknown>;
	for (const key of INPUT_REVISION_EXCLUDED_KEYS) {
		delete clone[key];
	}
	return sortKeysDeep(clone);
}

export function canonicalSnapshotJson(snapshot: PlannerInputSnapshot): string {
	return JSON.stringify(canonicalSnapshotPayload(snapshot));
}

export function computeInputRevision(snapshot: PlannerInputSnapshot): string {
	return createHash("sha256").update(canonicalSnapshotJson(snapshot)).digest("hex");
}

export function utf8ByteLength(text: string): number {
	return Buffer.byteLength(text, "utf8");
}

/** Optional aggregate fingerprint of upstream source revisions (policy, learning timestamps). */
export function computeSourceRevision(parts: Array<string | null | undefined>): string {
	const payload = parts.filter((p) => p != null && String(p).trim() !== "").join("|");
	if (!payload) return "";
	return createHash("sha256").update(payload).digest("hex").slice(0, 16);
}
