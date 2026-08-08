/**
 * DAY-001…007, LEARN-001…005, NOTIFY-001…005, LEARNING-DAY-001 (Teil).
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { allocateUnifiedDayPlan } from "../../operator/daily_plan/unified/allocate";
import { alloc003Input, alloc004Input } from "../../operator/daily_plan/unified/alloc_fixtures";
import { buildDayEvaluationRecord, snapshotFromUnifiedSession } from "./build";
import { closeDayEvaluationOnce } from "./close";
import {
	applyThermalHeatFactorSample,
	applyPvBiasFeedbackFromEvaluation,
	emptyHeatFactorStore,
	learningConfidenceTier,
	THERMAL_KWH_MIN_SAMPLES_FOR_USE,
	usableHeatFactorKwhPerDegree,
	loadHeatFactorStore,
	writeHeatFactorStore,
} from "./feedback";
import { buildNotificationCandidates, mergeNotificationCandidates } from "./notify";
import {
	dayEvaluationExists,
	loadOrEmptyDayEvaluationStore,
	upsertDayEvaluationOnce,
	writeDayEvaluationPersist,
} from "./persist";
import {
	getDayPlanSession,
	noteUnifiedPlanPublished,
	resetDayPlanSessionForTest,
	sessionSnapshot,
} from "./session";
import { emptyDayEvaluationStore } from "./types";
import { readDailyPersist } from "../pv_bias/daily_persist";
import { estimateImmersionRequiredEnergyKwh } from "../../operator/contributions/flexible/flex_demand";

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

function sessionFor(plan: ReturnType<typeof allocateUnifiedDayPlan>, date = "2026-08-04") {
	return snapshotFromUnifiedSession({
		date,
		timezone: "Europe/Berlin",
		initialPlanId: plan.planId,
		finalPlan: plan,
		initialGeneration: 1,
		replanCount: 0,
		replanReasons: [],
		initialExpectedPvKwh: plan.expectedPvEnergyKwh,
		batteryStartSocPct: 40,
		plannedImmersionTargetTempC: 56,
	});
}

const nullActuals = {
	actualPvKwh: null as number | null,
	actualHouseLoadKwh: null as number | null,
	actualGridImportKwh: null as number | null,
	actualGridExportKwh: null as number | null,
	actualGridCostCt: null as number | null,
	actualBatteryEndSocPct: null as number | null,
	actualBatteryChargedKwh: null as number | null,
	actualImmersionKwh: null as number | null,
	actualImmersionEndTempC: null as number | null,
	actualClimateKwh: null as number | null,
	climateComfortViolations: null as number | null,
	actualVehicleChargeKwh: null as number | null,
	actualVehicleGridCostCt: null as number | null,
	actualVehicleSocPct: null as number | null,
};

beforeEach(() => resetDayPlanSessionForTest());
afterEach(async () => {
	if (tmpRoot) await fs.rm(tmpRoot, { recursive: true, force: true }).catch(() => undefined);
});

describe("DAY-001 single evaluation per day", () => {
	it("closes exactly once", async () => {
		const dirs = await mkDirs();
		const plan = allocateUnifiedDayPlan(alloc003Input());
		const session = sessionFor(plan);
		const r1 = await closeDayEvaluationOnce({
			...dirs,
			session,
			actuals: { ...nullActuals, actualPvKwh: 22 },
			now: new Date("2026-08-05T00:05:00.000Z"),
		});
		assert.equal(r1.closed, true);
		const r2 = await closeDayEvaluationOnce({
			...dirs,
			session,
			actuals: { ...nullActuals, actualPvKwh: 99 },
			now: new Date("2026-08-05T00:10:00.000Z"),
		});
		assert.equal(r2.alreadyClosed, true);
		assert.equal(r2.closed, false);
		assert.equal(r2.record?.pv.actualKwh, 22);
	});
});

describe("DAY-002 replans → one day meta", () => {
	it("tracks initial/final and replanCount", () => {
		const p1 = allocateUnifiedDayPlan(alloc003Input());
		noteUnifiedPlanPublished({
			date: "2026-08-04",
			timezone: "Europe/Berlin",
			plan: p1,
			expectedPvKwh: 30,
			batteryStartSocPct: 40,
			immersionTargetTempC: 56,
			replanReasons: [],
		});
		const p2 = allocateUnifiedDayPlan(alloc004Input());
		noteUnifiedPlanPublished({
			date: "2026-08-04",
			timezone: "Europe/Berlin",
			plan: { ...p2, generation: 2, planId: "unified-replan-2" },
			expectedPvKwh: 12,
			batteryStartSocPct: 40,
			immersionTargetTempC: 56,
			replanReasons: ["replan_pv_forecast_changed"],
		});
		const sess = getDayPlanSession()!;
		assert.equal(sess.initialPlanId, p1.planId);
		assert.equal(sess.publishCount, 2);
		const snap = sessionSnapshot(sess);
		assert.equal(snap.replanCount, 1);
		assert.ok(snap.replanReasons.includes("replan_pv_forecast_changed"));
		assert.equal(snap.finalPlanId, "unified-replan-2");
	});
});

describe("DAY-003 restart midnight idempotent", () => {
	it("store prevents double close after restart", async () => {
		const dirs = await mkDirs();
		const plan = allocateUnifiedDayPlan(alloc003Input());
		const session = sessionFor(plan);
		await closeDayEvaluationOnce({
			...dirs,
			session,
			actuals: { ...nullActuals, actualPvKwh: 18 },
			now: new Date("2026-08-05T00:01:00.000Z"),
		});
		// Simulate restart: empty memory, reload store
		const store = await loadOrEmptyDayEvaluationStore(dirs.dayEvalDir);
		assert.equal(dayEvaluationExists(store, "2026-08-04"), true);
		const again = upsertDayEvaluationOnce(
			store,
			buildDayEvaluationRecord(session, { ...nullActuals, actualPvKwh: 1 }, new Date()),
		);
		assert.equal(again.inserted, false);
	});
});

describe("DAY-004 missing actuals stay null", () => {
	it("does not invent zero actuals", async () => {
		const dirs = await mkDirs();
		const plan = allocateUnifiedDayPlan(alloc003Input());
		const r = await closeDayEvaluationOnce({
			...dirs,
			session: sessionFor(plan),
			actuals: nullActuals,
			now: new Date("2026-08-05T00:05:00.000Z"),
		});
		assert.equal(r.record?.pv.actualKwh, null);
		assert.equal(r.record?.houseLoad.actualKwh, null);
		assert.equal(r.record?.grid.actualImportKwh, null);
		assert.equal(r.record?.vehicle.actualChargeKwh, null);
	});
});

describe("DAY-005 PV error uses initial expected", () => {
	it("absolute error from initial forecast not final replan", () => {
		const plan = allocateUnifiedDayPlan(alloc003Input());
		const session = {
			...sessionFor(plan),
			initialExpectedPvKwh: 30,
			finalExpectedPvKwh: 20,
			replanCount: 2,
		};
		const rec = buildDayEvaluationRecord(
			session,
			{ ...nullActuals, actualPvKwh: 24 },
			new Date(),
		);
		assert.equal(rec.pv.initialExpectedKwh, 30);
		assert.equal(rec.pv.finalExpectedKwh, 20);
		assert.equal(rec.pv.absoluteErrorKwh, 6);
		assert.equal(rec.plan.replanCount, 2);
	});
});

describe("DAY-006 vehicle goal reached", () => {
	it("marks reached when actual charge covers required", () => {
		const plan = allocateUnifiedDayPlan(alloc003Input());
		const need = plan.vehicleChargeEconomics?.requiredEnergyKwh ?? 6;
		const session = sessionFor(plan);
		session.vehicleRequiredEnergyKwh = need;
		session.goals = [{ consumerId: "wallbox", goalId: "energy_deadline", status: "unknown", reasonCodes: [] }];
		const rec = buildDayEvaluationRecord(
			session,
			{ ...nullActuals, actualVehicleChargeKwh: need + 0.5 },
			new Date(),
		);
		assert.equal(rec.vehicle.targetReached, true);
		assert.equal(rec.goals.find((g) => g.consumerId === "wallbox")?.status, "reached");
	});
});

describe("DAY-007 vehicle goal missed", () => {
	it("marks missed with reason", () => {
		const plan = allocateUnifiedDayPlan(alloc004Input());
		const session = sessionFor(plan);
		session.vehicleRequiredEnergyKwh = 25;
		session.goals = [{ consumerId: "wallbox", goalId: "energy_deadline", status: "unknown", reasonCodes: [] }];
		const rec = buildDayEvaluationRecord(
			session,
			{ ...nullActuals, actualVehicleChargeKwh: 5 },
			new Date(),
		);
		assert.equal(rec.vehicle.targetReached, false);
		const g = rec.goals.find((x) => x.consumerId === "wallbox")!;
		assert.equal(g.status, "missed");
		assert.ok(g.reasonCodes.includes("vehicle_goal_missed"));
	});
});

describe("LEARN-001 one day → few confidence", () => {
	it("tier is few for 1–2 days", () => {
		assert.equal(learningConfidenceTier(0), "none");
		assert.equal(learningConfidenceTier(1), "few");
		assert.equal(learningConfidenceTier(2), "few");
	});
});

describe("LEARN-002 PV bias feedback single upsert", () => {
	it("writes one daily row; second close does not overwrite", async () => {
		const dirs = await mkDirs();
		const plan = allocateUnifiedDayPlan(alloc003Input());
		const session = { ...sessionFor(plan), initialExpectedPvKwh: 28 };
		const rec = buildDayEvaluationRecord(
			session,
			{ ...nullActuals, actualPvKwh: 22 },
			new Date("2026-08-05T00:05:00.000Z"),
		);
		assert.equal(await applyPvBiasFeedbackFromEvaluation(dirs.pvBiasDir, rec), true);
		assert.equal(await applyPvBiasFeedbackFromEvaluation(dirs.pvBiasDir, rec), false);
		const persist = await readDailyPersist(dirs.pvBiasDir);
		assert.equal(persist.days["2026-08-04"]?.forecastKwh, 28);
		assert.equal(persist.days["2026-08-04"]?.actualKwh, 22);
	});
});

describe("LEARN-003 house load note without tick spam", () => {
	it("close once keeps single evaluation entry", async () => {
		const dirs = await mkDirs();
		const plan = allocateUnifiedDayPlan(alloc003Input());
		await closeDayEvaluationOnce({
			...dirs,
			session: sessionFor(plan),
			actuals: { ...nullActuals, actualHouseLoadKwh: 14 },
			now: new Date("2026-08-05T00:05:00.000Z"),
		});
		await closeDayEvaluationOnce({
			...dirs,
			session: sessionFor(plan),
			actuals: { ...nullActuals, actualHouseLoadKwh: 99 },
			now: new Date("2026-08-05T01:00:00.000Z"),
		});
		const store = await loadOrEmptyDayEvaluationStore(dirs.dayEvalDir);
		assert.equal(Object.keys(store.days).length, 1);
		assert.equal(store.days["2026-08-04"].houseLoad.actualKwh, 14);
	});
});

describe("LEARN-004 thermal heat factor bounded EMA", () => {
	it("does not jump to single-day truth; unusable below min samples", () => {
		let s = emptyHeatFactorStore();
		s = applyThermalHeatFactorSample(s, 0.55, "2026-08-05T00:00:00.000Z");
		assert.equal(usableHeatFactorKwhPerDegree(s), null);
		assert.ok(s.kwhPerDegreeC <= 0.6);
		for (let i = 0; i < THERMAL_KWH_MIN_SAMPLES_FOR_USE; i++) {
			s = applyThermalHeatFactorSample(s, 0.55, "2026-08-05T00:00:00.000Z");
		}
		const usable = usableHeatFactorKwhPerDegree(s);
		assert.ok(usable !== null);
		assert.ok(usable! < 0.55); // EMA nicht sofort 0.55
		assert.ok(usable! > 0.38);
		const kwh = estimateImmersionRequiredEnergyKwh(50, 60, 1700, {
			status: "valid",
			coolingRateCPerHAvg: null,
			kwhPerDegreeC: usable,
		});
		assert.ok(kwh > 3.8);
		assert.ok(kwh < 5.5);
	});
});

describe("LEARN-005 stale/bad data skipped", () => {
	it("thermal feedback skips without target reached / energy", async () => {
		const dirs = await mkDirs();
		const plan = allocateUnifiedDayPlan(alloc003Input());
		const rec = buildDayEvaluationRecord(
			sessionFor(plan),
			{ ...nullActuals, actualImmersionKwh: 0.05 },
			new Date(),
		);
		rec.immersion.targetReached = false;
		const before = await loadHeatFactorStore(dirs.thermalDir);
		await writeHeatFactorStore(dirs.thermalDir, before);
		const { applyThermalHeatFactorFeedback } = await import("./feedback.js");
		assert.equal(await applyThermalHeatFactorFeedback(dirs.thermalDir, rec), false);
	});
});

describe("NOTIFY-001 vehicle grid charge candidate", () => {
	it("emits candidate with costs; savings only if complete", () => {
		const plan = allocateUnifiedDayPlan(alloc004Input());
		const c = buildNotificationCandidates({
			plan,
			date: "2026-08-04",
			nowIso: "2026-08-04T12:00:00.000Z",
		});
		const grid = c.find((x) => x.kind === "vehicle_grid_charge_recommended");
		assert.ok(grid);
		assert.ok((grid!.payload.requiredGridKwh as number) > 1);
		assert.ok(grid!.payload.expectedCostCt !== undefined);
		if (plan.vehicleChargeEconomics?.savingsVsAlternativeCt === null) {
			assert.equal(grid!.payload.savingsCt, null);
		}
	});
});

describe("NOTIFY-002 small PV change → no forecast_collapse", () => {
	it("ignores micro deviation", () => {
		const plan = allocateUnifiedDayPlan(alloc003Input());
		const cur = plan.expectedPvEnergyKwh ?? 20;
		const c = buildNotificationCandidates({
			plan: { ...plan, expectedPvEnergyKwh: cur },
			date: "2026-08-04",
			nowIso: "2026-08-04T12:00:00.000Z",
			previousExpectedPvKwh: cur + 1,
		});
		assert.equal(c.some((x) => x.kind === "forecast_collapse"), false);
	});
});

describe("NOTIFY-003 vehicle goal at risk", () => {
	it("emits at_risk candidate", () => {
		const plan = allocateUnifiedDayPlan(alloc004Input());
		const risky: typeof plan = {
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
		const c = buildNotificationCandidates({
			plan: risky,
			date: "2026-08-04",
			nowIso: "2026-08-04T12:00:00.000Z",
		});
		assert.ok(c.some((x) => x.kind === "vehicle_goal_at_risk"));
	});
});

describe("NOTIFY-004 dedup across replans", () => {
	it("same dedupKey merged once", () => {
		const plan = allocateUnifiedDayPlan(alloc004Input());
		const a = buildNotificationCandidates({
			plan,
			date: "2026-08-04",
			nowIso: "2026-08-04T10:00:00.000Z",
		});
		const b = buildNotificationCandidates({
			plan,
			date: "2026-08-04",
			nowIso: "2026-08-04T11:00:00.000Z",
		});
		const merged = mergeNotificationCandidates(a, b);
		const keys = merged.map((x) => x.dedupKey);
		assert.equal(keys.length, new Set(keys).size);
	});
});

describe("NOTIFY-005 incomplete savings not invented", () => {
	it("candidate may omit savings when null", () => {
		const plan = allocateUnifiedDayPlan(alloc004Input());
		const patched = {
			...plan,
			vehicleChargeEconomics: plan.vehicleChargeEconomics
				? {
						...plan.vehicleChargeEconomics,
						savingsVsAlternativeCt: null,
						economicsCompleteness: "unknown" as const,
					}
				: null,
		};
		const c = buildNotificationCandidates({
			plan: patched,
			date: "2026-08-04",
			nowIso: "2026-08-04T12:00:00.000Z",
		});
		const grid = c.find((x) => x.kind === "vehicle_grid_charge_recommended");
		if (grid) assert.equal(grid.payload.savingsCt, null);
	});
});

describe("LEARNING-DAY-001 multi-day PV feedback → heat factor path", () => {
	it("three days of PV feedback + thermal EMA influence estimate", async () => {
		const dirs = await mkDirs();
		for (let d = 1; d <= 3; d++) {
			const date = `2026-08-0${d}`;
			const plan = allocateUnifiedDayPlan(alloc003Input());
			const session = { ...sessionFor(plan, date), initialExpectedPvKwh: 30 };
			await closeDayEvaluationOnce({
				...dirs,
				session,
				actuals: { ...nullActuals, actualPvKwh: 24 },
				now: new Date(`2026-08-0${d + 1}T00:05:00.000Z`),
			});
		}
		const persist = await readDailyPersist(dirs.pvBiasDir);
		assert.equal(Object.keys(persist.days).length, 3);
		assert.equal(learningConfidenceTier(3), "usable");

		let heat = emptyHeatFactorStore();
		for (let i = 0; i < 6; i++) {
			heat = applyThermalHeatFactorSample(heat, 0.5, "t");
		}
		await writeHeatFactorStore(dirs.thermalDir, heat);
		const usable = usableHeatFactorKwhPerDegree(await loadHeatFactorStore(dirs.thermalDir));
		assert.ok(usable !== null);
		const before = estimateImmersionRequiredEnergyKwh(50, 60, 1700, {
			status: "missing",
			coolingRateCPerHAvg: null,
		});
		const after = estimateImmersionRequiredEnergyKwh(50, 60, 1700, {
			status: "valid",
			coolingRateCPerHAvg: null,
			kwhPerDegreeC: usable,
		});
		assert.notEqual(before, after);
		void emptyDayEvaluationStore;
	});
});
