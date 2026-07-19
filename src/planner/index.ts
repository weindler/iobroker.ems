import type { PlannerHost } from "./inputs";
import { ensurePlannerStates } from "./ensure_states";
import { ensureGridSupplyStates } from "../operator/supply/grid_states";
import { ensureForecastPlanStates } from "../operator/forecast/states";
import { ensureFlexibleContributionStates } from "../operator/contributions/flexible/states";
import { ensureDailyPlanStates } from "../operator/daily_plan/states";
import { ensurePlannerCoordinatorStates } from "../planner_shadow/ensure_states";
import { runPlannerTick } from "./run";

export type { PlannerIntent } from "./types";
export type { PlannerHost } from "./inputs";
export { readPlannerThermalStage, readPlannerInputs } from "./inputs";
export { runPlanner, runPlannerTick, resetPlannerRevisionForTest } from "./run";
export { planCooling, coolingReserveW } from "./rules/cooling";
export { planBattery, buildPlannerConstraints } from "./rules/battery";
export { plannerModePolicyFromGlobalMode } from "./mode_policy";
export { planBatteryWinter, dailyKwhFromHouseLoadForecast } from "./rules/battery_winter";
export { planBatteryWinterPriceWindows, isNowInWinterChargeWindow } from "./rules/battery_winter_windows";
export { readTibber15MinPriceSlots } from "./battery_winter_price_inputs";
export { batteryWinterPlanConfigFromAdapter } from "./battery_winter_config";

export type EnsurePlannerStateTreeOptions = {
	/** When false, skip takeover object tree (default true for non-off modes). */
	includeTakeoverStates?: boolean;
	/** When true, only core coordinator states (mode off). */
	coordinatorMinimal?: boolean;
	/**
	 * Lean surface: skip Shadow/Coordinator/Takeover object trees.
	 * Forecast Plan, Daily Plan and Allocation stay ensured — they are the control path.
	 */
	leanOperatorSurface?: boolean;
	/** Intent-Spiegel nur für aktivierte Add-ons / Winterplan. */
	includeThermalIntent?: boolean;
	includeCoolingIntent?: boolean;
	includeWinterIntent?: boolean;
};

/** Phase B — nur Objektbaum, keine Planner-Ticks. */
export async function ensurePlannerStateTree(
	host: PlannerHost,
	options?: EnsurePlannerStateTreeOptions,
): Promise<void> {
	await ensurePlannerStates(host, {
		includeThermal: options?.includeThermalIntent !== false,
		includeCooling: options?.includeCoolingIntent !== false,
		includeWinter: options?.includeWinterIntent !== false,
	});
	await ensureGridSupplyStates(host);
	await ensureForecastPlanStates(host);
	await ensureFlexibleContributionStates(host);
	await ensureDailyPlanStates(host);
	if (options?.leanOperatorSurface) {
		return;
	}
	await ensurePlannerCoordinatorStates(host, { minimal: options?.coordinatorMinimal === true });
	if (options?.includeTakeoverStates !== false) {
		const { ensurePlannerTakeoverStates } = await import("../planner_takeover/states.js");
		await ensurePlannerTakeoverStates(host);
	}
}

/** Phase F — initiale Planner-Auswertung (Forecast / Daily / Allocation). */
export async function runPlannerRuntime(host: PlannerHost): Promise<void> {
	await runPlannerTick(host);
	const { runGridSupplyTick } = await import("../operator/supply/grid_tick.js");
	const { runFlexibleContributionsTick } = await import("../operator/contributions/flexible/tick.js");
	const { runForecastPlanTick } = await import("../operator/forecast/tick.js");
	const { runDailyPlanTick } = await import("../operator/daily_plan/tick.js");
	const gridForecast = await runGridSupplyTick(host);
	const flexibleContributions = await runFlexibleContributionsTick(
		host as Parameters<typeof runFlexibleContributionsTick>[0],
		gridForecast,
	);
	const forecastPlan = await runForecastPlanTick(
		host as Parameters<typeof runForecastPlanTick>[0],
		gridForecast,
		flexibleContributions,
	);
	await runDailyPlanTick(host as Parameters<typeof runDailyPlanTick>[0], forecastPlan);
}

export async function initPlanner(host: PlannerHost): Promise<void> {
	await ensurePlannerStateTree(host);
	await runPlannerRuntime(host);
}

export async function stopPlanner(): Promise<void> {
	// stateless — nothing to tear down
}
