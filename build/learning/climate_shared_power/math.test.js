"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const math_1 = require("./math");
const DAY_MS = 86_400_000;
function seg(overrides = {}) {
    return {
        sharedPowerGroupId: "outdoor_1",
        mode: "cooling",
        activeUnitCombination: "1",
        energyKwh: 0.35, // 700 W über 30 Min
        runtimeSec: 1800,
        valid: true,
        endTs: Date.now(),
        ...overrides,
    };
}
(0, node_test_1.describe)("climate_shared_power math", () => {
    (0, node_test_1.it)("Key-Roundtrip: climateSharedPowerKey/parseClimateSharedPowerKey", () => {
        const key = (0, math_1.climateSharedPowerKey)("outdoor_1", "cooling", "1+2");
        strict_1.default.equal(key, "outdoor_1|cooling|1+2");
        const parsed = (0, math_1.parseClimateSharedPowerKey)(key);
        strict_1.default.deepEqual(parsed, {
            sharedPowerGroupId: "outdoor_1",
            mode: "cooling",
            activeUnitCombination: "1+2",
        });
    });
    (0, node_test_1.it)("ignoriert Segmente ohne sharedPowerGroupId (eigenständige Units bleiben bei consumer_stats)", () => {
        const stats = (0, math_1.computeClimateSharedPowerStats)([seg({ sharedPowerGroupId: null }), seg({ sharedPowerGroupId: null })], Date.now());
        strict_1.default.deepEqual(stats, {});
    });
    (0, node_test_1.it)("ignoriert ungültige Segmente (valid=false) und Anlaufphasen (< Mindestlaufzeit)", () => {
        const now = Date.now();
        const stats = (0, math_1.computeClimateSharedPowerStats)([
            seg({ valid: false, endTs: now }),
            seg({ runtimeSec: 60, endTs: now }), // < 300s Mindestlaufzeit
        ], now);
        strict_1.default.deepEqual(stats, {});
    });
    (0, node_test_1.it)("trennt Solo- und Kombi-Betrieb strikt in unterschiedliche Keys (keine Vermischung)", () => {
        const now = Date.now();
        const segments = [
            // Josef alleine: 700 W, mehrere Tage
            ...Array.from({ length: 5 }, (_, i) => seg({ activeUnitCombination: "2", energyKwh: 0.35, runtimeSec: 1800, endTs: now - i * DAY_MS })),
            // Wohnzimmer+Josef gemeinsam: Außengerät zieht mehr (1000 W), NICHT 700+700
            ...Array.from({ length: 5 }, (_, i) => seg({ activeUnitCombination: "1+2", energyKwh: 0.5, runtimeSec: 1800, endTs: now - i * DAY_MS })),
        ];
        const stats = (0, math_1.computeClimateSharedPowerStats)(segments, now);
        const solo = stats[(0, math_1.climateSharedPowerKey)("outdoor_1", "cooling", "2")];
        const combo = stats[(0, math_1.climateSharedPowerKey)("outdoor_1", "cooling", "1+2")];
        strict_1.default.ok(solo, "Solo-Key fehlt");
        strict_1.default.ok(combo, "Kombi-Key fehlt");
        strict_1.default.equal(solo.medianPowerW, 700);
        strict_1.default.equal(combo.medianPowerW, 1000);
        // Kombi-Wert darf NICHT die Summe zweier Solo-Werte sein (700+700=1400) — reale Messung führt.
        strict_1.default.notEqual(combo.medianPowerW, 1400);
    });
    (0, node_test_1.it)("robuste Ausreißerfilterung (IQR-Fences) verwirft einzelne Sensor-Spikes", () => {
        const values = [700, 705, 698, 702, 699, 5000, 701];
        const trimmed = (0, math_1.trimOutliersIqr)(values);
        strict_1.default.ok(!trimmed.includes(5000), "Ausreißer 5000 wurde nicht entfernt");
        strict_1.default.ok(trimmed.length >= 5);
    });
    (0, node_test_1.it)("Confidence bleibt 0 unterhalb der Mindest-Sample-Anzahl — kein Learning-Wert ohne Beleg", () => {
        const now = Date.now();
        const stats = (0, math_1.computeClimateSharedPowerStats)([seg({ endTs: now }), seg({ endTs: now - DAY_MS })], now);
        const stat = stats[(0, math_1.climateSharedPowerKey)("outdoor_1", "cooling", "1")];
        strict_1.default.equal(stat.sampleCount, 2);
        strict_1.default.equal(stat.confidence, 0);
    });
    (0, node_test_1.it)("Confidence steigt mit Sample-Anzahl und sinkt mit Alter", () => {
        const now = Date.now();
        const fresh = (0, math_1.computeClimateSharedPowerStats)(Array.from({ length: 10 }, (_, i) => seg({ endTs: now - i * 3600_000 })), now)[(0, math_1.climateSharedPowerKey)("outdoor_1", "cooling", "1")];
        const old = (0, math_1.computeClimateSharedPowerStats)(Array.from({ length: 10 }, (_, i) => seg({ endTs: now - 95 * DAY_MS - i * 3600_000 })), now)[(0, math_1.climateSharedPowerKey)("outdoor_1", "cooling", "1")];
        strict_1.default.ok(fresh.confidence > 0.9, `frische Confidence zu niedrig: ${fresh.confidence}`);
        strict_1.default.equal(old.confidence, 0, "über 90 Tage alte Probe muss auf Confidence 0 abklingen");
    });
    (0, node_test_1.it)("Reliability-Gate: unzureichende Confidence → Config-Fallback statt Learning-Wert", () => {
        const stat = (0, math_1.computeClimateSharedPowerStats)([seg(), seg({ endTs: Date.now() - DAY_MS })], Date.now())[(0, math_1.climateSharedPowerKey)("outdoor_1", "cooling", "1")];
        const resolution = (0, math_1.resolveClimateSharedPowerW)(stat, 650);
        strict_1.default.equal(resolution.source, "config");
        strict_1.default.equal(resolution.powerW, 650);
    });
    (0, node_test_1.it)("Reliability-Gate: ausreichende Confidence → gelernter p75-Wert (konservativ, nicht Median)", () => {
        const now = Date.now();
        const segments = [600, 650, 700, 750, 800, 700, 700, 700, 700, 700].map((w, i) => seg({ energyKwh: (w * 0.5) / 1000, runtimeSec: 1800, endTs: now - i * 3600_000 }));
        const stat = (0, math_1.computeClimateSharedPowerStats)(segments, now)[(0, math_1.climateSharedPowerKey)("outdoor_1", "cooling", "1")];
        const resolution = (0, math_1.resolveClimateSharedPowerW)(stat, 700);
        strict_1.default.equal(resolution.source, "learned");
        strict_1.default.ok(resolution.powerW >= stat.medianPowerW, "p75 muss >= Median sein (konservativ)");
    });
    (0, node_test_1.it)("keine erfundenen Werte: ohne jegliches Sample bleibt Stat für diesen Key undefined", () => {
        const stats = (0, math_1.computeClimateSharedPowerStats)([], Date.now());
        strict_1.default.deepEqual(stats, {});
        const resolution = (0, math_1.resolveClimateSharedPowerW)(undefined, 700);
        strict_1.default.equal(resolution.source, "config");
        strict_1.default.equal(resolution.sampleCount, 0);
    });
});
