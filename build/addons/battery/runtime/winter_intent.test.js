"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const winter_intent_js_1 = require("./winter_intent.js");
(0, node_test_1.describe)("winter battery intent", () => {
    (0, node_test_1.it)("builds grid_charge intent inside active window", () => {
        const start = "2026-01-15T20:00:00.000Z";
        const end = "2026-01-15T21:00:00.000Z";
        const intent = (0, winter_intent_js_1.deviceIntentFromWinterPlanner)({
            active: true,
            socTargetPct: 85,
            maxChargeW: 4200,
            windows: [{ start_iso: start, end_iso: end, slots_15m: 4, strategy: "contiguous" }],
            reasonDe: "Test",
            revision: 3,
        }, Date.parse("2026-01-15T20:15:00.000Z"));
        strict_1.default.ok(intent);
        strict_1.default.equal(intent?.action, "grid_charge");
        strict_1.default.equal(intent?.energySource, "grid");
        strict_1.default.equal(intent?.maxChargeW, 4200);
        strict_1.default.equal(intent?.requestId, "winter-planner-3");
    });
    (0, node_test_1.it)("returns null outside window", () => {
        const intent = (0, winter_intent_js_1.deviceIntentFromWinterPlanner)({
            active: true,
            socTargetPct: 85,
            maxChargeW: 4200,
            windows: [
                {
                    start_iso: "2026-01-15T20:00:00.000Z",
                    end_iso: "2026-01-15T21:00:00.000Z",
                    slots_15m: 4,
                    strategy: "contiguous",
                },
            ],
            reasonDe: "Test",
            revision: 1,
        }, Date.parse("2026-01-15T22:00:00.000Z"));
        strict_1.default.equal(intent, null);
    });
    (0, node_test_1.it)("parses windows json", () => {
        const rows = (0, winter_intent_js_1.parseWinterWindowsJson)(JSON.stringify([
            { start_iso: "a", end_iso: "b", slots_15m: 2, strategy: "split" },
        ]));
        strict_1.default.equal(rows.length, 1);
        strict_1.default.equal(rows[0].strategy, "split");
    });
});
