import type { PlanContribution } from "../types";
import { operatorQuality } from "../quality";
import {
	baseContribution,
	clampConfidencePct,
	isPvForecastPresent,
	pvContributorRef,
} from "./types";

export interface PvHorizonDayInput {
	dayIndex: number;
	dateKey: string;
	correctedKwh: number | null;
	confidencePct: number | null;
}

export interface PvContributionBuildInput {
	now: Date;
	correctedTodayKwh: number | null;
	correctedTomorrowKwh: number | null;
	rawTodayKwh: number | null;
	rawTomorrowKwh: number | null;
	confidencePct: number | null;
	status: string | null;
	lastUpdateTs: string | null;
	source: string;
	horizonDays: PvHorizonDayInput[];
}

function isStale(lastUpdateTs: string | null, now: Date, maxAgeHours: number): boolean {
	if (!lastUpdateTs) return true;
	const ms = Date.parse(lastUpdateTs);
	if (!Number.isFinite(ms)) return true;
	return now.getTime() - ms > maxAgeHours * 3_600_000;
}

export function buildPvContribution(input: PvContributionBuildInput): PlanContribution {
	const generatedAt = input.now.toISOString();
	const confidence = clampConfidencePct(input.confidencePct);
	const hasForecast = isPvForecastPresent(
		input.correctedTodayKwh,
		input.correctedTomorrowKwh,
		input.status,
	);
	const stale = isStale(input.lastUpdateTs, input.now, 36);

	let status: "valid" | "degraded" | "missing" = "missing";
	let reasonDe = "Keine gültige PV-Prognose vorhanden.";

	if (hasForecast) {
		if (input.status === "ready" && !stale) {
			status = "valid";
			reasonDe = "Korrigierte PV-Tagesprognose aus Learning PV-Bias.";
		} else if (stale) {
			status = "degraded";
			reasonDe = "PV-Prognose vorhanden, aber veraltet.";
		} else if (input.status === "insufficient_data") {
			status = "degraded";
			reasonDe = "PV-Prognose mit eingeschränkter Datenbasis.";
		} else {
			status = "degraded";
			reasonDe = `PV-Prognose mit Status ${input.status ?? "unbekannt"}.`;
		}
	}

	const todayKey = input.horizonDays.find((d) => d.dayIndex === 0)?.dateKey ?? null;
	const tomorrowKey = input.horizonDays.find((d) => d.dayIndex === 1)?.dateKey ?? null;

	return baseContribution(pvContributorRef(), ["supply"], {
		generatedAt,
		validUntil: null,
		revision: 1,
		enabled: hasForecast,
		flexible: false,
		gridEligible: false,
		quality: operatorQuality(status, reasonDe, confidence),
		reasonDe,
		details: {
			source: input.source,
			lastUpdateTs: input.lastUpdateTs,
			status: input.status,
			correctedTodayKwh: input.correctedTodayKwh,
			correctedTomorrowKwh: input.correctedTomorrowKwh,
			rawTodayKwh: input.rawTodayKwh,
			rawTomorrowKwh: input.rawTomorrowKwh,
			todayDateKey: todayKey,
			tomorrowDateKey: tomorrowKey,
			horizonDays: input.horizonDays,
			slotResolution: "daily_only",
			slotNoteDe: "Keine belastbare 15-Minuten-PV-Leistung — nur Tages-kWh.",
		},
		slots: [],
	});
}
