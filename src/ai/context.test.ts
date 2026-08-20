import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildAiOptimizationContext, resolveAllowedAddonIds } from "./context.js";
import type { DailyPlan } from "../operator/daily_plan/types.js";

function minimalPlan(overrides: Partial<DailyPlan> = {}): DailyPlan {
	return {
		generatedAt: "2026-07-25T10:00:00.000Z",
		validUntil: null,
		revision: 1,
		date: "2026-07-25",
		timezone: "Europe/Berlin",
		slotMinutes: 15,
		globalMode: "balanced",
		status: "ready",
		policySnapshot: {},
		constraintSnapshot: {},
		activeContributionIds: ["immersion_heater"],
		excludedContributions: [{ contributionId: "wallbox", reasonDe: "nicht angesteckt" }],
		slots: [],
		allocations: [],
		unallocated: [
			{
				contributionId: "immersion_heater",
				requestedEnergyKwh: 3,
				allocatedEnergyKwh: 1.8,
				unallocatedEnergyKwh: 1.2,
				reasonDe: "PV reicht nicht",
			},
		],
		totals: {
			pvForecastEnergyKwh: 12,
			fixedHouseLoadEnergyKwh: 8,
			fixedRenewableBalanceKwh: null,
			flexibleRequestedEnergyKwh: 3,
			flexibleAllocatedEnergyKwh: 1.8,
			flexibleUnallocatedEnergyKwh: 1.2,
			pvAllocatedEnergyKwh: 1.8,
			gridAllocatedEnergyKwh: 0,
			batteryChargeEnergyKwh: 0,
			wallboxEnergyKwh: 0,
			immersionHeaterEnergyKwh: 1.8,
			airConditioningEnergyKwh: 0,
			estimatedGridCostCt: 45,
			mandatoryRequestedEnergyKwh: null,
			mandatoryAllocatedEnergyKwh: 0,
			mandatoryUnallocatedEnergyKwh: null,
		},
		quality: { status: "valid", confidencePct: 100, reasonDe: "" },
		reasonDe: "Testplan",
		...overrides,
	};
}

describe("ai resolveAllowedAddonIds", () => {
	it("empty when nothing is AI-allowed (default config)", () => {
		assert.deepEqual(resolveAllowedAddonIds({}), []);
	});

	it("only lists addons that are BOTH enabled AND ai-allowed", () => {
		const ids = resolveAllowedAddonIds({
			immersion_heater_enabled: true,
			immersion_heater_ai_optimization_allowed: true,
			wallbox_enabled: false,
			wallbox_ai_optimization_allowed: true,
			battery_enabled: true,
			battery_ai_optimization_allowed: false,
		});
		assert.deepEqual(ids, ["immersion_heater"]);
	});
});

