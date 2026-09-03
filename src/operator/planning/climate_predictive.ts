/**
 * Climate-Bedarfsermittlung in drei Reifestufen:
 *   bootstrap        — Neuinstallation / Learning noch nicht usable
 *   predictive       — passiv + Mode usable, Sensoren + Stundenforecast belastbar
 *   legacy_fallback  — notwendige Eingangsdaten fehlen (bestehende v0.2.23-Heuristik)
 *
 * Keine erfundenen K/h im Bootstrap. Learning-Raten nur bei usable=true.
 * Beeinflusst nur den Bedarf vor Unified — nicht Runtime/Safety/Hard-Off.
 */

import { acModeCommandEnabled, availableAcModePurposes } from "../../addons/air_conditioning/config";
import type { AcUnitConfig } from "../../addons/air_conditioning/types";
import type { ClimateThermalEffectStat, ClimateThermalUnitModel } from "../../learning/climate_thermal/types";
import type { WeatherHourlyPoint } from "../contributions/weather";
import { estimateCoolingHours, estimateDehumidifyHours, outdoorDriveFactor } from "./climate_energy";

export type ClimateDemandModel = "bootstrap" | "predictive" | "legacy_fallback";

export type ClimateModeDemand = {
	likelyActive: boolean;
	expectedHours: number;
	reasonDe: string;
	predictedCrossingAtIso: string | null;
	predictedPeak: number | null;
	predictedLow: number | null;
};

export type ClimateUnitDemandResult = {
	demandModel: ClimateDemandModel;
	fallbackReasonDe: string | null;
	predictiveConfidence: number | null;
	cooling: ClimateModeDemand;
	heating: ClimateModeDemand;
	dehumidify: ClimateModeDemand;
	reasonDe: string;
};

/** Anteil der Fenster-Stunden mit Temperatur, bevor Predictive greifen darf. */
const PREDICTIVE_HOURLY_COVERAGE = 0.5;
/** Qualitätsschutz gegen runaway — keine Physik-Konstante für Bootstrap. */
const PREDICTIVE_MAX_ABS_RATE_K_PER_H = 3;
/** Bestehende Dry-Sofort-Fraktion aus estimateDehumidifyHours. */
const DRY_IMMEDIATE_REMAINING_FRACTION = 0.45;
/** Bestehende Pre-Cool-Fraktion analog estimateDehumidifyHours outdoor-Zweig. */
const BOOTSTRAP_PREEMPT_FRACTION = 0.35;

function round2(n: number): number {
	return Math.round(n * 100) / 100;
}

function noneMode(reasonDe: string): ClimateModeDemand {
	return {
		likelyActive: false,
		expectedHours: 0,
		reasonDe,
		predictedCrossingAtIso: null,
		predictedPeak: null,
		predictedLow: null,
	};
}

function modeDemand(
	hours: number,
	reasonDe: string,
	extra: Partial<ClimateModeDemand> = {},
): ClimateModeDemand {
	const h = Math.max(0, round2(hours));
	const likely = h >= 0.25;
	return {
		likelyActive: likely,
		expectedHours: likely ? h : 0,
		reasonDe,
		predictedCrossingAtIso: extra.predictedCrossingAtIso ?? null,
		predictedPeak: extra.predictedPeak ?? null,
		predictedLow: extra.predictedLow ?? null,
	};
}

export function hourlyPointsInWindow(
	points: WeatherHourlyPoint[],
	fromMs: number,
	toMs: number,
): WeatherHourlyPoint[] {
	if (!(toMs > fromMs) || !Array.isArray(points)) return [];
	return points
		.filter((p) => {
			const a = Date.parse(p.startIso);
			const b = Date.parse(p.endIso);
			if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return false;
			return b > fromMs && a < toMs;
		})
		.sort((x, y) => Date.parse(x.startIso) - Date.parse(y.startIso));
}

function hourlyCoverage(points: WeatherHourlyPoint[], fromMs: number, toMs: number): number {
	const span = toMs - fromMs;
	if (!(span > 0)) return 0;
	let covered = 0;
	for (const p of points) {
		if (p.outdoorTempC == null || !Number.isFinite(p.outdoorTempC)) continue;
		const a = Math.max(fromMs, Date.parse(p.startIso));
		const b = Math.min(toMs, Date.parse(p.endIso));
		if (b > a) covered += b - a;
	}
	return covered / span;
}

