/**
 * Netzausgleich — Ganzhauslast.
 *
 * Eine Hausbatterie kann einzelne Verbraucher physikalisch nicht trennen. Der schnelle
 * Netzausgleich arbeitet deshalb immer mit der real gemessenen gesamten Hauslast. Ob ein
 * flexibler Verbraucher laufen darf, entscheidet der Unified Planner über Preis, Forecast,
 * dynamische Reserve, Mindestlaufzeit und Priorität.
 */

export type GridBalancePolicyExcludedConsumer = {
	id: string;
	allowedOnBattery: boolean | null;
	commandedPowerW: number | null;
};

export type GridBalancePolicyLoadAdjustmentInput = {
	rawConsumptionW: number;
	/**
	 * Legacy input retained for API compatibility. Consumers are never subtracted from the
	 * physical whole-house load; load shedding belongs to the planner.
	 */
	excludedConsumers: GridBalancePolicyExcludedConsumer[];
};

export type GridBalancePolicyLoadAdjustment = {
	policyAdjustedConsumptionW: number;
	excludedLoadW: number;
	excludedConsumerIds: string[];
	reasonDe: string;
};

export type ReservedGridBalanceDischargeBudgetInput = {
	maxDischargePowerW?: number | null;
	requiredSocAtPvEndPct?: number | null;
	dynamicNightConsumptionW?: number | null;
	estimatedBatteryEmptyAtIso?: string | null;
};

/** Behält die Planner-Freigabe dreiwertig; nur echtes Boolean wird akzeptiert. */
export function parseExplicitBatteryPermission(raw: unknown): boolean | null {
	if (raw === true) return true;
	if (raw === false) return false;
	return null;
}

/**
 * Returns the measured whole-house load unchanged. The legacy consumer list is intentionally
 * ignored: subtracting a running heater caused the battery to reduce discharge and forced the
 * missing energy to be imported from the grid.
 */
export function resolveGridBalancePolicyLoadAdjustment(
	input: GridBalancePolicyLoadAdjustmentInput,
): GridBalancePolicyLoadAdjustment {
	const raw = Number.isFinite(input.rawConsumptionW) ? Math.max(0, input.rawConsumptionW) : 0;
	return {
		policyAdjustedConsumptionW: raw,
		excludedLoadW: 0,
		excludedConsumerIds: [],
		reasonDe: "",
	};
}
