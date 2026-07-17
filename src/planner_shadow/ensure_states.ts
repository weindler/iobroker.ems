import { ensureChannel, ensureStates, type StateDef, type StateHost } from "../ems_light/state_util";

export const PLANNER_COORDINATOR_STATE_IDS = {
	shadowEnabled: "planner.coordinator.shadow_enabled",
	manualTrigger: "planner.coordinator.manual_trigger",
	manualForceTrigger: "planner.coordinator.manual_force_trigger",
	configuredMode: "planner.coordinator.configured_mode",
	effectiveMode: "planner.coordinator.effective_mode",
	state: "planner.coordinator.state",
	active: "planner.coordinator.active",
	activeJobId: "planner.coordinator.active_job_id",
	lastTriggerReason: "planner.coordinator.last_trigger_reason",
	lastTriggerClass: "planner.coordinator.last_trigger_class",
	lastCoalescedCount: "planner.coordinator.last_coalesced_count",
	lastAutoRequestAt: "planner.coordinator.last_auto_request_at",
	nextScheduledAt: "planner.coordinator.next_scheduled_at",
	triggerPending: "planner.coordinator.trigger_pending",
	lastResult: "planner.coordinator.last_result",
	lastSkipReason: "planner.coordinator.last_skip_reason",
	lastErrorCode: "planner.coordinator.last_error_code",
	lastStartedAt: "planner.coordinator.last_started_at",
	lastFinishedAt: "planner.coordinator.last_finished_at",
	lastDurationMs: "planner.coordinator.last_duration_ms",
	lastInputRevision: "planner.coordinator.last_input_revision",
	lastPreparationRevision: "planner.coordinator.last_preparation_revision",
	candidateRevision: "planner.coordinator.candidate_revision",
	candidateValidation: "planner.coordinator.candidate_validation",
	comparisonStatus: "planner.coordinator.comparison_status",
	comparisonReferenceRevision: "planner.coordinator.comparison_reference_revision",
	comparisonWorkerRevision: "planner.coordinator.comparison_worker_revision",
	comparisonMismatchCount: "planner.coordinator.comparison_mismatch_count",
	comparisonFirstMismatch: "planner.coordinator.comparison_first_mismatch",
	comparisonFirstDomain: "planner.coordinator.comparison_first_domain",
	comparisonMismatchedSlots: "planner.coordinator.comparison_mismatched_slots",
} as const;

export const PLANNER_COORDINATOR_STATE_PREFIX = "planner.coordinator.";

function strState(id: string, name: string, def = "", write = false): StateDef {
	return {
		id,
		common: { name, type: "string", role: write ? "state" : "text", read: true, write, def },
		defaultVal: def,
		setDefaultIfEmpty: !write,
	};
}

function numState(id: string, name: string, def = 0, write = false): StateDef {
	return {
		id,
		common: { name, type: "number", role: "value", read: true, write, def },
		defaultVal: def,
		setDefaultIfEmpty: !write,
	};
}

function boolState(id: string, name: string, def = false, write = false, role: "state" | "button" = "state"): StateDef {
	return {
		id,
		common: { name, type: "boolean", role, read: true, write, def },
		defaultVal: def,
		setDefaultIfEmpty: !write,
	};
}

