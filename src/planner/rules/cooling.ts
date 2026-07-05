import type { AcGlobalConfig, AcUnitConfig } from "../../addons/air_conditioning/types";
import { isHardOffTime, isWithinClockWindow, localMinutesNow } from "../../addons/air_conditioning/runtime/time";
import type { ConsumerPersistEntry } from "../../learning/consumer_stats/types";
import { resolveConsumerEffectivePowerW } from "../../learning/consumer_stats/learned_power";
import type { PlannerCoolingDecision } from "../types";
import { sumAllocatedConsumerPeakW } from "../consumer_allocate";

export type CoolingUnitPlanInput = {
	unit: AcUnitConfig;
	roomTempC: number | null;
	consumerStats: ConsumerPersistEntry | undefined;
};

export type CoolingPlanInput = {
	now: Date;
	acConfig: AcGlobalConfig;
	governanceEnabled: boolean;
	outdoorTempC: number | null;
	units: CoolingUnitPlanInput[];
};

export type CoolingUnitForecast = {
	unitIndex: number;
	name: string;
	powerW: number;
	powerSource: "config" | "learned";
	likelyActive: boolean;
	expectedHours: number;
	expectedKwh: number;
	reasonDe: string;
};

export type CoolingPlanResult = PlannerCoolingDecision & {
	units: CoolingUnitForecast[];
};

function remainingActiveHours(now: Date, unit: AcUnitConfig): number {
	const nowMin = localMinutesNow(now);
	if (isHardOffTime(nowMin, unit.hardOffAt)) {
		return 0;
	}
	const untilMin = parseClockEnd(unit.activeUntil);
	const hardOffMin = parseClockEnd(unit.hardOffAt);
	let endMin = untilMin ?? hardOffMin;
	if (hardOffMin !== null && (endMin === null || hardOffMin < endMin)) {
		endMin = hardOffMin;
	}
	if (endMin === null) {
		return 8;
	}
	if (endMin <= nowMin) {
		return 0;
	}
	return (endMin - nowMin) / 60;
}

function parseClockEnd(raw: string): number | null {
	const m = String(raw ?? "").trim().match(/^(\d{1,2}):(\d{2})/);
	if (!m) return null;
	const h = parseInt(m[1], 10);
	const min = parseInt(m[2], 10);
	if (!Number.isFinite(h) || !Number.isFinite(min)) return null;
	return h * 60 + min;
}

function estimateUnitCooling(input: {
	unit: AcUnitConfig;
	roomTempC: number | null;
	outdoorTempC: number | null;
	outdoorLikelyTempC: number;
	remainingHours: number;
	consumerStats: ConsumerPersistEntry | undefined;
	nowMs: number;
}): CoolingUnitForecast {
	const { unit } = input;
	const learned = resolveConsumerEffectivePowerW(
		input.consumerStats,
		unit.estimatedPowerW,
		input.nowMs,
	);
	const none = (reasonDe: string): CoolingUnitForecast => ({
		unitIndex: unit.index,
		name: unit.name,
		powerW: learned.powerW,
		powerSource: learned.source,
		likelyActive: false,
		expectedHours: 0,
		expectedKwh: 0,
		reasonDe,
	});

	if (input.remainingHours <= 0) {
		return none("Außerhalb Zeitfenster.");
	}

	const temp = input.roomTempC;
	const outdoor = input.outdoorTempC;
	const learnedHours =
		learned.medianRuntimeSecPerDay !== null && learned.medianRuntimeSecPerDay > 0
			? learned.medianRuntimeSecPerDay / 3600
			: null;

	let likelyActive = false;
	let expectedHours = 0;
	let reasonDe = "";

	if (temp !== null && temp >= unit.onTempC) {
		likelyActive = true;
		expectedHours = Math.min(input.remainingHours, learnedHours ?? input.remainingHours * 0.7);
		reasonDe = `Raum ${temp.toFixed(1)} °C ≥ ${unit.onTempC} °C`;
	} else if (temp !== null && temp > unit.offTempC) {
		likelyActive = learnedHours !== null && learnedHours >= 0.5;
		expectedHours = likelyActive ? Math.min(input.remainingHours, learnedHours ?? 1) : 0;
		reasonDe = likelyActive
			? `Raum ${temp.toFixed(1)} °C in Hysterese — historisch ${Math.round((learnedHours ?? 0) * 10) / 10} h/Tag`
			: `Raum ${temp.toFixed(1)} °C in Hysterese — heute eher aus`;
	} else if (outdoor !== null && outdoor >= input.outdoorLikelyTempC) {
		likelyActive = learnedHours !== null ? learnedHours >= 0.5 : true;
		expectedHours = likelyActive
			? Math.min(input.remainingHours, learnedHours ?? input.remainingHours * 0.4)
			: 0;
		reasonDe = outdoor !== null
			? `Außen ${outdoor.toFixed(1)} °C ≥ ${input.outdoorLikelyTempC} °C`
			: "Außen warm";
		if (learned.source === "learned" && learnedHours !== null) {
			reasonDe += ` — Ø ${Math.round(learnedHours * 10) / 10} h/Tag (${learned.sampleDays} Tage)`;
		}
	} else if (learnedHours !== null && learnedHours >= 1 && outdoor !== null && outdoor >= input.outdoorLikelyTempC - 2) {
		likelyActive = true;
		expectedHours = Math.min(input.remainingHours, learnedHours);
		reasonDe = `Historie: ${learned.sampleDays} Kühl-Tage, Ø ${Math.round(learnedHours * 10) / 10} h`;
	} else {
		return none(
			temp !== null
				? `Raum ${temp.toFixed(1)} °C unter Ein-Schwelle ${unit.onTempC} °C`
				: outdoor !== null
					? `Außen ${outdoor.toFixed(1)} °C unter ${input.outdoorLikelyTempC} °C`
					: "Keine Temp-Daten",
		);
	}

	const expectedKwh = likelyActive ? (learned.powerW * expectedHours) / 1000 : 0;
	const powerLabel = learned.source === "learned" ? `${learned.powerW} W (gelernt)` : `${learned.powerW} W (Config)`;
	return {
		unitIndex: unit.index,
		name: unit.name,
		powerW: learned.powerW,
		powerSource: learned.source,
		likelyActive,
		expectedHours: Math.round(expectedHours * 100) / 100,
		expectedKwh: Math.round(expectedKwh * 1000) / 1000,
		reasonDe: `${reasonDe}; ${powerLabel}`,
	};
}

