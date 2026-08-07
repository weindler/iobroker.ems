"use strict";
/**
 * PRESENCE-001…012 — Future Vehicle Presence / Availability.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const vehicle_presence_1 = require("../../../learning/vehicle_presence");
const allocate_1 = require("./allocate");
const fixtures_1 = require("./fixtures");
const materiality_1 = require("./materiality");
const reason_codes_1 = require("./reason_codes");
const vehicle_availability_1 = require("./vehicle_availability");
const TZ = "UTC";
const VEHICLE_A = "ford";
const VEHICLE_B = "guest_car";
function windowsFor(connectedNow, opts = {}) {
    const slots = opts.slots ?? (0, fixtures_1.buildSlots)("2026-08-04T00:00:00.000Z", 24);
    return (0, vehicle_availability_1.buildVehicleAvailabilityWindows)({
        nowIso: opts.nowIso ?? "2026-08-04T10:00:00.000Z",
        timezone: TZ,
        slots,
        connectedNow,
        explicitWindows: opts.explicit ?? null,
        learningStore: opts.store ?? null,
        learningVehicleKey: opts.vehicleKey === undefined ? VEHICLE_A : opts.vehicleKey,
    });
}
function statusAt(windows, slotStartIso) {
    for (const w of windows) {
        const t = Date.parse(slotStartIso);
        if (t >= Date.parse(w.startIso) && t < Date.parse(w.endIso)) {
            return (0, vehicle_availability_1.normalizePresenceWindow)(w);
        }
    }
    return null;
}
(0, node_test_1.describe)("PRESENCE-001 connected now", () => {
    (0, node_test_1.it)("current slot is available (live)", () => {
        const slots = (0, fixtures_1.buildSlots)("2026-08-04T00:00:00.000Z", 24);
        const nowIso = "2026-08-04T10:07:00.000Z";
        const current = slots.find((s) => Date.parse(s.startIso) <= Date.parse(nowIso) && Date.parse(nowIso) < Date.parse(s.endIso));
        const w = windowsFor(true, { slots, nowIso });
        const cur = statusAt(w, current.startIso);
        strict_1.default.equal(cur.status, "available");
        strict_1.default.equal(cur.source, "live_connected");
        strict_1.default.equal(cur.hard, true);
    });
});
(0, node_test_1.describe)("PRESENCE-002 disconnected now", () => {
    (0, node_test_1.it)("current slot is hard unavailable", () => {
        const slots = (0, fixtures_1.buildSlots)("2026-08-04T00:00:00.000Z", 24);
        const nowIso = "2026-08-04T10:07:00.000Z";
        const current = slots.find((s) => Date.parse(s.startIso) <= Date.parse(nowIso) && Date.parse(nowIso) < Date.parse(s.endIso));
        const w = windowsFor(false, { slots, nowIso });
        const cur = statusAt(w, current.startIso);
        strict_1.default.equal(cur.status, "unavailable");
        strict_1.default.equal(cur.source, "live_disconnected");
        strict_1.default.equal(cur.hard, true);
    });
});
(0, node_test_1.describe)("PRESENCE-003 unknown future", () => {
    (0, node_test_1.it)("future slots are unknown without history/plan — not available", () => {
        const slots = (0, fixtures_1.buildSlots)("2026-08-04T00:00:00.000Z", 24);
        const w = windowsFor(true, { slots, nowIso: "2026-08-04T10:00:00.000Z" });
        const future = slots.find((s) => s.startIso === "2026-08-04T16:00:00.000Z");
        const st = statusAt(w, future.startIso);
        strict_1.default.equal(st.status, "unknown");
        strict_1.default.equal(st.available, false);
    });
});
(0, node_test_1.describe)("PRESENCE-004 learned workday pattern", () => {
    (0, node_test_1.it)("predicts from weekday×bucket history without fixed clock rules in product", () => {
        const morningMs = Date.parse("2026-08-03T08:00:00.000Z"); // Monday
        const eveningMs = Date.parse("2026-08-03T16:00:00.000Z");
        const m = (0, vehicle_presence_1.localBucketAt)(morningMs, TZ);
        const e = (0, vehicle_presence_1.localBucketAt)(eveningMs, TZ);
        let store = (0, vehicle_presence_1.emptyVehiclePresenceStore)();
        store = (0, vehicle_presence_1.seedBucket)(store, m.weekday, m.bucketIndex, 2, 20, VEHICLE_A);
        store = (0, vehicle_presence_1.seedBucket)(store, e.weekday, e.bucketIndex, 18, 20, VEHICLE_A);
        const morningPred = (0, vehicle_presence_1.predictFromCounts)(2, 20);
        const eveningPred = (0, vehicle_presence_1.predictFromCounts)(18, 20);
        strict_1.default.equal(morningPred.status, "unavailable");
        strict_1.default.equal(eveningPred.status, "available");
        strict_1.default.ok((morningPred.confidencePct ?? 0) >= 45);
        const slots = (0, fixtures_1.buildSlots)("2026-08-10T00:00:00.000Z", 24); // next Monday
        const w = windowsFor(false, {
            slots,
            nowIso: "2026-08-10T06:00:00.000Z",
            store,
            vehicleKey: VEHICLE_A,
        });
        const am = statusAt(w, "2026-08-10T08:00:00.000Z");
        const pm = statusAt(w, "2026-08-10T16:00:00.000Z");
        strict_1.default.equal(am.status, "unavailable");
        strict_1.default.equal(am.source, "predicted");
        strict_1.default.equal(pm.status, "available");
        strict_1.default.equal(pm.source, "predicted");
    });
});
(0, node_test_1.describe)("PRESENCE-005 too little history", () => {
    (0, node_test_1.it)("stays unknown below minimum observations", () => {
        const pred = (0, vehicle_presence_1.predictFromCounts)(1, vehicle_presence_1.MIN_OBSERVATIONS_FOR_PREDICTION - 1);
        strict_1.default.equal(pred.status, "unknown");
        strict_1.default.equal(pred.confidencePct, null);
    });
});
(0, node_test_1.describe)("PRESENCE-006 explicit beats learned", () => {
    (0, node_test_1.it)("explicit window overrides conflicting prediction", () => {
        const at = Date.parse("2026-08-10T12:00:00.000Z");
        const b = (0, vehicle_presence_1.localBucketAt)(at, TZ);
        let store = (0, vehicle_presence_1.emptyVehiclePresenceStore)();
        store = (0, vehicle_presence_1.seedBucket)(store, b.weekday, b.bucketIndex, 0, 20, VEHICLE_A); // would predict unavailable
        const slots = (0, fixtures_1.buildSlots)("2026-08-10T00:00:00.000Z", 24);
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
        const st = statusAt(w, "2026-08-10T12:00:00.000Z");
        strict_1.default.equal(st.status, "available");
        strict_1.default.equal(st.source, "explicit");
        strict_1.default.equal(st.hard, true);
    });
});
(0, node_test_1.describe)("PRESENCE-007 PV window not usable while unavailable", () => {
    (0, node_test_1.it)("no wallbox allocation in unavailable high-PV slots", () => {
        const input = (0, fixtures_1.golden002Input)();
        // Peak PV midday while away (fixture windows)
        const plan = (0, allocate_1.allocateUnifiedDayPlan)(input);
        const mid = plan.allocations.filter((a) => a.kind === "wallbox" &&
            a.slot.startIso >= "2026-08-04T10:00:00.000Z" &&
            a.slot.startIso < "2026-08-04T13:30:00.000Z");
        strict_1.default.equal(mid.length, 0);
    });
});
(0, node_test_1.describe)("PRESENCE-008 cheap import window usable when present", () => {
    (0, node_test_1.it)("allocator may use low-price available slots when PV insufficient", () => {
        const input = (0, fixtures_1.golden002Input)();
        input.wallbox = {
            ...input.wallbox,
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
        const plan = (0, allocate_1.allocateUnifiedDayPlan)(input);
        const cheapGrid = plan.allocations.filter((a) => a.kind === "wallbox" &&
            a.energySource === "grid" &&
            a.slot.startIso < "2026-08-04T05:00:00.000Z");
        strict_1.default.ok(cheapGrid.length > 0);
        strict_1.default.ok(cheapGrid.some((a) => a.reasonCodes.includes(reason_codes_1.REASON.VEHICLE_IMPORT_WINDOW_AVAILABLE)));
    });
});
(0, node_test_1.describe)("PRESENCE-009 goal unreachable", () => {
    (0, node_test_1.it)("marks unreachable when physical charge time insufficient", () => {
        const input = (0, fixtures_1.golden002Input)();
        input.time = { ...input.time, nowIso: "2026-08-04T16:00:00.000Z" };
        input.wallbox = {
            ...input.wallbox,
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
        const f = (0, vehicle_availability_1.evaluateVehicleGoalFeasibility)(input);
        strict_1.default.equal(f.status, "unreachable");
        strict_1.default.ok(f.reasonCodes.includes(reason_codes_1.REASON.VEHICLE_GOAL_UNREACHABLE));
        const plan = (0, allocate_1.allocateUnifiedDayPlan)(input);
        const g = plan.goalStatuses.find((x) => x.goalId === "energy_deadline");
        strict_1.default.equal(g?.met, false);
    });
});
(0, node_test_1.describe)("PRESENCE-010 unknown prevents false certainty", () => {
    (0, node_test_1.it)("does not claim reachable when only unknown future could cover need", () => {
        const slots = (0, fixtures_1.buildSlots)("2026-08-04T00:00:00.000Z", 24);
        const nowIso = "2026-08-04T10:00:00.000Z";
        const presenceWindows = (0, vehicle_availability_1.buildVehicleAvailabilityWindows)({
            nowIso,
            timezone: TZ,
            slots,
            connectedNow: true,
            learningStore: null,
        });
        const input = {
            ...(0, fixtures_1.golden002Input)(),
            time: { ...(0, fixtures_1.golden002Input)().time, nowIso, slots },
            wallbox: {
                ...(0, fixtures_1.golden002Input)().wallbox,
                connectedNow: true,
                presenceWindows,
                requiredEnergyKwh: 25,
                maxChargePowerW: 11000,
                deadlineIso: "2026-08-04T22:00:00.000Z",
                energyGoalHard: true,
            },
        };
        const f = (0, vehicle_availability_1.evaluateVehicleGoalFeasibility)(input);
        strict_1.default.notEqual(f.status, "reachable");
        strict_1.default.ok(f.reasonCodes.includes(reason_codes_1.REASON.VEHICLE_GOAL_AT_RISK_DUE_TO_UNKNOWN_AVAILABILITY) ||
            f.status === "unreachable" ||
            f.status === "at_risk_unknown");
    });
});
(0, node_test_1.describe)("PRESENCE-011 connect event", () => {
    (0, node_test_1.it)("material replan on connect", () => {
        const b = {
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
        const a = {
            ...b,
            nowMs: Date.now(),
            forecastPvDayKwh: 20,
            realizedPvKwh: 0,
            forecastHouseLoadDayKwh: 10,
            thermalBlocked: false,
            vehicleConnected: true,
            presenceDigest: "conn",
        };
        const d = (0, materiality_1.evaluateMaterialReplan)(b, a);
        strict_1.default.equal(d.shouldReplan, true);
        strict_1.default.ok(d.reasons.includes(reason_codes_1.REASON.REPLAN_VEHICLE_CONNECTED));
        strict_1.default.equal(d.hard, true);
    });
});
(0, node_test_1.describe)("PRESENCE-LEARN-001 same bucket ticks", () => {
    (0, node_test_1.it)("15 runtime ticks in one 15-min bucket → observedCount +1", () => {
        const baseMs = Date.parse("2026-08-03T08:00:00.000Z"); // Monday
        const { weekday, bucketIndex } = (0, vehicle_presence_1.localBucketAt)(baseMs, TZ);
        let store = (0, vehicle_presence_1.emptyVehiclePresenceStore)();
        for (let i = 0; i < 15; i++) {
            store = (0, vehicle_presence_1.observeConnected)(store, baseMs + i * 60_000, TZ, true, VEHICLE_A);
        }
        const stats = (0, vehicle_presence_1.bucketStatsForTest)(store, VEHICLE_A, weekday, bucketIndex);
        strict_1.default.equal(stats.observedCount, 1);
        strict_1.default.equal(stats.connectedCount, 1);
    });
});
(0, node_test_1.describe)("PRESENCE-LEARN-002 eight independent days", () => {
    (0, node_test_1.it)("same weekday/bucket over 8 days → prediction allowed", () => {
        const { weekday, bucketIndex } = (0, vehicle_presence_1.localBucketAt)(Date.parse("2026-08-03T08:00:00.000Z"), TZ);
        let store = (0, vehicle_presence_1.emptyVehiclePresenceStore)();
        for (let week = 0; week < 8; week++) {
            const ms = Date.parse("2026-08-03T08:00:00.000Z") + week * 7 * 86_400_000;
            store = (0, vehicle_presence_1.observeConnected)(store, ms, TZ, false, VEHICLE_A);
        }
        const stats = (0, vehicle_presence_1.bucketStatsForTest)(store, VEHICLE_A, weekday, bucketIndex);
        strict_1.default.equal(stats.observedCount, 8);
        const pred = (0, vehicle_presence_1.predictFromCounts)(stats.connectedCount, stats.observedCount);
        strict_1.default.equal(pred.status, "unavailable");
        strict_1.default.equal(pred.source, "predicted");
    });
});
(0, node_test_1.describe)("PRESENCE-LEARN-003 many ticks few days", () => {
    (0, node_test_1.it)("stays unknown despite many runtime ticks", () => {
        const baseMs = Date.parse("2026-08-03T08:00:00.000Z");
        const { weekday, bucketIndex } = (0, vehicle_presence_1.localBucketAt)(baseMs, TZ);
        let store = (0, vehicle_presence_1.emptyVehiclePresenceStore)();
        for (let day = 0; day < 3; day++) {
            const dayMs = baseMs + day * 7 * 86_400_000;
            for (let i = 0; i < 20; i++) {
                store = (0, vehicle_presence_1.observeConnected)(store, dayMs + i * 60_000, TZ, true, VEHICLE_A);
            }
        }
        const stats = (0, vehicle_presence_1.bucketStatsForTest)(store, VEHICLE_A, weekday, bucketIndex);
        strict_1.default.equal(stats.observedCount, 3);
        strict_1.default.ok(stats.observedCount < vehicle_presence_1.MIN_OBSERVATIONS_FOR_PREDICTION);
        strict_1.default.equal((0, vehicle_presence_1.predictFromCounts)(stats.connectedCount, stats.observedCount).status, "unknown");
    });
});
(0, node_test_1.describe)("PRESENCE-LEARN-004 profile isolation", () => {
    (0, node_test_1.it)("two vehicle profiles do not mix history", () => {
        const ms = Date.parse("2026-08-03T08:00:00.000Z");
        const { weekday, bucketIndex } = (0, vehicle_presence_1.localBucketAt)(ms, TZ);
        let store = (0, vehicle_presence_1.emptyVehiclePresenceStore)();
        for (let week = 0; week < 10; week++) {
            const t = ms + week * 7 * 86_400_000;
            store = (0, vehicle_presence_1.observeConnected)(store, t, TZ, false, VEHICLE_A);
            store = (0, vehicle_presence_1.observeConnected)(store, t, TZ, true, VEHICLE_B);
        }
        const a = (0, vehicle_presence_1.bucketStatsForTest)(store, VEHICLE_A, weekday, bucketIndex);
        const b = (0, vehicle_presence_1.bucketStatsForTest)(store, VEHICLE_B, weekday, bucketIndex);
        strict_1.default.equal(a.observedCount, 10);
        strict_1.default.equal(a.connectedCount, 0);
        strict_1.default.equal(b.observedCount, 10);
        strict_1.default.equal(b.connectedCount, 10);
        strict_1.default.equal((0, vehicle_presence_1.predictAt)(store, ms, TZ, VEHICLE_A).status, "unavailable");
        strict_1.default.equal((0, vehicle_presence_1.predictAt)(store, ms, TZ, VEHICLE_B).status, "available");
    });
});
(0, node_test_1.describe)("PRESENCE-LEARN-005 live beats learned", () => {
    (0, node_test_1.it)("current live connected wins over predicted unavailable", () => {
        const nowIso = "2026-08-10T08:07:00.000Z";
        const morningMs = Date.parse(nowIso);
        const { weekday, bucketIndex } = (0, vehicle_presence_1.localBucketAt)(morningMs, TZ);
        let store = (0, vehicle_presence_1.emptyVehiclePresenceStore)();
        store = (0, vehicle_presence_1.seedBucket)(store, weekday, bucketIndex, 0, 20, VEHICLE_A);
        const slots = (0, fixtures_1.buildSlots)("2026-08-10T00:00:00.000Z", 24);
        const w = windowsFor(true, {
            slots,
            nowIso,
            store,
            vehicleKey: VEHICLE_A,
        });
        const current = slots.find((s) => Date.parse(s.startIso) <= morningMs && morningMs < Date.parse(s.endIso));
        const cur = statusAt(w, current.startIso);
        strict_1.default.equal(cur.source, "live_connected");
        strict_1.default.equal(cur.status, "available");
        strict_1.default.equal(cur.hard, true);
    });
});
(0, node_test_1.describe)("PRESENCE-012 disconnect event", () => {
    (0, node_test_1.it)("material replan on disconnect; future wallbox cleared when presence empty", () => {
        const b = {
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
        const a = {
            ...b,
            nowMs: Date.now(),
            forecastPvDayKwh: 20,
            realizedPvKwh: 0,
            forecastHouseLoadDayKwh: 10,
            thermalBlocked: false,
            vehicleConnected: false,
            presenceDigest: "disc",
        };
        const d = (0, materiality_1.evaluateMaterialReplan)(b, a);
        strict_1.default.equal(d.shouldReplan, true);
        strict_1.default.ok(d.reasons.includes(reason_codes_1.REASON.REPLAN_VEHICLE_DISCONNECTED));
        const input = (0, fixtures_1.golden002Input)();
        input.wallbox = {
            ...input.wallbox,
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
        const first = (0, allocate_1.allocateUnifiedDayPlan)(input);
        strict_1.default.ok(first.allocations.some((x) => x.kind === "wallbox"));
        const discInput = {
            ...input,
            time: { ...input.time, nowIso: "2026-08-04T14:00:00.000Z" },
            wallbox: {
                ...input.wallbox,
                connectedNow: false,
                presenceWindows: (0, vehicle_availability_1.buildVehicleAvailabilityWindows)({
                    nowIso: "2026-08-04T14:00:00.000Z",
                    timezone: TZ,
                    slots: input.time.slots,
                    connectedNow: false,
                }),
            },
        };
        const second = (0, allocate_1.allocateUnifiedDayPlan)(discInput, {
            generation: 2,
            previousPlan: first,
            extraReasonCodes: [reason_codes_1.REASON.REPLAN_VEHICLE_DISCONNECTED],
        });
        const futureWb = second.allocations.filter((x) => x.kind === "wallbox" &&
            Date.parse(x.slot.endIso) > Date.parse("2026-08-04T14:00:00.000Z"));
        strict_1.default.equal(futureWb.length, 0);
        void vehicle_availability_1.presenceDigest;
    });
});
