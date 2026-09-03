import { localDateKey } from "../energy_daily_rollup/day";
import type { ConsumerDayRecord, ConsumerPersistEntry, ConsumerStatsConfig, ConsumerStatsTickInput } from "./types";
import { MAX_TICK_DELTA_SEC } from "./types";

export function emptyConsumerEntry(consumerKey: string, nowMs: number): ConsumerPersistEntry {
	const dateKey = localDateKey(new Date(nowMs));
	return {
		consumerKey,
		totalRuntimeSec: 0,
		totalEnergyKwh: 0,
		todayDateKey: dateKey,
		todayRuntimeSec: 0,
		todayEnergyKwh: 0,
		sessionRuntimeSec: 0,
		sessionEnergyKwh: 0,
		lastSessionRuntimeSec: 0,
		lastSessionEnergyKwh: 0,
		lastTickMs: nowMs,
		wasActive: false,
		days: {},
		todayZeroRuntimeEvaluable: false,
		todayModesAvailable: null,
		todayRoomDataOk: false,
	};
}

function mergeModesAvailable(
	a: string[] | null | undefined,
	b: string[] | null | undefined,
): string[] | null {
	if (!a?.length && !b?.length) return a ?? b ?? null;
	return [...new Set([...(a ?? []), ...(b ?? [])])].sort();
}

function persistableDayRecord(entry: ConsumerPersistEntry): ConsumerDayRecord | null {
	if (entry.todayRuntimeSec > 0 || entry.todayEnergyKwh > 0) {
		return {
			dateKey: entry.todayDateKey,
			runtimeSec: entry.todayRuntimeSec,
			energyKwh: entry.todayEnergyKwh,
			lastTickMs: entry.lastTickMs,
			zeroRuntimeEvaluable: false,
			modesAvailable: entry.todayModesAvailable ?? null,
			roomDataOk: entry.todayRoomDataOk === true,
		};
	}
	if (entry.todayZeroRuntimeEvaluable === true && entry.todayRoomDataOk === true) {
		return {
			dateKey: entry.todayDateKey,
			runtimeSec: 0,
			energyKwh: 0,
			lastTickMs: entry.lastTickMs,
			zeroRuntimeEvaluable: true,
			modesAvailable: entry.todayModesAvailable ?? null,
			roomDataOk: true,
		};
	}
	return null;
}

export function computeTickDeltaSec(nowMs: number, lastTickMs: number, maxDeltaSec = MAX_TICK_DELTA_SEC): number {
	if (lastTickMs <= 0) {
		return 0;
	}
	const raw = (nowMs - lastTickMs) / 1000;
	if (raw <= 0) {
		return 0;
	}
	return Math.min(raw, maxDeltaSec);
}

export function resolveActivePowerW(input: {
	measuredPowerW: number | null;
	commandedPowerW: number;
	powerOnThresholdW: number;
}): number {
	if (input.measuredPowerW !== null && input.measuredPowerW >= input.powerOnThresholdW) {
		return input.measuredPowerW;
	}
	return input.commandedPowerW > 0 ? input.commandedPowerW : 0;
}

function rolloverDay(entry: ConsumerPersistEntry, dateKey: string): ConsumerPersistEntry {
	if (entry.todayDateKey === dateKey) {
		return entry;
	}
	const nextDays = { ...entry.days };
	const rec = persistableDayRecord(entry);
	if (rec) {
		nextDays[rec.dateKey] = rec;
	}
	return {
		...entry,
		todayDateKey: dateKey,
		todayRuntimeSec: 0,
		todayEnergyKwh: 0,
		todayZeroRuntimeEvaluable: false,
		todayModesAvailable: null,
		todayRoomDataOk: false,
		days: nextDays,
	};
}

function startSession(entry: ConsumerPersistEntry): ConsumerPersistEntry {
	return {
		...entry,
		sessionRuntimeSec: 0,
		sessionEnergyKwh: 0,
	};
}