export function planCooling(input: CoolingPlanInput): CoolingPlanResult {
	const none = (reason: string): CoolingPlanResult => ({
		expected_kwh_today: 0,
		expected_peak_w: 0,
		likely_active: false,
		reason_de: reason,
		forecast_active: false,
		units: [],
	});

	if (!input.governanceEnabled) {
		return none("Klima-Governance deaktiviert.");
	}

	const enabledUnits = input.units.filter(({ unit }) => unit.enabled);
	if (enabledUnits.length === 0) {
		return none("Kein Innengerät aktiv.");
	}

	const nowMin = localMinutesNow(input.now);
	const forecasts: CoolingUnitForecast[] = [];

	for (const row of enabledUnits) {
		const { unit } = row;
		if (!isWithinClockWindow(nowMin, unit.activeFrom, unit.activeUntil) || isHardOffTime(nowMin, unit.hardOffAt)) {
			forecasts.push({
				unitIndex: unit.index,
				name: unit.name,
				powerW: unit.estimatedPowerW,
				powerSource: "config",
				likelyActive: false,
				expectedHours: 0,
				expectedKwh: 0,
				reasonDe: "Außerhalb Betriebszeit.",
			});
			continue;
		}
		forecasts.push(
			estimateUnitCooling({
				unit,
				roomTempC: row.roomTempC,
				outdoorTempC: input.outdoorTempC,
				outdoorLikelyTempC: input.acConfig.plannerOutdoorLikelyTempC,
				remainingHours: remainingActiveHours(input.now, unit),
				consumerStats: row.consumerStats,
				nowMs: input.now.getTime(),
			}),
		);
	}

	const activeForecasts = forecasts.filter((f) => f.likelyActive && f.powerW > 0);
	const likelyActive = activeForecasts.length > 0;
	const expectedKwh = forecasts.reduce((sum, f) => sum + f.expectedKwh, 0);
	const peakUnitPowers = activeForecasts.map((f) => f.powerW);
	const expectedPeakW = likelyActive
		? sumAllocatedConsumerPeakW(peakUnitPowers, input.acConfig.outdoorMaxPowerW)
		: 0;

	const parts: string[] = [];
	if (likelyActive) {
		parts.push(
			`${activeForecasts.length} Unit(s), ~${Math.round(expectedKwh * 10) / 10} kWh, Peak ${expectedPeakW} W`,
		);
		for (const f of activeForecasts) {
			parts.push(`${f.name}: ${f.reasonDe}`);
		}
	} else {
		parts.push("Heute voraussichtlich keine Kühlung.");
	}

	return {
		expected_kwh_today: Math.round(expectedKwh * 1000) / 1000,
		expected_peak_w: expectedPeakW,
		likely_active: likelyActive,
		reason_de: parts.join(" | "),
		forecast_active: input.outdoorTempC !== null || enabledUnits.some((u) => u.roomTempC !== null),
		units: forecasts,
	};
}

export function coolingReserveW(cooling: Pick<PlannerCoolingDecision, "likely_active" | "expected_peak_w">): number {
	return cooling.likely_active ? cooling.expected_peak_w : 0;
}
