"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const buffer_1 = require("./buffer");
const config_1 = require("./config");
const index_1 = require("./index");
const day_1 = require("../energy_daily_rollup/day");
function tick(entry, nowMs, opts, config = (0, config_1.immersionConsumerStatsFromConfig)({})) {
    return (0, buffer_1.ingestConsumerStatsTick)(entry, {
        consumerKey: "immersion_heater",
        nowMs,
        deviceActive: opts.deviceActive,
        countable: opts.countable,
        measuredPowerW: opts.power ?? 1700,
        commandedPowerW: opts.power ?? 1700,
    }, config);
}
(0, node_test_1.describe)("consumer stats", () => {
    (0, node_test_1.it)("accumulates runtime and energy while active in live mode", () => {
        const base = Date.parse("2026-07-04T10:00:00");
        let entry = (0, buffer_1.emptyConsumerEntry)("immersion_heater", base);
        entry = tick(entry, base, { deviceActive: true, countable: true });
        entry = tick(entry, base + 5000, { deviceActive: true, countable: true });
        strict_1.default.equal(entry.totalRuntimeSec, 5);
        strict_1.default.equal(entry.todayRuntimeSec, 5);
        strict_1.default.equal(entry.totalEnergyKwh, 0.002);
    });
    (0, node_test_1.it)("does not accumulate during dryrun even when device would run", () => {
        const base = Date.parse("2026-07-04T10:00:00");
        let entry = (0, buffer_1.emptyConsumerEntry)("immersion_heater", base);
        entry = tick(entry, base, { deviceActive: true, countable: false });
        entry = tick(entry, base + 5000, { deviceActive: true, countable: false });
        strict_1.default.equal(entry.totalRuntimeSec, 0);
        strict_1.default.equal(entry.totalEnergyKwh, 0);
        const snap = (0, buffer_1.snapshotFromEntry)(entry, (0, config_1.immersionConsumerStatsFromConfig)({}), base + 5000, true);
        strict_1.default.equal(snap.deviceActive, true);
    });
    (0, node_test_1.it)("finalizes session when device turns off", () => {
        const base = Date.parse("2026-07-04T10:00:00");
        let entry = (0, buffer_1.emptyConsumerEntry)("immersion_heater", base);
        entry = tick(entry, base, { deviceActive: true, countable: true, power: 1000 });
        entry = tick(entry, base + 10_000, { deviceActive: false, countable: false, power: 0 });
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
        entry.totalRuntimeSec = 100;
        entry.todayRuntimeSec = 100;
        entry.todayDateKey = (0, day_1.localDateKey)(new Date(day1));
        entry.wasActive = true;
        entry.lastTickMs = day1;
        entry = tick(entry, day2, { deviceActive: true, countable: true, power: 1000 });
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
    (0, node_test_1.it)("accumulates AC session runtime while countable stays true without feedback", () => {
        const base = Date.parse("2026-07-05T07:00:00");
        const config = (0, config_1.acUnitStatsFromConfig)({ ac_u2_enabled: true, ac_u2_stats_enabled: true }, 2);
        let entry = (0, buffer_1.emptyConsumerEntry)("air_conditioning.unit_2", base);
        entry = (0, buffer_1.ingestConsumerStatsTick)(entry, {
            consumerKey: "air_conditioning.unit_2",
            nowMs: base,
            deviceActive: true,
            countable: true,
            measuredPowerW: null,
            commandedPowerW: 650,
        }, config);
        entry = (0, buffer_1.ingestConsumerStatsTick)(entry, {
            consumerKey: "air_conditioning.unit_2",
            nowMs: base + 10_000,
            deviceActive: true,
            countable: true,
            measuredPowerW: null,
            commandedPowerW: 650,
        }, config);
        strict_1.default.equal(entry.sessionRuntimeSec, 10);
        strict_1.default.equal(entry.todayRuntimeSec, 10);
    });
    (0, node_test_1.it)("accumulates session runtime across consumer stats ticks without disk path", async () => {
        (0, index_1.resetConsumerStatsCache)();
        const host = {
            config: { ac_u2_enabled: true, ac_u2_stats_enabled: true },
            getStateAsync: async () => null,
            setStateAsync: async () => undefined,
            setObjectNotExistsAsync: async () => undefined,
        };
        const base = Date.parse("2026-07-05T07:00:00");
        await (0, index_1.tickConsumerStats)(host, {
            consumerKey: "air_conditioning.unit_2",
            nowMs: base,
            deviceActive: true,
            countable: true,
            measuredPowerW: null,
            commandedPowerW: 650,
        });
        const snap = await (0, index_1.tickConsumerStats)(host, {
            consumerKey: "air_conditioning.unit_2",
            nowMs: base + 10_000,
            deviceActive: true,
            countable: true,
            measuredPowerW: null,
            commandedPowerW: 650,
        });
        strict_1.default.equal(snap?.sessionRuntimeSec, 10);
    });
    (0, node_test_1.it)("caps tick delta to avoid restart spikes", () => {
        strict_1.default.equal((0, buffer_1.computeTickDeltaSec)(100_000, 0), 0);
        strict_1.default.equal((0, buffer_1.computeTickDeltaSec)(100_000, 50_000), 30);
    });
});
