/**
 * Neutral price-window fallback. No vendor parsers here — callers pass already-normalized windows.
 */

import { OPERATOR_MS_PER_15MIN } from "../../../../operator/time";
import { roundKwh } from "./energy";
import type { EvPriceWindow } from "./types";

export interface PriceWindowEval {
	remainingFeasibleEnergyKWh: number | null;
	remainingCheapEnergyKWh: number | null;
	cheapWindowEnergyCapacityKWh: number | null;
	cheapEnergyAfterLatestStartKWh: number | null;
	lostCheapEnergyKWh: number | null;
	medianPriceCtPerKwh: number | null;
	economicWindowLossRisk: boolean | null;
}

export function priceWindowsFrom15MinSlots(
	slots: ReadonlyArray<{ slotStartMs: number; priceCtPerKwh: number }>,
): EvPriceWindow[] {
	return slots
		.filter((s) => Number.isFinite(s.slotStartMs) && Number.isFinite(s.priceCtPerKwh))
		.map((s) => ({
			startMs: s.slotStartMs,
			endMs: s.slotStartMs + OPERATOR_MS_PER_15MIN,
			importCtPerKwh: s.priceCtPerKwh,
		}));
}

function median(values: number[]): number | null {
	if (values.length === 0) return null;
	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	if (sorted.length % 2 === 0) {
		return (sorted[mid - 1] + sorted[mid]) / 2;
	}
	return sorted[mid];
}

function overlapHours(a0: number, a1: number, b0: number, b1: number): number {
	const lo = Math.max(a0, b0);
	const hi = Math.min(a1, b1);
	if (!(hi > lo)) return 0;
	return (hi - lo) / 3_600_000;
}

function energyInRange(
	windows: readonly EvPriceWindow[],
	fromMs: number,
	toMs: number,
	chargePowerKw: number,
	cheapMaxCt: number | null,
): number {
	let kwh = 0;
	for (const w of windows) {
		if (cheapMaxCt != null && w.importCtPerKwh > cheapMaxCt + 1e-9) continue;
		const hours = overlapHours(w.startMs, w.endMs, fromMs, toMs);
		if (hours > 0) kwh += chargePowerKw * hours;
	}
	return roundKwh(kwh);
}

function pricesDiffer(prices: number[]): boolean {
	if (prices.length === 0) return false;
	const min = Math.min(...prices);
	const max = Math.max(...prices);
	return max - min > 0.05;
}

/**
 * Physical remaining energy = power × hours until a real deadline.
 * Cheap energy uses slots at or below the remaining-window median.
 * Without a deadline, feasible/cheap until-deadline figures stay null (not fake 0).
 */
export function evaluatePriceWindows(input: {
	nowMs: number;
	deadlineMs: number | null;
	chargePowerKw: number | null;
	energyNeededKWh: number | null;
	latestRequiredStartMs: number | null;
	windows: readonly EvPriceWindow[];
	deadlineRisk: boolean | null;
}): PriceWindowEval {
	const empty: PriceWindowEval = {
		remainingFeasibleEnergyKWh: null,
		remainingCheapEnergyKWh: null,
		cheapWindowEnergyCapacityKWh: null,
		cheapEnergyAfterLatestStartKWh: null,
		lostCheapEnergyKWh: null,
		medianPriceCtPerKwh: null,
		economicWindowLossRisk: false,
	};
	if (input.deadlineMs == null || input.deadlineMs <= input.nowMs) {
		return { ...empty, economicWindowLossRisk: false };
	}
	const deadlineMs = input.deadlineMs;
	if (input.chargePowerKw == null || input.chargePowerKw <= 0) {
		return { ...empty, economicWindowLossRisk: null };
	}

	const hoursLeft = (deadlineMs - input.nowMs) / 3_600_000;
	const remainingFeasibleEnergyKWh = roundKwh(input.chargePowerKw * hoursLeft);

	const remainingWindows = input.windows.filter((w) => w.endMs > input.nowMs && w.startMs < deadlineMs);
	const remainingPrices = remainingWindows.map((w) => w.importCtPerKwh);
	const uniquePrices = [...new Set(remainingPrices.map((p) => Math.round(p * 100) / 100))].sort(
		(a, b) => a - b,
	);
	const medianPriceCtPerKwh = median(uniquePrices);
	const cheapMax = medianPriceCtPerKwh;

	const remainingCheapEnergyKWh =
		cheapMax == null
			? null
			: energyInRange(remainingWindows, input.nowMs, deadlineMs, input.chargePowerKw, cheapMax);
	const cheapWindowEnergyCapacityKWh = remainingCheapEnergyKWh;

	let cheapEnergyAfterLatestStartKWh: number | null = null;
	let lostCheapEnergyKWh: number | null = null;
	if (input.latestRequiredStartMs != null && cheapMax != null) {
		const latest = Math.max(input.latestRequiredStartMs, input.nowMs);
		cheapEnergyAfterLatestStartKWh = energyInRange(
			remainingWindows,
			latest,
			deadlineMs,
			input.chargePowerKw,
			cheapMax,
		);
		lostCheapEnergyKWh = energyInRange(
			remainingWindows,
			input.nowMs,
			Math.min(latest, deadlineMs),
			input.chargePowerKw,
			cheapMax,
		);
	}

	let economicWindowLossRisk: boolean | null = false;
	const need = input.energyNeededKWh;
	if (need == null) {
		economicWindowLossRisk = false;
	} else if (input.deadlineRisk === true) {
		economicWindowLossRisk = false;
	} else if (need <= 0) {
		economicWindowLossRisk = false;
	} else if (remainingCheapEnergyKWh == null || !pricesDiffer(uniquePrices)) {
		economicWindowLossRisk = false;
	} else if (remainingFeasibleEnergyKWh + 0.05 < need) {
		economicWindowLossRisk = false;
	} else if (remainingCheapEnergyKWh + 0.05 < need) {
		economicWindowLossRisk = true;
	} else if (
		input.latestRequiredStartMs != null &&
		lostCheapEnergyKWh != null &&
		lostCheapEnergyKWh > 0.05 &&
		cheapEnergyAfterLatestStartKWh != null &&
		cheapEnergyAfterLatestStartKWh + 0.05 < need
	) {
		economicWindowLossRisk = true;
	}

	return {
		remainingFeasibleEnergyKWh,
		remainingCheapEnergyKWh,
		cheapWindowEnergyCapacityKWh,
		cheapEnergyAfterLatestStartKWh,
		lostCheapEnergyKWh,
		medianPriceCtPerKwh,
		economicWindowLossRisk,
	};
}
