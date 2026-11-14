/**
 * Korrektur der PV-Prognose im Tagesverlauf.
 *
 * Der gelernte Bias gilt für ganze Tage. Liegt der Ist-Ertrag am Vormittag klar neben der
 * Prognose für denselben Zeitraum, wird der Rest des Tages mit einem Faktor skaliert. Grundlage
 * ist die Summe seit Tagesbeginn (nicht die Momentanleistung) — eine Wolke um 11 Uhr kippt den
 * Tag nicht. Reine Funktion, keine I/O.
 */

export type IntradaySlot = { startIso: string; endIso: string; pvPowerW: number };

/** Unter dieser erwarteten Energie seit Tagesbeginn wird nicht korrigiert (zu wenig Evidenz). */
export const INTRADAY_MIN_EXPECTED_KWH = 0.8;
/** Ab dieser erwarteten Energie wirkt die Korrektur mit vollem Gewicht. */
export const INTRADAY_FULL_WEIGHT_KWH = 2.5;
/** Begrenzung des Faktors: nach unten stark, nach oben vorsichtig. */
export const INTRADAY_MIN_FACTOR = 0.25;
export const INTRADAY_MAX_FACTOR = 1.25;

export type IntradayResult = {
	/** Multiplikator für Slots, die noch nicht vorbei sind (1 = keine Korrektur). */
	factor: number;
	expectedSoFarKwh: number;
	actualSoFarKwh: number | null;
	/** Gewicht 0..1, mit dem das Verhältnis Ist/Erwartet einfließt. */
	weight: number;
	active: boolean;
	reasonDe: string;
};

const NO_CORRECTION = (reasonDe: string, expected = 0, actual: number | null = null): IntradayResult => ({
	factor: 1,
	expectedSoFarKwh: expected,
	actualSoFarKwh: actual,
	weight: 0,
	active: false,
	reasonDe,
});

/** Erwartete PV-Energie (kWh) vom ersten Slot bis `nowMs`; angebrochene Slots anteilig. */
export function expectedEnergySoFarKwh(slots: IntradaySlot[], nowMs: number): number {
	let kwh = 0;
	for (const s of slots) {
		const start = Date.parse(s.startIso);
		const end = Date.parse(s.endIso);
		if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || start >= nowMs) continue;
		const elapsedMs = Math.min(end, nowMs) - start;
		kwh += (s.pvPowerW / 1000) * (elapsedMs / 3_600_000);
	}
	return kwh;
}

export function computeIntradayFactor(
	todaySlots: IntradaySlot[],
	actualTodayKwh: number | null,
	nowMs: number,
): IntradayResult {
	if (actualTodayKwh === null || !Number.isFinite(actualTodayKwh) || actualTodayKwh < 0) {
		return NO_CORRECTION("Kein gültiger Ist-Ertrag für heute.");
	}
	const expected = expectedEnergySoFarKwh(todaySlots, nowMs);
	if (expected < INTRADAY_MIN_EXPECTED_KWH) {
		return NO_CORRECTION("Noch zu wenig erwartete PV-Energie für eine Korrektur.", expected, actualTodayKwh);
	}
	const ratio = actualTodayKwh / expected;
	const weight = Math.min(1, expected / INTRADAY_FULL_WEIGHT_KWH);
	const raw = 1 + weight * (ratio - 1);
	const factor = Math.max(INTRADAY_MIN_FACTOR, Math.min(INTRADAY_MAX_FACTOR, raw));
	const rounded = Math.round(factor * 1000) / 1000;
	const active = Math.abs(rounded - 1) >= 0.03;
	return {
		factor: active ? rounded : 1,
		expectedSoFarKwh: Math.round(expected * 1000) / 1000,
		actualSoFarKwh: actualTodayKwh,
		weight: Math.round(weight * 1000) / 1000,
		active,
		reasonDe: active
			? `Ist ${actualTodayKwh.toFixed(2)} kWh gegen erwartet ${expected.toFixed(2)} kWh → Rest des Tages × ${rounded}.`
			: "Ist-Ertrag liegt im Rahmen der Prognose.",
	};
}

/** Skaliert nur Slots, die noch nicht vorbei sind. */
export function applyIntradayFactor<T extends IntradaySlot>(slots: T[], factor: number, nowMs: number): T[] {
	if (factor === 1) return slots;
	return slots.map((s) => (Date.parse(s.endIso) > nowMs ? { ...s, pvPowerW: s.pvPowerW * factor } : s));
}
