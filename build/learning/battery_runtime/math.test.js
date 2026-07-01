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
const history_1 = require("./history");
const math_1 = require("./math");
const persist_1 = require("./persist");
const time_1 = require("./time");
const fs = __importStar(require("node:fs/promises"));
const os = __importStar(require("node:os"));
const path = __importStar(require("node:path"));
const MS_H = 3_600_000;
function cfg() {
    return {
        enabled: true,
        lookbackDays: 90,
        socStateId: "",
        powerStateId: "",
        powerInvert: false,
        capacityStateId: "",
        fullChargeSoc: 100,
        topoffIntervalDays: 20,
        nightStart: "22:00",
        nightEnd: "06:00",
        nightAstroEnabled: false,
        nightStartStateId: "",
        nightEndStateId: "",
        secondsSinceFullStateId: "sonnen.0.latestData.secondsSinceFullCharge",
    };
}
function socAt(dateKey, hour, socPct) {
    return {
        ts: (0, time_1.timestampAtLocalTime)(dateKey, hour, 0),
        socPct,
    };
}
(0, node_test_1.describe)("battery runtime validation", () => {
    (0, node_test_1.it)("ignores invalid soc and null power", () => {
        strict_1.default.equal((0, history_1.isValidSoc)(null), false);
        strict_1.default.equal((0, history_1.isValidSoc)(-1), false);
        strict_1.default.equal((0, history_1.isValidSoc)(50), true);
        strict_1.default.equal((0, history_1.normalizeBatteryPowerW)(null), null);
        strict_1.default.equal((0, history_1.normalizeBatteryPowerW)(10), null);
        strict_1.default.equal((0, history_1.normalizeBatteryPowerW)(500), 500);
        strict_1.default.equal((0, history_1.normalizeBatteryPowerW)(-800), -800);
    });
    (0, node_test_1.it)("inverts power sign for sources like Sonnen pacTotal", () => {
        strict_1.default.equal((0, history_1.normalizeBatteryPowerW)(2000, true), -2000);
        strict_1.default.equal((0, history_1.normalizeBatteryPowerW)(-1500, true), 1500);
    });
});
(0, node_test_1.describe)("battery runtime night discharge", () => {
    (0, node_test_1.it)("computes average night discharge percent", () => {
        const points = [
            socAt("2026-01-05", 22, 80),
            socAt("2026-01-06", 6, 72),
            socAt("2026-01-06", 22, 78),
            socAt("2026-01-07", 6, 70),
        ];
        const r = (0, math_1.computeNightDischarges)({
            socPoints: points,
            nightStart: "22:00",
            nightEnd: "06:00",
            capacityKwh: null,
        });
        strict_1.default.equal(r.validNights, 2);
        strict_1.default.equal(r.avgPct, 8);
        strict_1.default.equal(r.avgKwh, null);
    });
    (0, node_test_1.it)("computes kwh with capacity", () => {
        const points = [
            socAt("2026-01-05", 22, 80),
            socAt("2026-01-06", 6, 70),
        ];
        const r = (0, math_1.computeNightDischarges)({
            socPoints: points,
            nightStart: "22:00",
            nightEnd: "06:00",
            capacityKwh: 10,
        });
        strict_1.default.equal(r.avgKwh, 1);
    });
    (0, node_test_1.it)("does not treat missing kwh as zero without capacity", () => {
        const r = (0, math_1.computeNightDischarges)({
            socPoints: [socAt("2026-01-05", 22, 80), socAt("2026-01-06", 6, 70)],
            nightStart: "22:00",
            nightEnd: "06:00",
            capacityKwh: null,
        });
        strict_1.default.equal(r.avgKwh, null);
    });
    (0, node_test_1.it)("uses per-day astro times with fixed fallback", () => {
        const points = [
            socAt("2026-06-20", 22, 80),
            socAt("2026-06-21", 5, 72),
        ];
        const astroDaily = (0, history_1.mergeDailyAstroTimes)([{ ts: Date.parse("2026-06-20T08:00:00"), dateKey: "2026-06-20", hour: 23, minute: 0 }], [{ ts: Date.parse("2026-06-21T08:00:00"), dateKey: "2026-06-21", hour: 4, minute: 30 }]);
        const r = (0, math_1.computeNightDischarges)({
            socPoints: points,
            nightStart: "22:00",
            nightEnd: "06:00",
            astroDaily,
            capacityKwh: null,
        });
        strict_1.default.equal(r.validNights, 1);
        strict_1.default.equal(r.avgPct, 8);
    });
});
(0, node_test_1.describe)("battery runtime astro parse", () => {
    (0, node_test_1.it)("parses HH:MM:SS astro strings", () => {
        strict_1.default.deepEqual((0, history_1.parseAstroTimeValue)("22:03:12"), { hour: 22, minute: 3 });
        strict_1.default.deepEqual((0, history_1.parseAstroTimeValue)("04:22:52"), { hour: 4, minute: 22 });
        strict_1.default.equal((0, history_1.parseAstroTimeValue)(""), null);
    });
});
(0, node_test_1.describe)("battery runtime rates and power", () => {
    (0, node_test_1.it)("separates charge and discharge soc rates", () => {
        const points = [
            { ts: 0, socPct: 50 },
            { ts: MS_H, socPct: 55 },
            { ts: 2 * MS_H, socPct: 52 },
        ];
        const r = (0, math_1.computeSocRates)(points);
        strict_1.default.equal(r.avgChargeRatePctH, 5);
        strict_1.default.equal(r.avgDischargeRatePctH, 3);
    });
    (0, node_test_1.it)("computes max charge and discharge power", () => {
        const points = [
            { ts: 0, powerW: 2000 },
            { ts: MS_H, powerW: -1500 },
            { ts: 2 * MS_H, powerW: 3000 },
        ];
        const r = (0, math_1.computePowerStats)(points);
        strict_1.default.equal(r.maxChargePowerW, 3000);
        strict_1.default.equal(r.maxDischargePowerW, 1500);
        strict_1.default.equal(r.avgChargePowerW, 2500);
        strict_1.default.equal(r.avgDischargePowerW, 1500);
    });
});
(0, node_test_1.describe)("battery runtime full charge and topoff", () => {
    (0, node_test_1.it)("detects last full charge at 100%", () => {
        const points = [
            { ts: Date.parse("2026-01-01T10:00:00Z"), socPct: 90 },
            { ts: Date.parse("2026-01-10T10:00:00Z"), socPct: 100 },
            { ts: Date.parse("2026-01-11T10:00:00Z"), socPct: 92 },
        ];
        strict_1.default.equal((0, math_1.findLastFullCharge)(points, 100), "2026-01-10T10:00:00.000Z");
    });
    (0, node_test_1.it)("does not treat 95% as full when threshold is 100%", () => {
        const points = [{ ts: Date.parse("2026-06-30T10:00:00Z"), socPct: 95 }];
        strict_1.default.equal((0, math_1.findLastFullCharge)(points, 100), null);
    });
    (0, node_test_1.it)("detects full charge peak missed by hourly dedup", () => {
        const hourly = [
            { ts: Date.parse("2026-06-30T09:00:00Z"), socPct: 88 },
            { ts: Date.parse("2026-06-30T10:00:00Z"), socPct: 91 },
        ];
        const raw = [
            ...hourly,
            { ts: Date.parse("2026-06-30T09:45:00Z"), socPct: 100 },
        ];
        strict_1.default.equal((0, math_1.findLastFullCharge)(hourly, 100), null);
        strict_1.default.equal((0, math_1.findLastFullCharge)(raw, 100), "2026-06-30T09:45:00.000Z");
    });
    (0, node_test_1.it)("prefers live soc when currently full", () => {
        const points = [{ ts: Date.parse("2026-06-29T10:00:00Z"), socPct: 100 }];
        const liveTs = Date.parse("2026-06-30T14:00:00Z");
        strict_1.default.equal((0, math_1.findLastFullCharge)(points, 100, { socPct: 100, ts: liveTs }), "2026-06-30T14:00:00.000Z");
    });
    (0, node_test_1.it)("uses Sonnen secondsSinceFullCharge when available", () => {
        const now = new Date("2026-07-01T12:00:00.000Z");
        const seconds = 86_400;
        const resolved = (0, math_1.resolveLastFullCharge)({
            secondsSinceFull: seconds,
            socPointsForFullCharge: [],
            fullChargeSoc: 100,
            currentSocPct: 80,
            now,
        });
        strict_1.default.equal(resolved.fullChargeSource, "device");
        strict_1.default.equal(resolved.lastFullCharge, (0, math_1.fullChargeFromSecondsSince)(seconds, now));
        const topoff = (0, math_1.computeTopoffStatus)({
            lastFullCharge: resolved.lastFullCharge,
            topoffIntervalDays: 20,
            now,
        });
        strict_1.default.equal(topoff.daysSinceFull, 1);
    });
    (0, node_test_1.it)("falls back to soc history when device counter missing", () => {
        const now = new Date("2026-07-01T12:00:00.000Z");
        const resolved = (0, math_1.resolveLastFullCharge)({
            secondsSinceFull: null,
            socPointsForFullCharge: [
                { ts: Date.parse("2026-06-30T10:00:00Z"), socPct: 100 },
            ],
            fullChargeSoc: 100,
            currentSocPct: 80,
            now,
        });
        strict_1.default.equal(resolved.fullChargeSource, "soc_history");
        strict_1.default.equal(resolved.lastFullCharge, "2026-06-30T10:00:00.000Z");
    });
    (0, node_test_1.it)("computes topoff remaining and due", () => {
        const now = new Date("2026-01-25T12:00:00Z");
        const r = (0, math_1.computeTopoffStatus)({
            lastFullCharge: "2026-01-01T12:00:00.000Z",
            topoffIntervalDays: 20,
            now,
        });
        strict_1.default.equal(r.daysSinceFull, 24);
        strict_1.default.equal(r.topoffDaysRemaining, 0);
        strict_1.default.equal(r.topoffDue, true);
    });
    (0, node_test_1.it)("counts calendar days since full charge (yesterday = 1)", () => {
        const r = (0, math_1.computeTopoffStatus)({
            lastFullCharge: "2026-06-30T20:00:00.000Z",
            topoffIntervalDays: 20,
            now: new Date("2026-07-01T15:00:00.000Z"),
        });
        strict_1.default.equal(r.daysSinceFull, 1);
        strict_1.default.equal(r.topoffDaysRemaining, 19);
    });
    (0, node_test_1.it)("returns null topoff without full charge history", () => {
        const r = (0, math_1.computeTopoffStatus)({
            lastFullCharge: null,
            topoffIntervalDays: 20,
            now: new Date(),
        });
        strict_1.default.equal(r.daysSinceFull, null);
        strict_1.default.equal(r.topoffDue, null);
    });
});
(0, node_test_1.describe)("battery runtime compute", () => {
    (0, node_test_1.it)("estimates runtime days from night discharge", () => {
        strict_1.default.equal((0, math_1.estimateRuntimeDays)(80, 8), 10);
        strict_1.default.equal((0, math_1.estimateRuntimeDays)(80, null), null);
    });
    (0, node_test_1.it)("no_source without soc mapping", () => {
        const r = (0, math_1.noSourceResult)(cfg());
        strict_1.default.equal(r.status, "no_source");
        strict_1.default.equal(r.avgNightDischargePct, null);
    });
});
(0, node_test_1.describe)("battery runtime persist", () => {
    (0, node_test_1.it)("roundtrips persist file", async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), "br-"));
        const points = [socAt("2026-01-05", 22, 80), socAt("2026-01-06", 6, 70)];
        const result = (0, math_1.computeBatteryRuntimeLearning)({
            socPoints: points,
            powerPoints: [],
            secondsSinceFull: null,
            capacityKwh: 10,
            currentSocPct: 75,
            cfg: cfg(),
            sourceSocStateId: "sonnen.0.status.userSoc",
            sourcePowerStateId: "",
            now: new Date("2026-01-07T10:00:00"),
            sampleDays: 2,
        });
        await (0, persist_1.writeBatteryRuntimePersist)(dir, result, "2026-01-07T10:00:00.000Z");
        const read = await (0, persist_1.readBatteryRuntimePersist)(dir);
        strict_1.default.ok(read);
        strict_1.default.equal(read?.module, "battery_runtime_learning_v1");
    });
});
