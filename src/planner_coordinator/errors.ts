/** Staged coordinator failures — never collapse unknown errors silently. */

export const PLANNER_COORDINATOR_ERROR_STAGES = [
	"runtime_import_failed",
	"snapshot_source_failed",
	"snapshot_build_failed",
	"preparation_failed",
	"worker_spawn_failed",
	"worker_protocol_failed",
	"candidate_validation_failed",
] as const;

export type PlannerCoordinatorErrorStage = (typeof PLANNER_COORDINATOR_ERROR_STAGES)[number];

export class PlannerCoordinatorStageError extends Error {
	readonly stage: PlannerCoordinatorErrorStage;
	readonly code: string;
	readonly causeError?: unknown;

	constructor(stage: PlannerCoordinatorErrorStage, code: string, message: string, cause?: unknown) {
		super(message);
		this.name = "PlannerCoordinatorStageError";
		this.stage = stage;
		this.code = code;
		this.causeError = cause;
	}
}

export function isPlannerCoordinatorErrorStage(value: unknown): value is PlannerCoordinatorErrorStage {
	return (
		typeof value === "string" &&
		(PLANNER_COORDINATOR_ERROR_STAGES as readonly string[]).includes(value)
	);
}

export function wrapCoordinatorStageError(
	stage: PlannerCoordinatorErrorStage,
	code: string,
	error: unknown,
): PlannerCoordinatorStageError {
	if (error instanceof PlannerCoordinatorStageError) {
		return error;
	}
	const message = error instanceof Error ? error.message : String(error);
	return new PlannerCoordinatorStageError(stage, code, message.slice(0, 480), error);
}

/** Safe one-line detail for ioBroker states (no huge stacks / paths floods). */
export function safeCoordinatorErrorDetail(error: unknown, maxLen = 240): string {
	const raw =
		error instanceof PlannerCoordinatorStageError
			? `${error.stage}: ${error.message}`
			: error instanceof Error
				? `${error.name}: ${error.message}`
				: String(error);
	return raw.replace(/\s+/g, " ").trim().slice(0, maxLen);
}

export function classifyCoordinatorError(
	error: unknown,
	stageHint?: PlannerCoordinatorErrorStage,
): {
	stage: PlannerCoordinatorErrorStage;
	code: string;
	detail: string;
} {
	if (error instanceof PlannerCoordinatorStageError) {
		return {
			stage: error.stage,
			code: error.code || error.stage,
			detail: safeCoordinatorErrorDetail(error),
		};
	}

	const message = error instanceof Error ? error.message : String(error);
	const detail = safeCoordinatorErrorDetail(error);

	const protocolCodes = [
		"worker_timeout",
		"worker_exit_nonzero",
		"result_missing",
		"result_job_mismatch",
		"result_generation_mismatch",
		"result_status_not_ok",
		"result_input_revision_mismatch",
		"planner worker already running",
	];
	for (const code of protocolCodes) {
		if (message.includes(code)) {
			return { stage: "worker_protocol_failed", code, detail };
		}
	}

	const preparationCodes = [
		"prepared_output_missing",
		"prepared_output_invalid",
		"prepared_output_budget_exceeded",
		"input_revision_mismatch",
	];
	for (const code of preparationCodes) {
		if (message.includes(code)) {
			return {
				stage: "preparation_failed",
				code: code === "input_revision_mismatch" ? "result_input_revision_mismatch" : code,
				detail,
			};
		}
	}

	if (message.includes("snapshot_build_failed") || message.includes("PlannerInputValidation")) {
		return { stage: "snapshot_build_failed", code: "snapshot_build_failed", detail };
	}
	if (
		message.includes("getAbsolutePath") ||
		message.includes("readState failed") ||
		message.includes("readForeignState failed") ||
		message.includes("snapshot file") ||
		message.includes("snapshot_source")
	) {
		return { stage: "snapshot_source_failed", code: "snapshot_source_failed", detail };
	}
	if (
		message.includes("runtime_import") ||
		message.includes("Cannot find module") ||
		message.includes("dynamic import")
	) {
		return { stage: "runtime_import_failed", code: "runtime_import_failed", detail };
	}
	if (
		message.includes("job path must not be under durable") ||
		message.includes("worker_spawn") ||
		message.includes("ENOENT") ||
		message.includes("spawn")
	) {
		return { stage: "worker_spawn_failed", code: "worker_spawn_failed", detail };
	}
	if (message.includes("candidate") || message.includes("compare_shadow")) {
		return { stage: "candidate_validation_failed", code: "candidate_validation_failed", detail };
	}
	if (message.includes("coordinator_stopping") || message.includes("planner_disabled")) {
		return {
			stage: "worker_protocol_failed",
			code: message.includes("planner_disabled") ? "planner_disabled" : "coordinator_stopping",
			detail,
		};
	}

	if (stageHint) {
		return { stage: stageHint, code: stageHint, detail };
	}

	return { stage: "worker_protocol_failed", code: "coordinator_failed", detail };
}
