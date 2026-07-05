import type { PlannerHost } from "./inputs";
import { ensurePlannerStates } from "./ensure_states";
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

export async function initPlanner(host: PlannerHost): Promise<void> {
	await ensurePlannerStates(host);
	await runPlannerTick(host);
}

export async function stopPlanner(): Promise<void> {
	// stateless — nothing to tear down
}