describe("ai buildAiOptimizationContext", () => {
	it("builds full daily-plan digest + learning digest (Block 6)", async () => {
		const host = {
			config: { immersion_heater_enabled: true, immersion_heater_ai_optimization_allowed: true },
			async getStateAsync(id: string) {
				if (id === "policy.global.effective_json") {
					return {
						val: JSON.stringify({
							limits: { houseFuseLimitW: { value: 30000 } },
							economics: { gridImportAllowed: { value: true } },
						}),
						ack: true,
					} as ioBroker.State;
				}
				if (id === "learning.pv_bias.status") return { val: "ready", ack: true } as ioBroker.State;
				if (id === "learning.pv_bias.corrected_today_kwh") return { val: 12.5, ack: true } as ioBroker.State;
				return null;
			},
		};
		const ctx = await buildAiOptimizationContext(host, minimalPlan(), "test_trigger");
		assert.deepEqual(ctx.allowedAddonIds, ["immersion_heater"]);
		assert.equal(ctx.dailyPlan.date, "2026-07-25");
		assert.equal(ctx.dailyPlan.horizonSlotCount, 0);
		assert.equal(ctx.dailyPlan.totals.flexibleUnallocatedEnergyKwh, 1.2);
		assert.equal(ctx.dailyPlan.totals.immersionHeaterEnergyKwh, 1.8);
		assert.equal(ctx.learning.pvBiasStatus, "ready");
		assert.equal(ctx.learning.pvCorrectedTodayKwh, 12.5);
		assert.equal(ctx.policyHighlights.houseFuseLimitW, 30000);
		assert.equal(ctx.policyHighlights.gridImportAllowed, true);
		assert.equal(ctx.triggerReason, "test_trigger");
		assert.ok(ctx.situation);
		assert.equal(ctx.situation.live.pvPowerW, null);
		assert.equal(ctx.situation.wallbox.connected, null);
		assert.equal(ctx.learning.pvHorizonDays.length, 7);
	});

	it("situation keeps nulls — never invents 0 for missing live values", async () => {
		const host = {
			config: {},
			async getStateAsync(id: string) {
				if (id === "live.pv.power_w") return { val: 4200, ack: true } as ioBroker.State;
				if (id === "operator.diagnostics.surplus_w") return { val: 1800, ack: true } as ioBroker.State;
				return null;
			},
		};
		const ctx = await buildAiOptimizationContext(host, minimalPlan(), "x");
		assert.equal(ctx.situation.live.pvPowerW, 4200);
		assert.equal(ctx.situation.live.surplusW, 1800);
		assert.equal(ctx.situation.live.houseLoadW, null);
		assert.equal(ctx.situation.live.deficitW, null);
		assert.equal(ctx.situation.immersion.bufferTempC, null);
		assert.equal(ctx.situation.immersion.boilerTempC, null);
		assert.equal(ctx.situation.priceNowCt, null);
	});

	it("uses boiler empty-at for thermalEstimated* — never the buffer tree", async () => {
		const host = {
			config: {},
			async getStateAsync(id: string) {
				if (id === "learning.thermal_runtime.estimated_empty_at") {
					return { val: "2026-08-20T08:40:00.000Z", ack: true } as ioBroker.State;
				}
				if (id === "learning.thermal_runtime.status") {
					return { val: "ready", ack: true } as ioBroker.State;
				}
				if (id === "learning.thermal_boiler.estimated_empty_at") {
					return { val: "2026-08-21T00:40:00.000Z", ack: true } as ioBroker.State;
				}
				if (id === "learning.thermal_boiler.status") {
					return { val: "ready", ack: true } as ioBroker.State;
				}
				if (id === "live.thermal.buffer_temp_c") return { val: 46, ack: true } as ioBroker.State;
				if (id === "live.thermal.boiler_temp_c") return { val: 52, ack: true } as ioBroker.State;
				return null;
			},
		};
		const ctx = await buildAiOptimizationContext(host, minimalPlan(), "x");
		assert.equal(ctx.learning.thermalEstimatedEmptyAt, "2026-08-21T00:40:00.000Z");
		assert.equal(ctx.learning.thermalBoilerEstimatedEmptyAt, "2026-08-21T00:40:00.000Z");
		assert.equal(ctx.learning.thermalBufferEstimatedEmptyAt, "2026-08-20T08:40:00.000Z");
		assert.equal(ctx.situation.immersion.thermalEstimatedEmptyAt, "2026-08-21T00:40:00.000Z");
		assert.equal(ctx.situation.immersion.boilerEstimatedEmptyAt, "2026-08-21T00:40:00.000Z");
		assert.equal(ctx.situation.immersion.bufferEstimatedEmptyAt, "2026-08-20T08:40:00.000Z");
		assert.equal(ctx.situation.immersion.boilerTempC, 52);
		assert.equal(ctx.situation.immersion.bufferTempC, 46);
		assert.notEqual(ctx.situation.immersion.thermalEstimatedEmptyAt, ctx.situation.immersion.bufferEstimatedEmptyAt);
	});

	it("missing/invalid policy state → empty highlights, never throws", async () => {
		const host = { config: {}, async getStateAsync() { return null; } };
		const ctx = await buildAiOptimizationContext(host, minimalPlan(), "x");
		assert.deepEqual(ctx.policyHighlights, { houseFuseLimitW: null, maxGridImportW: null, gridImportAllowed: null });
	});

	it("emits horizon slots but zeros IH/AC when neither is AI-allowed", async () => {
		const host = { config: {}, async getStateAsync() { return null; } };
		const plan = minimalPlan({
			slots: [
				{
					slot: { startIso: "2026-07-25T10:00:00.000Z", endIso: "2026-07-25T10:15:00.000Z" },
					pvForecastPowerW: 1000,
					fixedHouseLoadPowerW: 400,
					fixedBalancePowerW: 600,
					gridPriceCtPerKwh: 30,
					gridImportAllowed: true,
					configuredGridImportLimitW: 30000,
					remainingGridImportPowerW: 20000,
					availablePvSurplusPowerW: 600,
					allocatedFlexiblePowerW: 500,
					allocatedPvPowerW: 500,
					allocatedGridPowerW: 0,
					allocatedBatteryPowerW: 0,
					remainingPvSurplusPowerW: 100,
					remainingGridImportPowerWAfterAlloc: 20000,
					remainingBatteryDischargePowerW: null,
					allocations: [
						{
							contributionId: "immersion_heater.flexible",
							contributor: { type: "addon", id: "immersion_heater", addonId: "immersion_heater" },
							slot: { startIso: "2026-07-25T10:00:00.000Z", endIso: "2026-07-25T10:15:00.000Z" },
							status: "allocated",
							energySource: "pv_surplus",
							requestedPowerW: 500,
							allocatedPowerW: 500,
							requestedEnergyKwh: 0.125,
							allocatedEnergyKwh: 0.125,
							gridPowerW: 0,
							pvPowerW: 500,
							mandatory: false,
							priorityRank: 1,
							deadlineIso: null,
							estimatedCostCt: 0,
							reasonDe: "PV vorhanden",
						},
					],
					quality: { status: "valid", confidencePct: 100, reasonDe: "" },
					reasonDe: "",
				},
			],
		});
		const ctx = await buildAiOptimizationContext(host, plan, "x");
		assert.equal(ctx.dailyPlan.slots.length, 1);
		assert.equal(ctx.dailyPlan.slots[0]!.ihFlexW, 0);
		assert.equal(ctx.dailyPlan.slots[0]!.acW, 0);
		assert.equal(ctx.dailyPlan.slots[0]!.houseLoadW, 400);
	});

	it("dailyPlan.slots is populated (only flexible, not mandatory) when immersion_heater is allowed", async () => {
		const host = {
			config: { immersion_heater_enabled: true, immersion_heater_ai_optimization_allowed: true },
			async getStateAsync() {
				return null;
			},
		};
		const plan = minimalPlan({
			slots: [
				{
					slot: { startIso: "2026-07-25T10:00:00.000Z", endIso: "2026-07-25T10:15:00.000Z" },
					pvForecastPowerW: 1000,
					fixedHouseLoadPowerW: 400,
					fixedBalancePowerW: 600,
					gridPriceCtPerKwh: 30,
					gridImportAllowed: true,
					configuredGridImportLimitW: 30000,
					remainingGridImportPowerW: 20000,
					availablePvSurplusPowerW: 600,
					allocatedFlexiblePowerW: 700,
					allocatedPvPowerW: 700,
					allocatedGridPowerW: 0,
					allocatedBatteryPowerW: 0,
					remainingPvSurplusPowerW: 0,
					remainingGridImportPowerWAfterAlloc: 20000,
					remainingBatteryDischargePowerW: null,
					allocations: [
						{
							contributionId: "immersion_heater.mandatory",
							contributor: { type: "addon", id: "immersion_heater", addonId: "immersion_heater" },
							slot: { startIso: "2026-07-25T10:00:00.000Z", endIso: "2026-07-25T10:15:00.000Z" },
							status: "allocated",
							energySource: "grid",
							requestedPowerW: 200,
							allocatedPowerW: 200,
							requestedEnergyKwh: 0.05,
							allocatedEnergyKwh: 0.05,
							gridPowerW: 200,
							pvPowerW: 0,
							mandatory: true,
							priorityRank: 0,
							deadlineIso: null,
							estimatedCostCt: 0,
							reasonDe: "Anti-Legionellen",
						},
						{
							contributionId: "immersion_heater.flexible",
							contributor: { type: "addon", id: "immersion_heater", addonId: "immersion_heater" },
							slot: { startIso: "2026-07-25T10:00:00.000Z", endIso: "2026-07-25T10:15:00.000Z" },
							status: "allocated",
							energySource: "pv_surplus",
							requestedPowerW: 500,
							allocatedPowerW: 500,
							requestedEnergyKwh: 0.125,
							allocatedEnergyKwh: 0.125,
							gridPowerW: 0,
							pvPowerW: 500,
							mandatory: false,
							priorityRank: 1,
							deadlineIso: null,
							estimatedCostCt: 0,
							reasonDe: "PV vorhanden",
						},
					],
					quality: { status: "valid", confidencePct: 100, reasonDe: "" },
					reasonDe: "",
				},
			],
		});
		const ctx = await buildAiOptimizationContext(host, plan, "x");
		assert.equal(ctx.dailyPlan.slots.length, 1);
		assert.equal(ctx.dailyPlan.slots[0].t, "2026-07-25T10:00:00.000Z");
		assert.equal(ctx.dailyPlan.slots[0].ihFlexW, 500);
		assert.equal(ctx.dailyPlan.slots[0].acW, 0);
		assert.equal(ctx.dailyPlan.slots[0].priceCtPerKwh, 30);
		assert.equal(ctx.dailyPlan.slots[0].pvSurplusW, 600);
	});
});
