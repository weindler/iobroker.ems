"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const promises_1 = require("node:fs/promises");
const node_os_1 = require("node:os");
const node_path_1 = require("node:path");
const node_test_1 = require("node:test");
const ensure_states_js_1 = require("./ensure_states.js");
const tick_js_1 = require("./tick.js");
const persist_js_1 = require("./persist.js");
(0, node_test_1.it)("berechnet Hausvergleich für alle auswählbaren Zeiträume aus gepaarten Tibber-Messwerten", async () => {
    const dir = await (0, promises_1.mkdtemp)((0, node_path_1.join)((0, node_os_1.tmpdir)(), "ems-stat-periods-"));
    const states = new Map();
    const daily = [
        { from: "2026-08-31T00:00:00Z", consumption: 10, totalCost: 2 },
        { from: "2026-09-20T00:00:00Z", consumption: 20, totalCost: 4 },
        { from: "2026-09-25T00:00:00Z", consumption: 30, totalCost: 6 },
        { from: "2026-09-26T00:00:00Z", consumption: 40, totalCost: 8 },
    ];
    const foreign = new Map([
        ["tibber.0.Consumption.jsonDaily", JSON.stringify(daily)],
        ["tibber.0.Consumption.jsonMonthly", JSON.stringify([
                { from: "2026-08-01T00:00:00Z", consumption: 100, totalCost: 20 },
            ])],
    ]);
    const host = {
        config: {
            statistics_enabled: true,
            statistics_start_date: "2026-08-01",
            statistics_tibber_json_daily_state: "tibber.0.Consumption.jsonDaily",
            statistics_compare_tariff_ct_per_kwh: 30,
            statistics_compare_tariff_monthly_base_eur: 0,
            statistics_grid_rewards_enabled: false,
        },
        getAbsolutePath: (category = "") => (0, node_path_1.join)(dir, category),
        getStateAsync: async (id) => states.get(id) ?? null,
        getForeignStateAsync: async (id) => foreign.has(id) ? { val: foreign.get(id) } : null,
        setStateAsync: async (id, state) => { states.set(id, state); },
    };
    const expected = {
        today: 4,
        yesterday: 3,
        last_7_days: 9,
        this_month: 9,
        "month_2026-09": 9,
        "month_2026-08": 10,
        last_month: 10,
        this_quarter: 19,
        last_quarter: null,
        this_year: 19,
        last_year: null,
        year_2026: 19,
    };
    try {
        (0, tick_js_1.__resetStatisticsForTest)();
        const ledger = (0, persist_js_1.emptyPersist)(new Date("2026-09-26T12:00:00Z"));
        const olderChargingDay = (0, persist_js_1.emptyDayRecord)("2026-08-22");
        olderChargingDay.mobility.homeGridKwh = 12.34;
        ledger.days["2026-08-22"] = olderChargingDay;
        await (0, persist_js_1.writeStatisticsPersist)((0, node_path_1.join)(dir, "statistics"), ledger);
        for (const [period, savings] of Object.entries(expected)) {
            states.set(ensure_states_js_1.STATISTICS_STATES.periodId, { val: period });
            await (0, tick_js_1.tickStatistics)(host, new Date("2026-09-26T12:00:00Z"));
            const comparison = JSON.parse(String(states.get(ensure_states_js_1.STATISTICS_STATES.homePeriodJson)?.val));
            strict_1.default.equal(comparison.savingsVsFixedEur, savings, period);
            if (period === "this_year") {
                const mobility = JSON.parse(String(states.get(ensure_states_js_1.STATISTICS_STATES.mobilityPeriodJson)?.val));
                strict_1.default.equal(mobility.monthlyBreakdown.length, 2);
                strict_1.default.equal(mobility.chargeRuns, undefined);
                strict_1.default.deepEqual(mobility.monthlyBreakdown.map((row) => [row.month, row.homeSavingsEur]), [["2026-08", 10], ["2026-09", 9]]);
                strict_1.default.equal(mobility.monthlyBreakdown[0].chargedKwh, 12.34);
                strict_1.default.equal(mobility.monthlyBreakdown[0].evCostEur, null);
            }
            if (period === "month_2026-08") {
                const mobility = JSON.parse(String(states.get(ensure_states_js_1.STATISTICS_STATES.mobilityPeriodJson)?.val));
                strict_1.default.deepEqual(mobility.legacyDailyCharges, [{ dateKey: "2026-08-22", chargedKwh: 12.34 }]);
                strict_1.default.equal(mobility.homeChargedKwh, 12.34);
                strict_1.default.equal(mobility.evTotalCostEur, null);
            }
        }
    }
    finally {
        (0, tick_js_1.__resetStatisticsForTest)();
        await (0, promises_1.rm)(dir, { recursive: true, force: true });
    }
});
