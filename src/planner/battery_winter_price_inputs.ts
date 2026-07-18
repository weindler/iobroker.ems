import type { Price15MinSlot } from "../learning/price_forecast/tibber_parse";
import type { PlannerHost } from "./inputs";
import { buildGridSupplyForecast, gridSlotsToPrice15Min } from "../operator/supply/grid";
import { collectGridSupplyBuildInput, type GridSupplyReadHost } from "../operator/supply/grid_read";

/** Liefert 15-min-Preisslots über die gemeinsame Grid-Supply-Schicht. */
export async function readTibber15MinPriceSlots(host: PlannerHost, now: Date): Promise<Price15MinSlot[]> {
	const input = await collectGridSupplyBuildInput(host as GridSupplyReadHost, now);
	const forecast = buildGridSupplyForecast(input);
	return gridSlotsToPrice15Min(forecast.slots);
}
