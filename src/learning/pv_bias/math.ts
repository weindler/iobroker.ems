import type { PvBiasComputeResult, PvBiasDayPair } from "./types";

/** Tagesbias in %; forecast ≤ 0 oder ungültige Werte → Tag ignorieren (null). */
export function dayBiasPct(actualKwh: number, forecastKwh: number): number | null {
	if (!Number.isFinite(actualKwh) || !Number.isFinite(forecastKwh) || forecastKwh <= 0) {
		return null;
	}
	return ((actualKwh - forecastKwh) / forecastKwh) * 100;
}

export function meanBiasPct(pairs: PvBiasDayPair[]): { biasPct: number | null; sampleDays: number } {
	const biases: number[] = [];
	for (const p of pairs) {
		const b = dayBiasPct(p.actualKwh, p.forecastKwh);
		if (b !== null) {
			biases.push(b);
		}
	}
	if (biases.length === 0) {
		return { biasPct: null, sampleDays: 0 };
	}
	const sum = biases.reduce((a, b) => a + b, 0);
	return { biasPct: sum / biases.length, sampleDays: biases.length };
}

/** Energiegewichteter Bias: Summe Ist gegen Summe Forecast. */
export function energyBiasPct(pairs: PvBiasDayPair[]): { biasPct: number | null; sampleDays: number } {
	const valid = pairs.filter((p) =>
		Number.isFinite(p.actualKwh) && Number.isFinite(p.forecastKwh) && p.forecastKwh > 0,
	);
	if (valid.length === 0) return { biasPct: null, sampleDays: 0 };
	const actual = valid.reduce((sum, p) => sum + p.actualKwh, 0);
	const forecast = valid.reduce((sum, p) => sum + p.forecastKwh, 0);
	return forecast > 0
		? { biasPct: ((actual - forecast) / forecast) * 100, sampleDays: valid.length }
		: { biasPct: null, sampleDays: 0 };
}

