/** Gemeinsamer exklusiver Lock für Export- und Restore-Operationen. */

export type OperationKind = "backup_export" | "support_export" | "restore_validate" | "restore_apply" | "restore_rollback" | "restore_recovery";

let lockHeld = false;
let lockKind: OperationKind | null = null;

export function isOperationRunning(): boolean {
	return lockHeld;
}

export function currentOperationKind(): OperationKind | null {
	return lockKind;
}

export function tryAcquireOperationLock(kind: OperationKind): { ok: true } | { ok: false; error: "operation_already_running" } {
	if (lockHeld) {
		return { ok: false, error: "operation_already_running" };
	}
	lockHeld = true;
	lockKind = kind;
	return { ok: true };
}

export function releaseOperationLock(): void {
	lockHeld = false;
	lockKind = null;
}

export function resetOperationLockForTest(): void {
	releaseOperationLock();
}
