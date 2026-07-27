import type { PlanContribution } from "../types";
import { operatorQuality } from "../quality";
import { addonContributorRef } from "../contributor";
import { CONTRIBUTION_IDS } from "../contribution_ids";
import { baseContribution, clampConfidencePct, weatherForecastAddonId } from "./types";

export interface WeatherHourlyPoint {
	startIso: string;
	endIso: string;
	outdoorTempC: number | null;
	cloudPct: number | null;
}

export interface WeatherHorizonDayDetail {
	dayIndex: number;
	dateKey: string;
	minTempC: number | null;
	maxTempC: number | null;
	quality: "valid" | "degraded" | "missing";
}

export interface WeatherContributionBuildInput {
	now: Date;
	learningStatus: string | null;
	learningHealth: string | null;
	confidencePct: number | null;
	lastUpdate: string | null;
	forecastSource: string | null;
	actualSource: string | null;
	outdoorTempC: number | null;
	cloudPct: number | null;
	hourlyPoints: WeatherHourlyPoint[];
	todayMinTempC: number | null;
	todayMaxTempC: number | null;
	tomorrowMinTempC: number | null;
	tomorrowMaxTempC: number | null;
	horizonDays?: WeatherHorizonDayDetail[];
	forecastHorizonStart: string | null;
	forecastHorizonEnd: string | null;
}

export function buildWeatherContribution(input: WeatherContributionBuildInput): PlanContribution {
	const generatedAt = input.now.toISOString();
	const confidence = clampConfidencePct(input.confidencePct);
	const hasTemp = input.outdoorTempC !== null || input.hourlyPoints.some((p) => p.outdoorTempC !== null);
	const hasContext =
		hasTemp ||
		input.cloudPct !== null ||
		input.todayMinTempC !== null ||
		input.todayMaxTempC !== null ||
		(input.horizonDays?.some((d) => d.minTempC !== null || d.maxTempC !== null) ?? false);

	let status: "valid" | "degraded" | "missing" = "missing";
	let reasonDe = "Keine Wetter-Kontextdaten vorhanden.";

	if (hasContext) {
		const learningOk =
			input.learningStatus === "ready" ||
			input.learningHealth === "ok" ||
			input.learningHealth === "degraded";
		if (learningOk || input.outdoorTempC !== null) {
			status = input.learningHealth === "degraded" ? "degraded" : "valid";
			reasonDe = "Wetter-Kontext für Planung (keine elektrische Energiebilanz).";
		} else {
			status = "degraded";
			reasonDe = "Wetterdaten eingeschränkt verfügbar.";
		}
	}

	const slots = input.hourlyPoints.map((point) => ({
		slot: { startIso: point.startIso, endIso: point.endIso },
		minPowerW: null,
		preferredPowerW: null,
		maxPowerW: null,
		requiredEnergyKwh: null,
		availableEnergyKwh: null,
		priceCtPerKwh: null,
		available: point.outdoorTempC !== null || point.cloudPct !== null,
		mandatory: false,
		quality: operatorQuality(
			point.outdoorTempC !== null || point.cloudPct !== null ? "valid" : "missing",
			"Wetter-Kontext-Slot.",
			confidence,
		),
	}));

	return baseContribution(
		CONTRIBUTION_IDS.WEATHER_CONTEXT,
		addonContributorRef(weatherForecastAddonId()),
		"context",
		["context"],
		{
		generatedAt,
		validUntil: input.forecastHorizonEnd,
		revision: 1,
		enabled: hasContext,
		flexible: false,
		gridEligible: false,
		quality: operatorQuality(status, reasonDe, confidence),
		reasonDe,
		details: {
			learningStatus: input.learningStatus,
			learningHealth: input.learningHealth,
			lastUpdate: input.lastUpdate,
			forecastSource: input.forecastSource,
			actualSource: input.actualSource,
			outdoorTempC: input.outdoorTempC,
			cloudPct: input.cloudPct,
			todayMinTempC: input.todayMinTempC,
			todayMaxTempC: input.todayMaxTempC,
			tomorrowMinTempC: input.tomorrowMinTempC,
			tomorrowMaxTempC: input.tomorrowMaxTempC,
			horizonDays: input.horizonDays ?? [],
			forecastHorizonStart: input.forecastHorizonStart,
			forecastHorizonEnd: input.forecastHorizonEnd,
			hourlyPoints: input.hourlyPoints,
			contextOnly: true,
			slotNoteDe: "Wetter liefert Kontext — keine kWh-Bilanz.",
		},
		slots,
	});
}
