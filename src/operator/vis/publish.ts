/**
 * Publish compact VIS price-board JSON from already-written operator states.
 * Display only — never changes Thermal/Battery/EV/Climate/Planner decisions.
 */

import { ALLOCATION_ADDON_STATE_IDS, DAILY_PLAN_STATE_IDS } from "../daily_plan/states";
import { readPowerHourlyPersist } from "../../learning/power_rollup/persist";
import { hourKeyToStartTs } from "../../learning/power_rollup/hour";
import {
	PV_HOURLY_HISTORY_CATEGORY,
	brightskyHourlyKwh,
	floorHour,
	mergePvHistory,
	readPvHourlyHistory,
	writePvHourlyHistory,
	type BrightskyHourPoint,
} from "./pv_hourly_history";
import { pvShapeConfigFromAdapter } from "../contributions/pv_shape_config";
import { altSourceConfigFromAdapter } from "../../learning/pv_bias/alt_source";
import {
	buildVisPvHourly,
	emptyVisPvHourly,
	VIS_PV_HOURLY_STATE_ID,
	type MeasuredHour,
	type PvPlanSlot,
	type VisPvOutlookDay,
} from "./pv_hourly";
import { GRID_SUPPLY_STATE_IDS } from "../supply/grid_states";
import { getForecastOnlyPriceStarts } from "../supply/grid_read";
import { PRICE_HISTORY_CATEGORY, mergePriceHistory, readPriceHistory, writePriceHistory } from "./price_history";
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

