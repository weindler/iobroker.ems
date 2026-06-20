import {
	PV_HORIZON_BIAS_WEIGHT_BY_DAY,
	PV_HORIZON_CONFIDENCE_DECAY_PP_PER_DAY,
	PV_HORIZON_DAY_COUNT,
} from "./constants";
import type { PvHorizonComputeResult, PvHorizonDayResult } from "./types";

/** Effektiver Bias in % nach Tages-Gewichtung (Day1 = Index 1). */
export function effectiveBiasPct(biasPct: number, dayIndex: number): number {
	const weight = PV_HORIZON_BIAS_WEIGHT_BY_DAY[dayIndex - 1] ?? PV_HORIZON_BIAS_WEIGHT_BY_DAY.at(-1)!;
	return biasPct * weight;
}

/** Korrigierter Horizon-Wert = Rohforecast × (1 + effektiver Bias / 100). */
export function correctHorizonKwh(rawKwh: number, biasPct: number, dayIndex: number): number {
	const eff = effectiveBiasPct(biasPct, dayIndex);
	return rawKwh * (1 + eff / 100);
}

/** Confidence aus Phase-2A-Basis, linear abnehmend über die Tage. */
export function horizonDayConfidencePct(baseConfidencePct: number, dayIndex: number): number {
	const decay = PV_HORIZON_CONFIDENCE_DECAY_PP_PER_DAY * (dayIndex - 1);
	return Math.round(Math.max(0, Math.min(95, baseConfidencePct - decay)));
}

export function computePvHorizon(
	rawKwhByDay: Array<number | null>,
	biasPct: number | null,
	baseConfidencePct: number | null,
): PvHorizonComputeResult {
	const days: PvHorizonDayResult[] = [];
	let totalRaw = 0;
	let totalCorrected = 0;
	let hasRawSum = false;
	let hasCorrectedSum = false;
	let daysAvailable = 0;

	for (let i = 0; i < PV_HORIZON_DAY_COUNT; i++) {
		const dayIndex = i + 1;
		const raw = rawKwhByDay[i] ?? null;
		let corrected: number | null = null;
		let confidence: number | null = null;

		if (raw !== null && Number.isFinite(raw) && raw > 0) {
			daysAvailable++;
			totalRaw += raw;
			hasRawSum = true;
			if (biasPct !== null && Number.isFinite(biasPct)) {
				corrected = correctHorizonKwh(raw, biasPct, dayIndex);
				totalCorrected += corrected;
				hasCorrectedSum = true;
			}
			if (baseConfidencePct !== null && Number.isFinite(baseConfidencePct)) {
				confidence = horizonDayConfidencePct(baseConfidencePct, dayIndex);
			}
		}

		days.push({ dayIndex, rawKwh: raw, correctedKwh: corrected, confidencePct: confidence });
	}

	let status: PvHorizonComputeResult["status"] = "no_data";
	if (daysAvailable === 0) {
		status = "no_data";
	} else if (biasPct === null || !Number.isFinite(biasPct)) {
		status = "no_bias";
	} else if (daysAvailable === PV_HORIZON_DAY_COUNT) {
		status = "ready";
	} else {
		status = "partial";
	}

	return {
		days,
		total7dRawKwh: hasRawSum ? totalRaw : null,
		total7dCorrectedKwh: hasCorrectedSum ? totalCorrected : null,
		daysAvailable,
		status,
	};
}
