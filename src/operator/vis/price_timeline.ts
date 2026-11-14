/**
 * Read-only VIS price board: reshape existing grid-supply prices + Daily-Plan
 * allocations. No second optimiser, no invented prices, no planner math.
 */

import { CONTRIBUTION_IDS } from "../contribution_ids";
import { localDateKeyInTimezone } from "../time";
import { RUNNABLE_ALLOCATION_FLOOR_W } from "../daily_plan/addon_plan_publish";

export const VIS_PRICE_TIMELINE_STATE_ID = "operator.vis.price_timeline_json";

export const VIS_PRICE_LOOKBACK_HOURS = 6;
/** Mindestens so weit voraus zeigt die Preisachse (Tibber + Energyforecast, soweit vorhanden). */
export const VIS_PRICE_MIN_AHEAD_HOURS = 18;
/** Obergrenze der Preisachse (Energyforecast Business: bis 12 Tage). */
export const VIS_PRICE_MAX_AHEAD_HOURS = 14 * 24;
/** Ab dieser Entfernung werden Viertelstunden zu Stundenmittelwerten verdichtet (Größe des Datenpunkts). */
export const VIS_PRICE_QUARTER_AHEAD_HOURS = 48;
export const VIS_PRICE_TIMEZONE = "Europe/Berlin";

export type VisPriceActionKind = "battery_grid" | "ev" | "immersion" | "climate";

export interface VisPriceTimelineSlot {
	startIso: string;
	endIso: string;
	priceCt: number | null;
	/** Current 15-min slot. */
	current: boolean;
	/** All 15-min slots in the local current hour. */
	currentHour: boolean;
	/** true = nur Prognose (Energyforecast), noch kein veröffentlichter Tibber-Preis. */
	forecast?: boolean;
	/** Früher festgehaltene Energyforecast-Prognose für diese Zeit (nur wenn der echte Preis inzwischen feststeht). */
	forecastCt?: number;
	/** Price ≥ GB min — allowance only, not an EMS action. */
	gbPriceOk: boolean;
	actions: VisPriceActionKind[];
}

export interface VisPriceExtreme {
	priceCt: number;
	startIso: string;
}

export interface VisPriceTimeline {
	generatedAt: string;
	source: "grid_supply+allocation";
	nowIso: string;
	timezone: string;
	currentPriceCt: number | null;
	gbMinPriceCt: number | null;
	gbPriceAllowed: boolean | null;
	dayMin: VisPriceExtreme | null;
	dayMax: VisPriceExtreme | null;
	windowStartIso: string;
	windowEndIso: string;
	slots: VisPriceTimelineSlot[];
}

export interface VisPriceGridSlot {
	startIso?: string;
	endIso?: string;
	priceCtPerKwh?: number | null;
}

export interface VisPriceAllocEntry {
	contributionId?: string;
	allocatedPowerW?: number | null;
	gridPowerW?: number | null;
	energySource?: string | null;
	slot?: { startIso?: string; endIso?: string } | null;
}

export interface BuildVisPriceTimelineInput {
	now: Date;
	generatedAt?: string;
	timezone?: string;
	currentPriceCt: number | null;
	gbMinPriceCt: number | null;
	gbPriceAllowed: boolean | null;
	gridSlots: VisPriceGridSlot[];
	/** Startzeiten (ms) von Preisslots, die nur aus der Prognose stammen. */
	forecastStartsMs?: ReadonlySet<number>;
	/** Startzeit (ms) → früher festgehaltene Energyforecast-Prognose (ct/kWh). */
	frozenForecastCt?: ReadonlyMap<number, number>;
	batteryAlloc: VisPriceAllocEntry[];
	wallboxAlloc: VisPriceAllocEntry[];
	immersionAlloc: VisPriceAllocEntry[];
	climateAlloc: VisPriceAllocEntry[];
}

function finitePrice(v: unknown): number | null {
	if (v === null || v === undefined || v === "") return null;
	const n = typeof v === "number" ? v : Number(v);
	return Number.isFinite(n) ? n : null;
}

function parseIsoMs(iso: string | undefined | null): number | null {
	if (!iso || typeof iso !== "string") return null;
	const ms = Date.parse(iso);
	return Number.isFinite(ms) ? ms : null;
}

function hourKeyLocal(ms: number, timezone: string): string {
	const d = new Date(ms);
	const key = localDateKeyInTimezone(d, timezone);
	const hour = new Intl.DateTimeFormat("en-US", {
		timeZone: timezone,
		hour: "2-digit",
		hour12: false,
	}).format(d);
	return `${key}T${hour}`;
}

