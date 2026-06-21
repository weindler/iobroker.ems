import {
	CONFIDENCE_TARGET_SAMPLES,
	MIN_DAY_HOURS,
	MIN_PROFILE_SAMPLES,
	SEGMENTS,
	SEASONS,
	WEEKDAYS,
	type HouseLoadDayType,
	type HouseLoadSeason,
	type HouseLoadSegment,
	type HouseLoadWeekday,
} from "./constants";
import { filterOutliers } from "./history";
import { calendarContext, contextForDayOffset, dayTypeFromWeekday } from "./time";
import type {
	DayForecastJson,
	HouseLoadComputeResult,
	HouseLoadHealthJson,
	HouseLoadProfileJson,
	HouseLoadSample,
	LookupResult,
	ProfileAccumulator,
	ProfileCell,
	SegmentForecastEntry,
} from "./types";

function roundW(n: number): number {
	return Math.round(n);
}

export function cellConfidence(samples: number): number {
	if (samples <= 0) return 0;
	return Math.round(Math.min(1, samples / CONFIDENCE_TARGET_SAMPLES) * 1000) / 1000;
}

export function confidencePctFromSamples(samples: number, sampleDays: number): number {
	const hourScore = Math.min(40, (samples / (CONFIDENCE_TARGET_SAMPLES * 24)) * 40);
	const dayScore = Math.min(60, (sampleDays / 30) * 60);
	return Math.round(Math.min(100, hourScore + dayScore));
}

type AccRoot = Record<
	HouseLoadSeason,
	Partial<Record<HouseLoadWeekday, Partial<Record<HouseLoadSegment, ProfileAccumulator>>>>
>;

function emptyProfile(): AccRoot {
	const root = {} as AccRoot;
	for (const season of SEASONS) {
		root[season] = {};
	}
	return root;
}

export function buildProfileAccumulators(samples: HouseLoadSample[]): AccRoot {
	const acc = emptyProfile();
	for (const s of samples) {
		const seasonMap = acc[s.season] ?? {};
		acc[s.season] = seasonMap;
		const dayMap = seasonMap[s.weekday] ?? {};
		seasonMap[s.weekday] = dayMap;
		const cell = dayMap[s.segment] ?? { sumW: 0, count: 0, values: [] };
		cell.values.push(s.powerW);
		cell.sumW += s.powerW;
		cell.count += 1;
		dayMap[s.segment] = cell;
	}
	return acc;
}

function finalizeCell(acc: ProfileAccumulator | undefined): ProfileCell | null {
	if (!acc || acc.count < MIN_PROFILE_SAMPLES) {
		return null;
	}
	const filtered = filterOutliers(acc.values);
	if (filtered.length < MIN_PROFILE_SAMPLES) {
		return null;
	}
	const avgW = roundW(filtered.reduce((a, b) => a + b, 0) / filtered.length);
	return {
		avgW,
		samples: filtered.length,
		confidence: cellConfidence(filtered.length),
	};
}

export function accumulatorsToProfileJson(acc: AccRoot): HouseLoadProfileJson {
	const profile: HouseLoadProfileJson = {};
	for (const season of SEASONS) {
		const seasonOut: NonNullable<HouseLoadProfileJson[HouseLoadSeason]> = {};
		let seasonHasData = false;
		for (const weekday of WEEKDAYS) {
			const dayOut: Partial<Record<HouseLoadSegment, ProfileCell>> = {};
			let dayHasData = false;
			for (const segment of SEGMENTS) {
				const cell = finalizeCell(acc[season]?.[weekday]?.[segment]);
				if (cell) {
					dayOut[segment] = cell;
					dayHasData = true;
				}
			}
			if (dayHasData) {
				seasonOut[weekday] = dayOut;
				seasonHasData = true;
			}
		}
		if (seasonHasData) {
			profile[season] = seasonOut;
		}
	}
	return profile;
}

function avgFromAccumulators(cells: ProfileAccumulator[]): number | null {
	const values: number[] = [];
	for (const c of cells) {
		values.push(...filterOutliers(c.values));
	}
	if (values.length < MIN_PROFILE_SAMPLES) {
		return null;
	}
	return roundW(values.reduce((a, b) => a + b, 0) / values.length);
}

