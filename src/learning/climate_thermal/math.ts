/**
 * Empirisches Climate-Thermal-Learning aus Day-Telemetry.
 * Keine physikalischen Konstanten, keine erfundenen 0-Werte, keine Steuerung.
 */

import { DAY_TELEMETRY_SLOT_MS } from "../day_telemetry/constants";
import { normalizeClimateModePurpose } from "../day_telemetry/climate_unit_slots";
import type {
	ClimateRunSegment,
	ClimateUnitSlotSample,
	DayTelemetryDayRecord,
} from "../day_telemetry/types";
import {
	emptyEffectStat,
	emptyPassiveStat,
	type ClimateThermalEffectStat,
	type ClimateThermalPassiveStat,
	type ClimateThermalStatus,
	type ClimateThermalUnitModel,
} from "./types";

/** Passive Abschnitte: mindestens 30 Minuten zusammenhängend. */
export const CLIMATE_THERMAL_MIN_PASSIVE_SEC = 1800;
/** Aktive Segmente: mindestens 15 Minuten. */
export const CLIMATE_THERMAL_MIN_ACTIVE_SEC = 900;
/** Trägheit: 20–90 Minuten nach Climate-Ende. */
export const CLIMATE_THERMAL_INERTIA_MIN_SEC = 1200;
export const CLIMATE_THERMAL_INERTIA_MAX_SEC = 5400;
/** Slot-Abstand für passive Ketten. */
export const CLIMATE_THERMAL_SLOT_GAP_MIN_SEC = 300;
export const CLIMATE_THERMAL_SLOT_GAP_MAX_SEC = 2100;
/** Offensichtlicher Messsprung in 15 Min. */
export const CLIMATE_THERMAL_MAX_JUMP_K = 4;
export const CLIMATE_THERMAL_MAX_JUMP_RH = 15;
/** Konservative Freigabe — nicht nach 2–3 Samples. */
export const CLIMATE_THERMAL_MIN_SAMPLES = 8;
export const CLIMATE_THERMAL_TARGET_SAMPLES = 24;
export const CLIMATE_THERMAL_MIN_CONFIDENCE_USABLE = 0.45;
export const CLIMATE_THERMAL_MAX_IQR_TEMP_K_PER_H = 1.5;
export const CLIMATE_THERMAL_MAX_IQR_RH_PER_H = 8;
export const CLIMATE_THERMAL_FRESHNESS_FULL_DAYS = 30;
export const CLIMATE_THERMAL_FRESHNESS_ZERO_DAYS = 90;

export type ClimateThermalRateSample = {
	rate: number;
	durationSec: number;
	endTs: number;
	solo: boolean;
	outdoorMeanC: number | null;
	override: boolean;
};

function quantile(sortedAsc: number[], q: number): number {
	if (sortedAsc.length === 0) return 0;
	if (sortedAsc.length === 1) return sortedAsc[0]!;
	const pos = (sortedAsc.length - 1) * q;
	const base = Math.floor(pos);
	const rest = pos - base;
	if (base + 1 < sortedAsc.length) {
		return sortedAsc[base]! + rest * (sortedAsc[base + 1]! - sortedAsc[base]!);
	}
	return sortedAsc[base]!;
}

export function trimOutliersIqr(values: number[]): number[] {
	if (values.length < 4) return values;
	const sorted = [...values].sort((a, b) => a - b);
	const q1 = quantile(sorted, 0.25);
	const q3 = quantile(sorted, 0.75);
	const iqr = q3 - q1;
	if (!(iqr > 0)) return values;
	const lo = q1 - 1.5 * iqr;
	const hi = q3 + 1.5 * iqr;
	const kept = values.filter((v) => v >= lo && v <= hi);
	return kept.length > 0 ? kept : values;
}

function median(values: number[]): number | null {
	if (values.length === 0) return null;
	const sorted = [...values].sort((a, b) => a - b);
	return quantile(sorted, 0.5);
}

function round3(n: number): number {
	return Math.round(n * 1000) / 1000;
}

