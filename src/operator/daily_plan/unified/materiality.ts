/**
 * Plan-vs-Actual Materiality — kleine, nachvollziehbare Schwellen.
 * Wiederverwendet die AI-Digest-Bucket-Größen wo sinnvoll (PV 2 kWh, Preis 5 ct).
 */

import {
	AI_TRIGGER_PRICE_MEDIAN_BUCKET_CT,
	AI_TRIGGER_PV_BUCKET_KWH,
} from "../../../ai/trigger_digest";
import { REASON } from "./reason_codes";

/** Hauslast-Tagesabweichung / kumuliert — grober als AI-Flex-Bucket. */
export const MATERIAL_HOUSE_LOAD_KWH = 1.5;
/** Batterie-SOC-Abweichung in Prozentpunkten. */
export const MATERIAL_BATTERY_SOC_PP = 5;
/** Thermischer Headroom-Wechsel (kWh), der Replan rechtfertigt. */
export const MATERIAL_THERMAL_HEADROOM_KWH = 0.5;
/** Temperatur-Delta (°C) als Zusatzsignal. */
export const MATERIAL_THERMAL_TEMP_K = 2;
/** Fahrzeug-Energiebedarf-Änderung (kWh). */
export const MATERIAL_VEHICLE_ENERGY_KWH = 1;
/** Anti-Chatter-Cooldown nachts (21–06 Uhr lokal). */
export const REPLAN_COOLDOWN_NIGHT_MS = 5 * 60_000;
/** Anti-Chatter-Cooldown tagsüber (06–21 Uhr lokal) — häufiger für Live-PV-Reaktion. */
export const REPLAN_COOLDOWN_DAY_MS = 60_000;
/** @deprecated Verwende REPLAN_COOLDOWN_DAY_MS / REPLAN_COOLDOWN_NIGHT_MS. */
export const REPLAN_COOLDOWN_MS = REPLAN_COOLDOWN_DAY_MS;

/** Lokale Stunde aus UTC-Timestamp + Offset-Minuten (Fallback ohne Timezone-Lib). */
function localHourFromMs(nowMs: number, offsetMinutes: number): number {
	return new Date(nowMs + offsetMinutes * 60_000).getUTCHours();
}

/**
 * Gibt den passenden Cooldown zurück: tagsüber (06–21 lokal) 1 Minute, nachts 5 Minuten.
 * offsetMinutes: Offset der lokalen Zeitzone in Minuten (z. B. 120 für CEST).
 */
export function replanCooldownMs(nowMs: number, timezoneOffsetMinutes: number): number {
	const localHour = localHourFromMs(nowMs, timezoneOffsetMinutes);
	return localHour >= 6 && localHour < 21 ? REPLAN_COOLDOWN_DAY_MS : REPLAN_COOLDOWN_NIGHT_MS;
}

export type PlanBaseline = {
	date: string;
	planId: string;
	generation: number;
	createdAtMs: number;
	expectedPvDayKwh: number | null;
	/** Bereits realisierte PV zum Planungszeitpunkt (kWh), falls bekannt. */
	realizedPvKwhAtPlan: number | null;
	expectedHouseLoadDayKwh: number | null;
	batterySocPct: number | null;
	thermalHeadroomKwh: number | null;
	bufferTempC: number | null;
	/** Boiler-emptyAt ISO — Replan wenn neu oder stark verschoben. */
	thermalEmptyAtIso: string | null;
	acMandatoryAny: boolean;
	vehicleConnected: boolean | null;
	vehicleRequiredEnergyKwh: number | null;
	vehicleDeadlineIso: string | null;
	vehicleTargetSocPct: number | null;
	priceMedianCt: number | null;
	/** Preisstruktur (Median + Lage günstiger/teurer Fenster). */
	priceStructureDigest: string;
	/** Future Presence Digest (Status/Quellen der Fenster). */
	presenceDigest: string;
	cadenceDigest: string;
	/**
	 * BLOCK B (additiv, optional): Digest der Intent-Engine Manual-Override-Flags
	 * (battery/thermal/wallbox). Änderung (User/External greift ein oder gibt frei) → harter
	 * Replan, damit der Plan die reale Kontrolle widerspiegelt, statt gegen den Override zu
	 * planen. Reine Zustands-Zusammenfassung, keine Kontrolllogik hier. Optional, damit
	 * bestehende Aufrufer/Tests ohne diesen Wert unverändert funktionieren (Fallback "").
	 */
	userOverrideDigest?: string;
};

