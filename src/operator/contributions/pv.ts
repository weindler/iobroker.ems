import type { PlanContribution, PlanSlotContribution } from "../types";
import { operatorQuality } from "../quality";
import { CONTRIBUTION_IDS } from "../contribution_ids";
import { addDaysToDateKey, isoAtTimezoneLocal, localDateKeyInTimezone } from "../time";
import { baseContribution, clampConfidencePct, isPvForecastPresent, pvContributorRef } from "./types";
import { buildPvShapeForDay, type PvShapeHourPoint } from "./pv_shape";
import { applyIntradayFactor, computeIntradayFactor, type IntradayResult, type RecentActual } from "./pv_intraday";

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
	/** Ist-Ertrag heute bisher (kWh, DAY_ENERGY) für die Korrektur im Tagesverlauf; null = keine Korrektur. */
	actualTodayKwh?: number | null;
	/** Ertrag der letzten ~Stunde (aus gemerkten Zählerständen) als schnelleres Signal; null = unbekannt. */
	actualRecent?: RecentActual | null;
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
	intraday?: {
		actualTodayKwh: number | null;
		actualRecent: RecentActual | null;
		nowMs: number;
		onResult: (r: IntradayResult) => void;
	},
): PlanSlotContribution[] {
	const daySlots = fullDaySlots(dateKey, shape.timezone);
	let shaped = buildPvShapeForDay(daySlots, dailyKwh, shape.latDeg, shape.lonDeg, shape.hourlyPoints, shape.capW);
	if (intraday) {
		const items = shaped.map((s) => ({ startIso: s.slot.startIso, endIso: s.slot.endIso, pvPowerW: s.pvPowerW }));
		const result = computeIntradayFactor(items, intraday.actualTodayKwh, intraday.nowMs, intraday.actualRecent);
		intraday.onResult(result);
		if (result.active) {
			const scaled = applyIntradayFactor(items, result.factor, intraday.nowMs);
			shaped = shaped.map((s, i) => ({ ...s, pvPowerW: scaled[i].pvPowerW }));
		}
	}
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
	let intradayResult: IntradayResult | null = null;
	if (hasForecast && input.shape && input.shape.latDeg !== null && input.shape.lonDeg !== null) {
		// Arbeitsplan Punkt 5: 15-Min-Form für alle Horizon-Tage mit kWh (Daily Plan 72 h),
		// nicht nur heute/morgen — nie erfundene Tages-kWh.
		const today = todayKey ?? localDateKeyInTimezone(input.now, input.shape.timezone);
		const dayKwhByKey = new Map<string, number | null>();
		dayKwhByKey.set(today, input.correctedTodayKwh);
		dayKwhByKey.set(tomorrowKey ?? addDaysToDateKey(today, 1), input.correctedTomorrowKwh);
		for (const day of input.horizonDays) {
			if (!day.dateKey) continue;
			if (!dayKwhByKey.has(day.dateKey) || day.dayIndex >= 2) {
				dayKwhByKey.set(day.dateKey, day.correctedKwh);
			}
		}
		const orderedKeys = [...dayKwhByKey.keys()].sort();
		for (const dateKey of orderedKeys) {
			const kwh = dayKwhByKey.get(dateKey) ?? null;
			if (kwh === null || !Number.isFinite(kwh)) continue;
			slots.push(
				...pvShapeSlotContributions(
					dateKey,
					kwh,
					input.shape,
					dateKey === today
						? {
								actualTodayKwh: input.actualTodayKwh ?? null,
								actualRecent: input.actualRecent ?? null,
								nowMs: input.now.getTime(),
								onResult: (r) => {
									intradayResult = r;
								},
							}
						: undefined,
				),
			);
		}
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
			expectedTodayKwh: (() => {
				const r = intradayResult as IntradayResult | null;
				if (!r || input.correctedTodayKwh === null || !Number.isFinite(input.correctedTodayKwh)) return null;
				if (!r.active || r.actualSoFarKwh === null) return input.correctedTodayKwh;
				const rest = Math.max(0, input.correctedTodayKwh - r.expectedSoFarKwh) * r.factor;
				return Math.round((r.actualSoFarKwh + rest) * 100) / 100;
			})(),
			intradayFactor: intradayResult ? (intradayResult as IntradayResult).factor : null,
			intradayActive: intradayResult ? (intradayResult as IntradayResult).active : false,
			intradayExpectedSoFarKwh: intradayResult ? (intradayResult as IntradayResult).expectedSoFarKwh : null,
			intradayActualSoFarKwh: intradayResult ? (intradayResult as IntradayResult).actualSoFarKwh : null,
			intradayReasonDe: intradayResult ? (intradayResult as IntradayResult).reasonDe : null,
			slotResolution: shapeActive ? "weather_shaped_15min" : "daily_only",
			slotNoteDe: shapeActive
				? "15-Minuten-PV-Form aus Sonnenstand + Bewölkung/Solar-Schätzung, normiert auf gelernte Tages-kWh."
				: "Keine belastbare 15-Minuten-PV-Leistung — nur Tages-kWh (Lat/Lon oder Wetterdaten fehlen).",
		},
		slots,
	});
}
