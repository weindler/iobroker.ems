import type { AcGlobalConfig, AcUnitConfig } from "../../addons/air_conditioning/types";
import { isHardOffTime, isWithinClockWindow, localMinutesNow } from "../../addons/air_conditioning/runtime/time";
import type { ConsumerPersistEntry } from "../../learning/consumer_stats/types";
import { resolveConsumerEffectivePowerW } from "../../learning/consumer_stats/learned_power";
import type { PlannerCoolingDecision } from "../../planner/types";
import { sumAllocatedConsumerPeakW } from "../../planner/consumer_allocate";
import { estimateCoolingHours, estimateDehumidifyHours } from "./climate_energy";
import { climateSharedPowerKey, resolveClimateSharedPowerW } from "../../learning/climate_shared_power/math";
import type { ClimateSharedPowerStat } from "../../learning/climate_shared_power/types";

export type CoolingUnitPlanInput = {
	unit: AcUnitConfig;
	roomTempC: number | null;
	roomHumidityPct?: number | null;
	consumerStats: ConsumerPersistEntry | undefined;
};

export type CoolingPlanInput = {
	now: Date;
	acConfig: AcGlobalConfig;
	governanceEnabled: boolean;
	/** Spot/Live-Außentemperatur (Fallback, wenn kein Tages-Max). */
	outdoorTempC: number | null;
	/** Wetter-Horizon Tag-1 korrigiertes Max — bevorzugte Planungsgröße. */
	outdoorForecastMaxC?: number | null;
	units: CoolingUnitPlanInput[];
	/**
	 * PHASE 3 — Shared-Power/Climate Learning (`learning/climate_shared_power`). Key =
	 * `climateSharedPowerKey(groupId, mode, combo)`. Optional — ohne Stats (z. B. Kaltstart,
	 * noch keine Segmente) unverändertes Verhalten über `resolveConsumerEffectivePowerW`.
	 */
	sharedPowerStats?: Record<string, ClimateSharedPowerStat>;
};

