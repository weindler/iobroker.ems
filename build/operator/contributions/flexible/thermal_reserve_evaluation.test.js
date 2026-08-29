"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const thermal_reserve_evaluation_js_1 = require("./thermal_reserve_evaluation.js");
const thermal_pv_precharge_js_1 = require("./thermal_pv_precharge.js");
const NOW = new Date("2026-08-28T18:45:00.000Z"); // Abend, wie im realen Vorfall
(0, node_test_1.describe)("resolveNextPvHeatOpportunityIso — Priorität bestehender Quellen", () => {
    (0, node_test_1.it)("bevorzugt einen explizit übergebenen Zeitpunkt", () => {
        const iso = (0, thermal_reserve_evaluation_js_1.resolveNextPvHeatOpportunityIso)({
            explicitIso: "2026-08-29T07:00:00.000Z",
            pvDeficitBridgeUntilIso: "2026-08-30T23:59:59.000Z",
            now: NOW,
            timezone: "Europe/Berlin",
        });
        strict_1.default.equal(iso, "2026-08-29T07:00:00.000Z");
    });
    (0, node_test_1.it)("nutzt das mehrtägige PV-Defizit-Ende, wenn kein expliziter Wert vorliegt (schwacher Forecast morgen)", () => {
        const iso = (0, thermal_reserve_evaluation_js_1.resolveNextPvHeatOpportunityIso)({
            explicitIso: null,
            pvDeficitBridgeUntilIso: "2026-08-31T21:59:59.000Z",
            now: NOW,
            timezone: "Europe/Berlin",
        });
        strict_1.default.equal(iso, "2026-08-31T21:59:59.000Z");
    });
    (0, node_test_1.it)("fällt auf den nächsten Morgen zurück, wenn nichts anderes bekannt ist", () => {
        const iso = (0, thermal_reserve_evaluation_js_1.resolveNextPvHeatOpportunityIso)({
            now: NOW,
            timezone: "Europe/Berlin",
        });
        const ms = Date.parse(iso);
        strict_1.default.ok(ms > NOW.getTime());
        strict_1.default.ok(ms - NOW.getTime() < 24 * 3_600_000);
    });
});
(0, node_test_1.describe)("gateBatteryInputsForThermalPrecharge — Batteriebezug sauber (Block 4)", () => {
    (0, node_test_1.it)("blendet Batteriesignale vollständig aus, wenn die Policy die Batterie für den Heizstab nicht erlaubt", () => {
        const r = (0, thermal_reserve_evaluation_js_1.gateBatteryInputsForThermalPrecharge)({
            mayUseBatteryForImmersion: false,
            batterySocPct: 98,
            centralBatteryReserveRequiredSocAtPvEndPct: 40,
            legacyBatteryEndSocTargetPct: 90,
        });
        strict_1.default.equal(r.batterySocPct, null);
        strict_1.default.equal(r.batteryEndSocTargetPct, null);
        strict_1.default.match(r.reasonDe, /nicht erlaubt/);
    });
    (0, node_test_1.it)("verwendet die zentrale Batterie-Reserve, wenn die Policy die Batterie erlaubt", () => {
        const r = (0, thermal_reserve_evaluation_js_1.gateBatteryInputsForThermalPrecharge)({
            mayUseBatteryForImmersion: true,
            batterySocPct: 80,
            centralBatteryReserveRequiredSocAtPvEndPct: 45,
            legacyBatteryEndSocTargetPct: 90,
        });
        strict_1.default.equal(r.batterySocPct, 80);
        strict_1.default.equal(r.batteryEndSocTargetPct, 45);
        strict_1.default.match(r.reasonDe, /Zentrale Batterie-Reserve/);
    });
    (0, node_test_1.it)("fällt auf das Legacy-Ziel zurück, wenn die zentrale Reserve unbekannt ist", () => {
        const r = (0, thermal_reserve_evaluation_js_1.gateBatteryInputsForThermalPrecharge)({
            mayUseBatteryForImmersion: true,
            batterySocPct: 80,
            centralBatteryReserveRequiredSocAtPvEndPct: null,
            legacyBatteryEndSocTargetPct: 90,
        });
        strict_1.default.equal(r.batteryEndSocTargetPct, 90);
        strict_1.default.match(r.reasonDe, /Legacy-Ladeziel/);
    });
    (0, node_test_1.it)("lässt Batteriesignale unverändert durch, wenn die Policy-Erlaubnis unbekannt ist (nicht false)", () => {
        const r = (0, thermal_reserve_evaluation_js_1.gateBatteryInputsForThermalPrecharge)({
            mayUseBatteryForImmersion: null,
            batterySocPct: 80,
            centralBatteryReserveRequiredSocAtPvEndPct: null,
            legacyBatteryEndSocTargetPct: null,
        });
        strict_1.default.equal(r.batterySocPct, 80);
    });
});
(0, node_test_1.describe)("evaluateThermalReserveDiagnostics — Beispiel aus der Aufgabe (62 h reicht, gutes Fenster kommt)", () => {
    (0, node_test_1.it)("viel thermische Reichweite + gutes PV-Fenster morgen → kein Precharge nötig", () => {
        const nextPvIso = new Date(NOW.getTime() + 12 * 3_600_000).toISOString(); // morgen früh
        const precharge = (0, thermal_pv_precharge_js_1.resolveThermalPvPrecharge)({
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
        strict_1.default.equal(precharge.active, false, precharge.reasonDe);
        const diag = (0, thermal_reserve_evaluation_js_1.evaluateThermalReserveDiagnostics)({
            nowMs: NOW.getTime(),
            estimatedRemainingHours: 62,
            estimatedEmptyAtIso: new Date(NOW.getTime() + 62 * 3_600_000).toISOString(),
            nextPvHeatOpportunityIso: nextPvIso,
            mayUseBatteryForImmersion: false,
            precharge,
        });
        strict_1.default.equal(diag.prechargeNeeded, false);
        strict_1.default.equal(diag.energySourceClass, "sufficient_no_precharge");
        strict_1.default.match(diag.reasonDe, /reicht bis zum nächsten PV-Fenster/);
    });
    (0, node_test_1.it)("geringe Reichweite → Precharge nötig", () => {
        const nextPvIso = new Date(NOW.getTime() + 14 * 3_600_000).toISOString();
        const precharge = (0, thermal_pv_precharge_js_1.resolveThermalPvPrecharge)({
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
        strict_1.default.equal(precharge.active, true, precharge.reasonDe);
        const diag = (0, thermal_reserve_evaluation_js_1.evaluateThermalReserveDiagnostics)({
            nowMs: NOW.getTime(),
            estimatedRemainingHours: 4,
            estimatedEmptyAtIso: new Date(NOW.getTime() + 4 * 3_600_000).toISOString(),
            nextPvHeatOpportunityIso: nextPvIso,
            mayUseBatteryForImmersion: true,
            precharge,
        });
        strict_1.default.equal(diag.prechargeNeeded, true);
        strict_1.default.equal(diag.energySourceClass, "pv_surplus");
    });
    (0, node_test_1.it)("Batterie nicht für Heizstab erlaubt → keine implizite Batterie-Annahme macht Precharge attraktiver", () => {
        const nextPvIso = new Date(NOW.getTime() + 12 * 3_600_000).toISOString();
        const gate = (0, thermal_reserve_evaluation_js_1.gateBatteryInputsForThermalPrecharge)({
            mayUseBatteryForImmersion: false,
            batterySocPct: 100,
            centralBatteryReserveRequiredSocAtPvEndPct: 30,
            legacyBatteryEndSocTargetPct: 30,
        });
        const withoutBattery = (0, thermal_pv_precharge_js_1.resolveThermalPvPrecharge)({
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
        const withBattery = (0, thermal_pv_precharge_js_1.resolveThermalPvPrecharge)({
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
        strict_1.default.ok(withoutBattery.prechargeExtraK <= withBattery.prechargeExtraK);
        const diag = (0, thermal_reserve_evaluation_js_1.evaluateThermalReserveDiagnostics)({
            nowMs: NOW.getTime(),
            estimatedRemainingHours: null,
            estimatedEmptyAtIso: null,
            nextPvHeatOpportunityIso: nextPvIso,
            mayUseBatteryForImmersion: false,
            precharge: withoutBattery,
        });
        if (!diag.prechargeNeeded) {
            strict_1.default.equal(diag.energySourceClass, "battery_excluded_by_policy");
        }
    });
    (0, node_test_1.it)("schwacher Forecast morgen (mehrtägiges PV-Defizit) → weiter entferntes PV-Fenster, Reserve heute sinnvoller", () => {
        const nearPv = (0, thermal_reserve_evaluation_js_1.resolveNextPvHeatOpportunityIso)({
            explicitIso: null,
            pvDeficitBridgeUntilIso: null,
            now: NOW,
            timezone: "Europe/Berlin",
        });
        const farPv = (0, thermal_reserve_evaluation_js_1.resolveNextPvHeatOpportunityIso)({
            explicitIso: null,
            pvDeficitBridgeUntilIso: new Date(NOW.getTime() + 3 * 24 * 3_600_000).toISOString(),
            now: NOW,
            timezone: "Europe/Berlin",
        });
        const diagNear = (0, thermal_reserve_evaluation_js_1.evaluateThermalReserveDiagnostics)({
            nowMs: NOW.getTime(),
            estimatedRemainingHours: 30,
            estimatedEmptyAtIso: new Date(NOW.getTime() + 30 * 3_600_000).toISOString(),
            nextPvHeatOpportunityIso: nearPv,
            mayUseBatteryForImmersion: true,
            precharge: null,
        });
        const diagFar = (0, thermal_reserve_evaluation_js_1.evaluateThermalReserveDiagnostics)({
            nowMs: NOW.getTime(),
            estimatedRemainingHours: 30,
            estimatedEmptyAtIso: new Date(NOW.getTime() + 30 * 3_600_000).toISOString(),
            nextPvHeatOpportunityIso: farPv,
            mayUseBatteryForImmersion: true,
            precharge: null,
        });
        // Gleiche Reichweite (30 h) reicht bis zum nahen Fenster, aber nicht bis zum weit entfernten.
        strict_1.default.equal(diagNear.energySourceClass, "sufficient_no_precharge");
        strict_1.default.notEqual(diagFar.energySourceClass, "sufficient_no_precharge");
    });
    (0, node_test_1.it)("fehlende Forecast-/Learning-Daten → konservativer, klar begründeter Fallback (keine erfundene Reichweite)", () => {
        const diag = (0, thermal_reserve_evaluation_js_1.evaluateThermalReserveDiagnostics)({
            nowMs: NOW.getTime(),
            estimatedRemainingHours: null,
            estimatedEmptyAtIso: null,
            nextPvHeatOpportunityIso: null,
            mayUseBatteryForImmersion: null,
            precharge: null,
        });
        strict_1.default.equal(diag.energySourceClass, "insufficient_data");
        strict_1.default.equal(diag.prechargeNeeded, false);
        strict_1.default.match(diag.reasonDe, /Weder thermische Restreichweite noch nächstes PV-Fenster bekannt/);
    });
});