function isRunnable(entry: VisPriceAllocEntry): boolean {
	const w = finitePrice(entry.allocatedPowerW);
	return w !== null && w >= RUNNABLE_ALLOCATION_FLOOR_W;
}

function isBatteryGridCharge(entry: VisPriceAllocEntry): boolean {
	if (!isRunnable(entry)) return false;
	const cid = String(entry.contributionId ?? "");
	if (cid !== CONTRIBUTION_IDS.BATTERY_CHARGE && !cid.startsWith("battery.charge")) return false;
	if (entry.energySource === "grid") return true;
	const gridW = finitePrice(entry.gridPowerW) ?? 0;
	return gridW >= RUNNABLE_ALLOCATION_FLOOR_W;
}

function classifyAlloc(entry: VisPriceAllocEntry): VisPriceActionKind | null {
	if (!isRunnable(entry)) return null;
	const cid = String(entry.contributionId ?? "");
	if (cid.startsWith("wallbox.") || cid === CONTRIBUTION_IDS.WALLBOX_EV_SESSION) return "ev";
	if (cid.startsWith("immersion_heater.") || cid === CONTRIBUTION_IDS.IMMERSION_MANDATORY || cid === CONTRIBUTION_IDS.IMMERSION_FLEXIBLE) {
		return "immersion";
	}
	if (cid.startsWith("air_conditioning.")) return "climate";
	if (isBatteryGridCharge(entry)) return "battery_grid";
	return null;
}

function actionStarts(entries: VisPriceAllocEntry[], kind: VisPriceActionKind): Set<string> {
	const out = new Set<string>();
	for (const entry of entries) {
		if (classifyAlloc(entry) !== kind) continue;
		const start = entry.slot?.startIso;
		if (start) out.add(start);
	}
	return out;
}

function pickExtreme(slots: Array<{ startIso: string; priceCt: number }>, which: "min" | "max"): VisPriceExtreme | null {
	if (!slots.length) return null;
	let best = slots[0];
	for (const s of slots) {
		if (which === "min" ? s.priceCt < best.priceCt : s.priceCt > best.priceCt) best = s;
	}
	return { priceCt: best.priceCt, startIso: best.startIso };
}

export function emptyVisPriceTimeline(now: Date, timezone = VIS_PRICE_TIMEZONE): VisPriceTimeline {
	const nowIso = now.toISOString();
	return {
		generatedAt: nowIso,
		source: "grid_supply+allocation",
		nowIso,
		timezone,
		currentPriceCt: null,
		gbMinPriceCt: null,
		gbPriceAllowed: null,
		dayMin: null,
		dayMax: null,
		windowStartIso: nowIso,
		windowEndIso: nowIso,
		slots: [],
	};
}

