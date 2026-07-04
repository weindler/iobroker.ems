"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const buffer_1 = require("./buffer");
const config_1 = require("./config");
const day_1 = require("../energy_daily_rollup/day");
(0, node_test_1.describe)("consumer stats", () => {
    (0, node_test_1.it)("accumulates runtime and energy while active", () => {
        const base = Date.parse("2026-07-04T10:00:00");
        let entry = (0, buffer_1.emptyConsumerEntry)("immersion_heater", base);
        const config = (0, config_1.immersionConsumerStatsFromConfig)({});
        entry = (0, buffer_1.ingestConsumerStatsTick)(entry, {
            consumerKey: "immersion_heater",
            nowMs: base,
            active: true,
            measuredPowerW: 1700,
            commandedPowerW: 1700,
        }, config);
        entry = (0, buffer_1.ingestConsumerStatsTick)(entry, {
            consumerKey: "immersion_heater",
            nowMs: base + 5000,
            active: true,
            measuredPowerW: 1700,
            commandedPowerW: 1700,
        }, config);
        strict_1.default.equal(entry.totalRuntimeSec, 5);
        strict_1.default.equal(entry.todayRuntimeSec, 5);
        strict_1.default.equal(entry.totalEnergyKwh, 0.002);
    });
    (0, node_test_1.it)("finalizes session when device turns off", () => {
        const base = Date.parse("2026-07-04T10:00:00");
        let entry = (0, buffer_1.emptyConsumerEntry)("immersion_heater", base);
        const config = (0, config_1.immersionConsumerStatsFromConfig)({});
        entry = (0, buffer_1.ingestConsumerStatsTick)(entry, { consumerKey: "immersion_heater", nowMs: base, active: true, measuredPowerW: 1000, commandedPowerW: 1000 }, config);
        entry = (0, buffer_1.ingestConsumerStatsTick)(entry, {
            consumerKey: "immersion_heater",
            nowMs: base + 10_000,
            active: false,
            measuredPowerW: 0,
            commandedPowerW: 0,
        }, config);
        strict_1.default.equal(entry.lastSessionRuntimeSec, 10);
        strict_1.default.equal(entry.sessionRuntimeSec, 0);
        strict_1.default.equal(entry.wasActive, false);
    });
    (0, node_test_1.it)("applies admin offsets in snapshot totals", () => {
        const base = Date.parse("2026-07-04T10:00:00");
        const entry = (0, buffer_1.emptyConsumerEntry)("immersion_heater", base);
        entry.totalRuntimeSec = 3600;
        entry.totalEnergyKwh = 1.5;
        const config = (0, config_1.immersionConsumerStatsFromConfig)({
            ih_stats_runtime_offset_h: 2,
            ih_stats_energy_offset_kwh: 10,
        });
        const snap = (0, buffer_1.snapshotFromEntry)(entry, config, base);
        strict_1.default.equal(snap.totalRuntimeSec, 3600 + 7200);
        strict_1.default.equal(snap.totalEnergyKwh, 11.5);
    });
    (0, node_test_1.it)("resets today counters on day rollover", () => {
        const day1 = Date.parse("2026-07-04T23:59:58");
        const day2 = Date.parse("2026-07-05T00:00:03");
        let entry = (0, buffer_1.emptyConsumerEntry)("immersion_heater", day1);
        const config = (0, config_1.immersionConsumerStatsFromConfig)({});
        entry.totalRuntimeSec = 100;
        entry.todayRuntimeSec = 100;
        entry.todayDateKey = (0, day_1.localDateKey)(new Date(day1));
        entry.wasActive = true;
        entry.lastTickMs = day1;
        entry = (0, buffer_1.ingestConsumerStatsTick)(entry, { consumerKey: "immersion_heater", nowMs: day2, active: true, measuredPowerW: 1000, commandedPowerW: 1000 }, config);
        strict_1.default.equal(entry.todayDateKey, (0, day_1.localDateKey)(new Date(day2)));
        strict_1.default.equal(entry.todayRuntimeSec, 5);
        strict_1.default.equal(entry.totalRuntimeSec, 105);
        strict_1.default.ok(entry.days["2026-07-04"]);
    });
    (0, node_test_1.it)("prefers measured power over commanded power", () => {
        const power = (0, buffer_1.resolveActivePowerW)({
            measuredPowerW: 1744,
            commandedPowerW: 1700,
            powerOnThresholdW: 50,
        });
        strict_1.default.equal(power, 1744);
    });
    (0, node_test_1.it)("caps tick delta to avoid restart spikes", () => {
        strict_1.default.equal((0, buffer_1.computeTickDeltaSec)(100_000, 0), 0);
        strict_1.default.equal((0, buffer_1.computeTickDeltaSec)(100_000, 50_000), 30);
    });
});
