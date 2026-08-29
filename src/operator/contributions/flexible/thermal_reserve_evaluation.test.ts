import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	evaluateThermalReserveDiagnostics,
	gateBatteryInputsForThermalPrecharge,
	resolveNextPvHeatOpportunityIso,
} from "./thermal_reserve_evaluation.js";
import { resolveThermalPvPrecharge } from "./thermal_pv_precharge.js";

const NOW = new Date("2026-08-28T18:45:00.000Z"); // Abend, wie im realen Vorfall

describe("resolveNextPvHeatOpportunityIso — Priorität bestehender Quellen", () => {
	it("bevorzugt einen explizit übergebenen Zeitpunkt", () => {
		const iso = resolveNextPvHeatOpportunityIso({
			explicitIso: "2026-08-29T07:00:00.000Z",
			pvDeficitBridgeUntilIso: "2026-08-30T23:59:59.000Z",
			now: NOW,
			timezone: "Europe/Berlin",
		});
		assert.equal(iso, "2026-08-29T07:00:00.000Z");
	});

	it("nutzt das mehrtägige PV-Defizit-Ende, wenn kein expliziter Wert vorliegt (schwacher Forecast morgen)", () => {
		const iso = resolveNextPvHeatOpportunityIso({
			explicitIso: null,
			pvDeficitBridgeUntilIso: "2026-08-31T21:59:59.000Z",
			now: NOW,
			timezone: "Europe/Berlin",
		});
		assert.equal(iso, "2026-08-31T21:59:59.000Z");
	});

	it("fällt auf den nächsten Morgen zurück, wenn nichts anderes bekannt ist", () => {
		const iso = resolveNextPvHeatOpportunityIso({
			now: NOW,
			timezone: "Europe/Berlin",
		});
		const ms = Date.parse(iso);
		assert.ok(ms > NOW.getTime());
		assert.ok(ms - NOW.getTime() < 24 * 3_600_000);
	});
});

describe("gateBatteryInputsForThermalPrecharge — Batteriebezug sauber (Block 4)", () => {
	it("blendet Batteriesignale vollständig aus, wenn die Policy die Batterie für den Heizstab nicht erlaubt", () => {
		const r = gateBatteryInputsForThermalPrecharge({
			mayUseBatteryForImmersion: false,
			batterySocPct: 98,
			centralBatteryReserveRequiredSocAtPvEndPct: 40,
			legacyBatteryEndSocTargetPct: 90,
		});
		assert.equal(r.batterySocPct, null);
		assert.equal(r.batteryEndSocTargetPct, null);
		assert.match(r.reasonDe, /nicht erlaubt/);
	});

	it("verwendet die zentrale Batterie-Reserve, wenn die Policy die Batterie erlaubt", () => {
		const r = gateBatteryInputsForThermalPrecharge({
			mayUseBatteryForImmersion: true,
			batterySocPct: 80,
			centralBatteryReserveRequiredSocAtPvEndPct: 45,
			legacyBatteryEndSocTargetPct: 90,
		});
		assert.equal(r.batterySocPct, 80);
		assert.equal(r.batteryEndSocTargetPct, 45);
		assert.match(r.reasonDe, /Zentrale Batterie-Reserve/);
	});

	it("fällt auf das Legacy-Ziel zurück, wenn die zentrale Reserve unbekannt ist", () => {
		const r = gateBatteryInputsForThermalPrecharge({
			mayUseBatteryForImmersion: true,
			batterySocPct: 80,
			centralBatteryReserveRequiredSocAtPvEndPct: null,
			legacyBatteryEndSocTargetPct: 90,
		});
		assert.equal(r.batteryEndSocTargetPct, 90);
		assert.match(r.reasonDe, /Legacy-Ladeziel/);
	});

	it("lässt Batteriesignale unverändert durch, wenn die Policy-Erlaubnis unbekannt ist (nicht false)", () => {
		const r = gateBatteryInputsForThermalPrecharge({
			mayUseBatteryForImmersion: null,
			batterySocPct: 80,
			centralBatteryReserveRequiredSocAtPvEndPct: null,
			legacyBatteryEndSocTargetPct: null,
		});
		assert.equal(r.batterySocPct, 80);
	});
});