/** Compact VIS payload from already-published prices + allocations. */
export function buildVisPriceTimeline(input: BuildVisPriceTimelineInput): VisPriceTimeline {
	const timezone = input.timezone?.trim() || VIS_PRICE_TIMEZONE;
	const nowMs = input.now.getTime();
	const nowIso = input.now.toISOString();
	const lookbackMs = VIS_PRICE_LOOKBACK_HOURS * 3600_000;
	const maxAheadMs = VIS_PRICE_MAX_AHEAD_HOURS * 3600_000;
	const quarterAheadMs = VIS_PRICE_QUARTER_AHEAD_HOURS * 3600_000;
	const forecastStarts = input.forecastStartsMs ?? new Set<number>();
	const frozen = input.frozenForecastCt ?? new Map<number, number>();

	const priced: Array<{ startIso: string; endIso: string; startMs: number; endMs: number; priceCt: number | null }> = [];
	for (const raw of input.gridSlots) {
		const startIso = typeof raw.startIso === "string" ? raw.startIso : "";
		const startMs = parseIsoMs(startIso);
		if (startMs === null) continue;
		const endIso =
			typeof raw.endIso === "string" && parseIsoMs(raw.endIso) !== null
				? raw.endIso
				: new Date(startMs + 15 * 60_000).toISOString();
		const endMs = parseIsoMs(endIso) ?? startMs + 15 * 60_000;
		priced.push({
			startIso,
			endIso,
			startMs,
			endMs,
			priceCt: finitePrice(raw.priceCtPerKwh),
		});
	}
	priced.sort((a, b) => a.startMs - b.startMs);

	const windowStartMs = nowMs - lookbackMs;
	const lastPricedEndMs = priced.length ? priced[priced.length - 1].endMs : nowMs;
	const windowEndMs = Math.min(
		Math.max(lastPricedEndMs, nowMs + VIS_PRICE_MIN_AHEAD_HOURS * 3600_000),
		nowMs + maxAheadMs,
	);

	const todayKey = localDateKeyInTimezone(input.now, timezone);
	const nowHourKey = hourKeyLocal(nowMs, timezone);
	const gbMin = finitePrice(input.gbMinPriceCt);

	const batStarts = actionStarts(input.batteryAlloc, "battery_grid");
	const evStarts = actionStarts(input.wallboxAlloc, "ev");
	const ihStarts = actionStarts(input.immersionAlloc, "immersion");
	const acStarts = actionStarts(input.climateAlloc, "climate");

	const dayPriced: Array<{ startIso: string; priceCt: number }> = [];
	const slots: VisPriceTimelineSlot[] = [];

	for (const s of priced) {
		if (s.priceCt !== null && localDateKeyInTimezone(new Date(s.startMs), timezone) === todayKey) {
			dayPriced.push({ startIso: s.startIso, priceCt: s.priceCt });
		}
		if (s.endMs <= windowStartMs || s.startMs >= windowEndMs) continue;
		const actions: VisPriceActionKind[] = [];
		if (batStarts.has(s.startIso)) actions.push("battery_grid");
		if (evStarts.has(s.startIso)) actions.push("ev");
		if (ihStarts.has(s.startIso)) actions.push("immersion");
		if (acStarts.has(s.startIso)) actions.push("climate");
		const gbPriceOk = gbMin !== null && s.priceCt !== null && s.priceCt >= gbMin;
		slots.push({
			startIso: s.startIso,
			endIso: s.endIso,
			priceCt: s.priceCt,
			current: nowMs >= s.startMs && nowMs < s.endMs,
			currentHour: hourKeyLocal(s.startMs, timezone) === nowHourKey,
			gbPriceOk,
			actions,
			...(forecastStarts.has(s.startMs) ? { forecast: true } : {}),
			...(!forecastStarts.has(s.startMs) && s.priceCt !== null && frozen.has(s.startMs)
				? { forecastCt: Math.round((frozen.get(s.startMs) as number) * 100) / 100 }
				: {}),
		});
	}

	// Weit in der Zukunft: Stundenmittel statt Viertelstunden, damit der Datenpunkt klein bleibt.
	const compact: VisPriceTimelineSlot[] = [];
	const farFrom = nowMs + quarterAheadMs;
	let bucket: VisPriceTimelineSlot[] = [];
	const flush = (): void => {
		if (!bucket.length) return;
		const priceSlots = bucket.filter((b) => b.priceCt !== null);
		const avg = priceSlots.length ? priceSlots.reduce((sum, b) => sum + (b.priceCt as number), 0) / priceSlots.length : null;
		compact.push({
			startIso: bucket[0].startIso,
			endIso: bucket[bucket.length - 1].endIso,
			priceCt: avg === null ? null : Math.round(avg * 100) / 100,
			current: false,
			currentHour: false,
			gbPriceOk: gbMin !== null && avg !== null && avg >= gbMin,
			actions: [],
			...(bucket.every((b) => b.forecast) ? { forecast: true } : {}),
		});
		bucket = [];
	};
	for (const slot of slots) {
		if (Date.parse(slot.startIso) < farFrom) {
			flush();
			compact.push(slot);
			continue;
		}
		if (bucket.length && hourKeyLocal(Date.parse(bucket[0].startIso), timezone) !== hourKeyLocal(Date.parse(slot.startIso), timezone)) flush();
		bucket.push(slot);
	}
	flush();

	return {
		generatedAt: input.generatedAt ?? nowIso,
		source: "grid_supply+allocation",
		nowIso,
		timezone,
		currentPriceCt: finitePrice(input.currentPriceCt),
		gbMinPriceCt: gbMin,
		gbPriceAllowed: input.gbPriceAllowed,
		dayMin: pickExtreme(dayPriced, "min"),
		dayMax: pickExtreme(dayPriced, "max"),
		windowStartIso: new Date(windowStartMs).toISOString(),
		windowEndIso: new Date(windowEndMs).toISOString(),
		slots: compact,
	};
}
