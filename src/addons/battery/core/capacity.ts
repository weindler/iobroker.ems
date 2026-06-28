import type {
	BatteryCapacityResult,
	BatteryEnergyDerived,
	CapacitySource,
} from "./types";

/** Ungültig: null, NaN, Infinity, <= 0. */
export function isValidCapacityKwh(value: number | null | undefined): value is number {
	return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export interface CapacityInputs {
	source: CapacitySource;
	manualKwh: number | null;
	mappedKwh: number | null;
}

/**
 * Priorität:
 * 1. gültiger gemappter Wert, wenn Mapping-Quelle gewählt
 * 2. gültiger manueller Wert
 * 3. unknown
 * Ein ungültiger Wert wird niemals verwendet (und nie als 0 kWh behandelt).
 */
export function resolveCapacity(inputs: CapacityInputs): BatteryCapacityResult {
	const manual = isValidCapacityKwh(inputs.manualKwh) ? inputs.manualKwh : null;
	const mapped = isValidCapacityKwh(inputs.mappedKwh) ? inputs.mappedKwh : null;

	if (inputs.source === "mapped" && mapped !== null) {
		return { manualKwh: manual, mappedKwh: mapped, effectiveKwh: mapped, source: "mapped", valid: true };
	}
	if (manual !== null) {
		return { manualKwh: manual, mappedKwh: mapped, effectiveKwh: manual, source: "manual", valid: true };
	}
	return { manualKwh: manual, mappedKwh: mapped, effectiveKwh: null, source: "unknown", valid: false };
}

/** Energieableitungen nur bei gültigem SOC und gültiger Kapazität. */
export function deriveEnergy(
	socPct: number | null,
	capacityNetKwh: number | null,
	minSocPct: number | null,
): BatteryEnergyDerived {
	const empty: BatteryEnergyDerived = {
		energyStoredKwh: null,
		energyFreeToFullKwh: null,
		energyAboveTechnicalMinKwh: null,
	};
	if (
		socPct === null ||
		!Number.isFinite(socPct) ||
		socPct < 0 ||
		socPct > 100 ||
		!isValidCapacityKwh(capacityNetKwh)
	) {
		return empty;
	}
	const stored = (socPct / 100) * capacityNetKwh;
	const free = capacityNetKwh - stored;
	let aboveMin: number | null = null;
	if (minSocPct !== null && Number.isFinite(minSocPct) && minSocPct >= 0 && minSocPct <= 100) {
		aboveMin = Math.max(0, ((socPct - minSocPct) / 100) * capacityNetKwh);
	}
	return {
		energyStoredKwh: round3(stored),
		energyFreeToFullKwh: round3(Math.max(0, free)),
		energyAboveTechnicalMinKwh: aboveMin === null ? null : round3(aboveMin),
	};
}

function round3(n: number): number {
	return Math.round(n * 1000) / 1000;
}
