import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	distinctSampleDays,
	fetchHouseLoadSamples,
	isValidHouseLoadW,
	normalizeHouseLoadPowerW,
} from "./history";
import type { HistoryQueryHost } from "../history_query";

function mockRowsPerDay(
	baseMs: number,
	days: number,
	hoursPerDay: number,
	powerW: number,
): ioBroker.GetHistoryResult {
	const rows: ioBroker.GetHistoryResult = [];
	for (let d = 0; d < days; d++) {
		for (let h = 0; h < hoursPerDay; h++) {
			rows.push({
				ts: baseMs + d * 86_400_000 + h * 3_600_000 + 120_000,
				val: powerW + h * 10,
				ack: true,
				lc: 0,
				from: "test",
			});
		}
	}
	return rows;
}

describe("house_load history", () => {
	it("isValidHouseLoadW accepts plausible watts", () => {
		assert.equal(isValidHouseLoadW(1500), true);
		assert.equal(isValidHouseLoadW(0), true);
		assert.equal(isValidHouseLoadW(-1), false);
		assert.equal(isValidHouseLoadW(60_000), false);
	});

	it("normalizeHouseLoadPowerW scales kW to W", () => {
		assert.equal(normalizeHouseLoadPowerW(3.5, "kW"), 3500);
		assert.equal(normalizeHouseLoadPowerW(1500, "W"), 1500);
	});

	it("aggregates one sample per hour across multiple days", async () => {
		const base = Date.UTC(2026, 5, 20, 0, 0, 0);
		const host: HistoryQueryHost = {
			getHistoryAsync: async () => ({ result: mockRowsPerDay(base, 4, 24, 2000) }),
		};
		const { samples, stats } = await fetchHouseLoadSamples(host, "sonnen.0.status.consumption", 90);
		assert.equal(stats.rowsTotal, 96);
		assert.equal(stats.hourlySamples, 96);
		assert.ok(distinctSampleDays(samples) >= 4);
	});

	it("uses latest row per hour bucket (descending history order)", async () => {
		const hour = Date.UTC(2026, 5, 24, 10, 0, 0);
		const host: HistoryQueryHost = {
			getHistoryAsync: async () => ({
				result: [
					{ ts: hour + 3_000_000, val: 4000, ack: true, lc: 0, from: "test" },
					{ ts: hour + 1_000_000, val: 2000, ack: true, lc: 0, from: "test" },
					{ ts: hour + 2_000_000, val: 3000, ack: true, lc: 0, from: "test" },
				],
			}),
		};
		const { samples } = await fetchHouseLoadSamples(host, "sonnen.0.status.consumption", 7);
		assert.equal(samples.length, 1);
		assert.equal(samples[0].powerW, 4000);
	});

	it("spreads second-based history timestamps across hours", async () => {
		const baseSec = 1_782_000_000;
		const host: HistoryQueryHost = {
			getHistoryAsync: async () => ({
				result: Array.from({ length: 96 }, (_, i) => ({
					ts: baseSec + i * 3600,
					val: 2500,
					ack: true,
					lc: 0,
					from: "test",
				})),
			}),
		};
		const { samples, stats } = await fetchHouseLoadSamples(host, "sonnen.0.status.consumption", 7);
		assert.equal(stats.hourlySamples, 96);
		assert.ok((stats.tsSpanHours ?? 0) >= 95);
	});
});
