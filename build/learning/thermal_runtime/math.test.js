"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const config_1 = require("./config");
const constants_1 = require("./constants");
const history_1 = require("./history");
const math_1 = require("./math");
const persist_1 = require("./persist");
const fs = __importStar(require("node:fs/promises"));
const os = __importStar(require("node:os"));
const path = __importStar(require("node:path"));
const MS_H = 3_600_000;
function cfg(overrides = {}) {
    return {
        enabled: true,
        lookbackDays: 90,
        temperatureStateId: "",
        fullThresholdC: 60,
        emptyThresholdC: 48,
        minRuntimeHours: 0.5,
        maxRuntimeHours: 72,
        ...overrides,
    };
}
function coolingCurve(startMs, startTemp, endTemp, hours, steps = 6) {
    const out = [];
    for (let i = 0; i <= steps; i++) {
        const frac = i / steps;
        out.push({
            ts: startMs + frac * hours * MS_H,
            tempC: startTemp + (endTemp - startTemp) * frac,
        });
    }
    return out;
}
(0, node_test_1.describe)("thermal runtime validation", () => {
    (0, node_test_1.it)("rejects null and NaN temperatures", () => {
        strict_1.default.equal((0, history_1.isValidTempC)(null), false);
        strict_1.default.equal((0, history_1.isValidTempC)(Number.NaN), false);
        strict_1.default.equal((0, history_1.isValidTempC)(55.2), true);
    });
    (0, node_test_1.it)("rejects full <= empty config", () => {
        const c = cfg({ fullThresholdC: 48, emptyThresholdC: 60 });
        strict_1.default.equal((0, config_1.configIsValid)(c), false);
        const r = (0, math_1.invalidConfigResult)("alias.0.temp");
        strict_1.default.equal(r.status, "invalid_config");
        strict_1.default.equal(r.health, "invalid_config");
    });
});
(0, node_test_1.describe)("thermal runtime cycle detection", () => {
    (0, node_test_1.it)("detects cooling from local peak down to floor (classic high start)", () => {
        const base = new Date(2026, 0, 6, 8, 0, 0).getTime();
        const points = coolingCurve(base, 62, 47, 10);
        const cycles = (0, math_1.detectRuntimeCycles)(points, cfg());
        strict_1.default.equal(cycles.length, 1);
        strict_1.default.equal(cycles[0].startTempC, 62);
        strict_1.default.equal(cycles[0].endTempC, 47);
        strict_1.default.ok(cycles[0].runtimeHours >= 9.9 && cycles[0].runtimeHours <= 10.1);
        strict_1.default.ok(cycles[0].coolingRateCPerH > 1);
    });
    (0, node_test_1.it)("detects cooling when start is in band without reaching full threshold", () => {
        const base = new Date(2026, 0, 6, 8, 0, 0).getTime();
        const points = coolingCurve(base, 55, 47, 8);
        const cycles = (0, math_1.detectRuntimeCycles)(points, cfg({ fullThresholdC: 60, emptyThresholdC: 48 }));
        strict_1.default.equal(cycles.length, 1);
        strict_1.default.equal(cycles[0].startTempC, 55);
        strict_1.default.ok(cycles[0].endTempC <= 48);
    });
    (0, node_test_1.it)("ignores incomplete segments that never reach floor", () => {
        const base = new Date(2026, 0, 6, 8, 0, 0).getTime();
        const points = coolingCurve(base, 59, 52, 5);
        const cycles = (0, math_1.detectRuntimeCycles)(points, cfg());
        strict_1.default.equal(cycles.length, 0);
    });
    (0, node_test_1.it)("ignores cycles shorter than min_runtime_hours", () => {
        const base = new Date(2026, 0, 6, 8, 0, 0).getTime();
        const points = coolingCurve(base, 62, 47, 0.2);
        const cycles = (0, math_1.detectRuntimeCycles)(points, cfg({ minRuntimeHours: 0.5 }));
        strict_1.default.equal(cycles.length, 0);
    });
    (0, node_test_1.it)("estimates an active cooling rate before the floor is reached", () => {
        const base = new Date(2026, 0, 6, 8, 0, 0).getTime();
        // Läuft noch: 59 -> 55 °C in 48h, Untergrenze 48 °C noch nicht erreicht.
        const points = coolingCurve(base, 59, 55, 48, 8);
        const rate = (0, math_1.estimateActiveCoolingRateCPerH)(points, cfg());
        strict_1.default.equal(rate, 0.083);
        strict_1.default.equal((0, math_1.detectRuntimeCycles)(points, cfg()).length, 0);
    });
    (0, node_test_1.it)("ignores reheating plateaus — rate stays the natural cooldown, not the mixed trend", () => {
        const base = new Date(2026, 0, 6, 8, 0, 0).getTime();
        // Echtes Abkühlen 58->54 in 8h (0.5 °C/h), dann Nachheizen zurück auf 58,
        // dann langes Plateau. Mischtrend wäre viel flacher als 0.5.
        const cooling = coolingCurve(base, 58, 54, 8, 8);
        const reheatStart = cooling[cooling.length - 1].ts;
        const reheat = coolingCurve(reheatStart, 54, 58, 4, 4);
        const plateauStart = reheat[reheat.length - 1].ts;
        const plateau = [];
        for (let h = 1; h <= 40; h++) {
            plateau.push({ ts: plateauStart + h * MS_H, tempC: 58 - 0.1 });
        }
        const points = [...cooling, ...reheat, ...plateau];
        const rate = (0, math_1.estimateActiveCoolingRateCPerH)(points, cfg());
        strict_1.default.ok(rate !== null && rate >= 0.45 && rate <= 0.55, `rate=${rate}`);
    });
    (0, node_test_1.it)("collects multiple cooling segments and uses their median rate", () => {
        const base = new Date(2026, 0, 6, 8, 0, 0).getTime();
        const seg1 = coolingCurve(base, 58, 53, 10, 10); // 0.5 °C/h
        const gapStart = seg1[seg1.length - 1].ts;
        const reheat = coolingCurve(gapStart, 53, 59, 3, 6); // Nachheizen
        const seg2Start = reheat[reheat.length - 1].ts;
        const seg2 = coolingCurve(seg2Start, 59, 51, 8, 8); // 1.0 °C/h
        const points = [...seg1, ...reheat, ...seg2];
        const segments = (0, math_1.collectCoolingSegments)(points, cfg().minRuntimeHours);
        strict_1.default.equal(segments.length, 2);
        const rate = (0, math_1.estimateActiveCoolingRateCPerH)(points, cfg());
        strict_1.default.ok(rate !== null && rate >= 0.7 && rate <= 0.8, `rate=${rate}`);
    });
});
(0, node_test_1.describe)("thermal runtime remaining estimate", () => {
    (0, node_test_1.it)("returns 0 when at or below empty threshold", () => {
        strict_1.default.equal((0, math_1.estimateRemainingHours)({
            currentTempC: 48,
            fullThresholdC: 60,
            emptyThresholdC: 48,
            typicalRuntimeHours: 12,
            coolingRateCPerHAvg: 1.2,
        }), 0);
    });
    (0, node_test_1.it)("uses cooling rate from current temp (not fixed full threshold)", () => {
        const h = (0, math_1.estimateRemainingHours)({
            currentTempC: 59,
            fullThresholdC: 60,
            emptyThresholdC: 48,
            typicalRuntimeHours: 14,
            coolingRateCPerHAvg: 2,
        });
        strict_1.default.equal(h, 5.5);
    });
    (0, node_test_1.it)("interpolates via cooling rate between thresholds", () => {
        const h = (0, math_1.estimateRemainingHours)({
            currentTempC: 54,
            fullThresholdC: 60,
            emptyThresholdC: 48,
            typicalRuntimeHours: 14,
            coolingRateCPerHAvg: 2,
        });
        strict_1.default.equal(h, 3);
    });
    (0, node_test_1.it)("returns null without sufficient learned rate", () => {
        strict_1.default.equal((0, math_1.estimateRemainingHours)({
            currentTempC: 54,
            fullThresholdC: 60,
            emptyThresholdC: 48,
            typicalRuntimeHours: null,
            coolingRateCPerHAvg: null,
        }), null);
    });
    (0, node_test_1.it)("uses Newtonian cooling when a cooling constant is provided", () => {
        // t = ln((58-18)/(48-18)) / k = ln(40/30)/0.05 = 5.754 h
        const h = (0, math_1.estimateRemainingHours)({
            currentTempC: 58,
            fullThresholdC: 60,
            emptyThresholdC: 48,
            typicalRuntimeHours: null,
            coolingRateCPerHAvg: null,
            coolingConstantPerH: 0.05,
            ambientC: 18,
        });
        strict_1.default.ok(h !== null && Math.abs(h - 5.754) < 0.01, `h=${h}`);
    });
    (0, node_test_1.it)("Newtonian: cooling slows as the buffer approaches ambient", () => {
        const common = {
            fullThresholdC: 60,
            emptyThresholdC: 48,
            typicalRuntimeHours: null,
            coolingRateCPerHAvg: null,
            coolingConstantPerH: 0.05,
            ambientC: 18,
        };
        const r58 = (0, math_1.estimateRemainingHours)({ ...common, currentTempC: 58 });
        const r53 = (0, math_1.estimateRemainingHours)({ ...common, currentTempC: 53 });
        // Die ersten 5 °C (58→53) gehen schneller als die letzten 5 °C (53→48).
        strict_1.default.ok(r58 - r53 < r53, `first5=${r58 - r53} last5=${r53}`);
    });
});
(0, node_test_1.describe)("thermal newtonian cooling constant", () => {
    (0, node_test_1.it)("derives a positive cooling constant from a falling segment", () => {
        const base = new Date(2026, 0, 6, 8, 0, 0).getTime();
        // 58 → 48 °C über 10 h → k = ln((58-18)/(48-18))/10 ≈ 0.02877 /h
        const points = coolingCurve(base, 58, 48, 10, 10);
        const k = (0, math_1.estimateCoolingConstantPerH)(points, cfg(), 18);
        strict_1.default.ok(k !== null && Math.abs(k - 0.02877) < 0.002, `k=${k}`);
    });
    (0, node_test_1.it)("returns null when no falling segment qualifies", () => {
        const base = new Date(2026, 0, 6, 8, 0, 0).getTime();
        const points = coolingCurve(base, 55, 54.5, 5, 5); // <2 °C Abfall
        strict_1.default.equal((0, math_1.estimateCoolingConstantPerH)(points, cfg(), 18), null);
    });
    (0, node_test_1.it)("fits a higher asymptote from segments at different temperatures", () => {
        const base = new Date(2026, 0, 6, 8, 0, 0).getTime();
        const hot = coolingCurve(base, 62, 54, 4, 8); // ~2 °C/h bei ~58 °C
        const reheat = coolingCurve(hot[hot.length - 1].ts, 54, 59, 2, 4);
        const cool = coolingCurve(reheat[reheat.length - 1].ts, 59, 48, 12, 8); // ~0.92 °C/h bei ~53 °C
        const points = [...hot, ...reheat, ...cool];
        const model = (0, math_1.estimateCoolingModel)(points, cfg({ emptyThresholdC: 48 }));
        strict_1.default.equal(model.asymptoteSource, "fitted");
        strict_1.default.ok(model.asymptoteC > constants_1.DEFAULT_AMBIENT_C + 10, `asym=${model.asymptoteC}`);
        strict_1.default.ok(model.coolingConstantPerH !== null && model.coolingConstantPerH > 0);
    });
    (0, node_test_1.it)("extends remaining time with a fitted high asymptote vs fixed ambient", () => {
        const withAmbient = (0, math_1.estimateRemainingHours)({
            currentTempC: 55,
            fullThresholdC: 60,
            emptyThresholdC: 48,
            typicalRuntimeHours: null,
            coolingRateCPerHAvg: null,
            coolingConstantPerH: 0.03,
            ambientC: 18,
        });
        const withAsymptote = (0, math_1.estimateRemainingHours)({
            currentTempC: 55,
            fullThresholdC: 60,
            emptyThresholdC: 48,
            typicalRuntimeHours: null,
            coolingRateCPerHAvg: null,
            coolingConstantPerH: 0.03,
            ambientC: 42,
        });
        strict_1.default.ok(withAsymptote !== null && withAmbient !== null && withAsymptote > withAmbient, `asym=${withAsymptote} amb=${withAmbient}`);
    });
});
(0, node_test_1.describe)("thermal runtime compute", () => {
    (0, node_test_1.it)("reports no_samples without cycles", () => {
        const r = (0, math_1.computeThermalRuntimeLearning)({
            cycles: [],
            currentTempC: 55,
            cfg: cfg(),
            sourceStateId: "alias.0.temp",
            now: new Date("2026-06-21T10:00:00"),
        });
        strict_1.default.equal(r.status, "insufficient_data");
        strict_1.default.equal(r.health, "no_samples");
        strict_1.default.equal(r.samples, 0);
        strict_1.default.equal(r.estimatedRemainingHours, null);
    });
    (0, node_test_1.it)("is ready with active cooling rate even without completed floor cycles", () => {
        const r = (0, math_1.computeThermalRuntimeLearning)({
            cycles: [],
            currentTempC: 55,
            cfg: cfg(),
            sourceStateId: "alias.0.temp",
            now: new Date("2026-06-21T10:00:00"),
            activeCoolingRateCPerH: 0.1,
        });
        strict_1.default.equal(r.status, "ready");
        strict_1.default.equal(r.health, "ok");
        strict_1.default.equal(r.samples, 0);
        strict_1.default.equal(r.estimatedRemainingHours, 70);
        strict_1.default.equal(r.estimatedEmptyAt, "2026-06-24T06:00:00.000Z");
    });
    (0, node_test_1.it)("is ready with Newton cooling model even without completed floor cycles", () => {
        const r = (0, math_1.computeThermalRuntimeLearning)({
            cycles: [],
            currentTempC: 55,
            cfg: cfg(),
            sourceStateId: "alias.0.temp",
            now: new Date("2026-06-21T10:00:00"),
            coolingConstantPerH: 0.03,
            asymptoteC: 18,
            asymptoteSource: "default",
        });
        strict_1.default.equal(r.status, "ready");
        strict_1.default.equal(r.health, "ok");
        strict_1.default.equal(r.samples, 0);
        strict_1.default.equal(r.coolingConstantPerH, 0.03);
        strict_1.default.equal(r.coolingAsymptoteC, 18);
        strict_1.default.ok(r.estimatedRemainingHours !== null);
    });
    (0, node_test_1.it)("no_source result", () => {
        const r = (0, math_1.noSourceResult)();
        strict_1.default.equal(r.health, "no_source");
        strict_1.default.equal(r.samples, 0);
    });
});
(0, node_test_1.describe)("thermal runtime config", () => {
    (0, node_test_1.it)("reads admin defaults", () => {
        const c = (0, config_1.thermalRuntimeConfigFromAdapter)({});
        strict_1.default.equal(c.fullThresholdC, 60);
        strict_1.default.equal(c.emptyThresholdC, 48);
        strict_1.default.equal(c.enabled, true);
    });
});
(0, node_test_1.describe)("thermal runtime persist", () => {
    (0, node_test_1.it)("roundtrips persist file", async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), "tr-"));
        const base = new Date(2026, 0, 6, 8, 0, 0).getTime();
        const cycles = (0, math_1.detectRuntimeCycles)(coolingCurve(base, 62, 47, 10), cfg());
        const result = (0, math_1.computeThermalRuntimeLearning)({
            cycles,
            currentTempC: 55,
            cfg: cfg(),
            sourceStateId: "alias.0.temp",
            now: new Date("2026-06-21T10:00:00"),
        });
        await (0, persist_1.writeThermalRuntimePersist)(dir, result, "2026-06-21T10:00:00.000Z");
        const read = await (0, persist_1.readThermalRuntimePersist)(dir);
        strict_1.default.ok(read);
        strict_1.default.equal(read?.module, "thermal_runtime_learning_v1");
        strict_1.default.equal(read?.samples, 1);
    });
});
