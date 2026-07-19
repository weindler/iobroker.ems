/** Transient Dryrun-Zwang für einen Bootstrap-/Recovery-Lauf (kein dauerhaftes Modul-Global). */

export type ForceDryrunReason = "namespace_cold_start" | "restore_recovery";

let pendingForceDryrunReason: ForceDryrunReason | null = null;

export function setPendingForceDryrunReason(reason: ForceDryrunReason | null): void {
	pendingForceDryrunReason = reason;
}

export function getPendingForceDryrunReason(): ForceDryrunReason | null {
	return pendingForceDryrunReason;
}

export function clearPendingForceDryrunReason(): void {
	pendingForceDryrunReason = null;
}

export function resetRestoreDryrunContextForTest(): void {
	pendingForceDryrunReason = null;
}
