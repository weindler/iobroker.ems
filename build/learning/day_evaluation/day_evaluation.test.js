"use strict";
/**
 * DAY-001…007, LEARN-001…005, NOTIFY-001…005, LEARNING-DAY-001 (Teil).
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const fs = __importStar(require("node:fs/promises"));
const os = __importStar(require("node:os"));
const path = __importStar(require("node:path"));
const allocate_1 = require("../../operator/daily_plan/unified/allocate");
const alloc_fixtures_1 = require("../../operator/daily_plan/unified/alloc_fixtures");
const build_1 = require("./build");
const close_1 = require("./close");
const feedback_1 = require("./feedback");
const notify_1 = require("./notify");
const persist_1 = require("./persist");
const session_1 = require("./session");
const types_1 = require("./types");
const daily_persist_1 = require("../pv_bias/daily_persist");
const flex_demand_1 = require("../../operator/contributions/flexible/flex_demand");
let tmpRoot = "";
async function mkDirs() {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "day-eval-"));
    const dayEvalDir = path.join(tmpRoot, "learning", "day_evaluation");
    const pvBiasDir = path.join(tmpRoot, "learning", "pv_bias");
    const thermalDir = path.join(tmpRoot, "learning", "thermal_runtime");
    await fs.mkdir(dayEvalDir, { recursive: true });
    await fs.mkdir(pvBiasDir, { recursive: true });
    await fs.mkdir(thermalDir, { recursive: true });
    return { dayEvalDir, pvBiasDir, thermalDir };
}
function sessionFor(plan, date = "2026-08-04") {
    return (0, build_1.snapshotFromUnifiedSession)({
        date,
        timezone: "Europe/Berlin",
        initialPlanId: plan.planId,
        finalPlan: plan,
        initialGeneration: 1,
        replanCount: 0,
        replanReasons: [],
        initialExpectedPvKwh: plan.expectedPvEnergyTodayKwh,
        batteryStartSocPct: 40,
        plannedImmersionTargetTempC: 56,
    });
}
const nullActuals = {
    actualPvKwh: null,
    actualHouseLoadKwh: null,
    actualGridImportKwh: null,
    actualGridExportKwh: null,
    actualGridCostCt: null,
    actualBatteryEndSocPct: null,
    actualBatteryChargedKwh: null,
    actualImmersionKwh: null,
    actualImmersionEndTempC: null,
    actualClimateKwh: null,
    climateComfortViolations: null,
    actualVehicleChargeKwh: null,
    actualVehicleGridCostCt: null,
    actualVehicleSocPct: null,
};
(0, node_test_1.beforeEach)(() => (0, session_1.resetDayPlanSessionForTest)());
(0, node_test_1.afterEach)(async () => {
    if (tmpRoot)
        await fs.rm(tmpRoot, { recursive: true, force: true }).catch(() => undefined);
});
(0, node_test_1.describe)("DAY-001 single evaluation per day", () => {
    (0, node_test_1.it)("closes exactly once", async () => {
        const dirs = await mkDirs();
        const plan = (0, allocate_1.allocateUnifiedDayPlan)((0, alloc_fixtures_1.alloc003Input)());
        const session = sessionFor(plan);
        const r1 = await (0, close_1.closeDayEvaluationOnce)({
            ...dirs,
            session,
            actuals: { ...nullActuals, actualPvKwh: 22 },
            now: new Date("2026-08-05T00:05:00.000Z"),
        });
        strict_1.default.equal(r1.closed, true);
        const r2 = await (0, close_1.closeDayEvaluationOnce)({
            ...dirs,
            session,
            actuals: { ...nullActuals, actualPvKwh: 99 },
            now: new Date("2026-08-05T00:10:00.000Z"),
        });
        strict_1.default.equal(r2.alreadyClosed, true);
        strict_1.default.equal(r2.closed, false);
        strict_1.default.equal(r2.record?.pv.actualKwh, 22);
    });
});
(0, node_test_1.describe)("DAY-002 replans → one day meta", () => {
    (0, node_test_1.it)("tracks initial/final and replanCount", () => {
        const p1 = (0, allocate_1.allocateUnifiedDayPlan)((0, alloc_fixtures_1.alloc003Input)());
        (0, session_1.noteUnifiedPlanPublished)({
            date: "2026-08-04",
            timezone: "Europe/Berlin",
            plan: p1,
            expectedPvKwh: 30,
            batteryStartSocPct: 40,
            immersionTargetTempC: 56,
            replanReasons: [],
        });
        const p2 = (0, allocate_1.allocateUnifiedDayPlan)((0, alloc_fixtures_1.alloc004Input)());
        (0, session_1.noteUnifiedPlanPublished)({
            date: "2026-08-04",
            timezone: "Europe/Berlin",
            plan: { ...p2, generation: 2, planId: "unified-replan-2" },
            expectedPvKwh: 12,
            batteryStartSocPct: 40,
            immersionTargetTempC: 56,
            replanReasons: ["replan_pv_forecast_changed"],
        });
        const sess = (0, session_1.getDayPlanSession)();
        strict_1.default.equal(sess.initialPlanId, p1.planId);
        strict_1.default.equal(sess.publishCount, 2);
        const snap = (0, session_1.sessionSnapshot)(sess);
        strict_1.default.equal(snap.replanCount, 1);
        strict_1.default.ok(snap.replanReasons.includes("replan_pv_forecast_changed"));
        strict_1.default.equal(snap.finalPlanId, "unified-replan-2");
    });
});
(0, node_test_1.describe)("DAY-003 restart midnight idempotent", () => {
    (0, node_test_1.it)("store prevents double close after restart", async () => {
        const dirs = await mkDirs();
        const plan = (0, allocate_1.allocateUnifiedDayPlan)((0, alloc_fixtures_1.alloc003Input)());
        const session = sessionFor(plan);
        await (0, close_1.closeDayEvaluationOnce)({
            ...dirs,
            session,
            actuals: { ...nullActuals, actualPvKwh: 18 },
            now: new Date("2026-08-05T00:01:00.000Z"),
        });
        // Simulate restart: empty memory, reload store
        const store = await (0, persist_1.loadOrEmptyDayEvaluationStore)(dirs.dayEvalDir);
        strict_1.default.equal((0, persist_1.dayEvaluationExists)(store, "2026-08-04"), true);
        const again = (0, persist_1.upsertDayEvaluationOnce)(store, (0, build_1.buildDayEvaluationRecord)(session, { ...nullActuals, actualPvKwh: 1 }, new Date()));
        strict_1.default.equal(again.inserted, false);
    });
});
(0, node_test_1.describe)("DAY-004 missing actuals stay null", () => {
    (0, node_test_1.it)("does not invent zero actuals", async () => {
        const dirs = await mkDirs();
        const plan = (0, allocate_1.allocateUnifiedDayPlan)((0, alloc_fixtures_1.alloc003Input)());
        const r = await (0, close_1.closeDayEvaluationOnce)({
            ...dirs,
            session: sessionFor(plan),
            actuals: nullActuals,
            now: new Date("2026-08-05T00:05:00.000Z"),
        });
        strict_1.default.equal(r.record?.pv.actualKwh, null);
        strict_1.default.equal(r.record?.houseLoad.actualKwh, null);
        strict_1.default.equal(r.record?.grid.actualImportKwh, null);
        strict_1.default.equal(r.record?.vehicle.actualChargeKwh, null);
    });
});
(0, node_test_1.describe)("DAY-005 PV error uses initial expected", () => {
    (0, node_test_1.it)("absolute error from initial forecast not final replan", () => {
        const plan = (0, allocate_1.allocateUnifiedDayPlan)((0, alloc_fixtures_1.alloc003Input)());
        const session = {
            ...sessionFor(plan),
            initialExpectedPvKwh: 30,
            finalExpectedPvKwh: 20,
            replanCount: 2,
        };
        const rec = (0, build_1.buildDayEvaluationRecord)(session, { ...nullActuals, actualPvKwh: 24 }, new Date());
        strict_1.default.equal(rec.pv.initialExpectedKwh, 30);
        strict_1.default.equal(rec.pv.finalExpectedKwh, 20);
        strict_1.default.equal(rec.pv.absoluteErrorKwh, 6);
        strict_1.default.equal(rec.plan.replanCount, 2);
    });
});
(0, node_test_1.describe)("DAY-006 vehicle goal reached", () => {
    (0, node_test_1.it)("marks reached when actual charge covers required", () => {
        const plan = (0, allocate_1.allocateUnifiedDayPlan)((0, alloc_fixtures_1.alloc003Input)());
        const need = plan.vehicleChargeEconomics?.requiredEnergyKwh ?? 6;
        const session = sessionFor(plan);
        session.vehicleRequiredEnergyKwh = need;
        session.goals = [{ consumerId: "wallbox", goalId: "energy_deadline", status: "unknown", reasonCodes: [] }];
        const rec = (0, build_1.buildDayEvaluationRecord)(session, { ...nullActuals, actualVehicleChargeKwh: need + 0.5 }, new Date());
        strict_1.default.equal(rec.vehicle.targetReached, true);
        strict_1.default.equal(rec.goals.find((g) => g.consumerId === "wallbox")?.status, "reached");
    });
});
(0, node_test_1.describe)("DAY-007 vehicle goal missed", () => {
    (0, node_test_1.it)("marks missed with reason", () => {
        const plan = (0, allocate_1.allocateUnifiedDayPlan)((0, alloc_fixtures_1.alloc004Input)());
        const session = sessionFor(plan);
        session.vehicleRequiredEnergyKwh = 25;
        session.goals = [{ consumerId: "wallbox", goalId: "energy_deadline", status: "unknown", reasonCodes: [] }];
        const rec = (0, build_1.buildDayEvaluationRecord)(session, { ...nullActuals, actualVehicleChargeKwh: 5 }, new Date());
        strict_1.default.equal(rec.vehicle.targetReached, false);
        const g = rec.goals.find((x) => x.consumerId === "wallbox");
        strict_1.default.equal(g.status, "missed");
        strict_1.default.ok(g.reasonCodes.includes("vehicle_goal_missed"));
    });
});
(0, node_test_1.describe)("LEARN-001 one day → few confidence", () => {
    (0, node_test_1.it)("tier is few for 1–2 days", () => {
        strict_1.default.equal((0, feedback_1.learningConfidenceTier)(0), "none");
        strict_1.default.equal((0, feedback_1.learningConfidenceTier)(1), "few");
        strict_1.default.equal((0, feedback_1.learningConfidenceTier)(2), "few");
    });
});
(0, node_test_1.describe)("LEARN-002 PV bias feedback single upsert", () => {
    (0, node_test_1.it)("writes one daily row; second close does not overwrite", async () => {
        const dirs = await mkDirs();
        const plan = (0, allocate_1.allocateUnifiedDayPlan)((0, alloc_fixtures_1.alloc003Input)());
        const session = { ...sessionFor(plan), initialExpectedPvKwh: 28 };
        const rec = (0, build_1.buildDayEvaluationRecord)(session, { ...nullActuals, actualPvKwh: 22 }, new Date("2026-08-05T00:05:00.000Z"));
        strict_1.default.equal(await (0, feedback_1.applyPvBiasFeedbackFromEvaluation)(dirs.pvBiasDir, rec), true);
        strict_1.default.equal(await (0, feedback_1.applyPvBiasFeedbackFromEvaluation)(dirs.pvBiasDir, rec), false);
        const persist = await (0, daily_persist_1.readDailyPersist)(dirs.pvBiasDir);
        strict_1.default.equal(persist.days["2026-08-04"]?.forecastKwh, 28);
        strict_1.default.equal(persist.days["2026-08-04"]?.actualKwh, 22);
    });
});
(0, node_test_1.describe)("LEARN-003 house load note without tick spam", () => {
    (0, node_test_1.it)("close once keeps single evaluation entry", async () => {
        const dirs = await mkDirs();
        const plan = (0, allocate_1.allocateUnifiedDayPlan)((0, alloc_fixtures_1.alloc003Input)());
        await (0, close_1.closeDayEvaluationOnce)({
            ...dirs,
            session: sessionFor(plan),
            actuals: { ...nullActuals, actualHouseLoadKwh: 14 },
            now: new Date("2026-08-05T00:05:00.000Z"),
        });
        await (0, close_1.closeDayEvaluationOnce)({
            ...dirs,
            session: sessionFor(plan),
            actuals: { ...nullActuals, actualHouseLoadKwh: 99 },
            now: new Date("2026-08-05T01:00:00.000Z"),
        });
        const store = await (0, persist_1.loadOrEmptyDayEvaluationStore)(dirs.dayEvalDir);
        strict_1.default.equal(Object.keys(store.days).length, 1);
        strict_1.default.equal(store.days["2026-08-04"].houseLoad.actualKwh, 14);
    });
});
(0, node_test_1.describe)("LEARN-004 thermal heat factor bounded EMA", () => {
    (0, node_test_1.it)("does not jump to single-day truth; unusable below min samples", () => {
        let s = (0, feedback_1.emptyHeatFactorStore)();
        s = (0, feedback_1.applyThermalHeatFactorSample)(s, 0.55, "2026-08-05T00:00:00.000Z");
        strict_1.default.equal((0, feedback_1.usableHeatFactorKwhPerDegree)(s), null);
        strict_1.default.ok(s.kwhPerDegreeC <= 0.6);
        for (let i = 0; i < feedback_1.THERMAL_KWH_MIN_SAMPLES_FOR_USE; i++) {
            s = (0, feedback_1.applyThermalHeatFactorSample)(s, 0.55, "2026-08-05T00:00:00.000Z");
        }
        const usable = (0, feedback_1.usableHeatFactorKwhPerDegree)(s);
        strict_1.default.ok(usable !== null);
        strict_1.default.ok(usable < 0.55); // EMA nicht sofort 0.55
        strict_1.default.ok(usable > 0.38);
        const kwh = (0, flex_demand_1.estimateImmersionRequiredEnergyKwh)(50, 60, 1700, {
            status: "valid",
            coolingRateCPerHAvg: null,
            kwhPerDegreeC: usable,
        });
        strict_1.default.ok(kwh > 3.8);
        strict_1.default.ok(kwh < 5.5);
    });
});
(0, node_test_1.describe)("LEARN-005 stale/bad data skipped", () => {
    (0, node_test_1.it)("thermal feedback skips without target reached / energy", async () => {
        const dirs = await mkDirs();
        const plan = (0, allocate_1.allocateUnifiedDayPlan)((0, alloc_fixtures_1.alloc003Input)());
        const rec = (0, build_1.buildDayEvaluationRecord)(sessionFor(plan), { ...nullActuals, actualImmersionKwh: 0.05 }, new Date());
        rec.immersion.targetReached = false;
        const before = await (0, feedback_1.loadHeatFactorStore)(dirs.thermalDir);
        await (0, feedback_1.writeHeatFactorStore)(dirs.thermalDir, before);
        const { applyThermalHeatFactorFeedback } = await Promise.resolve().then(() => __importStar(require("./feedback.js")));
        strict_1.default.equal(await applyThermalHeatFactorFeedback(dirs.thermalDir, rec), false);
    });
});
(0, node_test_1.describe)("NOTIFY-001 vehicle grid charge candidate", () => {
    (0, node_test_1.it)("emits candidate with costs; savings only if complete", () => {
        const plan = (0, allocate_1.allocateUnifiedDayPlan)((0, alloc_fixtures_1.alloc004Input)());
        const c = (0, notify_1.buildNotificationCandidates)({
            plan,
            date: "2026-08-04",
            nowIso: "2026-08-04T12:00:00.000Z",
        });
        const grid = c.find((x) => x.kind === "vehicle_grid_charge_recommended");
        strict_1.default.ok(grid);
        strict_1.default.ok(grid.payload.requiredGridKwh > 1);
        strict_1.default.ok(grid.payload.expectedCostCt !== undefined);
        if (plan.vehicleChargeEconomics?.savingsVsAlternativeCt === null) {
            strict_1.default.equal(grid.payload.savingsCt, null);
        }
    });
});
(0, node_test_1.describe)("NOTIFY-002 small PV change → no forecast_collapse", () => {
    (0, node_test_1.it)("ignores micro deviation", () => {
        const plan = (0, allocate_1.allocateUnifiedDayPlan)((0, alloc_fixtures_1.alloc003Input)());
        const cur = plan.expectedPvEnergyTodayKwh ?? 20;
        const c = (0, notify_1.buildNotificationCandidates)({
            plan: { ...plan, expectedPvEnergyTodayKwh: cur },
            date: "2026-08-04",
            nowIso: "2026-08-04T12:00:00.000Z",
            previousExpectedPvKwh: cur + 1,
        });
        strict_1.default.equal(c.some((x) => x.kind === "forecast_collapse"), false);
    });
});
(0, node_test_1.describe)("NOTIFY-003 vehicle goal at risk", () => {
    (0, node_test_1.it)("emits at_risk candidate", () => {
        const plan = (0, allocate_1.allocateUnifiedDayPlan)((0, alloc_fixtures_1.alloc004Input)());
        const risky = {
            ...plan,
            goalStatuses: [
                {
                    consumerId: "wallbox",
                    goalId: "energy_deadline",
                    met: null,
                    detailDe: "Fahrzeugziel unsicher wegen unknown Presence.",
                },
            ],
            reasonCodes: [...plan.reasonCodes, "vehicle_goal_at_risk"],
        };
        const c = (0, notify_1.buildNotificationCandidates)({
            plan: risky,
            date: "2026-08-04",
            nowIso: "2026-08-04T12:00:00.000Z",
        });
        strict_1.default.ok(c.some((x) => x.kind === "vehicle_goal_at_risk"));
    });
});
(0, node_test_1.describe)("NOTIFY-004 dedup across replans", () => {
    (0, node_test_1.it)("same dedupKey merged once", () => {
        const plan = (0, allocate_1.allocateUnifiedDayPlan)((0, alloc_fixtures_1.alloc004Input)());
        const a = (0, notify_1.buildNotificationCandidates)({
            plan,
            date: "2026-08-04",
            nowIso: "2026-08-04T10:00:00.000Z",
        });
        const b = (0, notify_1.buildNotificationCandidates)({
            plan,
            date: "2026-08-04",
            nowIso: "2026-08-04T11:00:00.000Z",
        });
        const merged = (0, notify_1.mergeNotificationCandidates)(a, b);
        const keys = merged.map((x) => x.dedupKey);
        strict_1.default.equal(keys.length, new Set(keys).size);
    });
});
(0, node_test_1.describe)("NOTIFY-005 incomplete savings not invented", () => {
    (0, node_test_1.it)("candidate may omit savings when null", () => {
        const plan = (0, allocate_1.allocateUnifiedDayPlan)((0, alloc_fixtures_1.alloc004Input)());
        const patched = {
            ...plan,
            vehicleChargeEconomics: plan.vehicleChargeEconomics
                ? {
                    ...plan.vehicleChargeEconomics,
                    savingsVsAlternativeCt: null,
                    economicsCompleteness: "unknown",
                }
                : null,
        };
        const c = (0, notify_1.buildNotificationCandidates)({
            plan: patched,
            date: "2026-08-04",
            nowIso: "2026-08-04T12:00:00.000Z",
        });
        const grid = c.find((x) => x.kind === "vehicle_grid_charge_recommended");
        if (grid)
            strict_1.default.equal(grid.payload.savingsCt, null);
    });
});
(0, node_test_1.describe)("LEARNING-DAY-001 multi-day PV feedback → heat factor path", () => {
    (0, node_test_1.it)("three days of PV feedback + thermal EMA influence estimate", async () => {
        const dirs = await mkDirs();
        for (let d = 1; d <= 3; d++) {
            const date = `2026-08-0${d}`;
            const plan = (0, allocate_1.allocateUnifiedDayPlan)((0, alloc_fixtures_1.alloc003Input)());
            const session = { ...sessionFor(plan, date), initialExpectedPvKwh: 30 };
            await (0, close_1.closeDayEvaluationOnce)({
                ...dirs,
                session,
                actuals: { ...nullActuals, actualPvKwh: 24 },
                now: new Date(`2026-08-0${d + 1}T00:05:00.000Z`),
            });
        }
        const persist = await (0, daily_persist_1.readDailyPersist)(dirs.pvBiasDir);
        strict_1.default.equal(Object.keys(persist.days).length, 3);
        strict_1.default.equal((0, feedback_1.learningConfidenceTier)(3), "usable");
        let heat = (0, feedback_1.emptyHeatFactorStore)();
        for (let i = 0; i < 6; i++) {
            heat = (0, feedback_1.applyThermalHeatFactorSample)(heat, 0.5, "t");
        }
        await (0, feedback_1.writeHeatFactorStore)(dirs.thermalDir, heat);
        const usable = (0, feedback_1.usableHeatFactorKwhPerDegree)(await (0, feedback_1.loadHeatFactorStore)(dirs.thermalDir));
        strict_1.default.ok(usable !== null);
        const before = (0, flex_demand_1.estimateImmersionRequiredEnergyKwh)(50, 60, 1700, {
            status: "missing",
            coolingRateCPerHAvg: null,
        });
        const after = (0, flex_demand_1.estimateImmersionRequiredEnergyKwh)(50, 60, 1700, {
            status: "valid",
            coolingRateCPerHAvg: null,
            kwhPerDegreeC: usable,
        });
        strict_1.default.notEqual(before, after);
        void types_1.emptyDayEvaluationStore;
    });
});
