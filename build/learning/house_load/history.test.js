"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const history_1 = require("./history");
function mockRowsPerDay(baseMs, days, hoursPerDay, powerW) {
    const rows = [];
    for (let d = 0; d < days; d++) {
        for (let h = 0; h < hoursPerDay; h++) {
            rows.push({
                ts: baseMs + d * 86_400_000 + h * 3_600_000 + 120_000,
                val: powerW + h * 10,
                ack: true,
                lc: 0,
                from: "test",
            });
        }
    }
    return rows;
}
(0, node_test_1.describe)("house_load history", () => {
    (0, node_test_1.it)("isValidHouseLoadW accepts plausible watts", () => {
        strict_1.default.equal((0, history_1.isValidHouseLoadW)(1500), true);
        strict_1.default.equal((0, history_1.isValidHouseLoadW)(0), true);
        strict_1.default.equal((0, history_1.isValidHouseLoadW)(-1), false);
        strict_1.default.equal((0, history_1.isValidHouseLoadW)(60_000), false);
    });
    (0, node_test_1.it)("normalizeHouseLoadPowerW scales kW to W", () => {
        strict_1.default.equal((0, history_1.normalizeHouseLoadPowerW)(3.5, "kW"), 3500);
        strict_1.default.equal((0, history_1.normalizeHouseLoadPowerW)(1500, "W"), 1500);
    });
    (0, node_test_1.it)("aggregates one sample per hour across multiple days", async () => {
        const base = Date.UTC(2026, 5, 20, 0, 0, 0);
        const host = {
            getHistoryAsync: async (_id, options) => {
                if (options?.aggregate === "average" && options.step === 3_600_000) {
                    return { result: mockRowsPerDay(base, 4, 24, 2000) };
                }
                return { result: [] };
            },
        };
        const { samples, stats } = await (0, history_1.fetchHouseLoadSamples)(host, "sonnen.0.status.consumption", 90);
        strict_1.default.equal(stats.historySource, "aggregate_hourly");
        strict_1.default.equal(stats.hourlySamples, 96);
        strict_1.default.ok((0, history_1.distinctSampleDays)(samples) >= 4);
    });
    (0, node_test_1.it)("uses latest row per hour bucket (descending history order)", async () => {
        const hour = Date.UTC(2026, 5, 24, 10, 0, 0);
        const host = {
            getHistoryAsync: async (_id, options) => {
                if (options?.aggregate === "average" && options.step === 3_600_000) {
                    return { result: [] };
                }
                return {
                    result: [
                        { ts: hour + 3_000_000, val: 4000, ack: true, lc: 0, from: "test" },
                        { ts: hour + 1_000_000, val: 2000, ack: true, lc: 0, from: "test" },
                        { ts: hour + 2_000_000, val: 3000, ack: true, lc: 0, from: "test" },
                    ],
                };
            },
        };
        const { samples, stats } = await (0, history_1.fetchHouseLoadSamples)(host, "sonnen.0.status.consumption", 7);
        strict_1.default.equal(stats.historySource, "onchange_raw");
        strict_1.default.equal(samples.length, 1);
        strict_1.default.equal(samples[0].powerW, 4000);
    });
    (0, node_test_1.it)("spreads second-based history timestamps across hours", async () => {
        const baseSec = 1_782_000_000;
        const host = {
            getHistoryAsync: async (_id, options) => {
                if (options?.aggregate === "average" && options.step === 3_600_000) {
                    return {
                        result: Array.from({ length: 96 }, (_, i) => ({
                            ts: (baseSec + i * 3600) * 1000,
                            val: 2500,
                            ack: true,
                            lc: 0,
                            from: "test",
                        })),
                    };
                }
                return {
                    result: Array.from({ length: 96 }, (_, i) => ({
                        ts: baseSec + i * 3600,
                        val: 2500,
                        ack: true,
                        lc: 0,
                        from: "test",
                    })),
                };
            },
        };
        const { samples, stats } = await (0, history_1.fetchHouseLoadSamples)(host, "sonnen.0.status.consumption", 7);
        strict_1.default.equal(stats.hourlySamples, 96);
        strict_1.default.ok((stats.tsSpanHours ?? 0) >= 95);
        strict_1.default.equal(samples.length, 96);
    });
});
