import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	applyEnergyStateSample,
	applyPowerIntegrationSample,
	skipPowerIntegrationGap,
	computeUnknownHouseLoadW,
	resolveSlotPeriods,
	pruneOldDays,
	sumDaysForPrefix,
} from "./math";
import { emptyMeasuredConsumerSlotPersist } from "./persist";

describe("measured_consumers/math", () => {
	it("A) Power-State: 1000 W über exakt 1 h => ca. 1.0 kWh", () => {
		const slot = emptyMeasuredConsumerSlotPersist();
		const t0 = 1_000_000_000;
		applyPowerIntegrationSample(slot, 1000, t0, null, "2026-01-01", 3600); // erstes Sample: nur Basis
		assert.equal(slot.totalKwh, 0);
		applyPowerIntegrationSample(slot, 1000, t0 + 3600 * 1000, null, "2026-01-01", 3600);
		assert.equal(slot.totalKwh, 1);
		assert.equal(slot.days["2026-01-01"], 1);
	});

	it("B) unregelmäßige Zeitabstände: Integration verwendet echte Zeitdifferenz", () => {
		const slot = emptyMeasuredConsumerSlotPersist();
		const t0 = 2_000_000_000;
		applyPowerIntegrationSample(slot, 500, t0, null, "2026-02-01", 3600);
		// 17 Minuten später
		applyPowerIntegrationSample(slot, 500, t0 + 17 * 60_000, null, "2026-02-01", 3600);
		const expected = (500 * (17 * 60)) / 3_600_000;
		assert.equal(slot.totalKwh, Math.round(expected * 1000) / 1000);
		// weitere 3 Minuten später, andere Leistung
		applyPowerIntegrationSample(slot, 900, t0 + 20 * 60_000, null, "2026-02-01", 3600);
		const expected2 = expected + (900 * (3 * 60)) / 3_600_000;
		assert.equal(slot.totalKwh, Math.round(expected2 * 1000) / 1000);
	});

	it("C) Energy-State: bestehender Rohzähler wird korrekt übernommen", () => {
		const slot = emptyMeasuredConsumerSlotPersist();
		applyEnergyStateSample(slot, 87.4, null, "2026-03-01");
		assert.equal(slot.totalKwh, 87.4);
		assert.equal(slot.rawEnergyBaselineKwh, 87.4);
		applyEnergyStateSample(slot, 88.1, null, "2026-03-01");
		assert.equal(slot.totalKwh, 88.1);
		assert.equal(slot.days["2026-03-01"], 0.7);
	});

	it("D) Startwert: manueller Übernahmewert wird sauber fortgeführt", () => {
		const slot = emptyMeasuredConsumerSlotPersist();
		applyEnergyStateSample(slot, 12.0, 500, "2026-03-01"); // Rohzähler 12.0, Nutzer will 500 als EMS-Gesamt
		assert.equal(slot.totalKwh, 500);
		assert.equal(slot.days["2026-03-01"], undefined, "Startwert zählt nicht als heutiger Verbrauch");
		applyEnergyStateSample(slot, 12.5, 500, "2026-03-01");
		assert.equal(slot.totalKwh, 500.5);
		assert.equal(slot.days["2026-03-01"], 0.5);
	});

	it("energy_state 100.0 → 100.2: total +0.2 und today +0.2", () => {
		const slot = emptyMeasuredConsumerSlotPersist();
		applyEnergyStateSample(slot, 100.0, null, "2026-08-29");
		applyEnergyStateSample(slot, 100.2, null, "2026-08-29");
		const p = resolveSlotPeriods(slot, "2026-08-29", "2026-08-28");
		assert.equal(p.totalKwh, 100.2);
		assert.equal(p.todayKwh, 0.2);
	});

	it("initial_energy_kwh: erster Sample erzeugt today = 0", () => {
		const slot = emptyMeasuredConsumerSlotPersist();
		applyEnergyStateSample(slot, 542.224, 542.224, "2026-08-29");
		const p = resolveSlotPeriods(slot, "2026-08-29", "2026-08-28");
		assert.equal(p.totalKwh, 542.224);
		assert.equal(p.todayKwh, 0);
	});

	it("sub-threshold Inkremente akkumulieren bis today steigt (kein Baseline-Creep)", () => {
		const slot = emptyMeasuredConsumerSlotPersist();
		applyEnergyStateSample(slot, 100.0, null, "2026-08-29");
		// Viele winzige Updates unter round3-Schwelle (< 0.0005) — Baseline darf nicht voraneilen
		applyEnergyStateSample(slot, 100.0002, null, "2026-08-29");
		applyEnergyStateSample(slot, 100.0003, null, "2026-08-29");
		applyEnergyStateSample(slot, 100.0004, null, "2026-08-29");
		assert.equal(slot.totalKwh, 100, "noch kein buchbares Delta");
		assert.equal(slot.rawEnergyBaselineKwh, 100, "Baseline bleibt bis sichtbares Delta");
		applyEnergyStateSample(slot, 100.0012, null, "2026-08-29");
		assert.equal(slot.totalKwh, 100.001);
		assert.equal(slot.days["2026-08-29"], 0.001);
	});

	it("Tageswechsel: alter today → yesterday, neuer today mit neuem Delta", () => {
		const slot = emptyMeasuredConsumerSlotPersist();
		applyEnergyStateSample(slot, 10, null, "2026-08-28");
		applyEnergyStateSample(slot, 10.5, null, "2026-08-28");
		applyEnergyStateSample(slot, 10.8, null, "2026-08-29");
		const p = resolveSlotPeriods(slot, "2026-08-29", "2026-08-28");
		assert.equal(p.yesterdayKwh, 0.5);
		assert.equal(p.todayKwh, 0.3);
		assert.equal(p.monthKwh, 0.8);
		assert.equal(p.yearKwh, 0.8);
	});

	it("E) Counter-Reset: 500 kWh -> 0 -> 1 kWh ergibt fortlaufenden Gesamtstand, keinen Rücksprung", () => {
		const slot = emptyMeasuredConsumerSlotPersist();
		applyEnergyStateSample(slot, 512.3, null, "2026-03-01");
		assert.equal(slot.totalKwh, 512.3);
		// Steckdose springt auf 0 (Reset)
		applyEnergyStateSample(slot, 0, null, "2026-03-02");
		assert.equal(slot.totalKwh, 512.3, "kein Rücksprung/Phantomverbrauch beim Reset selbst");
		assert.equal(slot.rawEnergyBaselineKwh, 0);
		assert.equal(slot.days["2026-03-02"], undefined, "Reset selbst schreibt keinen Tagesverbrauch");
		// danach 0.4 kWh Rohverbrauch seit Reset
		applyEnergyStateSample(slot, 0.4, null, "2026-03-02");
		assert.equal(slot.totalKwh, 512.7);
		assert.equal(slot.days["2026-03-02"], 0.4, "nur echter Verbrauch nach Reset fließt in today");
	});

	it("E2) Reset ohne Zwischenschritt (0 direkt übersprungen, Rohwert springt auf kleineren Wert)", () => {
		const slot = emptyMeasuredConsumerSlotPersist();
		applyEnergyStateSample(slot, 12.3, null, "2026-03-01");
		assert.equal(slot.totalKwh, 12.3);
		// Reset unbemerkt bis Rohwert schon 0.4 zeigt -> konservativ keine Addition in diesem Tick
		applyEnergyStateSample(slot, 0.4, null, "2026-03-02");
		assert.equal(slot.totalKwh, 12.3, "kein geschätzter Phantomverbrauch über den Reset hinweg");
		assert.equal(slot.rawEnergyBaselineKwh, 0.4);
		applyEnergyStateSample(slot, 0.9, null, "2026-03-02");
		assert.equal(slot.totalKwh, 12.8);
	});

	it("F) Adapter-Neustart: kein Energieverlust / keine Doppelinitialisierung (initialized bleibt persistiert)", () => {
		const slot = emptyMeasuredConsumerSlotPersist();
		applyEnergyStateSample(slot, 5, 100, "2026-03-01");
		assert.equal(slot.totalKwh, 100);
		// Simuliert Neustart: gleiche Persist-Instanz erneut verwendet (initialized=true bleibt)
		const rehydrated = JSON.parse(JSON.stringify(slot));
		applyEnergyStateSample(rehydrated, 5.2, 100, "2026-03-01");
		assert.equal(rehydrated.totalKwh, 100.2, "kein erneutes Anwenden von initialEnergyKwh nach Neustart");
	});

	it("G) Perioden: heute/gestern, Monat, Jahr korrekt", () => {
		const slot = emptyMeasuredConsumerSlotPersist();
		applyEnergyStateSample(slot, 0, null, "2026-03-30");
		applyEnergyStateSample(slot, 2, null, "2026-03-30"); // +2 am 30.
		applyEnergyStateSample(slot, 3, null, "2026-03-31"); // +1 am 31.
		applyEnergyStateSample(slot, 5, null, "2026-04-01"); // +2 am 1.4. (neuer Monat)
		const p = resolveSlotPeriods(slot, "2026-04-01", "2026-03-31");
		assert.equal(p.todayKwh, 2);
		assert.equal(p.yesterdayKwh, 1);
		assert.equal(p.monthKwh, 2); // nur April
		assert.equal(p.yearKwh, 5); // März + April
		assert.equal(p.totalKwh, 5);
	});

	it("K) ungültiger/unavailable State (Leistungslücke): kein Phantomverbrauch nach Lücke", () => {
		const slot = emptyMeasuredConsumerSlotPersist();
		const t0 = 3_000_000_000;
		applyPowerIntegrationSample(slot, 200, t0, null, "2026-05-01", 300);
		// State fällt für 2 Stunden aus (State fehlt/unavailable) -> Lücke überspringen statt integrieren
		skipPowerIntegrationGap(slot, t0 + 2 * 3600 * 1000);
		applyPowerIntegrationSample(slot, 200, t0 + 2 * 3600 * 1000 + 20_000, null, "2026-05-01", 300);
		const expected = (200 * 20) / 3_600_000;
		assert.equal(slot.totalKwh, Math.round(expected * 1000) / 1000, "keine 2h Phantomverbrauch über die Lücke");
	});

	it("Retention: alte Tage werden entfernt, aktuelle bleiben", () => {
		const days = { "2020-01-01": 5, "2026-08-01": 3, "2026-08-29": 1 };
		const pruned = pruneOldDays(days, "2026-08-29", 400);
		assert.ok(!("2020-01-01" in pruned));
		assert.equal(pruned["2026-08-01"], 3);
		assert.equal(pruned["2026-08-29"], 1);
	});

	it("sumDaysForPrefix summiert nur passende Tage", () => {
		const days = { "2026-01-05": 1, "2026-01-31": 2, "2026-02-01": 4 };
		assert.equal(sumDaysForPrefix(days, "2026-01"), 3);
		assert.equal(sumDaysForPrefix(days, "2026"), 7);
	});

	it("I) Doppelzählung: unknown_house_load_w korrekt, Hauslast bleibt unverändert", () => {
		const houseLoadW = 1000;
		const measuredTotalW = 120 + 30; // TV + Receiver
		const unknown = computeUnknownHouseLoadW(houseLoadW, measuredTotalW);
		assert.equal(unknown, 850);
		assert.equal(houseLoadW, 1000, "Hauslast wird durch diese Berechnung nicht verändert");
	});

	it("unknown_house_load_w wird nie negativ (Messungenauigkeit > Hauslast)", () => {
		assert.equal(computeUnknownHouseLoadW(100, 150), 0);
	});

	it("unknown_house_load_w ist null, wenn Hauslast nicht verfügbar ist", () => {
		assert.equal(computeUnknownHouseLoadW(null, 150), null);
	});
});
