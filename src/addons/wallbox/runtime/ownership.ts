import type { WallboxControlModel } from "../evcc_control_config";

/**
 * EMS-Ownership: EMS hat aktiv eine Steuer-Operation (Ladefreigabe/Modus) geschrieben
 * und ist damit verantwortlich, den sicheren Zustand wiederherzustellen, sobald es
 * die Kontrolle verlässt (Live→Dryrun, Governance/Addon aus, Fault/Lockout).
 */
export interface WallboxOwnershipState {
	active: boolean;
	controlModel: WallboxControlModel;
	startedAt: string | null;
	writeScenario: string | null;
}

export function emptyWallboxOwnership(): WallboxOwnershipState {
	return { active: false, controlModel: "none", startedAt: null, writeScenario: null };
}

export function grantWallboxOwnership(
	controlModel: WallboxControlModel,
	writeScenario: string | null,
	nowIso: string,
): WallboxOwnershipState {
	return { active: true, controlModel, startedAt: nowIso, writeScenario };
}

/** Safe Restore ist nur sinnvoll, wenn EMS die Kontrolle nachweislich selbst übernommen hat. */
export function canSafeRestoreWallbox(ownership: WallboxOwnershipState): boolean {
	return ownership.active && ownership.controlModel !== "none";
}
