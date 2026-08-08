import type { OperatorDataQuality, PlanSlotContribution } from "../../types";
import { round3 } from "./types";

/** Conservative electrical kWh per °C (~300 L buffer) when no volume is configured. */
export const IMMERSION_DEFAULT_KWH_PER_DEGREE_C = 0.38;

const MAX_HEATING_HOURS_PER_DAY = 18;

/**
 * Sicherheitsmarge gegen gelernten Wärmeverlust (ein Daily-Plan-Slot = 15 min), bis die
 * Allocation den Heizstab tatsächlich einschalten kann. Nur genutzt, wenn Thermal-Runtime-Learning
 * (`learning.thermal_runtime.*`) ein belastbares Modell liefert (`status === "valid"`).
 */
const LEARNED_LOSS_MARGIN_HOURS = 0.25;

export interface ImmersionLearningMargin {
	status: "valid" | "degraded" | "missing";
	coolingRateCPerHAvg: number | null;
	/**
	 * Geglätteter kWh/°C-Faktor aus Day-Evaluation (Schritt 7), nur wenn Sample-Bounds erfüllt.
	 * null → Default 0.38. Bounds werden im Learning-Modul erzwungen.
	 */
	kwhPerDegreeC?: number | null;
}

export function estimateImmersionRequiredEnergyKwh(
	bufferTempC: number,
	targetTempC: number,
	maxPowerW: number | null,
	learning?: ImmersionLearningMargin | null,
): number {
	const delta = targetTempC - bufferTempC;
	if (delta <= 0) return 0;
	const kwhPerC =
		learning?.kwhPerDegreeC !== null &&
		learning?.kwhPerDegreeC !== undefined &&
		Number.isFinite(learning.kwhPerDegreeC) &&
		learning.kwhPerDegreeC > 0
			? learning.kwhPerDegreeC
			: IMMERSION_DEFAULT_KWH_PER_DEGREE_C;
	let kwh = round3(delta * kwhPerC);

	if (learning?.status === "valid" && learning.coolingRateCPerHAvg !== null && learning.coolingRateCPerHAvg > 0) {
		const projectedLossC = round3(learning.coolingRateCPerHAvg * LEARNED_LOSS_MARGIN_HOURS);
		kwh = round3(kwh + projectedLossC * kwhPerC);
	}

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
	/** Kleinste fahrbare Leistung; null = keine Untergrenze in der Allocation. */
	minPowerW?: number | null;
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
	const minPowerW =
		input.minPowerW !== null &&
		input.minPowerW !== undefined &&
		Number.isFinite(input.minPowerW) &&
		input.minPowerW > 0
			? input.minPowerW
			: null;
	return [
		{
			slot: { startIso: input.generatedAt, endIso: input.generatedAt },
			minPowerW,
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
