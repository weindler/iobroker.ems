import { MS_PER_DAY, MS_PER_HOUR, MIN_RATE_SAMPLES, MIN_VALID_NIGHTS } from "./constants";
import { parseTimeHHMM, timestampAtLocalTime, localDateKey } from "./time";
import type {
	BatteryRuntimeComputeResult,
	BatteryRuntimeConfig,
	DailyAstroTimes,
	PowerPoint,
	SocPoint,
} from "./types";

function round2(n: number): number {
	return Math.round(n * 100) / 100;
}

function round3(n: number): number {
	return Math.round(n * 1000) / 1000;
}

function average(values: number[]): number | null {
	if (values.length === 0) return null;
	return round3(values.reduce((a, b) => a + b, 0) / values.length);
}

function findNearestSoc(points: SocPoint[], targetTs: number, maxDeltaMs: number): number | null {
	let best: SocPoint | null = null;
	let bestDelta = Infinity;
	for (const p of points) {
		const delta = Math.abs(p.ts - targetTs);
		if (delta <= maxDeltaMs && delta < bestDelta) {
			best = p;
			bestDelta = delta;
		}
	}
	return best?.socPct ?? null;
}

/** Nachtentladung: SOC-Abfall zwischen nightStart (Tag D) und nightEnd (Tag D+1). */
export function computeNightDischarges(params: {
	socPoints: SocPoint[];
	nightStart: string;
	nightEnd: string;
	astroDaily?: DailyAstroTimes | null;
	capacityKwh: number | null;
}): { avgPct: number | null; avgKwh: number | null; validNights: number } {
	const fixedStart = parseTimeHHMM(params.nightStart);
	const fixedEnd = parseTimeHHMM(params.nightEnd);
	if (!fixedStart || !fixedEnd || params.socPoints.length === 0) {
		return { avgPct: null, avgKwh: null, validNights: 0 };
	}

	const dateKeys = [...new Set(params.socPoints.map((p) => localDateKey(new Date(p.ts))))].sort();
	const pctDischarges: number[] = [];
	const kwhDischarges: number[] = [];
	const maxDelta = 2 * MS_PER_HOUR;

	for (let i = 0; i < dateKeys.length - 1; i++) {
		const dayKey = dateKeys[i];
		const nextKey = dateKeys[i + 1];
		const startTime = params.astroDaily?.startByDate.get(dayKey) ?? fixedStart;
		const endTime = params.astroDaily?.endByDate.get(nextKey) ?? fixedEnd;
		const startTs = timestampAtLocalTime(dayKey, startTime.hour, startTime.minute);
		const endTs = timestampAtLocalTime(nextKey, endTime.hour, endTime.minute);
		if (endTs <= startTs) continue;

		const socStart = findNearestSoc(params.socPoints, startTs, maxDelta);
		const socEnd = findNearestSoc(params.socPoints, endTs, maxDelta);
		if (socStart === null || socEnd === null) continue;

		const dischargePct = socStart - socEnd;
		if (dischargePct <= 0 || dischargePct > 50) continue;

		pctDischarges.push(round2(dischargePct));
		if (params.capacityKwh !== null) {
			kwhDischarges.push(round3((dischargePct / 100) * params.capacityKwh));
		}
	}

	return {
		avgPct: average(pctDischarges),
		avgKwh: params.capacityKwh !== null ? average(kwhDischarges) : null,
		validNights: pctDischarges.length,
	};
}

export function computeSocRates(socPoints: SocPoint[]): {
	avgChargeRatePctH: number | null;
	avgDischargeRatePctH: number | null;
} {
	const chargeRates: number[] = [];
	const dischargeRates: number[] = [];

	for (let i = 1; i < socPoints.length; i++) {
		const prev = socPoints[i - 1];
		const cur = socPoints[i];
		const dtHours = (cur.ts - prev.ts) / MS_PER_HOUR;
		if (dtHours <= 0 || dtHours > 6) continue;

		const dSoc = cur.socPct - prev.socPct;
		if (dSoc > 0.05) {
			chargeRates.push(dSoc / dtHours);
		} else if (dSoc < -0.05) {
			dischargeRates.push(Math.abs(dSoc) / dtHours);
		}
	}

	return {
		avgChargeRatePctH: average(chargeRates),
		avgDischargeRatePctH: average(dischargeRates),
	};
}

export function computePowerStats(powerPoints: PowerPoint[]): {
	avgChargePowerW: number | null;
	avgDischargePowerW: number | null;
	maxChargePowerW: number | null;
	maxDischargePowerW: number | null;
} {
	const charge: number[] = [];
	const discharge: number[] = [];

	for (const p of powerPoints) {
		if (p.powerW > 0) charge.push(p.powerW);
		else if (p.powerW < 0) discharge.push(Math.abs(p.powerW));
	}

	return {
		avgChargePowerW: average(charge),
		avgDischargePowerW: average(discharge),
		maxChargePowerW: charge.length ? Math.max(...charge) : null,
		maxDischargePowerW: discharge.length ? Math.max(...discharge) : null,
	};
}

export function findLastFullCharge(
	socPoints: SocPoint[],
	fullChargeSoc: number,
): string | null {
	let lastTs: number | null = null;
	for (const p of socPoints) {
		if (p.socPct >= fullChargeSoc) {
			lastTs = p.ts;
		}
	}
	return lastTs !== null ? new Date(lastTs).toISOString() : null;
}