function futureOutdoorMaxC(points: WeatherHourlyPoint[], fromMs: number, toMs: number): number | null {
	let max: number | null = null;
	for (const p of hourlyPointsInWindow(points, fromMs, toMs)) {
		if (p.outdoorTempC == null || !Number.isFinite(p.outdoorTempC)) continue;
		max = max == null ? p.outdoorTempC : Math.max(max, p.outdoorTempC);
	}
	return max;
}

function futureOutdoorMinC(points: WeatherHourlyPoint[], fromMs: number, toMs: number): number | null {
	let min: number | null = null;
	for (const p of hourlyPointsInWindow(points, fromMs, toMs)) {
		if (p.outdoorTempC == null || !Number.isFinite(p.outdoorTempC)) continue;
		min = min == null ? p.outdoorTempC : Math.min(min, p.outdoorTempC);
	}
	return min;
}

function warmHoursInWindow(
	points: WeatherHourlyPoint[],
	fromMs: number,
	toMs: number,
	thresholdC: number,
): number {
	let sec = 0;
	for (const p of hourlyPointsInWindow(points, fromMs, toMs)) {
		if (p.outdoorTempC == null || p.outdoorTempC < thresholdC) continue;
		const a = Math.max(fromMs, Date.parse(p.startIso));
		const b = Math.min(toMs, Date.parse(p.endIso));
		if (b > a) sec += (b - a) / 1000;
	}
	return sec / 3600;
}

function coldHoursInWindow(
	points: WeatherHourlyPoint[],
	fromMs: number,
	toMs: number,
	thresholdC: number,
): number {
	let sec = 0;
	for (const p of hourlyPointsInWindow(points, fromMs, toMs)) {
		if (p.outdoorTempC == null || p.outdoorTempC > thresholdC) continue;
		const a = Math.max(fromMs, Date.parse(p.startIso));
		const b = Math.min(toMs, Date.parse(p.endIso));
		if (b > a) sec += (b - a) / 1000;
	}
	return sec / 3600;
}

function statUsable(stat: ClimateThermalEffectStat | undefined | null): boolean {
	return !!stat && stat.usable === true && stat.rate != null && Number.isFinite(stat.rate);
}

function pickPassiveRateKPerH(
	model: ClimateThermalUnitModel,
	roomC: number,
	outdoorC: number | null,
): number | null {
	const p = model.passive;
	if (!statUsable(p) || p.rate == null) return null;
	if (outdoorC != null && Number.isFinite(outdoorC)) {
		if (outdoorC > roomC + 0.5 && p.warmingRateKPerH != null) return p.warmingRateKPerH;
		if (outdoorC < roomC - 0.5 && p.coolingRateKPerH != null) return p.coolingRateKPerH;
	}
	return p.rate;
}

function clampRate(rate: number): number {
	return Math.max(-PREDICTIVE_MAX_ABS_RATE_K_PER_H, Math.min(PREDICTIVE_MAX_ABS_RATE_K_PER_H, rate));
}

function simulateRoomTemp(input: {
	startRoomC: number;
	fromMs: number;
	toMs: number;
	points: WeatherHourlyPoint[];
	passive: ClimateThermalUnitModel;
	thresholdC: number;
	crossWhen: "above" | "below";
}): { peak: number; low: number; crossingAtMs: number | null; endC: number } {
	let room = input.startRoomC;
	let peak = room;
	let low = room;
	let crossingAtMs: number | null = null;
	const crossed = (v: number) =>
		input.crossWhen === "above" ? v >= input.thresholdC : v <= input.thresholdC;
	if (crossed(room)) crossingAtMs = input.fromMs;

	const pts = hourlyPointsInWindow(input.points, input.fromMs, input.toMs);
	let cursor = input.fromMs;
	for (const p of pts) {
		const a = Math.max(cursor, Date.parse(p.startIso));
		const b = Math.min(input.toMs, Date.parse(p.endIso));
		if (!(b > a)) continue;
		const outdoor = p.outdoorTempC;
		const rate = pickPassiveRateKPerH(input.passive, room, outdoor);
		if (rate == null) {
			cursor = b;
			continue;
		}
		const hours = (b - a) / 3_600_000;
		const next = room + clampRate(rate) * hours;
		if (crossingAtMs == null && crossed(room) !== crossed(next)) {
			const span = next - room;
			const need = input.thresholdC - room;
			const frac = span !== 0 ? Math.max(0, Math.min(1, need / span)) : 0;
			crossingAtMs = a + frac * (b - a);
		}
		room = next;
		peak = Math.max(peak, room);
		low = Math.min(low, room);
		cursor = b;
	}
	return { peak, low, crossingAtMs, endC: room };
}

