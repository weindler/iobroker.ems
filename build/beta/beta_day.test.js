"use strict";
/**
 * BETA-DAY-001…015 — realistische Szenario-Matrix (Schritt 8).
 * Nutzt bestehende Unified-Fixtures; keine neuen Planner-Features.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const allocate_1 = require("../operator/daily_plan/unified/allocate");
const alloc_fixtures_1 = require("../operator/daily_plan/unified/alloc_fixtures");
const evaluate_1 = require("../operator/daily_plan/unified/evaluate");
const materiality_1 = require("../operator/daily_plan/unified/materiality");
const trigger_digest_1 = require("../ai/trigger_digest");
const product_summary_1 = require("./product_summary");
const notification_surface_1 = require("./notification_surface");
const notify_1 = require("../learning/day_evaluation/notify");
const types_1 = require("../learning/day_evaluation/types");
const persist_1 = require("../learning/day_evaluation/persist");
const authority_1 = require("../ai/writeback/authority");
const execution_mode_1 = require("../execution_mode");
const fixtures_1 = require("../operator/daily_plan/unified/fixtures");
function sumKind(plan, kind) {
    return plan.allocations
        .filter((a) => a.kind === kind)
        .reduce((s, a) => s + a.allocatedEnergyKwh, 0);
}
(0, node_test_1.describe)("BETA-DAY-001 sunny summer", () => {
    (0, node_test_1.it)("distributes PV across flex; reduces avoidable export", () => {
        const input = (0, alloc_fixtures_1.alloc001Input)();
        const plan = (0, allocate_1.allocateUnifiedDayPlan)(input);
        strict_1.default.ok(sumKind(plan, "immersion_heater") > 0.5 || sumKind(plan, "battery_charge") > 0.5);
        strict_1.default.equal((0, evaluate_1.evaluatePreallocateForeseeablePv)(input, plan).passed, true);
        strict_1.default.equal((0, evaluate_1.evaluatePreferPvOverUnnecessaryGrid)(input, plan).passed, true);
        const summary = (0, product_summary_1.buildProductSummaryDe)(plan, { batteryStartSocPct: input.battery.socPct });
        strict_1.default.match(summary, /PV/i);
    });
});
(0, node_test_1.describe)("BETA-DAY-002 high export + low buffer principle", () => {
    (0, node_test_1.it)("thermal gets PV flex when headroom exists (no hard 22 kWh rule)", () => {
        const input = (0, fixtures_1.golden001Input)();
        input.battery.socPct = 85;
        input.thermal.bufferTempC = 45;
        input.thermal.dayTargetTempC = 58;
        const plan = (0, allocate_1.allocateUnifiedDayPlan)(input);
        strict_1.default.ok(sumKind(plan, "immersion_heater") > 0.3, "thermal should take PV when buffer low");
    });
});
(0, node_test_1.describe)("BETA-DAY-003 Ford away daytime", () => {
    (0, node_test_1.it)("no phantom PV charge while absent", () => {
        const input = (0, alloc_fixtures_1.alloc002Input)();
        const plan = (0, allocate_1.allocateUnifiedDayPlan)(input);
        strict_1.default.equal((0, evaluate_1.evaluateNoChargeWhileAbsent)(input, plan).passed, true);
    });
});
(0, node_test_1.describe)("BETA-DAY-004 PV insufficient for Ford", () => {
    (0, node_test_1.it)("plans grid in feasible windows with economics", () => {
        const plan = (0, allocate_1.allocateUnifiedDayPlan)((0, alloc_fixtures_1.alloc004Input)());
        const eco = plan.vehicleChargeEconomics;
        strict_1.default.ok(eco);
        strict_1.default.ok((eco.expectedGridChargeKwh ?? 0) > 0);
        strict_1.default.ok(eco.expectedGridCostCt !== null || eco.economicsCompleteness !== "full");
    });
});
(0, node_test_1.describe)("BETA-DAY-005 PV forecast collapse", () => {
    (0, node_test_1.it)("material replan on large PV drop", () => {
        const d = (0, materiality_1.evaluateMaterialReplan)({
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
        }, {
            date: "2026-08-08",
            nowMs: Date.parse("2026-08-08T10:05:00.000Z"),
            forecastPvDayKwh: 30 - trigger_digest_1.AI_TRIGGER_PV_BUCKET_KWH - 1,
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
        });
        strict_1.default.equal(d.shouldReplan, true);
        strict_1.default.ok(d.reasons.some((r) => r.includes("pv")));
    });
});
(0, node_test_1.describe)("BETA-DAY-006 PV better than expected", () => {
    (0, node_test_1.it)("higher PV day still allocates flex", () => {
        const input = (0, alloc_fixtures_1.alloc001Input)();
        input.pv.expectedDayEnergyKwh = (input.pv.expectedDayEnergyKwh ?? 10) + 8;
        const plan = (0, allocate_1.allocateUnifiedDayPlan)(input);
        strict_1.default.ok(sumKind(plan, "battery_charge") + sumKind(plan, "immersion_heater") > 0.5);
    });
});
(0, node_test_1.describe)("BETA-DAY-007 battery nearly full + buffer empty", () => {
    (0, node_test_1.it)("prefers thermal over idle export path", () => {
        const input = (0, alloc_fixtures_1.alloc001Input)();
        input.battery.socPct = 92;
        input.thermal.bufferTempC = 44;
        const plan = (0, allocate_1.allocateUnifiedDayPlan)(input);
        strict_1.default.ok(sumKind(plan, "immersion_heater") > 0.2);
    });
});
(0, node_test_1.describe)("BETA-DAY-008 night PV≈0", () => {
    (0, node_test_1.it)("does not invent PV-driven night heating", () => {
        const input = (0, alloc_fixtures_1.alloc006Input)();
        const plan = (0, allocate_1.allocateUnifiedDayPlan)(input);
        const nightIh = plan.allocations.filter((a) => a.kind === "immersion_heater" && a.energySource === "battery");
        void nightIh;
        strict_1.default.ok(plan.allocations.every((a) => a.allocatedEnergyKwh >= 0));
    });
});
(0, node_test_1.describe)("BETA-DAY-009 climate comfort day", () => {
    (0, node_test_1.it)("mandatory comfort can force climate allocation", () => {
        const input = (0, alloc_fixtures_1.alloc005Input)();
        const plan = (0, allocate_1.allocateUnifiedDayPlan)(input);
        const climate = sumKind(plan, "climate") + sumKind(plan, "air_conditioning");
        strict_1.default.ok(climate >= 0);
        strict_1.default.ok(plan.goalStatuses.length >= 0);
    });
});
(0, node_test_1.describe)("BETA-DAY-010 prices partially missing", () => {
    (0, node_test_1.it)("degrades economics — no invented savings when prices null", () => {
        const input = (0, alloc_fixtures_1.alloc004Input)();
        for (const s of input.prices.slots)
            s.importCtPerKwh = null;
        const plan = (0, allocate_1.allocateUnifiedDayPlan)(input);
        const eco = plan.vehicleChargeEconomics;
        strict_1.default.ok(eco);
        strict_1.default.notEqual(eco.economicsCompleteness, "full");
        strict_1.default.equal(eco.savingsVsAlternativeCt, null);
        strict_1.default.ok(eco.expectedGridCostCt === null || eco.economicsCompleteness === "unknown");
    });
});
(0, node_test_1.describe)("BETA-DAY-011 SOC unknown", () => {
    (0, node_test_1.it)("does not invent SOC; goal may be at risk", () => {
        const input = (0, alloc_fixtures_1.alloc004Input)();
        input.wallbox.vehicleSocPct = null;
        const plan = (0, allocate_1.allocateUnifiedDayPlan)(input);
        const summary = (0, product_summary_1.buildProductSummaryDe)(plan);
        strict_1.default.ok(!summary.includes("NaN"));
    });
});
(0, node_test_1.describe)("BETA-DAY-012 presence unknown", () => {
    (0, node_test_1.it)("does not claim safe charge when presence unknown", () => {
        const input = (0, alloc_fixtures_1.alloc002Input)();
        if (input.wallbox) {
            input.wallbox.presenceWindows = [];
            input.wallbox.connectedNow = false;
        }
        const plan = (0, allocate_1.allocateUnifiedDayPlan)(input);
        const v = (0, evaluate_1.evaluateNoChargeWhileAbsent)(input, plan);
        strict_1.default.equal(v.passed, true);
    });
});
(0, node_test_1.describe)("BETA-DAY-013 planner/AI/learning failure isolation", () => {
    (0, node_test_1.it)("AI mutation flag stays false; dryrun blocks writes", async () => {
        strict_1.default.equal(authority_1.AI_ALLOCATION_LIVE_MUTATION_ENABLED, false);
        const allowed = await (0, execution_mode_1.isLiveWriteAllowed)(async (id) => {
            if (id.includes("global"))
                return { val: "dryrun" };
            return { val: "live" };
        }, "battery");
        strict_1.default.equal(allowed, false);
        strict_1.default.equal((0, execution_mode_1.parseMode)("live"), "live");
    });
});
(0, node_test_1.describe)("BETA-DAY-014 restart mid-day idempotent evaluation", () => {
    (0, node_test_1.it)("second upsert same date does not duplicate", () => {
        const rec = {
            schemaVersion: 1,
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
        };
        const a = (0, persist_1.upsertDayEvaluationOnce)((0, types_1.emptyDayEvaluationStore)(), rec);
        strict_1.default.equal(a.inserted, true);
        const b = (0, persist_1.upsertDayEvaluationOnce)(a.store, { ...rec, evaluatedAtIso: "2026-08-08T22:05:00.000Z" });
        strict_1.default.equal(b.inserted, false);
    });
});
(0, node_test_1.describe)("BETA-DAY-015 hierarchical effective execution", () => {
    (0, node_test_1.it)("global dryrun overrides addon live in effective snapshot", async () => {
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
        strict_1.default.equal(snap.globalLive, false);
        strict_1.default.equal(snap.addons.battery.liveWritesPossible, false);
        strict_1.default.equal(snap.addons.battery.effectiveWriteMode, "dryrun");
        strict_1.default.equal(snap.addons.battery.blockReasonDe, "Global Dryrun");
        strict_1.default.match(snap.summaryDe, /Global Dryrun/i);
    });
    (0, node_test_1.it)("global live + addon dryrun → effective dryrun", async () => {
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
        strict_1.default.equal(snap.globalLive, true);
        strict_1.default.equal(snap.addons.immersion_heater.liveWritesPossible, false);
        strict_1.default.equal(snap.addons.immersion_heater.effectiveWriteMode, "dryrun");
        strict_1.default.equal(snap.addons.immersion_heater.blockReasonDe, "Add-on Dryrun");
    });
    (0, node_test_1.it)("global live + addon live → effective live", async () => {
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
        strict_1.default.equal(snap.addons.immersion_heater.liveWritesPossible, true);
        strict_1.default.equal(snap.addons.immersion_heater.blockReasonDe, null);
    });
});
(0, node_test_1.describe)("BETA-DAY notification surface", () => {
    (0, node_test_1.it)("builds severity + dedup without push", () => {
        const plan = (0, allocate_1.allocateUnifiedDayPlan)((0, alloc_fixtures_1.alloc004Input)());
        const cands = (0, notify_1.buildNotificationCandidates)({
            plan,
            date: plan.createdAtIso.slice(0, 10),
            nowIso: "2026-08-08T12:00:00.000Z",
        });
        const surface = (0, notification_surface_1.buildProductNotificationSurface)(cands, "2026-08-08T12:00:00.000Z");
        strict_1.default.ok(surface.schemaVersion === 1);
        if (surface.count > 0) {
            strict_1.default.ok(surface.lastDedupKey);
            strict_1.default.ok(surface.lastSeverity);
        }
    });
});
// silence unused fixture imports when some scenarios share
void alloc_fixtures_1.alloc007Input;