export async function ensurePlannerCoordinatorStates(host: StateHost): Promise<void> {
	await ensureChannel(host, "planner.coordinator", "Planner On-Demand Coordinator");
	const defs: StateDef[] = [
		boolState(PLANNER_COORDINATOR_STATE_IDS.shadowEnabled, "Planner Shadow Session-Freigabe", false, true),
		boolState(PLANNER_COORDINATOR_STATE_IDS.manualTrigger, "Planner Shadow manuell starten", false, true, "button"),
		boolState(
			PLANNER_COORDINATOR_STATE_IDS.manualForceTrigger,
			"Planner Shadow manuell erzwingen",
			false,
			true,
			"button",
		),
		strState(PLANNER_COORDINATOR_STATE_IDS.configuredMode, "Planner Betriebsart (Konfiguration)", "off"),
		strState(PLANNER_COORDINATOR_STATE_IDS.effectiveMode, "Planner Betriebsart (effektiv)", "off"),
		strState(PLANNER_COORDINATOR_STATE_IDS.state, "Coordinator Zustand", "disabled"),
		boolState(PLANNER_COORDINATOR_STATE_IDS.active, "Coordinator aktiv", false),
		strState(PLANNER_COORDINATOR_STATE_IDS.activeJobId, "Coordinator Job-ID"),
		strState(PLANNER_COORDINATOR_STATE_IDS.lastTriggerReason, "Coordinator letzter Trigger"),
		strState(PLANNER_COORDINATOR_STATE_IDS.lastTriggerClass, "Coordinator letzte Triggerklasse"),
		numState(PLANNER_COORDINATOR_STATE_IDS.lastCoalescedCount, "Coordinator coalesced Trigger", 0),
		strState(PLANNER_COORDINATOR_STATE_IDS.lastAutoRequestAt, "Coordinator letzter Auto-Request"),
		strState(PLANNER_COORDINATOR_STATE_IDS.nextScheduledAt, "Coordinator nächster Schedule"),
		boolState(PLANNER_COORDINATOR_STATE_IDS.triggerPending, "Coordinator Trigger pending", false),
		strState(PLANNER_COORDINATOR_STATE_IDS.lastResult, "Coordinator letztes Ergebnis"),
		strState(PLANNER_COORDINATOR_STATE_IDS.lastSkipReason, "Coordinator Skip-Grund"),
		strState(PLANNER_COORDINATOR_STATE_IDS.lastErrorCode, "Coordinator Fehlercode"),
		strState(PLANNER_COORDINATOR_STATE_IDS.lastStartedAt, "Coordinator Start (ISO)"),
		strState(PLANNER_COORDINATOR_STATE_IDS.lastFinishedAt, "Coordinator Ende (ISO)"),
		numState(PLANNER_COORDINATOR_STATE_IDS.lastDurationMs, "Coordinator Dauer ms", 0),
		strState(PLANNER_COORDINATOR_STATE_IDS.lastInputRevision, "Coordinator Input-Revision"),
		strState(PLANNER_COORDINATOR_STATE_IDS.lastPreparationRevision, "Coordinator Preparation-Revision"),
		strState(PLANNER_COORDINATOR_STATE_IDS.candidateRevision, "Candidate-Revision"),
		strState(PLANNER_COORDINATOR_STATE_IDS.candidateValidation, "Candidate-Validation"),
		strState(PLANNER_COORDINATOR_STATE_IDS.comparisonStatus, "Shadow Vergleich Status", "not_available"),
		strState(PLANNER_COORDINATOR_STATE_IDS.comparisonReferenceRevision, "Shadow Referenz-Revision"),
		strState(PLANNER_COORDINATOR_STATE_IDS.comparisonWorkerRevision, "Shadow Worker-Revision"),
		numState(PLANNER_COORDINATOR_STATE_IDS.comparisonMismatchCount, "Shadow Abweichungen", 0),
		strState(PLANNER_COORDINATOR_STATE_IDS.comparisonFirstMismatch, "Shadow erste Abweichung"),
		strState(PLANNER_COORDINATOR_STATE_IDS.comparisonFirstDomain, "Shadow erste Domäne"),
		numState(PLANNER_COORDINATOR_STATE_IDS.comparisonMismatchedSlots, "Shadow abweichende Slots", 0),
	];
	await ensureStates(host, defs);
}

export function isPlannerCoordinatorState(relativeId: string): boolean {
	return relativeId === PLANNER_COORDINATOR_STATE_IDS.shadowEnabled ||
		relativeId === PLANNER_COORDINATOR_STATE_IDS.manualTrigger ||
		relativeId === PLANNER_COORDINATOR_STATE_IDS.manualForceTrigger ||
		relativeId.startsWith(PLANNER_COORDINATOR_STATE_PREFIX);
}