/** Echte Preise fortschreiben und vergangene Viertelstunden (die der Preisdienst nicht mehr liefert) ergänzen. */
async function withPriceHistory(
	host: StateHost,
	gridSlots: VisPriceGridSlot[],
	forecastOnly: ReadonlySet<number>,
	nowMs: number,
): Promise<VisPriceGridSlot[]> {
	try {
		const dir = (host as unknown as { getAbsolutePath?: (c?: string) => string }).getAbsolutePath?.(PRICE_HISTORY_CATEGORY);
		if (!dir) return gridSlots;
		const known = new Set<number>();
		const actual: Array<[number, number]> = [];
		for (const s of gridSlots) {
			const ms = typeof s.startIso === "string" ? Date.parse(s.startIso) : NaN;
			if (!Number.isFinite(ms)) continue;
			known.add(ms);
			const ct = typeof s.priceCtPerKwh === "number" ? s.priceCtPerKwh : null;
			if (ct !== null && !forecastOnly.has(ms)) actual.push([ms, ct]);
		}
		const prev = await readPriceHistory(dir);
		const { history, changed } = mergePriceHistory(prev, nowMs, actual);
		if (changed) await writePriceHistory(dir, history);
		const out = [...gridSlots];
		for (const [k, ct] of Object.entries(history.a)) {
			const ms = Number(k);
			if (known.has(ms) || ms >= nowMs) continue;
			out.push({ startIso: new Date(ms).toISOString(), endIso: new Date(ms + 15 * 60_000).toISOString(), priceCtPerKwh: ct });
		}
		return out;
	} catch {
		return gridSlots;
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

		const gridSlots = mergeForecastSlots(asGridSlots(gridSlotsRaw), now);
		const forecastOnly = getForecastOnlyPriceStarts();
		const withHistory = await withPriceHistory(host, gridSlots, forecastOnly, now.getTime());
		board = buildVisPriceTimeline({
			now,
			currentPriceCt,
			gbMinPriceCt,
			gbPriceAllowed,
			gridSlots: withHistory,
			forecastStartsMs: forecastOnly,
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

const BRIGHTSKY_DEFAULT_HOURLY_PREFIX = "brightsky.0.hourly";
const BRIGHTSKY_HOURS_PROBED = 48;

async function readForeign(host: StateHost, id: string): Promise<unknown> {
	try {
		const reader = (host as unknown as { getForeignStateAsync?: (i: string) => Promise<{ val?: unknown } | null | undefined> }).getForeignStateAsync;
		return (await reader?.call(host, id))?.val ?? null;
	} catch {
		return null;
	}
}

/** Brightsky-Stunden (Einstrahlung) und Tagesschätzungen lesen; fehlt etwas, bleibt die Kurve leer. */
async function readBrightskyCurve(host: StateHost, timezone: string): Promise<Map<number, number>> {
	const config = (host as unknown as { config?: unknown }).config;
	const prefix = pvShapeConfigFromAdapter(config).brightskyHourlyPrefix.trim() || BRIGHTSKY_DEFAULT_HOURLY_PREFIX;
	const alt = altSourceConfigFromAdapter(config);
	const idx = Array.from({ length: BRIGHTSKY_HOURS_PROBED }, (_, i) => String(i).padStart(2, "0"));
	const rows = await Promise.all(
		idx.map(async (n): Promise<BrightskyHourPoint | null> => {
			const [ts, solar] = await Promise.all([readForeign(host, `${prefix}.${n}.timestamp`), readForeign(host, `${prefix}.${n}.solar`)]);
			const ms = Date.parse(String(ts ?? ""));
			const sv = asNum(solar);
			return Number.isFinite(ms) && sv !== null ? { startMs: ms, solar: sv } : null;
		}),
	);
	const points = rows.filter((r): r is BrightskyHourPoint => r !== null);
	if (!points.length) return new Map();
	const fmtKey = (ms: number): string =>
		new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
	const estimates = new Map<string, number>();
	const dayIds = [alt.todayStateId, alt.tomorrowStateId, alt.tomorrowStateId.replace(/daily\.01\./, "daily.02.")];
	const nowMs = Date.now();
	for (let d = 0; d < dayIds.length; d++) {
		if (d === 2 && dayIds[2] === dayIds[1]) break;
		const v = asNum(await readForeign(host, dayIds[d]!));
		if (v !== null && v > 0) estimates.set(fmtKey(nowMs + d * 24 * 3_600_000), v);
	}
	return brightskyHourlyKwh(points, estimates, timezone);
}

const BRIGHTSKY_OUTLOOK_DAYS = 14;

/** Brightsky-Tagesschätzungen (kWh) ab heute; endet beim ersten fehlenden Tag. */
async function readBrightskyOutlook(host: StateHost, timezone: string, nowMs: number): Promise<VisPvOutlookDay[]> {
	const alt = altSourceConfigFromAdapter((host as unknown as { config?: unknown }).config);
	if (!/daily\.00\./.test(alt.todayStateId)) return [];
	const fmtKey = (ms: number): string =>
		new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
	const ids = Array.from({ length: BRIGHTSKY_OUTLOOK_DAYS }, (_, d) => alt.todayStateId.replace(/daily\.00\./, `daily.${String(d).padStart(2, "0")}.`));
	const vals = await Promise.all(ids.map((id) => readForeign(host, id)));
	const out: VisPvOutlookDay[] = [];
	for (let d = 0; d < vals.length; d++) {
		const v = asNum(vals[d]);
		if (v === null || v < 0) break;
		out.push({ dateKey: fmtKey(nowMs + d * 24 * 3_600_000), b: Math.round(v * 100) / 100 });
	}
	return out;
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
					const cutoff = nowMs - 75 * 3_600_000;
					for (const [key, rec] of Object.entries(source.hours)) {
						const start = hourKeyToStartTs(key);
						if (start >= cutoff && typeof rec.avgPowerW === "number") measured.push({ hourStartMs: start, avgW: rec.avgPowerW });
					}
				}
			}
		} catch {
			/* gemessene Stunden sind optional */
		}
		/* Verlauf (EMS-Prognose + Brightsky) fortschreiben, damit der Rückblick erhalten bleibt */
		let history = { version: 1 as const, f: {} as Record<string, number>, b: {} as Record<string, number> };
		try {
			const hdir = (host as unknown as { getAbsolutePath?: (c?: string) => string }).getAbsolutePath?.(PV_HOURLY_HISTORY_CATEGORY);
			const planByHour = new Map<number, number>();
			for (const sl of slots) {
				const a = Date.parse(sl.slot?.startIso ?? "");
				const e = Date.parse(sl.slot?.endIso ?? "");
				const w = sl.pvForecastPowerW;
				if (!Number.isFinite(a) || !Number.isFinite(e) || e <= a || typeof w !== "number" || !(w >= 0)) continue;
				const h = floorHour(a);
				planByHour.set(h, (planByHour.get(h) ?? 0) + (w * (e - a)) / 3_600_000 / 1000);
			}
			const bs = await readBrightskyCurve(host, timezone);
			if (hdir) {
				const prev = await readPvHourlyHistory(hdir);
				history = mergePvHistory(prev, nowMs, planByHour, bs);
				await writePvHourlyHistory(hdir, history);
			} else {
				history = mergePvHistory({ version: 1, f: {}, b: {} }, nowMs, planByHour, bs);
			}
		} catch {
			/* Verlauf ist optional */
		}
		let outlook: VisPvOutlookDay[] = [];
		try {
			outlook = await readBrightskyOutlook(host, timezone, nowMs);
		} catch {
			/* Wochenausblick ist optional */
		}
		board = buildVisPvHourly({ now, timezone, slots, measured, forecastByHour: history.f, brightskyByHour: history.b, outlook });
	} catch {
		board = emptyVisPvHourly(now, timezone);
	}
	await setStateIfChanged(host, VIS_PV_HOURLY_STATE_ID, JSON.stringify(board));
}
