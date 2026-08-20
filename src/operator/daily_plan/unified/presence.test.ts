/**
 * PRESENCE-001…012 — Future Vehicle Presence / Availability.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	bucketStatsForTest,
	emptyVehiclePresenceStore,
	localBucketAt,
	MIN_OBSERVATIONS_FOR_PREDICTION,
	observeConnected,
	predictAt,
	predictFromCounts,
	seedBucket,
} from "../../../learning/vehicle_presence";
import { allocateUnifiedDayPlan } from "./allocate";
import { buildSlots, golden002Input } from "./fixtures";
import { evaluateMaterialReplan, type PlanActualSample, type PlanBaseline } from "./materiality";
import { REASON } from "./reason_codes";
import {
	buildVehicleAvailabilityWindows,
	evaluateVehicleGoalFeasibility,
	normalizePresenceWindow,
	presenceDigest,
} from "./vehicle_availability";
import type { UnifiedDayPlannerInput } from "./types";

const TZ = "UTC";

const VEHICLE_A = "ford";
const VEHICLE_B = "guest_car";

function windowsFor(
	connectedNow: boolean,
	opts: {
		slots?: Array<{ startIso: string; endIso: string }>;
		nowIso?: string;
		explicit?: Array<{ available: boolean; startIso: string; endIso: string }>;
		store?: ReturnType<typeof emptyVehiclePresenceStore> | null;
		vehicleKey?: string | null;
	} = {},
) {
	const slots = opts.slots ?? buildSlots("2026-08-04T00:00:00.000Z", 24);
	return buildVehicleAvailabilityWindows({
		nowIso: opts.nowIso ?? "2026-08-04T10:00:00.000Z",
		timezone: TZ,
		slots,
		connectedNow,
		explicitWindows: opts.explicit ?? null,
		learningStore: opts.store ?? null,
		learningVehicleKey: opts.vehicleKey === undefined ? VEHICLE_A : opts.vehicleKey,
	});
}

function statusAt(windows: ReturnType<typeof windowsFor>, slotStartIso: string) {
	for (const w of windows) {
		const t = Date.parse(slotStartIso);
		if (t >= Date.parse(w.startIso) && t < Date.parse(w.endIso)) {
			return normalizePresenceWindow(w);
		}
	}
	return null;
}

describe("PRESENCE-001 connected now", () => {
	it("current slot is available (live)", () => {
		const slots = buildSlots("2026-08-04T00:00:00.000Z", 24);
		const nowIso = "2026-08-04T10:07:00.000Z";
		const current = slots.find(
			(s) => Date.parse(s.startIso) <= Date.parse(nowIso) && Date.parse(nowIso) < Date.parse(s.endIso),
		)!;
		const w = windowsFor(true, { slots, nowIso });
		const cur = statusAt(w, current.startIso)!;
		assert.equal(cur.status, "available");
		assert.equal(cur.source, "live_connected");
		assert.equal(cur.hard, true);
	});
});

describe("PRESENCE-002 disconnected now", () => {
	it("current slot is hard unavailable", () => {
		const slots = buildSlots("2026-08-04T00:00:00.000Z", 24);
		const nowIso = "2026-08-04T10:07:00.000Z";
		const current = slots.find(
			(s) => Date.parse(s.startIso) <= Date.parse(nowIso) && Date.parse(nowIso) < Date.parse(s.endIso),
		)!;
		const w = windowsFor(false, { slots, nowIso });
		const cur = statusAt(w, current.startIso)!;
		assert.equal(cur.status, "unavailable");
		assert.equal(cur.source, "live_disconnected");
		assert.equal(cur.hard, true);
	});
});

describe("PRESENCE-003 unknown future", () => {
	it("future slots are unknown without history/plan — not available", () => {
		const slots = buildSlots("2026-08-04T00:00:00.000Z", 24);
		const w = windowsFor(true, { slots, nowIso: "2026-08-04T10:00:00.000Z" });
		const future = slots.find((s) => s.startIso === "2026-08-04T16:00:00.000Z")!;
		const st = statusAt(w, future.startIso)!;
		assert.equal(st.status, "unknown");
		assert.equal(st.available, false);
	});
});

describe("PRESENCE-004 learned workday pattern", () => {
	it("predicts from weekday×bucket history without fixed clock rules in product", () => {
		const morningMs = Date.parse("2026-08-03T08:00:00.000Z"); // Monday
		const eveningMs = Date.parse("2026-08-03T16:00:00.000Z");
		const m = localBucketAt(morningMs, TZ);
		const e = localBucketAt(eveningMs, TZ);
		let store = emptyVehiclePresenceStore();
		store = seedBucket(store, m.weekday, m.bucketIndex, 2, 20, VEHICLE_A);
		store = seedBucket(store, e.weekday, e.bucketIndex, 18, 20, VEHICLE_A);
		const morningPred = predictFromCounts(2, 20);
		const eveningPred = predictFromCounts(18, 20);
		assert.equal(morningPred.status, "unavailable");
		assert.equal(eveningPred.status, "available");
		assert.ok((morningPred.confidencePct ?? 0) >= 45);

		const slots = buildSlots("2026-08-10T00:00:00.000Z", 24); // next Monday
		const w = windowsFor(false, {
			slots,
			nowIso: "2026-08-10T06:00:00.000Z",
			store,
			vehicleKey: VEHICLE_A,
		});
		const am = statusAt(w, "2026-08-10T08:00:00.000Z")!;
		const pm = statusAt(w, "2026-08-10T16:00:00.000Z")!;
		assert.equal(am.status, "unavailable");
		assert.equal(am.source, "predicted");
		assert.equal(pm.status, "available");
		assert.equal(pm.source, "predicted");
	});
});

describe("PRESENCE-005 too little history", () => {
	it("stays unknown below minimum observations", () => {
		const pred = predictFromCounts(1, MIN_OBSERVATIONS_FOR_PREDICTION - 1);
		assert.equal(pred.status, "unknown");
		assert.equal(pred.confidencePct, null);
	});
});

describe("PRESENCE-006 explicit beats learned", () => {
	it("explicit window overrides conflicting prediction", () => {
		const at = Date.parse("2026-08-10T12:00:00.000Z");
		const b = localBucketAt(at, TZ);
		let store = emptyVehiclePresenceStore();
		store = seedBucket(store, b.weekday, b.bucketIndex, 0, 20, VEHICLE_A); // would predict unavailable
		const slots = buildSlots("2026-08-10T00:00:00.000Z", 24);
		const w = windowsFor(false, {
			slots,
			nowIso: "2026-08-10T06:00:00.000Z",
			store,
			vehicleKey: VEHICLE_A,
			explicit: [
				{
					available: true,
					startIso: "2026-08-10T11:00:00.000Z",
					endIso: "2026-08-10T14:00:00.000Z",
				},
			],
		});
		const st = statusAt(w, "2026-08-10T12:00:00.000Z")!;
		assert.equal(st.status, "available");
		assert.equal(st.source, "explicit");
		assert.equal(st.hard, true);
	});
});

describe("PRESENCE-007 PV window not usable while unavailable", () => {
	it("no wallbox allocation in unavailable high-PV slots", () => {
		const input = golden002Input();
		// Peak PV midday while away (fixture windows)
		const plan = allocateUnifiedDayPlan(input);
		const mid = plan.allocations.filter(
			(a) =>
				a.kind === "wallbox" &&
				a.slot.startIso >= "2026-08-04T10:00:00.000Z" &&
				a.slot.startIso < "2026-08-04T13:30:00.000Z",
		);
		assert.equal(mid.length, 0);
	});
});

describe("PRESENCE-008 cheap import window usable when present", () => {
	it("allocator may use low-price available slots when PV insufficient", () => {
		const input = golden002Input();
		input.wallbox = {
			...input.wallbox!,
			connectedNow: true,
			presenceWindows: [
				{
					available: true,
					startIso: "2026-08-04T00:00:00.000Z",
					endIso: "2026-08-05T00:00:00.000Z",
					status: "available",
					source: "explicit",
					confidencePct: 100,
					hard: true,
				},
			],
			requiredEnergyKwh: 20,
			energyGoalHard: true,
			deadlineIso: "2026-08-04T18:00:00.000Z",
		};
		// flatten PV
		input.pv.slots = input.pv.slots.map((s) => ({
			...s,
			forecastPowerW: 200,
			energyKwh: 0.05,
		}));
		const plan = allocateUnifiedDayPlan(input);
		const cheapGrid = plan.allocations.filter(
			(a) =>
				a.kind === "wallbox" &&
				a.energySource === "grid" &&
				a.slot.startIso < "2026-08-04T05:00:00.000Z",
		);
		assert.ok(cheapGrid.length > 0);
		assert.ok(
			cheapGrid.some((a) => a.reasonCodes.includes(REASON.VEHICLE_IMPORT_WINDOW_AVAILABLE)),
		);
	});
});

describe("PRESENCE-009 goal unreachable", () => {
	it("marks unreachable when physical charge time insufficient", () => {
		const input = golden002Input();
		input.time = { ...input.time, nowIso: "2026-08-04T16:00:00.000Z" };
		input.wallbox = {
			...input.wallbox!,
			connectedNow: true,
			presenceWindows: [
				{
					available: true,
					startIso: "2026-08-04T16:00:00.000Z",
					endIso: "2026-08-04T17:00:00.000Z",
					status: "available",
					source: "live_connected",
					hard: true,
					confidencePct: 100,
				},
			],
			requiredEnergyKwh: 40,
			maxChargePowerW: 7000,
			deadlineIso: "2026-08-04T17:00:00.000Z",
			energyGoalHard: true,
		};
		const f = evaluateVehicleGoalFeasibility(input);
		assert.equal(f.status, "unreachable");
		assert.ok(f.reasonCodes.includes(REASON.VEHICLE_GOAL_UNREACHABLE));
		const plan = allocateUnifiedDayPlan(input);
		const g = plan.goalStatuses.find((x) => x.goalId === "energy_deadline");
		assert.equal(g?.met, false);
	});
});

describe("PRESENCE-010 unknown prevents false certainty", () => {
	it("does not claim reachable when only unknown future could cover need", () => {
		const slots = buildSlots("2026-08-04T00:00:00.000Z", 24);
		const nowIso = "2026-08-04T10:00:00.000Z";
		const presenceWindows = buildVehicleAvailabilityWindows({
			nowIso,
			timezone: TZ,
			slots,
			connectedNow: true,
			learningStore: null,
		});
		const input: UnifiedDayPlannerInput = {
			...golden002Input(),
			time: { ...golden002Input().time, nowIso, slots },
			wallbox: {
				...golden002Input().wallbox!,
				connectedNow: true,
				presenceWindows,
				requiredEnergyKwh: 25,
				maxChargePowerW: 11000,
				deadlineIso: "2026-08-04T22:00:00.000Z",
				energyGoalHard: true,
			},
		};
		const f = evaluateVehicleGoalFeasibility(input);
		assert.notEqual(f.status, "reachable");
		assert.ok(
			f.reasonCodes.includes(REASON.VEHICLE_GOAL_AT_RISK_DUE_TO_UNKNOWN_AVAILABILITY) ||
				f.status === "unreachable" ||
				f.status === "at_risk_unknown",
		);
	});
});

describe("PRESENCE-011 connect event", () => {
	it("material replan on connect", () => {
		const b: PlanBaseline = {
			date: "2026-08-07",
			planId: "p",
			generation: 1,
			createdAtMs: 1,
			expectedPvDayKwh: 20,
			realizedPvKwhAtPlan: 0,
			expectedHouseLoadDayKwh: 10,
			batterySocPct: 40,
			thermalHeadroomKwh: null,
			bufferTempC: null,
			thermalEmptyAtIso: null,
			acMandatoryAny: false,
			vehicleConnected: false,
			vehicleRequiredEnergyKwh: 10,
			vehicleDeadlineIso: "2026-08-07T20:00:00.000Z",
			vehicleTargetSocPct: 80,
			priceMedianCt: 20,
			priceStructureDigest: "p",
			presenceDigest: "disc",
			cadenceDigest: "c",
		};
		const a: PlanActualSample = {
			...b,
			nowMs: Date.now(),
			forecastPvDayKwh: 20,
			realizedPvKwh: 0,
			forecastHouseLoadDayKwh: 10,
			thermalBlocked: false,
			vehicleConnected: true,
			presenceDigest: "conn",
		};
		const d = evaluateMaterialReplan(b, a);
		assert.equal(d.shouldReplan, true);
		assert.ok(d.reasons.includes(REASON.REPLAN_VEHICLE_CONNECTED));
		assert.equal(d.hard, true);
	});
});

describe("PRESENCE-LEARN-001 same bucket ticks", () => {
	it("15 runtime ticks in one 15-min bucket → observedCount +1", () => {
		const baseMs = Date.parse("2026-08-03T08:00:00.000Z"); // Monday
		const { weekday, bucketIndex } = localBucketAt(baseMs, TZ);
		let store = emptyVehiclePresenceStore();
		for (let i = 0; i < 15; i++) {
			store = observeConnected(store, baseMs + i * 60_000, TZ, true, VEHICLE_A);
		}
		const stats = bucketStatsForTest(store, VEHICLE_A, weekday, bucketIndex)!;
		assert.equal(stats.observedCount, 1);
		assert.equal(stats.connectedCount, 1);
	});
});

describe("PRESENCE-LEARN-002 eight independent days", () => {
	it("same weekday/bucket over 8 days → prediction allowed", () => {
		const { weekday, bucketIndex } = localBucketAt(Date.parse("2026-08-03T08:00:00.000Z"), TZ);
		let store = emptyVehiclePresenceStore();
		for (let week = 0; week < 8; week++) {
			const ms = Date.parse("2026-08-03T08:00:00.000Z") + week * 7 * 86_400_000;
			store = observeConnected(store, ms, TZ, false, VEHICLE_A);
		}
		const stats = bucketStatsForTest(store, VEHICLE_A, weekday, bucketIndex)!;
		assert.equal(stats.observedCount, 8);
		const pred = predictFromCounts(stats.connectedCount, stats.observedCount);
		assert.equal(pred.status, "unavailable");
		assert.equal(pred.source, "predicted");
	});
});

describe("PRESENCE-LEARN-003 many ticks few days", () => {
	it("stays unknown despite many runtime ticks", () => {
		const baseMs = Date.parse("2026-08-03T08:00:00.000Z");
		const { weekday, bucketIndex } = localBucketAt(baseMs, TZ);
		let store = emptyVehiclePresenceStore();
		for (let day = 0; day < 3; day++) {
			const dayMs = baseMs + day * 7 * 86_400_000;
			for (let i = 0; i < 20; i++) {
				store = observeConnected(store, dayMs + i * 60_000, TZ, true, VEHICLE_A);
			}
		}
		const stats = bucketStatsForTest(store, VEHICLE_A, weekday, bucketIndex)!;
		assert.equal(stats.observedCount, 3);
		assert.ok(stats.observedCount < MIN_OBSERVATIONS_FOR_PREDICTION);
		assert.equal(predictFromCounts(stats.connectedCount, stats.observedCount).status, "unknown");
	});
});

describe("PRESENCE-LEARN-004 profile isolation", () => {
	it("two vehicle profiles do not mix history", () => {
		const ms = Date.parse("2026-08-03T08:00:00.000Z");
		const { weekday, bucketIndex } = localBucketAt(ms, TZ);
		let store = emptyVehiclePresenceStore();
		for (let week = 0; week < 10; week++) {
			const t = ms + week * 7 * 86_400_000;
			store = observeConnected(store, t, TZ, false, VEHICLE_A);
			store = observeConnected(store, t, TZ, true, VEHICLE_B);
		}
		const a = bucketStatsForTest(store, VEHICLE_A, weekday, bucketIndex)!;
		const b = bucketStatsForTest(store, VEHICLE_B, weekday, bucketIndex)!;
		assert.equal(a.observedCount, 10);
		assert.equal(a.connectedCount, 0);
		assert.equal(b.observedCount, 10);
		assert.equal(b.connectedCount, 10);
		assert.equal(predictAt(store, ms, TZ, VEHICLE_A).status, "unavailable");
		assert.equal(predictAt(store, ms, TZ, VEHICLE_B).status, "available");
	});
});

describe("PRESENCE-LEARN-005 live beats learned", () => {
	it("current live connected wins over predicted unavailable", () => {
		const nowIso = "2026-08-10T08:07:00.000Z";
		const morningMs = Date.parse(nowIso);
		const { weekday, bucketIndex } = localBucketAt(morningMs, TZ);
		let store = emptyVehiclePresenceStore();
		store = seedBucket(store, weekday, bucketIndex, 0, 20, VEHICLE_A);
		const slots = buildSlots("2026-08-10T00:00:00.000Z", 24);
		const w = windowsFor(true, {
			slots,
			nowIso,
			store,
			vehicleKey: VEHICLE_A,
		});
		const current = slots.find(
			(s) => Date.parse(s.startIso) <= morningMs && morningMs < Date.parse(s.endIso),
		)!;
		const cur = statusAt(w, current.startIso)!;
		assert.equal(cur.source, "live_connected");
		assert.equal(cur.status, "available");
		assert.equal(cur.hard, true);
	});
});

describe("PRESENCE-012 disconnect event", () => {
	it("material replan on disconnect; future wallbox cleared when presence empty", () => {
		const b: PlanBaseline = {
			date: "2026-08-07",
			planId: "p",
			generation: 1,
			createdAtMs: 1,
			expectedPvDayKwh: 20,
			realizedPvKwhAtPlan: 0,
			expectedHouseLoadDayKwh: 10,
			batterySocPct: 40,
			thermalHeadroomKwh: null,
			bufferTempC: null,
			thermalEmptyAtIso: null,
			acMandatoryAny: false,
			vehicleConnected: true,
			vehicleRequiredEnergyKwh: 10,
			vehicleDeadlineIso: "2026-08-07T20:00:00.000Z",
			vehicleTargetSocPct: 80,
			priceMedianCt: 20,
			priceStructureDigest: "p",
			presenceDigest: "conn",
			cadenceDigest: "c",
		};
		const a: PlanActualSample = {
			...b,
			nowMs: Date.now(),
			forecastPvDayKwh: 20,
			realizedPvKwh: 0,
			forecastHouseLoadDayKwh: 10,
			thermalBlocked: false,
			vehicleConnected: false,
			presenceDigest: "disc",
		};
		const d = evaluateMaterialReplan(b, a);
		assert.equal(d.shouldReplan, true);
		assert.ok(d.reasons.includes(REASON.REPLAN_VEHICLE_DISCONNECTED));

		const input = golden002Input();
		input.wallbox = {
			...input.wallbox!,
			connectedNow: true,
			presenceWindows: [
				{
					available: true,
					startIso: "2026-08-04T00:00:00.000Z",
					endIso: "2026-08-05T00:00:00.000Z",
					status: "available",
					source: "explicit",
					hard: true,
					confidencePct: 100,
				},
			],
		};
		const first = allocateUnifiedDayPlan(input);
		assert.ok(first.allocations.some((x) => x.kind === "wallbox"));
		const discInput = {
			...input,
			time: { ...input.time, nowIso: "2026-08-04T14:00:00.000Z" },
			wallbox: {
				...input.wallbox!,
				connectedNow: false,
				presenceWindows: buildVehicleAvailabilityWindows({
					nowIso: "2026-08-04T14:00:00.000Z",
					timezone: TZ,
					slots: input.time.slots,
					connectedNow: false,
				}),
			},
		};
		const second = allocateUnifiedDayPlan(discInput, {
			generation: 2,
			previousPlan: first,
			extraReasonCodes: [REASON.REPLAN_VEHICLE_DISCONNECTED],
		});
		const futureWb = second.allocations.filter(
			(x) =>
				x.kind === "wallbox" &&
				Date.parse(x.slot.endIso) > Date.parse("2026-08-04T14:00:00.000Z"),
		);
		assert.equal(futureWb.length, 0);
		void presenceDigest;
	});
});
