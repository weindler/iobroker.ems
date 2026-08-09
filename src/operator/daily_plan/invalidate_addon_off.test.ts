import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	stripAddonFromDailyPlan,
	stripAddonFromUnifiedPlan,
	isAddonContributionId,
} from "./invalidate_addon_off.js";
import {
	invalidatePublishedPlanForAddonOff,
	requestForcedUnifiedReplan,
	resetDailyPlanRevisionForTest,
} from "./tick.js";
import { ALLOCATION_ADDON_STATE_IDS, DAILY_PLAN_STATE_IDS } from "./states.js";
import { buildUnifiedDayAgendaDe } from "../../beta/product_summary.js";
import type { UnifiedDayPlan } from "./unified/types.js";
import type { DailyPlan } from "./types.js";

describe("invalidate addon off — pure strip", () => {
	it("strips IH from unified and daily plan", () => {
		const unified = {
			allocations: [
				{ kind: "immersion_heater", contributionId: "immersion_heater.flexible" },
				{ kind: "climate", contributionId: "air_conditioning.unit_1" },
				{ kind: "wallbox", contributionId: "wallbox.ev_session" },
			],
			unallocated: [],
		} as unknown as UnifiedDayPlan;
		const stripped = stripAddonFromUnifiedPlan(unified, "immersion_heater");
		assert.equal(stripped.allocations.length, 2);
		assert.ok(!stripped.allocations.some((a) => a.kind === "immersion_heater"));

		const daily = {
			allocations: [
				{ contributionId: "immersion_heater.flexible", allocatedPowerW: 1700 },
				{ contributionId: "wallbox.ev_session", allocatedPowerW: 7000 },
			],
			slots: [
				{
					slot: { startIso: "a", endIso: "b" },
					allocations: [
						{ contributionId: "immersion_heater.flexible", allocatedPowerW: 1700 },
						{ contributionId: "wallbox.ev_session", allocatedPowerW: 7000 },
					],
				},
			],
		} as unknown as DailyPlan;
		const d2 = stripAddonFromDailyPlan(daily, "immersion_heater");
		assert.equal(d2.allocations.length, 1);
		assert.equal(d2.slots[0]!.allocations.length, 1);
		assert.equal(isAddonContributionId("wallbox", "wallbox.ev_session"), true);
	});
});

