/**
 * Boiler = Warmwasser-Hard-Bedarf | Puffer = Soft-Speicher / Safety-Cap.
 * Keine zweite Planner-Engine — reine Input-Trennung für resolveThermalPlannerEnergy.
 */

import { IMMERSION_DEFAULT_KWH_PER_DEGREE_C } from "../../contributions/flexible/flex_demand";

const EPS = 1e-9;
const FLOOR_EPS = 0.05;

export type BoilerBufferBridgeInput = {
	nowMs: number;
	/** Brauchwasser-Sensor — alleinige Hard-Authority. */
	boilerTempC: number | null;
	boilerMinTempC: number | null;
	/** Puffer/Heizstabfühler — Soft-Headroom + Safety, nie Hard-Deadline. */
	bufferTempC: number | null;
	bufferMaxTempC: number | null;
	/** Soft-Headroom Richtung Puffer-Ziel/Max (Contribution). */
	softHeadroomEnergyKwh: number | null;
	/** Boiler-Kühlrate nur wenn Learning belastbar; sonst null → kein Fake-emptyAt. */
	boilerCoolingRateCPerH: number | null;
	/** Nur Boiler-emptyAt; Buffer-emptyAt hier nie einsetzen. */
	boilerEstimatedEmptyAtMs: number | null;
	boilerEmptyAtUsable: boolean;
	nextReliablePvMs: number | null;
	currentWindowEndMs?: number | null;
	pvConfidence01: number;
	kwhPerDegreeC?: number | null;
	/** Hygiene-Hard-Energie (Boiler → hygieneTarget), 0 wenn nicht fällig. */
	hygieneMandatoryKwh?: number | null;
	/** true wenn Boiler-Sensor fehlt/stale — Hard degradieren, kein Buffer-Fallback. */
	boilerSensorDegraded?: boolean;
};

export type BoilerBufferBridgeResult = {
	plannerEnergyKwh: number;
	mandatoryEnergyKwh: number;
	economicHeadroomKwh: number;
	coversUntilNextPv: boolean;
	coverUntilMs: number | null;
	reasonDe: string;
	/** Explizit: Hard kam nicht aus Puffer. */
	hardFromBoiler: boolean;
};

function round3(n: number): number {
	return Math.round(n * 1000) / 1000;
}

export function thermalHardCoverUntilMs(input: {
	nowMs: number;
	nextReliablePvMs: number | null;
	currentWindowEndMs?: number | null;
	/** Boiler-emptyAt — wenn nach Fensterende, aber vor nextReliablePv → Overnight-Lücke. */
	boilerEstimatedEmptyAtMs?: number | null;
}): number | null {
	const windowEnd = input.currentWindowEndMs;
	const nextPv = input.nextReliablePvMs;
	const emptyAt = input.boilerEstimatedEmptyAtMs;
	const windowOk =
		windowEnd != null && Number.isFinite(windowEnd) && windowEnd > input.nowMs + 60_000;
	const nextOk = nextPv != null && Number.isFinite(nextPv);
	const emptyOk =
		emptyAt != null && Number.isFinite(emptyAt) && emptyAt > input.nowMs + 60_000;
	/*
	 * Overnight-Lücke: emptyAt nach aktuellem Surplus-Fenster, aber vor nächstem PV.
	 * Cover nur bis Fensterende würde Hard=0 setzen („hält bis Cover“), obwohl die Nacht
	 * bis zum nächsten PV leer geht — Soft wandert dann auf Wochenend-PV.
	 */
	if (windowOk && nextOk && emptyOk && emptyAt! > windowEnd! && emptyAt! < nextPv!) {
		return nextPv!;
	}
	if (windowOk) {
		return windowEnd!;
	}
	if (nextOk) {
		return nextPv!;
	}
	return null;
}

/**
 * Soft-Headroom aus Puffer-Max − Puffer (physikalisch).
 * Contribution darf zusätzlich ein Soft-Ziel ≤ Max liefern — hier Cap.
 */
export function bufferSoftHeadroomKwh(input: {
	bufferTempC: number | null;
	bufferMaxTempC: number | null;
	softTargetTempC?: number | null;
	kwhPerDegreeC?: number | null;
}): number {
	if (
		input.bufferTempC === null ||
		input.bufferMaxTempC === null ||
		!(input.bufferMaxTempC > input.bufferTempC)
	) {
		return 0;
	}
	const cap = input.bufferMaxTempC;
	const target =
		input.softTargetTempC != null && Number.isFinite(input.softTargetTempC)
			? Math.min(cap, Math.max(input.bufferTempC, input.softTargetTempC))
			: cap;
	const delta = Math.max(0, target - input.bufferTempC);
	const k = input.kwhPerDegreeC != null && input.kwhPerDegreeC > 0 ? input.kwhPerDegreeC : IMMERSION_DEFAULT_KWH_PER_DEGREE_C;
	return round3(delta * k);
}

/**
 * Hard-Bridge nur aus Boiler. Puffer erzeugt keinen Warmwasser-Hard-Bedarf.
 * Fehlendes Boiler-Learning → keine Fake-emptyAt-Deadline; nur Temp vs Min.
 */
