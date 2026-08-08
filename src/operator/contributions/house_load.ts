import { SEGMENT_HOURS, SEGMENTS, type HouseLoadSegment } from "../../learning/house_load/constants";
import type { DayForecastJson } from "../../learning/house_load/types";
import { dailyKwhFromHouseLoadForecast } from "../planning/battery_winter";
import type { PlanContribution, PlanSlotContribution } from "../types";
import { operatorQuality } from "../quality";
import { systemContributorRef } from "../contributor";
import { addDaysToDateKey, isoAtTimezoneLocal, localDateKeyInTimezone } from "../time";
import { CONTRIBUTION_IDS } from "../contribution_ids";
import { baseContribution, clampConfidencePct } from "./types";

export interface HouseLoadHorizonDayOutput {
	dayIndex: number;
	dateKey: string;
	kwh: number | null;
	confidencePct: number | null;
}

export interface HouseLoadContributionBuildInput {
	now: Date;
	timezone: string;
	status: string | null;
	confidence: number | null;
	forecastToday: DayForecastJson | null;
	forecastTomorrow: DayForecastJson | null;
	/** Tag 3–7 (analog PV-Horizon) — gleiche Musterlogik wie morgen, kein erfundener Wert. */
	forecastHorizon?: DayForecastJson[] | null;
	lastUpdate: string | null;
}

export function dailyKwhFromHouseLoadDayForecast(json: DayForecastJson | null): number | null {
	return dailyKwhFromHouseLoadForecast(json);
}

function segmentSlotsFromForecast(
	forecast: DayForecastJson,
	timezone: string,
	confidence: number | null,
): PlanSlotContribution[] {
	const slots: PlanSlotContribution[] = [];
	for (const segment of SEGMENTS) {
		const entry = forecast.segments[segment as HouseLoadSegment];
		if (entry?.avg_w == null || !Number.isFinite(entry.avg_w)) continue;
		const bounds = SEGMENT_HOURS[segment as HouseLoadSegment];
		const startIso = isoAtTimezoneLocal(forecast.date, bounds.start, 0, timezone);
		const endIso = isoAtTimezoneLocal(forecast.date, bounds.end === 24 ? 23 : bounds.end, bounds.end === 24 ? 59 : 0, timezone);
		if (bounds.end === 24) {
			const nextDay = addDaysToDateKey(forecast.date, 1);
			const endMs = isoAtTimezoneLocal(nextDay, 0, 0, timezone);
			slots.push(makeSegmentSlot(startIso, endMs, entry.avg_w, entry, confidence));
		} else {
			slots.push(makeSegmentSlot(startIso, endIso, entry.avg_w, entry, confidence));
		}
	}
	return slots.sort((a, b) => a.slot.startIso.localeCompare(b.slot.startIso));
}

function makeSegmentSlot(
	startIso: string,
	endIso: string,
	avgW: number,
	entry: NonNullable<DayForecastJson["segments"][HouseLoadSegment]>,
	confidence: number | null,
): PlanSlotContribution {
	const hours = (Date.parse(endIso) - Date.parse(startIso)) / 3_600_000;
	const energyKwh = hours > 0 ? Math.round((avgW * hours) / 1000 * 1000) / 1000 : null;
	return {
		slot: { startIso, endIso },
		minPowerW: avgW,
		preferredPowerW: avgW,
		maxPowerW: avgW,
		requiredEnergyKwh: energyKwh,
		availableEnergyKwh: null,
		priceCtPerKwh: null,
		available: true,
		mandatory: true,
		quality: operatorQuality("valid", "Segment-Baseline aus House-Load-Learning.", entry.confidence ?? confidence),
	};
}

function worstFallbackLevel(forecast: DayForecastJson | null): string | null {
	if (!forecast) return null;
	let worst: string | null = null;
	const rank: Record<string, number> = {
		none: 0,
		season_weekday_segment: 1,
		season_day_type_segment: 2,
		all_seasons_weekday_segment: 3,
		global_segment: 4,
		median_all: 5,
	};
	for (const segment of SEGMENTS) {
		const entry = forecast.segments[segment as HouseLoadSegment];
		if (!entry) continue;
		const level = entry.fallback_level ?? "none";
		if (worst === null || (rank[level] ?? 99) > (rank[worst] ?? -1)) {
			worst = level;
		}
	}
	return worst;
}

