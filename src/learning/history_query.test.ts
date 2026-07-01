import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	fetchHistoryRowsLookback,
	historyStateCandidates,
	normalizeHistoryTs,
	resetHistoryQueryQueueForTests,
	type HistoryQueryHost,
} from "./history_query";

describe("history_query", () => {
	it("loads lookback via bulk window first", async () => {
		resetHistoryQueryQueueForTests();
		let calls = 0;
		const host: HistoryQueryHost = {
			getHistoryAsync: async (_id, options) => {
				calls++;
				const start = options?.start ?? 0;
				return { result: [{ ts: start + 1000, val: calls, ack: true, lc: 0, from: "test" }] };
			},
		};
		const rows = await fetchHistoryRowsLookback(host, "alias.0.test", 3);
		assert.equal(rows.length, 1);
		assert.ok(calls <= 2, "bulk tries none then onchange at most");
	});

	it("falls back to per-day chunks when bulk is empty", async () => {
		resetHistoryQueryQueueForTests();
		let calls = 0;
		const host: HistoryQueryHost = {
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
		const rows = await fetchHistoryRowsLookback(host, "alias.0.test", 3);
		assert.equal(rows.length, 3);
		assert.ok(calls > 2);
	});

	it("returns empty for missing state id", async () => {
		const host: HistoryQueryHost = {
			getHistoryAsync: async () => ({
				result: [{ ts: 1, val: 1, ack: true, lc: 0, from: "test" }],
			}),
		};
		assert.deepEqual(await fetchHistoryRowsLookback(host, "", 7), []);
	});

	it("prefers native alias target when alias history is disabled", async () => {
		const host: HistoryQueryHost = {
			getObjectAsync: async (id) => {
				if (id === "alias.0.soc") {
					return {
						common: {
							alias: { id: "sonnen.0.status.userSoc" },
							history: { enabled: false },
						},
					} as ioBroker.Object;
				}
				return null;
			},
			getHistoryAsync: async (id) => ({
				result:
					id === "sonnen.0.status.userSoc"
						? [{ ts: 1_700_000_000_000, val: 80, ack: true, lc: 0, from: "test" }]
						: [],
			}),
		};
		const rows = await fetchHistoryRowsLookback(host, "alias.0.soc", 1);
		assert.equal(rows.length, 1);
		assert.equal(rows[0].val, 80);
	});

	it("historyStateCandidates lists alias then native when alias history enabled", async () => {
		const host: HistoryQueryHost = {
			getHistoryAsync: async () => ({ result: [] }),
			getObjectAsync: async () =>
				({
					common: {
						alias: { id: "sonnen.0.status.userSoc" },
						history: { enabled: true },
					},
				}) as ioBroker.Object,
		};
		const ids = await historyStateCandidates(host, "alias.0.soc");
		assert.deepEqual(ids, ["alias.0.soc", "sonnen.0.status.userSoc"]);
	});

	it("unwraps sendToAsync Message wrapper for history rows", async () => {
		const host: HistoryQueryHost = {
			sendToAsync: async () =>
				({
					_id: 1,
					command: "getHistory",
					message: {
						result: [{ ts: 1_700_000_000_000, val: 0.28, ack: true, lc: 0, from: "test" }],
					},
					from: "history.0",
				}) as ioBroker.Message,
			getHistoryAsync: async () => {
				throw new Error("getHistoryAsync must not be called when sendToAsync is set");
			},
		};
		const rows = await fetchHistoryRowsLookback(host, "tibberlink.0.price", 7);
		assert.equal(rows.length, 1);
		assert.equal(rows[0].val, 0.28);
	});

	it("does not fall through to getHistoryAsync when sendTo returns empty", async () => {
		let asyncCalls = 0;
		const host: HistoryQueryHost = {
			sendToAsync: async () =>
				({
					_id: 1,
					command: "getHistory",
					message: { result: [] },
					from: "history.0",
				}) as ioBroker.Message,
			getHistoryAsync: async () => {
				asyncCalls++;
				return { result: [{ ts: 1, val: 1, ack: true, lc: 0, from: "test" }] };
			},
		};
		const rows = await fetchHistoryRowsLookback(host, "alias.0.test", 1);
		assert.equal(rows.length, 0);
		assert.equal(asyncCalls, 0);
	});

	it("normalizes Unix-second timestamps to milliseconds", () => {
		assert.equal(normalizeHistoryTs(1_782_000_000), 1_782_000_000_000);
		assert.equal(normalizeHistoryTs(1_782_000_000_000), 1_782_000_000_000);
	});

	it("bulk lookback uses returnNewestEntries true", async () => {
		resetHistoryQueryQueueForTests();
		let bulkOptions: ioBroker.GetHistoryOptions | undefined;
		const MS_DAY = 86_400_000;
		const host: HistoryQueryHost = {
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
		await fetchHistoryRowsLookback(host, "alias.0.test", 7);
		assert.equal(bulkOptions?.returnNewestEntries, true);
	});

	it("uses per-day mode for lookback > 7d instead of capped bulk slice", async () => {
		resetHistoryQueryQueueForTests();
		let bulkCalls = 0;
		let dayCalls = 0;
		const MS_DAY = 86_400_000;
		const host: HistoryQueryHost = {
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
		const rows = await fetchHistoryRowsLookback(host, "alias.0.pacTotal", 90);
		assert.equal(bulkCalls, 0, "must not use multi-day bulk for 90d lookback");
		assert.ok(dayCalls >= 90);
		assert.ok(rows.some((r) => typeof r.val === "number" && r.val < 0));
	});
});