export type PlanActualSample = {
	date: string;
	nowMs: number;
	/** Aktuelle korrigierte PV-Tagesprognose (Rest+bisher als Tageswert). */
	forecastPvDayKwh: number | null;
	/** Realisierte PV heute, falls vorhanden; sonst null. */
	realizedPvKwh: number | null;
	forecastHouseLoadDayKwh: number | null;
	batterySocPct: number | null;
	thermalHeadroomKwh: number | null;
	bufferTempC: number | null;
	/** Boiler-emptyAt ISO — Replan wenn neu oder stark verschoben. */
	thermalEmptyAtIso: string | null;
	acMandatoryAny: boolean;
	vehicleConnected: boolean | null;
	vehicleRequiredEnergyKwh: number | null;
	vehicleDeadlineIso: string | null;
	vehicleTargetSocPct: number | null;
	priceMedianCt: number | null;
	priceStructureDigest: string;
	presenceDigest: string;
	/** Thermal/AC Safety — Headroom bewusst 0 / blocked. */
	thermalBlocked: boolean;
	cadenceDigest: string;
	/** BLOCK B (additiv, optional): siehe `PlanBaseline.userOverrideDigest`. */
	userOverrideDigest?: string;
};

export type MaterialReplanDecision = {
	shouldReplan: boolean;
	reasons: string[];
	/** Harte Events umgehen Cooldown. */
	hard: boolean;
};

/** emptyAt auf 2h-Bucket — Minuten-Drift aus Newton nicht jeden Tick replanen. */
export function thermalEmptyAtBucket(iso: string | null | undefined): string {
	if (!iso || !iso.trim()) return "";
	const ms = Date.parse(iso);
	if (!Number.isFinite(ms)) return "";
	return String(Math.floor(ms / (2 * 3600_000)));
}

function absDiff(a: number | null, b: number | null): number | null {
	if (a === null || b === null || !Number.isFinite(a) || !Number.isFinite(b)) return null;
	return Math.abs(a - b);
}

/**
 * PV-Revision-Kontext: previous expected, neu, realisiert, Rest.
 * Vermeidet „neuer Tag = Summe“-Fehlinterpretation.
 */
export function pvRevisionContext(baseline: PlanBaseline, actual: PlanActualSample): {
	previousExpectedDayKwh: number | null;
	newExpectedDayKwh: number | null;
	realizedKwh: number | null;
	remainingExpectedKwh: number | null;
} {
	const previousExpectedDayKwh = baseline.expectedPvDayKwh;
	const newExpectedDayKwh = actual.forecastPvDayKwh;
	const realizedKwh = actual.realizedPvKwh;
	let remainingExpectedKwh: number | null = null;
	if (newExpectedDayKwh !== null && realizedKwh !== null) {
		remainingExpectedKwh = Math.max(0, newExpectedDayKwh - realizedKwh);
	} else if (newExpectedDayKwh !== null && baseline.realizedPvKwhAtPlan !== null) {
		remainingExpectedKwh = Math.max(0, newExpectedDayKwh - baseline.realizedPvKwhAtPlan);
	}
	return { previousExpectedDayKwh, newExpectedDayKwh, realizedKwh, remainingExpectedKwh };
}

