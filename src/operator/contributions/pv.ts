import type { PlanContribution, PlanSlotContribution } from "../types";
import { operatorQuality } from "../quality";
import { CONTRIBUTION_IDS } from "../contribution_ids";
import { addDaysToDateKey, isoAtTimezoneLocal, localDateKeyInTimezone } from "../time";
import { baseContribution, clampConfidencePct, isPvForecastPresent, pvContributorRef } from "./types";
import { buildPvShapeForDay, type PvShapeHourPoint } from "./pv_shape";

export interface PvHorizonDayInput {
	dayIndex: number;
	dateKey: string;
	correctedKwh: number | null;
	confidencePct: number | null;
}

/** Optionale Eingaben für eine wetterbasierte 15-Min-PV-Form (v0.1.188, siehe pv_shape.ts). */
export interface PvShapeInput {
	timezone: string;
	latDeg: number | null;
	lonDeg: number | null;
	hourlyPoints: PvShapeHourPoint[];
	capW: number | null;
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
	/** Ohne diese Eingaben (z. B. kein Lat/Lon konfiguriert) bleibt `slots: []` — kein erfundener Verlauf. */
	shape?: PvShapeInput | null;
}

function fullDaySlots(dateKey: string, timezone: string): Array<{ startIso: string; endIso: string }> {
	const dayStartIso = isoAtTimezoneLocal(dateKey, 0, 0, timezone);
	const dayEndIso = isoAtTimezoneLocal(addDaysToDateKey(dateKey, 1), 0, 0, timezone);
	const startMs = Date.parse(dayStartIso);
	const endMs = Date.parse(dayEndIso);
	if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return [];
	const slots: Array<{ startIso: string; endIso: string }> = [];
	let cursor = startMs;
	while (cursor < endMs) {
		const next = cursor + 15 * 60_000;
		slots.push({ startIso: new Date(cursor).toISOString(), endIso: new Date(next).toISOString() });
		cursor = next;
	}
	return slots;
}

function pvShapeSlotContributions(
	dateKey: string,
	dailyKwh: number | null,
	shape: PvShapeInput,
): PlanSlotContribution[] {
	const daySlots = fullDaySlots(dateKey, shape.timezone);
	const shaped = buildPvShapeForDay(daySlots, dailyKwh, shape.latDeg, shape.lonDeg, shape.hourlyPoints, shape.capW);
	return shaped.map((s) => ({
		slot: s.slot,
		minPowerW: s.pvPowerW,
		preferredPowerW: s.pvPowerW,
		maxPowerW: s.pvPowerW,
		requiredEnergyKwh: null,
		availableEnergyKwh: null,
		priceCtPerKwh: null,
		available: true,
		mandatory: false,
		quality: operatorQuality("valid", "Wetterbasierte PV-Form (Sonnenstand + Bewölkung/Solar-Schätzung)."),
	}));
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

	const slots: PlanSlotContribution[] = [];
	let shapeActive = false;
	if (hasForecast && input.shape && input.shape.latDeg !== null && input.shape.lonDeg !== null) {
		const today = todayKey ?? localDateKeyInTimezone(input.now, input.shape.timezone);
		const tomorrow = tomorrowKey ?? addDaysToDateKey(today, 1);
		const todaySlots = pvShapeSlotContributions(today, input.correctedTodayKwh, input.shape);
		const tomorrowSlots = pvShapeSlotContributions(tomorrow, input.correctedTomorrowKwh, input.shape);
		slots.push(...todaySlots, ...tomorrowSlots);
		shapeActive = slots.length > 0;
	}

	return baseContribution(CONTRIBUTION_IDS.PV_SUPPLY, pvContributorRef(), "provide", ["supply"], {
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
			slotResolution: shapeActive ? "weather_shaped_15min" : "daily_only",
			slotNoteDe: shapeActive
				? "15-Minuten-PV-Form aus Sonnenstand + Bewölkung/Solar-Schätzung, normiert auf gelernte Tages-kWh."
				: "Keine belastbare 15-Minuten-PV-Leistung — nur Tages-kWh (Lat/Lon oder Wetterdaten fehlen).",
		},
		slots,
	});
}
