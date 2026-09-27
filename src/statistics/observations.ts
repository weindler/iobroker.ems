import type { StatisticsDayRecord, StatisticsPersist } from "./types";

export function observeDay(day: StatisticsDayRecord, now: Date, soc: number | null,
	importReading: number | null, exportReading: number | null): void {
	const atIso = now.toISOString();
	if (soc !== null && Number.isFinite(soc) && soc >= 0 && soc <= 100 &&
		(!day.batteryMinimum || soc < day.batteryMinimum.socPct)) day.batteryMinimum = { socPct: soc, atIso };
	for (const [key, value] of [["import", importReading], ["export", exportReading]] as const) {
		if (value === null || !Number.isFinite(value) || value < 0) continue;
		day.meter ??= {};
		const old = day.meter[key];
		if (old && atIso < old.atIso) continue;
		day.meter[key] = { firstKwh: old?.firstKwh ?? value, firstAtIso: old?.firstAtIso ?? atIso,
			lastKwh: value, atIso, resetDetected: old?.resetDetected === true || !!(old && value < old.lastKwh - 0.05) };
	}
}

const shiftDay = (key: string, amount: number): string => {
	const date = new Date(`${key}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + amount); return date.toISOString().slice(0, 10);
};

/** Calendar comparison. Running days are explicitly compared with completed prior days. */
export function meterComparison(persist: StatisticsPersist, fromKey: string, toKey: string, period: string) {
	const span = Math.round((Date.parse(`${toKey}T12:00:00Z`) - Date.parse(`${fromKey}T12:00:00Z`)) / 86400000) + 1;
	const monthShift = /year/.test(period) ? 12 : /quarter/.test(period) ? 3 : /month/.test(period) ? 1 : 0;
	const shiftCalendar = (key: string): string => {
		if (!monthShift) return shiftDay(key, -span);
		const date = new Date(`${key.slice(0, 7)}-01T12:00:00Z`); date.setUTCMonth(date.getUTCMonth() - monthShift);
		const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
		return `${date.toISOString().slice(0, 7)}-${String(Math.min(Number(key.slice(8)), last)).padStart(2, "0")}`;
	};
	const previousFrom = shiftCalendar(fromKey), previousTo = shiftCalendar(toKey);
	const totals = (from: string, to: string, field: "gridImportKwh" | "gridExportKwh"): number | null => {
		let total = 0;
		for (let key = from; key <= to; key = shiftDay(key, 1)) {
			const value = persist.days[key]?.home[field];
			if (value == null || !Number.isFinite(value)) return null;
			total += value;
		}
		return Math.round(total * 1000) / 1000;
	};
	const compare = (field: "gridImportKwh" | "gridExportKwh") => {
		const current = totals(fromKey, toKey, field), previous = totals(previousFrom, previousTo, field);
		return { current, previous, deltaKwh: current == null || previous == null ? null : Math.round((current - previous) * 1000) / 1000,
			deltaPct: current == null || previous == null || previous === 0 ? null : (current - previous) / previous * 100 };
	};
	return { fromKey, toKey, previousFrom, previousTo, import: compare("gridImportKwh"), export: compare("gridExportKwh"),
		first: persist.days[fromKey]?.meter ?? null, last: persist.days[toKey]?.meter ?? null,
		provisional: toKey === persist.runtime.dateKey,
		noteDe: toKey === persist.runtime.dateKey ? "Laufender Zeitraum; Vergleich mit abgeschlossenen Tagen des Vorzeitraums, nicht uhrzeitgleich." : "Vergleich abgeschlossener Kalendertage; fehlende Werte bleiben offen." };
}
