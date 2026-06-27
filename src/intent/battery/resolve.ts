import type { FieldCandidate, IntentField, ManualOverrideState } from "../core/types";
import { resolveFieldFromCandidates, scopeIncludes } from "../core/resolver";
import { isExpiredAt } from "../core/validation";
import type { IobrokerBatterySnapshot, ResolvedBatteryIntent } from "./types";
import { deriveBatteryIntentState, nextBatteryRevision } from "./validation";
import { emptyResolvedBatteryIntent } from "./types";
import { BATTERY_TARGET_ID } from "../core/constants";

const PRIORITY_OVERRIDE = 1;
const PRIORITY_IOBROKER = 2;

export interface ResolveBatteryInput {
	now: Date;
	previous: ResolvedBatteryIntent | null;
	iobroker: IobrokerBatterySnapshot | null;
	override: ManualOverrideState | null;
	active: boolean;
}

export function resolveBatteryIntent(input: ResolveBatteryInput): ResolvedBatteryIntent {
	const { now, previous, iobroker, override, active } = input;
	if (!active) {
		const empty = emptyResolvedBatteryIntent(now, BATTERY_TARGET_ID);
		empty.intent_state = "disabled";
		return { ...empty, revision: previous?.revision ?? 0 };
	}

	const base = previous ?? emptyResolvedBatteryIntent(now, BATTERY_TARGET_ID);
	const activeOverride =
		override?.active && (!override.valid_until || !isExpiredAt(override.valid_until, now)) ? override : null;

	const opCands: FieldCandidate<import("./types").BatteryOperatingRequest>[] = [];
	const socCands: FieldCandidate<number>[] = [];
	const gridCands: FieldCandidate<import("./types").BatteryGridChargeRequest>[] = [];
	const evDisCands: FieldCandidate<boolean>[] = [];
	const topOffCands: FieldCandidate<boolean>[] = [];

	addFieldCandidate(iobroker?.operating_request, "operating_request", opCands, activeOverride);
	addFieldCandidate(iobroker?.target_soc_pct, "target_soc_pct", socCands, activeOverride);
	addFieldCandidate(iobroker?.grid_charge_request, "grid_charge_request", gridCands, activeOverride);
	addFieldCandidate(iobroker?.ev_discharge_allowed, "ev_discharge_allowed", evDisCands, activeOverride);
	addFieldCandidate(iobroker?.top_off_requested, "top_off_requested", topOffCands, activeOverride);

	const opRes = resolveFieldFromCandidates(opCands, now);
	const socRes = resolveFieldFromCandidates(socCands, now);
	const gridRes = resolveFieldFromCandidates(gridCands, now);
	const evDisRes = resolveFieldFromCandidates(evDisCands, now);
	const topOffRes = resolveFieldFromCandidates(topOffCands, now);

	const manualOverride = activeOverride ?? { active: false, scope: [], source: "unknown" as const, owner: "unknown" as const };
	const draft: ResolvedBatteryIntent = {
		...base,
		operating_request: opRes.field,
		target_soc_pct: socRes.field,
		grid_charge_request: gridRes.field,
		ev_discharge_allowed: evDisRes.field,
		top_off_requested: topOffRes.field,
		manual_override: manualOverride,
		source_summary: buildSummary(opRes.field, socRes.field, gridRes.field, evDisRes.field, topOffRes.field, manualOverride),
		intent_state: "none",
	};
	draft.intent_state = deriveBatteryIntentState(draft);
	const revision = nextBatteryRevision(previous, draft);
	const resolvedAt = previous && nextBatteryRevision(previous, draft) === previous.revision ? previous.resolved_at : now.toISOString();
	return { ...draft, revision, resolved_at: resolvedAt };
}

function addFieldCandidate<T>(
	field: IntentField<T> | null | undefined,
	scope: string,
	list: FieldCandidate<T>[],
	activeOverride: ManualOverrideState | null,
): void {
	if (!field) return;
	if (activeOverride && scopeIncludes(activeOverride.scope, scope)) {
		list.push(fieldToCandidate(field, PRIORITY_OVERRIDE));
	} else if (!activeOverride || !scopeIncludes(activeOverride.scope, scope)) {
		list.push(fieldToCandidate(field, PRIORITY_IOBROKER));
	}
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
	soc: IntentField<unknown>,
	grid: IntentField<unknown>,
	evDis: IntentField<unknown>,
	topOff: IntentField<unknown>,
	override: ManualOverrideState,
): string[] {
	const s = new Set<string>();
	if (override.active) s.add(`override:${override.source}`);
	for (const f of [op, soc, grid, evDis, topOff]) {
		if (f.status === "valid" && f.origin.source !== "unknown") {
			s.add(`${f.origin.source}:${f.origin.owner}`);
		}
	}
	return [...s].sort();
}

export function applyBatteryClearFields(snapshot: IobrokerBatterySnapshot, clearFields: string[]): IobrokerBatterySnapshot {
	const out = { ...snapshot };
	for (const key of clearFields) {
		if (key === "operating_request") out.operating_request = null;
		if (key === "target_soc_pct") out.target_soc_pct = null;
		if (key === "grid_charge_request") out.grid_charge_request = null;
		if (key === "ev_discharge_allowed") out.ev_discharge_allowed = null;
		if (key === "top_off_requested") out.top_off_requested = null;
		if (key === "manual_override") out.manual_override = null;
	}
	return out;
}