function finalizeSession(entry: ConsumerPersistEntry): ConsumerPersistEntry {
	if (!entry.wasActive) {
		return entry;
	}
	return {
		...entry,
		lastSessionRuntimeSec: entry.sessionRuntimeSec,
		lastSessionEnergyKwh: entry.sessionEnergyKwh,
		sessionRuntimeSec: 0,
		sessionEnergyKwh: 0,
	};
}

export function ingestConsumerStatsTick(
	entry: ConsumerPersistEntry,
	input: ConsumerStatsTickInput,
	config: ConsumerStatsConfig,
): ConsumerPersistEntry {
	const dateKey = localDateKey(new Date(input.nowMs));
	let next = rolloverDay(entry, dateKey);

	if (!config.enabled) {
		return {
			...next,
			lastTickMs: input.nowMs,
			wasActive: input.countable,
		};
	}

	const deltaSec = computeTickDeltaSec(input.nowMs, next.lastTickMs);
	const powerW = resolveActivePowerW({
		measuredPowerW: input.measuredPowerW,
		commandedPowerW: input.commandedPowerW,
		powerOnThresholdW: input.powerOnThresholdW ?? 50,
	});

	if (next.wasActive && deltaSec > 0) {
		if (config.trackRuntime) {
			next = {
				...next,
				totalRuntimeSec: next.totalRuntimeSec + deltaSec,
				todayRuntimeSec: next.todayRuntimeSec + deltaSec,
				sessionRuntimeSec: next.sessionRuntimeSec + deltaSec,
			};
		}
		if (config.trackEnergy && powerW > 0) {
			const deltaKwh = (powerW * deltaSec) / 3_600_000;
			next = {
				...next,
				totalEnergyKwh: roundKwh(next.totalEnergyKwh + deltaKwh),
				todayEnergyKwh: roundKwh(next.todayEnergyKwh + deltaKwh),
				sessionEnergyKwh: roundKwh(next.sessionEnergyKwh + deltaKwh),
			};
		}
	}

	if (!input.countable && next.wasActive) {
		next = finalizeSession(next);
	}

	if (input.countable && !next.wasActive) {
		next = startSession(next);
	}

	return {
		...next,
		lastTickMs: input.nowMs,
		wasActive: input.countable,
		todayZeroRuntimeEvaluable: next.todayZeroRuntimeEvaluable === true || input.zeroRuntimeEvaluable === true,
		todayModesAvailable: mergeModesAvailable(next.todayModesAvailable, input.modesAvailable),
		todayRoomDataOk: next.todayRoomDataOk === true || input.roomDataOk === true,
	};
}

export function snapshotFromEntry(
	entry: ConsumerPersistEntry,
	config: ConsumerStatsConfig,
	nowMs: number,
	deviceActive = false,
): import("./types").ConsumerStatsSnapshot {
	return {
		consumerKey: entry.consumerKey,
		tracking: config.enabled,
		deviceActive,
		todayRuntimeSec: entry.todayRuntimeSec,
		todayEnergyKwh: entry.todayEnergyKwh,
		totalRuntimeSec: entry.totalRuntimeSec + config.runtimeOffsetSec,
		totalEnergyKwh: roundKwh(entry.totalEnergyKwh + config.energyOffsetKwh),
		sessionRuntimeSec: entry.sessionRuntimeSec,
		sessionEnergyKwh: entry.sessionEnergyKwh,
		lastSessionRuntimeSec: entry.lastSessionRuntimeSec,
		lastSessionEnergyKwh: entry.lastSessionEnergyKwh,
		lastUpdated: new Date(nowMs).toISOString(),
	};
}

export function dayRecordFromEntry(entry: ConsumerPersistEntry): ConsumerDayRecord | null {
	return persistableDayRecord(entry);
}

function roundKwh(value: number): number {
	return Math.round(value * 1000) / 1000;
}
