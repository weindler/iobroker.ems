import type { WallboxControlMappingSnapshot } from "./control_mapping";
import type { WallboxOwnershipState } from "./ownership";
import { canSafeRestoreWallbox } from "./ownership";

export interface WallboxRestoreOperation {
	targetStateId: string;
	targetValue: string;
}

export interface WallboxRestorePlan {
	required: boolean;
	possible: boolean;
	operation: WallboxRestoreOperation | null;
	reason: string;
}

/**
 * Safe Restore: EMS gibt die EVCC-Modus-Steuerung an den konfigurierten Hold-Wert zurück,
 * sobald es die Kontrolle verlässt (Live→Dryrun/Observe, Fault/Lockout, Addon/Governance aus).
 * Nur für den EVCC-Steuerpfad relevant — legacy_direct ist strukturell nie live-eligible.
 */
export function planWallboxSafeRestore(
	ownership: WallboxOwnershipState,
	mapping: WallboxControlMappingSnapshot,
): WallboxRestorePlan {
	if (!canSafeRestoreWallbox(ownership)) {
		return { required: false, possible: false, operation: null, reason: "no_ownership" };
	}
	if (ownership.controlModel !== "evcc") {
		return { required: false, possible: false, operation: null, reason: "control_model_not_restorable" };
	}
	if (!mapping.setMode || !mapping.holdModeValueConfirmed || !mapping.evccHoldModeValue) {
		return { required: true, possible: false, operation: null, reason: "hold_mapping_undefined" };
	}
	return {
		required: true,
		possible: true,
		operation: { targetStateId: mapping.setMode.targetStateId, targetValue: mapping.evccHoldModeValue },
		reason: "ems_ownership",
	};
}
