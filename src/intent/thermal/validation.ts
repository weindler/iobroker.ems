import { createHash } from "node:crypto";
import type { IntentField, IntentState } from "../core/types";
import type { ResolvedThermalIntent } from "./types";

function stableStringify(v: unknown): string {
	return JSON.stringify(v, Object.keys(v as object).sort());
}

export function semanticThermalHash(intent: ResolvedThermalIntent): string {
	const payload = {
		domain: intent.domain,
		target: intent.target,
		operating_request: intent.operating_request,
		target_temperature_c: intent.target_temperature_c,
		ready_at: intent.ready_at,
		priority: intent.priority,
		manual_override: intent.manual_override,
		intent_state: intent.intent_state,
	};
	return createHash("sha256").update(stableStringify(payload), "utf8").digest("hex");
}

export function deriveThermalIntentState(intent: Omit<ResolvedThermalIntent, "intent_state">): IntentState {
	const fields = [intent.operating_request, intent.target_temperature_c, intent.ready_at, intent.priority];
	const validCount = fields.filter((f) => f.status === "valid").length;
	if (validCount === 0 && !intent.manual_override.active) return "none";
	if (validCount > 0 && validCount < fields.length) return "partial";
	if (validCount > 0 || intent.manual_override.active) return "available";
	return "none";
}

export function lastThermalChangedAt(intent: ResolvedThermalIntent): string {
	const times: number[] = [];
	for (const f of [intent.operating_request, intent.target_temperature_c, intent.ready_at, intent.priority] as IntentField<unknown>[]) {
		if (f.changed_at) {
			const t = Date.parse(f.changed_at);
			if (Number.isFinite(t)) times.push(t);
		}
	}
	return times.length ? new Date(Math.max(...times)).toISOString() : intent.resolved_at;
}

export function nextThermalRevision(prev: ResolvedThermalIntent | null, next: ResolvedThermalIntent): number {
	if (!prev) {
		const has = [next.operating_request, next.target_temperature_c, next.ready_at, next.priority].some(
			(f) => f.status === "valid",
		);
		return has || next.manual_override.active ? 1 : 0;
	}
	if (semanticThermalHash(prev) === semanticThermalHash(next)) return prev.revision;
	return prev.revision + 1;
}