function capWithLearnedHours(hours: number, remaining: number, learnedHours: number | null): number {
	let h = Math.min(remaining, Math.max(0, hours));
	if (learnedHours != null && learnedHours > 0) {
		h = Math.min(h, learnedHours * 1.25);
	}
	return h;
}

function hoursFromDeltaK(deltaK: number, rateKPerH: number, remaining: number, learnedHours: number | null): number {
	const absRate = Math.abs(rateKPerH);
	if (!(absRate > 0.05) || !(deltaK > 0)) return 0;
	return capWithLearnedHours(deltaK / absRate, remaining, learnedHours);
}

export type ClimatePredictiveInput = {
	now: Date;
	unit: AcUnitConfig;
	roomTempC: number | null;
	roomHumidityPct: number | null;
	outdoorTempC: number | null;
	outdoorForecastMaxC: number | null;
	outdoorLikelyTempC: number;
	remainingHours: number;
	windowEndMs: number;
	hourlyPoints: WeatherHourlyPoint[];
	thermal: ClimateThermalUnitModel | null | undefined;
	learnedHours: number | null;
};

function legacyCooling(input: ClimatePredictiveInput): ClimateModeDemand {
	const r = estimateCoolingHours({
		outdoorMaxC: input.outdoorForecastMaxC ?? input.outdoorTempC,
		outdoorLikelyTempC: input.outdoorLikelyTempC,
		remainingHours: input.remainingHours,
		learnedHours: input.learnedHours,
		roomTempC: input.roomTempC,
		onTempC: input.unit.onTempC,
		offTempC: input.unit.offTempC,
	});
	return modeDemand(r.expectedHours, r.reasonDe);
}

function legacyDry(input: ClimatePredictiveInput, dryConfigured: boolean): ClimateModeDemand {
	const r = estimateDehumidifyHours({
		outdoorMaxC: input.outdoorForecastMaxC ?? input.outdoorTempC,
		outdoorLikelyTempC: input.outdoorLikelyTempC,
		remainingHours: input.remainingHours,
		learnedHours: input.learnedHours,
		roomHumidityPct: input.roomHumidityPct,
		maxHumidityPct: input.unit.maxHumidityPct,
		dryModeConfigured: dryConfigured,
	});
	return modeDemand(r.expectedHours, r.reasonDe);
}

function bootstrapCooling(input: ClimatePredictiveInput, fromMs: number, toMs: number): ClimateModeDemand {
	const room = input.roomTempC;
	const onC = input.unit.onTempC;
	const offC = input.unit.offTempC;
	if (room == null) return noneMode("Raumtemperatur fehlt.");
	if (!acModeCommandEnabled(input.unit.modeWhenCooling)) {
		return noneMode("Climate Cooling nicht verfügbar.");
	}
	const remaining = input.remainingHours;
	const futureMax = futureOutdoorMaxC(input.hourlyPoints, fromMs, toMs);
	const nWarm = warmHoursInWindow(input.hourlyPoints, fromMs, toMs, input.outdoorLikelyTempC);

	if (room >= onC) {
		const hours = input.hourlyPoints.length
			? capWithLearnedHours(Math.max(0.5, nWarm > 0 ? nWarm : remaining * 0.5), remaining, input.learnedHours)
			: capWithLearnedHours(remaining, remaining, input.learnedHours);
		return modeDemand(hours, `Raum ${room.toFixed(1)} °C ≥ ${onC} °C — aktueller Kühlbedarf`, {
			predictedPeak: room,
			predictedCrossingAtIso: input.now.toISOString(),
		});
	}

	if (room <= offC) {
		return noneMode(
			`Raum ${room.toFixed(1)} °C ≤ ${offC} °C — kein Cooling-Budget ohne Raummodell`,
		);
	}

	/* off < room < on: nähert sich der Grenze */
	const outdoorNowHot =
		input.outdoorTempC != null && input.outdoorTempC >= input.outdoorLikelyTempC;
	const outdoorUnfavorable =
		(futureMax != null && futureMax >= input.outdoorLikelyTempC) ||
		nWarm >= 0.25 ||
		outdoorNowHot;
	if (!outdoorUnfavorable) {
		return noneMode(
			`Raum ${room.toFixed(1)} °C unter ${onC} °C, Stundenforecast unkritisch`,
		);
	}
	const factor = outdoorDriveFactor(futureMax ?? input.outdoorTempC, input.outdoorLikelyTempC);
	const hours = capWithLearnedHours(remaining * factor * BOOTSTRAP_PREEMPT_FRACTION, remaining, null);
	return modeDemand(
		hours,
		`Raum ${room.toFixed(1)} °C nähert sich ${onC} °C, Forecast bis ${futureMax?.toFixed(1) ?? "?"} °C — vorsichtiges Pre-Cooling`,
		{ predictedPeak: futureMax },
	);
}

