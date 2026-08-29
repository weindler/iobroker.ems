"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const math_1 = require("./math");
const persist_1 = require("./persist");
(0, node_test_1.describe)("measured_consumers/math", () => {
    (0, node_test_1.it)("A) Power-State: 1000 W über exakt 1 h => ca. 1.0 kWh", () => {
        const slot = (0, persist_1.emptyMeasuredConsumerSlotPersist)();
        const t0 = 1_000_000_000;
        (0, math_1.applyPowerIntegrationSample)(slot, 1000, t0, null, "2026-01-01", 3600); // erstes Sample: nur Basis
        strict_1.default.equal(slot.totalKwh, 0);
        (0, math_1.applyPowerIntegrationSample)(slot, 1000, t0 + 3600 * 1000, null, "2026-01-01", 3600);
        strict_1.default.equal(slot.totalKwh, 1);
        strict_1.default.equal(slot.days["2026-01-01"], 1);
    });
    (0, node_test_1.it)("B) unregelmäßige Zeitabstände: Integration verwendet echte Zeitdifferenz", () => {
        const slot = (0, persist_1.emptyMeasuredConsumerSlotPersist)();
        const t0 = 2_000_000_000;
        (0, math_1.applyPowerIntegrationSample)(slot, 500, t0, null, "2026-02-01", 3600);
        // 17 Minuten später
        (0, math_1.applyPowerIntegrationSample)(slot, 500, t0 + 17 * 60_000, null, "2026-02-01", 3600);
        const expected = (500 * (17 * 60)) / 3_600_000;
        strict_1.default.equal(slot.totalKwh, Math.round(expected * 1000) / 1000);
        // weitere 3 Minuten später, andere Leistung
        (0, math_1.applyPowerIntegrationSample)(slot, 900, t0 + 20 * 60_000, null, "2026-02-01", 3600);
        const expected2 = expected + (900 * (3 * 60)) / 3_600_000;
        strict_1.default.equal(slot.totalKwh, Math.round(expected2 * 1000) / 1000);
    });
    (0, node_test_1.it)("C) Energy-State: bestehender Rohzähler wird korrekt übernommen", () => {
        const slot = (0, persist_1.emptyMeasuredConsumerSlotPersist)();
        (0, math_1.applyEnergyStateSample)(slot, 87.4, null, "2026-03-01");
        strict_1.default.equal(slot.totalKwh, 87.4);
        strict_1.default.equal(slot.rawEnergyBaselineKwh, 87.4);
        (0, math_1.applyEnergyStateSample)(slot, 88.1, null, "2026-03-01");
        strict_1.default.equal(slot.totalKwh, 88.1);
        strict_1.default.equal(slot.days["2026-03-01"], 0.7);
    });
    (0, node_test_1.it)("D) Startwert: manueller Übernahmewert wird sauber fortgeführt", () => {
        const slot = (0, persist_1.emptyMeasuredConsumerSlotPersist)();
        (0, math_1.applyEnergyStateSample)(slot, 12.0, 500, "2026-03-01"); // Rohzähler 12.0, Nutzer will 500 als EMS-Gesamt
        strict_1.default.equal(slot.totalKwh, 500);
        (0, math_1.applyEnergyStateSample)(slot, 12.5, 500, "2026-03-01");
        strict_1.default.equal(slot.totalKwh, 500.5);
    });
    (0, node_test_1.it)("E) Counter-Reset: 500 kWh -> 0 -> 1 kWh ergibt fortlaufenden Gesamtstand, keinen Rücksprung", () => {
        const slot = (0, persist_1.emptyMeasuredConsumerSlotPersist)();
        (0, math_1.applyEnergyStateSample)(slot, 512.3, null, "2026-03-01");
        strict_1.default.equal(slot.totalKwh, 512.3);
        // Steckdose springt auf 0 (Reset)
        (0, math_1.applyEnergyStateSample)(slot, 0, null, "2026-03-02");
        strict_1.default.equal(slot.totalKwh, 512.3, "kein Rücksprung/Phantomverbrauch beim Reset selbst");
        strict_1.default.equal(slot.rawEnergyBaselineKwh, 0);
        // danach 0.4 kWh Rohverbrauch seit Reset
        (0, math_1.applyEnergyStateSample)(slot, 0.4, null, "2026-03-02");
        strict_1.default.equal(slot.totalKwh, 512.7);
    });
    (0, node_test_1.it)("E2) Reset ohne Zwischenschritt (0 direkt übersprungen, Rohwert springt auf kleineren Wert)", () => {
        const slot = (0, persist_1.emptyMeasuredConsumerSlotPersist)();
        (0, math_1.applyEnergyStateSample)(slot, 12.3, null, "2026-03-01");
        strict_1.default.equal(slot.totalKwh, 12.3);
        // Reset unbemerkt bis Rohwert schon 0.4 zeigt -> konservativ keine Addition in diesem Tick
        (0, math_1.applyEnergyStateSample)(slot, 0.4, null, "2026-03-02");
        strict_1.default.equal(slot.totalKwh, 12.3, "kein geschätzter Phantomverbrauch über den Reset hinweg");
        strict_1.default.equal(slot.rawEnergyBaselineKwh, 0.4);
        (0, math_1.applyEnergyStateSample)(slot, 0.9, null, "2026-03-02");
        strict_1.default.equal(slot.totalKwh, 12.8);
    });
    (0, node_test_1.it)("F) Adapter-Neustart: kein Energieverlust / keine Doppelinitialisierung (initialized bleibt persistiert)", () => {
        const slot = (0, persist_1.emptyMeasuredConsumerSlotPersist)();
        (0, math_1.applyEnergyStateSample)(slot, 5, 100, "2026-03-01");
        strict_1.default.equal(slot.totalKwh, 100);
        // Simuliert Neustart: gleiche Persist-Instanz erneut verwendet (initialized=true bleibt)
        const rehydrated = JSON.parse(JSON.stringify(slot));
        (0, math_1.applyEnergyStateSample)(rehydrated, 5.2, 100, "2026-03-01");
        strict_1.default.equal(rehydrated.totalKwh, 100.2, "kein erneutes Anwenden von initialEnergyKwh nach Neustart");
    });
    (0, node_test_1.it)("G) Perioden: heute/gestern, Monat, Jahr korrekt", () => {
        const slot = (0, persist_1.emptyMeasuredConsumerSlotPersist)();
        (0, math_1.applyEnergyStateSample)(slot, 0, null, "2026-03-30");
        (0, math_1.applyEnergyStateSample)(slot, 2, null, "2026-03-30"); // +2 am 30.
        (0, math_1.applyEnergyStateSample)(slot, 3, null, "2026-03-31"); // +1 am 31.
        (0, math_1.applyEnergyStateSample)(slot, 5, null, "2026-04-01"); // +2 am 1.4. (neuer Monat)
        const p = (0, math_1.resolveSlotPeriods)(slot, "2026-04-01", "2026-03-31");
        strict_1.default.equal(p.todayKwh, 2);
        strict_1.default.equal(p.yesterdayKwh, 1);
        strict_1.default.equal(p.monthKwh, 2); // nur April
        strict_1.default.equal(p.yearKwh, 5); // März + April
        strict_1.default.equal(p.totalKwh, 5);
    });
    (0, node_test_1.it)("K) ungültiger/unavailable State (Leistungslücke): kein Phantomverbrauch nach Lücke", () => {
        const slot = (0, persist_1.emptyMeasuredConsumerSlotPersist)();
        const t0 = 3_000_000_000;
        (0, math_1.applyPowerIntegrationSample)(slot, 200, t0, null, "2026-05-01", 300);
        // State fällt für 2 Stunden aus (State fehlt/unavailable) -> Lücke überspringen statt integrieren
        (0, math_1.skipPowerIntegrationGap)(slot, t0 + 2 * 3600 * 1000);
        (0, math_1.applyPowerIntegrationSample)(slot, 200, t0 + 2 * 3600 * 1000 + 20_000, null, "2026-05-01", 300);
        const expected = (200 * 20) / 3_600_000;
        strict_1.default.equal(slot.totalKwh, Math.round(expected * 1000) / 1000, "keine 2h Phantomverbrauch über die Lücke");
    });
    (0, node_test_1.it)("Retention: alte Tage werden entfernt, aktuelle bleiben", () => {
        const days = { "2020-01-01": 5, "2026-08-01": 3, "2026-08-29": 1 };
        const pruned = (0, math_1.pruneOldDays)(days, "2026-08-29", 400);
        strict_1.default.ok(!("2020-01-01" in pruned));
        strict_1.default.equal(pruned["2026-08-01"], 3);
        strict_1.default.equal(pruned["2026-08-29"], 1);
    });
    (0, node_test_1.it)("sumDaysForPrefix summiert nur passende Tage", () => {
        const days = { "2026-01-05": 1, "2026-01-31": 2, "2026-02-01": 4 };
        strict_1.default.equal((0, math_1.sumDaysForPrefix)(days, "2026-01"), 3);
        strict_1.default.equal((0, math_1.sumDaysForPrefix)(days, "2026"), 7);
    });
    (0, node_test_1.it)("I) Doppelzählung: unknown_house_load_w korrekt, Hauslast bleibt unverändert", () => {
        const houseLoadW = 1000;
        const measuredTotalW = 120 + 30; // TV + Receiver
        const unknown = (0, math_1.computeUnknownHouseLoadW)(houseLoadW, measuredTotalW);
        strict_1.default.equal(unknown, 850);
        strict_1.default.equal(houseLoadW, 1000, "Hauslast wird durch diese Berechnung nicht verändert");
    });
    (0, node_test_1.it)("unknown_house_load_w wird nie negativ (Messungenauigkeit > Hauslast)", () => {
        strict_1.default.equal((0, math_1.computeUnknownHouseLoadW)(100, 150), 0);
    });
    (0, node_test_1.it)("unknown_house_load_w ist null, wenn Hauslast nicht verfügbar ist", () => {
        strict_1.default.equal((0, math_1.computeUnknownHouseLoadW)(null, 150), null);
    });
});
