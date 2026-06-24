"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const compare_1 = require("./compare");
function histRow(ts, val) {
    return { ts, val, ack: true, lc: 0, from: "test" };
}
(0, node_test_1.describe)("price forecast compare", () => {
    (0, node_test_1.it)("pickActualCtForHour chooses closest row in hour window", () => {
        const hourStart = new Date("2026-06-24T14:00:00").getTime();
        const rows = [
            histRow(hourStart + 5 * 60_000, 0.2),
            histRow(hourStart + 45 * 60_000, 0.3),
        ];
        const actual = (0, compare_1.pickActualCtForHour)(rows, "eur_per_kwh", hourStart);
        strict_1.default.equal(actual, 20);
    });
    (0, node_test_1.it)("pickActualCtForHour ignores rows outside hour window", () => {
        const hourStart = new Date("2026-06-24T14:00:00").getTime();
        const rows = [histRow(hourStart + 3_600_000, 0.25)];
        strict_1.default.equal((0, compare_1.pickActualCtForHour)(rows, "eur_per_kwh", hourStart), null);
    });
});