function median(values: number[]): number | null {
	if (values.length === 0) return null;
	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Robuste Streuung der täglichen Prozentfehler in Prozentpunkten. */
export function medianAbsoluteDeviationPct(pairs: PvBiasDayPair[]): number | null {
	const values = pairs.map((p) => dayBiasPct(p.actualKwh, p.forecastKwh)).filter((v): v is number => v !== null);
	const center = median(values);
	if (center === null) return null;
	return median(values.map((v) => Math.abs(v - center)));
}

export function sampleConfidenceFactor(sampleDays: number): number {
	if (sampleDays < 7) return 0;
	if (sampleDays < 14) return 0.5;
	if (sampleDays >= 30) return 1;
	return 0.6 + ((sampleDays - 14) / 16) * 0.4;
}

export function stdDevPct(values: number[]): number | null {
	if (values.length < 2) {
		return null;
	}
	const mean = values.reduce((a, b) => a + b, 0) / values.length;
	const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
	return Math.sqrt(variance);
}

/**
 * Confidence sinkt bei wenig Historie, hoher Streuung und Lücken im 30-Tage-Fenster.
 * Skala orientiert sich an den Vertrags-Richtwerten (0–95 %).
 */
export function confidencePct(sampleDays30: number, sampleDays7: number, stdDevBias: number | null): number {
	let base = 0;
	if (sampleDays30 >= 30) {
		base = 90;
	} else if (sampleDays30 >= 15) {
		base = 82;
	} else if (sampleDays30 >= 7) {
		base = 68;
	} else if (sampleDays30 >= 3) {
		base = 50;
	} else if (sampleDays30 >= 1) {
		base = 28;
	}

	if (sampleDays7 < 3) {
		base = Math.min(base, 35);
	} else if (sampleDays7 < 7 && base > 60) {
		base = 60;
	}

	const gapRatio = sampleDays30 > 0 ? 1 - sampleDays30 / 30 : 1;
	base = base * (1 - gapRatio * 0.35);

	if (stdDevBias !== null) {
		if (stdDevBias > 50) {
			base *= 0.55;
		} else if (stdDevBias > 30) {
			base *= 0.75;
		} else if (stdDevBias > 15) {
			base *= 0.9;
		}
	}

	if (sampleDays30 >= 30 && stdDevBias !== null && stdDevBias <= 15) {
		base = Math.min(95, base + 5);
	}

	return Math.round(Math.max(0, Math.min(95, base)));
}

/** Korrigierter Forecast = Rohforecast × (1 + bias/100). */
export function correctForecastKwh(rawKwh: number, biasPct: number): number | null {
	if (!Number.isFinite(rawKwh) || !Number.isFinite(biasPct)) {
		return null;
	}
	return rawKwh * (1 + biasPct / 100);
}

export function computePvBias(
	pairs: PvBiasDayPair[],
	rawTodayKwh: number | null,
	rawTomorrowKwh: number | null,
): PvBiasComputeResult {
	const todayPairs = pairs.filter((p) => p.dayOffset === 0);
	// Unvollständiger heutiger Tag verfälscht Mittelwerte — nur abgestellte Tage zählen.
	const last7 = pairs.filter((p) => p.dayOffset >= 1 && p.dayOffset <= 7);
	const last14 = pairs.filter((p) => p.dayOffset >= 1 && p.dayOffset <= 14);
	const last30 = pairs.filter((p) => p.dayOffset >= 1 && p.dayOffset <= 30);
	const last90 = pairs.filter((p) => p.dayOffset >= 1 && p.dayOffset <= 90);

	const todayBias = meanBiasPct(todayPairs);
	const bias7 = energyBiasPct(last7);
	const bias14 = energyBiasPct(last14);
	const bias30 = energyBiasPct(last30);
	const bias90 = energyBiasPct(last90);

	const oldestOffset = last90.reduce((max, p) => Math.max(max, p.dayOffset), 0);
	const coverageFactor = oldestOffset > 0 ? Math.min(1, bias90.sampleDays / Math.min(90, oldestOffset)) : 0;
	const mad = medianAbsoluteDeviationPct(last90);
	const stabilityFactor = mad === null ? 0 : Math.max(0, Math.min(1, 1 - mad / 100));
	const dataFactor = sampleConfidenceFactor(bias90.sampleDays);
	const conf = Math.round(100 * dataFactor * coverageFactor * stabilityFactor);

	const modelBias =
		bias14.biasPct !== null && bias90.biasPct !== null
			? 0.4 * bias14.biasPct + 0.6 * bias90.biasPct
			: bias14.biasPct ?? bias90.biasPct;
	const appliedBias = bias90.sampleDays < 7 ? 0 : modelBias === null ? null : modelBias * (conf / 100);

	const correctedToday =
		appliedBias !== null && rawTodayKwh !== null
			? correctForecastKwh(rawTodayKwh, appliedBias)
			: null;
	const correctedTomorrow =
		appliedBias !== null && rawTomorrowKwh !== null
			? correctForecastKwh(rawTomorrowKwh, appliedBias)
			: null;

	let status: PvBiasComputeResult["status"] = "ready";
	let reason = "PV-Bias aus Historie berechnet.";

	if (bias90.sampleDays < 7) {
		status = "insufficient_data";
		reason = `Nur ${bias90.sampleDays} gültige abgeschlossene Tage — Rohforecast bleibt unverändert.`;
	} else if (bias90.sampleDays < 14) {
		reason = `${bias90.sampleDays} gültige Tage — vorläufige, durch Confidence abgeschwächte Korrektur.`;
	}

	return {
		biasTodayPct: todayBias.biasPct,
		bias7dPct: bias7.biasPct,
		bias30dPct: bias30.biasPct,
		bias14dPct: bias14.biasPct,
		bias90dPct: bias90.biasPct,
		modelBiasPct: modelBias,
		appliedBiasPct: appliedBias,
		sampleDays7d: bias7.sampleDays,
		sampleDays30d: bias30.sampleDays,
		sampleDays14d: bias14.sampleDays,
		sampleDays90d: bias90.sampleDays,
		coveragePct: Math.round(coverageFactor * 100),
		stabilityPct: Math.round(stabilityFactor * 100),
		confidencePct: conf,
		correctedTodayKwh: correctedToday,
		correctedTomorrowKwh: correctedTomorrow,
		rawTodayKwh,
		rawTomorrowKwh,
		status,
		reason,
	};
}
