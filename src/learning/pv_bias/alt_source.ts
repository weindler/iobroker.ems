/**
 * Zweite PV-Rohquelle (Standard: BrightSky `solar_estimate`) neben dem Hauptforecast (z. B. Solcast
 * über pvforecast). Zwei Aufgaben, beide ohne Geräte-Writes:
 *
 * 1. Vergleich: Die Alt-Quelle wird einmal pro Tag zur Freeze-Zeit eingefroren und in
 *    pv_bias_daily_v1.json neben Hauptforecast und Ist abgelegt → Trefferquote je Quelle.
 * 2. Guard: Liegt der korrigierte Hauptforecast deutlich über der Alt-Quelle und ist das
 *    Bias-Modell schwach belegt, rechnet die Planung mit dem niedrigeren Wert (Reserve-sicher).
 */

import type { PvBiasDailyPersist } from "./daily_persist";

export const DEFAULT_ALT_TODAY_STATE = "brightsky.0.daily.00.solar_estimate";
export const DEFAULT_ALT_TOMORROW_STATE = "brightsky.0.daily.01.solar_estimate";

/** Guard greift ab diesem Verhältnis korrigierter Hauptforecast / Alt-Quelle. */
export const ALT_GUARD_RATIO = 1.25;
/** Modell gilt als schwach belegt unterhalb dieser Confidence oder bei weniger gültigen 14d-Tagen. */
export const ALT_GUARD_WEAK_CONFIDENCE_PCT = 60;
export const ALT_GUARD_WEAK_SAMPLE_DAYS_14D = 5;
/** Anzahl Tage im Vergleichs-JSON. */
export const ALT_COMPARE_MAX_DAYS = 21;

export type AltSourceConfig = {
	todayStateId: string;
	tomorrowStateId: string;
	guardEnabled: boolean;
};

function strField(c: Record<string, unknown>, key: string): string {
	const v = c[key];
	return typeof v === "string" ? v.trim() : "";
}

export function altSourceConfigFromAdapter(config: unknown): AltSourceConfig {
	const c = config && typeof config === "object" ? (config as Record<string, unknown>) : {};
	const g = c.learning_pv_alt_guard_enabled;
	const guardEnabled = typeof g === "boolean" ? g : typeof g === "string" ? !["false", "0", "off"].includes(g.trim().toLowerCase()) : true;
	return {
		todayStateId: strField(c, "learning_pv_alt_today_state") || DEFAULT_ALT_TODAY_STATE,
		tomorrowStateId: strField(c, "learning_pv_alt_tomorrow_state") || DEFAULT_ALT_TOMORROW_STATE,
		guardEnabled,
	};
}

export type AltGuardInput = {
	correctedTodayKwh: number | null;
	correctedTomorrowKwh: number | null;
	altTodayKwh: number | null;
	altTomorrowKwh: number | null;
	confidencePct: number;
	sampleDays14d: number;
};

export type AltGuardResult = {
	correctedTodayKwh: number | null;
	correctedTomorrowKwh: number | null;
	guardToday: boolean;
	guardTomorrow: boolean;
	reasonDe: string;
};

function validPos(n: number | null): n is number {
	return n !== null && Number.isFinite(n) && n > 0;
}

export function modelIsWeak(confidencePct: number, sampleDays14d: number): boolean {
	return confidencePct < ALT_GUARD_WEAK_CONFIDENCE_PCT || sampleDays14d < ALT_GUARD_WEAK_SAMPLE_DAYS_14D;
}

function guardOne(corrected: number | null, alt: number | null, weak: boolean): { value: number | null; active: boolean } {
	if (!weak || !validPos(corrected) || !validPos(alt)) return { value: corrected, active: false };
	if (corrected > alt * ALT_GUARD_RATIO) {
		return { value: Math.round(alt * 1000) / 1000, active: true };
	}
	return { value: corrected, active: false };
}

export function applyAltSourceGuard(input: AltGuardInput): AltGuardResult {
	const weak = modelIsWeak(input.confidencePct, input.sampleDays14d);
	const t = guardOne(input.correctedTodayKwh, input.altTodayKwh, weak);
	const m = guardOne(input.correctedTomorrowKwh, input.altTomorrowKwh, weak);
	let reasonDe = "Kein Guard nötig.";
	if (t.active || m.active) {
		const parts: string[] = [];
		if (t.active) parts.push(`heute ${input.correctedTodayKwh} → ${t.value} kWh`);
		if (m.active) parts.push(`morgen ${input.correctedTomorrowKwh} → ${m.value} kWh`);
		reasonDe = `Zweitquelle deutlich niedriger, Bias-Modell schwach belegt: ${parts.join(", ")} (niedrigerer Wert).`;
	} else if (!weak) {
		reasonDe = "Bias-Modell ausreichend belegt — Guard aus.";
	}
	return {
		correctedTodayKwh: t.value,
		correctedTomorrowKwh: m.value,
		guardToday: t.active,
		guardTomorrow: m.active,
		reasonDe,
	};
}

export type SourceCompareDay = {
	date: string;
	main: number | null;
	alt: number | null;
	actual: number | null;
};

export type SourceCompareSummary = {
	days: SourceCompareDay[];
	pairedDays: number;
	mainMapePct: number | null;
	altMapePct: number | null;
	mainBiasPct: number | null;
	altBiasPct: number | null;
};

export function buildSourceCompare(persist: PvBiasDailyPersist | null, maxDays = ALT_COMPARE_MAX_DAYS): SourceCompareSummary {
	const rows = Object.values(persist?.days ?? {})
		.sort((a, b) => a.date.localeCompare(b.date))
		.slice(-maxDays)
		.map((r) => ({
			date: r.date,
			main: r.forecastKwh ?? null,
			alt: r.altForecastKwh ?? null,
			actual: r.actualKwh ?? null,
		}));
	const paired = rows.filter((r) => validPos(r.main) && validPos(r.alt) && validPos(r.actual));
	const stat = (pick: (r: SourceCompareDay) => number | null) => {
		if (!paired.length) return { mape: null, bias: null };
		let ape = 0;
		let sumF = 0;
		let sumA = 0;
		for (const r of paired) {
			const f = pick(r) as number;
			const a = r.actual as number;
			ape += Math.abs(f - a) / a;
			sumF += f;
			sumA += a;
		}
		return {
			mape: Math.round((ape / paired.length) * 1000) / 10,
			// Bias = Forecast gegen Ist (positiv = Forecast zu hoch)
			bias: Math.round(((sumF - sumA) / sumA) * 1000) / 10,
		};
	};
	const m = stat((r) => r.main);
	const a = stat((r) => r.alt);
	return {
		days: rows,
		pairedDays: paired.length,
		mainMapePct: m.mape,
		altMapePct: a.mape,
		mainBiasPct: m.bias,
		altBiasPct: a.bias,
	};
}