function confidenceFrom(sampleCount: number, ageDays: number | null, spreadFactor: number): number {
	if (sampleCount <= 0) return 0;
	const sampleFactor =
		sampleCount < CLIMATE_THERMAL_MIN_SAMPLES
			? (sampleCount / CLIMATE_THERMAL_MIN_SAMPLES) * 0.35
			: Math.min(1, sampleCount / CLIMATE_THERMAL_TARGET_SAMPLES);
	let freshness = 1;
	if (ageDays != null && ageDays > CLIMATE_THERMAL_FRESHNESS_FULL_DAYS) {
		const span = CLIMATE_THERMAL_FRESHNESS_ZERO_DAYS - CLIMATE_THERMAL_FRESHNESS_FULL_DAYS;
		freshness = Math.max(0, 1 - (ageDays - CLIMATE_THERMAL_FRESHNESS_FULL_DAYS) / span);
	}
	return Math.round(sampleFactor * freshness * spreadFactor * 100) / 100;
}

function finishEffect(
	samples: ClimateThermalRateSample[],
	nowMs: number,
	kind: "temp" | "humidity",
	unavailable: boolean,
	unavailableReason: string,
	notEnoughReason: string,
): ClimateThermalEffectStat {
	const lastRunIso = new Date(nowMs).toISOString();
	if (unavailable) {
		return emptyEffectStat("unavailable", unavailableReason, lastRunIso);
	}
	const auto = samples.filter((s) => !s.override);
	if (auto.length === 0) {
		return emptyEffectStat("not_evaluable", notEnoughReason, lastRunIso);
	}
	const trimmed = trimOutliersIqr(auto.map((s) => s.rate));
	const rates = trimmed;
	const sampleCount = rates.length;
	const usableDurationSec = auto.reduce((a, s) => a + s.durationSec, 0);
	const lastTs = auto.reduce((m, s) => Math.max(m, s.endTs), 0);
	const ageDays = lastTs > 0 ? Math.max(0, Math.round((nowMs - lastTs) / 86_400_000)) : null;
	const sorted = [...rates].sort((a, b) => a - b);
	const iqr = sampleCount > 0 ? quantile(sorted, 0.75) - quantile(sorted, 0.25) : null;
	const maxIqr = kind === "temp" ? CLIMATE_THERMAL_MAX_IQR_TEMP_K_PER_H : CLIMATE_THERMAL_MAX_IQR_RH_PER_H;
	const spreadWide = iqr != null && iqr > maxIqr;
	const spreadFactor = spreadWide ? 0.55 : 1;
	const confidence = confidenceFrom(sampleCount, ageDays, spreadFactor);
	const rate = median(rates);
	const usable =
		sampleCount >= CLIMATE_THERMAL_MIN_SAMPLES &&
		confidence >= CLIMATE_THERMAL_MIN_CONFIDENCE_USABLE &&
		!spreadWide &&
		rate != null;
	let status: ClimateThermalStatus = "not_evaluable";
	let reasonDe = notEnoughReason;
	if (usable) {
		status = "ok";
		reasonDe = `${sampleCount} belastbare Samples, Rate ${round3(rate!)} /h.`;
	} else if (sampleCount >= CLIMATE_THERMAL_MIN_SAMPLES && spreadWide) {
		reasonDe = `Zu große Streuung (IQR ${round3(iqr!)} /h) — nicht usable.`;
	} else if (sampleCount > 0) {
		reasonDe = `Zu wenig Samples (${sampleCount}/${CLIMATE_THERMAL_MIN_SAMPLES}) — nicht usable.`;
	}
	return {
		sampleCount,
		usableDurationSec,
		rate: rate != null ? round3(rate) : null,
		spread: iqr != null ? round3(iqr) : null,
		confidence,
		usable,
		status,
		reasonDe,
		lastRunIso,
		soloSampleCount: auto.filter((s) => s.solo).length,
		sharedSampleCount: auto.filter((s) => !s.solo).length,
	};
}

function comboSolo(combo: string | null | undefined): boolean {
	if (!combo || combo === "none") return true;
	return !combo.includes("+");
}