function collectCells(
	acc: AccRoot,
	predicate: (season: HouseLoadSeason, weekday: HouseLoadWeekday) => boolean,
	segment: HouseLoadSegment,
): ProfileAccumulator[] {
	const out: ProfileAccumulator[] = [];
	for (const season of SEASONS) {
		for (const weekday of WEEKDAYS) {
			if (!predicate(season, weekday)) continue;
			const cell = acc[season]?.[weekday]?.[segment];
			if (cell && cell.count > 0) {
				out.push(cell);
			}
		}
	}
	return out;
}

function median(values: number[]): number | null {
	if (values.length === 0) return null;
	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	if (sorted.length % 2 === 0) {
		return roundW((sorted[mid - 1] + sorted[mid]) / 2);
	}
	return roundW(sorted[mid]);
}

export function lookupSegmentProfile(
	acc: AccRoot,
	season: HouseLoadSeason,
	weekday: HouseLoadWeekday,
	dayType: HouseLoadDayType,
	segment: HouseLoadSegment,
): LookupResult {
	const direct = finalizeCell(acc[season]?.[weekday]?.[segment]);
	if (direct) {
		return {
			avgW: direct.avgW,
			confidence: direct.confidence,
			source: `${season}/${weekday}/${segment}`,
			fallbackLevel: "season_weekday_segment",
		};
	}

	const dayTypeCells = collectCells(
		acc,
		(s, w) => s === season && dayTypeFromWeekday(w) === dayType,
		segment,
	);
	const dayTypeAvg = avgFromAccumulators(dayTypeCells);
	if (dayTypeAvg !== null) {
		return {
			avgW: dayTypeAvg,
			confidence: cellConfidence(dayTypeCells.reduce((n, c) => n + c.count, 0)),
			source: `${season}/${dayType}/${segment}`,
			fallbackLevel: "season_day_type_segment",
		};
	}

	const allSeasonCells = collectCells(acc, (_s, w) => w === weekday, segment);
	const allSeasonAvg = avgFromAccumulators(allSeasonCells);
	if (allSeasonAvg !== null) {
		return {
			avgW: allSeasonAvg,
			confidence: cellConfidence(allSeasonCells.reduce((n, c) => n + c.count, 0)),
			source: `all_seasons/${weekday}/${segment}`,
			fallbackLevel: "all_seasons_weekday_segment",
		};
	}

	const globalCells = collectCells(acc, () => true, segment);
	const globalAvg = avgFromAccumulators(globalCells);
	if (globalAvg !== null) {
		return {
			avgW: globalAvg,
			confidence: cellConfidence(globalCells.reduce((n, c) => n + c.count, 0)),
			source: `global/${segment}`,
			fallbackLevel: "global_segment",
		};
	}

	const allValues: number[] = [];
	for (const s of globalCells) {
		allValues.push(...s.values);
	}
	const med = median(filterOutliers(allValues));
	if (med !== null) {
		return {
			avgW: med,
			confidence: cellConfidence(allValues.length),
			source: `median/${segment}`,
			fallbackLevel: "median_all",
		};
	}

	return { avgW: null, confidence: 0, source: "none", fallbackLevel: "none" };
}

export function buildDayForecast(acc: AccRoot, dayOffset: number): DayForecastJson {
	const ctx = contextForDayOffset(dayOffset);
	const segments: Partial<Record<HouseLoadSegment, SegmentForecastEntry>> = {};

	for (const segment of SEGMENTS) {
		const lookup = lookupSegmentProfile(
			acc,
			ctx.season,
			ctx.weekday,
			ctx.dayType,
			segment,
		);
		segments[segment] = {
			avg_w: lookup.avgW,
			source: lookup.source,
			fallback_level: lookup.fallbackLevel,
			confidence: lookup.confidence,
		};
	}

	return {
		date: ctx.dateKey,
		season: ctx.season,
		weekday: ctx.weekday,
		day_type: ctx.dayType,
		segments,
	};
}

export function countForecastFallbacks(forecast: DayForecastJson): number {
	let n = 0;
	for (const segment of SEGMENTS) {
		const entry = forecast.segments[segment];
		if (!entry) continue;
		if (
			entry.fallback_level !== "none" &&
			entry.fallback_level !== "season_weekday_segment"
		) {
			n += 1;
		}
	}
	return n;
}

