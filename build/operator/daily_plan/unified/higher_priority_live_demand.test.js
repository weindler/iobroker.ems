"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const higher_priority_live_demand_1 = require("./higher_priority_live_demand");
const Q_OK = { status: "valid", confidencePct: 80, reasonDe: "fixture" };
const FRESH = { observedAtIso: "2026-08-19T10:00:00.000Z", ageSec: 0, quality: Q_OK };
function wallbox(overrides = {}) {
    return {
        connectedNow: true,
        presenceWindows: [],
        presenceHardConstraint: true,
        vehicleProfileId: null,
        vehicleSocPct: null,
        socSource: "unknown",
        fallbackEnergyNeedKwh: null,
        vehicleCapacityKwh: null,
        targetSocPct: null,
        requiredEnergyKwh: 5,
        deadlineIso: null,
        energyGoalHard: false,
        minChargePowerW: null,
        maxChargePowerW: null,
        chargeLossFactor: null,
        evccExecutionMaster: true,
        uncertainty: Q_OK,
        freshness: FRESH,
        ...overrides,
    };
}
function climateUnit(overrides = {}) {
    return {
        unitId: "unit_1",
        label: "Wohnzimmer",
        roomTempC: 24,
        comfortMinC: null,
        comfortMaxC: 23,
        targetTempC: 23,
        mandatoryComfort: true,
        expectedEnergyKwh: null,
        typicalPowerW: 721,
        maxShiftHours: 0,
        uncertainty: Q_OK,
        ...overrides,
    };
}
function climate(units) {
    return { units, freshness: FRESH };
}
(0, node_test_1.describe)("computeHigherPriorityLiveDemandW — kein Doppelzählen laufender Verbraucher", () => {
    (0, node_test_1.it)("Wallbox nicht verbunden → keine Reservierung", () => {
        const w = (0, higher_priority_live_demand_1.computeHigherPriorityLiveDemandW)({
            wbLiveWriteAllowed: true,
            wbConnected: false,
            wallbox: wallbox(),
            evccChargePowerNow: null,
            acLiveWriteAllowed: false,
            climate: null,
        });
        strict_1.default.equal(w, 0);
    });
    (0, node_test_1.it)("Wallbox verbunden, lädt noch nicht (0 W Ist) → voller Reserve", () => {
        const w = (0, higher_priority_live_demand_1.computeHigherPriorityLiveDemandW)({
            wbLiveWriteAllowed: true,
            wbConnected: true,
            wallbox: wallbox({ requiredEnergyKwh: 5, maxChargePowerW: 11000, minChargePowerW: 1400 }),
            evccChargePowerNow: 0,
            acLiveWriteAllowed: false,
            climate: null,
        });
        strict_1.default.equal(w, 3500);
    });
    (0, node_test_1.it)("Wallbox lädt schon mit 3000 W → nur die Differenz zum Reserve wird zusätzlich reserviert", () => {
        const w = (0, higher_priority_live_demand_1.computeHigherPriorityLiveDemandW)({
            wbLiveWriteAllowed: true,
            wbConnected: true,
            wallbox: wallbox({ requiredEnergyKwh: 5 }),
            evccChargePowerNow: 3000,
            acLiveWriteAllowed: false,
            climate: null,
        });
        strict_1.default.equal(w, 500);
    });
    (0, node_test_1.it)("Wallbox lädt schon mit voller Reserve-Leistung → keine zusätzliche Reservierung (kein Doppelzählen)", () => {
        const w = (0, higher_priority_live_demand_1.computeHigherPriorityLiveDemandW)({
            wbLiveWriteAllowed: true,
            wbConnected: true,
            wallbox: wallbox({ requiredEnergyKwh: 5 }),
            evccChargePowerNow: 3500,
            acLiveWriteAllowed: false,
            climate: null,
        });
        strict_1.default.equal(w, 0);
    });
    (0, node_test_1.it)("Klima mandatory über Comfort-Max, noch nicht angelaufen → voller typischer Reserve", () => {
        const w = (0, higher_priority_live_demand_1.computeHigherPriorityLiveDemandW)({
            wbLiveWriteAllowed: false,
            wbConnected: null,
            wallbox: null,
            evccChargePowerNow: null,
            acLiveWriteAllowed: true,
            climate: climate([
                climateUnit({ roomTempC: 24, comfortMaxC: 23, typicalPowerW: 721, hardwareRunning: false }),
            ]),
        });
        strict_1.default.equal(w, 721);
    });
    (0, node_test_1.it)("Klima läuft schon mit 425 W (Ist, Runtime-Schätzung) → nur Differenz zu 721 W reserviert", () => {
        const w = (0, higher_priority_live_demand_1.computeHigherPriorityLiveDemandW)({
            wbLiveWriteAllowed: false,
            wbConnected: null,
            wallbox: null,
            evccChargePowerNow: null,
            acLiveWriteAllowed: true,
            climate: climate([
                climateUnit({
                    roomTempC: 24,
                    comfortMaxC: 23,
                    typicalPowerW: 721,
                    hardwareRunning: true,
                    holdPowerW: 425,
                }),
            ]),
        });
        strict_1.default.equal(w, 296);
    });
    (0, node_test_1.it)("Klima läuft schon auf voller typischer Leistung → keine zusätzliche Reservierung (kein Doppelzählen)", () => {
        const w = (0, higher_priority_live_demand_1.computeHigherPriorityLiveDemandW)({
            wbLiveWriteAllowed: false,
            wbConnected: null,
            wallbox: null,
            evccChargePowerNow: null,
            acLiveWriteAllowed: true,
            climate: climate([
                climateUnit({
                    roomTempC: 24,
                    comfortMaxC: 23,
                    typicalPowerW: 721,
                    hardwareRunning: true,
                    holdPowerW: 721,
                }),
            ]),
        });
        strict_1.default.equal(w, 0);
    });
    (0, node_test_1.it)("Klima nicht mandatory (Raum unter Comfort-Max) → keine Reservierung", () => {
        const w = (0, higher_priority_live_demand_1.computeHigherPriorityLiveDemandW)({
            wbLiveWriteAllowed: false,
            wbConnected: null,
            wallbox: null,
            evccChargePowerNow: null,
            acLiveWriteAllowed: true,
            climate: climate([climateUnit({ roomTempC: 22, comfortMaxC: 23 })]),
        });
        strict_1.default.equal(w, 0);
    });
    (0, node_test_1.it)("Realer EMS-Fall: Klima läuft mit 425 W von erw. 721 W, Einspeisung 2209 W, Heizstab braucht 1700 W", () => {
        const reserve = (0, higher_priority_live_demand_1.computeHigherPriorityLiveDemandW)({
            wbLiveWriteAllowed: false,
            wbConnected: null,
            wallbox: null,
            evccChargePowerNow: null,
            acLiveWriteAllowed: true,
            climate: climate([
                climateUnit({
                    roomTempC: 24,
                    comfortMaxC: 23,
                    typicalPowerW: 721,
                    hardwareRunning: true,
                    holdPowerW: 425,
                }),
            ]),
        });
        const liveSurplusW = 2209;
        const availableForIhW = liveSurplusW - reserve;
        strict_1.default.equal(reserve, 296);
        strict_1.default.ok(availableForIhW >= 1700, `erwartet genug Überschuss für den Heizstab nach korrekter Reservierung, war ${availableForIhW} W`);
    });
    (0, node_test_1.it)("Wallbox + Klima gemeinsam addieren sich korrekt", () => {
        const w = (0, higher_priority_live_demand_1.computeHigherPriorityLiveDemandW)({
            wbLiveWriteAllowed: true,
            wbConnected: true,
            wallbox: wallbox({ requiredEnergyKwh: 5 }),
            evccChargePowerNow: 0,
            acLiveWriteAllowed: true,
            climate: climate([
                climateUnit({
                    roomTempC: 24,
                    comfortMaxC: 23,
                    typicalPowerW: 721,
                    hardwareRunning: true,
                    holdPowerW: 425,
                }),
            ]),
        });
        strict_1.default.equal(w, 3500 + 296);
    });
});
