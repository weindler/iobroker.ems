"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const read_1 = require("./read");
(0, node_test_1.describe)("readPvShapeHourlyPoints", () => {
    (0, node_test_1.it)("verschiebt Bright-Sky-Zeitstempel auf den Intervallbeginn (Stunde davor)", async () => {
        const values = {
            "brightsky.0.hourly.00.timestamp": "2026-11-14T13:00:00+00:00",
            "brightsky.0.hourly.00.cloud_cover": 56,
            "brightsky.0.hourly.00.solar_estimate": 2.135,
        };
        const host = {
            getForeignStateAsync: async (id) => (id in values ? { val: values[id] } : null),
        };
        const points = await (0, read_1.readPvShapeHourlyPoints)(host, "brightsky.0.hourly");
        strict_1.default.equal(points.length, 1);
        strict_1.default.equal(points[0].hourStartIso, "2026-11-14T12:00:00.000Z");
        strict_1.default.equal(points[0].solarEstimateKwh, 2.135);
        strict_1.default.equal(points[0].cloudPct, 56);
    });
});