export function computeHouseLoadLearning(params: {
	samples: HouseLoadSample[];
	sampleDays: number;
	lastValidTs: number | null;
	sourceStateId: string;
	now: Date;
	lastPersistAt: string | null;
}): HouseLoadComputeResult {
	const nowCtx = calendarContext(params.now);
	const acc = buildProfileAccumulators(params.samples);
	const profileJson = accumulatorsToProfileJson(acc);
	const forecastTodayJson = buildDayForecast(acc, 0);
	const forecastTomorrowJson = buildDayForecast(acc, 1);
	const fallbacksUsed =
		countForecastFallbacks(forecastTodayJson) + countForecastFallbacks(forecastTomorrowJson);

	const confidence = confidencePctFromSamples(params.samples.length, params.sampleDays);

	let healthStatus: HouseLoadHealthJson["status"] = "ok";
	if (params.sampleDays < 7 || params.samples.length < MIN_DAY_HOURS * 3) {
		healthStatus = "degraded";
	}

	let status: HouseLoadComputeResult["status"] = "ready";
	if (params.samples.length === 0) {
		status = "insufficient_data";
		healthStatus = "degraded";
	} else if (params.sampleDays < 3) {
		status = "insufficient_data";
	}

	const healthJson: HouseLoadHealthJson = {
		status: healthStatus,
		sample_count: params.samples.length,
		sample_days: params.sampleDays,
		active_season: nowCtx.season,
		active_weekday: nowCtx.weekday,
		active_day_type: nowCtx.dayType,
		fallbacks_used: fallbacksUsed,
		missing_source: false,
		source_state_id: params.sourceStateId,
		last_valid_measurement_ts: params.lastValidTs
			? new Date(params.lastValidTs).toISOString()
			: null,
		last_persist_at: params.lastPersistAt,
	};

	return {
		status,
		healthStatus,
		sampleCount: params.samples.length,
		sampleDays: params.sampleDays,
		confidence,
		currentSegment: nowCtx.segment,
		currentSeason: nowCtx.season,
		currentWeekday: nowCtx.weekday,
		currentDayType: nowCtx.dayType,
		profileJson,
		forecastTodayJson,
		forecastTomorrowJson,
		healthJson,
		sourceStateId: params.sourceStateId,
		error: "",
	};
}

export function noSourceResult(sourceStateId: string, now: Date): HouseLoadComputeResult {
	const nowCtx = calendarContext(now);
	const emptyForecast = buildDayForecast(emptyProfile(), 0);
	return {
		status: "no_source",
		healthStatus: "no_source",
		sampleCount: 0,
		sampleDays: 0,
		confidence: 0,
		currentSegment: nowCtx.segment,
		currentSeason: nowCtx.season,
		currentWeekday: nowCtx.weekday,
		currentDayType: nowCtx.dayType,
		profileJson: {},
		forecastTodayJson: emptyForecast,
		forecastTomorrowJson: buildDayForecast(emptyProfile(), 1),
		healthJson: {
			status: "no_source",
			sample_count: 0,
			sample_days: 0,
			active_season: nowCtx.season,
			active_weekday: nowCtx.weekday,
			active_day_type: nowCtx.dayType,
			fallbacks_used: 0,
			missing_source: true,
			source_state_id: sourceStateId,
			last_valid_measurement_ts: null,
			last_persist_at: null,
		},
		sourceStateId: "",
		error: "Keine Hauslast-Quelle — Admin-State oder addons.battery.mapping.consumption_w konfigurieren.",
	};
}

export function disabledResult(): HouseLoadComputeResult {
	const now = new Date();
	const r = noSourceResult("", now);
	return {
		...r,
		status: "disabled",
		error: "House Load Learning in Admin deaktiviert.",
	};
}

export function errorResult(message: string, sourceStateId: string, now: Date): HouseLoadComputeResult {
	const r = noSourceResult(sourceStateId, now);
	return {
		...r,
		status: "error",
		healthStatus: "degraded",
		sourceStateId,
		error: message,
		healthJson: { ...r.healthJson, status: "degraded", source_state_id: sourceStateId },
	};
}
