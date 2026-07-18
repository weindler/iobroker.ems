import { setOptionalNumberIfChanged, setStateIfChanged } from "../policy/core/state_write";
import type { StateHost } from "../ems_light/state_util";
import type { PlannerCoordinatorStatus } from "../planner_coordinator/types";
import { shortenRevision } from "./canonical";
import { PLANNER_COORDINATOR_STATE_IDS } from "./ensure_states";

export interface TriggerDiagnosticsForStates {
	pending?: boolean;
	lastAutoRequestAt?: string | null;
	nextScheduledAt?: string | null;
	lastTriggerClass?: string;
	lastCoalescedCount?: number;
}

export async function writePlannerCoordinatorStatusStates(
	host: StateHost,
	status: PlannerCoordinatorStatus,
	diag?: TriggerDiagnosticsForStates | null,
): Promise<void> {
	const active = status.state === "building_snapshot" ||
		status.state === "starting_worker" ||
		status.state === "worker_running" ||
		status.state === "validating_output";

	await setStateIfChanged(host, PLANNER_COORDINATOR_STATE_IDS.state, status.state);
	await setStateIfChanged(host, PLANNER_COORDINATOR_STATE_IDS.active, active);
	await setStateIfChanged(host, PLANNER_COORDINATOR_STATE_IDS.activeJobId, status.activeJobId ?? "");
	await setStateIfChanged(
		host,
		PLANNER_COORDINATOR_STATE_IDS.lastTriggerReason,
		status.lastTriggerReason ?? status.activeReason ?? "",
	);
	await setStateIfChanged(host, PLANNER_COORDINATOR_STATE_IDS.lastResult, status.lastResult ?? "");
	await setStateIfChanged(host, PLANNER_COORDINATOR_STATE_IDS.lastSkipReason, status.lastSkipReason ?? "");
	await setStateIfChanged(host, PLANNER_COORDINATOR_STATE_IDS.lastErrorCode, status.lastErrorCode ?? "");
	await setStateIfChanged(host, PLANNER_COORDINATOR_STATE_IDS.lastErrorStage, status.lastErrorStage ?? "");
	await setStateIfChanged(host, PLANNER_COORDINATOR_STATE_IDS.lastErrorDetail, status.lastErrorDetail ?? "");
	await setStateIfChanged(host, PLANNER_COORDINATOR_STATE_IDS.lastStartedAt, status.lastStartedAt ?? "");
	await setStateIfChanged(host, PLANNER_COORDINATOR_STATE_IDS.lastFinishedAt, status.lastFinishedAt ?? "");
	await setOptionalNumberIfChanged(host, PLANNER_COORDINATOR_STATE_IDS.lastDurationMs, status.lastDurationMs ?? null);
	await setStateIfChanged(
		host,
		PLANNER_COORDINATOR_STATE_IDS.lastInputRevision,
		shortenRevision(status.lastInputRevision),
	);
	await setStateIfChanged(
		host,
		PLANNER_COORDINATOR_STATE_IDS.lastPreparationRevision,
		shortenRevision(status.lastPreparationRevision),
	);
	await setStateIfChanged(
		host,
		PLANNER_COORDINATOR_STATE_IDS.candidateRevision,
		shortenRevision(status.candidateRevision),
	);
	await setStateIfChanged(
		host,
		PLANNER_COORDINATOR_STATE_IDS.candidateValidation,
		status.candidateValidation ?? "",
	);
	await setStateIfChanged(
		host,
		PLANNER_COORDINATOR_STATE_IDS.comparisonStatus,
		status.comparisonStatus ?? "not_available",
	);
	await setStateIfChanged(
		host,
		PLANNER_COORDINATOR_STATE_IDS.comparisonReferenceRevision,
		shortenRevision(status.comparisonReferenceRevision),
	);
	await setStateIfChanged(
		host,
		PLANNER_COORDINATOR_STATE_IDS.comparisonWorkerRevision,
		shortenRevision(status.comparisonWorkerRevision),
	);
	await setOptionalNumberIfChanged(
		host,
		PLANNER_COORDINATOR_STATE_IDS.comparisonMismatchCount,
		status.comparisonMismatchCount ?? null,
	);
	await setStateIfChanged(
		host,
		PLANNER_COORDINATOR_STATE_IDS.comparisonFirstMismatch,
		status.comparisonFirstMismatch ?? "",
	);
	await setStateIfChanged(
		host,
		PLANNER_COORDINATOR_STATE_IDS.comparisonFirstDomain,
		status.comparisonFirstDomain ?? "",
	);
	await setOptionalNumberIfChanged(
		host,
		PLANNER_COORDINATOR_STATE_IDS.comparisonMismatchedSlots,
		status.comparisonMismatchedSlots ?? null,
	);

	if (diag) {
		await setStateIfChanged(host, PLANNER_COORDINATOR_STATE_IDS.lastTriggerClass, diag.lastTriggerClass ?? "");
		await setOptionalNumberIfChanged(
			host,
			PLANNER_COORDINATOR_STATE_IDS.lastCoalescedCount,
			diag.lastCoalescedCount ?? null,
		);
		await setStateIfChanged(
			host,
			PLANNER_COORDINATOR_STATE_IDS.lastAutoRequestAt,
			diag.lastAutoRequestAt ?? "",
		);
		await setStateIfChanged(
			host,
			PLANNER_COORDINATOR_STATE_IDS.nextScheduledAt,
			diag.nextScheduledAt ?? "",
		);
		await setStateIfChanged(host, PLANNER_COORDINATOR_STATE_IDS.triggerPending, diag.pending === true);
	}
}