function bootstrapHeating(input: ClimatePredictiveInput, fromMs: number, toMs: number): ClimateModeDemand {
	if (!acModeCommandEnabled(input.unit.modeWhenHeating)) {
		return noneMode("Climate Heating nicht verfügbar.");
	}
	const setC = input.unit.heatSetpointC;
	const room = input.roomTempC;
	if (setC == null || !Number.isFinite(setC)) {
		return noneMode("Heating ohne Sollwert — kein Climate-Heizbedarf ableitbar.");
	}
	if (room == null) return noneMode("Raumtemperatur fehlt.");
	const hyst = Math.max(0.5, input.unit.onTempC - input.unit.offTempC);
	const remaining = input.remainingHours;
	const futureMin = futureOutdoorMinC(input.hourlyPoints, fromMs, toMs);
	const nCold = coldHoursInWindow(input.hourlyPoints, fromMs, toMs, setC);

	if (room <= setC) {
		const hours = input.hourlyPoints.length
			? capWithLearnedHours(Math.max(0.5, nCold > 0 ? nCold : remaining * 0.5), remaining, input.learnedHours)
			: capWithLearnedHours(remaining, remaining, input.learnedHours);
		return modeDemand(hours, `Raum ${room.toFixed(1)} °C ≤ Heizsoll ${setC} °C — aktueller Heizbedarf`, {
			predictedLow: room,
			predictedCrossingAtIso: input.now.toISOString(),
		});
	}
	if (room >= setC + hyst) {
		return noneMode(`Raum ${room.toFixed(1)} °C über Heizsoll ${setC} °C — kein Heating-Budget`);
	}
	const outdoorNowCold = input.outdoorTempC != null && input.outdoorTempC <= setC;
	const outdoorUnfavorable =
		(futureMin != null && futureMin <= setC) || nCold >= 0.25 || outdoorNowCold;
	if (!outdoorUnfavorable) {
		return noneMode(`Raum ${room.toFixed(1)} °C über Heizsoll, Stundenforecast unkritisch`);
	}
	const hours = capWithLearnedHours(Math.max(0.25, nCold * BOOTSTRAP_PREEMPT_FRACTION), remaining, null);
	return modeDemand(
		hours,
		`Raum ${room.toFixed(1)} °C nähert sich Heizsoll ${setC} °C, Forecast bis ${futureMin?.toFixed(1) ?? "?"} °C — vorsichtiges Pre-Heating`,
		{ predictedLow: futureMin },
	);
}

function bootstrapDry(input: ClimatePredictiveInput): ClimateModeDemand {
	const dryConfigured =
		acModeCommandEnabled(input.unit.modeWhenDehumidify) && input.unit.maxHumidityPct !== null;
	if (!dryConfigured) return noneMode("Entfeuchten nicht konfiguriert.");
	const maxH = input.unit.maxHumidityPct!;
	const hum = input.roomHumidityPct;
	if (hum == null) {
		return noneMode("Raumfeuchte fehlt — Dry ohne Learning nicht zukunftsprognostizierbar.");
	}
	if (hum >= maxH) {
		const hours = capWithLearnedHours(
			input.remainingHours * DRY_IMMEDIATE_REMAINING_FRACTION,
			input.remainingHours,
			input.learnedHours != null ? input.learnedHours * 0.5 : null,
		);
		return modeDemand(hours, `Feuchte ${hum.toFixed(0)} % ≥ ${maxH} % — aktueller Dry-Bedarf`, {
			predictedPeak: hum,
			predictedCrossingAtIso: input.now.toISOString(),
		});
	}
	const offH = Math.max(0, maxH - input.unit.humidityOffHysteresisPct);
	if (hum <= offH) {
		return noneMode(`Feuchte ${hum.toFixed(0)} % unter ${maxH} % — kein Dry-Budget ohne Feuchte-Learning`);
	}
	return noneMode(`Feuchte ${hum.toFixed(0)} % unter ${maxH} % — kein künstliches Dry-Budget`);
}

