import type { Price15MinSlot } from "../learning/price_forecast/tibber_parse";
import type { PlannerHost } from "./inputs";
import { ensurePlannerStates } from "./ensure_states";
import { ensureGridSupplyStates } from "../operator/supply/grid_states";
import { ensureForecastPlanStates } from "../operator/forecast/states";
import { ensureFlexibleContributionStates } from "../operator/contributions/flexible/states";
import { runPlannerTick } from "./run";
import { runGridSupplyTick } from "../operator/supply/grid_tick";
import { runFlexibleContributionsTick } from "../operator/contributions/flexible/tick";
import { runForecastPlanTick } from "../operator/forecast/tick";
import { ensureDailyPlanStates } from "../operator/daily_plan/states";
import { runDailyPlanTick } from "../operator/daily_plan/tick";
import { buildGridSupplyForecast, gridSlotsToPrice15Min } from "../operator/supply/grid";
import { collectGridSupplyBuildInput } from "../operator/supply/grid_read";
import { logMemoryInventory, recordMemoryInventory } from "../diagnostics/memory_inventory";
import { probeStartupMemory } from "../diagnostics/startup_memory";
import type { MemoryProbeLogger } from "../diagnostics/memory_probe";

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

function plannerProbe(log: MemoryProbeLogger | undefined, checkpoint: string): void {
	probeStartupMemory(log, checkpoint);
}

/** Phase B — nur Objektbaum, keine Planner-Ticks. */
export async function ensurePlannerStateTree(host: PlannerHost): Promise<void> {
	await ensurePlannerStates(host);
	await ensureGridSupplyStates(host);
	await ensureForecastPlanStates(host);
	await ensureFlexibleContributionStates(host);
	await ensureDailyPlanStates(host);
}

/** Phase F — initiale Planner-Auswertung. */
export async function runPlannerRuntime(host: PlannerHost): Promise<void> {
	const log = host.log;
	const now = new Date();

	plannerProbe(log, "planner_runtime_start");

	plannerProbe(log, "planner_before_grid_collect");
	const gridInput = await collectGridSupplyBuildInput(host, now);
	const gridForecast = buildGridSupplyForecast(gridInput);
	const priceSlots: Price15MinSlot[] = gridSlotsToPrice15Min(gridForecast.slots);
	recordMemoryInventory({
		module: "planner_grid_collect",
		checkpoint: "after_collect",
		arrayEntries: priceSlots.length,
		mapEntries: gridForecast.slots.length,
	});
	logMemoryInventory(log, "planner_grid_collect", "after_collect");
	plannerProbe(log, "planner_after_grid_collect");

	plannerProbe(log, "planner_before_run_planner_tick");
	await runPlannerTick(host, { batteryWinterPriceSlots: priceSlots });
	plannerProbe(log, "planner_after_run_planner_tick");

	plannerProbe(log, "planner_before_grid_supply_write");
	await runGridSupplyTick(host, { forecast: gridForecast, input: gridInput });
	plannerProbe(log, "planner_after_grid_supply_write");

	plannerProbe(log, "planner_before_flexible_contributions");
	const flexibleContributions = await runFlexibleContributionsTick(
		host as Parameters<typeof runFlexibleContributionsTick>[0],
		gridForecast,
	);
	plannerProbe(log, "planner_after_flexible_contributions");

	plannerProbe(log, "planner_before_forecast_plan");
	const forecastPlan = await runForecastPlanTick(
		host as Parameters<typeof runForecastPlanTick>[0],
		gridForecast,
		flexibleContributions,
	);
	recordMemoryInventory({
		module: "planner_forecast_plan",
		checkpoint: "after_build",
		arrayEntries: forecastPlan.slots.length,
		recordsLoaded: forecastPlan.contributions.length,
	});
	logMemoryInventory(log, "planner_forecast_plan", "after_build");
	plannerProbe(log, "planner_after_forecast_plan");

	plannerProbe(log, "planner_before_daily_plan");
	await runDailyPlanTick(host as Parameters<typeof runDailyPlanTick>[0], forecastPlan);
	plannerProbe(log, "planner_after_daily_plan");

	plannerProbe(log, "planner_runtime_done");
}

export async function initPlanner(host: PlannerHost): Promise<void> {
	await ensurePlannerStateTree(host);
	await runPlannerRuntime(host);
}

export async function stopPlanner(): Promise<void> {
	// stateless — nothing to tear down
}
