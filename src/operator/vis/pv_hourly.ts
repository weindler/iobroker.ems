/**
 * Read-only VIS: PV je Stunde für heute und morgen (Prognose aus dem Tagesplan, gemessen aus den Stundenwerten).
 * Keine eigene Prognose, keine Planungslogik — nur Umformung vorhandener Werte.
 */

export const VIS_PV_HOURLY_STATE_ID = "operator.vis.pv_hourly_json";

export type PvPlanSlot = { slot?: { startIso?: string; endIso?: string } | null; pvForecastPowerW?: number | null };
export type MeasuredHour = { hourStartMs: number; avgW: number };

export type VisPvHour = {
	/** Ortsstunde 0..23. */
	h: number;
	/** Erwartete Energie in der Stunde (kWh) aus dem Plan; fehlt für vergangene Stunden. */
	f: number | null;
	/** Gemessene Energie in der Stunde (kWh); nur für vergangene/laufende Stunden von heute. */
	m: number | null;
};

export type VisPvDay = {
	dateKey: string;
	label: "Heute" | "Morgen";
	hours: VisPvHour[];
	/** Summe der Prognose-Stunden (kWh). */
	forecastKwh: number;
	/** Summe der gemessenen Stunden (kWh). */
	measuredKwh: number;
};

export type VisPvHourly = { generatedAt: string; timezone: string; nowHour: number; days: VisPvDay[] };

function localParts(ms: number, timeZone: string): { dateKey: string; hour: number } {
	const parts = new Intl.DateTimeFormat("en-CA", {
		timeZone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		hourCycle: "h23",
	}).formatToParts(new Date(ms));
	const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? "00";
	return { dateKey: `${get("year")}-${get("month")}-${get("day")}`, hour: Number(get("hour")) };
}

const round3 = (n: number): number => Math.round(n * 1000) / 1000;

export function buildVisPvHourly(input: {
	now: Date;
	timezone: string;
	slots: PvPlanSlot[];
	measured: MeasuredHour[];
}): VisPvHourly {
	const nowMs = input.now.getTime();
	const today = localParts(nowMs, input.timezone);
	const tomorrow = localParts(nowMs + 24 * 3_600_000, input.timezone);
	const wanted: Array<{ key: string; label: "Heute" | "Morgen" }> = [
		{ key: today.dateKey, label: "Heute" },
		{ key: tomorrow.dateKey, label: "Morgen" },
	];
	const forecast = new Map<string, number>(); // "YYYY-MM-DD|h" -> kWh
	for (const s of input.slots) {
		const start = Date.parse(s.slot?.startIso ?? "");
		const end = Date.parse(s.slot?.endIso ?? "");
		const w = s.pvForecastPowerW;
		if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
		if (typeof w !== "number" || !Number.isFinite(w) || w < 0) continue;
		const lp = localParts(start, input.timezone);
		const key = `${lp.dateKey}|${lp.hour}`;
		forecast.set(key, (forecast.get(key) ?? 0) + (w * (end - start)) / 3_600_000 / 1000);
	}
	const measured = new Map<string, number>();
	for (const p of input.measured) {
		if (!Number.isFinite(p.hourStartMs) || !Number.isFinite(p.avgW) || p.hourStartMs > nowMs) continue;
		const lp = localParts(p.hourStartMs, input.timezone);
		measured.set(`${lp.dateKey}|${lp.hour}`, Math.max(0, p.avgW) / 1000);
	}
	const days: VisPvDay[] = wanted.map(({ key, label }) => {
		const hours: VisPvHour[] = [];
		let fSum = 0;
		let mSum = 0;
		for (let h = 0; h < 24; h++) {
			const f = forecast.get(`${key}|${h}`);
			const m = label === "Heute" ? measured.get(`${key}|${h}`) : undefined;
			if (f === undefined && m === undefined) continue;
			if ((f ?? 0) < 0.005 && (m ?? 0) < 0.005) continue;
			hours.push({ h, f: f === undefined ? null : round3(f), m: m === undefined ? null : round3(m) });
			fSum += f ?? 0;
			mSum += m ?? 0;
		}
		return { dateKey: key, label, hours, forecastKwh: round3(fSum), measuredKwh: round3(mSum) };
	});
	return { generatedAt: input.now.toISOString(), timezone: input.timezone, nowHour: today.hour, days };
}

export function emptyVisPvHourly(now: Date, timezone = "Europe/Berlin"): VisPvHourly {
	return { generatedAt: now.toISOString(), timezone, nowHour: localParts(now.getTime(), timezone).hour, days: [] };
}