export function computeTopoffStatus(params: {
	lastFullCharge: string | null;
	topoffIntervalDays: number;
	now: Date;
}): {
	daysSinceFull: number | null;
	topoffDaysRemaining: number | null;
	topoffDue: boolean | null;
} {
	if (!params.lastFullCharge) {
		return { daysSinceFull: null, topoffDaysRemaining: null, topoffDue: null };
	}
	const lastMs = Date.parse(params.lastFullCharge);
	if (!Number.isFinite(lastMs)) {
		return { daysSinceFull: null, topoffDaysRemaining: null, topoffDue: null };
	}
	const daysSinceFull = Math.floor((params.now.getTime() - lastMs) / MS_PER_DAY);
	const topoffDaysRemaining = Math.max(0, params.topoffIntervalDays - daysSinceFull);
	return {
		daysSinceFull,
		topoffDaysRemaining,
		topoffDue: daysSinceFull >= params.topoffIntervalDays,
	};
}

export function estimateRuntimeDays(
	currentSocPct: number | null,
	avgNightDischargePct: number | null,
): number | null {
	if (
		currentSocPct === null ||
		avgNightDischargePct === null ||
		avgNightDischargePct <= 0 ||
		currentSocPct <= 0
	) {
		return null;
	}
	return round2(currentSocPct / avgNightDischargePct);
}

export function computeBatteryRuntimeLearning(params: {
	socPoints: SocPoint[];
	powerPoints: PowerPoint[];
	capacityKwh: number | null;
	currentSocPct: number | null;
	cfg: BatteryRuntimeConfig;
	sourceSocStateId: string;
	sourcePowerStateId: string;
	now: Date;
	sampleDays: number;
	astroDaily?: DailyAstroTimes | null;
}): BatteryRuntimeComputeResult {
	const night = computeNightDischarges({
		socPoints: params.socPoints,
		nightStart: params.cfg.nightStart,
		nightEnd: params.cfg.nightEnd,
		astroDaily: params.astroDaily,
		capacityKwh: params.capacityKwh,
	});
	const rates = computeSocRates(params.socPoints);
	const powerStats =
		params.powerPoints.length > 0
			? computePowerStats(params.powerPoints)
			: {
					avgChargePowerW: null,
					avgDischargePowerW: null,
					maxChargePowerW: null,
					maxDischargePowerW: null,
				};

	const lastFullCharge = findLastFullCharge(params.socPoints, params.cfg.fullChargeSoc);
	const topoff = computeTopoffStatus({
		lastFullCharge,
		topoffIntervalDays: params.cfg.topoffIntervalDays,
		now: params.now,
	});

	const estimatedRuntimeDays = estimateRuntimeDays(
		params.currentSocPct,
		night.avgPct,
	);

	let status: BatteryRuntimeComputeResult["status"] = "ready";
	if (night.validNights < MIN_VALID_NIGHTS && rates.avgChargeRatePctH === null) {
		status = "insufficient_data";
	} else if (night.validNights < MIN_VALID_NIGHTS) {
		status = "partial";
	}

	const hasRates =
		(rates.avgChargeRatePctH !== null || rates.avgDischargeRatePctH !== null) &&
		params.socPoints.length >= MIN_RATE_SAMPLES;

	if (status === "ready" && !hasRates && night.validNights < MIN_VALID_NIGHTS) {
		status = "insufficient_data";
	}

	return {
		status,
		sampleDays: params.sampleDays,
		avgNightDischargePct: night.avgPct,
		avgNightDischargeKwh: night.avgKwh,
		avgChargeRatePctH: rates.avgChargeRatePctH,
		avgDischargeRatePctH: rates.avgDischargeRatePctH,
		avgChargePowerW: powerStats.avgChargePowerW,
		avgDischargePowerW: powerStats.avgDischargePowerW,
		maxChargePowerW: powerStats.maxChargePowerW,
		maxDischargePowerW: powerStats.maxDischargePowerW,
		lastFullCharge,
		daysSinceFull: topoff.daysSinceFull,
		topoffIntervalDays: params.cfg.topoffIntervalDays,
		topoffDaysRemaining: topoff.topoffDaysRemaining,
		topoffDue: topoff.topoffDue,
		estimatedRuntimeDays,
		currentSocPct: params.currentSocPct,
		capacityKwh: params.capacityKwh,
		sourceSocStateId: params.sourceSocStateId,
		sourcePowerStateId: params.sourcePowerStateId,
		lastError: "",
	};
}

export function noSourceResult(cfg: BatteryRuntimeConfig): BatteryRuntimeComputeResult {
	return {
		status: "no_source",
		sampleDays: 0,
		avgNightDischargePct: null,
		avgNightDischargeKwh: null,
		avgChargeRatePctH: null,
		avgDischargeRatePctH: null,
		avgChargePowerW: null,
		avgDischargePowerW: null,
		maxChargePowerW: null,
		maxDischargePowerW: null,
		lastFullCharge: null,
		daysSinceFull: null,
		topoffIntervalDays: cfg.topoffIntervalDays,
		topoffDaysRemaining: null,
		topoffDue: null,
		estimatedRuntimeDays: null,
		currentSocPct: null,
		capacityKwh: null,
		sourceSocStateId: "",
		sourcePowerStateId: "",
		lastError:
			"Keine SOC-Quelle — Admin-State oder addons.battery.mapping.soc_pct konfigurieren.",
	};
}

export function disabledResult(cfg: BatteryRuntimeConfig): BatteryRuntimeComputeResult {
	return {
		...noSourceResult(cfg),
		status: "disabled",
		lastError: "Battery Runtime Learning in Admin deaktiviert.",
	};
}

export function errorResult(
	message: string,
	cfg: BatteryRuntimeConfig,
	sources: { soc: string; power: string },
): BatteryRuntimeComputeResult {
	return {
		...noSourceResult(cfg),
		status: "error",
		sourceSocStateId: sources.soc,
		sourcePowerStateId: sources.power,
		lastError: message,
	};
}
