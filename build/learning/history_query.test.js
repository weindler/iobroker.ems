"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const history_query_1 = require("./history_query");
(0, node_test_1.describe)("history_query", () => {
    (0, node_test_1.it)("loads lookback via bulk window first", async () => {
        (0, history_query_1.resetHistoryQueryQueueForTests)();
        let calls = 0;
        const host = {
            getHistoryAsync: async (_id, options) => {
                calls++;
                const start = options?.start ?? 0;
                return { result: [{ ts: start + 1000, val: calls, ack: true, lc: 0, from: "test" }] };
            },
        };
        const rows = await (0, history_query_1.fetchHistoryRowsLookback)(host, "alias.0.test", 3);
        strict_1.default.equal(rows.length, 1);
        strict_1.default.ok(calls <= 2, "bulk tries none then onchange at most");
    });
    (0, node_test_1.it)("falls back to per-day chunks when bulk is empty", async () => {
        (0, history_query_1.resetHistoryQueryQueueForTests)();
        let calls = 0;
        const host = {
            getHistoryAsync: async (_id, options) => {
                calls++;
                const start = options?.start ?? 0;
                const end = options?.end ?? 0;
                if (end - start > 86_400_000) {
                    return { result: [] };
                }
                return { result: [{ ts: start + 1000, val: calls, ack: true, lc: 0, from: "test" }] };
            },
        };
        const rows = await (0, history_query_1.fetchHistoryRowsLookback)(host, "alias.0.test", 3);
        strict_1.default.equal(rows.length, 3);
        strict_1.default.ok(calls > 2);
    });
    (0, node_test_1.it)("returns empty for missing state id", async () => {
        const host = {
            getHistoryAsync: async () => ({
                result: [{ ts: 1, val: 1, ack: true, lc: 0, from: "test" }],
            }),
        };
        strict_1.default.deepEqual(await (0, history_query_1.fetchHistoryRowsLookback)(host, "", 7), []);
    });
    (0, node_test_1.it)("prefers native alias target when alias history is disabled", async () => {
        const host = {
            getObjectAsync: async (id) => {
                if (id === "alias.0.soc") {
                    return {
                        common: {
                            alias: { id: "sonnen.0.status.userSoc" },
                            history: { enabled: false },
                        },
                    };
                }
                return null;
            },
            getHistoryAsync: async (id) => ({
                result: id === "sonnen.0.status.userSoc"
                    ? [{ ts: 1_700_000_000_000, val: 80, ack: true, lc: 0, from: "test" }]
                    : [],
            }),
        };
        const rows = await (0, history_query_1.fetchHistoryRowsLookback)(host, "alias.0.soc", 1);
        strict_1.default.equal(rows.length, 1);
        strict_1.default.equal(rows[0].val, 80);
    });
    (0, node_test_1.it)("historyStateCandidates lists alias then native when alias history enabled", async () => {
        const host = {
            getHistoryAsync: async () => ({ result: [] }),
            getObjectAsync: async () => ({
                common: {
                    alias: { id: "sonnen.0.status.userSoc" },
                    history: { enabled: true },
                },
            }),
        };
        const ids = await (0, history_query_1.historyStateCandidates)(host, "alias.0.soc");
        strict_1.default.deepEqual(ids, ["alias.0.soc", "sonnen.0.status.userSoc"]);
    });
    (0, node_test_1.it)("unwraps sendToAsync Message wrapper for history rows", async () => {
        const host = {
            sendToAsync: async () => ({
                _id: 1,
                command: "getHistory",
                message: {
                    result: [{ ts: 1_700_000_000_000, val: 0.28, ack: true, lc: 0, from: "test" }],
                },
                from: "history.0",
            }),
            getHistoryAsync: async () => {
                throw new Error("getHistoryAsync must not be called when sendToAsync is set");
            },
        };
        const rows = await (0, history_query_1.fetchHistoryRowsLookback)(host, "tibberlink.0.price", 7);
        strict_1.default.equal(rows.length, 1);
        strict_1.default.equal(rows[0].val, 0.28);
    });
    (0, node_test_1.it)("does not fall through to getHistoryAsync when sendTo returns empty", async () => {
        let asyncCalls = 0;
        const host = {
            sendToAsync: async () => ({
                _id: 1,
                command: "getHistory",
                message: { result: [] },
                from: "history.0",
            }),
            getHistoryAsync: async () => {
                asyncCalls++;
                return { result: [{ ts: 1, val: 1, ack: true, lc: 0, from: "test" }] };
            },
        };
        const rows = await (0, history_query_1.fetchHistoryRowsLookback)(host, "alias.0.test", 1);
        strict_1.default.equal(rows.length, 0);
        strict_1.default.equal(asyncCalls, 0);
    });
    (0, node_test_1.it)("normalizes Unix-second timestamps to milliseconds", () => {
        strict_1.default.equal((0, history_query_1.normalizeHistoryTs)(1_782_000_000), 1_782_000_000_000);
        strict_1.default.equal((0, history_query_1.normalizeHistoryTs)(1_782_000_000_000), 1_782_000_000_000);
    });
    (0, node_test_1.it)("bulk lookback uses returnNewestEntries true", async () => {
        (0, history_query_1.resetHistoryQueryQueueForTests)();
        let bulkOptions;
        const MS_DAY = 86_400_000;
        const host = {
            getHistoryAsync: async (_id, options) => {
                const start = options?.start ?? 0;
                const end = options?.end ?? 0;
                if (end - start > MS_DAY) {
                    bulkOptions = options;
                    return { result: [{ ts: end - 1000, val: -100, ack: true, lc: 0, from: "test" }] };
                }
                return { result: [] };
            },
        };
        await (0, history_query_1.fetchHistoryRowsLookback)(host, "alias.0.test", 7);
        strict_1.default.equal(bulkOptions?.returnNewestEntries, true);
    });
    (0, node_test_1.it)("uses per-day mode for lookback > 7d instead of capped bulk slice", async () => {
        (0, history_query_1.resetHistoryQueryQueueForTests)();
        let bulkCalls = 0;
        let dayCalls = 0;
        const MS_DAY = 86_400_000;
        const host = {
            getHistoryAsync: async (_id, options) => {
                const start = options?.start ?? 0;
                const end = options?.end ?? 0;
                const span = end - start;
                if (span > MS_DAY * 2) {
                    bulkCalls++;
                    return {
                        result: [{ ts: start + 1000, val: 250, ack: true, lc: 0, from: "test" }],
                    };
                }
                dayCalls++;
                return { result: [{ ts: start + 1000, val: -500, ack: true, lc: 0, from: "test" }] };
            },
        };
        const rows = await (0, history_query_1.fetchHistoryRowsLookback)(host, "alias.0.pacTotal", 90);
        strict_1.default.equal(bulkCalls, 0, "must not use multi-day bulk for 90d lookback");
        strict_1.default.ok(dayCalls >= 90);
        strict_1.default.ok(rows.some((r) => typeof r.val === "number" && r.val < 0));
    });
});
