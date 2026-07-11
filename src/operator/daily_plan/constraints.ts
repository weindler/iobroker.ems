import { operatorQuality } from "../quality";
import type { DailyPlanSlot } from "./types";
import { slotKey } from "./slots";

export interface ForecastSlotLike {
	slot: { startIso: string; endIso: string };
	pvPowerW: number | null;
	houseLoadPowerW: number | null;
	fixedBalancePowerW: number | null;
	gridPriceCtPerKwh: number | null;
	gridImportAllowed: boolean;
	gridMaxImportPowerW: number | null;
}

export function effectiveImportLimitW(
	effectiveMaxGridImportW: number | null,
	configuredHouseFuseLimitW: number | null,
): number | null {
	const values = [effectiveMaxGridImportW, configuredHouseFuseLimitW].filter(
		(v): v is number => v !== null && Number.isFinite(v) && v > 0,
	);
	if (values.length === 0) return null;
	return Math.min(...values);
}

export function remainingGridImportForSlot(
	importLimitW: number | null,
	houseLoadPowerW: number | null,
): number | null {
	if (importLimitW === null) return null;
	if (houseLoadPowerW === null) return null;
	return Math.max(0, Math.round(importLimitW - houseLoadPowerW));
}

export function availablePvSurplus(fixedBalancePowerW: number | null): number | null {
	if (fixedBalancePowerW === null) return null;
	return Math.max(0, fixedBalancePowerW);
}

export function mergeForecastIntoDailySlot(
	horizonSlot: { startIso: string; endIso: string },
	forecastByKey: Map<string, ForecastSlotLike>,
	importLimitW: number | null,
): DailyPlanSlot {
	const key = slotKey(horizonSlot.startIso, horizonSlot.endIso);
	const fc = forecastByKey.get(key);

	const pvForecastPowerW = fc?.pvPowerW ?? null;
	const fixedHouseLoadPowerW = fc?.houseLoadPowerW ?? null;
	let fixedBalancePowerW = fc?.fixedBalancePowerW ?? null;
	if (fixedBalancePowerW === null && pvForecastPowerW !== null && fixedHouseLoadPowerW !== null) {
		fixedBalancePowerW = pvForecastPowerW - fixedHouseLoadPowerW;
	}

	const pvSurplus = availablePvSurplus(fixedBalancePowerW);
	const gridRemaining = remainingGridImportForSlot(importLimitW, fixedHouseLoadPowerW);

	const reasons: string[] = [];
	if (pvForecastPowerW !== null) reasons.push("PV");
	if (fixedHouseLoadPowerW !== null) reasons.push("Hauslast");
	if (fc?.gridPriceCtPerKwh !== null) reasons.push("Preis");

	return {
		slot: { startIso: horizonSlot.startIso, endIso: horizonSlot.endIso },
		pvForecastPowerW,
		fixedHouseLoadPowerW,
		fixedBalancePowerW,
		gridPriceCtPerKwh: fc?.gridPriceCtPerKwh ?? null,
		gridImportAllowed: fc?.gridImportAllowed ?? true,
		configuredGridImportLimitW: importLimitW,
		remainingGridImportPowerW: gridRemaining,
		availablePvSurplusPowerW: pvSurplus,
		allocatedFlexiblePowerW: 0,
		allocatedPvPowerW: 0,
		allocatedGridPowerW: 0,
		remainingPvSurplusPowerW: pvSurplus,
		remainingGridImportPowerWAfterAlloc: gridRemaining,
		allocations: [],
		quality: operatorQuality(
			pvSurplus === null && gridRemaining === null ? "degraded" : "valid",
			reasons.length > 0 ? reasons.join(", ") + "." : "Slot ohne vollständige Eingangsdaten.",
		),
		reasonDe: reasons.length > 0 ? reasons.join(", ") + "." : "Keine zeitlich aufgelösten Werte.",
	};
}

export function buildDailyPlanSlots(
	horizonSlots: Array<{ startIso: string; endIso: string }>,
	forecastSlots: ForecastSlotLike[],
	effectiveMaxGridImportW: number | null,
	configuredHouseFuseLimitW: number | null,
): DailyPlanSlot[] {
	const importLimitW = effectiveImportLimitW(effectiveMaxGridImportW, configuredHouseFuseLimitW);
	const forecastByKey = new Map<string, ForecastSlotLike>();
	for (const s of forecastSlots) {
		forecastByKey.set(slotKey(s.slot.startIso, s.slot.endIso), s);
	}
	return horizonSlots.map((s) => mergeForecastIntoDailySlot(s, forecastByKey, importLimitW));
}
