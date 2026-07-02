"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const buffer_1 = require("./buffer");
const day_1 = require("./day");
const persist_1 = require("./persist");
(0, node_test_1.describe)("energy daily rollup", () => {
    (0, node_test_1.it)("keeps latest sample per calendar day", () => {
        const base = Date.parse("2026-07-02T10:00:00");
        let buf = (0, buffer_1.emptyDayBuffer)((0, day_1.localDateKey)(new Date(base)));
        buf = (0, buffer_1.ingestDailyKwhSample)(buf, base + 5_000, 5.2);
        buf = (0, buffer_1.ingestDailyKwhSample)(buf, base + 10_000, 5.8);
        buf = (0, buffer_1.ingestDailyKwhSample)(buf, base + 15_000, 5.5);
        const rec = (0, buffer_1.bufferToDayRecord)(buf);
        strict_1.default.ok(rec);
        strict_1.default.equal(rec.kwh, 5.5);
        strict_1.default.equal(rec.sampleCount, 3);
    });
    (0, node_test_1.it)("merges backfill and live by latest timestamp", () => {
        const merged = (0, persist_1.mergeDayRecord)({
            dateKey: "2026-07-01",
            kwh: 12.1,
            lastSampleTs: Date.parse("2026-07-01T20:00:00"),
            sampleCount: 1,
        }, {
            dateKey: "2026-07-01",
            kwh: 12.4,
            lastSampleTs: Date.parse("2026-07-01T22:00:00"),
            sampleCount: 5,
        });
        strict_1.default.equal(merged.kwh, 12.4);
        strict_1.default.equal(merged.sampleCount, 6);
    });
});
