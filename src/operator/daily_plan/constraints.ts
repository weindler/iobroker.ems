import { operatorQuality } from "../quality";
import type { DailyPlanSlot } from "./types";

export interface ForecastSlotLike {
	slot: { startIso: string; endIso: string };
	pvPowerW: number | null;
	houseLoadPowerW: number | null;
	fixedBalancePowerW: number | null;
	gridPriceCtPerKwh: number | null;
	gridImportAllowed: boolean;
	gridMaxImportPowerW: number | null;
}

interface ForecastFieldEntry<T> {
	startMs: number;
	endMs: number;
	value: T;
}

/**
 * Forecast-Quellen liefern unterschiedliche Auflösungen im selben `ForecastPlanSlot[]`
 * (z. B. Grid-Preise als exakte 15-Min-Slots, Hauslast als Mehrstunden-Segmente). Ein
 * exakter Key-Match auf den 15-Min-Horizont trifft daher nur die 15-Min-Quellen. Diese
 * Indizes erlauben pro Feld eine Containment-Suche: Ein Horizont-Slot übernimmt den Wert
 * jedes Forecast-Slots, der ihn zeitlich vollständig umschließt.
 */
function buildFieldIndex<T>(
	forecastSlots: ForecastSlotLike[],
	pick: (s: ForecastSlotLike) => T | null | undefined,
): ForecastFieldEntry<T>[] {
	const entries: ForecastFieldEntry<T>[] = [];
	for (const s of forecastSlots) {
		const value = pick(s);
		if (value === null || value === undefined) continue;
		const startMs = Date.parse(s.slot.startIso);
		const endMs = Date.parse(s.slot.endIso);
		if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) continue;
		entries.push({ startMs, endMs, value });
	}
	entries.sort((a, b) => a.startMs - b.startMs);
	return entries;
}

/** Kleinster (präzisester) umschließender Treffer gewinnt bei Überlappung. */
function lookupContaining<T>(entries: ForecastFieldEntry<T>[], startIso: string, endIso: string): T | null {
	const hStart = Date.parse(startIso);
	const hEnd = Date.parse(endIso);
	if (!Number.isFinite(hStart) || !Number.isFinite(hEnd)) return null;
	let best: ForecastFieldEntry<T> | null = null;
	for (const e of entries) {
		if (e.startMs > hStart) break;
		if (e.startMs <= hStart && e.endMs >= hEnd) {
			if (!best || e.endMs - e.startMs < best.endMs - best.startMs) best = e;
		}
	}
	return best ? best.value : null;
}

export interface ForecastFieldIndex {
	pv: ForecastFieldEntry<number>[];
	houseLoad: ForecastFieldEntry<number>[];
	gridPrice: ForecastFieldEntry<number>[];
	gridImportAllowed: ForecastFieldEntry<boolean>[];
	gridMaxImportPowerW: ForecastFieldEntry<number>[];
}

export function buildForecastFieldIndex(forecastSlots: ForecastSlotLike[]): ForecastFieldIndex {
	return {
		pv: buildFieldIndex(forecastSlots, (s) => s.pvPowerW),
		houseLoad: buildFieldIndex(forecastSlots, (s) => s.houseLoadPowerW),
		gridPrice: buildFieldIndex(forecastSlots, (s) => s.gridPriceCtPerKwh),
		gridImportAllowed: buildFieldIndex(forecastSlots, (s) => s.gridImportAllowed),
		gridMaxImportPowerW: buildFieldIndex(forecastSlots, (s) => s.gridMaxImportPowerW),
	};
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
	index: ForecastFieldIndex,
	importLimitW: number | null,
): DailyPlanSlot {
	const pvForecastPowerW = lookupContaining(index.pv, horizonSlot.startIso, horizonSlot.endIso);
	const fixedHouseLoadPowerW = lookupContaining(index.houseLoad, horizonSlot.startIso, horizonSlot.endIso);
	const gridPriceCtPerKwh = lookupContaining(index.gridPrice, horizonSlot.startIso, horizonSlot.endIso);
	const gridImportAllowed =
		lookupContaining(index.gridImportAllowed, horizonSlot.startIso, horizonSlot.endIso) ?? true;

	let fixedBalancePowerW: number | null = null;
	if (pvForecastPowerW !== null && fixedHouseLoadPowerW !== null) {
		fixedBalancePowerW = pvForecastPowerW - fixedHouseLoadPowerW;
	}

	const pvSurplus = availablePvSurplus(fixedBalancePowerW);
	const gridRemaining = remainingGridImportForSlot(importLimitW, fixedHouseLoadPowerW);

	const reasons: string[] = [];
	if (pvForecastPowerW !== null) reasons.push("PV");
	if (fixedHouseLoadPowerW !== null) reasons.push("Hauslast");
	if (gridPriceCtPerKwh !== null) reasons.push("Preis");

	return {
		slot: { startIso: horizonSlot.startIso, endIso: horizonSlot.endIso },
		pvForecastPowerW,
		fixedHouseLoadPowerW,
		fixedBalancePowerW,
		gridPriceCtPerKwh,
		gridImportAllowed,
		configuredGridImportLimitW: importLimitW,
		remainingGridImportPowerW: gridRemaining,
		availablePvSurplusPowerW: pvSurplus,
		allocatedFlexiblePowerW: 0,
		allocatedPvPowerW: 0,
		allocatedGridPowerW: 0,
		allocatedBatteryPowerW: 0,
		remainingPvSurplusPowerW: pvSurplus,
		remainingGridImportPowerWAfterAlloc: gridRemaining,
		remainingBatteryDischargePowerW: null,
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
	const index = buildForecastFieldIndex(forecastSlots);
	return horizonSlots.map((s) => mergeForecastIntoDailySlot(s, index, importLimitW));
}
