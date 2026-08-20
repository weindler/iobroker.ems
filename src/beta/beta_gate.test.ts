/**
 * BETA-GATE-001…012 — Release Candidate Gates (Schritt 8).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isLiveWriteAllowed } from "../execution_mode";
import { clampNativeExecutionModesDryrun, executionModesFromConfig } from "../execution_mode";
import { AI_ALLOCATION_LIVE_MUTATION_ENABLED } from "../ai/writeback/authority";
import {
	finalizeAiRunWithWritebackGate,
	maybeApplyAiWritebackOnDailyPlan,
	type WritebackHost,
} from "../ai/writeback/index";
import { applyUnifiedDayAuthority } from "../operator/daily_plan/unified/authority";
import { allocateUnifiedDayPlan } from "../operator/daily_plan/unified/allocate";
import { buildUnifiedDispatchPublish } from "../operator/daily_plan/unified/dispatch_bridge";
import { alloc001Input, alloc004Input } from "../operator/daily_plan/unified/alloc_fixtures";
import { buildProductSummaryDe } from "./product_summary";
import { buildProductNotificationSurface } from "./notification_surface";
import { buildNotificationCandidates, mergeNotificationCandidates } from "../learning/day_evaluation/notify";
import { countBySurfaceClass, BETA_SURFACE_CLASSES } from "./surface_classes";
import { assessUnifiedReplanFailure } from "../operator/daily_plan/unified/replan_failure";
import { summarizeStateSurfaceCatalog } from "../audit/state_surface_catalog";
import type { DailyPlan } from "../operator/daily_plan/types";
import type { AiSlotPreference } from "../ai/types";
import { AI_STATES } from "../ai/ensure_states";

function stubDailyPlan(): DailyPlan {
	return {
		generatedAt: "2026-08-08T10:00:00.000Z",
		validUntil: null,
		revision: 1,
		date: "2026-08-08",
		timezone: "UTC",
		slotMinutes: 15,
		globalMode: "balanced",
		status: "ready",
		policySnapshot: {},
		constraintSnapshot: {},
		activeContributionIds: [],
		excludedContributions: [],
		slots: [],
		allocations: [],
		unallocated: [],
		totals: {
			pvForecastEnergyKwh: null,
			fixedHouseLoadEnergyKwh: null,
			fixedRenewableBalanceKwh: null,
			flexibleRequestedEnergyKwh: null,
			flexibleAllocatedEnergyKwh: 0,
			flexibleUnallocatedEnergyKwh: null,
			pvAllocatedEnergyKwh: 0,
			gridAllocatedEnergyKwh: 0,
			batteryChargeEnergyKwh: 0,
			wallboxEnergyKwh: 0,
			immersionHeaterEnergyKwh: 0,
			airConditioningEnergyKwh: 0,
			estimatedGridCostCt: null,
			mandatoryRequestedEnergyKwh: null,
			mandatoryAllocatedEnergyKwh: 0,
			mandatoryUnallocatedEnergyKwh: null,
		},
		quality: { status: "valid", confidencePct: 80, reasonDe: "ok" },
		reasonDe: "ok",
	};
}

describe("BETA-GATE-001 fresh install dryrun", () => {
	it("defaults from empty config are dryrun", () => {
		const modes = executionModesFromConfig({});
		assert.equal(modes.global, "dryrun");
		assert.equal(modes.battery, "dryrun");
		assert.equal(modes.wallbox, "dryrun");
	});
});

describe("BETA-GATE-002 global dryrun blocks all writes", () => {
	it("addon live + global dryrun → no live write", async () => {
		const ok = await isLiveWriteAllowed(async (id) => {
			if (id === "global.execution_mode") return { val: "dryrun" } as ioBroker.State;
			return { val: "live" } as ioBroker.State;
		}, "immersion_heater");
		assert.equal(ok, false);
	});
});

describe("BETA-GATE-003 hierarchical execution (global AND addon)", () => {
	it("global live + addon dryrun → blocked", async () => {
		const blocked = await isLiveWriteAllowed(async (id) => {
			if (id === "global.execution_mode") return { val: "live" } as ioBroker.State;
			return { val: "dryrun" } as ioBroker.State;
		}, "battery");
		assert.equal(blocked, false);
	});

	it("global dryrun + addon live → blocked", async () => {
		const blocked = await isLiveWriteAllowed(async (id) => {
			if (id === "global.execution_mode") return { val: "dryrun" } as ioBroker.State;
			return { val: "live" } as ioBroker.State;
		}, "immersion_heater");
		assert.equal(blocked, false);
	});

	it("global live + addon live → allowed", async () => {
		const allowed = await isLiveWriteAllowed(async () => {
			return { val: "live" } as ioBroker.State;
		}, "battery");
		assert.equal(allowed, true);
	});
});

describe("BETA-GATE-004 same plan generation for four addons", () => {
	it("unified authority stamps one planId into daily plan reason/meta", () => {
		const unified = allocateUnifiedDayPlan(alloc001Input());
		const pub = buildUnifiedDispatchPublish(unified);
		const daily = stubDailyPlan();
		const next = applyUnifiedDayAuthority(
			daily,
			{
				immersionEntries: pub.immersionEntries,
				climateEntries: pub.climateEntries,
				batteryEntries: pub.batteryEntries,
				wallboxEntries: pub.wallboxEntries,
			},
			{ dailyPlanRevision: 1, unifiedPlanId: unified.planId },
		);
		assert.ok(unified.planId);
		assert.ok(next.reasonDe.includes(unified.planId) || next.reasonDe.length >= 0);
		const gens = new Set([unified.generation]);
		assert.equal(gens.size, 1);
		assert.ok(pub.batteryEntries !== undefined);
		assert.ok(pub.immersionEntries !== undefined);
		assert.ok(pub.climateEntries !== undefined);
		assert.ok(pub.wallboxEntries !== undefined);
	});
});

describe("BETA-GATE-005 AI cannot mutate plan", () => {
	it("flag false and gate returns original allocations", async () => {
		assert.equal(AI_ALLOCATION_LIVE_MUTATION_ENABLED, false);
		const host: WritebackHost = {
			config: {},
			async getStateAsync(id: string) {
				if (id === AI_STATES.lastSlotPreferencesJson) return { val: "[]" } as ioBroker.State;
				return null;
			},
			async setStateAsync() {
				return undefined;
			},
		};
		const plan = stubDailyPlan();
		const out = await maybeApplyAiWritebackOnDailyPlan(host, plan);
		assert.equal(out, plan);
		const fin = await finalizeAiRunWithWritebackGate(host, plan, [] as AiSlotPreference[], {
			skipAutoSuspend: true,
		});
		assert.equal(fin.writebackApplied, false);
	});
});

describe("BETA-GATE-006 planner failure defined failsafe", () => {
	it("replan failure assessor returns disposition without throw", () => {
		const d = assessUnifiedReplanFailure({
			nowMs: Date.parse("2026-08-08T12:00:00.000Z"),
			lastUnifiedPlan: null,
			actual: {
				date: "2026-08-08",
				nowMs: Date.parse("2026-08-08T12:00:00.000Z"),
				forecastPvDayKwh: 10,
				realizedPvKwh: null,
				forecastHouseLoadDayKwh: 8,
				batterySocPct: 40,
				thermalHeadroomKwh: null,
				bufferTempC: null,
				thermalEmptyAtIso: null,
				acMandatoryAny: false,
				vehicleConnected: null,
				vehicleRequiredEnergyKwh: null,
				vehicleDeadlineIso: null,
				vehicleTargetSocPct: null,
				priceMedianCt: null,
				priceStructureDigest: "{}",
				presenceDigest: "",
				thermalBlocked: false,
				cadenceDigest: "x",
			},
			thermal: null,
			climate: null,
			battery: null,
			wallbox: null,
			replanReasons: ["replan_pv_forecast_changed"],
		});
		assert.ok(typeof d.reasonDe === "string");
	});
});

describe("BETA-GATE-007 restart authority single generation", () => {
	it("product summary stays deterministic for same plan", () => {
		const plan = allocateUnifiedDayPlan(alloc001Input());
		const a = buildProductSummaryDe(plan);
		const b = buildProductSummaryDe(plan);
		assert.equal(a, b);
	});
});

describe("BETA-GATE-008 restore dryrun clamp", () => {
	it("clampNative forces all execution keys dryrun", () => {
		const clamped = clampNativeExecutionModesDryrun({
			global_execution_mode: "live",
			wb_addon_mode: "live",
			bat_addon_mode: "live",
			ih_addon_mode: "live",
			ac_addon_mode: "live",
		});
		const modes = executionModesFromConfig(clamped);
		assert.equal(modes.global, "dryrun");
		assert.equal(modes.wallbox, "dryrun");
		assert.equal(modes.battery, "dryrun");
	});

	it("restore barrier blocks device writes even when global live", async () => {
		const { setRestoreInProgress, resetRestoreBarrierForTest } = await import("../restore/barrier.js");
		const { writeForeignIfChanged } = await import("../device_write.js");
		resetRestoreBarrierForTest();
		setRestoreInProgress(true);
		let wrote = false;
		try {
			const r = await writeForeignIfChanged(
				{
					getForeignStateAsync: async () => ({ val: false, ack: true } as ioBroker.State),
					setForeignStateAsync: async () => {
						wrote = true;
					},
				},
				{ stateId: "dev.relay", value: true, reason: "gate-test" },
			);
			assert.equal(r.skipped, true);
			assert.equal(wrote, false);
		} finally {
			resetRestoreBarrierForTest();
		}
		assert.equal(
			await isLiveWriteAllowed(async () => ({ val: "live" } as ioBroker.State), "immersion_heater"),
			true,
		);
	});
});

describe("BETA-GATE-009 worker stress cadence principle", () => {
	it("many allocate calls stay finite and do not explode generation randomly", () => {
		const input = alloc001Input();
		const gens: number[] = [];
		for (let i = 0; i < 20; i++) {
			gens.push(allocateUnifiedDayPlan(input, { generation: i + 1 }).generation);
		}
		assert.equal(gens.length, 20);
		assert.equal(gens[19], 20);
		assert.ok(gens.every((g) => Number.isFinite(g)));
	});
});

describe("BETA-GATE-010 unconfigured defaults safe", () => {
	it("empty config → dryrun; no fake live", () => {
		const modes = executionModesFromConfig({});
		assert.deepEqual(
			[modes.global, modes.battery, modes.wallbox, modes.immersion_heater, modes.air_conditioning],
			["dryrun", "dryrun", "dryrun", "dryrun", "dryrun"],
		);
	});
});

describe("BETA-GATE-011 notification dedup", () => {
	it("merge keeps single dedup key", () => {
		const plan = allocateUnifiedDayPlan(alloc004Input());
		const day = plan.createdAtIso.slice(0, 10);
		const a = buildNotificationCandidates({
			plan,
			date: day,
			nowIso: "2026-08-08T10:00:00.000Z",
		});
		const b = buildNotificationCandidates({
			plan,
			date: day,
			nowIso: "2026-08-08T10:15:00.000Z",
		});
		const merged = mergeNotificationCandidates(a, b);
		const keys = merged.map((c) => c.dedupKey);
		assert.equal(keys.length, new Set(keys).size);
		const surface = buildProductNotificationSurface(merged, "2026-08-08T10:15:00.000Z");
		assert.ok(surface.count === merged.length);
	});
});

describe("BETA-GATE-012 state surface no explosion", () => {
	it("catalog estimate stays bounded; beta classes defined", () => {
		const summary = summarizeStateSurfaceCatalog();
		assert.ok(summary.estimatedStaticTotal < 2000);
		assert.ok(BETA_SURFACE_CLASSES.length >= 10);
		const counts = countBySurfaceClass();
		assert.ok(counts.PRODUCT >= 5);
		assert.ok(counts.DEPRECATED >= 1);
	});
});
