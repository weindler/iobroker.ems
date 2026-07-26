import type { PlannerHost } from "./inputs";
import { ensurePlannerStates } from "./ensure_states";
import { ensureGridSupplyStates } from "../operator/supply/grid_states";
import { ensureForecastPlanStates } from "../operator/forecast/states";
import { ensureFlexibleContributionStates } from "../operator/contributions/flexible/states";
import { ensureDailyPlanStates } from "../operator/daily_plan/states";

export type { PlannerIntent } from "./types";
export type { PlannerHost } from "./inputs";
export { readPlannerThermalStage, readPlannerInputs } from "./inputs";
/** Pure composition for tests/diagnose only — not used on the production tick (Block 4). */
export { runPlanner, resetPlannerRevisionForTest } from "./run";
export { planCooling, coolingReserveW } from "../operator/planning/cooling";
export { planBattery, buildPlannerConstraints } from "../operator/planning/battery";
export { plannerModePolicyFromGlobalMode } from "./mode_policy";
export { planBatteryWinter, dailyKwhFromHouseLoadForecast } from "../operator/planning/battery_winter";
export {
	planBatteryWinterPriceWindows,
	isNowInWinterChargeWindow,
} from "../operator/planning/battery_winter_windows";
export { readTibber15MinPriceSlots } from "./battery_winter_price_inputs";
export { batteryWinterPlanConfigFromAdapter } from "./battery_winter_config";

export type EnsurePlannerStateTreeOptions = {
	/** @deprecated Block 5 — Legacy Intent-Bäume werden nicht mehr angelegt. */
	includeThermalIntent?: boolean;
	/** @deprecated Block 5 — ignoriert. */
	includeCoolingIntent?: boolean;
	/** @deprecated Block 5 — ignoriert. */
	includeWinterIntent?: boolean;
};

/**
 * Phase B — nur Objektbaum, keine Planner-Ticks.
 * Roadmap Block 4/5: einziger Planungspfad ist Operator Forecast → Daily Plan → Allocation.
 * Legacy Realtime-Intent-Bäume (thermal/cooling/winter) werden nicht mehr angelegt und per
 * Surface-Cleanup von Alt-Installationen entfernt.
 */
export async function ensurePlannerStateTree(
	host: PlannerHost,
	_options?: EnsurePlannerStateTreeOptions,
): Promise<void> {
	await ensurePlannerStates(host);
	await ensureGridSupplyStates(host);
	await ensureForecastPlanStates(host);
	await ensureFlexibleContributionStates(host);
	await ensureDailyPlanStates(host);
}

/**
 * Operator-only runtime (Forecast / Daily / Allocation) — kein Legacy-`runPlannerTick`.
 */
export async function runPlannerRuntime(host: PlannerHost): Promise<void> {
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

export async function stopPlanner(): Promise<void> {
	// stateless — nothing to tear down
}
