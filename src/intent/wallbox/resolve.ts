import type { FieldCandidate, IntentField } from "../core/types";
import { resolveFieldFromCandidates, scopeIncludes } from "../core/resolver";
import { nextRevision, semanticIntentChanged } from "../core/revision";
import { isExpiredAt } from "../core/validation";
import type {
	AdminIntentSnapshot,
	EvccIntentSnapshot,
	IobrokerIntentSnapshot,
	ResolvedWallboxIntent,
} from "./types";
import { deriveIntentState, lastChangedAt, buildExternalWallboxPlan } from "./validation";
import { emptyResolvedWallboxIntent } from "./types";

const PRIORITY_OVERRIDE = 1;
const PRIORITY_IOBROKER = 2;
const PRIORITY_EVCC = 3;
const PRIORITY_ADMIN = 4;

export interface ResolveWallboxInput {
	now: Date;
	previous: ResolvedWallboxIntent | null;
	evcc: EvccIntentSnapshot | null;
	iobroker: IobrokerIntentSnapshot | null;
	admin: AdminIntentSnapshot | null;
	override: import("../core/types").ManualOverrideState | null;
	active: boolean;
}

export function resolveWallboxIntent(input: ResolveWallboxInput): ResolvedWallboxIntent {
	const { now, previous, evcc, iobroker, admin, override, active } = input;
	if (!active) {
		const empty = emptyResolvedWallboxIntent(now);
		empty.intent_state = "disabled";
		return { ...empty, revision: previous?.revision ?? 0 };
	}

	const base = previous ?? emptyResolvedWallboxIntent(now);

	const activeOverride =
		override?.active && (!override.valid_until || !isExpiredAt(override.valid_until, now)) ? override : null;

	const chargeCandidates: FieldCandidate<import("../core/types").WallboxChargeStrategy>[] = [];
	const socCandidates: FieldCandidate<number>[] = [];
	const deadlineCandidates: FieldCandidate<import("../core/types").WallboxDeadlineValue>[] = [];

	if (activeOverride && scopeIncludes(activeOverride.scope, "charge_strategy") && iobroker?.charge_strategy) {
		chargeCandidates.push(fieldToCandidate(iobroker.charge_strategy, PRIORITY_OVERRIDE));
	}
	if (activeOverride && scopeIncludes(activeOverride.scope, "target_soc_pct") && iobroker?.target_soc_pct) {
		socCandidates.push(fieldToCandidate(iobroker.target_soc_pct, PRIORITY_OVERRIDE));
	}
	if (activeOverride && scopeIncludes(activeOverride.scope, "deadline") && iobroker?.deadline) {
		deadlineCandidates.push(fieldToCandidate(iobroker.deadline, PRIORITY_OVERRIDE));
	}

	if (iobroker?.charge_strategy && (!activeOverride || !scopeIncludes(activeOverride.scope, "charge_strategy"))) {
		chargeCandidates.push(fieldToCandidate(iobroker.charge_strategy, PRIORITY_IOBROKER));
	}
	if (iobroker?.target_soc_pct && (!activeOverride || !scopeIncludes(activeOverride.scope, "target_soc_pct"))) {
		socCandidates.push(fieldToCandidate(iobroker.target_soc_pct, PRIORITY_IOBROKER));
	}
	if (iobroker?.deadline && (!activeOverride || !scopeIncludes(activeOverride.scope, "deadline"))) {
		deadlineCandidates.push(fieldToCandidate(iobroker.deadline, PRIORITY_IOBROKER));
	}

	if (evcc) {
		if (!activeOverride || !scopeIncludes(activeOverride.scope, "charge_strategy")) {
			chargeCandidates.push(fieldToCandidate(evcc.charge_strategy, PRIORITY_EVCC));
		}
		if (!activeOverride || !scopeIncludes(activeOverride.scope, "target_soc_pct")) {
			socCandidates.push(fieldToCandidate(evcc.target_soc_pct, PRIORITY_EVCC));
		}
		if (!activeOverride || !scopeIncludes(activeOverride.scope, "deadline")) {
			deadlineCandidates.push(fieldToCandidate(evcc.deadline, PRIORITY_EVCC));
		}
	}

	if (admin?.charge_strategy) {
		chargeCandidates.push(fieldToCandidate(admin.charge_strategy, PRIORITY_ADMIN));
	}
	if (admin?.target_soc_pct) {
		socCandidates.push(fieldToCandidate(admin.target_soc_pct, PRIORITY_ADMIN));
	}

	const chargeRes = resolveFieldFromCandidates(chargeCandidates, now);
	const socRes = resolveFieldFromCandidates(socCandidates, now);
	const deadlineRes = resolveFieldFromCandidates(deadlineCandidates, now);

	const hasConflict = chargeRes.conflict || socRes.conflict || deadlineRes.conflict;

	const manualOverride: import("../core/types").ManualOverrideState = activeOverride ?? {
		active: false,
		scope: [],
		source: "unknown",
		owner: "unknown",
	};

	const sourceSummary = buildSourceSummary(chargeRes.field, socRes.field, deadlineRes.field, manualOverride);

	const draft: Omit<ResolvedWallboxIntent, "revision" | "intent_state" | "resolved_at"> & {
		intent_state: import("../core/types").IntentState;
		revision: number;
		resolved_at: string;
	} = {
		schema_version: base.schema_version,
		domain: "wallbox",
		target: base.target,
		revision: 0,
		intent_state: "none",
		resolved_at: base.resolved_at,
		charge_strategy: chargeRes.field,
		target_soc_pct: socRes.field,
		deadline: deadlineRes.field,
		external_planner_plan: buildExternalWallboxPlan(deadlineRes.field, socRes.field, now.toISOString()),
		manual_override: manualOverride,
		source_summary: sourceSummary,
	};

	if (hasConflict) {
		draft.intent_state = "conflict";
	} else {
		draft.intent_state = deriveIntentState(draft);
	}

	const revision = nextRevision(previous, draft as ResolvedWallboxIntent);
	const resolvedAt =
		previous && !semanticIntentChanged(previous, draft as ResolvedWallboxIntent)
			? previous.resolved_at
			: now.toISOString();

	return {
		...(draft as ResolvedWallboxIntent),
		revision,
		resolved_at: resolvedAt,
	};
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

function buildSourceSummary(
	charge: IntentField<unknown>,
	soc: IntentField<unknown>,
	deadline: IntentField<unknown>,
	override: import("../core/types").ManualOverrideState,
): string[] {
	const sources = new Set<string>();
	if (override.active) {
		sources.add(`override:${override.source}`);
	}
	for (const f of [charge, soc, deadline]) {
		if (f.status === "valid" && f.origin.source !== "unknown") {
			sources.add(`${f.origin.source}:${f.origin.owner}`);
		}
	}
	return [...sources].sort();
}

export function applyClearFields(
	snapshot: IobrokerIntentSnapshot,
	clearFields: string[],
): IobrokerIntentSnapshot {
	const out = { ...snapshot };
	for (const key of clearFields) {
		if (key === "charge_strategy") out.charge_strategy = null;
		if (key === "target_soc_pct") out.target_soc_pct = null;
		if (key === "deadline") out.deadline = null;
		if (key === "manual_override") out.manual_override = null;
	}
	return out;
}
