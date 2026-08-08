/**
 * AI-AUTH-001…006 — Beta Authority Boundary.
 * AI darf keine autoritativen Allocations/Slices mutieren; Learning schon.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { DailyAllocationEntry, DailyPlan, DailyPlanSlot } from "../../operator/daily_plan/types";
import type { AiSlotPreference } from "../types";
import { AI_STATES } from "../ensure_states";
import { COMPARE_STATES } from "../compare/ensure_states";
import { applyAiPreferencesToDailyPlan } from "./apply_plan_b";
import { AI_ALLOCATION_LIVE_MUTATION_ENABLED, buildPlanBAdvisory } from "./authority";
import {
	finalizeAiRunWithWritebackGate,
	maybeApplyAiWritebackOnDailyPlan,
	type WritebackHost,
} from "./index";
import { emptyDailyPersist, upsertDailyRecord } from "../../learning/pv_bias/daily_persist";

const T1 = "2026-08-08T10:00:00.000Z";
const T2 = "2026-08-08T10:15:00.000Z";

function allocation(
	overrides: Partial<DailyAllocationEntry> & { contributionId: string; slotStart: string },
): DailyAllocationEntry {
	const { slotStart, ...rest } = overrides;
	return {
		contributor: { type: "addon", id: "immersion_heater", addonId: "immersion_heater" },
		slot: { startIso: slotStart, endIso: slotStart },
		status: "allocated",
		energySource: "grid",
		requestedPowerW: rest.allocatedPowerW ?? 0,
		allocatedPowerW: rest.allocatedPowerW ?? 0,
		requestedEnergyKwh: null,
		allocatedEnergyKwh: null,
		gridPowerW: rest.gridPowerW ?? rest.allocatedPowerW ?? 0,
		pvPowerW: rest.pvPowerW ?? 0,
		mandatory: false,
		priorityRank: 1,
		deadlineIso: null,
		estimatedCostCt: null,
		reasonDe: "",
		...rest,
	};
}

function slot(overrides: Partial<DailyPlanSlot> & { startIso: string }): DailyPlanSlot {
	const allocations = overrides.allocations ?? [];
	return {
		slot: { startIso: overrides.startIso, endIso: overrides.startIso },
		pvForecastPowerW: null,
		fixedHouseLoadPowerW: null,
		fixedBalancePowerW: null,
		gridPriceCtPerKwh: overrides.gridPriceCtPerKwh ?? 30,
		gridImportAllowed: true,
		configuredGridImportLimitW: 30000,
		remainingGridImportPowerW: 20000,
		availablePvSurplusPowerW: overrides.availablePvSurplusPowerW ?? 0,
		allocatedFlexiblePowerW: 0,
		allocatedPvPowerW: overrides.allocatedPvPowerW ?? 0,
		allocatedGridPowerW: overrides.allocatedGridPowerW ?? 0,
		allocatedBatteryPowerW: 0,
		remainingPvSurplusPowerW: overrides.remainingPvSurplusPowerW ?? 0,
		remainingGridImportPowerWAfterAlloc: overrides.remainingGridImportPowerWAfterAlloc ?? 20000,
		remainingBatteryDischargePowerW: null,
		allocations,
		quality: { status: "valid", confidencePct: 100, reasonDe: "" },
		reasonDe: "",
		...overrides,
	};
}

function plan(slots: DailyPlanSlot[]): DailyPlan {
	return {
		generatedAt: "2026-08-08T09:00:00.000Z",
		validUntil: null,
		revision: 1,
		date: "2026-08-08",
		timezone: "UTC",
		slotMinutes: 15,
		globalMode: "balanced",
		status: "ready",
		policySnapshot: {},
		constraintSnapshot: {},
		activeContributionIds: ["immersion_heater.flexible", "battery.charge", "wallbox.ev_session"],
		excludedContributions: [],
		slots,
		allocations: slots.flatMap((s) => s.allocations),
		unallocated: [],
		totals: {
			pvForecastEnergyKwh: null,
			fixedHouseLoadEnergyKwh: null,
			fixedRenewableBalanceKwh: null,
			flexibleRequestedEnergyKwh: 1,
			flexibleAllocatedEnergyKwh: 1,
			flexibleUnallocatedEnergyKwh: 0,
			pvAllocatedEnergyKwh: 0,
			gridAllocatedEnergyKwh: 1,
			batteryChargeEnergyKwh: 0,
			wallboxEnergyKwh: 0,
			immersionHeaterEnergyKwh: 1,
			airConditioningEnergyKwh: 0,
			estimatedGridCostCt: 40,
			mandatoryRequestedEnergyKwh: null,
			mandatoryAllocatedEnergyKwh: 0,
			mandatoryUnallocatedEnergyKwh: null,
		},
		quality: { status: "valid", confidencePct: 100, reasonDe: "" },
		reasonDe: "Plan A",
	};
}

function expensiveCheapPair(
	contribId: string,
	powerW: number,
	contributor: DailyAllocationEntry["contributor"],
): DailyPlan {
	return plan([
		slot({
			startIso: T1,
			gridPriceCtPerKwh: 40,
			allocatedGridPowerW: powerW,
			remainingGridImportPowerWAfterAlloc: 5000,
			allocations: [
				allocation({
					contributionId: contribId,
					slotStart: T1,
					allocatedPowerW: powerW,
					gridPowerW: powerW,
					contributor,
					deadlineIso: contribId.startsWith("wallbox") ? "2026-08-09T06:00:00.000Z" : null,
				}),
			],
		}),
		slot({
			startIso: T2,
			gridPriceCtPerKwh: 10,
			availablePvSurplusPowerW: 4000,
			remainingPvSurplusPowerW: 4000,
			remainingGridImportPowerWAfterAlloc: 5000,
		}),
	]);
}

function mockHost(prefs: AiSlotPreference[]): WritebackHost & {
	states: Map<string, unknown>;
	republishHits: number;
} {
	const states = new Map<string, unknown>([
		[AI_STATES.lastSlotPreferencesJson, JSON.stringify(prefs)],
		[AI_STATES.lastDecisionsJson, "[]"],
		[AI_STATES.autoSuspended, false],
	]);
	const host = {
		states,
		republishHits: 0,
		config: {
			immersion_heater_enabled: true,
			immersion_heater_ai_optimization_allowed: true,
			air_conditioning_enabled: true,
			air_conditioning_ai_optimization_allowed: true,
			battery_enabled: true,
			battery_ai_optimization_allowed: true,
			wallbox_enabled: true,
			wallbox_ai_optimization_allowed: true,
		},
		async getStateAsync(id: string): Promise<ioBroker.State | null | undefined> {
			if (!states.has(id)) return null;
			return {
				val: states.get(id),
				ack: true,
				ts: Date.now(),
				lc: Date.now(),
				from: "test",
			} as ioBroker.State;
		},
		async setStateAsync(id: string, state: ioBroker.SettableState): Promise<unknown> {
			const val =
				state && typeof state === "object" && "val" in (state as object)
					? (state as { val: unknown }).val
					: state;
			states.set(id, val);
			if (
				id.includes("allocations_json") ||
				id.includes("daily_plan.plan_json") ||
				id.includes("allocation.battery") ||
				id.includes("allocation.wallbox")
			) {
				host.republishHits += 1;
			}
			return undefined;
		},
		log: { warn: () => {} },
	};
	return host;
}

describe("AI Authority Boundary (beta)", () => {
	it("gate flag disables live allocation mutation", () => {
		assert.equal(AI_ALLOCATION_LIVE_MUTATION_ENABLED, false);
	});
});

describe("AI-AUTH-001 battery slice not mutated by AI gate", () => {
	it("Plan-B-preferred battery prefs do not change authoritative battery.charge", async () => {
		const p = expensiveCheapPair("battery.charge", 1000, {
			type: "addon",
			id: "battery",
			addonId: "battery",
		});
		const prefs: AiSlotPreference[] = [
			{ addonId: "battery", slotStartIso: T1, weight: 0.1 },
			{ addonId: "battery", slotStartIso: T2, weight: 3 },
		];
		const sim = applyAiPreferencesToDailyPlan(p, ["battery"], prefs);
		assert.equal(sim.compare.delta.activePlan, "b");

		const host = mockHost(prefs);
		const before = JSON.stringify(p.allocations);
		const out = await maybeApplyAiWritebackOnDailyPlan(host, p);
		assert.equal(JSON.stringify(out.allocations), before);
		const bat1 = out.slots[0]!.allocations.find((a) => a.contributionId === "battery.charge");
		assert.equal(bat1?.allocatedPowerW, 1000);
		assert.equal(out.reasonDe.includes("KI Plan B aktiv"), false);

		const fin = await finalizeAiRunWithWritebackGate(host, p, prefs, { skipAutoSuspend: true });
		assert.equal(fin.writebackApplied, false);
		assert.equal(fin.planBPreferred, true);
		assert.equal(fin.advisory.mutatesAllocations, false);
		assert.equal(host.republishHits, 0);
	});
});

describe("AI-AUTH-002 wallbox window stays unified-authoritative", () => {
	it("EV window prefs do not mutate wallbox.ev_session via gate", async () => {
		const p = expensiveCheapPair("wallbox.ev_session", 3000, {
			type: "addon",
			id: "wallbox",
			addonId: "wallbox",
		});
		const prefs: AiSlotPreference[] = [
			{ addonId: "wallbox", slotStartIso: T1, weight: 0.1 },
			{ addonId: "wallbox", slotStartIso: T2, weight: 3 },
		];
		assert.equal(applyAiPreferencesToDailyPlan(p, ["wallbox"], prefs).compare.delta.activePlan, "b");
		const out = await maybeApplyAiWritebackOnDailyPlan(mockHost(prefs), p);
		const wb1 = out.slots[0]!.allocations.find((a) => a.contributionId === "wallbox.ev_session");
		const wb2 = out.slots[1]!.allocations.find((a) => a.contributionId === "wallbox.ev_session");
		assert.equal(wb1?.allocatedPowerW, 3000);
		assert.equal(wb2?.allocatedPowerW ?? 0, 0);
	});
});

describe("AI-AUTH-003 IH/AC windows no direct mutation", () => {
	it("IH prefs do not mutate immersion allocations via gate", async () => {
		const p = expensiveCheapPair("immersion_heater.flexible", 2000, {
			type: "addon",
			id: "immersion_heater",
			addonId: "immersion_heater",
		});
		const prefs: AiSlotPreference[] = [
			{ addonId: "immersion_heater", slotStartIso: T1, weight: 0.1 },
			{ addonId: "immersion_heater", slotStartIso: T2, weight: 3 },
		];
		assert.equal(
			applyAiPreferencesToDailyPlan(p, ["immersion_heater"], prefs).compare.delta.activePlan,
			"b",
		);
		const out = await maybeApplyAiWritebackOnDailyPlan(mockHost(prefs), p);
		const ih1 = out.slots[0]!.allocations.find((a) => a.contributionId.startsWith("immersion_heater"));
		const ih2 = out.slots[1]!.allocations.find((a) => a.contributionId.startsWith("immersion_heater"));
		assert.equal(ih1?.allocatedPowerW, 2000);
		assert.equal(ih2?.allocatedPowerW ?? 0, 0);
	});
});

describe("AI-AUTH-004 advisory recommendation available", () => {
	it("Plan B advisory remains without authority change", async () => {
		const p = expensiveCheapPair("immersion_heater.flexible", 2000, {
			type: "addon",
			id: "immersion_heater",
			addonId: "immersion_heater",
		});
		const prefs: AiSlotPreference[] = [
			{ addonId: "immersion_heater", slotStartIso: T1, weight: 0.1 },
			{ addonId: "immersion_heater", slotStartIso: T2, weight: 3 },
		];
		const host = mockHost(prefs);
		const before = JSON.stringify(p);
		const fin = await finalizeAiRunWithWritebackGate(host, p, prefs, { skipAutoSuspend: true });
		assert.equal(fin.writebackApplied, false);
		assert.equal(fin.planBPreferred, true);
		assert.ok(fin.advisory);
		assert.equal(fin.advisory.mutatesLiveSlices, false);
		assert.match(fin.advisory.decisionReasonDe, /advisory/i);
		assert.equal(JSON.stringify(p), before);
		const advisory = buildPlanBAdvisory(fin.compare);
		assert.equal(advisory.planBPreferred, true);
		assert.equal(host.states.get(COMPARE_STATES.activePlan), "b");
	});
});

describe("AI-AUTH-005 AI unavailable", () => {
	it("empty prefs → plan unchanged, no mutation", async () => {
		const p = expensiveCheapPair("battery.charge", 1000, {
			type: "addon",
			id: "battery",
			addonId: "battery",
		});
		const before = JSON.stringify(p.allocations);
		const out = await maybeApplyAiWritebackOnDailyPlan(mockHost([]), p);
		assert.equal(JSON.stringify(out.allocations), before);
		const fin = await finalizeAiRunWithWritebackGate(mockHost([]), p, [], { skipAutoSuspend: true });
		assert.equal(fin.writebackApplied, false);
		assert.equal(fin.planBPreferred, false);
		assert.equal(fin.suspended, false);
	});
});

describe("AI-AUTH-006 Learning → Unified input still active", () => {
	it("PV bias daily upsert from evaluation path remains writable", () => {
		const persist = emptyDailyPersist();
		const next = upsertDailyRecord(persist, {
			date: "2026-08-07",
			actualKwh: 12,
			actualCapturedAt: "2026-08-07T22:00:00.000Z",
			forecastKwh: 18,
			forecastCapturedAt: "2026-08-07T06:00:00.000Z",
			actualSource: "day_evaluation",
			forecastSource: "day_evaluation_initial_plan",
		});
		assert.equal(next.days["2026-08-07"]?.forecastKwh, 18);
		assert.equal(next.days["2026-08-07"]?.actualKwh, 12);
		assert.notEqual(next.days["2026-08-07"]?.forecastKwh, next.days["2026-08-07"]?.actualKwh);
		assert.equal(AI_ALLOCATION_LIVE_MUTATION_ENABLED, false);
	});
});
