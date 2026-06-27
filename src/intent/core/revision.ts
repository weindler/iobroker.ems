import { createHash } from "node:crypto";
import type { ManualOverrideState } from "./types";
import type { ResolvedWallboxIntent } from "../wallbox/types";

function sortKeysDeep(value: unknown): unknown {
	if (value === null || typeof value !== "object") {
		return value;
	}
	if (Array.isArray(value)) {
		return value.map(sortKeysDeep);
	}
	const obj = value as Record<string, unknown>;
	const keys = Object.keys(obj).sort();
	const out: Record<string, unknown> = {};
	for (const k of keys) {
		const v = obj[k];
		if (v !== undefined) {
			out[k] = sortKeysDeep(v);
		}
	}
	return out;
}

function stableStringify(value: unknown): string {
	return JSON.stringify(sortKeysDeep(value));
}

/** Semantischer Payload ohne Laufzeit-/Diagnose-Felder. */
export function semanticIntentPayload(intent: ResolvedWallboxIntent): unknown {
	const fieldForHash = <T>(f: { value: T | null; status: string; origin: unknown; valid_until?: string }) => ({
		value: f.value,
		status: f.status,
		origin: f.origin,
		valid_until: f.valid_until,
	});

	return {
		schema_version: intent.schema_version,
		domain: intent.domain,
		target: intent.target,
		charge_strategy: fieldForHash(intent.charge_strategy),
		target_soc_pct: fieldForHash(intent.target_soc_pct),
		deadline: fieldForHash(intent.deadline),
		external_planner_plan: intent.external_planner_plan,
		manual_override: manualOverrideForHash(intent.manual_override),
		intent_state: intent.intent_state,
		source_summary: [...intent.source_summary].sort(),
	};
}

function manualOverrideForHash(mo: ManualOverrideState): unknown {
	return {
		active: mo.active,
		scope: [...mo.scope].sort(),
		source: mo.source,
		owner: mo.owner,
		owner_id: mo.owner_id,
		valid_until: mo.valid_until,
		reason: mo.reason,
	};
}

export function computeSemanticHash(intent: ResolvedWallboxIntent): string {
	return createHash("sha256").update(stableStringify(semanticIntentPayload(intent)), "utf8").digest("hex");
}

export function semanticIntentChanged(prev: ResolvedWallboxIntent | null, next: ResolvedWallboxIntent): boolean {
	if (!prev) {
		return true;
	}
	return computeSemanticHash(prev) !== computeSemanticHash(next);
}

export function nextRevision(prev: ResolvedWallboxIntent | null, next: ResolvedWallboxIntent): number {
	if (!prev) {
		return next.charge_strategy.status !== "missing" ||
			next.target_soc_pct.status !== "missing" ||
			next.deadline.status !== "missing" ||
			next.manual_override.active
			? 1
			: 0;
	}
	if (!semanticIntentChanged(prev, next)) {
		return prev.revision;
	}
	return prev.revision + 1;
}
