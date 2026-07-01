import { parseFreezeTimeHHMM } from "./config";
import type { PvBiasConfig } from "./types";
import {
	dailyRecord,
	readDailyPersist,
	upsertDailyRecord,
	writeDailyPersist,
	type PvBiasDailyPersist,
} from "./daily_persist";
import {
	dayBoundsMs,
	fetchDayLastValue,
	fetchDayValueNearTime,
	type HistoryHost,
	readStateNum,
} from "./history";
import { freezeInstantMs, localDateKey } from "./dates";
import type { HistoryQueryHost } from "../history_query";

export type SnapshotHost = HistoryHost &
	HistoryQueryHost & {
		getAbsolutePath?: (category?: string) => string;
		setStateAsync?: (id: string, state: ioBroker.SettableState) => Promise<unknown>;
		log: { info: (msg: string) => void; warn: (msg: string) => void; error?: (msg: string) => void };
	};

function persistDir(host: SnapshotHost): string | null {
	if (typeof host.getAbsolutePath !== "function") {
		return null;
	}
	return host.getAbsolutePath("learning/pv_bias");
}

export function actualSnapshotCapturedForDate(persist: PvBiasDailyPersist, dateKey: string): boolean {
	const row = dailyRecord(persist, dateKey);
	return row?.actualKwh != null && row.actualCapturedAt != null;
}

/** Nach Snapshot-Zeit am selben Kalendertag, noch nicht gespeichert. */
export function shouldCaptureActualSnapshot(
	now: Date,
	snapshotTime: string,
	alreadyCapturedToday: boolean,
): boolean {
	if (alreadyCapturedToday) {
		return false;
	}
	const parsed = parseFreezeTimeHHMM(snapshotTime);
	if (!parsed) {
		return false;
	}
	const snapshotMs = new Date(now);
	snapshotMs.setHours(parsed.hours, parsed.minutes, 0, 0);
	return now.getTime() >= snapshotMs.getTime();
}

export async function recordForecastDailySnapshot(
	host: SnapshotHost,
	cfg: PvBiasConfig,
	forecastKwh: number,
	source: string,
	now = new Date(),
): Promise<void> {
	const dir = persistDir(host);
	if (!dir || !cfg.freezeEnabled) {
		return;
	}
	const dateKey = localDateKey(now);
	const persist = await readDailyPersist(dir);
	const updated = upsertDailyRecord(persist, {
		date: dateKey,
		actualKwh: dailyRecord(persist, dateKey)?.actualKwh ?? null,
		actualCapturedAt: dailyRecord(persist, dateKey)?.actualCapturedAt ?? null,
		forecastKwh,
		forecastCapturedAt: now.toISOString(),
		forecastSource: source,
		actualSource: dailyRecord(persist, dateKey)?.actualSource,
	});
	await writeDailyPersist(dir, updated);
}

export async function runActualDailySnapshot(
	host: SnapshotHost,
	cfg: PvBiasConfig,
	now = new Date(),
): Promise<boolean> {
	if (!cfg.actualSnapshotEnabled || !cfg.historyActualStateId) {
		return false;
	}
	const dir = persistDir(host);
	if (!dir) {
		return false;
	}

	const persist = await readDailyPersist(dir);
	const todayKey = localDateKey(now);
	if (!shouldCaptureActualSnapshot(now, cfg.actualSnapshotTime, actualSnapshotCapturedForDate(persist, todayKey))) {
		return false;
	}

	const actualKwh = await readStateNum(host, cfg.historyActualStateId);
	if (actualKwh === null || actualKwh <= 0) {
		host.log.warn(`PV-Bias Snapshot ${cfg.actualSnapshotTime}: DAY_ENERGY fehlt oder ≤ 0 — kein Ist-Snapshot.`);
		return false;
	}

	const updated = upsertDailyRecord(persist, {
		date: todayKey,
		actualKwh,
		actualCapturedAt: now.toISOString(),
		actualSource: cfg.historyActualStateId,
		forecastKwh: dailyRecord(persist, todayKey)?.forecastKwh ?? null,
		forecastCapturedAt: dailyRecord(persist, todayKey)?.forecastCapturedAt ?? null,
		forecastSource: dailyRecord(persist, todayKey)?.forecastSource,
	});
	await writeDailyPersist(dir, updated);
	host.log.info(`PV-Bias Snapshot: Ist ${actualKwh} kWh für ${todayKey} um ${now.toISOString()} gespeichert.`);
	return true;
}

/** Fehlende Tage aus History nachziehen (letzter Tageswert, kein MAX). */
export async function backfillDailyPersist(host: SnapshotHost, cfg: PvBiasConfig, maxDays = 30): Promise<number> {
	const dir = persistDir(host);
	if (!dir || !cfg.historyActualStateId) {
		return 0;
	}

	let persist = await readDailyPersist(dir);
	let filled = 0;
	const forecastStateId =
		cfg.historyForecastStateId || cfg.rawTodayStateId || "learning.pv_bias.frozen_today_kwh";

	for (let dayOffset = 1; dayOffset < maxDays; dayOffset++) {
		const { start, end } = dayBoundsMs(dayOffset);
		const dateKey = localDateKey(new Date(start));
		const existing = dailyRecord(persist, dateKey);
		let actualKwh = existing?.actualKwh ?? null;
		let forecastKwh = existing?.forecastKwh ?? null;
		let changed = false;

		if (actualKwh === null) {
			const last = await fetchDayLastValue(host, cfg.historyActualStateId, start, end);
			if (last !== null && last > 0) {
				actualKwh = last;
				changed = true;
			}
		}

		if (forecastKwh === null && forecastStateId) {
			const freezeMs = freezeInstantMs(cfg.freezeTime, new Date(start));
			if (freezeMs !== null) {
				const near = await fetchDayValueNearTime(
					host,
					forecastStateId,
					freezeMs,
					freezeMs + 2 * 3_600_000,
				);
				if (near !== null && near > 0) {
					forecastKwh = near;
					changed = true;
				}
			}
		}

		if (!changed) {
			continue;
		}

		persist = upsertDailyRecord(persist, {
			date: dateKey,
			actualKwh,
			actualCapturedAt: existing?.actualCapturedAt ?? (actualKwh !== null ? `${dateKey}T23:58:00.000Z` : null),
			forecastKwh,
			forecastCapturedAt:
				existing?.forecastCapturedAt ?? (forecastKwh !== null ? `${dateKey}T${cfg.freezeTime}:00.000Z` : null),
			actualSource: existing?.actualSource ?? cfg.historyActualStateId,
			forecastSource: existing?.forecastSource ?? forecastStateId,
		});
		filled++;
	}

	if (filled > 0) {
		await writeDailyPersist(dir, persist);
		host.log.info(`PV-Bias: ${filled} Tages-Snapshot(s) aus History nachgezogen (letzter Tageswert).`);
	}
	return filled;
}

export async function loadDailyPersist(host: SnapshotHost): Promise<PvBiasDailyPersist | null> {
	const dir = persistDir(host);
	if (!dir) {
		return null;
	}
	return readDailyPersist(dir);
}
