import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import { STATISTICS_STATES } from "./ensure_states.js";
import { __resetStatisticsForTest, tickStatistics, type StatisticsHost } from "./tick.js";

it("berechnet Hausvergleich für alle auswählbaren Zeiträume aus gepaarten Tibber-Messwerten", async () => {
	const dir = await mkdtemp(join(tmpdir(), "ems-stat-periods-"));
	const states = new Map<string, ioBroker.State>();
	const daily = [
		{ from: "2026-08-31T00:00:00Z", consumption: 10, totalCost: 2 },
		{ from: "2026-09-20T00:00:00Z", consumption: 20, totalCost: 4 },
		{ from: "2026-09-25T00:00:00Z", consumption: 30, totalCost: 6 },
		{ from: "2026-09-26T00:00:00Z", consumption: 40, totalCost: 8 },
	];
	const foreign = new Map<string, unknown>([
		["tibber.0.Consumption.jsonDaily", JSON.stringify(daily)],
		["tibber.0.Consumption.jsonMonthly", JSON.stringify([
			{ from: "2026-08-01T00:00:00Z", consumption: 100, totalCost: 20 },
		])],
	]);
	const host: StatisticsHost = {
		config: {
			statistics_enabled: true,
			statistics_start_date: "2026-08-01",
			statistics_tibber_json_daily_state: "tibber.0.Consumption.jsonDaily",
			statistics_compare_tariff_ct_per_kwh: 30,
			statistics_compare_tariff_monthly_base_eur: 0,
			statistics_grid_rewards_enabled: false,
		},
		getAbsolutePath: (category = "") => join(dir, category),
		getStateAsync: async (id) => states.get(id) ?? null,
		getForeignStateAsync: async (id) => foreign.has(id) ? ({ val: foreign.get(id) } as ioBroker.State) : null,
		setStateAsync: async (id, state) => { states.set(id, state as ioBroker.State); },
	};
	const expected: Record<string, number | null> = {
		today: 4,
		yesterday: 3,
		last_7_days: 9,
		this_month: 9,
		last_month: 10,
		this_quarter: 19,
		last_quarter: null,
		this_year: 19,
		last_year: null,
		year_2026: 19,
	};
	try {
		__resetStatisticsForTest();
		for (const [period, savings] of Object.entries(expected)) {
			states.set(STATISTICS_STATES.periodId, { val: period } as ioBroker.State);
			await tickStatistics(host, new Date("2026-09-26T12:00:00Z"));
			const comparison = JSON.parse(String(states.get(STATISTICS_STATES.homePeriodJson)?.val));
			assert.equal(comparison.savingsVsFixedEur, savings, period);
		}
	} finally {
		__resetStatisticsForTest();
		await rm(dir, { recursive: true, force: true });
	}
});
