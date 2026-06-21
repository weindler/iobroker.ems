import type {
	FallbackLevel,
	HouseLoadDayType,
	HouseLoadSeason,
	HouseLoadSegment,
	HouseLoadWeekday,
} from "./constants";

export type HouseLoadConfig = {
	enabled: boolean;
	lookbackDays: number;
	/** Leer = Fallback auf addons.battery.mapping.consumption_w */
	powerStateId: string;
};

export type HouseLoadSample = {
	ts: number;
	hourStartMs: number;
	dateKey: string;
	hourOfDay: number;
	segment: HouseLoadSegment;
	season: HouseLoadSeason;
	weekday: HouseLoadWeekday;
	dayType: HouseLoadDayType;
	powerW: number;
};

export type ProfileCell = {
	avgW: number;
	samples: number;
	confidence: number;
};

export type SeasonProfile = Partial<
	Record<HouseLoadWeekday, Partial<Record<HouseLoadSegment, ProfileCell>>>
>;

export type HouseLoadProfileJson = Partial<Record<HouseLoadSeason, SeasonProfile>>;

export type SegmentForecastEntry = {
	avg_w: number | null;
	source: string;
	fallback_level: FallbackLevel | "none";
	confidence: number;
};

export type DayForecastJson = {
	date: string;
	season: HouseLoadSeason;
	weekday: HouseLoadWeekday;
	day_type: HouseLoadDayType;
	segments: Partial<Record<HouseLoadSegment, SegmentForecastEntry>>;
};

export type HouseLoadHealthJson = {
	status: "ok" | "degraded" | "no_source";
	sample_count: number;
	sample_days: number;
	active_season: HouseLoadSeason;
	active_weekday: HouseLoadWeekday;
	active_day_type: HouseLoadDayType;
	fallbacks_used: number;
	missing_source: boolean;
	source_state_id: string;
	last_valid_measurement_ts: string | null;
	last_persist_at: string | null;
};

export type HouseLoadComputeResult = {
	status: "ready" | "insufficient_data" | "degraded" | "no_source" | "disabled" | "error";
	healthStatus: HouseLoadHealthJson["status"];
	sampleCount: number;
	sampleDays: number;
	confidence: number;
	currentSegment: HouseLoadSegment;
	currentSeason: HouseLoadSeason;
	currentWeekday: HouseLoadWeekday;
	currentDayType: HouseLoadDayType;
	profileJson: HouseLoadProfileJson;
	forecastTodayJson: DayForecastJson;
	forecastTomorrowJson: DayForecastJson;
	healthJson: HouseLoadHealthJson;
	sourceStateId: string;
	error: string;
};

export type HouseLoadPersist = {
	generated_at: string;
	module: string;
	sample_count: number;
	sample_days: number;
	confidence: number;
	profile: HouseLoadProfileJson;
	forecast_today: DayForecastJson;
	forecast_tomorrow: DayForecastJson;
	health: HouseLoadHealthJson;
};

export type ProfileAccumulator = {
	sumW: number;
	count: number;
	values: number[];
};

export type LookupResult = {
	avgW: number | null;
	confidence: number;
	source: string;
	fallbackLevel: FallbackLevel | "none";
};