function predictiveCooling(input: ClimatePredictiveInput, fromMs: number, toMs: number): ClimateModeDemand | null {
	const thermal = input.thermal;
	const room = input.roomTempC;
	if (!thermal || room == null) return null;
	if (!statUsable(thermal.passive) || !statUsable(thermal.cooling) || thermal.cooling.rate == null) {
		return null;
	}
	if (!(Math.abs(thermal.cooling.rate) > 0.05)) return null;
	const sim = simulateRoomTemp({
		startRoomC: room,
		fromMs,
		toMs,
		points: input.hourlyPoints,
		passive: thermal,
		thresholdC: input.unit.onTempC,
		crossWhen: "above",
	});
	if (sim.crossingAtMs == null && sim.peak < input.unit.onTempC) {
		return modeDemand(0, `Predictive: keine Überschreitung ${input.unit.onTempC} °C (Peak ${sim.peak.toFixed(1)} °C)`, {
			predictedPeak: round2(sim.peak),
			predictedLow: round2(sim.low),
		});
	}
	const excess = Math.max(0, sim.peak - input.unit.offTempC, room - input.unit.offTempC);
	const hours = hoursFromDeltaK(excess, thermal.cooling.rate, input.remainingHours, input.learnedHours);
	return modeDemand(
		hours,
		`Predictive Kühlbedarf: Peak ${sim.peak.toFixed(1)} °C, Grenze ${input.unit.onTempC} °C`,
		{
			predictedPeak: round2(sim.peak),
			predictedLow: round2(sim.low),
			predictedCrossingAtIso: sim.crossingAtMs != null ? new Date(sim.crossingAtMs).toISOString() : input.now.toISOString(),
		},
	);
}

function predictiveHeating(input: ClimatePredictiveInput, fromMs: number, toMs: number): ClimateModeDemand | null {
	if (!acModeCommandEnabled(input.unit.modeWhenHeating)) {
		return noneMode("Climate Heating nicht verfügbar.");
	}
	const setC = input.unit.heatSetpointC;
	const thermal = input.thermal;
	const room = input.roomTempC;
	if (setC == null || thermal == null || room == null) return null;
	if (!statUsable(thermal.passive) || !statUsable(thermal.heating) || thermal.heating.rate == null) {
		return null;
	}
	if (!(Math.abs(thermal.heating.rate) > 0.05)) return null;
	const sim = simulateRoomTemp({
		startRoomC: room,
		fromMs,
		toMs,
		points: input.hourlyPoints,
		passive: thermal,
		thresholdC: setC,
		crossWhen: "below",
	});
	if (sim.crossingAtMs == null && sim.low > setC) {
		return modeDemand(0, `Predictive: keine Unterschreitung Heizsoll ${setC} °C (Tief ${sim.low.toFixed(1)} °C)`, {
			predictedLow: round2(sim.low),
			predictedPeak: round2(sim.peak),
		});
	}
	const deficit = Math.max(0, setC - sim.low, setC - room);
	const hours = hoursFromDeltaK(deficit, thermal.heating.rate, input.remainingHours, input.learnedHours);
	return modeDemand(hours, `Predictive Heizbedarf: Tief ${sim.low.toFixed(1)} °C, Soll ${setC} °C`, {
		predictedLow: round2(sim.low),
		predictedPeak: round2(sim.peak),
		predictedCrossingAtIso: sim.crossingAtMs != null ? new Date(sim.crossingAtMs).toISOString() : input.now.toISOString(),
	});
}