export type CoolingUnitForecast = {
	unitIndex: number;
	name: string;
	powerW: number;
	powerSource: "config" | "learned" | "learned_shared";
	/** Für welche Betriebsart `powerW` bestimmt wurde — Basis für gruppenweite Peak-Dedup. */
	powerPurpose: "cooling" | "dehumidify" | null;
	likelyActive: boolean;
	expectedHours: number;
	expectedKwh: number;
	coolingHours: number;
	dehumidifyHours: number;
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

/**
 * PHASE 3 — Shared-Power/Climate Learning: löst die elektrische Leistung DIESER Unit alleine
 * (Solo-Kombination, `activeUnitCombinationKey` für genau einen aktiven Index) für die
 * gegebene Betriebsart über das gruppenbewusste Learning auf. Grund: die bisherige reine
 * Pro-Unit-`consumer_stats`-Kette speist bei geteilten Außengeräten den ROHEN (nicht
 * deduplizierten) Sensorwert ein — Tage mit gleichzeitigem Betrieb beider Innengeräte blähen
 * den gelernten Solo-Wert künstlich auf. Ohne Gruppe/ohne belastbares Sample: unverändertes
 * bestehendes Verhalten (Consumer-Stats/Config-Fallback).
 */
function resolveGroupAwarePowerW(
	unit: AcUnitConfig,
	purpose: "cooling" | "dehumidify",
	fallback: { powerW: number; source: "config" | "learned" },
	sharedPowerStats: Record<string, ClimateSharedPowerStat> | undefined,
): { powerW: number; source: CoolingUnitForecast["powerSource"]; noteDe: string | null } {
	if (!unit.sharedPowerGroupId || !sharedPowerStats) {
		return { powerW: fallback.powerW, source: fallback.source, noteDe: null };
	}
	const soloCombo = String(unit.index);
	const key = climateSharedPowerKey(unit.sharedPowerGroupId, purpose, soloCombo);
	const resolution = resolveClimateSharedPowerW(sharedPowerStats[key], fallback.powerW);
	if (resolution.source === "learned") {
		return { powerW: resolution.powerW, source: "learned_shared", noteDe: resolution.reasonDe };
	}
	return { powerW: fallback.powerW, source: fallback.source, noteDe: null };
}

function estimateUnitClimate(input: {
	unit: AcUnitConfig;
	roomTempC: number | null;
	roomHumidityPct: number | null;
	outdoorMaxC: number | null;
	outdoorLikelyTempC: number;
	remainingHours: number;
	consumerStats: ConsumerPersistEntry | undefined;
	sharedPowerStats: Record<string, ClimateSharedPowerStat> | undefined;
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
		powerPurpose: null,
		likelyActive: false,
		expectedHours: 0,
		expectedKwh: 0,
		coolingHours: 0,
		dehumidifyHours: 0,
		reasonDe,
	});

	if (input.remainingHours <= 0) {
		return none("Außerhalb Zeitfenster.");
	}

	const learnedHours =
		learned.medianRuntimeSecPerDay !== null && learned.medianRuntimeSecPerDay > 0
			? learned.medianRuntimeSecPerDay / 3600
			: null;

	const cooling = estimateCoolingHours({
		outdoorMaxC: input.outdoorMaxC,
		outdoorLikelyTempC: input.outdoorLikelyTempC,
		remainingHours: input.remainingHours,
		learnedHours,
		roomTempC: input.roomTempC,
		onTempC: unit.onTempC,
		offTempC: unit.offTempC,
	});

	const dryConfigured =
		Boolean(unit.modeWhenDehumidify?.trim()) && unit.maxHumidityPct !== null;
	const dehumidify = estimateDehumidifyHours({
		outdoorMaxC: input.outdoorMaxC,
		outdoorLikelyTempC: input.outdoorLikelyTempC,
		remainingHours: input.remainingHours,
		learnedHours,
		roomHumidityPct: input.roomHumidityPct,
		maxHumidityPct: unit.maxHumidityPct,
		dryModeConfigured: dryConfigured,
	});

	// Kühlung und Entfeuchten teilen oft denselben Verdichter — Stunden nicht doppelt zählen.
	const expectedHours = Math.min(
		input.remainingHours,
		Math.max(cooling.expectedHours, dehumidify.expectedHours),
	);
	const likelyActive = (cooling.likelyActive || dehumidify.likelyActive) && expectedHours > 0;
	if (!likelyActive) {
		const reason = cooling.reasonDe || dehumidify.reasonDe || "Kein Klima-Bedarf";
		return none(reason);
	}

	// Kühlung dominiert i.d.R. (Kompressorlast); Entfeuchten nur wenn Kühlung nicht ohnehin aktiv ist.
	const purpose: "cooling" | "dehumidify" = cooling.likelyActive ? "cooling" : "dehumidify";
	const resolved = resolveGroupAwarePowerW(unit, purpose, learned, input.sharedPowerStats);

	const expectedKwh = (resolved.powerW * expectedHours) / 1000;
	const powerLabel =
		resolved.source === "learned_shared"
			? `${resolved.powerW} W (gelernt, Shared-Power)`
			: resolved.source === "learned"
				? `${resolved.powerW} W (gelernt)`
				: `${resolved.powerW} W (Config)`;
	const parts: string[] = [];
	if (cooling.likelyActive) parts.push(`Kühl: ${cooling.reasonDe}`);
	if (dehumidify.likelyActive) parts.push(`Entfeucht: ${dehumidify.reasonDe}`);
	if (learned.source === "learned" && learnedHours !== null) {
		parts.push(`Ø ${Math.round(learnedHours * 10) / 10} h/Tag (${learned.sampleDays} Tage)`);
	}
	parts.push(powerLabel);

	return {
		unitIndex: unit.index,
		name: unit.name,
		powerW: resolved.powerW,
		powerSource: resolved.source,
		powerPurpose: purpose,
		likelyActive: true,
		expectedHours: Math.round(expectedHours * 100) / 100,
		expectedKwh: Math.round(expectedKwh * 1000) / 1000,
		coolingHours: cooling.expectedHours,
		dehumidifyHours: dehumidify.expectedHours,
		reasonDe: parts.join("; "),
	};
}

