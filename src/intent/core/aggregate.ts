import { createHash } from "node:crypto";
import type { IntentDomainId } from "./constants";

export interface ResolvedAllIntent {
	schema_version: 1;
	revision: number;
	resolved_at: string;
	domains: Partial<Record<IntentDomainId, unknown>>;
}

function stableStringify(value: unknown): string {
	return JSON.stringify(sortKeysDeep(value));
}

function sortKeysDeep(value: unknown): unknown {
	if (value === null || typeof value !== "object") return value;
	if (Array.isArray(value)) return value.map(sortKeysDeep);
	const obj = value as Record<string, unknown>;
	const keys = Object.keys(obj).sort();
	const out: Record<string, unknown> = {};
	for (const k of keys) {
		const v = obj[k];
		if (v !== undefined) out[k] = sortKeysDeep(v);
	}
	return out;
}

export function computeAggregateRevisionHash(domains: Partial<Record<IntentDomainId, unknown>>): string {
	const payload = {
		schema_version: 1,
		domains: sortKeysDeep(domains),
	};
	return createHash("sha256").update(stableStringify(payload), "utf8").digest("hex");
}

export function nextAggregateRevision(
	prev: ResolvedAllIntent | null,
	domains: Partial<Record<IntentDomainId, unknown>>,
): number {
	const hash = computeAggregateRevisionHash(domains);
	if (!prev) {
		return Object.keys(domains).length > 0 ? 1 : 0;
	}
	const prevHash = computeAggregateRevisionHash(prev.domains);
	if (hash === prevHash) {
		return prev.revision;
	}
	return prev.revision + 1;
}

export function buildResolvedAllIntent(
	prev: ResolvedAllIntent | null,
	domains: Partial<Record<IntentDomainId, unknown>>,
	now: Date,
): ResolvedAllIntent {
	const revision = nextAggregateRevision(prev, domains);
	const changed = !prev || revision !== prev.revision;
	return {
		schema_version: 1,
		revision,
		resolved_at: changed ? now.toISOString() : prev!.resolved_at,
		domains,
	};
}
