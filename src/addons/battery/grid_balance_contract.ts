/**
 * Grid-balance safety contract (v0.1.284).
 *
 * Existing path (do not replace with a second optimiser):
 *   src/addons/battery/grid_balance.ts  — formula + legacy gates
 *   src/addons/battery/grid_balance_power.ts — EV-Abzug, Deadband, Stabilisierung, Clamp, Ownership
 *   src/addons/battery/index.ts         — Sonnen control.charge writes in Mode 2
 *   src/addons/battery/runtime/grid_balance_watch.ts — on-change 500 ms + 5 s tick
 *
 * Authority (lowest wins last): Safety/Fault/Restore → External EV → Battery Hold
 * → planned EMS battery action → grid balance.
 *
 * GRID_BALANCE_EXECUTION_ENABLED stays false: no Dauerbetrieb. Productive writes
 * only via one-shot `grid_balance.live_test_armed` (ack:false) after all gates.
 * One-shot is a session: at most one regular setpoint. The matching 0-release
 * stays allowed after `consumed` while GB still owns and no higher authority
 * (Hold / External / Planned) is active. Unified with planned/grid_charge via
 * `runtime/setpoint_session.ts` (diagnosis: addons.battery.runtime.battery_setpoint_*).
 */

export const GRID_BALANCE_EXECUTION_ENABLED = false;

export const GRID_BALANCE_MAX_PRICE_DEFAULT_CT = 30;
export const GRID_BALANCE_MAX_PRICE_MIN_CT = 0;
export const GRID_BALANCE_MAX_PRICE_MAX_CT = 200;

export type GridBalanceAuthority =
	| "safety"
	| "external_ev"
	| "battery_hold"
	| "planned_battery"
	| "grid_balance"
	| "none";

export type GridBalanceEvConflictKind =
	| ""
	| "ev_now"
	| "ev_external"
	| "ev_ems_grid";

export interface GridBalanceSafetyInput {
	adminEnabled: boolean;
	emsMirrorEnabled: boolean;
	globalLive: boolean;
	addonLive: boolean;
	addonEnabled: boolean;
	governanceEnabled: boolean;
	faultActive: boolean;
	lockoutActive: boolean;
	restoreInProgress: boolean;
	sourceStale: boolean;
	sourceOffline: boolean;
	holdPlanned: boolean;
	holdActive: boolean;
	evccBatteryModeHold: boolean;
	plannedBatteryAction: boolean;
	ownershipActive: boolean;
	dailyPlanAuthoritative: boolean;
	mode1Active: boolean;
	priceNowCt: number | null;
	priceLimitCt: number;
	priceGateEnabled: boolean;
	evConflictKind: GridBalanceEvConflictKind;
	externalEvAuthority: boolean;
	/** One-shot: regular setpoint only. Session 0-release does not use this. */
	liveTestPermit?: boolean;
}

export interface GridBalanceSafetyResult {
	enabled: boolean;
	ready: boolean;
	active: boolean;
	policyAllowed: boolean;
	writeAllowed: boolean;
	authority: GridBalanceAuthority;
	blockReason: string;
	holdDetected: boolean;
	evConflict: boolean;
	priceAllowed: boolean;
	explain: string;
}

export function parseGridBalanceMaxPriceCt(raw: unknown, fallback = GRID_BALANCE_MAX_PRICE_DEFAULT_CT): number {
	if (raw === null || raw === undefined || raw === "") return fallback;
	if (typeof raw === "boolean") return fallback;
	const n = typeof raw === "number" ? raw : parseFloat(String(raw).replace(",", "."));
	if (!Number.isFinite(n) || n < 0) return fallback;
	return Math.min(GRID_BALANCE_MAX_PRICE_MAX_CT, Math.max(GRID_BALANCE_MAX_PRICE_MIN_CT, n));
}

export function normalizeLoadpointMode(raw: unknown): string {
	return String(raw ?? "")
		.trim()
		.toLowerCase()
		.replace(/\s+/g, "");
}

export function classifyGridBalanceEvConflict(input: {
	loadpointMode: unknown;
	charging: boolean;
	chargePowerW: number | null;
	wallboxHold: boolean;
	batteryBoost: boolean;
	externalAuthority: boolean;
	tibberRewardsActive: boolean;
	wallboxEnergySource: unknown;
	wallboxAllocatedGridW: number | null;
}): { conflict: boolean; kind: GridBalanceEvConflictKind } {
	if (input.externalAuthority || input.tibberRewardsActive) {
		return { conflict: true, kind: "ev_external" };
	}
	const mode = normalizeLoadpointMode(input.loadpointMode);
	if (input.batteryBoost || mode === "now" || input.wallboxHold) {
		return { conflict: true, kind: "ev_now" };
	}
	const energy = String(input.wallboxEnergySource ?? "")
		.trim()
		.toLowerCase();
	const gridAlloc = input.wallboxAllocatedGridW != null && input.wallboxAllocatedGridW > 0;
	if (energy === "grid" || gridAlloc) {
		return { conflict: true, kind: "ev_ems_grid" };
	}
	return { conflict: false, kind: "" };
}

