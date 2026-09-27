"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const observations_1 = require("./observations");
const persist_1 = require("./persist");
const compute_1 = require("./compute");
const grid_rewards_1 = require("./grid_rewards");
(0, node_test_1.it)("retains negative energy prices and billed credits above the charging cost", () => {
    strict_1.default.deepEqual((0, compute_1.integrateImportCostEur)({ importPowerW: 1000, priceCtPerKwh: -10, dtSec: 3600 }), { costEur: -0.1, kwh: 1 });
    strict_1.default.equal((0, compute_1.tibberDayCostEur)({ accumulatedCostEur: -0.2, monthlyBaseEur: 0, monthlyGridFeeEur: 0, monthFraction: 1 / 30 }), -0.2);
    strict_1.default.equal((0, grid_rewards_1.netHomeGridCostEur)(1, 2.49), -1.49);
});
(0, node_test_1.it)("preserves the earliest measured daily SOC minimum and both meter directions", () => {
    const day = (0, persist_1.emptyDayRecord)("2026-09-27");
    (0, observations_1.observeDay)(day, new Date("2026-09-27T04:45:00Z"), 58, 100, 200);
    (0, observations_1.observeDay)(day, new Date("2026-09-27T06:52:00Z"), 62, 100.5, 201);
    (0, observations_1.observeDay)(day, new Date("2026-09-27T07:00:00Z"), 58, 100.5, 201);
    strict_1.default.deepEqual(day.batteryMinimum, { socPct: 58, atIso: "2026-09-27T04:45:00.000Z" });
    strict_1.default.equal(day.meter?.import?.firstKwh, 100);
    strict_1.default.equal(day.meter?.export?.lastKwh, 201);
    strict_1.default.deepEqual((0, compute_1.energyCounterDeltaKwh)(100, 99.98), { deltaKwh: 0, newBaseline: 100 });
});
(0, node_test_1.it)("compares calendar periods with signed differences and refuses incomplete prior data", () => {
    const data = (0, persist_1.emptyPersist)(new Date("2026-09-27T10:00:00Z"));
    for (const key of ["2026-09-26", "2026-09-27"])
        data.days[key] = (0, persist_1.emptyDayRecord)(key);
    data.days["2026-09-26"].home.gridImportKwh = 5;
    data.days["2026-09-27"].home.gridImportKwh = 3;
    const result = (0, observations_1.meterComparison)(data, "2026-09-27", "2026-09-27", "today");
    strict_1.default.equal(result.import.deltaKwh, -2);
    strict_1.default.equal(result.import.deltaPct, -40);
    strict_1.default.equal(result.export.deltaKwh, null);
    strict_1.default.equal(result.provisional, true);
    strict_1.default.match(result.noteDe, /nicht uhrzeitgleich/);
    strict_1.default.equal((0, observations_1.meterComparison)(data, "2024-03-31", "2024-03-31", "month_2024-03").previousTo, "2024-02-29");
});
