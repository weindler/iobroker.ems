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
    (0, node_test_1.it)("uses active cooling rate for provisional remaining estimate without completed cycles", () => {
        const r = (0, math_1.computeThermalRuntimeLearning)({
            cycles: [],
            currentTempC: 55,
            cfg: cfg(),
            sourceStateId: "alias.0.temp",
            now: new Date("2026-06-21T10:00:00"),
            activeCoolingRateCPerH: 0.1,
        });
        strict_1.default.equal(r.status, "insufficient_data");
        strict_1.default.equal(r.health, "no_samples");
        strict_1.default.equal(r.samples, 0);
        strict_1.default.equal(r.estimatedRemainingHours, 70);
        strict_1.default.equal(r.estimatedEmptyAt, "2026-06-24T06:00:00.000Z");
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
