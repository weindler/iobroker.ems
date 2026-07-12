/** Test- und Diagnose-Hooks für gezielte Fehler-Injektion (nur Restore-Apply/Rollback). */

export type RestoreApplyInjectionPoint =
	| "after_lock"
	| "after_barrier"
	| "after_dryrun_lock"
	| "after_before_snapshot"
	| "after_staged_write"
	| "after_native_apply"
	| "after_learning_first"
	| "after_learning_middle"
	| "after_learning_last"
	| "after_runtime_cleanup"
	| "after_restart_required"
	| "before_committed_journal"
	| "after_committed_before_status";

export type RestoreRollbackInjectionPoint = "native_restore" | "learning_restore";

let applyInjectionPoint: RestoreApplyInjectionPoint | null = null;
let rollbackInjectionPoint: RestoreRollbackInjectionPoint | null = null;
let handlerInjectionAfterCommitted = false;

export function setRestoreApplyInjectionPoint(point: RestoreApplyInjectionPoint | null): void {
	applyInjectionPoint = point;
}

export function setRestoreRollbackInjectionPoint(point: RestoreRollbackInjectionPoint | null): void {
	rollbackInjectionPoint = point;
}

export function setRestoreHandlerInjectionAfterCommitted(active: boolean): void {
	handlerInjectionAfterCommitted = active;
}

export function resetRestoreInjectionHooksForTest(): void {
	applyInjectionPoint = null;
	rollbackInjectionPoint = null;
	handlerInjectionAfterCommitted = false;
}

export async function maybeInjectRestoreApplyFailure(point: RestoreApplyInjectionPoint): Promise<void> {
	if (applyInjectionPoint === point) {
		throw new Error(`injected_failure:${point}`);
	}
}

export async function maybeInjectRestoreRollbackFailure(point: RestoreRollbackInjectionPoint): Promise<void> {
	if (rollbackInjectionPoint === point) {
		throw new Error(`injected_failure:${point}`);
	}
}

export function maybeInjectRestoreHandlerAfterCommitted(): void {
	if (handlerInjectionAfterCommitted) {
		throw new Error("injected_failure:after_committed_before_status");
	}
}
