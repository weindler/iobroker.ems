/**
 * LocalThings Leistung: Vorhandensein eines Power-States ≠ echte Messung.
 * Bei AC an und power≈0 nicht Learning/Leistung auf 0 setzen.
 */

export type LocalthingsPowerDecision =
	| { useMeasured: true; powerW: number }
	| { useMeasured: false; reason: "missing" | "implausible_zero_while_on" | "invalid" };

export function resolveLocalthingsMeasuredPowerW(input: {
	rawPowerW: number | null;
	acConfirmedOn: boolean;
	/** Untergrenze für „echte“ Messung während Betrieb (W). */
	minPlausibleOnW?: number;
}): LocalthingsPowerDecision {
	const minOn = input.minPlausibleOnW ?? 50;
	const p = input.rawPowerW;
	if (p === null || !Number.isFinite(p) || p < 0) {
		return { useMeasured: false, reason: p === null ? "missing" : "invalid" };
	}
	if (input.acConfirmedOn && p < minOn) {
		return { useMeasured: false, reason: "implausible_zero_while_on" };
	}
	return { useMeasured: true, powerW: Math.round(p) };
}
