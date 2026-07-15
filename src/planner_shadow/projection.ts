import { buildGridSupplyForecast } from "../grid_supply/forecast";
import { gridSupplyBuildInputFromSnapshot } from "../planner_preparation/prepare";
import type { PlannerPreparedInput } from "../planner_preparation/types";
import type { PlannerInputSnapshot } from "../planner_snapshot/types";
import type { GridSupplyForecast } from "../grid_supply/types";
import type { PlannerShadowGridProjection, PlannerShadowGridSlotProjection } from "./types";

function slotFromPrepared(slot: PlannerPreparedInput["slots"][number]): PlannerShadowGridSlotProjection {
	return {
		start: slot.startIso,
		end: slot.endIso,
		importAllowed: slot.importAllowed,
		maxImportW: slot.maxImportPowerW,
		priceCtPerKwh: slot.priceCtPerKwh,
		priceClass: slot.priceLabel,
	};
}

function slotFromGrid(slot: GridSupplyForecast["slots"][number]): PlannerShadowGridSlotProjection {
	return {
		start: slot.startIso,
		end: slot.endIso,
		importAllowed: slot.importAllowed,
		maxImportW: slot.maxImportPowerW,
		priceCtPerKwh: slot.priceCtPerKwh,
		priceClass: slot.priceLabel,
	};
}

export function projectionFromGridSupplyForecast(
	forecast: GridSupplyForecast,
	capturedAt: string,
): PlannerShadowGridProjection {
	const slots = forecast.slots.map(slotFromGrid);
	return {
		capturedAt,
		horizonStart: slots.length > 0 ? slots[0].start : capturedAt,
		horizonEnd: slots.length > 0 ? slots[slots.length - 1].end : capturedAt,
		slotCount: slots.length,
		gridImportAllowed: forecast.gridImportAllowed,
		maxGridImportW: forecast.effectiveMaxGridImportW,
		houseFuseLimitW: forecast.configuredHouseFuseLimitW,
		slots,
	};
}

/** In-process reference from the same snapshot input used by the worker (neutral grid_supply core). */
export function projectionFromSnapshot(snapshot: PlannerInputSnapshot): PlannerShadowGridProjection {
	const gridInput = gridSupplyBuildInputFromSnapshot(snapshot);
	const forecast = buildGridSupplyForecast(gridInput);
	return projectionFromGridSupplyForecast(forecast, snapshot.capturedAt);
}

export function projectionFromPreparedInput(prepared: PlannerPreparedInput): PlannerShadowGridProjection {
	const slots = prepared.slots.map(slotFromPrepared);
	return {
		capturedAt: prepared.capturedAt,
		horizonStart: prepared.horizonStart,
		horizonEnd: prepared.horizonEnd,
		slotCount: slots.length,
		gridImportAllowed: prepared.policy.gridImportAllowed,
		maxGridImportW: prepared.policy.effectiveMaxGridImportW,
		houseFuseLimitW: prepared.policy.configuredHouseFuseLimitW,
		slots,
	};
}
