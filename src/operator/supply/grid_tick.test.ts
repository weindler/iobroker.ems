import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { GridSupplyBuildInput } from "./grid.js";
import type { GridSupplyForecast } from "../types.js";
import { gridSupplyRevisionForTest, resetGridSupplyRevisionForTest, runGridSupplyTick } from "./grid_tick.js";
import { GRID_SUPPLY_STATE_IDS } from "./grid_states.js";

function sampleForecast(overrides: Partial<GridSupplyForecast> = {}): GridSupplyForecast {
	return {
		generatedAt: "2026-07-11T10:00:00.000Z",
		validUntil: null,
		source: "fixed_tariff",
		currentPriceCtPerKwh: 30,
		gridImportAllowed: true,
		configuredMaxGridImportW: 11000,
		configuredHouseFuseLimitW: 11000,
		effectiveMaxGridImportW: 11000,
		slots: [],
		quality: { status: "valid", reasonDe: "test", confidencePct: 100 },
		reasonDe: "test",
		...overrides,
	};
}

function sampleInput(): GridSupplyBuildInput {
	return {
		now: new Date("2026-07-11T10:00:00.000Z"),
		globalMode: "balanced",
		policyGridImportAllowed: true,
		configuredMaxGridImportW: 11000,
		configuredHouseFuseLimitW: 11000,
		currentPriceCtPerKwh: 30,
		fixedPriceCtPerKwh: 30,
		dynamicSlots: [],
	};
}

function mockHost(initial: Record<string, ioBroker.StateValue> = {}) {
	const store = new Map<string, ioBroker.StateValue>(Object.entries(initial));
	let getCalls = 0;
	let failOnWriteId: string | null = null;
	return {
		store,
		get getCalls() {
			return getCalls;
		},
		setFailOnWriteId(id: string | null) {
			failOnWriteId = id;
		},
		config: {},
		log: { warn() {} },
		async setObjectNotExistsAsync() {},
		async getStateAsync(id: string) {
			getCalls++;
			const val = store.get(id);
			return val === undefined ? null : ({ val, ack: true } as ioBroker.State);
		},
		async setStateAsync(id: string, state: ioBroker.SettableState) {
			if (failOnWriteId && id === failOnWriteId) {
				throw new Error(`write failed: ${id}`);
			}
			store.set(id, state.val as ioBroker.StateValue);
		},
	};
}

describe("grid supply revision writes", () => {
	beforeEach(() => {
		resetGridSupplyRevisionForTest();
	});

	it("same revision with existing state reads before compare and skips unchanged writes", async () => {
		const forecast = sampleForecast();
		const input = sampleInput();
		const host = mockHost({
			[GRID_SUPPLY_STATE_IDS.status]: forecast.quality.status,
			[GRID_SUPPLY_STATE_IDS.source]: forecast.source,
			[GRID_SUPPLY_STATE_IDS.generatedAt]: forecast.generatedAt,
			[GRID_SUPPLY_STATE_IDS.validUntil]: "",
			[GRID_SUPPLY_STATE_IDS.currentPriceCtPerKwh]: forecast.currentPriceCtPerKwh ?? 0,
			[GRID_SUPPLY_STATE_IDS.importAllowed]: forecast.gridImportAllowed,
			[GRID_SUPPLY_STATE_IDS.maxImportPowerW]: forecast.effectiveMaxGridImportW ?? 0,
			[GRID_SUPPLY_STATE_IDS.slotsJson]: "[]",
			[GRID_SUPPLY_STATE_IDS.reasonDe]: forecast.reasonDe,
			[GRID_SUPPLY_STATE_IDS.revision]: 1,
		});

		await runGridSupplyTick(host as Parameters<typeof runGridSupplyTick>[0], { forecast, input });
		assert.equal(gridSupplyRevisionForTest(), 1);
		const readsAfterFirst = host.getCalls;

		await runGridSupplyTick(host as Parameters<typeof runGridSupplyTick>[0], { forecast, input });
		assert.equal(gridSupplyRevisionForTest(), 1);
		assert.ok(host.getCalls > readsAfterFirst);
	});

	it("same revision with missing state writes new values via skipRead", async () => {
		const forecast = sampleForecast();
		const input = sampleInput();
		const host = mockHost();

		await runGridSupplyTick(host as Parameters<typeof runGridSupplyTick>[0], { forecast, input });
		assert.equal(gridSupplyRevisionForTest(), 1);
		assert.equal(host.store.get(GRID_SUPPLY_STATE_IDS.revision), 1);
		assert.equal(host.getCalls, 0);
	});

	it("new revision uses skipRead and commits cache only after successful writes", async () => {
		const input = sampleInput();
		const host = mockHost();
		const first = sampleForecast({ currentPriceCtPerKwh: 30 });
		const second = sampleForecast({ currentPriceCtPerKwh: 31 });

		await runGridSupplyTick(host, { forecast: first, input });
		assert.equal(gridSupplyRevisionForTest(), 1);
		const readsAfterFirst = host.getCalls;

		await runGridSupplyTick(host, { forecast: second, input });
		assert.equal(gridSupplyRevisionForTest(), 2);
		assert.equal(host.store.get(GRID_SUPPLY_STATE_IDS.currentPriceCtPerKwh), 31);
		assert.equal(host.getCalls, readsAfterFirst);
	});

	it("failed write does not advance revision cache", async () => {
		const input = sampleInput();
		const host = mockHost();
		host.setFailOnWriteId(GRID_SUPPLY_STATE_IDS.revision);

		await runGridSupplyTick(host, { forecast: sampleForecast({ reasonDe: "boom" }), input });
		assert.equal(gridSupplyRevisionForTest(), 0);
		assert.equal(host.store.has(GRID_SUPPLY_STATE_IDS.revision), false);
	});
});

describe("planner shared grid input", () => {
	it("does not mutate prebuilt grid input during grid supply tick", async () => {
		resetGridSupplyRevisionForTest();
		const input = sampleInput();
		const inputSnapshot = JSON.stringify(input);
		const forecast = sampleForecast();
		const host = mockHost();

		await runGridSupplyTick(host as Parameters<typeof runGridSupplyTick>[0], { forecast, input });

		assert.equal(JSON.stringify(input), inputSnapshot);
	});
});
