"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const shared_power_js_1 = require("./shared_power.js");
function wohnzimmer(over = {}) {
    return {
        unitIndex: 1,
        sharedPowerGroupId: "outdoor_1",
        running: false,
        measuredPowerW: null, // kein eigener Sensor
        estimatedPowerW: 900,
        ...over,
    };
}
function josef(over = {}) {
    return {
        unitIndex: 2,
        sharedPowerGroupId: "outdoor_1",
        running: false,
        measuredPowerW: null,
        estimatedPowerW: 700,
        ...over,
    };
}
(0, node_test_1.describe)("resolveAcSystemPower — gemeinsame Außengeräte-Leistung", () => {
    (0, node_test_1.it)("nur Wohnzimmer aktiv, Josef-Sensor liefert Gesamtleistung → genau einmal zählen", () => {
        const results = (0, shared_power_js_1.resolveAcSystemPower)([
            wohnzimmer({ running: true }),
            josef({ running: false, measuredPowerW: 115 }), // Sensor am Außengerät, unabhängig vom eigenen running
        ]);
        strict_1.default.equal(results.length, 1);
        const r = results[0];
        strict_1.default.equal(r.totalPowerW, 115);
        strict_1.default.deepEqual(r.activeUnitIndexes, [1]);
        strict_1.default.equal(r.sharedMeasurementUsed, true);
        strict_1.default.equal(r.measurementUnitIndex, 2);
        strict_1.default.equal((0, shared_power_js_1.totalAcSystemPowerW)(results), 115);
    });
    (0, node_test_1.it)("nur Josef aktiv → genau einmal zählen", () => {
        const results = (0, shared_power_js_1.resolveAcSystemPower)([
            wohnzimmer({ running: false }),
            josef({ running: true, measuredPowerW: 620 }),
        ]);
        strict_1.default.equal(results.length, 1);
        const r = results[0];
        strict_1.default.equal(r.totalPowerW, 620);
        strict_1.default.deepEqual(r.activeUnitIndexes, [2]);
        strict_1.default.equal(r.sharedMeasurementUsed, true);
    });
    (0, node_test_1.it)("beide aktiv → Gesamtleistung weiterhin nur einmal zählen (keine Addition)", () => {
        const results = (0, shared_power_js_1.resolveAcSystemPower)([
            wohnzimmer({ running: true }),
            josef({ running: true, measuredPowerW: 1350 }),
        ]);
        strict_1.default.equal(results.length, 1);
        const r = results[0];
        // NICHT 1350 + geschätzte Wohnzimmer-Leistung — nur der eine gemessene Wert.
        strict_1.default.equal(r.totalPowerW, 1350);
        strict_1.default.deepEqual(r.activeUnitIndexes, [1, 2]);
        strict_1.default.equal(r.sharedMeasurementUsed, true);
        strict_1.default.equal(r.measurementUnitIndex, 2);
    });
    (0, node_test_1.it)("keine Units der Gruppe aktiv → 0 W, keine erfundene Standby-Leistung", () => {
        const results = (0, shared_power_js_1.resolveAcSystemPower)([wohnzimmer(), josef({ measuredPowerW: 12 })]);
        strict_1.default.equal(results[0].totalPowerW, 0);
        strict_1.default.deepEqual(results[0].activeUnitIndexes, []);
    });
    (0, node_test_1.it)("Gruppe ohne reale Messung fällt konservativ auf Schätzsumme zurück (kein Fake-Sensor-Wert)", () => {
        const results = (0, shared_power_js_1.resolveAcSystemPower)([
            wohnzimmer({ running: true, estimatedPowerW: 900 }),
            josef({ running: true, estimatedPowerW: 700, measuredPowerW: null }),
        ]);
        strict_1.default.equal(results[0].sharedMeasurementUsed, false);
        strict_1.default.equal(results[0].totalPowerW, 1600);
    });
    (0, node_test_1.it)("Units ohne sharedPowerGroupId bleiben unverändert eigenständig (Rückwärtskompatibilität)", () => {
        const results = (0, shared_power_js_1.resolveAcSystemPower)([
            { unitIndex: 3, sharedPowerGroupId: null, running: true, measuredPowerW: 800, estimatedPowerW: 750 },
            { unitIndex: 4, sharedPowerGroupId: null, running: false, measuredPowerW: null, estimatedPowerW: 500 },
        ]);
        strict_1.default.equal(results.length, 2);
        const u3 = results.find((r) => r.activeUnitIndexes.includes(3));
        strict_1.default.equal(u3.totalPowerW, 800);
        const u4 = results.find((r) => r.groupId === null && r.activeUnitIndexes.length === 0);
        strict_1.default.equal(u4.totalPowerW, 0);
    });
    (0, node_test_1.it)("keine Doppelzählung in der System-Gesamtsumme über mehrere Gruppen + Standalone", () => {
        const results = (0, shared_power_js_1.resolveAcSystemPower)([
            wohnzimmer({ running: true }),
            josef({ running: true, measuredPowerW: 1350 }),
            { unitIndex: 5, sharedPowerGroupId: null, running: true, measuredPowerW: 400, estimatedPowerW: 400 },
        ]);
        strict_1.default.equal((0, shared_power_js_1.totalAcSystemPowerW)(results), 1350 + 400);
    });
});
