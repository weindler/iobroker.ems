"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const alt_source_1 = require("./alt_source");
const alt_source_run_1 = require("./alt_source_run");
const daily_persist_1 = require("./daily_persist");
const alt_source_2 = require("./alt_source");
(0, node_test_1.describe)("pv_bias Zweitquelle — Guard", () => {
    (0, node_test_1.it)("Fall 13.11.: morgen 19,56 vs 9,66 bei schwachem Modell → niedrigerer Wert", () => {
        const r = (0, alt_source_1.applyAltSourceGuard)({
            correctedTodayKwh: 8.12,
            correctedTomorrowKwh: 19.562,
            altTodayKwh: 6.329,
            altTomorrowKwh: 9.66,
            confidencePct: 42,
            sampleDays14d: 1,
        });
        strict_1.default.equal(r.guardTomorrow, true);
        strict_1.default.equal(r.correctedTomorrowKwh, 9.66);
        strict_1.default.equal(r.guardToday, true); // 8,12 > 6,329 × 1,25
        strict_1.default.equal(r.correctedTodayKwh, 6.329);
    });
    (0, node_test_1.it)("nahe beieinander → kein Eingriff", () => {
        const r = (0, alt_source_1.applyAltSourceGuard)({
            correctedTodayKwh: 7,
            correctedTomorrowKwh: 9,
            altTodayKwh: 6.5,
            altTomorrowKwh: 9.66,
            confidencePct: 42,
            sampleDays14d: 1,
        });
        strict_1.default.equal(r.guardToday, false);
        strict_1.default.equal(r.guardTomorrow, false);
        strict_1.default.equal(r.correctedTomorrowKwh, 9);
    });
    (0, node_test_1.it)("gut belegtes Modell → Guard aus, auch bei großer Abweichung", () => {
        strict_1.default.equal((0, alt_source_1.modelIsWeak)(80, 10), false);
        const r = (0, alt_source_1.applyAltSourceGuard)({
            correctedTodayKwh: null,
            correctedTomorrowKwh: 20,
            altTodayKwh: null,
            altTomorrowKwh: 9,
            confidencePct: 80,
            sampleDays14d: 10,
        });
        strict_1.default.equal(r.guardTomorrow, false);
        strict_1.default.equal(r.correctedTomorrowKwh, 20);
    });
    (0, node_test_1.it)("fehlende/ungültige Zweitquelle → unverändert, nie erfundene Werte", () => {
        const r = (0, alt_source_1.applyAltSourceGuard)({
            correctedTodayKwh: 10,
            correctedTomorrowKwh: 20,
            altTodayKwh: null,
            altTomorrowKwh: 0,
            confidencePct: 10,
            sampleDays14d: 0,
        });
        strict_1.default.equal(r.guardToday, false);
        strict_1.default.equal(r.guardTomorrow, false);
        strict_1.default.equal(r.correctedTodayKwh, 10);
        strict_1.default.equal(r.correctedTomorrowKwh, 20);
    });
    (0, node_test_1.it)("Config: Defaults auf BrightSky, Guard standardmäßig an", () => {
        const c = (0, alt_source_1.altSourceConfigFromAdapter)({});
        strict_1.default.equal(c.todayStateId, alt_source_1.DEFAULT_ALT_TODAY_STATE);
        strict_1.default.equal(c.guardEnabled, true);
        strict_1.default.equal((0, alt_source_1.altSourceConfigFromAdapter)({ learning_pv_alt_guard_enabled: false }).guardEnabled, false);
    });
});
(0, node_test_1.describe)("pv_bias Zweitquelle — Vergleich und Capture", () => {
    (0, node_test_1.it)("berechnet Fehler und Bias je Quelle nur aus vollständigen Tagen", () => {
        let p = (0, daily_persist_1.emptyDailyPersist)();
        const add = (date, main, alt, actual) => {
            p = (0, daily_persist_1.upsertDailyRecord)(p, {
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
        const s = (0, alt_source_1.buildSourceCompare)(p);
        strict_1.default.equal(s.pairedDays, 2);
        strict_1.default.equal(s.days.length, 3);
        // main: |20-10|/10=1.0, |8-5|/5=0.6 → 80 %
        strict_1.default.equal(s.mainMapePct, 80);
        // alt: 0, |6-5|/5=0.2 → 10 %
        strict_1.default.equal(s.altMapePct, 10);
        strict_1.default.equal(s.mainBiasPct, 86.7); // (28-15)/15
        strict_1.default.equal(s.altBiasPct, 6.7); // (16-15)/15
    });
    (0, node_test_1.it)("ohne Daten kein Ergebnis", () => {
        const s = (0, alt_source_1.buildSourceCompare)(null);
        strict_1.default.equal(s.pairedDays, 0);
        strict_1.default.equal(s.mainMapePct, null);
    });
    (0, node_test_1.it)("Capture nur im Fenster nach der Freeze-Zeit und nur einmal", () => {
        const at = (h, m = 0) => new Date(2026, 10, 13, h, m, 0);
        strict_1.default.equal((0, alt_source_run_1.shouldCaptureAlt)(at(5, 59), "06:00", false), false);
        strict_1.default.equal((0, alt_source_run_1.shouldCaptureAlt)(at(6, 1), "06:00", false), true);
        strict_1.default.equal((0, alt_source_run_1.shouldCaptureAlt)(at(8, 59), "06:00", false), true);
        strict_1.default.equal((0, alt_source_run_1.shouldCaptureAlt)(at(9, 1), "06:00", false), false); // Tageswert nicht mehr vergleichbar
        strict_1.default.equal((0, alt_source_run_1.shouldCaptureAlt)(at(6, 30), "06:00", true), false);
    });
});
(0, node_test_1.describe)("pv_bias Zweitquelle — heute nur eingefroren", () => {
    (0, node_test_1.it)("nutzt den eingefrorenen Tageswert, nie einen Live-Rest", () => {
        let p = (0, daily_persist_1.emptyDailyPersist)();
        strict_1.default.equal((0, alt_source_2.altTodayForGuard)(p, "2026-11-13"), null);
        p = (0, daily_persist_1.upsertDailyRecord)(p, {
            date: "2026-11-13",
            actualKwh: null,
            actualCapturedAt: null,
            forecastKwh: 8.06,
            forecastCapturedAt: null,
            altForecastKwh: 6.329,
        });
        strict_1.default.equal((0, alt_source_2.altTodayForGuard)(p, "2026-11-13"), 6.329);
        strict_1.default.equal((0, alt_source_2.altTodayForGuard)(p, "2026-11-14"), null);
        strict_1.default.equal((0, alt_source_2.altTodayForGuard)(null, "2026-11-13"), null);
    });
});