/**
 * PHASE 3 — Shared-Power/Climate Learning: verhindert additive Doppelzählung der Peak-Leistung,
 * wenn mehrere aktive Units eines Plans dasselbe Außengerät teilen (`sharedPowerGroupId`).
 * Bevorzugt den gelernten Kombi-Wert für genau diese Kombination (z. B. "1+2"); ohne
 * belastbares Sample: konservativ max() statt Summe — dieselbe Fallback-Logik wie die
 * bestehende Live-Deduplizierung (`addons/air_conditioning/shared_power.ts`), NICHT
 * 700 W + 700 W für ein Außengerät, das real nur einmal zieht.
 */
function dedupSharedGroupPeakPowers(
	activeForecasts: CoolingUnitForecast[],
	enabledUnits: CoolingUnitPlanInput[],
	sharedPowerStats: Record<string, ClimateSharedPowerStat> | undefined,
): number[] {
	const unitByIndex = new Map(enabledUnits.map((r) => [r.unit.index, r.unit]));
	const groups = new Map<string, CoolingUnitForecast[]>();
	const standalone: number[] = [];

	for (const f of activeForecasts) {
		const groupId = unitByIndex.get(f.unitIndex)?.sharedPowerGroupId ?? null;
		if (!groupId || !f.powerPurpose) {
			standalone.push(f.powerW);
			continue;
		}
		const gKey = `${groupId}|${f.powerPurpose}`;
		const arr = groups.get(gKey) ?? [];
		arr.push(f);
		groups.set(gKey, arr);
	}

	const result = [...standalone];
	for (const [gKey, members] of groups) {
		if (members.length === 1) {
			result.push(members[0].powerW);
			continue;
		}
		const sep = gKey.indexOf("|");
		const groupId = gKey.slice(0, sep);
		const purpose = gKey.slice(sep + 1);
		const combo = [...members]
			.map((m) => m.unitIndex)
			.sort((a, b) => a - b)
			.join("+");
		const combinedKey = climateSharedPowerKey(groupId, purpose, combo);
		const maxSolo = Math.max(...members.map((m) => m.powerW));
		const resolution = resolveClimateSharedPowerW(sharedPowerStats?.[combinedKey], maxSolo);
		result.push(resolution.source === "learned" ? resolution.powerW : maxSolo);
	}
	return result;
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

	const outdoorMaxC =
		input.outdoorForecastMaxC !== null &&
		input.outdoorForecastMaxC !== undefined &&
		Number.isFinite(input.outdoorForecastMaxC)
			? input.outdoorForecastMaxC
			: input.outdoorTempC;

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
				powerPurpose: null,
				likelyActive: false,
				expectedHours: 0,
				expectedKwh: 0,
				coolingHours: 0,
				dehumidifyHours: 0,
				reasonDe: "Außerhalb Betriebszeit.",
			});
			continue;
		}
		forecasts.push(
			estimateUnitClimate({
				unit,
				roomTempC: row.roomTempC,
				roomHumidityPct: row.roomHumidityPct ?? null,
				outdoorMaxC,
				outdoorLikelyTempC: input.acConfig.plannerOutdoorLikelyTempC,
				remainingHours: remainingActiveHours(input.now, unit),
				consumerStats: row.consumerStats,
				sharedPowerStats: input.sharedPowerStats,
				nowMs: input.now.getTime(),
			}),
		);
	}

	const activeForecasts = forecasts.filter((f) => f.likelyActive && f.powerW > 0);
	const likelyActive = activeForecasts.length > 0;
	const expectedKwh = forecasts.reduce((sum, f) => sum + f.expectedKwh, 0);
	const peakUnitPowers = dedupSharedGroupPeakPowers(activeForecasts, enabledUnits, input.sharedPowerStats);
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
		parts.push("Heute voraussichtlich keine Kühlung/Entfeuchtung.");
	}

	return {
		expected_kwh_today: Math.round(expectedKwh * 1000) / 1000,
		expected_peak_w: expectedPeakW,
		likely_active: likelyActive,
		reason_de: parts.join(" | "),
		forecast_active:
			outdoorMaxC !== null ||
			enabledUnits.some((u) => u.roomTempC !== null || (u.roomHumidityPct ?? null) !== null),
		units: forecasts,
	};
}

export function coolingReserveW(cooling: Pick<PlannerCoolingDecision, "likely_active" | "expected_peak_w">): number {
	return cooling.likely_active ? cooling.expected_peak_w : 0;
}
