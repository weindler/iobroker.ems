"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const history_query_1 = require("./history_query");
(0, node_test_1.describe)("history_query", () => {
    (0, node_test_1.it)("merges per-day chunks", async () => {
        let calls = 0;
        const host = {
            getHistoryAsync: async (_id, options) => {
                calls++;
                const start = options?.start ?? 0;
                return { result: [{ ts: start + 1000, val: calls, ack: true, lc: 0, from: "test" }] };
            },
        };
        const rows = await (0, history_query_1.fetchHistoryRowsLookback)(host, "alias.0.test", 3);
        strict_1.default.equal(rows.length, 3);
        strict_1.default.equal(calls, 3);
    });
    (0, node_test_1.it)("returns empty for missing state id", async () => {
        const host = {
            getHistoryAsync: async () => ({
                result: [{ ts: 1, val: 1, ack: true, lc: 0, from: "test" }],
            }),
        };
        strict_1.default.deepEqual(await (0, history_query_1.fetchHistoryRowsLookback)(host, "", 7), []);
    });
});