export function evaluateMaterialReplan(
	baseline: PlanBaseline | null,
	actual: PlanActualSample,
	opts?: {
		lastReplanAtMs?: number | null;
		timezoneOffsetMinutes?: number | null;
		/** Frühester zukünftiger Soft-IH-Slot (ms) — hinter emptyAt → hart replanen. */
		immersionFirstFutureStartMs?: number | null;
	},
): MaterialReplanDecision {
	const reasons: string[] = [];
	let hard = false;

	if (!baseline) {
		return { shouldReplan: true, reasons: [REASON.REPLAN_DAY_ROLLOVER], hard: true };
	}

	if (actual.date !== baseline.date) {
		reasons.push(REASON.REPLAN_DAY_ROLLOVER);
		hard = true;
	}

	if (actual.cadenceDigest !== baseline.cadenceDigest) {
		// Cadence-Digest deckt Forecast-/Preis-/Flex-Familien ab — spezifizieren
		const pvBucketDiff = absDiff(baseline.expectedPvDayKwh, actual.forecastPvDayKwh);
		if (pvBucketDiff !== null && pvBucketDiff >= AI_TRIGGER_PV_BUCKET_KWH) {
			reasons.push(REASON.REPLAN_PV_FORECAST_CHANGED);
		}
		const priceDiff = absDiff(baseline.priceMedianCt, actual.priceMedianCt);
		if (
			(priceDiff !== null && priceDiff >= AI_TRIGGER_PRICE_MEDIAN_BUCKET_CT) ||
			baseline.priceStructureDigest !== actual.priceStructureDigest
		) {
			reasons.push(REASON.REPLAN_PRICE_REVISION);
		}
		const loadDiff = absDiff(baseline.expectedHouseLoadDayKwh, actual.forecastHouseLoadDayKwh);
		if (loadDiff !== null && loadDiff >= MATERIAL_HOUSE_LOAD_KWH) {
			reasons.push(REASON.REPLAN_HOUSE_LOAD_DEVIATION);
		}
		// Generischer Digest-Wechsel (Mode, Contributions, …)
		if (
			!reasons.includes(REASON.REPLAN_PV_FORECAST_CHANGED) &&
			!reasons.includes(REASON.REPLAN_PRICE_REVISION) &&
			!reasons.includes(REASON.REPLAN_HOUSE_LOAD_DEVIATION)
		) {
			// Digest geändert ohne zuordenbare Einzelmetrik — trotzdem Material (z. B. Mode)
			reasons.push(REASON.REPLAN_PV_FORECAST_CHANGED);
		}
	}

	// Unified-Input-PV/Hauslast auch ohne Cadence-Digest-Wechsel (z. B. Contribution-Day-kWh
	// geändert, während Daily-Plan-Totals wegen fehlendem Day-Match null bleiben).
	const pvForecastDiff = absDiff(baseline.expectedPvDayKwh, actual.forecastPvDayKwh);
	if (
		pvForecastDiff !== null &&
		pvForecastDiff >= AI_TRIGGER_PV_BUCKET_KWH &&
		!reasons.includes(REASON.REPLAN_PV_FORECAST_CHANGED)
	) {
		reasons.push(REASON.REPLAN_PV_FORECAST_CHANGED);
	}
	const houseLoadForecastDiff = absDiff(
		baseline.expectedHouseLoadDayKwh,
		actual.forecastHouseLoadDayKwh,
	);
	if (
		houseLoadForecastDiff !== null &&
		houseLoadForecastDiff >= MATERIAL_HOUSE_LOAD_KWH &&
		!reasons.includes(REASON.REPLAN_HOUSE_LOAD_DEVIATION)
	) {
		reasons.push(REASON.REPLAN_HOUSE_LOAD_DEVIATION);
	}

	// Preisstruktur auch ohne generischen Digest-Parse (expliziter Baseline-Vergleich)
	if (
		baseline.priceStructureDigest !== actual.priceStructureDigest &&
		!reasons.includes(REASON.REPLAN_PRICE_REVISION)
	) {
		reasons.push(REASON.REPLAN_PRICE_REVISION);
	}

	// PV actual deviation: realisiert vs. anteilig erwartet
	if (
		actual.realizedPvKwh !== null &&
		baseline.expectedPvDayKwh !== null &&
		baseline.realizedPvKwhAtPlan !== null
	) {
		const realizedDelta = actual.realizedPvKwh - baseline.realizedPvKwhAtPlan;
		const expectedRemainingAtPlan =
			baseline.expectedPvDayKwh - baseline.realizedPvKwhAtPlan;
		// Grobe Heuristik: wenn realisierte Delta seit Plan stark von „Restprognose-Anteil“ abweicht
		void expectedRemainingAtPlan;
		if (Math.abs(realizedDelta) >= AI_TRIGGER_PV_BUCKET_KWH) {
			const ctx = pvRevisionContext(baseline, actual);
			if (
				ctx.remainingExpectedKwh !== null &&
				baseline.expectedPvDayKwh !== null &&
				absDiff(ctx.newExpectedDayKwh, ctx.previousExpectedDayKwh) !== null &&
				(absDiff(ctx.newExpectedDayKwh, ctx.previousExpectedDayKwh) ?? 0) >= AI_TRIGGER_PV_BUCKET_KWH
			) {
				reasons.push(REASON.REPLAN_PV_ACTUAL_DEVIATION);
			} else if (realizedDelta >= AI_TRIGGER_PV_BUCKET_KWH * 1.5) {
				reasons.push(REASON.REPLAN_PV_ACTUAL_DEVIATION);
			}
		}
	} else if (
		actual.realizedPvKwh !== null &&
		baseline.expectedPvDayKwh !== null &&
		actual.forecastPvDayKwh !== null
	) {
		const remaining = Math.max(0, actual.forecastPvDayKwh - actual.realizedPvKwh);
		const previousRemaining = Math.max(
			0,
			baseline.expectedPvDayKwh - (baseline.realizedPvKwhAtPlan ?? 0),
		);
		if (Math.abs(remaining - previousRemaining) >= AI_TRIGGER_PV_BUCKET_KWH) {
			reasons.push(REASON.REPLAN_PV_ACTUAL_DEVIATION);
		}
	}

	const socDiff = absDiff(baseline.batterySocPct, actual.batterySocPct);
	if (socDiff !== null && socDiff >= MATERIAL_BATTERY_SOC_PP) {
		reasons.push(REASON.REPLAN_BATTERY_SOC_DEVIATION);
	}

	const headDiff = absDiff(baseline.thermalHeadroomKwh, actual.thermalHeadroomKwh);
	const tempDiff = absDiff(baseline.bufferTempC, actual.bufferTempC);
	if (
		actual.thermalBlocked ||
		(headDiff !== null && headDiff >= MATERIAL_THERMAL_HEADROOM_KWH) ||
		(tempDiff !== null && tempDiff >= MATERIAL_THERMAL_TEMP_K)
	) {
		reasons.push(REASON.REPLAN_THERMAL_DEVIATION);
	}
	// Ziel erreicht: Headroom war >0, jetzt ~0
	if (
		baseline.thermalHeadroomKwh !== null &&
		baseline.thermalHeadroomKwh >= MATERIAL_THERMAL_HEADROOM_KWH &&
		actual.thermalHeadroomKwh !== null &&
		actual.thermalHeadroomKwh < 0.05
	) {
		if (!reasons.includes(REASON.REPLAN_THERMAL_DEVIATION)) {
			reasons.push(REASON.REPLAN_THERMAL_DEVIATION);
		}
	}

	/*
	 * emptyAt neu (Contribution/Learning nach Plan) oder stark verschoben → Soft-Deadline
	 * muss neu gelten (Export: Plan 10:31 ohne Deadline → Sa-Slots, emptyAt 10:33).
	 */
	const emptyBucketChanged =
		thermalEmptyAtBucket(baseline.thermalEmptyAtIso) !==
		thermalEmptyAtBucket(actual.thermalEmptyAtIso);
	const emptyAppeared =
		!(baseline.thermalEmptyAtIso ?? "").trim() && !!(actual.thermalEmptyAtIso ?? "").trim();
	if (emptyAppeared || emptyBucketChanged) {
		reasons.push(REASON.REPLAN_THERMAL_EMPTY_AT_CHANGED);
		hard = true;
	}
	const emptyMs = actual.thermalEmptyAtIso ? Date.parse(actual.thermalEmptyAtIso) : Number.NaN;
	const firstIh = opts?.immersionFirstFutureStartMs;
	if (
		Number.isFinite(emptyMs) &&
		firstIh != null &&
		Number.isFinite(firstIh) &&
		firstIh >= emptyMs - 60_000
	) {
		if (!reasons.includes(REASON.REPLAN_THERMAL_EMPTY_AT_CHANGED)) {
			reasons.push(REASON.REPLAN_THERMAL_EMPTY_AT_CHANGED);
		}
		hard = true;
	}

	/*
	 * BLOCK B: User/External Manual-Override geändert (Intent Engine, battery/thermal/wallbox).
	 * Hart, wie Vehicle connect/disconnect — der Plan muss sofort auf reale Kontrollhoheit
	 * reagieren (weder gegen einen neu aktiven Override planen noch einen aufgehobenen
	 * Override unnötig lange nachwirken lassen).
	 */
	if ((baseline.userOverrideDigest ?? "") !== (actual.userOverrideDigest ?? "")) {
		reasons.push(REASON.REPLAN_USER_OVERRIDE_CHANGED);
		hard = true;
	}

	if (baseline.acMandatoryAny !== actual.acMandatoryAny) {
		reasons.push(REASON.REPLAN_AC_COMFORT_CHANGE);
		hard = true;
	}

	if (baseline.vehicleConnected === false && actual.vehicleConnected === true) {
		reasons.push(REASON.REPLAN_VEHICLE_CONNECTED);
		hard = true;
	}
	if (baseline.vehicleConnected === true && actual.vehicleConnected === false) {
		reasons.push(REASON.REPLAN_VEHICLE_DISCONNECTED);
		hard = true;
	}
	if (
		baseline.presenceDigest !== actual.presenceDigest &&
		!reasons.includes(REASON.REPLAN_VEHICLE_CONNECTED) &&
		!reasons.includes(REASON.REPLAN_VEHICLE_DISCONNECTED)
	) {
		reasons.push(REASON.REPLAN_VEHICLE_PRESENCE_CHANGED);
		// Explizite/gelernte Presence-Änderung: material, aber soft (Cooldown gilt)
	}
	const vehE = absDiff(baseline.vehicleRequiredEnergyKwh, actual.vehicleRequiredEnergyKwh);
	const vehSoc = absDiff(baseline.vehicleTargetSocPct, actual.vehicleTargetSocPct);
	const vehDeadlineChanged =
		(baseline.vehicleDeadlineIso ?? "") !== (actual.vehicleDeadlineIso ?? "");
	if (
		(baseline.vehicleConnected || actual.vehicleConnected) &&
		((vehE !== null && vehE >= MATERIAL_VEHICLE_ENERGY_KWH) ||
			vehDeadlineChanged ||
			(vehSoc !== null && vehSoc >= 5))
	) {
		reasons.push(REASON.REPLAN_VEHICLE_GOAL_CHANGED);
		hard = true;
	}

	const unique = [...new Set(reasons)];
	if (unique.length === 0) {
		return { shouldReplan: false, reasons: [], hard: false };
	}

	const cadenceMoved = actual.cadenceDigest !== baseline.cadenceDigest;
	const forecastRevision =
		cadenceMoved ||
		unique.includes(REASON.REPLAN_PV_FORECAST_CHANGED) ||
		unique.includes(REASON.REPLAN_PRICE_REVISION) ||
		unique.includes(REASON.REPLAN_HOUSE_LOAD_DEVIATION);
	const lastReplan = opts?.lastReplanAtMs ?? null;
	const cooldownMs = replanCooldownMs(actual.nowMs, opts?.timezoneOffsetMinutes ?? 0);
	// Anti-Chatter: Cooldown nur für weiche Plan-vs-Actual-Abweichungen.
	// Cadence-/Forecast-Revision und harte Events (Vehicle, Tag, Komfort) immer erlaubt.
	if (
		!hard &&
		!forecastRevision &&
		lastReplan !== null &&
		actual.nowMs - lastReplan < cooldownMs
	) {
		return { shouldReplan: false, reasons: unique, hard: false };
	}

	return { shouldReplan: true, reasons: unique, hard };
}
