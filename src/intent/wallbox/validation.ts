import type { IntentField, IntentState } from "../core/types";
import type { ExternalWallboxPlan, ResolvedWallboxIntent } from "./types";

export function deriveIntentState(intent: Omit<ResolvedWallboxIntent, "intent_state">): IntentState {
	const fields = [intent.charge_strategy, intent.target_soc_pct, intent.deadline];
	const hasConflict = false; // set by resolver if needed
	if (hasConflict) {
		return "conflict";
	}

	const validCount = fields.filter((f) => f.status === "valid").length;
	const invalidCount = fields.filter((f) => f.status === "invalid").length;
	const expiredCount = fields.filter((f) => f.status === "expired").length;
	const missingCount = fields.filter((f) => f.status === "missing").length;

	if (invalidCount > 0 && validCount === 0) {
		return "invalid";
	}
	if (expiredCount > 0 && validCount === 0) {
		return "expired";
	}
	if (validCount === 0 && missingCount === fields.length && !intent.manual_override.active) {
		return "none";
	}
	if (validCount > 0 && validCount < fields.length) {
		return "partial";
	}
	if (validCount > 0 || intent.manual_override.active) {
		return "available";
	}
	return "none";
}

export function buildExternalWallboxPlan(
	deadline: IntentField<import("../core/types").WallboxDeadlineValue>,
	targetSoc: IntentField<number>,
	observedAt: string,
): ExternalWallboxPlan {
	const base: ExternalWallboxPlan = {
		state: "none",
		plan_type: "soc",
		target_soc_pct: targetSoc.status === "valid" ? targetSoc.value : null,
		target_energy_kwh: null,
		ready_at: deadline.status === "valid" && deadline.value ? deadline.value.at : null,
		source: "evcc",
		observed_at: observedAt,
	};
	if (deadline.status === "missing") {
		return { ...base, state: "none" };
	}
	if (deadline.status === "expired") {
		return { ...base, state: "expired" };
	}
	if (deadline.status === "invalid") {
		return { ...base, state: "invalid" };
	}
	if (deadline.status === "valid" && deadline.value) {
		return { ...base, state: "active" };
	}
	return base;
}

export function lastChangedAt(intent: ResolvedWallboxIntent): string {
	const times: number[] = [];
	for (const f of [intent.charge_strategy, intent.target_soc_pct, intent.deadline] as IntentField<unknown>[]) {
		if (f.changed_at) {
			const t = Date.parse(f.changed_at);
			if (Number.isFinite(t)) times.push(t);
		}
	}
	if (intent.manual_override.started_at) {
		const t = Date.parse(intent.manual_override.started_at);
		if (Number.isFinite(t)) times.push(t);
	}
	if (times.length === 0) {
		return intent.resolved_at;
	}
	return new Date(Math.max(...times)).toISOString();
}
