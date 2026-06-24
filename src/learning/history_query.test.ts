import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fetchHistoryRowsLookback, type HistoryQueryHost } from "./history_query";

describe("history_query", () => {
	it("merges per-day chunks", async () => {
		let calls = 0;
		const host: HistoryQueryHost = {
			getHistoryAsync: async (_id, options) => {
				calls++;
				const start = options?.start ?? 0;
				return { result: [{ ts: start + 1000, val: calls, ack: true, lc: 0, from: "test" }] };
			},
		};
		const rows = await fetchHistoryRowsLookback(host, "alias.0.test", 3);
		assert.equal(rows.length, 3);
		assert.equal(calls, 3);
	});

	it("returns empty for missing state id", async () => {
		const host: HistoryQueryHost = {
			getHistoryAsync: async () => ({
				result: [{ ts: 1, val: 1, ack: true, lc: 0, from: "test" }],
			}),
		};
		assert.deepEqual(await fetchHistoryRowsLookback(host, "", 7), []);
	});
});
