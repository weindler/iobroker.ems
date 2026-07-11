import type { PlannerHost } from "./inputs";
import { ensurePlannerStates } from "./ensure_states";
import { ensureGridSupplyStates } from "../operator/supply/grid_states";
import { ensureForecastPlanStates } from "../operator/forecast/states";
import { ensureFlexibleContributionStates } from "../operator/contributions/flexible/states";
import { runPlannerTick } from "./run";
import { runGridSupplyTick } from "../operator/supply/grid_tick";
import { runFlexibleContributionsTick } from "../operator/contributions/flexible/tick";
import { runForecastPlanTick } from "../operator/forecast/tick";

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

export async function initPlanner(host: PlannerHost): Promise<void> {
	await ensurePlannerStates(host);
	await ensureGridSupplyStates(host);
	await ensureForecastPlanStates(host);
	await ensureFlexibleContributionStates(host);
	await runPlannerTick(host);
	const gridForecast = await runGridSupplyTick(host);
	const flexibleContributions = await runFlexibleContributionsTick(
		host as Parameters<typeof runFlexibleContributionsTick>[0],
		gridForecast,
	);
	await runForecastPlanTick(
		host as Parameters<typeof runForecastPlanTick>[0],
		gridForecast,
		flexibleContributions,
	);
}

export async function stopPlanner(): Promise<void> {
	// stateless — nothing to tear down
}