function slotAt(day: DayTelemetryDayRecord, index: number): ClimateUnitSlotSample[] | null {
	const slots = day.buckets.climateUnitSlots;
	if (!Array.isArray(slots) || index < 0 || index >= slots.length) return null;
	return slots[index];
}

function unitInSlot(slots: ClimateUnitSlotSample[] | null, unitIndex: number): ClimateUnitSlotSample | null {
	if (!slots) return null;
	return slots.find((s) => s.unitIndex === unitIndex) ?? null;
}

function plausibleJump(prev: number, next: number, maxAbs: number): boolean {
	return Math.abs(next - prev) <= maxAbs;
}

export function collectPassiveTempSamples(
	days: DayTelemetryDayRecord[],
	unitIndex: number,
): ClimateThermalRateSample[] {
	const out: ClimateThermalRateSample[] = [];
	for (const day of days) {
		const n = day.slotCount;
		let i = 0;
		while (i < n) {
			const first = unitInSlot(slotAt(day, i), unitIndex);
			if (
				!first ||
				first.running !== false ||
				first.roomTempC == null ||
				first.modePurpose === "cooling" ||
				first.modePurpose === "heating" ||
				first.modePurpose === "dehumidify"
			) {
				i += 1;
				continue;
			}
			let last = first;
			let lastIdx = i;
			let override = first.overrideActive === true;
			let outdoorSum = first.roomTempC != null && day.buckets.outdoorTempC?.[i] != null ? 1 : 0;
			let outdoorAcc = day.buckets.outdoorTempC?.[i] ?? 0;
			let rejected = false;
			let j = i + 1;
			for (; j < n; j++) {
				const cur = unitInSlot(slotAt(day, j), unitIndex);
				if (
					!cur ||
					cur.running !== false ||
					cur.roomTempC == null ||
					cur.modePurpose === "cooling" ||
					cur.modePurpose === "heating" ||
					cur.modePurpose === "dehumidify"
				) {
					break;
				}
				const dtSec = ((day.startMs + j * DAY_TELEMETRY_SLOT_MS) - (day.startMs + lastIdx * DAY_TELEMETRY_SLOT_MS)) / 1000;
				if (dtSec < CLIMATE_THERMAL_SLOT_GAP_MIN_SEC || dtSec > CLIMATE_THERMAL_SLOT_GAP_MAX_SEC) {
					break;
				}
				if (!plausibleJump(last.roomTempC!, cur.roomTempC, CLIMATE_THERMAL_MAX_JUMP_K)) {
					rejected = true;
					break;
				}
				if (cur.overrideActive === true) override = true;
				const outC = day.buckets.outdoorTempC?.[j];
				if (outC != null) {
					outdoorSum += 1;
					outdoorAcc += outC;
				}
				last = cur;
				lastIdx = j;
			}
			const durationSec = ((lastIdx - i) * DAY_TELEMETRY_SLOT_MS) / 1000;
			if (!rejected && durationSec >= CLIMATE_THERMAL_MIN_PASSIVE_SEC && last.roomTempC != null && first.roomTempC != null) {
				const hours = durationSec / 3600;
				if (hours > 0) {
					out.push({
						rate: (last.roomTempC - first.roomTempC) / hours,
						durationSec,
						endTs: day.startMs + (lastIdx + 1) * DAY_TELEMETRY_SLOT_MS,
						solo: true,
						outdoorMeanC: outdoorSum > 0 ? outdoorAcc / outdoorSum : null,
						override,
					});
				}
			}
			i = Math.max(j, i + 1);
		}
	}
	return out;
}

function segmentModePurpose(mode: string): "cooling" | "heating" | "dehumidify" | "off" | "unknown" {
	return normalizeClimateModePurpose(mode);
}