describe("evaluateThermalReserveDiagnostics — Beispiel aus der Aufgabe (62 h reicht, gutes Fenster kommt)", () => {
	it("viel thermische Reichweite + gutes PV-Fenster morgen → kein Precharge nötig", () => {
		const nextPvIso = new Date(NOW.getTime() + 12 * 3_600_000).toISOString(); // morgen früh
		const precharge = resolveThermalPvPrecharge({
			now: NOW,
			bufferTempC: 63,
			planningMinTempC: 50,
			planningMaxTempC: 63,
			baseTargetTempC: 57.6,
			coolingRateCPerHAvg: 0.2,
			estimatedEmptyAtIso: new Date(NOW.getTime() + 62 * 3_600_000).toISOString(),
			nextPvHeatOpportunityIso: nextPvIso,
			pvTodayKwh: 37.6,
			pvTomorrowKwh: 32.8,
			// Abends: kein nennenswerter PV-Überschuss mehr (kein "sonst verschwendeter Surplus").
			todayPvSurplusKwh: 0,
			batterySocPct: 100,
			batteryEndSocTargetPct: 30,
			vehicleUrgentEnergyKwh: null,
			exportTariffCtPerKwh: null,
			importTariffCtPerKwh: null,
			futureElectricalFlexHintKwh: null,
			globalMode: "balanced",
		});
		assert.equal(precharge.active, false, precharge.reasonDe);

		const diag = evaluateThermalReserveDiagnostics({
			nowMs: NOW.getTime(),
			estimatedRemainingHours: 62,
			estimatedEmptyAtIso: new Date(NOW.getTime() + 62 * 3_600_000).toISOString(),
			nextPvHeatOpportunityIso: nextPvIso,
			mayUseBatteryForImmersion: false,
			precharge,
		});
		assert.equal(diag.prechargeNeeded, false);
		assert.equal(diag.energySourceClass, "sufficient_no_precharge");
		assert.match(diag.reasonDe, /reicht bis zum nächsten PV-Fenster/);
	});

	it("geringe Reichweite → Precharge nötig", () => {
		const nextPvIso = new Date(NOW.getTime() + 14 * 3_600_000).toISOString();
		const precharge = resolveThermalPvPrecharge({
			now: NOW,
			bufferTempC: 52,
			planningMinTempC: 50,
			planningMaxTempC: 63,
			baseTargetTempC: 55,
			coolingRateCPerHAvg: 0.5,
			estimatedEmptyAtIso: new Date(NOW.getTime() + 4 * 3_600_000).toISOString(), // reicht nur 4 h
			nextPvHeatOpportunityIso: nextPvIso,
			pvTodayKwh: 20,
			pvTomorrowKwh: 18,
			todayPvSurplusKwh: 8,
			batterySocPct: 100,
			batteryEndSocTargetPct: 30,
			vehicleUrgentEnergyKwh: null,
			exportTariffCtPerKwh: null,
			importTariffCtPerKwh: null,
			futureElectricalFlexHintKwh: null,
			globalMode: "balanced",
		});
		assert.equal(precharge.active, true, precharge.reasonDe);

		const diag = evaluateThermalReserveDiagnostics({
			nowMs: NOW.getTime(),
			estimatedRemainingHours: 4,
			estimatedEmptyAtIso: new Date(NOW.getTime() + 4 * 3_600_000).toISOString(),
			nextPvHeatOpportunityIso: nextPvIso,
			mayUseBatteryForImmersion: true,
			precharge,
		});
		assert.equal(diag.prechargeNeeded, true);
		assert.equal(diag.energySourceClass, "pv_surplus");
	});

	it("Batterie nicht für Heizstab erlaubt → keine implizite Batterie-Annahme macht Precharge attraktiver", () => {
		const nextPvIso = new Date(NOW.getTime() + 12 * 3_600_000).toISOString();
		const gate = gateBatteryInputsForThermalPrecharge({
			mayUseBatteryForImmersion: false,
			batterySocPct: 100,
			centralBatteryReserveRequiredSocAtPvEndPct: 30,
			legacyBatteryEndSocTargetPct: 30,
		});
		const withoutBattery = resolveThermalPvPrecharge({
			now: NOW,
			bufferTempC: 58,
			planningMinTempC: 50,
			planningMaxTempC: 63,
			baseTargetTempC: 57.6,
			coolingRateCPerHAvg: 0.2,
			estimatedEmptyAtIso: null,
			nextPvHeatOpportunityIso: nextPvIso,
			pvTodayKwh: 37.6,
			pvTomorrowKwh: 32.8,
			todayPvSurplusKwh: 8,
			batterySocPct: gate.batterySocPct,
			batteryEndSocTargetPct: gate.batteryEndSocTargetPct,
			vehicleUrgentEnergyKwh: null,
			exportTariffCtPerKwh: null,
			importTariffCtPerKwh: null,
			futureElectricalFlexHintKwh: null,
			globalMode: "balanced",
		});
		const withBattery = resolveThermalPvPrecharge({
			now: NOW,
			bufferTempC: 58,
			planningMinTempC: 50,
			planningMaxTempC: 63,
			baseTargetTempC: 57.6,
			coolingRateCPerHAvg: 0.2,
			estimatedEmptyAtIso: null,
			nextPvHeatOpportunityIso: nextPvIso,
			pvTodayKwh: 37.6,
			pvTomorrowKwh: 32.8,
			todayPvSurplusKwh: 8,
			batterySocPct: 100,
			batteryEndSocTargetPct: 30,
			vehicleUrgentEnergyKwh: null,
			exportTariffCtPerKwh: null,
			importTariffCtPerKwh: null,
			futureElectricalFlexHintKwh: null,
			globalMode: "balanced",
		});
		// "Batterie satt" darf ohne Erlaubnis nicht mehr Vorladung erzeugen als mit (nie mehr, ggf. weniger).
		assert.ok(withoutBattery.prechargeExtraK <= withBattery.prechargeExtraK);

		const diag = evaluateThermalReserveDiagnostics({
			nowMs: NOW.getTime(),
			estimatedRemainingHours: null,
			estimatedEmptyAtIso: null,
			nextPvHeatOpportunityIso: nextPvIso,
			mayUseBatteryForImmersion: false,
			precharge: withoutBattery,
		});
		if (!diag.prechargeNeeded) {
			assert.equal(diag.energySourceClass, "battery_excluded_by_policy");
		}
	});

	it("schwacher Forecast morgen (mehrtägiges PV-Defizit) → weiter entferntes PV-Fenster, Reserve heute sinnvoller", () => {
		const nearPv = resolveNextPvHeatOpportunityIso({
			explicitIso: null,
			pvDeficitBridgeUntilIso: null,
			now: NOW,
			timezone: "Europe/Berlin",
		});
		const farPv = resolveNextPvHeatOpportunityIso({
			explicitIso: null,
			pvDeficitBridgeUntilIso: new Date(NOW.getTime() + 3 * 24 * 3_600_000).toISOString(),
			now: NOW,
			timezone: "Europe/Berlin",
		});
		const diagNear = evaluateThermalReserveDiagnostics({
			nowMs: NOW.getTime(),
			estimatedRemainingHours: 30,
			estimatedEmptyAtIso: new Date(NOW.getTime() + 30 * 3_600_000).toISOString(),
			nextPvHeatOpportunityIso: nearPv,
			mayUseBatteryForImmersion: true,
			precharge: null,
		});
		const diagFar = evaluateThermalReserveDiagnostics({
			nowMs: NOW.getTime(),
			estimatedRemainingHours: 30,
			estimatedEmptyAtIso: new Date(NOW.getTime() + 30 * 3_600_000).toISOString(),
			nextPvHeatOpportunityIso: farPv,
			mayUseBatteryForImmersion: true,
			precharge: null,
		});
		// Gleiche Reichweite (30 h) reicht bis zum nahen Fenster, aber nicht bis zum weit entfernten.
		assert.equal(diagNear.energySourceClass, "sufficient_no_precharge");
		assert.notEqual(diagFar.energySourceClass, "sufficient_no_precharge");
	});

	it("fehlende Forecast-/Learning-Daten → konservativer, klar begründeter Fallback (keine erfundene Reichweite)", () => {
		const diag = evaluateThermalReserveDiagnostics({
			nowMs: NOW.getTime(),
			estimatedRemainingHours: null,
			estimatedEmptyAtIso: null,
			nextPvHeatOpportunityIso: null,
			mayUseBatteryForImmersion: null,
			precharge: null,
		});
		assert.equal(diag.energySourceClass, "insufficient_data");
		assert.equal(diag.prechargeNeeded, false);
		assert.match(diag.reasonDe, /Weder thermische Restreichweite noch nächstes PV-Fenster bekannt/);
	});
});
