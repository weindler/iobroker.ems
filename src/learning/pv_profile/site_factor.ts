/**
 * Gelerntes PV-Stundenprofil ("Dach-Faktor je Stunde").
 *
 * Idee: Die Tagesform der PV kommt aus dem Sonnenstand (Clear-Sky). Dein Dach weicht davon ab
 * (Verschattung, Ausrichtung, Wechselrichter-Begrenzung). Aus den echten Stundenwerten der PV-Leistung
 * lernen wir je Ortsstunde einen Faktor = (Anteil der Stunde am echten Tagesertrag) /
 * (Anteil der Stunde am Clear-Sky-Tag). Der Median über mehrere Tage gleicht Wolken weitgehend aus.
 */
import { clearSkyWeight, solarElevationDeg } from "../../operator/contributions/pv_shape";

export interface HourlyPvPoint {
	/** Stundenbeginn (ms, UTC). */
	hourStartMs: number;
	/** Mittlere PV-Leistung der Stunde (W). */
	avgW: number;
}

export interface SiteFactorProfile {
	/** Faktor je Ortsstunde 0..23 (1 = wie Sonnenstand-Theorie). */
	factors: number[];
	days: number;
	active: boolean;
	noteDe: string;
}

export const SITE_FACTOR_MIN_DAYS = 5;
export const SITE_FACTOR_LOOKBACK_DAYS = 45;
const MIN_DAY_KWH = 1.5;
const MIN_FACTOR = 0.3;
const MAX_FACTOR = 2.5;

function localParts(ms: number, timeZone: string): { day: string; hour: number } {
	const parts = new Intl.DateTimeFormat("en-CA", {
		timeZone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		hour12: false,
	}).formatToParts(new Date(ms));
	const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? "";
	return { day: `${get("year")}-${get("month")}-${get("day")}`, hour: Number(get("hour")) % 24 };
}

function median(values: number[]): number {
	const s = [...values].sort((a, b) => a - b);
	const m = Math.floor(s.length / 2);
	return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function computeSiteFactors(
	points: HourlyPvPoint[],
	latDeg: number,
	lonDeg: number,
	timeZone: string,
	nowMs: number,
): SiteFactorProfile {
	const neutral = (noteDe: string, days = 0): SiteFactorProfile => ({
		factors: new Array<number>(24).fill(1),
		days,
		active: false,
		noteDe,
	});
	const cutoff = nowMs - SITE_FACTOR_LOOKBACK_DAYS * 86_400_000;
	const todayKey = localParts(nowMs, timeZone).day;
	const byDay = new Map<string, Map<number, { actual: number; cs: number }>>();
	for (const p of points) {
		if (!Number.isFinite(p.avgW) || p.avgW < 0 || p.hourStartMs < cutoff) continue;
		const { day, hour } = localParts(p.hourStartMs, timeZone);
		if (day === todayKey) continue; // heutiger Tag ist noch unvollständig
		const cs = clearSkyWeight(solarElevationDeg(new Date(p.hourStartMs + 1_800_000), latDeg, lonDeg));
		let m = byDay.get(day);
		if (!m) byDay.set(day, (m = new Map()));
		m.set(hour, { actual: p.avgW, cs });
	}
	const perHour: number[][] = Array.from({ length: 24 }, () => []);
	let days = 0;
	for (const m of byDay.values()) {
		let sumActual = 0;
		let sumCs = 0;
		for (const v of m.values()) {
			sumActual += v.actual;
			sumCs += v.cs;
		}
		// Nur vollständige Tage mit nennenswertem Ertrag (kWh = Summe der Stunden-Mittel in Wh).
		if (m.size < 12 || sumActual / 1000 < MIN_DAY_KWH || sumCs <= 0) continue;
		days++;
		for (const [hour, v] of m) {
			if (v.cs <= 0.02) continue;
			perHour[hour].push(v.actual / sumActual / (v.cs / sumCs));
		}
	}
	if (days < SITE_FACTOR_MIN_DAYS) {
		return neutral(`PV-Profil: erst ${days} von ${SITE_FACTOR_MIN_DAYS} brauchbaren Tagen gelernt.`, days);
	}
	const shrink = days / (days + SITE_FACTOR_MIN_DAYS);
	const factors = perHour.map((vals) => {
		if (vals.length < SITE_FACTOR_MIN_DAYS) return 1;
		const f = 1 + (median(vals) - 1) * shrink;
		return Math.max(MIN_FACTOR, Math.min(MAX_FACTOR, f));
	});
	return {
		factors,
		days,
		active: true,
		noteDe: `PV-Profil aus ${days} Tagen gelernt (Dach-Faktor je Stunde).`,
	};
}

/** Faktor für einen Zeitpunkt; ohne aktives Profil immer 1. */
export function siteFactorAt(profile: SiteFactorProfile | null, ms: number, timeZone: string): number {
	if (!profile || !profile.active) return 1;
	return profile.factors[localParts(ms, timeZone).hour] ?? 1;
}
