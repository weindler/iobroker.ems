import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { buildForecastPlan } from "./build.js";
import { FORECAST_PLAN_STATE_IDS } from "./states.js";
import {
	forecastPlanRevisionForTest,
	resetForecastPlanRevisionForTest,
	resolveForecastRevisionChangeForTest,
	runForecastPlanTick,
} from "./tick.js";
import { hasDeferredForecastPlanWrite } from "./deferred_writes.js";
import { operatorQuality } from "../quality.js";
import { buildPvContribution } from "../contributions/pv.js";
import { buildHouseLoadContribution } from "../contributions/house_load.js";
import { buildGridSupplyContribution } from "../contributions/constraints.js";
import type { GridSupplyForecast } from "../types.js";

function mockHost(initial: Record<string, ioBroker.StateValue> = {}) {
	const store = new Map<string, ioBroker.StateValue>(Object.entries(initial));
	return {
		store,
		config: {},
		log: { warn() {}, info() {} },
		async setObjectNotExistsAsync() {},
		async getStateAsync(id: string) {
			const val = store.get(id);
			return val === undefined ? null : ({ val, ack: true } as ioBroker.State);
		},
		async setStateAsync(id: string, state: ioBroker.SettableState) {
			store.set(id, state.val as ioBroker.StateValue);
		},
	};
}

describe("forecast revision persistence", () => {
	beforeEach(() => {
		resetForecastPlanRevisionForTest();
	});

	it("cold start with matching stored semantic hash keeps revision and skips rewrite", async () => {
		const host = mockHost({
			[FORECAST_PLAN_STATE_IDS.semanticRevisionHash]: "abc123",
			[FORECAST_PLAN_STATE_IDS.revision]: 7,
		});
		const result = await resolveForecastRevisionChangeForTest(
			host as Parameters<typeof resolveForecastRevisionChangeForTest>[0],
			"payload",
			"abc123",
		);
		assert.equal(result.revisionChanged, false);
		assert.equal(result.skipLargeJsonWrites, true);
		assert.equal(result.skipReason, "stored_hash_match");
		assert.equal(result.nextRevision, 7);
		assert.equal(forecastPlanRevisionForTest(), 7);
	});

	it("cold start with different semantic hash bumps revision", async () => {
		const host = mockHost({
			[FORECAST_PLAN_STATE_IDS.semanticRevisionHash]: "old",
			[FORECAST_PLAN_STATE_IDS.revision]: 2,
		});
		const result = await resolveForecastRevisionChangeForTest(
			host as Parameters<typeof resolveForecastRevisionChangeForTest>[0],
			"payload",
			"new",
		);
		assert.equal(result.revisionChanged, true);
		assert.equal(result.skipLargeJsonWrites, false);
		assert.equal(result.nextRevision, 1);
	});

	it("semantic hash change with deferLargeJsonWrites schedules deferred write path", async () => {
		const host = mockHost({
			[FORECAST_PLAN_STATE_IDS.semanticRevisionHash]: "old",
			[FORECAST_PLAN_STATE_IDS.revision]: 2,
		});
		const result = await resolveForecastRevisionChangeForTest(
			host as Parameters<typeof resolveForecastRevisionChangeForTest>[0],
			"payload",
			"new",
			true,
		);
		assert.equal(result.revisionChanged, true);
		assert.equal(result.deferLargeJsonWrites, true);
		assert.equal(hasDeferredForecastPlanWrite(), false);
	});

	it("missing stored hash on cold start requires rewrite", async () => {
		const host = mockHost();
		const result = await resolveForecastRevisionChangeForTest(
			host as Parameters<typeof resolveForecastRevisionChangeForTest>[0],
			"payload",
			"hash",
		);
		assert.equal(result.revisionChanged, true);
		assert.equal(result.nextRevision, 1);
	});
});

function gridForecast(): GridSupplyForecast {
	return {
		generatedAt: "2026-07-11T10:00:00.000Z",
		validUntil: null,
		source: "dynamic_tariff",
		currentPriceCtPerKwh: 24,
		gridImportAllowed: true,
		configuredMaxGridImportW: 11000,
		configuredHouseFuseLimitW: 13800,
		effectiveMaxGridImportW: 11000,
		slots: [],
		quality: operatorQuality("valid", "Grid OK"),
		reasonDe: "Grid OK",
	};
}

function minimalStoredPlanJson(): string {
	const now = new Date("2026-07-11T10:00:00.000Z");
	const contributions = [
		buildPvContribution({
			now,
			correctedTodayKwh: 15,
			correctedTomorrowKwh: 18,
			rawTodayKwh: 14,
			rawTomorrowKwh: 17,
			confidencePct: 80,
			status: "ready",
			lastUpdateTs: now.toISOString(),
			source: "learning.pv_bias",
			horizonDays: [
				{ dayIndex: 0, dateKey: "2026-07-11", correctedKwh: 15, confidencePct: 80 },
				{ dayIndex: 1, dateKey: "2026-07-12", correctedKwh: 18, confidencePct: 80 },
			],
		}),
		buildHouseLoadContribution({
			now,
			timezone: "UTC",
			status: "ready",
			confidence: 70,
			forecastToday: {
				date: "2026-07-11",
				season: "summer",
				weekday: "saturday",
				day_type: "weekend",
				segments: {
					midday: { avg_w: 1000, source: "p", fallback_level: "none", confidence: 70 },
				},
			},
			forecastTomorrow: null,
			lastUpdate: now.toISOString(),
		}),
		buildGridSupplyContribution(gridForecast()),
	];
	const plan = buildForecastPlan({ now, timezone: "UTC", contributions });
	plan.revision = 3;
	return JSON.stringify(plan);
}

describe("forecast bootstrap cache", () => {
	beforeEach(() => {
		resetForecastPlanRevisionForTest();
	});

	it("uses cached plan_json during bootstrap without scheduling duplicate refresh when already deferred", async () => {
		const planJson = minimalStoredPlanJson();
		const host = mockHost({
			[FORECAST_PLAN_STATE_IDS.status]: "ready",
			[FORECAST_PLAN_STATE_IDS.planJson]: planJson,
			[FORECAST_PLAN_STATE_IDS.revision]: 3,
		});
		let getStateCalls = 0;
		const origGet = host.getStateAsync.bind(host);
		host.getStateAsync = async (id: string) => {
			getStateCalls++;
			return origGet(id);
		};

		const plan = await runForecastPlanTick(
			host as Parameters<typeof runForecastPlanTick>[0],
			gridForecast(),
			[],
			{ deferLargeJsonWrites: true },
		);

		assert.equal(plan.revision, 3);
		assert.equal(plan.slots.length > 0, true);
		assert.equal(hasDeferredForecastPlanWrite(), true);
		assert.equal(getStateCalls <= 4, true, `expected at most 4 state reads, got ${getStateCalls}`);
		assert.equal(host.store.has(FORECAST_PLAN_STATE_IDS.planJson), true);
	});
});
