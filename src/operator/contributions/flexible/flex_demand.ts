import type { OperatorDataQuality, PlanSlotContribution } from "../../types";
import { round3 } from "./types";

/** Conservative electrical kWh per °C (~300 L buffer) when no volume is configured. */
export const IMMERSION_DEFAULT_KWH_PER_DEGREE_C = 0.38;

const MAX_HEATING_HOURS_PER_DAY = 18;

export function estimateImmersionRequiredEnergyKwh(
	bufferTempC: number,
	targetTempC: number,
	maxPowerW: number | null,
): number {
	const delta = targetTempC - bufferTempC;
	if (delta <= 0) return 0;
	let kwh = round3(delta * IMMERSION_DEFAULT_KWH_PER_DEGREE_C);
	if (maxPowerW !== null && maxPowerW > 0) {
		const cap = round3((maxPowerW / 1000) * MAX_HEATING_HOURS_PER_DAY);
		kwh = Math.min(kwh, cap);
	}
	return kwh;
}

export function buildFlexibleDemandSlot(input: {
	generatedAt: string;
	requiredEnergyKwh: number | null;
	maxPowerW: number | null;
	available: boolean;
	mandatory?: boolean;
	quality: OperatorDataQuality;
	reasonDe: string;
}): PlanSlotContribution[] {
	if (
		!input.available ||
		input.requiredEnergyKwh === null ||
		!Number.isFinite(input.requiredEnergyKwh) ||
		input.requiredEnergyKwh <= 0 ||
		input.maxPowerW === null ||
		input.maxPowerW <= 0
	) {
		return [];
	}
	return [
		{
			slot: { startIso: input.generatedAt, endIso: input.generatedAt },
			minPowerW: null,
			preferredPowerW: null,
			maxPowerW: input.maxPowerW,
			requiredEnergyKwh: round3(input.requiredEnergyKwh),
			availableEnergyKwh: null,
			priceCtPerKwh: null,
			available: true,
			mandatory: input.mandatory === true,
			quality: input.quality,
		},
	];
}