function predictiveDry(input: ClimatePredictiveInput): ClimateModeDemand | null {
	const dryConfigured =
		acModeCommandEnabled(input.unit.modeWhenDehumidify) && input.unit.maxHumidityPct !== null;
	if (!dryConfigured) return noneMode("Entfeuchten nicht konfiguriert.");
	const thermal = input.thermal;
	const hum = input.roomHumidityPct;
	const maxH = input.unit.maxHumidityPct!;
	if (!thermal || hum == null) return null;
	if (!statUsable(thermal.dehumidify.humidity) || thermal.dehumidify.humidity.rate == null) return null;
	const rate = thermal.dehumidify.humidity.rate;
	if (!(Math.abs(rate) > 0.2)) return null;
	if (hum >= maxH) {
		const excess = hum - Math.max(0, maxH - input.unit.humidityOffHysteresisPct);
		const hours = hoursFromDeltaK(excess, rate, input.remainingHours, input.learnedHours != null ? input.learnedHours * 0.5 : null);
		return modeDemand(hours, `Predictive Dry: Feuchte ${hum.toFixed(0)} % ≥ ${maxH} %`, {
			predictedPeak: hum,
			predictedCrossingAtIso: input.now.toISOString(),
		});
	}
	/* Kein passives Feuchte-Modell — zukünftige Überschreitung nicht erfinden. */
	return null;
}