describe("invalidatePublishedPlanForAddonOff — published states", () => {
	it("clears addon plan_json and product summary immediately", async () => {
		resetDailyPlanRevisionForTest();
		const store = new Map<string, ioBroker.StateValue>();
		const plan: DailyPlan = {
			allocations: [
				{
					contributionId: "immersion_heater.flexible",
					contributor: { type: "addon", id: "immersion_heater", addonId: "immersion_heater" },
					slot: { startIso: "2026-08-09T11:00:00.000Z", endIso: "2026-08-09T11:15:00.000Z" },
					status: "allocated",
					energySource: "pv",
					requestedPowerW: 1700,
					allocatedPowerW: 1700,
					requestedEnergyKwh: 0.4,
					allocatedEnergyKwh: 0.4,
					gridPowerW: 0,
					pvPowerW: 1700,
					batteryPowerW: 0,
					mandatory: false,
					priorityRank: null,
					deadlineIso: null,
					estimatedCostCt: null,
					reasonDe: "test",
				},
				{
					contributionId: "wallbox.ev_session",
					contributor: { type: "addon", id: "wallbox", addonId: "wallbox" },
					slot: { startIso: "2026-08-09T13:00:00.000Z", endIso: "2026-08-09T13:15:00.000Z" },
					status: "allocated",
					energySource: "pv",
					requestedPowerW: 7000,
					allocatedPowerW: 7000,
					requestedEnergyKwh: 1.75,
					allocatedEnergyKwh: 1.75,
					gridPowerW: 0,
					pvPowerW: 7000,
					batteryPowerW: 0,
					mandatory: false,
					priorityRank: null,
					deadlineIso: null,
					estimatedCostCt: null,
					reasonDe: "test",
				},
			],
			slots: [],
		} as unknown as DailyPlan;
		store.set(DAILY_PLAN_STATE_IDS.planJson, JSON.stringify(plan));
		store.set(ALLOCATION_ADDON_STATE_IDS.immersion_heater.planJson, JSON.stringify(plan.allocations.slice(0, 1)));
		store.set("global.execution_mode", "live");
		store.set("addons.immersion_heater.mode", "off");
		store.set("addons.wallbox.mode", "live");
		store.set("addons.battery.mode", "dryrun");
		store.set("addons.air_conditioning.mode", "live");
		store.set("operator.product_summary_de", "Plan: Heizstab thermisch vorladen 11:00–11:15.");

		const host = {
			config: {},
			log: { info: () => undefined, warn: () => undefined },
			getStateAsync: async (id: string) =>
				store.has(id) ? ({ val: store.get(id), ack: true } as ioBroker.State) : null,
			setStateAsync: async (id: string, st: ioBroker.SettableState) => {
				store.set(id, st.val ?? null);
			},
		};

		await invalidatePublishedPlanForAddonOff(host, "immersion_heater");

		assert.equal(store.get(ALLOCATION_ADDON_STATE_IDS.immersion_heater.planJson), "[]");
		assert.match(String(store.get(ALLOCATION_ADDON_STATE_IDS.immersion_heater.reasonDe)), /AUS/);
		const stripped = JSON.parse(String(store.get(DAILY_PLAN_STATE_IDS.planJson))) as DailyPlan;
		assert.ok(!stripped.allocations.some((a) => a.contributionId.startsWith("immersion_heater.")));
		assert.ok(stripped.allocations.some((a) => a.contributionId.startsWith("wallbox.")));
		assert.match(String(store.get("operator.product_summary_de")), /AUS|Heizstab/);

		requestForcedUnifiedReplan("test_after_invalidate");
	});
});

describe("OFF agenda — no stale allocation windows", () => {
	it("IH off agenda has AUS and no thermal window", () => {
		const plan = {
			schemaVersion: 1,
			planId: "stale",
			generation: 1,
			createdAtIso: "2026-08-09T06:00:00.000Z",
			date: "2026-08-09",
			timezone: "UTC",
			globalMode: "balanced",
			horizonStartIso: "2026-08-09T06:00:00.000Z",
			horizonEndIso: "2026-08-09T18:00:00.000Z",
			slotMinutes: 15,
			allocations: [
				{
					kind: "immersion_heater",
					contributionId: "immersion_heater.flexible",
					slot: {
						startIso: "2026-08-09T11:00:00.000Z",
						endIso: "2026-08-09T11:15:00.000Z",
					},
					allocatedPowerW: 1700,
					allocatedEnergyKwh: 0.4,
					energySource: "pv",
					reasonCodes: [],
					constraintIds: [],
				},
				{
					kind: "wallbox",
					contributionId: "wallbox.ev_session",
					slot: {
						startIso: "2026-08-09T13:00:00.000Z",
						endIso: "2026-08-09T13:15:00.000Z",
					},
					allocatedPowerW: 7000,
					allocatedEnergyKwh: 1.75,
					energySource: "pv",
					reasonCodes: [],
					constraintIds: [],
				},
			],
			constraints: [],
			reasonCodes: [],
			unallocated: [],
			totals: {},
		} as unknown as UnifiedDayPlan;
		const afterStrip = stripAddonFromUnifiedPlan(plan, "immersion_heater");
		const agenda = buildUnifiedDayAgendaDe(afterStrip, {
			immersion_heater: {
				liveWriteAllowed: false,
				hardwareActive: false,
				executionOff: true,
			},
			wallbox: {
				liveWriteAllowed: true,
				hardwareActive: false,
				executionOff: false,
			},
		});
		assert.ok(agenda.some((l) => /Heizstab: AUS/.test(l)));
		assert.ok(!agenda.some((l) => /thermisch vorladen|1700/.test(l)));
		assert.ok(agenda.some((l) => /Fahrzeugladung/.test(l)));
	});
});