export function buildHouseLoadContribution(input: HouseLoadContributionBuildInput): PlanContribution {
	const generatedAt = input.now.toISOString();
	const confidence = clampConfidencePct(input.confidence);
	const todayKwh = dailyKwhFromHouseLoadDayForecast(input.forecastToday);
	const tomorrowKwh = dailyKwhFromHouseLoadDayForecast(input.forecastTomorrow);
	const hasForecast = todayKwh !== null || tomorrowKwh !== null;

	let status: "valid" | "degraded" | "missing" = "missing";
	let reasonDe = "Keine gültige Hauslast-Prognose vorhanden.";

	if (hasForecast) {
		const ready = input.status === "ready" || input.status === "degraded";
		const fallbackToday = worstFallbackLevel(input.forecastToday);
		const fallbackTomorrow = worstFallbackLevel(input.forecastTomorrow);
		const heavyFallback =
			(fallbackToday && fallbackToday !== "none" && fallbackToday !== "season_weekday_segment") ||
			(fallbackTomorrow && fallbackTomorrow !== "none" && fallbackTomorrow !== "season_weekday_segment");

		if (ready && !heavyFallback) {
			status = input.status === "degraded" ? "degraded" : "valid";
			reasonDe =
				input.status === "degraded"
					? "Hauslast-Prognose mit eingeschränkter Datenqualität."
					: "Erwartete feste Hauslast aus House-Load-Learning.";
		} else {
			status = "degraded";
			reasonDe = heavyFallback
				? `Hauslast-Prognose mit Fallback-Ebene ${fallbackToday ?? fallbackTomorrow}.`
				: "Hauslast-Prognose mit eingeschränktem Status.";
		}
	}

	const slots: PlanSlotContribution[] = [];
	if (input.forecastToday) {
		slots.push(...segmentSlotsFromForecast(input.forecastToday, input.timezone, confidence));
	}
	if (input.forecastTomorrow) {
		slots.push(...segmentSlotsFromForecast(input.forecastTomorrow, input.timezone, confidence));
	}
	// Roadmap Block 5: Segment-Slots auch für Tag 3+ (Daily-Plan-Horizont ≥48 h) —
	// gleiche Musterprognose wie morgen, keine erfundenen Werte.
	for (const forecast of input.forecastHorizon ?? []) {
		if (!forecast?.date) continue;
		slots.push(...segmentSlotsFromForecast(forecast, input.timezone, confidence));
	}

	const todayKey = input.forecastToday?.date ?? localDateKeyInTimezone(input.now, input.timezone);
	const tomorrowKey =
		input.forecastTomorrow?.date ?? addDaysToDateKey(localDateKeyInTimezone(input.now, input.timezone), 1);

	const horizonDays: HouseLoadHorizonDayOutput[] = (input.forecastHorizon ?? []).map((forecast, idx) => ({
		dayIndex: idx + 2,
		dateKey: forecast.date,
		kwh: dailyKwhFromHouseLoadDayForecast(forecast),
		confidencePct: confidence,
	}));

	return baseContribution(CONTRIBUTION_IDS.HOUSE_LOAD_FIXED, systemContributorRef("house_load"), "consume", ["demand_fixed"], {
		generatedAt,
		validUntil: null,
		revision: 1,
		enabled: hasForecast,
		flexible: false,
		gridEligible: false,
		quality: operatorQuality(status, reasonDe, confidence),
		reasonDe,
		details: {
			lastUpdate: input.lastUpdate,
			status: input.status,
			expectedFixedTodayKwh: todayKwh,
			expectedFixedTomorrowKwh: tomorrowKwh,
			todayDateKey: todayKey,
			tomorrowDateKey: tomorrowKey,
			horizonDays,
			fallbackLevelToday: worstFallbackLevel(input.forecastToday),
			fallbackLevelTomorrow: worstFallbackLevel(input.forecastTomorrow),
			slotResolution: slots.length > 0 ? "segment_baseline" : "daily_only",
			slotNoteDe:
				slots.length > 0
					? "Segment-Baselines (nicht-steuerbare Grundlast, EMS-Flex separat) — keine künstliche 15-Minuten-Auflösung innerhalb der Segmente."
					: "Keine belastbaren Segment-Zeitfenster — nur Tagesaggregate.",
		},
		slots,
	});
}
