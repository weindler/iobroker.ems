/**
 * Publish compact VIS price-board JSON from already-written operator states.
 * Display only — never changes Thermal/Battery/EV/Climate/Planner decisions.
 */

import { ALLOCATION_ADDON_STATE_IDS } from "../daily_plan/states";
import { GRID_SUPPLY_STATE_IDS } from "../supply/grid_states";
import { asNum, type StateHost } from "../../ems_light/state_util";
import { setStateIfChanged } from "../../policy/core/state_write";
import { BAT } from "../../addons/battery/ensure_states";
import {
	buildVisPriceTimeline,
	emptyVisPriceTimeline,
	VIS_PRICE_TIMELINE_STATE_ID,
	type VisPriceAllocEntry,
	type VisPriceGridSlot,
} from "./price_timeline";

function parseJsonArray(raw: unknown): unknown[] {
	if (Array.isArray(raw)) return raw;
	if (typeof raw !== "string" || !raw.trim()) return [];
	try {
		const parsed = JSON.parse(raw) as unknown;
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}

function asGridSlots(raw: unknown): VisPriceGridSlot[] {
	return parseJsonArray(raw).filter((row): row is VisPriceGridSlot => row != null && typeof row === "object");
}

function asAlloc(raw: unknown): VisPriceAllocEntry[] {
	return parseJsonArray(raw).filter((row): row is VisPriceAllocEntry => row != null && typeof row === "object");
}

async function readVal(host: StateHost, id: string): Promise<unknown> {
	try {
		const st = await host.getStateAsync(id);
		return st?.val;
	} catch {
		return null;
	}
}

export async function publishVisPriceTimeline(host: StateHost, now = new Date()): Promise<void> {
	let board = emptyVisPriceTimeline(now);
	try {
		const [
			gridSlotsRaw,
			gridNow,
			liveNow,
			gbMin,
			gbAllowed,
			batteryAlloc,
			wallboxAlloc,
			immersionAlloc,
			climateAlloc,
		] = await Promise.all([
			readVal(host, GRID_SUPPLY_STATE_IDS.slotsJson),
			readVal(host, GRID_SUPPLY_STATE_IDS.currentPriceCtPerKwh),
			readVal(host, "live.price.now_ct_per_kwh"),
			readVal(host, BAT.gridBalance.priceMinCtKwh),
			readVal(host, BAT.gridBalance.priceAllowed),
			readVal(host, ALLOCATION_ADDON_STATE_IDS.battery.planJson),
			readVal(host, ALLOCATION_ADDON_STATE_IDS.wallbox.planJson),
			readVal(host, ALLOCATION_ADDON_STATE_IDS.immersion_heater.planJson),
			readVal(host, ALLOCATION_ADDON_STATE_IDS.air_conditioning.planJson),
		]);

		const currentPriceCt = asNum(liveNow) ?? asNum(gridNow);
		const gbMinPriceCt = asNum(gbMin);
		const gbPriceAllowed = gbAllowed === true ? true : gbAllowed === false ? false : null;

		board = buildVisPriceTimeline({
			now,
			currentPriceCt,
			gbMinPriceCt,
			gbPriceAllowed,
			gridSlots: asGridSlots(gridSlotsRaw),
			batteryAlloc: asAlloc(batteryAlloc),
			wallboxAlloc: asAlloc(wallboxAlloc),
			immersionAlloc: asAlloc(immersionAlloc),
			climateAlloc: asAlloc(climateAlloc),
		});
	} catch {
		board = emptyVisPriceTimeline(now);
	}

	await setStateIfChanged(host, VIS_PRICE_TIMELINE_STATE_ID, JSON.stringify(board));
}
