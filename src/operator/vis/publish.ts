/**
 * Publish compact VIS price-board JSON from already-written operator states.
 * Display only — never changes Thermal/Battery/EV/Climate/Planner decisions.
 */

import { ALLOCATION_ADDON_STATE_IDS, DAILY_PLAN_STATE_IDS } from "../daily_plan/states";
import { readPowerHourlyPersist } from "../../learning/power_rollup/persist";
import { hourKeyToStartTs } from "../../learning/power_rollup/hour";
import {
	buildVisPvHourly,
	emptyVisPvHourly,
	VIS_PV_HOURLY_STATE_ID,
	type MeasuredHour,
	type PvPlanSlot,
} from "./pv_hourly";
import { GRID_SUPPLY_STATE_IDS } from "../supply/grid_states";
import { getForecastOnlyPriceStarts } from "../supply/grid_read";
import { getEnergyforecastFrozenForecast, getEnergyforecastPrice15MinSlots } from "../../learning/energyforecast/run";
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

/**
 * Preisachse über den Plan-Horizont hinaus: Energyforecast-Slots (Prognose) ergänzen alle Zeiten ohne
 * Slot aus dem Grid-Supply-State. Tibber/Grid-Supply hat Vorrang.
 */
function mergeForecastSlots(slots: VisPriceGridSlot[], now: Date): VisPriceGridSlot[] {
	const known = new Set<number>();
	for (const s of slots) {
		const ms = typeof s.startIso === "string" ? Date.parse(s.startIso) : NaN;
		if (Number.isFinite(ms)) known.add(ms);
	}
	const out = [...slots];
	for (const f of getEnergyforecastPrice15MinSlots(now.getTime())) {
		if (known.has(f.slotStartMs)) continue;
		out.push({
			startIso: new Date(f.slotStartMs).toISOString(),
			endIso: new Date(f.slotStartMs + 15 * 60_000).toISOString(),
			priceCtPerKwh: f.priceCtPerKwh,
		});
	}
	return out;
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
			gridSlots: mergeForecastSlots(asGridSlots(gridSlotsRaw), now),
			forecastStartsMs: getForecastOnlyPriceStarts(),
			frozenForecastCt: getEnergyforecastFrozenForecast(),
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

let pvHourlyLastMs = 0;
const PV_HOURLY_MIN_INTERVAL_MS = 5 * 60_000;

/** PV-Stundenwerte für die Betriebsseite. Höchstens alle 5 Minuten (der Tagesplan ist groß). */
export async function publishVisPvHourly(host: StateHost, now = new Date(), timezone = "Europe/Berlin"): Promise<void> {
	const nowMs = now.getTime();
	if (nowMs - pvHourlyLastMs < PV_HOURLY_MIN_INTERVAL_MS) return;
	pvHourlyLastMs = nowMs;
	let board = emptyVisPvHourly(now, timezone);
	try {
		const rawPlan = await readVal(host, DAILY_PLAN_STATE_IDS.planJson);
		let slots: PvPlanSlot[] = [];
		if (typeof rawPlan === "string" && rawPlan.trim()) {
			const parsed = JSON.parse(rawPlan) as { slots?: unknown };
			if (Array.isArray(parsed.slots)) slots = parsed.slots as PvPlanSlot[];
		}
		const measured: MeasuredHour[] = [];
		try {
			const dir = (host as unknown as { getAbsolutePath?: (c?: string) => string }).getAbsolutePath?.("learning/power_rollup");
			if (dir) {
				const persist = await readPowerHourlyPersist(dir);
				const source = persist.sources["battery.pv_ac_power_w"];
				if (source) {
					const cutoff = nowMs - 36 * 3_600_000;
					for (const [key, rec] of Object.entries(source.hours)) {
						const start = hourKeyToStartTs(key);
						if (start >= cutoff && typeof rec.avgPowerW === "number") measured.push({ hourStartMs: start, avgW: rec.avgPowerW });
					}
				}
			}
		} catch {
			/* gemessene Stunden sind optional */
		}
		board = buildVisPvHourly({ now, timezone, slots, measured });
	} catch {
		board = emptyVisPvHourly(now, timezone);
	}
	await setStateIfChanged(host, VIS_PV_HOURLY_STATE_ID, JSON.stringify(board));
}
