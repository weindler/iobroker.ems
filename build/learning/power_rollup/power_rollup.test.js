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
    (0, node_test_1.it)("tracks max charge and discharge per hour", () => {
        const base = Date.parse("2026-06-30T14:05:00");
        let buf = (0, buffer_1.emptyHourBuffer)((0, hour_1.localHourKey)(base));
        buf = (0, buffer_1.ingestPowerSample)(buf, base + 60_000, -2500, true);
        buf = (0, buffer_1.ingestPowerSample)(buf, base + 120_000, -1800, true);
        buf = (0, buffer_1.ingestPowerSample)(buf, base + 300_000, -1200, true);
        buf = (0, buffer_1.ingestPowerSample)(buf, base + 900_000, 80, true);
        const rec = (0, buffer_1.bufferToHourRecord)(buf);
        strict_1.default.ok(rec);
        strict_1.default.equal(rec.maxDischargeW, 80);
        strict_1.default.equal(rec.maxChargeW, 2500);
        strict_1.default.equal(rec.chargeSamples, 3);
        strict_1.default.equal(rec.dischargeSamples, 1);
    });
    (0, node_test_1.it)("exports hourly peaks as power points", () => {
        const hourKey = "2026-06-30T14";
        const source = {
            sourceKey: "battery.power_w",
            stateId: "alias.0.Sonnen.Status.pacTotal",
            powerInvert: true,
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
        strict_1.default.equal(meta.hourlyChargePoints, 1);
        strict_1.default.equal(meta.hourlyDischargePoints, 1);
        strict_1.default.equal(meta.powerHistoryMode, "ems_rollup");
    });
});
