/**
 * Planungswirksame lineare Kühlrate (°C/h) aus Learning — eine Wahrheit für Unified Bridge.
 * Bevorzugt Cycle-Durchschnitt; sonst Newton-Instantanrate; sonst emptyAt-Linearisierung.
 */

import { DEFAULT_AMBIENT_C } from "../../../learning/thermal_runtime/constants";

export type EffectiveCoolingRateInput = {
	coolingRateCPerHAvg: number | null | undefined;
	coolingConstantPerH: number | null | undefined;
	coolingAsymptoteC: number | null | undefined;
	bufferTempC: number | null | undefined;
	minTempC: number | null | undefined;
	estimatedEmptyAtMs: number | null | undefined;
	nowMs: number;
};

/**
 * Belastbare °C/h für resolveThermalPlannerEnergy.
 * null = keine Physik → Bridge darf keinen Fake-Hard-Headroom erzwingen.
 */
export function effectiveCoolingRateCPerH(input: EffectiveCoolingRateInput): number | null {
	const avg = input.coolingRateCPerHAvg;
	if (typeof avg === "number" && Number.isFinite(avg) && avg > 0) {
		return avg;
	}

	const k = input.coolingConstantPerH;
	const buf = input.bufferTempC;
	if (typeof k === "number" && Number.isFinite(k) && k > 0 && typeof buf === "number" && Number.isFinite(buf)) {
		const asym =
			typeof input.coolingAsymptoteC === "number" && Number.isFinite(input.coolingAsymptoteC)
				? input.coolingAsymptoteC
				: DEFAULT_AMBIENT_C;
		if (buf > asym + 0.05) {
			const instant = k * (buf - asym);
			if (Number.isFinite(instant) && instant > 0) return Math.round(instant * 1000) / 1000;
		}
	}

	const emptyMs = input.estimatedEmptyAtMs;
	const min = input.minTempC;
	if (
		emptyMs != null &&
		Number.isFinite(emptyMs) &&
		emptyMs > input.nowMs + 60_000 &&
		typeof buf === "number" &&
		Number.isFinite(buf) &&
		typeof min === "number" &&
		Number.isFinite(min) &&
		buf > min
	) {
		const hours = (emptyMs - input.nowMs) / 3600_000;
		if (hours > 0.05) {
			const linear = (buf - min) / hours;
			if (Number.isFinite(linear) && linear > 0) return Math.round(linear * 1000) / 1000;
		}
	}

	return null;
}