export function estimateClimateUnitDemand(input: ClimatePredictiveInput): ClimateUnitDemandResult {
	const modes = availableAcModePurposes(input.unit);
	const remaining = input.remainingHours;
	const empty = (model: ClimateDemandModel, reason: string): ClimateUnitDemandResult => ({
		demandModel: model,
		fallbackReasonDe: reason,
		predictiveConfidence: null,
		cooling: noneMode(reason),
		heating: noneMode(
			acModeCommandEnabled(input.unit.modeWhenHeating) ? reason : "Climate Heating nicht verfügbar.",
		),
		dehumidify: noneMode(reason),
		reasonDe: reason,
	});

	if (remaining <= 0) {
		return empty("legacy_fallback", "Außerhalb Zeitfenster.");
	}
	if (modes.length === 0) {
		return empty("legacy_fallback", "Kein Climate-Modus verfügbar.");
	}

	const fromMs = input.now.getTime();
	const toMs = input.windowEndMs;
	const inWindow = hourlyPointsInWindow(input.hourlyPoints ?? [], fromMs, toMs);
	const coverage = hourlyCoverage(inWindow, fromMs, toMs);
	const thermal = input.thermal ?? null;
	const coolingEnabled = acModeCommandEnabled(input.unit.modeWhenCooling);
	const heatingEnabled = acModeCommandEnabled(input.unit.modeWhenHeating);
	const dryEnabled =
		acModeCommandEnabled(input.unit.modeWhenDehumidify) && input.unit.maxHumidityPct !== null;

	const passiveOk = thermal != null && statUsable(thermal.passive);
	const coolingLearnOk = coolingEnabled && thermal != null && statUsable(thermal.cooling);
	const heatingLearnOk = heatingEnabled && thermal != null && statUsable(thermal.heating);
	const dryLearnOk = dryEnabled && thermal != null && statUsable(thermal.dehumidify.humidity);
	const hourlyOk = coverage >= PREDICTIVE_HOURLY_COVERAGE;
	const roomOk = input.roomTempC != null && Number.isFinite(input.roomTempC);

	const canPredictCooling = coolingEnabled && passiveOk && coolingLearnOk && roomOk && hourlyOk;
	const canPredictHeating = heatingEnabled && passiveOk && heatingLearnOk && roomOk && hourlyOk && input.unit.heatSetpointC != null;
	const canPredictDry = dryEnabled && dryLearnOk && input.roomHumidityPct != null;

	const missingRoomAndNeedTemp = !roomOk && (coolingEnabled || heatingEnabled);

	/* Sensor-/Forecast-Ausfall für Temperaturpfade ohne aktuellen Raumwert → Legacy. */
	if (missingRoomAndNeedTemp && !canPredictDry) {
		const cooling = coolingEnabled ? legacyCooling(input) : noneMode("Climate Cooling nicht verfügbar.");
		const heating = noneMode(
			heatingEnabled ? "Raumtemperatur fehlt — kein Heating ohne Sensor." : "Climate Heating nicht verfügbar.",
		);
		const dehumidify = dryEnabled ? legacyDry(input, true) : noneMode("Entfeuchten nicht konfiguriert.");
		return {
			demandModel: "legacy_fallback",
			fallbackReasonDe: "Raumtemperatur fehlt — Legacy-Heuristik.",
			predictiveConfidence: null,
			cooling,
			heating,
			dehumidify,
			reasonDe: "Legacy-Fallback: Raumtemperatur fehlt.",
		};
	}

	let cooling: ClimateModeDemand;
	let heating: ClimateModeDemand;
	let dehumidify: ClimateModeDemand;
	let demandModel: ClimateDemandModel = "bootstrap";
	let fallbackReasonDe: string | null = null;
	let predictiveConfidence: number | null = null;

	if (canPredictCooling) {
		cooling = predictiveCooling(input, fromMs, toMs) ?? bootstrapCooling(input, fromMs, toMs);
	} else if (coolingEnabled && roomOk) {
		cooling = bootstrapCooling(input, fromMs, toMs);
	} else if (coolingEnabled) {
		cooling = legacyCooling(input);
	} else {
		cooling = noneMode("Climate Cooling nicht verfügbar.");
	}

	if (canPredictHeating) {
		heating = predictiveHeating(input, fromMs, toMs) ?? bootstrapHeating(input, fromMs, toMs);
	} else if (heatingEnabled && roomOk) {
		heating = bootstrapHeating(input, fromMs, toMs);
	} else if (!heatingEnabled) {
		heating = noneMode("Climate Heating nicht verfügbar.");
	} else {
		heating = noneMode("Heating ohne belastbare Raumdaten — kein Climate-Heizbedarf.");
	}

	if (canPredictDry) {
		dehumidify = predictiveDry(input) ?? bootstrapDry(input);
	} else if (dryEnabled) {
		dehumidify = bootstrapDry(input);
	} else {
		dehumidify = noneMode("Entfeuchten nicht konfiguriert.");
	}

	if (canPredictCooling || canPredictHeating || (canPredictDry && dehumidify.reasonDe.startsWith("Predictive"))) {
		const confs: number[] = [];
		if (canPredictCooling && thermal) {
			confs.push(thermal.passive.confidence, thermal.cooling.confidence);
		}
		if (canPredictHeating && thermal) {
			confs.push(thermal.passive.confidence, thermal.heating.confidence);
		}
		if (canPredictDry && thermal && dehumidify.reasonDe.startsWith("Predictive")) {
			confs.push(thermal.dehumidify.humidity.confidence);
		}
		if (confs.length && (canPredictCooling || canPredictHeating || dehumidify.reasonDe.startsWith("Predictive"))) {
			demandModel = "predictive";
			predictiveConfidence = Math.min(...confs);
		}
	}

	if (demandModel !== "predictive") {
		if (thermal && (thermal.passive.sampleCount > 0 || thermal.cooling.sampleCount > 0) && !passiveOk) {
			fallbackReasonDe = "Learning noch nicht usable — Bootstrap.";
		} else if (!thermal) {
			fallbackReasonDe = "Kein Thermal-Learning — Bootstrap.";
		} else if (!hourlyOk && roomOk) {
			fallbackReasonDe = "Stundenforecast unzureichend — Bootstrap ohne Zukunftskurve.";
		} else {
			fallbackReasonDe = "Bootstrap (Konfiguration + Ist + Forecast).";
		}
		demandModel = "bootstrap";
	}

	const parts = [cooling, heating, dehumidify].filter((m) => m.likelyActive).map((m) => m.reasonDe);
	return {
		demandModel,
		fallbackReasonDe,
		predictiveConfidence,
		cooling,
		heating,
		dehumidify,
		reasonDe: parts.length ? parts.join("; ") : "Kein Climate-Bedarf.",
	};
}

export function climateWindowEndMs(now: Date, remainingHours: number): number {
	return now.getTime() + Math.max(0, remainingHours) * 3_600_000;
}

export function climateDemandDigest(input: {
	units: Array<{ unitIndex: number; roomTempC: number | null; expectedKwh: number; demandModel?: string }>;
}): string {
	return input.units
		.map((u) => {
			const room = u.roomTempC == null ? "x" : String(Math.round(u.roomTempC * 2) / 2);
			const kwh = Math.round(u.expectedKwh * 5) / 5;
			return `${u.unitIndex}:${room}:${kwh}:${u.demandModel ?? ""}`;
		})
		.join("|");
}
