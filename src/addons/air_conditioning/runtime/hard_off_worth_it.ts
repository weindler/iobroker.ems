/**
 * Hard-Off-Restzeit vs. Komfortbedarf — verhindert einen Start kurz vor der Zwangsabschaltung,
 * ohne eine starre „nie unter X Minuten“-Regel: bei starkem Komfortbedarf sinkt die geforderte
 * Mindestlaufzeit gegen 0 (Start bleibt möglich). Reine Zeit-Arithmetik, reuse von
 * `parseClockToMinutes` (time.ts) — keine zweite Uhrzeit-Logik.
 */

import { parseClockToMinutes } from "./time";

/** Referenz-Mindestlaufzeit (Minuten) bei neutralem (0) Komfortbedarf. */
export const AC_MIN_WORTHWHILE_RUNTIME_MIN_DEFAULT = 20;
/** Temperatur-Spanne (K) über der Ein-Schwelle, die volle (1.0) Dringlichkeit ergibt. */
export const AC_URGENCY_REFERENCE_TEMP_K_DEFAULT = 2;
/** Feuchte-Spanne (%-Punkte) über der Max-Schwelle, die volle (1.0) Dringlichkeit ergibt. */
export const AC_URGENCY_REFERENCE_HUMIDITY_PCT_DEFAULT = 10;

function clamp01(n: number): number {
	if (!Number.isFinite(n)) return 0;
	return Math.max(0, Math.min(1, n));
}

/** Minuten bis zur konfigurierten Hard-Off-Uhrzeit; null = kein gültiger Hard-Off konfiguriert. */
export function minutesUntilHardOff(nowMin: number, hardOffRaw: string): number | null {
	const off = parseClockToMinutes(hardOffRaw);
	if (off === null) return null;
	const diff = off - nowMin;
	return diff >= 0 ? diff : diff + 24 * 60;
}

/** Dringlichkeit aus Temperatur-Überschreitung (0 = an Schwelle, 1 = ≥ Referenz-Spanne drüber). */
export function coolingDemandUrgency01(
	roomTempC: number | null,
	onTempC: number,
	referenceK = AC_URGENCY_REFERENCE_TEMP_K_DEFAULT,
): number {
	if (roomTempC === null || !(referenceK > 0)) return 0;
	return clamp01((roomTempC - onTempC) / referenceK);
}

/** Dringlichkeit aus Feuchte-Überschreitung (0 = an Schwelle, 1 = ≥ Referenz-Spanne drüber). */
export function dehumidifyDemandUrgency01(
	roomHumidityPct: number | null,
	maxHumidityPct: number | null,
	referencePct = AC_URGENCY_REFERENCE_HUMIDITY_PCT_DEFAULT,
): number {
	if (roomHumidityPct === null || maxHumidityPct === null || !(referencePct > 0)) return 0;
	return clamp01((roomHumidityPct - maxHumidityPct) / referencePct);
}

export type HardOffWorthItInput = {
	/** null = kein Hard-Off konfiguriert/relevant → immer wirtschaftlich. */
	remainingMinutesUntilHardOff: number | null;
	/** 0..1 — aktuelle Komfort-Dringlichkeit (Temperatur/Feuchte, je nach modePurpose). */
	demandUrgency01: number;
	minWorthwhileRuntimeMin?: number;
};

export type HardOffWorthItResult = {
	worthwhile: boolean;
	requiredMinutes: number;
	reasonDe: string;
};

/**
 * Kein blindes Starten kurz vor Hard-Off, aber keine starre Schwelle: die geforderte
 * Mindestlaufzeit schrumpft linear mit steigender Dringlichkeit auf 0 (volle Dringlichkeit
 * erlaubt jeden Start, auch unmittelbar vor Hard-Off).
 */
export function isHardOffStartWorthwhile(input: HardOffWorthItInput): HardOffWorthItResult {
	if (input.remainingMinutesUntilHardOff === null) {
		return { worthwhile: true, requiredMinutes: 0, reasonDe: "" };
	}
	const urgency = clamp01(input.demandUrgency01);
	const base = input.minWorthwhileRuntimeMin ?? AC_MIN_WORTHWHILE_RUNTIME_MIN_DEFAULT;
	const requiredMinutes = Math.round(base * (1 - urgency));
	const worthwhile = input.remainingMinutesUntilHardOff >= requiredMinutes;
	return {
		worthwhile,
		requiredMinutes,
		reasonDe: worthwhile
			? ""
			: `Hard-Off in ${input.remainingMinutesUntilHardOff} Min — bei aktuellem Komfortbedarf (${Math.round(urgency * 100)} %) wären mind. ${requiredMinutes} Min nötig, Start zurückgestellt.`,
	};
}
