/**
 * Future EMS planner write allowlist (Phase 1: catalog only — not wired into execute).
 *
 * Existing live writes via wb_evcc_set_mode_target / maxCurrent / phase stay unchanged.
 */

export const EVCC_PV_CONTROL = {
	off: 0,
	pv: 1,
	min: 2,
	now: 3,
} as const;

export type EvccPvControlMode = keyof typeof EVCC_PV_CONTROL;

export const EVCC_PHASES_CONFIGURED_WRITE = {
	auto: 0,
	"1p": 1,
	"3p": 3,
} as const;

export type EvccPhasesConfiguredWrite = keyof typeof EVCC_PHASES_CONFIGURED_WRITE;

/** Suffixes under evcc.*.loadpoint.*.control.* that a later planner may write. */
export const EVCC_FUTURE_PLANNER_WRITE_SUFFIXES = [
	"control.off",
	"control.pv",
	"control.min",
	"control.now",
	"control.pvControl",
	"control.maxCurrent",
	"control.phasesConfigured",
] as const;

export type EvccFuturePlannerWriteSuffix = (typeof EVCC_FUTURE_PLANNER_WRITE_SUFFIXES)[number];

/** Taboo for automatic planner writes (this phase and until explicitly enabled). */
export const EVCC_PLANNER_WRITE_TABOO_SUFFIXES = [
	"control.limitSoc",
	"control.minCurrent",
	"control.enableThreshold",
	"control.disableThreshold",
	"control.smartCostLimit",
	"control.vehicleName",
] as const;

export type EvccPlannerWriteTabooSuffix = (typeof EVCC_PLANNER_WRITE_TABOO_SUFFIXES)[number];

export type EvccPlannerWriteClass = "allowed" | "taboo" | "other";

function normalizedId(stateId: string): string {
	return stateId.trim().replace(/\.+/g, ".").toLowerCase();
}

function matchesSuffix(stateId: string, suffix: string): boolean {
	const id = normalizedId(stateId);
	const s = suffix.toLowerCase();
	return id.endsWith(`.${s}`) || id.endsWith(s);
}

export function classifyEvccPlannerWriteTarget(stateId: string): EvccPlannerWriteClass {
	const id = stateId.trim();
	if (!id) return "other";
	if (EVCC_PLANNER_WRITE_TABOO_SUFFIXES.some((s) => matchesSuffix(id, s))) {
		return "taboo";
	}
	if (EVCC_FUTURE_PLANNER_WRITE_SUFFIXES.some((s) => matchesSuffix(id, s))) {
		return "allowed";
	}
	return "other";
}

export function isFuturePlannerWriteAllowed(stateId: string): boolean {
	return classifyEvccPlannerWriteTarget(stateId) === "allowed";
}

export function isPlannerWriteTaboo(stateId: string): boolean {
	return classifyEvccPlannerWriteTarget(stateId) === "taboo";
}

/** Phase 1+2: no new productive planner writes are issued. */
export const EV_FOUNDATION_PHASE1_PLANNER_WRITES_ENABLED = false;
export const EV_FOUNDATION_PLANNER_WRITES_ENABLED = EV_FOUNDATION_PHASE1_PLANNER_WRITES_ENABLED;

export function encodePvControl(mode: EvccPvControlMode): number {
	return EVCC_PV_CONTROL[mode];
}

export function encodePhasesConfiguredWrite(phases: EvccPhasesConfiguredWrite): number {
	return EVCC_PHASES_CONFIGURED_WRITE[phases];
}
