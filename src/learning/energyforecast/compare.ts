/**
 * Energyforecast: festgehaltene Prognosen gegen die später bekannten echten Preise (price_origin "market").
 * Gemessen wird je Vorlauf (Tage zwischen Abruf und Zieltag): Fehler, Spreizung und ob die günstigsten
 * Viertelstunden richtig liegen — für die Planung zählt die Reihenfolge mehr als der exakte Preis.
 */
import { localDay } from "./parse";

export const CHEAP_SLOT_COUNT = 16;
/** Ein Tag zählt nur mit annähernd vollständigen Daten (22 h). */
export const MIN_SLOTS_PER_DAY = 88;

export type EfSnapshot = {
	atMs: number;
	/** [startMs, totalCt] nur Slots, die zum Abrufzeitpunkt noch Prognose waren. */
	slots: Array<[number, number]>;
};

export type EfDayLeadStats = {
	date: string;
	leadDays: number;
	slots: number;
	maeCt: number;
	biasCt: number;
	forecastSpreadCt: number;
	actualSpreadCt: number;
	cheapHitPct: number;
};

export type EfLeadSummary = {
	leadDays: number;
	days: number;
	maeCt: number;
	biasCt: number;
	forecastSpreadCt: number;
	actualSpreadCt: number;
	cheapHitPct: number;
};

export type EfCompareResult = {
	perDay: EfDayLeadStats[];
	perLead: EfLeadSummary[];
	/** Bias je lokaler Stunde (Vorlauf 1 Tag), + = Prognose zu hoch. */
	biasByHour: Array<{ hour: number; biasCt: number; slots: number }>;
};

function r2(n: number): number {
	return Math.round(n * 100) / 100;
}

function dayDiff(a: string, b: string): number {
	const pa = a.split("-").map(Number);
	const pb = b.split("-").map(Number);
	return Math.round((Date.UTC(pa[0], pa[1] - 1, pa[2]) - Date.UTC(pb[0], pb[1] - 1, pb[2])) / 86_400_000);
}

function cheapestStarts(entries: Array<[number, number]>, n: number): Set<number> {
	return new Set([...entries].sort((x, y) => x[1] - y[1] || x[0] - y[0]).slice(0, n).map((e) => e[0]));
}

export function compareSnapshots(
	snapshots: EfSnapshot[],
	actual: Record<string, number>,
	maxDays = 14,
): EfCompareResult {
	// Je (Zieltag, Vorlauf) den letzten Snapshot des jeweiligen Abruftags verwenden.
	const best = new Map<string, { snap: EfSnapshot; date: string; lead: number }>();
	for (const snap of [...snapshots].sort((a, b) => a.atMs - b.atMs)) {
		const snapDay = localDay(snap.atMs);
		const targets = new Set(snap.slots.map(([s]) => localDay(s)));
		for (const date of targets) {
			const lead = dayDiff(date, snapDay);
			if (lead < 1) continue;
			best.set(`${date}|${lead}`, { snap, date, lead });
		}
	}

	const perDay: EfDayLeadStats[] = [];
	const hourBias = new Map<number, { sum: number; n: number }>();
	for (const { snap, date, lead } of best.values()) {
		const pairs: Array<{ start: number; f: number; a: number }> = [];
		for (const [start, f] of snap.slots) {
			if (localDay(start) !== date) continue;
			const a = actual[String(start)];
			if (typeof a === "number" && Number.isFinite(a)) pairs.push({ start, f, a });
		}
		if (pairs.length < MIN_SLOTS_PER_DAY) continue;
		let abs = 0;
		let bias = 0;
		for (const p of pairs) {
			abs += Math.abs(p.f - p.a);
			bias += p.f - p.a;
			if (lead === 1) {
				const h = new Date(p.start).getHours();
				const cur = hourBias.get(h) ?? { sum: 0, n: 0 };
				cur.sum += p.f - p.a;
				cur.n++;
				hourBias.set(h, cur);
			}
		}
		const fv = pairs.map((p) => p.f);
		const av = pairs.map((p) => p.a);
		const fc = cheapestStarts(pairs.map((p) => [p.start, p.f]), CHEAP_SLOT_COUNT);
		const ac = cheapestStarts(pairs.map((p) => [p.start, p.a]), CHEAP_SLOT_COUNT);
		let hit = 0;
		for (const s of fc) if (ac.has(s)) hit++;
		perDay.push({
			date,
			leadDays: lead,
			slots: pairs.length,
			maeCt: r2(abs / pairs.length),
			biasCt: r2(bias / pairs.length),
			forecastSpreadCt: r2(Math.max(...fv) - Math.min(...fv)),
			actualSpreadCt: r2(Math.max(...av) - Math.min(...av)),
			cheapHitPct: Math.round((hit / CHEAP_SLOT_COUNT) * 100),
		});
	}

	perDay.sort((a, b) => a.date.localeCompare(b.date) || a.leadDays - b.leadDays);
	const recentDates = [...new Set(perDay.map((d) => d.date))].slice(-maxDays);
	const recent = perDay.filter((d) => recentDates.includes(d.date));

	const leads = [...new Set(recent.map((d) => d.leadDays))].sort((a, b) => a - b);
	const perLead: EfLeadSummary[] = leads.map((lead) => {
		const rows = recent.filter((d) => d.leadDays === lead);
		const avg = (pick: (d: EfDayLeadStats) => number) => r2(rows.reduce((s, d) => s + pick(d), 0) / rows.length);
		return {
			leadDays: lead,
			days: rows.length,
			maeCt: avg((d) => d.maeCt),
			biasCt: avg((d) => d.biasCt),
			forecastSpreadCt: avg((d) => d.forecastSpreadCt),
			actualSpreadCt: avg((d) => d.actualSpreadCt),
			cheapHitPct: Math.round(rows.reduce((s, d) => s + d.cheapHitPct, 0) / rows.length),
		};
	});
	const biasByHour = [...hourBias.entries()]
		.sort((a, b) => a[0] - b[0])
		.map(([hour, v]) => ({ hour, biasCt: r2(v.sum / v.n), slots: v.n }));
	return { perDay: recent, perLead, biasByHour };
}