export function collectActiveTempSamples(
	days: DayTelemetryDayRecord[],
	unitIndex: number,
	purpose: "cooling" | "heating" | "dehumidify",
): ClimateThermalRateSample[] {
	const out: ClimateThermalRateSample[] = [];
	for (const day of days) {
		for (const seg of day.climateRunSegments ?? []) {
			if (segmentModePurpose(seg.mode) !== purpose) continue;
			if (seg.activeUnitCombination === "none") continue;
			if (seg.runtimeSec < CLIMATE_THERMAL_MIN_ACTIVE_SEC) continue;
			const obs = (seg.unitObservations ?? []).find((o) => o.unitIndex === unitIndex);
			if (!obs || obs.roomTempStartC == null || obs.roomTempEndC == null) continue;
			const hours = seg.runtimeSec / 3600;
			if (!(hours > 0)) continue;
			const dT = obs.roomTempEndC - obs.roomTempStartC;
			if (Math.abs(dT) / Math.max(hours, 0.25) > (CLIMATE_THERMAL_MAX_JUMP_K * 4)) {
				/* extremer Sprung über die Segmentlänge — nicht als Wirkung werten */
				continue;
			}
			out.push({
				rate: dT / hours,
				durationSec: seg.runtimeSec,
				endTs: seg.endTs,
				solo: comboSolo(seg.activeUnitCombination),
				outdoorMeanC:
					seg.outdoorTempStartC != null && seg.outdoorTempEndC != null
						? (seg.outdoorTempStartC + seg.outdoorTempEndC) / 2
						: (seg.outdoorTempStartC ?? seg.outdoorTempEndC ?? null),
				override: obs.overrideActive === true || seg.overrideActive === true,
			});
		}
	}
	return out;
}

export function collectDehumidifyHumiditySamples(
	days: DayTelemetryDayRecord[],
	unitIndex: number,
): ClimateThermalRateSample[] {
	const out: ClimateThermalRateSample[] = [];
	for (const day of days) {
		for (const seg of day.climateRunSegments ?? []) {
			if (segmentModePurpose(seg.mode) !== "dehumidify") continue;
			if (seg.runtimeSec < CLIMATE_THERMAL_MIN_ACTIVE_SEC) continue;
			const obs = (seg.unitObservations ?? []).find((o) => o.unitIndex === unitIndex);
			if (!obs || obs.roomHumidityStartPct == null || obs.roomHumidityEndPct == null) continue;
			const hours = seg.runtimeSec / 3600;
			if (!(hours > 0)) continue;
			const dH = obs.roomHumidityEndPct - obs.roomHumidityStartPct;
			if (Math.abs(dH) / Math.max(hours, 0.25) > CLIMATE_THERMAL_MAX_JUMP_RH * 4) continue;
			out.push({
				rate: dH / hours,
				durationSec: seg.runtimeSec,
				endTs: seg.endTs,
				solo: comboSolo(seg.activeUnitCombination),
				outdoorMeanC: null,
				override: obs.overrideActive === true || seg.overrideActive === true,
			});
		}
	}
	return out;
}

/**
 * Residualrate in der ersten Stunde nach einem aktiven Segment — nur wenn messbar.
 * Keine erzwungene Zeitkonstante.
 */
