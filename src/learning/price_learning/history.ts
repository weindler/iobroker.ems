import { asNum } from "../../ems_light/state_util";
import {
	fetchHistoryRowsLookback,
	HISTORY_CHUNK_TIMEOUT_MS,
	HISTORY_ROWS_PER_DAY,
} from "../history_query";
import {
	PLAUSIBLE_CT_MAX,
	PLAUSIBLE_CT_MIN,
	PLAUSIBLE_EUR_MAX,
	PLAUSIBLE_EUR_MIN,
	MS_PER_DAY,
} from "./constants";
import type { PriceDaySummary, PriceUnit } from "./types";

export type PriceHistoryHost = {
	getHistoryAsync: (
		id: string,
		options?: ioBroker.GetHistoryOptions,
	) => Promise<{ result?: ioBroker.GetHistoryResult; step?: number; sessionId?: number }>;
	getObjectAsync?: (id: string) => Promise<ioBroker.Object | null | undefined>;
};

export type PriceSample = {
	ts: number;
	priceEur: number;
	hourBucket: number;
	dateKey: string;
	hourOfDay: number;
};

function isForeignStateId(stateId: string): boolean {
	return /^[a-z0-9_-]+\.\d+\./i.test(stateId);
}

function hourBucketMs(ts: number): number {
	return Math.floor(ts / 3_600_000) * 3_600_000;
}

export function dateKeyFromTs(ts: number): string {
	const d = new Date(ts);
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, "0");
	const day = String(d.getDate()).padStart(2, "0");
	return `${y}-${m}-${day}`;
}

export function dateKeyFromOffset(dayOffset: number): string {
	const d = new Date();
	d.setHours(0, 0, 0, 0);
	d.setDate(d.getDate() - dayOffset);
	return dateKeyFromTs(d.getTime());
}

export function dayBoundsMs(dayOffset: number): { start: number; end: number } {
	const d = new Date();
	d.setHours(0, 0, 0, 0);
	d.setDate(d.getDate() - dayOffset);
	const start = d.getTime();
	return { start, end: start + MS_PER_DAY };
}

export function detectPriceUnit(stateId: string, unit?: string): PriceUnit {
	const u = (unit ?? "").toLowerCase();
	if (u.includes("ct") || stateId.includes("ct_per_kwh")) {
		return "ct_per_kwh";
	}
	if (u.includes("eur") || u.includes("€") || u.includes("euro")) {
		return "eur_per_kwh";
	}
	return stateId.includes("ct_per_kwh") ? "ct_per_kwh" : "eur_per_kwh";
}

/** missing ≠ 0 — nur explizit gelieferte, endliche, plausible Werte sind gültig. */
export function isValidPriceValue(value: number | null, unit: PriceUnit): value is number {
	if (value === null || !Number.isFinite(value)) {
		return false;
	}
	if (unit === "ct_per_kwh") {
		return value >= PLAUSIBLE_CT_MIN && value <= PLAUSIBLE_CT_MAX;
	}
	return value >= PLAUSIBLE_EUR_MIN && value <= PLAUSIBLE_EUR_MAX;
}

export function toEurPerKwh(value: number, unit: PriceUnit): number {
	return unit === "ct_per_kwh" ? value / 100 : value;
}

export async function resolvePriceUnit(
	host: PriceHistoryHost,
	stateId: string,
): Promise<PriceUnit> {
	if (!host.getObjectAsync) {
		return detectPriceUnit(stateId);
	}
	try {
		const obj = await host.getObjectAsync(stateId);
		const unit = obj?.common && typeof obj.common === "object" ? String((obj.common as { unit?: string }).unit ?? "") : "";
		return detectPriceUnit(stateId, unit);
	} catch {
		return detectPriceUnit(stateId);
	}
}

export async function fetchPriceSamples(
	host: PriceHistoryHost,
	stateId: string,
	lookbackDays: number,
): Promise<{ samples: PriceSample[]; unit: PriceUnit }> {
	const unit = await resolvePriceUnit(host, stateId);
	const samples: PriceSample[] = [];

	const rows = await fetchHistoryRowsLookback(
		host,
		stateId,
		lookbackDays,
		HISTORY_ROWS_PER_DAY,
		HISTORY_CHUNK_TIMEOUT_MS,
	);

	const seen = new Set<number>();
	for (const row of rows) {
		const ts = typeof row?.ts === "number" ? row.ts : null;
		const raw = asNum(row?.val);
		if (ts === null || !isValidPriceValue(raw, unit)) {
			continue;
		}
		const bucket = hourBucketMs(ts);
		if (seen.has(bucket)) {
			continue;
		}
		seen.add(bucket);
		const d = new Date(bucket);
		samples.push({
			ts: bucket,
			priceEur: toEurPerKwh(raw, unit),
			hourBucket: bucket,
			dateKey: dateKeyFromTs(bucket),
			hourOfDay: d.getHours(),
		});
	}

	return { samples, unit };
}

export function summarizeDays(samples: PriceSample[], lookbackDays: number): PriceDaySummary[] {
	const byDay = new Map<string, number[]>();
	for (const s of samples) {
		const list = byDay.get(s.dateKey) ?? [];
		list.push(s.priceEur);
		byDay.set(s.dateKey, list);
	}

	const summaries: PriceDaySummary[] = [];
	for (let dayOffset = 0; dayOffset < lookbackDays; dayOffset++) {
		const dateKey = dateKeyFromOffset(dayOffset);
		const prices = byDay.get(dateKey) ?? [];
		const validHours = prices.length;
		const avgPriceEur =
			validHours > 0 ? prices.reduce((a, b) => a + b, 0) / validHours : null;
		summaries.push({ dateKey, dayOffset, validHours, avgPriceEur });
	}
	return summaries;
}