export function formatGridBalanceExplain(input: {
	enabled: boolean;
	blockReason: string;
	priceNowCt: number | null;
	priceLimitCt: number;
	gridImportW: number;
}): string {
	const reason = input.blockReason;
	if (!input.enabled || reason === "disabled") {
		return "grid_balance=blocked, reason=disabled";
	}
	if (reason === "price_above_limit") {
		const price = input.priceNowCt != null && Number.isFinite(input.priceNowCt) ? input.priceNowCt.toFixed(1) : "?";
		return `grid_balance=blocked, price=${price}ct, limit=${input.priceLimitCt.toFixed(1)}ct`;
	}
	if (reason) {
		return `grid_balance=blocked, reason=${reason}`;
	}
	const importW = Number.isFinite(input.gridImportW) ? Math.round(input.gridImportW) : 0;
	return `grid_balance=ready, grid_import=${importW}W`;
}

function firstBlock(input: GridBalanceSafetyInput): { reason: string; authority: GridBalanceAuthority } {
	if (input.restoreInProgress) return { reason: "restore_in_progress", authority: "safety" };
	if (input.faultActive || input.lockoutActive) return { reason: "fault_lockout", authority: "safety" };
	if (!input.addonEnabled) return { reason: "addon_disabled", authority: "safety" };
	if (!input.governanceEnabled) return { reason: "governance", authority: "safety" };
	if (!input.globalLive) return { reason: "global_dryrun", authority: "safety" };
	if (!input.addonLive) return { reason: "addon_dryrun", authority: "safety" };
	if (input.sourceOffline) return { reason: "source_offline", authority: "safety" };
	if (input.sourceStale) return { reason: "source_stale", authority: "safety" };
	if (!input.adminEnabled) return { reason: "disabled", authority: "none" };
	if (input.externalEvAuthority || input.evConflictKind === "ev_external") {
		return { reason: "external_ev_authority", authority: "external_ev" };
	}
	if (input.holdPlanned || input.holdActive || input.evccBatteryModeHold) {
		return { reason: "battery_hold", authority: "battery_hold" };
	}
	if (input.evConflictKind === "ev_now" || input.evConflictKind === "ev_ems_grid") {
		return { reason: "ev_now_grid_charge", authority: "external_ev" };
	}
	if (input.evConflictKind) {
		return { reason: "ev_conflict", authority: "external_ev" };
	}
	if (input.plannedBatteryAction || input.ownershipActive || input.dailyPlanAuthoritative || input.mode1Active) {
		return { reason: "planned_battery_action", authority: "planned_battery" };
	}

	const priceKnown = input.priceNowCt != null && Number.isFinite(input.priceNowCt);
	if (!priceKnown) return { reason: "price_unknown", authority: "grid_balance" };
	if (input.priceNowCt! > input.priceLimitCt) {
		return { reason: "price_above_limit", authority: "grid_balance" };
	}

	return { reason: "", authority: "grid_balance" };
}

export function evaluateGridBalanceSafety(input: GridBalanceSafetyInput): GridBalanceSafetyResult {
	const holdDetected = input.holdPlanned || input.holdActive || input.evccBatteryModeHold;
	const evConflict = input.externalEvAuthority || input.evConflictKind !== "";
	const { reason, authority } = firstBlock(input);
	const enabled = input.adminEnabled;
	const priceKnown = input.priceNowCt != null && Number.isFinite(input.priceNowCt);
	const priceAllowed = priceKnown && input.priceNowCt! <= input.priceLimitCt;
	const policyAllowed = reason === "";
	const ready = policyAllowed;
	const executionReleased = GRID_BALANCE_EXECUTION_ENABLED || input.liveTestPermit === true;
	const writeAllowed =
		policyAllowed && executionReleased && input.globalLive && input.addonLive;
	const explain = formatGridBalanceExplain({
		enabled,
		blockReason: reason,
		priceNowCt: input.priceNowCt,
		priceLimitCt: input.priceLimitCt,
		gridImportW: 0,
	});
	return {
		enabled,
		ready,
		active: false,
		policyAllowed,
		writeAllowed,
		authority,
		blockReason: reason,
		holdDetected,
		evConflict,
		priceAllowed,
		explain,
	};
}

export function withGridImportExplain(
	result: GridBalanceSafetyResult,
	gridImportW: number,
	priceNowCt: number | null,
	priceLimitCt: number,
): GridBalanceSafetyResult {
	return {
		...result,
		explain: formatGridBalanceExplain({
			enabled: result.enabled,
			blockReason: result.blockReason,
			priceNowCt,
			priceLimitCt,
			gridImportW,
		}),
	};
}
