"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const daily_persist_1 = require("./daily_persist");
const snapshot_1 = require("./snapshot");
(0, node_test_1.describe)("pv_bias snapshot", () => {
    (0, node_test_1.it)("captures after snapshot time when not yet stored today", () => {
        const now = new Date(2026, 5, 30, 23, 59, 0);
        strict_1.default.equal((0, snapshot_1.shouldCaptureActualSnapshot)(now, "23:58", false), true);
    });
    (0, node_test_1.it)("skips capture before snapshot time", () => {
        const now = new Date(2026, 5, 30, 22, 0, 0);
        strict_1.default.equal((0, snapshot_1.shouldCaptureActualSnapshot)(now, "23:58", false), false);
    });
    (0, node_test_1.it)("skips when today already captured", () => {
        const now = new Date(2026, 5, 30, 23, 59, 0);
        strict_1.default.equal((0, snapshot_1.shouldCaptureActualSnapshot)(now, "23:58", true), false);
    });
    (0, node_test_1.it)("detects captured date in persist", () => {
        let persist = (0, daily_persist_1.emptyDailyPersist)();
        persist = (0, daily_persist_1.upsertDailyRecord)(persist, {
            date: "2026-06-30",
            actualKwh: 31.9,
            actualCapturedAt: "2026-06-30T21:58:00.000Z",
            forecastKwh: 13.2,
            forecastCapturedAt: "2026-06-30T04:00:00.000Z",
        });
        strict_1.default.equal((0, snapshot_1.actualSnapshotCapturedForDate)(persist, "2026-06-30"), true);
        strict_1.default.equal((0, snapshot_1.actualSnapshotCapturedForDate)(persist, "2026-07-01"), false);
    });
});