export function collectInertiaSamples(
	days: DayTelemetryDayRecord[],
	unitIndex: number,
): ClimateThermalRateSample[] {
	const out: ClimateThermalRateSample[] = [];
	for (const day of days) {
		const segs = (day.climateRunSegments ?? []).filter((s) => {
			const p = segmentModePurpose(s.mode);
			return (p === "cooling" || p === "heating" || p === "dehumidify") && s.runtimeSec >= CLIMATE_THERMAL_MIN_ACTIVE_SEC;
		});
		for (const seg of segs) {
			const obs = (seg.unitObservations ?? []).find((o) => o.unitIndex === unitIndex);
			const startTemp = obs?.roomTempEndC;
			if (startTemp == null) continue;
			const startSlot = Math.floor((seg.endTs - day.startMs) / DAY_TELEMETRY_SLOT_MS);
			if (startSlot < 0 || startSlot >= day.slotCount) continue;
			let endSlot = -1;
			let endTemp: number | null = null;
			let override = obs?.overrideActive === true || seg.overrideActive === true;
			for (let i = startSlot; i < day.slotCount; i++) {
				const elapsed = ((i - startSlot) * DAY_TELEMETRY_SLOT_MS) / 1000;
				if (elapsed > CLIMATE_THERMAL_INERTIA_MAX_SEC) break;
				const cur = unitInSlot(slotAt(day, i), unitIndex);
				if (!cur || cur.running === true) break;
				if (cur.roomTempC == null) continue;
				if (elapsed >= CLIMATE_THERMAL_INERTIA_MIN_SEC) {
					endSlot = i;
					endTemp = cur.roomTempC;
					if (cur.overrideActive === true) override = true;
				}
			}
			if (endSlot < 0 || endTemp == null) continue;
			const durationSec = ((endSlot - startSlot) * DAY_TELEMETRY_SLOT_MS) / 1000;
			if (durationSec < CLIMATE_THERMAL_INERTIA_MIN_SEC) continue;
			const hours = durationSec / 3600;
			if (!(hours > 0)) continue;
			if (!plausibleJump(startTemp, endTemp, CLIMATE_THERMAL_MAX_JUMP_K * 3)) continue;
			out.push({
				rate: (endTemp - startTemp) / hours,
				durationSec,
				endTs: day.startMs + (endSlot + 1) * DAY_TELEMETRY_SLOT_MS,
				solo: comboSolo(seg.activeUnitCombination),
				outdoorMeanC: null,
				override,
			});
		}
	}
	return out;
}

export type ClimateThermalUnitAvailability = {
	unitIndex: number;
	enabled: boolean;
	modesAvailable: Array<"cooling" | "heating" | "dehumidify">;
};

function finishPassive(
	samples: ClimateThermalRateSample[],
	nowMs: number,
): ClimateThermalPassiveStat {
	const base = finishEffect(
		samples,
		nowMs,
		"temp",
		false,
		"",
		"Passive Raumdynamik noch nicht auswertbar (zu wenig Climate-AUS-Abschnitte).",
	);
	const auto = samples.filter((s) => !s.override);
	const warming = median(auto.filter((s) => s.rate > 0).map((s) => s.rate));
	const cooling = median(auto.filter((s) => s.rate < 0).map((s) => s.rate));
	return {
		...base,
		warmingRateKPerH: warming != null ? round3(warming) : null,
		coolingRateKPerH: cooling != null ? round3(cooling) : null,
	};
}

