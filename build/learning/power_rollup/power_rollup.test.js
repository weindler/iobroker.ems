"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const buffer_1 = require("./buffer");
const hour_1 = require("./hour");
const rollup_points_1 = require("./rollup_points");
(0, node_test_1.describe)("power rollup", () => {
    (0, node_test_1.it)("tracks max charge and discharge per hour (battery)", () => {
        const base = Date.parse("2026-06-30T14:05:00");
        let buf = (0, buffer_1.emptyHourBuffer)((0, hour_1.localHourKey)(base), "bidirectional_max");
        buf = (0, buffer_1.ingestBidirectionalSample)(buf, base + 60_000, -2500, true);
        buf = (0, buffer_1.ingestBidirectionalSample)(buf, base + 120_000, -1800, true);
        buf = (0, buffer_1.ingestBidirectionalSample)(buf, base + 300_000, -1200, true);
        buf = (0, buffer_1.ingestBidirectionalSample)(buf, base + 900_000, 80, true);
        const rec = (0, buffer_1.bufferToHourRecord)(buf);
        strict_1.default.ok(rec);
        strict_1.default.equal(rec.maxDischargeW, 80);
        strict_1.default.equal(rec.maxChargeW, 2500);
        strict_1.default.equal(rec.chargeSamples, 3);
        strict_1.default.equal(rec.dischargeSamples, 1);
    });
    (0, node_test_1.it)("tracks hourly average for consumption", () => {
        const base = Date.parse("2026-06-30T10:00:00");
        let buf = (0, buffer_1.emptyHourBuffer)((0, hour_1.localHourKey)(base), "unidirectional_avg");
        buf = (0, buffer_1.ingestUnidirectionalAvgSample)(buf, base + 60_000, 1000, "W");
        buf = (0, buffer_1.ingestUnidirectionalAvgSample)(buf, base + 120_000, 2000, "W");
        const rec = (0, buffer_1.bufferToHourRecord)(buf);
        strict_1.default.ok(rec);
        strict_1.default.equal(rec.avgPowerW, 1500);
        strict_1.default.equal(rec.sampleCount, 2);
    });
    (0, node_test_1.it)("exports battery hourly peaks as power points", () => {
        const hourKey = "2026-06-30T14";
        const source = {
            sourceKey: "battery.power_w",
            stateId: "alias.0.Sonnen.Status.pacTotal",
            rollupMode: "bidirectional_max",
            powerInvert: true,
            powerUnit: "W",
            backfillDone: true,
            hours: {
                [hourKey]: {
                    hourKey,
                    sampleCount: 4,
                    chargeSamples: 1,
                    dischargeSamples: 3,
                    maxChargeW: 1800,
                    maxDischargeW: 2500,
                    lastSampleTs: Date.parse("2026-06-30T14:55:00"),
                },
            },
        };
        const { points, meta } = (0, rollup_points_1.rollupSourceToPowerPoints)(source, 90, Date.parse("2026-07-01T00:00:00"));
        strict_1.default.equal(points.length, 2);
        strict_1.default.equal(points[0].powerW, 1800);
        strict_1.default.equal(points[1].powerW, -2500);
        strict_1.default.equal(meta.powerHistoryMode, "ems_rollup");
    });
    (0, node_test_1.it)("exports consumption rollup as house load samples", () => {
        const hourKey = "2026-06-30T14";
        const source = {
            sourceKey: "battery.consumption_w",
            stateId: "alias.0.Sonnen.Status.consumption",
            rollupMode: "unidirectional_avg",
            powerInvert: false,
            powerUnit: "W",
            backfillDone: true,
            hours: {
                [hourKey]: {
                    hourKey,
                    sampleCount: 12,
                    lastSampleTs: Date.parse("2026-06-30T14:55:00"),
                    chargeSamples: 0,
                    dischargeSamples: 0,
                    maxChargeW: null,
                    maxDischargeW: null,
                    sumPowerW: 18000,
                    avgPowerW: 1500,
                },
            },
        };
        const { samples, stats } = (0, rollup_points_1.rollupSourceToHouseLoadSamples)(source, 90, Date.parse("2026-07-01T00:00:00"));
        strict_1.default.equal(samples.length, 1);
        strict_1.default.equal(samples[0].powerW, 1500);
        strict_1.default.equal(stats.historySource, "ems_rollup");
    });
});