export function resolveBoilerBufferThermalEnergy(input: BoilerBufferBridgeInput): BoilerBufferBridgeResult {
	const kwhPerC =
		input.kwhPerDegreeC != null && input.kwhPerDegreeC > 0
			? input.kwhPerDegreeC
			: IMMERSION_DEFAULT_KWH_PER_DEGREE_C;
	const conf = Number.isFinite(input.pvConfidence01)
		? Math.max(0.2, Math.min(1, input.pvConfidence01))
		: 0.7;

	const softFromContrib =
		input.softHeadroomEnergyKwh !== null && Number.isFinite(input.softHeadroomEnergyKwh)
			? Math.max(0, input.softHeadroomEnergyKwh)
			: 0;
	const softFromBuffer = bufferSoftHeadroomKwh({
		bufferTempC: input.bufferTempC,
		bufferMaxTempC: input.bufferMaxTempC,
		kwhPerDegreeC: kwhPerC,
	});
	/** Contribution-Headroom bevorzugen wenn gesetzt, sonst physikalisches Puffer-Max. */
	const softBase = softFromContrib > EPS ? softFromContrib : softFromBuffer;

	const hygiene = Math.max(0, input.hygieneMandatoryKwh ?? 0);

	if (input.boilerSensorDegraded || input.boilerTempC === null || input.boilerMinTempC === null) {
		return {
			plannerEnergyKwh: round3(softBase + hygiene),
			mandatoryEnergyKwh: round3(hygiene),
			economicHeadroomKwh: round3(softBase),
			coversUntilNextPv: true,
			coverUntilMs: null,
			reasonDe: input.boilerSensorDegraded
				? "Boiler-Sensor fehlt/stale — kein Buffer-Hard-Fallback; Soft aus Puffer, Hygiene falls fällig."
				: "Boiler-Temperatur fehlt — kein Hard-Warmwasserbedarf aus Puffer.",
			hardFromBoiler: false,
		};
	}

	const coverUntilMs = thermalHardCoverUntilMs({
		nowMs: input.nowMs,
		nextReliablePvMs: input.nextReliablePvMs,
		currentWindowEndMs: input.currentWindowEndMs,
		boilerEstimatedEmptyAtMs:
			input.boilerEmptyAtUsable === true ? input.boilerEstimatedEmptyAtMs : null,
	});
	let hard = 0;
	let covers = true;
	let reasonDe = "";

	/** Sofort-Hard: Boiler unter Mindesttemperatur. */
	if (input.boilerTempC < input.boilerMinTempC - FLOOR_EPS) {
		hard = Math.max(0, input.boilerMinTempC - input.boilerTempC) * kwhPerC;
		covers = false;
		reasonDe = `Boiler ${input.boilerTempC.toFixed(1)} °C unter Min ${input.boilerMinTempC} °C — Hard-Warmwasser.`;
	} else if (
		/** Cover-/emptyAt-Hard nur mit belastbarem Boiler-Learning — nie aus erfundener Rate. */
		input.boilerEmptyAtUsable === true &&
		coverUntilMs !== null &&
		coverUntilMs >= input.nowMs - 60_000 &&
		input.boilerCoolingRateCPerH !== null &&
		input.boilerCoolingRateCPerH > 0
	) {
		const hoursToCover = (coverUntilMs - input.nowMs) / 3600_000;
		const emptyAtKnown =
			input.boilerEstimatedEmptyAtMs !== null &&
			Number.isFinite(input.boilerEstimatedEmptyAtMs) &&
			input.boilerEstimatedEmptyAtMs > input.nowMs;

		if (emptyAtKnown && input.boilerEstimatedEmptyAtMs! >= coverUntilMs - 60_000) {
			hard = 0;
			covers = true;
			reasonDe = `Boiler-emptyAt nach Cover — Hard ~0, Soft aus Puffer.`;
		} else {
			const tempAtCover =
				input.boilerTempC - input.boilerCoolingRateCPerH * Math.max(0, hoursToCover);
			const marginK =
				conf < 0.7
					? input.boilerCoolingRateCPerH * Math.max(0, hoursToCover) * ((0.7 - conf) / 0.7) * 0.5
					: 0;
			covers = tempAtCover >= input.boilerMinTempC + marginK - FLOOR_EPS;
			if (!covers) {
				hard = Math.max(0, input.boilerMinTempC + marginK - tempAtCover) * kwhPerC;
				reasonDe = `Boiler-Hard-Bridge ~${round3(hard).toFixed(2)} kWh bis Cover.`;
			} else {
				hard = marginK * kwhPerC;
				reasonDe = `Boiler hält bis Cover — Hard ~0, Soft aus Puffer.`;
			}
		}
	} else {
		/**
		 * Kein belastbares Boiler-Cooling/emptyAt:
		 * nur aktuelle Temp vs Min — kein Fake-Abend-Deadline aus Puffer.
		 */
		hard = 0;
		covers = true;
		reasonDe =
			"Boiler über Min, Learning noch nicht belastbar — kein Fake-emptyAt-Hard; Soft aus Puffer.";
	}

	const mandatory = round3(hard + hygiene);
	if (hygiene > EPS) {
		reasonDe = `${reasonDe} Hygiene-Hard +${round3(hygiene).toFixed(2)} kWh.`.trim();
	}

	return {
		plannerEnergyKwh: round3(mandatory + softBase),
		mandatoryEnergyKwh: mandatory,
		economicHeadroomKwh: round3(softBase),
		coversUntilNextPv: covers && hygiene <= EPS,
		coverUntilMs,
		reasonDe,
		hardFromBoiler: hard > EPS || hygiene > EPS,
	};
}
