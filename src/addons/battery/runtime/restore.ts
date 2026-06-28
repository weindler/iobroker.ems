import type { OwnershipState } from "./ownership";
import { canSafeRestore } from "./ownership";

export interface RestorePlan {
	required: boolean;
	stopCharge: boolean;
	setSelfConsumption: boolean;
	restoreGridBalance: boolean;
	reason: string;
}

/**
 * Safe Restore: charge stoppen → Self Consumption / Modus 2 → Netzausgleich
 * kontrolliert wiederherstellen. Nur sinnvoll bei nachgewiesener EMS-Ownership.
 */
export function planSafeRestore(input: {
	ownership: OwnershipState;
	gridBalanceWasActive: boolean;
}): RestorePlan {
	if (!canSafeRestore(input.ownership)) {
		return {
			required: false,
			stopCharge: false,
			setSelfConsumption: false,
			restoreGridBalance: false,
			reason: "no_ownership",
		};
	}
	return {
		required: true,
		stopCharge: true,
		setSelfConsumption: true,
		restoreGridBalance: input.gridBalanceWasActive,
		reason: "ems_ownership",
	};
}
