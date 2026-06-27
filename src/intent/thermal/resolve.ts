import type { FieldCandidate, IntentField, ManualOverrideState } from "../core/types";
import { resolveFieldFromCandidates, scopeIncludes } from "../core/resolver";
import { isExpiredAt } from "../core/validation";
import type { IobrokerThermalSnapshot, ResolvedThermalIntent } from "./types";
import { deriveThermalIntentState, nextThermalRevision } from "./validation";
import { emptyResolvedThermalIntent } from "./types";
import { THERMAL_TARGET_ID } from "../core/constants";

const PRIORITY_OVERRIDE = 1;
const PRIORITY_IOBROKER = 2;

export interface ResolveThermalInput {
	now: Date;
	previous: ResolvedThermalIntent | null;
	iobroker: IobrokerThermalSnapshot | null;
	override: ManualOverrideState | null;
	active: boolean;
}

export function resolveThermalIntent(input: ResolveThermalInput): ResolvedThermalIntent {
	const { now, previous, iobroker, override, active } = input;
	if (!active) {
		const empty = emptyResolvedThermalIntent(now, THERMAL_TARGET_ID);
		empty.intent_state = "disabled";
		return { ...empty, revision: previous?.revision ?? 0 };
	}

	const base = previous ?? emptyResolvedThermalIntent(now, THERMAL_TARGET_ID);
	const activeOverride =
		override?.active && (!override.valid_until || !isExpiredAt(override.valid_until, now)) ? override : null;

	const opCands: FieldCandidate<import("./types").ThermalOperatingRequest>[] = [];
	const tempCands: FieldCandidate<number>[] = [];
	const readyCands: FieldCandidate<import("./types").ThermalReadyAt>[] = [];
	const prioCands: FieldCandidate<import("./types").ThermalPriority>[] = [];

	const addIob = <T>(field: IntentField<T> | null | undefined, scope: string, list: FieldCandidate<T>[]) => {
		if (!field) return;
		if (activeOverride && scopeIncludes(activeOverride.scope, scope)) {
			list.push({ ...fieldToCandidate(field, PRIORITY_OVERRIDE) });
		} else {
			list.push({ ...fieldToCandidate(field, PRIORITY_IOBROKER) });
		}
	};

	if (iobroker) {
		if (!activeOverride || !scopeIncludes(activeOverride.scope, "operating_request")) {
			addIob(iobroker.operating_request, "operating_request", opCands);
		} else if (iobroker.operating_request) {
			opCands.push(fieldToCandidate(iobroker.operating_request, PRIORITY_OVERRIDE));
		}
		if (!activeOverride || !scopeIncludes(activeOverride.scope, "target_temperature_c")) {
			addIob(iobroker.target_temperature_c, "target_temperature_c", tempCands);
		} else if (iobroker.target_temperature_c) {
			tempCands.push(fieldToCandidate(iobroker.target_temperature_c, PRIORITY_OVERRIDE));
		}
		if (!activeOverride || !scopeIncludes(activeOverride.scope, "ready_at")) {
			addIob(iobroker.ready_at, "ready_at", readyCands);
		} else if (iobroker.ready_at) {
			readyCands.push(fieldToCandidate(iobroker.ready_at, PRIORITY_OVERRIDE));
		}
		if (!activeOverride || !scopeIncludes(activeOverride.scope, "priority")) {
			addIob(iobroker.priority, "priority", prioCands);
		} else if (iobroker.priority) {
			prioCands.push(fieldToCandidate(iobroker.priority, PRIORITY_OVERRIDE));
		}
	}

	const opRes = resolveFieldFromCandidates(opCands, now);
	const tempRes = resolveFieldFromCandidates(tempCands, now);
	const readyRes = resolveFieldFromCandidates(readyCands, now);
	const prioRes = resolveFieldFromCandidates(prioCands, now);

	const manualOverride = activeOverride ?? { active: false, scope: [], source: "unknown" as const, owner: "unknown" as const };
	const draft: ResolvedThermalIntent = {
		...base,
		operating_request: opRes.field,
		target_temperature_c: tempRes.field,
		ready_at: readyRes.field,
		priority: prioRes.field,
		manual_override: manualOverride,
		source_summary: buildSummary(opRes.field, tempRes.field, readyRes.field, prioRes.field, manualOverride),
		intent_state: "none",
	};
	draft.intent_state = deriveThermalIntentState(draft);
	const revision = nextThermalRevision(previous, draft);
	const resolvedAt = previous && nextThermalRevision(previous, draft) === previous.revision ? previous.resolved_at : now.toISOString();
	return { ...draft, revision, resolved_at: resolvedAt };
}

function fieldToCandidate<T>(field: IntentField<T>, priority: number): FieldCandidate<T> {
	return {
		value: field.value,
		status: field.status,
		origin: field.origin,
		observed_at: field.observed_at,
		changed_at: field.changed_at,
		valid_until: field.valid_until,
		raw_value: field.raw_value,
		priority,
	};
}

function buildSummary(
	op: IntentField<unknown>,
	temp: IntentField<unknown>,
	ready: IntentField<unknown>,
	prio: IntentField<unknown>,
	override: ManualOverrideState,
): string[] {
	const s = new Set<string>();
	if (override.active) s.add(`override:${override.source}`);
	for (const f of [op, temp, ready, prio]) {
		if (f.status === "valid" && f.origin.source !== "unknown") {
			s.add(`${f.origin.source}:${f.origin.owner}`);
		}
	}
	return [...s].sort();
}

export function applyThermalClearFields(snapshot: IobrokerThermalSnapshot, clearFields: string[]): IobrokerThermalSnapshot {
	const out = { ...snapshot };
	for (const key of clearFields) {
		if (key === "operating_request") out.operating_request = null;
		if (key === "target_temperature_c") out.target_temperature_c = null;
		if (key === "ready_at") out.ready_at = null;
		if (key === "priority") out.priority = null;
		if (key === "manual_override") out.manual_override = null;
	}
	return out;
}
