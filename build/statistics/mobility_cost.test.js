"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const mobility_cost_1 = require("./mobility_cost");
(0, node_test_1.it)("bewertet jede gemessene Ladung mit ihrem eigenen Tibber-Preis statt Monatsdurchschnitt", () => {
    const day = { dateKey: "2026-09-25", startMs: Date.parse("2026-09-24T22:00:00Z"),
        slotWidthMs: 900_000, slotCount: 2, buckets: {
            evChargedKwh: [4, 6], houseTotalKwh: [8, 6], pvKwh: [8, 0],
            gridExportKwh: [0, 0], priceCtPerKwh: [15, 40],
        } };
    const result = (0, mobility_cost_1.measuredMobilityCost)(day, 9.3);
    strict_1.default.equal(result?.chargedKwh, 10);
    strict_1.default.equal(result?.pvKwh, 4);
    strict_1.default.equal(result?.otherKwh, 6);
    strict_1.default.equal(result?.costEur, 2.77);
    strict_1.default.equal(result?.runs.length, 1);
    strict_1.default.equal(result?.runs[0]?.chargeDurationMin, 30);
    day.buckets.priceCtPerKwh[1] = null;
    const incomplete = (0, mobility_cost_1.measuredMobilityCost)(day, 9.3);
    strict_1.default.equal(incomplete?.chargedKwh, 10);
    strict_1.default.equal(incomplete?.costEur, null);
    strict_1.default.equal(incomplete?.runs[0]?.chargedKwh, 10);
    strict_1.default.equal(incomplete?.runs[0]?.costEur, null);
    day.buckets.houseTotalKwh[0] = null;
    const withoutHouse = (0, mobility_cost_1.measuredMobilityCost)(day, null);
    strict_1.default.equal(withoutHouse?.chargedKwh, 10);
    strict_1.default.equal(withoutHouse?.runs[0]?.directPvKwh, null);
    strict_1.default.equal(withoutHouse?.runs[0]?.costEur, null);
});
