import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	altSourceConfigFromAdapter,
	applyAltSourceGuard,
	buildSourceCompare,
	DEFAULT_ALT_TODAY_STATE,
	modelIsWeak,
} from "./alt_source";
import { shouldCaptureAlt } from "./alt_source_run";
import { emptyDailyPersist, upsertDailyRecord } from "./daily_persist";
import { altTodayForGuard } from "./alt_source";

describe("pv_bias Zweitquelle — Guard", () => {
	it("Fall 13.11.: morgen 19,56 vs 9,66 bei schwachem Modell → niedrigerer Wert", () => {
		const r = applyAltSourceGuard({
			correctedTodayKwh: 8.12,
			correctedTomorrowKwh: 19.562,
			altTodayKwh: 6.329,
			altTomorrowKwh: 9.66,
			confidencePct: 42,
			sampleDays14d: 1,
		});
		assert.equal(r.guardTomorrow, true);
		assert.equal(r.correctedTomorrowKwh, 9.66);
		assert.equal(r.guardToday, true); // 8,12 > 6,329 × 1,25
		assert.equal(r.correctedTodayKwh, 6.329);
	});

	it("nahe beieinander → kein Eingriff", () => {
		const r = applyAltSourceGuard({
			correctedTodayKwh: 7,
			correctedTomorrowKwh: 9,
			altTodayKwh: 6.5,
			altTomorrowKwh: 9.66,
			confidencePct: 42,
			sampleDays14d: 1,
		});
		assert.equal(r.guardToday, false);
		assert.equal(r.guardTomorrow, false);
		assert.equal(r.correctedTomorrowKwh, 9);
	});

	it("gut belegtes Modell → Guard aus, auch bei großer Abweichung", () => {
		assert.equal(modelIsWeak(80, 10), false);
		const r = applyAltSourceGuard({
			correctedTodayKwh: null,
			correctedTomorrowKwh: 20,
			altTodayKwh: null,
			altTomorrowKwh: 9,
			confidencePct: 80,
			sampleDays14d: 10,
		});
		assert.equal(r.guardTomorrow, false);
		assert.equal(r.correctedTomorrowKwh, 20);
	});

	it("fehlende/ungültige Zweitquelle → unverändert, nie erfundene Werte", () => {
		const r = applyAltSourceGuard({
			correctedTodayKwh: 10,
			correctedTomorrowKwh: 20,
			altTodayKwh: null,
			altTomorrowKwh: 0,
			confidencePct: 10,
			sampleDays14d: 0,
		});
		assert.equal(r.guardToday, false);
		assert.equal(r.guardTomorrow, false);
		assert.equal(r.correctedTodayKwh, 10);
		assert.equal(r.correctedTomorrowKwh, 20);
	});

	it("Config: Defaults auf BrightSky, Guard standardmäßig an", () => {
		const c = altSourceConfigFromAdapter({});
		assert.equal(c.todayStateId, DEFAULT_ALT_TODAY_STATE);
		assert.equal(c.guardEnabled, true);
		assert.equal(altSourceConfigFromAdapter({ learning_pv_alt_guard_enabled: false }).guardEnabled, false);
	});
});

describe("pv_bias Zweitquelle — Vergleich und Capture", () => {
	it("berechnet Fehler und Bias je Quelle nur aus vollständigen Tagen", () => {
		let p = emptyDailyPersist();
		const add = (date: string, main: number | null, alt: number | null, actual: number | null) => {
			p = upsertDailyRecord(p, {
				date,
				actualKwh: actual,
				actualCapturedAt: null,
				forecastKwh: main,
				forecastCapturedAt: null,
				altForecastKwh: alt,
			});
		};
		add("2026-11-10", 20, 10, 10);
		add("2026-11-11", 8, 6, 5);
		add("2026-11-12", 9, null, 5); // unvollständig
		const s = buildSourceCompare(p);
		assert.equal(s.pairedDays, 2);
		assert.equal(s.days.length, 3);
		// main: |20-10|/10=1.0, |8-5|/5=0.6 → 80 %
		assert.equal(s.mainMapePct, 80);
		// alt: 0, |6-5|/5=0.2 → 10 %
		assert.equal(s.altMapePct, 10);
		assert.equal(s.mainBiasPct, 86.7); // (28-15)/15
		assert.equal(s.altBiasPct, 6.7); // (16-15)/15
	});

	it("ohne Daten kein Ergebnis", () => {
		const s = buildSourceCompare(null);
		assert.equal(s.pairedDays, 0);
		assert.equal(s.mainMapePct, null);
	});

	it("Capture nur im Fenster nach der Freeze-Zeit und nur einmal", () => {
		const at = (h: number, m = 0) => new Date(2026, 10, 13, h, m, 0);
		assert.equal(shouldCaptureAlt(at(5, 59), "06:00", false), false);
		assert.equal(shouldCaptureAlt(at(6, 1), "06:00", false), true);
		assert.equal(shouldCaptureAlt(at(8, 59), "06:00", false), true);
		assert.equal(shouldCaptureAlt(at(9, 1), "06:00", false), false); // Tageswert nicht mehr vergleichbar
		assert.equal(shouldCaptureAlt(at(6, 30), "06:00", true), false);
	});
});

describe("pv_bias Zweitquelle — heute nur eingefroren", () => {
	it("nutzt den eingefrorenen Tageswert, nie einen Live-Rest", () => {
		let p = emptyDailyPersist();
		assert.equal(altTodayForGuard(p, "2026-11-13"), null);
		p = upsertDailyRecord(p, {
			date: "2026-11-13",
			actualKwh: null,
			actualCapturedAt: null,
			forecastKwh: 8.06,
			forecastCapturedAt: null,
			altForecastKwh: 6.329,
		});
		assert.equal(altTodayForGuard(p, "2026-11-13"), 6.329);
		assert.equal(altTodayForGuard(p, "2026-11-14"), null);
		assert.equal(altTodayForGuard(null, "2026-11-13"), null);
	});
});
