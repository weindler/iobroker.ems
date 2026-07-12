let restoreInProgress = false;
let restartRequired = false;

export function isRestoreInProgress(): boolean {
	return restoreInProgress;
}

export function setRestoreInProgress(active: boolean): void {
	restoreInProgress = active;
}

export function isRestoreRestartRequired(): boolean {
	return restartRequired;
}

export function setRestoreRestartRequired(active: boolean): void {
	restartRequired = active;
}

export function resetRestoreBarrierForTest(): void {
	restoreInProgress = false;
	restartRequired = false;
}

export function assertDeviceActionAllowed(): { ok: true } | { ok: false; reason: "restore_in_progress" } {
	if (restoreInProgress) {
		return { ok: false, reason: "restore_in_progress" };
	}
	return { ok: true };
}