export function computeClimateThermalUnitModel(
	days: DayTelemetryDayRecord[],
	availability: ClimateThermalUnitAvailability,
	nowMs: number,
): ClimateThermalUnitModel {
	const unitIndex = availability.unitIndex;
	const lastRunIso = new Date(nowMs).toISOString();
	const hasCooling = availability.modesAvailable.includes("cooling");
	const hasHeating = availability.modesAvailable.includes("heating");
	const hasDry = availability.modesAvailable.includes("dehumidify");

	const passiveSamples = collectPassiveTempSamples(days, unitIndex);
	const coolingSamples = collectActiveTempSamples(days, unitIndex, "cooling");
	const heatingSamples = collectActiveTempSamples(days, unitIndex, "heating");
	const dryTempSamples = collectActiveTempSamples(days, unitIndex, "dehumidify");
	const dryHumSamples = collectDehumidifyHumiditySamples(days, unitIndex);
	const inertiaSamples = collectInertiaSamples(days, unitIndex);

	const passive = finishPassive(passiveSamples, nowMs);
	const cooling = finishEffect(
		coolingSamples,
		nowMs,
		"temp",
		!hasCooling && coolingSamples.length === 0,
		"Climate Cooling nicht verfügbar — nicht auswertbar.",
		"Cooling-Wirkung noch nicht auswertbar.",
	);
	const heating = finishEffect(
		heatingSamples,
		nowMs,
		"temp",
		!hasHeating && heatingSamples.length === 0,
		"Climate Heating nicht verfügbar — nicht auswertbar.",
		"Heating-Wirkung noch nicht auswertbar.",
	);
	const dehumidifyTemp = finishEffect(
		dryTempSamples,
		nowMs,
		"temp",
		!hasDry && dryTempSamples.length === 0,
		"Climate Dehumidify nicht verfügbar — nicht auswertbar.",
		"Dehumidify-Temperaturwirkung noch nicht auswertbar.",
	);
	const dehumidifyHumidity = finishEffect(
		dryHumSamples,
		nowMs,
		"humidity",
		!hasDry && dryHumSamples.length === 0,
		"Climate Dehumidify nicht verfügbar — nicht auswertbar.",
		"Dehumidify-Feuchtewirkung noch nicht auswertbar.",
	);
	const inertia = finishEffect(
		inertiaSamples,
		nowMs,
		"temp",
		false,
		"",
		"Trägheit nicht auswertbar — zu wenig belastbare Nachlauf-Abschnitte.",
	);
	if (inertia.sampleCount < CLIMATE_THERMAL_MIN_SAMPLES) {
		inertia.status = "not_evaluable";
		inertia.usable = false;
		inertia.reasonDe = "Trägheit nicht auswertbar — zu wenig belastbare Nachlauf-Abschnitte.";
	}

	const bits: string[] = [];
	if (passive.usable) bits.push("passiv usable");
	if (cooling.usable) bits.push("cooling usable");
	if (heating.usable) bits.push("heating usable");
	if (dehumidifyHumidity.usable || dehumidifyTemp.usable) bits.push("dehumidify teilw. usable");
	if (heating.status === "unavailable") bits.push("heating unavailable");
	const reasonDe =
		bits.length > 0
			? `Unit ${unitIndex}: ${bits.join(", ")}.`
			: `Unit ${unitIndex}: sammelt noch, kein Modell usable.`;

	return {
		unitIndex,
		passive,
		cooling,
		heating,
		dehumidify: { temp: dehumidifyTemp, humidity: dehumidifyHumidity },
		inertia,
		reasonDe,
		lastRunIso,
	};
}

export function computeClimateThermalModels(
	days: DayTelemetryDayRecord[],
	units: ClimateThermalUnitAvailability[],
	nowMs: number,
): Record<string, ClimateThermalUnitModel> {
	const out: Record<string, ClimateThermalUnitModel> = {};
	for (const u of units) {
		if (!u.enabled && !days.some((d) => (d.buckets.climateUnitSlots ?? []).some((s) => s?.some((x) => x.unitIndex === u.unitIndex)))) {
			continue;
		}
		out[String(u.unitIndex)] = computeClimateThermalUnitModel(days, u, nowMs);
	}
	return out;
}

/** Für Tests: Segment-Hilfsbauer. */
export function thermalTestSegment(
	overrides: Partial<ClimateRunSegment> & { unitIndex?: number } = {},
): ClimateRunSegment {
	const unitIndex = overrides.unitIndex ?? 1;
	return {
		startTs: overrides.startTs ?? 1_000,
		endTs: overrides.endTs ?? 1_000 + 1_800_000,
		sharedPowerGroupId: overrides.sharedPowerGroupId ?? "outdoor_1",
		mode: overrides.mode ?? "cooling",
		activeUnitCombination: overrides.activeUnitCombination ?? "1",
		energyKwh: overrides.energyKwh ?? 0.35,
		runtimeSec: overrides.runtimeSec ?? 1800,
		valid: overrides.valid ?? true,
		rejectReason: overrides.rejectReason ?? null,
		outdoorTempStartC: overrides.outdoorTempStartC ?? 30,
		outdoorTempEndC: overrides.outdoorTempEndC ?? 31,
		unitObservations: overrides.unitObservations ?? [
			{
				unitIndex,
				roomTempStartC: 27,
				roomTempEndC: 25.5,
				roomHumidityStartPct: 55,
				roomHumidityEndPct: 54,
				ownershipOwner: "ems",
				overrideActive: false,
			},
		],
		ownershipOwner: overrides.ownershipOwner ?? "ems",
		overrideActive: overrides.overrideActive ?? false,
		thermalUsable: overrides.thermalUsable ?? true,
		thermalRejectReason: overrides.thermalRejectReason ?? null,
	};
}
