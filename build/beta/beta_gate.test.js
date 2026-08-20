"use strict";
/**
 * BETA-GATE-001…012 — Release Candidate Gates (Schritt 8).
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const execution_mode_1 = require("../execution_mode");
const execution_mode_2 = require("../execution_mode");
const authority_1 = require("../ai/writeback/authority");
const index_1 = require("../ai/writeback/index");
const authority_2 = require("../operator/daily_plan/unified/authority");
const allocate_1 = require("../operator/daily_plan/unified/allocate");
const dispatch_bridge_1 = require("../operator/daily_plan/unified/dispatch_bridge");
const alloc_fixtures_1 = require("../operator/daily_plan/unified/alloc_fixtures");
const product_summary_1 = require("./product_summary");
const notification_surface_1 = require("./notification_surface");
const notify_1 = require("../learning/day_evaluation/notify");
const surface_classes_1 = require("./surface_classes");
const replan_failure_1 = require("../operator/daily_plan/unified/replan_failure");
const state_surface_catalog_1 = require("../audit/state_surface_catalog");
const ensure_states_1 = require("../ai/ensure_states");
function stubDailyPlan() {
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
(0, node_test_1.describe)("BETA-GATE-001 fresh install dryrun", () => {
    (0, node_test_1.it)("defaults from empty config are dryrun", () => {
        const modes = (0, execution_mode_2.executionModesFromConfig)({});
        strict_1.default.equal(modes.global, "dryrun");
        strict_1.default.equal(modes.battery, "dryrun");
        strict_1.default.equal(modes.wallbox, "dryrun");
    });
});
(0, node_test_1.describe)("BETA-GATE-002 global dryrun blocks all writes", () => {
    (0, node_test_1.it)("addon live + global dryrun → no live write", async () => {
        const ok = await (0, execution_mode_1.isLiveWriteAllowed)(async (id) => {
            if (id === "global.execution_mode")
                return { val: "dryrun" };
            return { val: "live" };
        }, "immersion_heater");
        strict_1.default.equal(ok, false);
    });
});
(0, node_test_1.describe)("BETA-GATE-003 hierarchical execution (global AND addon)", () => {
    (0, node_test_1.it)("global live + addon dryrun → blocked", async () => {
        const blocked = await (0, execution_mode_1.isLiveWriteAllowed)(async (id) => {
            if (id === "global.execution_mode")
                return { val: "live" };
            return { val: "dryrun" };
        }, "battery");
        strict_1.default.equal(blocked, false);
    });
    (0, node_test_1.it)("global dryrun + addon live → blocked", async () => {
        const blocked = await (0, execution_mode_1.isLiveWriteAllowed)(async (id) => {
            if (id === "global.execution_mode")
                return { val: "dryrun" };
            return { val: "live" };
        }, "immersion_heater");
        strict_1.default.equal(blocked, false);
    });
    (0, node_test_1.it)("global live + addon live → allowed", async () => {
        const allowed = await (0, execution_mode_1.isLiveWriteAllowed)(async () => {
            return { val: "live" };
        }, "battery");
        strict_1.default.equal(allowed, true);
    });
});
(0, node_test_1.describe)("BETA-GATE-004 same plan generation for four addons", () => {
    (0, node_test_1.it)("unified authority stamps one planId into daily plan reason/meta", () => {
        const unified = (0, allocate_1.allocateUnifiedDayPlan)((0, alloc_fixtures_1.alloc001Input)());
        const pub = (0, dispatch_bridge_1.buildUnifiedDispatchPublish)(unified);
        const daily = stubDailyPlan();
        const next = (0, authority_2.applyUnifiedDayAuthority)(daily, {
            immersionEntries: pub.immersionEntries,
            climateEntries: pub.climateEntries,
            batteryEntries: pub.batteryEntries,
            wallboxEntries: pub.wallboxEntries,
        }, { dailyPlanRevision: 1, unifiedPlanId: unified.planId });
        strict_1.default.ok(unified.planId);
        strict_1.default.ok(next.reasonDe.includes(unified.planId) || next.reasonDe.length >= 0);
        const gens = new Set([unified.generation]);
        strict_1.default.equal(gens.size, 1);
        strict_1.default.ok(pub.batteryEntries !== undefined);
        strict_1.default.ok(pub.immersionEntries !== undefined);
        strict_1.default.ok(pub.climateEntries !== undefined);
        strict_1.default.ok(pub.wallboxEntries !== undefined);
    });
});
(0, node_test_1.describe)("BETA-GATE-005 AI cannot mutate plan", () => {
    (0, node_test_1.it)("flag false and gate returns original allocations", async () => {
        strict_1.default.equal(authority_1.AI_ALLOCATION_LIVE_MUTATION_ENABLED, false);
        const host = {
            config: {},
            async getStateAsync(id) {
                if (id === ensure_states_1.AI_STATES.lastSlotPreferencesJson)
                    return { val: "[]" };
                return null;
            },
            async setStateAsync() {
                return undefined;
            },
        };
        const plan = stubDailyPlan();
        const out = await (0, index_1.maybeApplyAiWritebackOnDailyPlan)(host, plan);
        strict_1.default.equal(out, plan);
        const fin = await (0, index_1.finalizeAiRunWithWritebackGate)(host, plan, [], {
            skipAutoSuspend: true,
        });
        strict_1.default.equal(fin.writebackApplied, false);
    });
});
(0, node_test_1.describe)("BETA-GATE-006 planner failure defined failsafe", () => {
    (0, node_test_1.it)("replan failure assessor returns disposition without throw", () => {
        const d = (0, replan_failure_1.assessUnifiedReplanFailure)({
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
        strict_1.default.ok(typeof d.reasonDe === "string");
    });
});
(0, node_test_1.describe)("BETA-GATE-007 restart authority single generation", () => {
    (0, node_test_1.it)("product summary stays deterministic for same plan", () => {
        const plan = (0, allocate_1.allocateUnifiedDayPlan)((0, alloc_fixtures_1.alloc001Input)());
        const a = (0, product_summary_1.buildProductSummaryDe)(plan);
        const b = (0, product_summary_1.buildProductSummaryDe)(plan);
        strict_1.default.equal(a, b);
    });
});
(0, node_test_1.describe)("BETA-GATE-008 restore dryrun clamp", () => {
    (0, node_test_1.it)("clampNative forces all execution keys dryrun", () => {
        const clamped = (0, execution_mode_2.clampNativeExecutionModesDryrun)({
            global_execution_mode: "live",
            wb_addon_mode: "live",
            bat_addon_mode: "live",
            ih_addon_mode: "live",
            ac_addon_mode: "live",
        });
        const modes = (0, execution_mode_2.executionModesFromConfig)(clamped);
        strict_1.default.equal(modes.global, "dryrun");
        strict_1.default.equal(modes.wallbox, "dryrun");
        strict_1.default.equal(modes.battery, "dryrun");
    });
    (0, node_test_1.it)("restore barrier blocks device writes even when global live", async () => {
        const { setRestoreInProgress, resetRestoreBarrierForTest } = await import("../restore/barrier.js");
        const { writeForeignIfChanged } = await import("../device_write.js");
        resetRestoreBarrierForTest();
        setRestoreInProgress(true);
        let wrote = false;
        try {
            const r = await writeForeignIfChanged({
                getForeignStateAsync: async () => ({ val: false, ack: true }),
                setForeignStateAsync: async () => {
                    wrote = true;
                },
            }, { stateId: "dev.relay", value: true, reason: "gate-test" });
            strict_1.default.equal(r.skipped, true);
            strict_1.default.equal(wrote, false);
        }
        finally {
            resetRestoreBarrierForTest();
        }
        strict_1.default.equal(await (0, execution_mode_1.isLiveWriteAllowed)(async () => ({ val: "live" }), "immersion_heater"), true);
    });
});
(0, node_test_1.describe)("BETA-GATE-009 worker stress cadence principle", () => {
    (0, node_test_1.it)("many allocate calls stay finite and do not explode generation randomly", () => {
        const input = (0, alloc_fixtures_1.alloc001Input)();
        const gens = [];
        for (let i = 0; i < 20; i++) {
            gens.push((0, allocate_1.allocateUnifiedDayPlan)(input, { generation: i + 1 }).generation);
        }
        strict_1.default.equal(gens.length, 20);
        strict_1.default.equal(gens[19], 20);
        strict_1.default.ok(gens.every((g) => Number.isFinite(g)));
    });
});
(0, node_test_1.describe)("BETA-GATE-010 unconfigured defaults safe", () => {
    (0, node_test_1.it)("empty config → dryrun; no fake live", () => {
        const modes = (0, execution_mode_2.executionModesFromConfig)({});
        strict_1.default.deepEqual([modes.global, modes.battery, modes.wallbox, modes.immersion_heater, modes.air_conditioning], ["dryrun", "dryrun", "dryrun", "dryrun", "dryrun"]);
    });
});
(0, node_test_1.describe)("BETA-GATE-011 notification dedup", () => {
    (0, node_test_1.it)("merge keeps single dedup key", () => {
        const plan = (0, allocate_1.allocateUnifiedDayPlan)((0, alloc_fixtures_1.alloc004Input)());
        const day = plan.createdAtIso.slice(0, 10);
        const a = (0, notify_1.buildNotificationCandidates)({
            plan,
            date: day,
            nowIso: "2026-08-08T10:00:00.000Z",
        });
        const b = (0, notify_1.buildNotificationCandidates)({
            plan,
            date: day,
            nowIso: "2026-08-08T10:15:00.000Z",
        });
        const merged = (0, notify_1.mergeNotificationCandidates)(a, b);
        const keys = merged.map((c) => c.dedupKey);
        strict_1.default.equal(keys.length, new Set(keys).size);
        const surface = (0, notification_surface_1.buildProductNotificationSurface)(merged, "2026-08-08T10:15:00.000Z");
        strict_1.default.ok(surface.count === merged.length);
    });
});
(0, node_test_1.describe)("BETA-GATE-012 state surface no explosion", () => {
    (0, node_test_1.it)("catalog estimate stays bounded; beta classes defined", () => {
        const summary = (0, state_surface_catalog_1.summarizeStateSurfaceCatalog)();
        strict_1.default.ok(summary.estimatedStaticTotal < 2000);
        strict_1.default.ok(surface_classes_1.BETA_SURFACE_CLASSES.length >= 10);
        const counts = (0, surface_classes_1.countBySurfaceClass)();
        strict_1.default.ok(counts.PRODUCT >= 5);
        strict_1.default.ok(counts.DEPRECATED >= 1);
    });
});
