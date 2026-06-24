import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { pickActualCtForHour } from "./compare";

function histRow(ts: number, val: number): ioBroker.GetHistoryResult[number] {
	return { ts, val, ack: true, lc: 0, from: "test" };
}

describe("price forecast compare", () => {
	it("pickActualCtForHour chooses closest row in hour window", () => {
		const hourStart = new Date("2026-06-24T14:00:00").getTime();
		const rows: ioBroker.GetHistoryResult = [
			histRow(hourStart + 5 * 60_000, 0.2),
			histRow(hourStart + 45 * 60_000, 0.3),
		];
		const actual = pickActualCtForHour(rows, "eur_per_kwh", hourStart);
		assert.equal(actual, 20);
	});

	it("pickActualCtForHour ignores rows outside hour window", () => {
		const hourStart = new Date("2026-06-24T14:00:00").getTime();
		const rows: ioBroker.GetHistoryResult = [histRow(hourStart + 3_600_000, 0.25)];
		assert.equal(pickActualCtForHour(rows, "eur_per_kwh", hourStart), null);
	});
});
