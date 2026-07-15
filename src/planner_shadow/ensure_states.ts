import { ensureChannel, ensureStates, type StateDef, type StateHost } from "../ems_light/state_util";

export const PLANNER_COORDINATOR_STATE_IDS = {
	shadowEnabled: "planner.coordinator.shadow_enabled",
	manualTrigger: "planner.coordinator.manual_trigger",
	manualForceTrigger: "planner.coordinator.manual_force_trigger",
	state: "planner.coordinator.state",
	active: "planner.coordinator.active",
	activeJobId: "planner.coordinator.active_job_id",
	lastTriggerReason: "planner.coordinator.last_trigger_reason",
	lastResult: "planner.coordinator.last_result",
	lastSkipReason: "planner.coordinator.last_skip_reason",
	lastErrorCode: "planner.coordinator.last_error_code",
	lastStartedAt: "planner.coordinator.last_started_at",
	lastFinishedAt: "planner.coordinator.last_finished_at",
	lastDurationMs: "planner.coordinator.last_duration_ms",
	lastInputRevision: "planner.coordinator.last_input_revision",
	lastPreparationRevision: "planner.coordinator.last_preparation_revision",
	comparisonStatus: "planner.coordinator.comparison_status",
	comparisonReferenceRevision: "planner.coordinator.comparison_reference_revision",
	comparisonWorkerRevision: "planner.coordinator.comparison_worker_revision",
	comparisonMismatchCount: "planner.coordinator.comparison_mismatch_count",
	comparisonFirstMismatch: "planner.coordinator.comparison_first_mismatch",
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
		boolState(PLANNER_COORDINATOR_STATE_IDS.shadowEnabled, "Planner Shadow aktiviert", false, true),
		boolState(PLANNER_COORDINATOR_STATE_IDS.manualTrigger, "Planner Shadow manuell starten", false, true, "button"),
		boolState(
			PLANNER_COORDINATOR_STATE_IDS.manualForceTrigger,
			"Planner Shadow manuell erzwingen",
			false,
			true,
			"button",
		),
		strState(PLANNER_COORDINATOR_STATE_IDS.state, "Coordinator Zustand", "disabled"),
		boolState(PLANNER_COORDINATOR_STATE_IDS.active, "Coordinator aktiv", false),
		strState(PLANNER_COORDINATOR_STATE_IDS.activeJobId, "Coordinator Job-ID"),
		strState(PLANNER_COORDINATOR_STATE_IDS.lastTriggerReason, "Coordinator letzter Trigger"),
		strState(PLANNER_COORDINATOR_STATE_IDS.lastResult, "Coordinator letztes Ergebnis"),
		strState(PLANNER_COORDINATOR_STATE_IDS.lastSkipReason, "Coordinator Skip-Grund"),
		strState(PLANNER_COORDINATOR_STATE_IDS.lastErrorCode, "Coordinator Fehlercode"),
		strState(PLANNER_COORDINATOR_STATE_IDS.lastStartedAt, "Coordinator Start (ISO)"),
		strState(PLANNER_COORDINATOR_STATE_IDS.lastFinishedAt, "Coordinator Ende (ISO)"),
		numState(PLANNER_COORDINATOR_STATE_IDS.lastDurationMs, "Coordinator Dauer ms", 0),
		strState(PLANNER_COORDINATOR_STATE_IDS.lastInputRevision, "Coordinator Input-Revision"),
		strState(PLANNER_COORDINATOR_STATE_IDS.lastPreparationRevision, "Coordinator Preparation-Revision"),
		strState(PLANNER_COORDINATOR_STATE_IDS.comparisonStatus, "Shadow Vergleich Status", "not_available"),
		strState(PLANNER_COORDINATOR_STATE_IDS.comparisonReferenceRevision, "Shadow Referenz-Revision"),
		strState(PLANNER_COORDINATOR_STATE_IDS.comparisonWorkerRevision, "Shadow Worker-Revision"),
		numState(PLANNER_COORDINATOR_STATE_IDS.comparisonMismatchCount, "Shadow Abweichungen", 0),
		strState(PLANNER_COORDINATOR_STATE_IDS.comparisonFirstMismatch, "Shadow erste Abweichung"),
	];
	await ensureStates(host, defs);
}

export function isPlannerCoordinatorState(relativeId: string): boolean {
	return relativeId === PLANNER_COORDINATOR_STATE_IDS.shadowEnabled ||
		relativeId === PLANNER_COORDINATOR_STATE_IDS.manualTrigger ||
		relativeId === PLANNER_COORDINATOR_STATE_IDS.manualForceTrigger ||
		relativeId.startsWith(PLANNER_COORDINATOR_STATE_PREFIX);
}
