/**
 * Verlauf des Vergleichstarifs: vergangene Tage behalten den Preis, der damals galt.
 * Ändert sich Preis oder Grundpreis, beginnt ab dem Änderungstag ein neuer Eintrag.
 */
export interface CompareTariffEntry {
	/** Gilt ab diesem Tag (YYYY-MM-DD), „0000-00-00“ = von Anfang an. */
	from: string;
	ctPerKwh: number | null;
	monthlyBaseEur: number;
}

export const HISTORY_START = "0000-00-00";
const MAX_ENTRIES = 120;

export function parseCompareTariffHistory(raw: unknown): CompareTariffEntry[] {
	try {
		const a = typeof raw === "string" ? JSON.parse(raw) : null;
		if (!Array.isArray(a)) return [];
		const out: CompareTariffEntry[] = [];
		for (const e of a) {
			if (!e || typeof e !== "object") continue;
			const r = e as Record<string, unknown>;
			if (typeof r.from !== "string" || !/^(\d{4}-\d{2}-\d{2})$/.test(r.from)) continue;
			const ct = typeof r.ctPerKwh === "number" && Number.isFinite(r.ctPerKwh) ? r.ctPerKwh : null;
			const base = typeof r.monthlyBaseEur === "number" && Number.isFinite(r.monthlyBaseEur) ? r.monthlyBaseEur : 0;
			out.push({ from: r.from, ctPerKwh: ct, monthlyBaseEur: base });
		}
		return out.sort((x, y) => x.from.localeCompare(y.from));
	} catch {
		return [];
	}
}

/** Neuen Eintrag anhängen, wenn sich der wirksame Preis gegenüber dem letzten geändert hat. */
export function recordCompareTariff(
	history: CompareTariffEntry[],
	todayKey: string,
	ctPerKwh: number | null,
	monthlyBaseEur: number,
): { history: CompareTariffEntry[]; changed: boolean } {
	const base = Math.max(0, monthlyBaseEur || 0);
	const last = history[history.length - 1];
	if (!last) {
		return { history: [{ from: HISTORY_START, ctPerKwh, monthlyBaseEur: base }], changed: true };
	}
	if (last.ctPerKwh === ctPerKwh && last.monthlyBaseEur === base) return { history, changed: false };
	let next = history.slice();
	if (last.from === todayKey) next[next.length - 1] = { from: todayKey, ctPerKwh, monthlyBaseEur: base };
	else next.push({ from: todayKey, ctPerKwh, monthlyBaseEur: base });
	if (next.length > MAX_ENTRIES) next = next.slice(next.length - MAX_ENTRIES);
	return { history: next, changed: true };
}

function toDay(key: string): number {
	return Date.parse(`${key}T12:00:00Z`) / 86400000;
}

/**
 * Tagesgewichteter Preis über [fromKey,toKey]. Ohne Verlauf: Fallback (aktuelle Konfiguration).
 * Fehlt in Teilen des Zeitraums ein Preis, gilt das Ergebnis als unbekannt (null).
 */
export function tariffForRange(
	history: CompareTariffEntry[],
	fromKey: string,
	toKey: string,
	fallback: { ctPerKwh: number | null; monthlyBaseEur: number },
): { ctPerKwh: number | null; monthlyBaseEur: number } {
	if (!history.length) return fallback;
	const a = toDay(fromKey);
	const b = toDay(toKey);
	if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return fallback;
	let ctSum = 0;
	let baseSum = 0;
	let n = 0;
	for (let d = a; d <= b; d += 1) {
		const key = new Date(d * 86400000).toISOString().slice(0, 10);
		let e: CompareTariffEntry | undefined;
		for (const h of history) {
			if (h.from <= key) e = h;
			else break;
		}
		if (!e || e.ctPerKwh === null) return { ctPerKwh: null, monthlyBaseEur: fallback.monthlyBaseEur };
		ctSum += e.ctPerKwh;
		baseSum += e.monthlyBaseEur;
		n += 1;
	}
	if (!n) return fallback;
	return { ctPerKwh: Math.round((ctSum / n) * 1000) / 1000, monthlyBaseEur: Math.round((baseSum / n) * 1000) / 1000 };
}
