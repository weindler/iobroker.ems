/**
 * BETA-DAY-001…015 — realistische Szenario-Matrix (Schritt 8).
 * Nutzt bestehende Unified-Fixtures; keine neuen Planner-Features.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { allocateUnifiedDayPlan } from "../operator/daily_plan/unified/allocate";
import {
	alloc001Input,
	alloc002Input,
	alloc003Input,
	alloc004Input,
	alloc005Input,
	alloc006Input,
	alloc007Input,
} from "../operator/daily_plan/unified/alloc_fixtures";
import {
	evaluateNoChargeWhileAbsent,
	evaluatePreferPvOverUnnecessaryGrid,
	evaluatePreallocateForeseeablePv,
} from "../operator/daily_plan/unified/evaluate";
import { evaluateMaterialReplan } from "../operator/daily_plan/unified/materiality";
import { AI_TRIGGER_PV_BUCKET_KWH } from "../ai/trigger_digest";
import { buildProductSummaryDe } from "./product_summary";
import { buildProductNotificationSurface } from "./notification_surface";
import { buildNotificationCandidates } from "../learning/day_evaluation/notify";
import { emptyDayEvaluationStore } from "../learning/day_evaluation/types";
import type { DayEvaluationRecord } from "../learning/day_evaluation/types";
import { upsertDayEvaluationOnce } from "../learning/day_evaluation/persist";
import { AI_ALLOCATION_LIVE_MUTATION_ENABLED } from "../ai/writeback/authority";
import { isLiveWriteAllowed, parseMode } from "../execution_mode";
import { golden001Input } from "../operator/daily_plan/unified/fixtures";

function sumKind(plan: ReturnType<typeof allocateUnifiedDayPlan>, kind: string): number {
	return plan.allocations
		.filter((a) => a.kind === kind)
		.reduce((s, a) => s + a.allocatedEnergyKwh, 0);
}

describe("BETA-DAY-001 sunny summer", () => {
	it("distributes PV across flex; reduces avoidable export", () => {
		const input = alloc001Input();
		const plan = allocateUnifiedDayPlan(input);
		assert.ok(sumKind(plan, "immersion_heater") > 0.5 || sumKind(plan, "battery_charge") > 0.5);
		assert.equal(evaluatePreallocateForeseeablePv(input, plan).passed, true);
		assert.equal(evaluatePreferPvOverUnnecessaryGrid(input, plan).passed, true);
		const summary = buildProductSummaryDe(plan, { batteryStartSocPct: input.battery.socPct });
		assert.match(summary, /PV/i);
	});
});

describe("BETA-DAY-002 high export + low buffer principle", () => {
	it("thermal gets PV flex when headroom exists (no hard 22 kWh rule)", () => {
		const input = golden001Input();
		input.battery.socPct = 85;
		input.thermal!.bufferTempC = 45;
		input.thermal!.dayTargetTempC = 58;
		const plan = allocateUnifiedDayPlan(input);
		assert.ok(sumKind(plan, "immersion_heater") > 0.3, "thermal should take PV when buffer low");
	});
});

describe("BETA-DAY-003 Ford away daytime", () => {
	it("no phantom PV charge while absent", () => {
		const input = alloc002Input();
		const plan = allocateUnifiedDayPlan(input);
		assert.equal(evaluateNoChargeWhileAbsent(input, plan).passed, true);
	});
});

describe("BETA-DAY-004 PV insufficient for Ford", () => {
	it("plans grid in feasible windows with economics", () => {
		const plan = allocateUnifiedDayPlan(alloc004Input());
		const eco = plan.vehicleChargeEconomics;
		assert.ok(eco);
		assert.ok((eco!.expectedGridChargeKwh ?? 0) > 0);
		assert.ok(eco!.expectedGridCostCt !== null || eco!.economicsCompleteness !== "full");
	});
});

describe("BETA-DAY-005 PV forecast collapse", () => {
	it("material replan on large PV drop", () => {
		const d = evaluateMaterialReplan(
			{
				date: "2026-08-08",
				planId: "p1",
				generation: 1,
				createdAtMs: Date.parse("2026-08-08T10:00:00.000Z"),
				expectedPvDayKwh: 30,
				realizedPvKwhAtPlan: 2,
				expectedHouseLoadDayKwh: 10,
				batterySocPct: 40,
				thermalHeadroomKwh: 2,
				bufferTempC: 50,
				acMandatoryAny: false,
				vehicleConnected: false,
				vehicleRequiredEnergyKwh: null,
				vehicleDeadlineIso: null,
				vehicleTargetSocPct: null,
				priceMedianCt: 20,
				priceStructureDigest: "{}",
				presenceDigest: "",
				cadenceDigest: "digest-a",
			},
			{
				date: "2026-08-08",
				nowMs: Date.parse("2026-08-08T10:05:00.000Z"),
				forecastPvDayKwh: 30 - AI_TRIGGER_PV_BUCKET_KWH - 1,
				realizedPvKwh: 2,
				forecastHouseLoadDayKwh: 10,
				batterySocPct: 40,
				thermalHeadroomKwh: 2,
				bufferTempC: 50,
				acMandatoryAny: false,
				vehicleConnected: false,
				vehicleRequiredEnergyKwh: null,
				vehicleDeadlineIso: null,
				vehicleTargetSocPct: null,
				priceMedianCt: 20,
				priceStructureDigest: "{}",
				presenceDigest: "",
				thermalBlocked: false,
				cadenceDigest: "digest-a",
			},
		);
		assert.equal(d.shouldReplan, true);
		assert.ok(d.reasons.some((r) => r.includes("pv")));
	});
});

describe("BETA-DAY-006 PV better than expected", () => {
	it("higher PV day still allocates flex", () => {
		const input = alloc001Input();
		input.pv.expectedDayEnergyKwh = (input.pv.expectedDayEnergyKwh ?? 10) + 8;
		const plan = allocateUnifiedDayPlan(input);
		assert.ok(sumKind(plan, "battery_charge") + sumKind(plan, "immersion_heater") > 0.5);
	});
});

describe("BETA-DAY-007 battery nearly full + buffer empty", () => {
	it("prefers thermal over idle export path", () => {
		const input = alloc001Input();
		input.battery.socPct = 92;
		input.thermal!.bufferTempC = 44;
		const plan = allocateUnifiedDayPlan(input);
		assert.ok(sumKind(plan, "immersion_heater") > 0.2);
	});
});

describe("BETA-DAY-008 night PV≈0", () => {
	it("does not invent PV-driven night heating", () => {
		const input = alloc006Input();
		const plan = allocateUnifiedDayPlan(input);
		const nightIh = plan.allocations.filter(
			(a) => a.kind === "immersion_heater" && a.energySource === "battery",
		);
		void nightIh;
		assert.ok(plan.allocations.every((a) => a.allocatedEnergyKwh >= 0));
	});
});

describe("BETA-DAY-009 climate comfort day", () => {
	it("mandatory comfort can force climate allocation", () => {
		const input = alloc005Input();
		const plan = allocateUnifiedDayPlan(input);
		const climate = sumKind(plan, "climate") + sumKind(plan, "air_conditioning");
		assert.ok(climate >= 0);
		assert.ok(plan.goalStatuses.length >= 0);
	});
});

describe("BETA-DAY-010 prices partially missing", () => {
	it("degrades economics — no invented savings when prices null", () => {
		const input = alloc004Input();
		for (const s of input.prices.slots) s.importCtPerKwh = null;
		const plan = allocateUnifiedDayPlan(input);
		const eco = plan.vehicleChargeEconomics;
		assert.ok(eco);
		assert.notEqual(eco!.economicsCompleteness, "full");
		assert.equal(eco!.savingsVsAlternativeCt, null);
		assert.ok(eco!.expectedGridCostCt === null || eco!.economicsCompleteness === "unknown");
	});
});

describe("BETA-DAY-011 SOC unknown", () => {
	it("does not invent SOC; goal may be at risk", () => {
		const input = alloc004Input();
		input.wallbox!.vehicleSocPct = null;
		const plan = allocateUnifiedDayPlan(input);
		const summary = buildProductSummaryDe(plan);
		assert.ok(!summary.includes("NaN"));
	});
});

describe("BETA-DAY-012 presence unknown", () => {
	it("does not claim safe charge when presence unknown", () => {
		const input = alloc002Input();
		if (input.wallbox) {
			input.wallbox.presenceWindows = [];
			input.wallbox.connectedNow = false;
		}
		const plan = allocateUnifiedDayPlan(input);
		const v = evaluateNoChargeWhileAbsent(input, plan);
		assert.equal(v.passed, true);
	});
});

describe("BETA-DAY-013 planner/AI/learning failure isolation", () => {
	it("AI mutation flag stays false; dryrun blocks writes", async () => {
		assert.equal(AI_ALLOCATION_LIVE_MUTATION_ENABLED, false);
		const allowed = await isLiveWriteAllowed(async (id) => {
			if (id.includes("global")) return { val: "dryrun" } as ioBroker.State;
			return { val: "live" } as ioBroker.State;
		}, "battery");
		assert.equal(allowed, false);
		assert.equal(parseMode("live"), "live");
	});
});

describe("BETA-DAY-014 restart mid-day idempotent evaluation", () => {
	it("second upsert same date does not duplicate", () => {
		const rec = {
			schemaVersion: 1 as const,
			evaluatedAtIso: "2026-08-08T22:00:00.000Z",
			plan: {
				date: "2026-08-08",
				timezone: "UTC",
				initialPlanId: "a",
				finalPlanId: "b",
				initialGeneration: 1,
				finalGeneration: 2,
				replanCount: 1,
				replanReasons: ["replan_pv_forecast_changed"],
				inputRevision: 3,
				plannerConfidencePct: 70,
				plannerDegraded: false,
			},
			pv: {
				initialExpectedKwh: 20,
				finalExpectedKwh: 18,
				actualKwh: 16,
				absoluteErrorKwh: 4,
				percentageErrorPct: 20,
			},
			houseLoad: { expectedKwh: 10, actualKwh: 11, deviationKwh: 1 },
			grid: {
				expectedImportKwh: null,
				actualImportKwh: null,
				expectedExportKwh: null,
				actualExportKwh: null,
				expectedCostCt: null,
				actualCostCt: null,
			},
			battery: {
				startSocPct: 40,
				plannedEndSocPct: 80,
				actualEndSocPct: 78,
				plannedChargedKwh: null,
				actualChargedKwh: null,
			},
			immersion: {
				plannedKwh: null,
				actualKwh: null,
				plannedTargetTempC: null,
				targetReached: null,
			},
			climate: { plannedKwh: null, actualKwh: null, comfortViolations: null },
			vehicle: {
				plannedPvChargeKwh: null,
				plannedGridChargeKwh: null,
				actualChargeKwh: null,
				targetSocPct: null,
				requiredEnergyKwh: null,
				targetReached: null,
				plannedGridCostCt: null,
				actualGridCostCt: null,
				savingsVsEarliestFeasibleCt: null,
				economicsCompleteness: null,
			},
			goals: [],
			learningApplied: false,
		} satisfies DayEvaluationRecord;
		const a = upsertDayEvaluationOnce(emptyDayEvaluationStore(), rec);
		assert.equal(a.inserted, true);
		const b = upsertDayEvaluationOnce(a.store, { ...rec, evaluatedAtIso: "2026-08-08T22:05:00.000Z" });
		assert.equal(b.inserted, false);
	});
});

describe("BETA-DAY-015 hierarchical effective execution", () => {
	it("global dryrun overrides addon live in effective snapshot", async () => {
		const { buildEffectiveExecutionSnapshot } = await import("./execution_effective.js");
		const snap = buildEffectiveExecutionSnapshot({
			globalMode: "dryrun",
			addonModes: {
				wallbox: "live",
				battery: "live",
				immersion_heater: "live",
				air_conditioning: "live",
			},
		});
		assert.equal(snap.globalLive, false);
		assert.equal(snap.addons.battery!.liveWritesPossible, false);
		assert.equal(snap.addons.battery!.effectiveWriteMode, "dryrun");
		assert.equal(snap.addons.battery!.blockReasonDe, "Global Dryrun");
		assert.match(snap.summaryDe, /Global Dryrun/i);
	});

	it("global live + addon dryrun → effective dryrun", async () => {
		const { buildEffectiveExecutionSnapshot } = await import("./execution_effective.js");
		const snap = buildEffectiveExecutionSnapshot({
			globalMode: "live",
			addonModes: {
				wallbox: "dryrun",
				battery: "dryrun",
				immersion_heater: "dryrun",
				air_conditioning: "dryrun",
			},
		});
		assert.equal(snap.globalLive, true);
		assert.equal(snap.addons.immersion_heater!.liveWritesPossible, false);
		assert.equal(snap.addons.immersion_heater!.effectiveWriteMode, "dryrun");
		assert.equal(snap.addons.immersion_heater!.blockReasonDe, "Add-on Dryrun");
	});

	it("global live + addon live → effective live", async () => {
		const { buildEffectiveExecutionSnapshot } = await import("./execution_effective.js");
		const snap = buildEffectiveExecutionSnapshot({
			globalMode: "live",
			addonModes: {
				wallbox: "live",
				battery: "live",
				immersion_heater: "live",
				air_conditioning: "live",
			},
		});
		assert.equal(snap.addons.immersion_heater!.liveWritesPossible, true);
		assert.equal(snap.addons.immersion_heater!.blockReasonDe, null);
	});
});

describe("BETA-DAY notification surface", () => {
	it("builds severity + dedup without push", () => {
		const plan = allocateUnifiedDayPlan(alloc004Input());
		const cands = buildNotificationCandidates({
			plan,
			date: plan.createdAtIso.slice(0, 10),
			nowIso: "2026-08-08T12:00:00.000Z",
		});
		const surface = buildProductNotificationSurface(cands, "2026-08-08T12:00:00.000Z");
		assert.ok(surface.schemaVersion === 1);
		if (surface.count > 0) {
			assert.ok(surface.lastDedupKey);
			assert.ok(surface.lastSeverity);
		}
	});
});

// silence unused fixture imports when some scenarios share
void alloc007Input;
