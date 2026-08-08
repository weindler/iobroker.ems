/**
 * House-Load-Baseline = gemessene Gesamtlast − bekannte EMS-Flex-Lasten.
 * Flexible Verbraucher werden separat im Unified modelliert — keine Doppelzählung.
 */

export type KnownFlexibleEmsLoadsW = {
	/** Summe aller AC-Units (einzeln addieren bevor übergeben, oder hier pro Unit). */
	climateW?: number | null;
	/** Pro-Unit Klima, falls einzeln bekannt — wird zu climateW addiert. */
	climateUnitsW?: Array<number | null | undefined>;
	immersionHeaterW?: number | null;
	wallboxChargeW?: number | null;
	/** Nur Laden, sofern in House-Load-Messung enthalten. */
	batteryChargeW?: number | null;
	/** Entladen typisch nicht in Verbrauch — nur abziehen wenn nachweislich enthalten. */
	batteryDischargeInHouseLoadW?: number | null;
};

export type HouseLoadDecomposeQuality = "full" | "partial" | "none";

export type HouseLoadDecomposeResult = {
	/** max(0, total − knownFlex) */
	baselineW: number | null;
	totalMeasuredW: number | null;
	subtractedW: number;
	/** Welche Lasten abgezogen wurden. */
	subtractedParts: Array<{ id: string; powerW: number }>;
	/** Fehlende/ungültige Flex-Telemetrie (nicht geschätzt). */
	missingParts: string[];
	quality: HouseLoadDecomposeQuality;
	reasonDe: string;
};

function finiteNonNeg(w: number | null | undefined): w is number {
	return w != null && Number.isFinite(w) && w >= 0;
}

/** Summiert bekannte Flex-Lasten; ungültige Teile → missing, nicht geraten. */
export function sumKnownFlexibleEmsLoadsW(loads: KnownFlexibleEmsLoadsW): {
	sumW: number;
	parts: Array<{ id: string; powerW: number }>;
	missing: string[];
} {
	const parts: Array<{ id: string; powerW: number }> = [];
	const missing: string[] = [];

	// Units bevorzugen — climateW nur wenn keine Unit-Liste (keine Doppelzählung U1+U2).
	if (loads.climateUnitsW && loads.climateUnitsW.length > 0) {
		for (let i = 0; i < loads.climateUnitsW.length; i++) {
			const w = loads.climateUnitsW[i];
			if (finiteNonNeg(w)) {
				parts.push({ id: `climate.unit_${i + 1}`, powerW: Math.round(w) });
			} else if (w === null) {
				missing.push(`climate.unit_${i + 1}`);
			}
		}
	} else if (finiteNonNeg(loads.climateW)) {
		parts.push({ id: "climate", powerW: Math.round(loads.climateW) });
	} else if (loads.climateW === null) {
		missing.push("climate");
	}

	const add = (id: string, w: number | null | undefined) => {
		if (finiteNonNeg(w)) {
			parts.push({ id, powerW: Math.round(w) });
		} else if (w === null) {
			missing.push(id);
		}
	};
	add("immersion_heater", loads.immersionHeaterW);
	add("wallbox", loads.wallboxChargeW);
	add("battery_charge", loads.batteryChargeW);
	add("battery_discharge_in_house", loads.batteryDischargeInHouseLoadW);

	// climateUnits already in parts; if only climateW without units, already pushed
	const sumFromParts = parts.reduce((s, p) => s + p.powerW, 0);
	return { sumW: sumFromParts, parts, missing };
}

/**
 * baseline = totalMeasured − knownFlex, nie unter 0.
 * Fehlt total → baseline null. Fehlt Flex-Telemetrie → nicht schätzen (quality partial/none).
 */
export function decomposeHouseLoadBaselineW(
	totalMeasuredW: number | null | undefined,
	loads: KnownFlexibleEmsLoadsW,
): HouseLoadDecomposeResult {
	if (!finiteNonNeg(totalMeasuredW)) {
		return {
			baselineW: null,
			totalMeasuredW: totalMeasuredW ?? null,
			subtractedW: 0,
			subtractedParts: [],
			missingParts: [],
			quality: "none",
			reasonDe: "Keine gültige Gesamt-Hauslast — Baseline nicht ableitbar.",
		};
	}
	const { sumW, parts, missing } = sumKnownFlexibleEmsLoadsW(loads);
	const baseline = Math.max(0, Math.round(totalMeasuredW) - sumW);
	let quality: HouseLoadDecomposeQuality = "full";
	if (missing.length > 0 && parts.length > 0) quality = "partial";
	else if (missing.length > 0 && parts.length === 0) quality = "none";
	else if (parts.length === 0) quality = "none";

	const reasonDe =
		parts.length === 0
			? missing.length > 0
				? `Keine belastbare Flex-Telemetrie (${missing.join(", ")}) — Baseline = Gesamtlast, Qualität markiert.`
				: "Keine Flex-Lasten übergeben — Baseline = Gesamtlast."
			: missing.length > 0
				? `Baseline ${baseline} W = ${Math.round(totalMeasuredW)} − ${sumW} W Flex; fehlend: ${missing.join(", ")}.`
				: `Baseline ${baseline} W = ${Math.round(totalMeasuredW)} − ${sumW} W bekannte EMS-Flex-Lasten.`;

	return {
		baselineW: baseline,
		totalMeasuredW: Math.round(totalMeasuredW),
		subtractedW: sumW,
		subtractedParts: parts,
		missingParts: missing,
		quality,
		reasonDe,
	};
}

/**
 * Sample-Leistung (Learning) dekomponieren, wenn Flex-Ist für denselben Zeitpunkt bekannt.
 * Ohne Flex-Werte: Sample unverändert, quality none.
 */
export function decomposeSamplePowerW(
	samplePowerW: number,
	loads: KnownFlexibleEmsLoadsW,
): { powerW: number; result: HouseLoadDecomposeResult } {
	const result = decomposeHouseLoadBaselineW(samplePowerW, loads);
	return {
		powerW: result.baselineW ?? Math.max(0, Math.round(samplePowerW)),
		result,
	};
}

/** Wendet Dekomposition auf Samples an, wenn für hourStartMs Flex-Ist vorhanden. */
export function applyFlexDecompositionToSamples(
	samples: Array<{ hourStartMs: number; powerW: number }>,
	flexByHourStartMs: Map<number, KnownFlexibleEmsLoadsW>,
): {
	samples: Array<{ hourStartMs: number; powerW: number }>;
	decomposedCount: number;
	partialCount: number;
} {
	let decomposedCount = 0;
	let partialCount = 0;
	const out = samples.map((s) => {
		const flex = flexByHourStartMs.get(s.hourStartMs);
		if (!flex) return s;
		const { powerW, result } = decomposeSamplePowerW(s.powerW, flex);
		if (result.subtractedW > 0) decomposedCount++;
		if (result.quality === "partial") partialCount++;
		return { ...s, powerW };
	});
	return { samples: out, decomposedCount, partialCount };
}
