"use strict";
/**
 * Climate Daily-Plan Slot/Range Consistency — Realfall 11.08.2026.
 * T1–T8 + E2E Forecast→Unified→Dispatch→Runtime.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const contribution_ids_1 = require("../../contribution_ids");
const contributor_1 = require("../../contributor");
const product_summary_1 = require("../../../beta/product_summary");
const plan_visibility_1 = require("../../../beta/plan_visibility");
const daily_plan_1 = require("../../../addons/air_conditioning/runtime/daily_plan");
const config_1 = require("../../../addons/air_conditioning/config");
const allocate_1 = require("./allocate");
const score_allocate_1 = require("./score_allocate");
const dispatch_bridge_1 = require("./dispatch_bridge");
const slot_geometry_1 = require("./slot_geometry");
const fixtures_1 = require("./fixtures");
const TZ = "Europe/Berlin";
/** 11.08.2026 10:00–14:00 lokal = 08:00Z–12:00Z (CEST). */
const MIDDAY_START = "2026-08-11T08:00:00.000Z";
const MIDDAY_END = "2026-08-11T12:00:00.000Z";
const NOW_1033 = "2026-08-11T08:33:00.000Z";
const SLOT_1030 = "2026-08-11T08:30:00.000Z";
const SLOT_1045 = "2026-08-11T08:45:00.000Z";
const Q = {
    status: "valid",
    confidencePct: 80,
    reasonDe: "test",
};
const FRESH = { observedAtIso: NOW_1033, ageSec: 0, quality: Q };
function climateCell(startIso, endIso, powerW, consumerId = "air_conditioning.unit_1") {
    const energy = (0, slot_geometry_1.expectedEnergyKwhForPower)(powerW, slot_geometry_1.CANONICAL_SLOT_H);
    return {
        slot: { startIso, endIso },
        consumerId,
        kind: "climate",
        allocatedPowerW: powerW,
        allocatedEnergyKwh: Math.round(energy * 1000) / 1000,
        energySource: "pv_surplus",
        constraintIds: ["climate.flex"],
        reasonCodes: ["climate_flex"],
    };
}
function realCaseInput(nowIso) {
    const quarters = (0, fixtures_1.buildSlots)(MIDDAY_START, 4); // 10:00–14:00 lokal
    const before = (0, fixtures_1.buildSlots)("2026-08-11T06:00:00.000Z", 2);
    const after = (0, fixtures_1.buildSlots)(MIDDAY_END, 2);
    const slots = [...before, ...quarters, ...after];
    return {
        schemaVersion: 1,
        planIntent: "unified_day",
        time: {
            nowIso,
            timezone: TZ,
            horizonStartIso: slots[0].startIso,
            horizonEndIso: slots[slots.length - 1].endIso,
            slotMinutes: 15,
            slots: [
                ...slots,
                /** Realfall-Gift: Hauslast-Segment mit gleichem startIso wie erster Quarter. */
                { startIso: MIDDAY_START, endIso: MIDDAY_END },
            ],
            freshness: FRESH,
        },
        pv: {
            slots: slots.map((s) => ({
                slot: s,
                forecastPowerW: 4000,
                observedPowerW: null,
                energyKwh: (0, score_allocate_1.energyFromPowerW)(4000),
            })),
            expectedDayEnergyKwh: 40,
            previousExpectedDayEnergyKwh: null,
            biasCorrected: true,
            biasPct: null,
            uncertainty: Q,
            freshness: FRESH,
        },
        houseLoad: {
            slots: [
                {
                    slot: { startIso: MIDDAY_START, endIso: MIDDAY_END },
                    forecastPowerW: 800,
                    observedPowerW: null,
                    energyKwh: (800 / 1000) * 4,
                },
            ],
            expectedDayEnergyKwh: 12,
            uncertainty: Q,
            freshness: FRESH,
        },
        prices: {
            slots: slots.map((s) => ({
                slot: s,
                importCtPerKwh: 28,
                exportCtPerKwh: 8,
                gridImportAllowed: true,
            })),
            uncertainty: Q,
            freshness: FRESH,
        },
        battery: {
            socPct: 70,
            usableCapacityKwh: 15,
            maxChargePowerW: 5000,
            maxDischargePowerW: 5000,
            minSocPct: 10,
            maxSocPct: 100,
            reserveSocPct: 20,
            nightReserveKwh: null,
            endSocTargetPct: 90,
            requiredChargeEnergyKwh: null,
            chargeDeadlineIso: null,
            gridChargeAllowed: true,
            allowedModes: ["idle", "charge"],
            chargeEfficiency: 0.95,
            dischargeEfficiency: 0.95,
            dischargeLiveSupported: false,
            profileId: "sonnen_em",
            uncertainty: Q,
            freshness: FRESH,
            passiveBatteryEnergyAvailable: false,
        },
        wallbox: null,
        thermal: null,
        climate: {
            units: [
                {
                    unitId: "air_conditioning.unit_1",
                    label: "Wohnzimmer EG",
                    roomTempC: 26,
                    comfortMinC: null,
                    comfortMaxC: 24,
                    targetTempC: 24.5,
                    mandatoryComfort: true,
                    expectedEnergyKwh: (0, slot_geometry_1.expectedEnergyKwhForPower)(850, slot_geometry_1.CANONICAL_SLOT_H) * 4,
                    typicalPowerW: 850,
                    maxShiftHours: 0,
                    uncertainty: Q,
                    hardwareRunning: false,
                    runtimeHold: false,
                    holdPowerW: null,
                },
            ],
            freshness: FRESH,
        },
        otherFlex: [],
        globalMode: "balanced",
        preferImmersionLiveSurplusNow: false,
        contributionRevision: 1,
    };
}
(0, node_test_1.describe)("climate slot consistency — T1 energy/duration", () => {
    (0, node_test_1.it)("T1: 850 W / 15 min → ~0.2125 kWh, Slotdauer 15 min", () => {
        strict_1.default.equal(score_allocate_1.SLOT_H, 0.25);
        strict_1.default.equal(slot_geometry_1.CANONICAL_SLOT_H, 0.25);
        const e = (0, score_allocate_1.energyFromPowerW)(850);
        strict_1.default.ok(Math.abs(e - 0.2125) < 1e-9);
        const p = (0, score_allocate_1.powerFromEnergyKwh)(e);
        strict_1.default.ok(Math.abs(p - 850) < 0.01);
        strict_1.default.ok((0, slot_geometry_1.isCanonicalQuarterSlot)(SLOT_1030, SLOT_1045));
        const cell = climateCell(SLOT_1030, SLOT_1045, 850);
        strict_1.default.ok((0, slot_geometry_1.isExecutableUnifiedCell)(cell));
        strict_1.default.equal(Date.parse(cell.slot.endIso) - Date.parse(cell.slot.startIso), slot_geometry_1.CANONICAL_SLOT_MS);
    });
});
(0, node_test_1.describe)("climate slot consistency — T2/T3/T4 display vs execution", () => {
    (0, node_test_1.it)("T2: four contiguous quarters → display 1 h / 0.85 kWh; execution stays 4 cells", () => {
        const cells = [
            climateCell("2026-08-11T08:00:00.000Z", "2026-08-11T08:15:00.000Z", 850),
            climateCell("2026-08-11T08:15:00.000Z", "2026-08-11T08:30:00.000Z", 850),
            climateCell("2026-08-11T08:30:00.000Z", "2026-08-11T08:45:00.000Z", 850),
            climateCell("2026-08-11T08:45:00.000Z", "2026-08-11T09:00:00.000Z", 850),
        ];
        const execBefore = JSON.stringify(cells);
        const windows = (0, product_summary_1.mergeWindows)(cells, "climate");
        strict_1.default.equal(windows.length, 1);
        strict_1.default.equal(windows[0].startIso, "2026-08-11T08:00:00.000Z");
        strict_1.default.equal(windows[0].endIso, "2026-08-11T09:00:00.000Z");
        strict_1.default.ok(Math.abs(windows[0].energyKwh - 0.85) < 0.01);
        strict_1.default.equal(JSON.stringify(cells), execBefore, "T4: display must not mutate executable cells");
        strict_1.default.equal(cells.length, 4);
    });
    (0, node_test_1.it)("T3: non-contiguous slots must not merge into one window", () => {
        const cells = [
            climateCell("2026-08-11T08:00:00.000Z", "2026-08-11T08:15:00.000Z", 850),
            climateCell("2026-08-11T08:30:00.000Z", "2026-08-11T08:45:00.000Z", 850),
        ];
        const windows = (0, product_summary_1.mergeWindows)(cells, "climate");
        strict_1.default.equal(windows.length, 2);
        const vis = (0, plan_visibility_1.collapsePlanVisWindows)((0, plan_visibility_1.collectPlanVisSlots)(JSON.stringify(cells.map((c) => ({
            contributionId: c.consumerId,
            allocatedPowerW: c.allocatedPowerW,
            slot: c.slot,
        }))), { nowMs: Date.parse("2026-08-11T07:00:00.000Z") }));
        strict_1.default.equal(vis.length, 2);
    });
    (0, node_test_1.it)("T4: display aggregation does not alter executable allocations", () => {
        const cells = [
            climateCell("2026-08-11T08:00:00.000Z", "2026-08-11T08:15:00.000Z", 850),
            climateCell("2026-08-11T08:15:00.000Z", "2026-08-11T08:30:00.000Z", 850),
        ];
        const snapshot = structuredClone(cells);
        (0, product_summary_1.mergeWindows)(cells, "climate");
        (0, plan_visibility_1.climateUnitTimelineWindowsFromPlanJson)(JSON.stringify(cells.map((c) => ({
            contributionId: c.consumerId,
            allocatedPowerW: c.allocatedPowerW,
            slot: c.slot,
        }))), 1, Date.parse("2026-08-11T07:00:00.000Z"));
        strict_1.default.deepEqual(cells, snapshot);
    });
});
(0, node_test_1.describe)("climate slot consistency — T5/T6 runtime match", () => {
    const unit = (0, config_1.acUnitConfigFromAdapter)({
        ac_u1_enabled: true,
        ac_u1_estimated_power_w: 850,
        ac_u1_on_temp_c: 24.5,
        ac_u1_off_temp_c: 23,
        ac_u1_active_from: "08:00",
        ac_u1_active_until: "20:00",
        ac_u1_hard_off_at: "20:00",
    }, 1);
    function entry(start, end, w) {
        return {
            contributionId: (0, contribution_ids_1.acUnitContributionId)(1),
            contributor: (0, contributor_1.addonContributorRef)("air_conditioning"),
            slot: { startIso: start, endIso: end },
            status: "allocated",
            energySource: "pv_surplus",
            requestedPowerW: w,
            allocatedPowerW: w,
            requestedEnergyKwh: (0, slot_geometry_1.expectedEnergyKwhForPower)(w, slot_geometry_1.CANONICAL_SLOT_H),
            allocatedEnergyKwh: (0, slot_geometry_1.expectedEnergyKwhForPower)(w, slot_geometry_1.CANONICAL_SLOT_H),
            gridPowerW: 0,
            pvPowerW: w,
            batteryPowerW: 0,
            mandatory: true,
            priorityRank: null,
            deadlineIso: null,
            estimatedCostCt: null,
            reasonDe: "test",
        };
    }
    (0, node_test_1.it)("T5: NOW=10:33 finds exact 10:30–10:45 allocation", () => {
        const now = new Date(NOW_1033);
        const expected = (0, daily_plan_1.resolveUnitExpectedPower)(unit, undefined, now.getTime());
        const r = (0, daily_plan_1.resolveAcUnitDailyPlanFromData)({
            unitIndex: 1,
            now,
            timezone: TZ,
            meta: {
                status: "ready",
                date: "2026-08-11",
                revision: 1,
                validUntil: null,
                timezone: TZ,
            },
            entries: [entry(SLOT_1030, SLOT_1045, 850)],
            expectedPower: expected,
        });
        strict_1.default.equal(r.slotStartIso, SLOT_1030);
        strict_1.default.equal(r.slotEndIso, SLOT_1045);
        strict_1.default.equal(r.allocatedPowerW, 850);
        strict_1.default.equal(r.dailyPlanStatus, "daily_plan_valid");
        strict_1.default.equal(r.allocationAllowsStart, true);
    });
    (0, node_test_1.it)("T6: missing 10:30–10:45 → 0 W Planner-OFF; display not continuous over gap", () => {
        const now = new Date(NOW_1033);
        const expected = (0, daily_plan_1.resolveUnitExpectedPower)(unit, undefined, now.getTime());
        const r = (0, daily_plan_1.resolveAcUnitDailyPlanFromData)({
            unitIndex: 1,
            now,
            timezone: TZ,
            meta: {
                status: "ready",
                date: "2026-08-11",
                revision: 1,
                validUntil: null,
                timezone: TZ,
            },
            entries: [
                entry("2026-08-11T08:00:00.000Z", "2026-08-11T08:15:00.000Z", 850),
                entry("2026-08-11T09:00:00.000Z", "2026-08-11T09:15:00.000Z", 850),
            ],
            expectedPower: expected,
        });
        strict_1.default.equal(r.allocatedPowerW, 0);
        strict_1.default.equal(r.dailyPlanStatus, "daily_plan_zero_allocation");
        strict_1.default.match(r.allocationReasonDe, /Planner-OFF/);
        const planJson = JSON.stringify([
            {
                contributionId: (0, contribution_ids_1.acUnitContributionId)(1),
                allocatedPowerW: 850,
                slot: { startIso: "2026-08-11T08:00:00.000Z", endIso: "2026-08-11T08:15:00.000Z" },
            },
            {
                contributionId: (0, contribution_ids_1.acUnitContributionId)(1),
                allocatedPowerW: 850,
                slot: { startIso: "2026-08-11T09:00:00.000Z", endIso: "2026-08-11T09:15:00.000Z" },
            },
        ]);
        const wins = (0, plan_visibility_1.climateUnitTimelineWindowsFromPlanJson)(planJson, 1, Date.parse("2026-08-11T07:50:00.000Z"));
        strict_1.default.equal(wins.length, 2);
        strict_1.default.ok(!wins.some((w) => w.startMs <= Date.parse(SLOT_1030) && w.endMs > Date.parse(SLOT_1030)));
    });
});
(0, node_test_1.describe)("climate slot consistency — T7 realfall midday overwrite", () => {
    (0, node_test_1.it)("T7: house midday 10–14 must not create 4h@850W@0.213 executable slot", () => {
        const input = realCaseInput(NOW_1033);
        const work = (0, score_allocate_1.buildSlots)(input);
        strict_1.default.ok(work.length > 0);
        for (const s of work) {
            strict_1.default.ok((0, slot_geometry_1.isCanonicalQuarterSlot)(s.startIso, s.endIso), `non-canonical executable slot ${s.startIso}–${s.endIso}`);
        }
        const midday = work.find((s) => s.startIso === MIDDAY_START);
        strict_1.default.ok(midday);
        strict_1.default.equal(midday.endIso, "2026-08-11T08:15:00.000Z");
        const plan = (0, allocate_1.allocateUnifiedDayPlan)(input);
        for (const a of plan.allocations) {
            strict_1.default.ok((0, slot_geometry_1.isCanonicalQuarterSlot)(a.slot.startIso, a.slot.endIso), `allocation non-canonical ${a.consumerId} ${a.slot.startIso}–${a.slot.endIso}`);
            strict_1.default.ok((0, slot_geometry_1.isExecutableUnifiedCell)(a), `energy/power invariant failed for ${a.consumerId}`);
        }
        const climate = plan.allocations.filter((a) => a.kind === "climate");
        const bad = climate.find((a) => a.slot.startIso === MIDDAY_START &&
            a.slot.endIso === MIDDAY_END &&
            Math.abs(a.allocatedEnergyKwh - 0.213) < 0.01);
        strict_1.default.equal(bad, undefined, "realfall malformed 4h/0.213 climate allocation must not exist");
        const pub = (0, dispatch_bridge_1.unifiedPlanToClimateAllocations)(plan);
        strict_1.default.ok(pub.every(slot_geometry_1.isExecutableDailyEntry));
        strict_1.default.ok(!pub.some((e) => e.slot.startIso === MIDDAY_START &&
            e.slot.endIso === MIDDAY_END &&
            (e.allocatedEnergyKwh ?? 0) < 0.3));
        /** Dispatch rejects an artificially injected multi-hour leak. */
        const leakPlan = {
            ...plan,
            allocations: [
                ...plan.allocations,
                {
                    slot: { startIso: MIDDAY_START, endIso: MIDDAY_END },
                    consumerId: "air_conditioning.unit_1",
                    kind: "climate",
                    allocatedPowerW: 850,
                    allocatedEnergyKwh: 0.213,
                    energySource: "pv_surplus",
                    constraintIds: ["climate.flex"],
                    reasonCodes: ["leak"],
                },
            ],
        };
        const filtered = (0, dispatch_bridge_1.unifiedPlanToClimateAllocations)(leakPlan);
        strict_1.default.ok(!filtered.some((e) => e.slot.endIso === MIDDAY_END && e.slot.startIso === MIDDAY_START), "dispatch must drop multi-hour climate leak");
    });
});
(0, node_test_1.describe)("climate slot consistency — T8 replan geometry", () => {
    (0, node_test_1.it)("T8: replan keeps current-slot climate key → no geometry-induced OFF", () => {
        const input1 = realCaseInput("2026-08-11T08:32:00.000Z");
        const plan1 = (0, allocate_1.allocateUnifiedDayPlan)(input1);
        const pub1 = (0, dispatch_bridge_1.unifiedPlanToClimateAllocations)(plan1);
        const current = pub1.find((e) => e.slot.startIso === SLOT_1030);
        strict_1.default.ok(current, "first plan must allocate current 10:30 slot when climate demand exists");
        strict_1.default.equal(current.slot.endIso, SLOT_1045);
        strict_1.default.ok((current.allocatedPowerW ?? 0) >= 50);
        const input2 = realCaseInput("2026-08-11T08:34:00.000Z");
        const plan2 = (0, allocate_1.allocateUnifiedDayPlan)(input2, { previousPlan: plan1, generation: 2 });
        const pub2 = (0, dispatch_bridge_1.unifiedPlanToClimateAllocations)(plan2);
        const again = pub2.find((e) => e.slot.startIso === SLOT_1030);
        strict_1.default.ok(again, "replan must still expose canonical 10:30–10:45 key");
        strict_1.default.equal(again.slot.endIso, SLOT_1045);
        const merge = (0, daily_plan_1.mergeUnitSlotAllocation)(pub2, (0, contribution_ids_1.acUnitContributionId)(1), SLOT_1030, SLOT_1045);
        strict_1.default.equal(merge.valid, true);
        strict_1.default.ok(merge.allocatedPowerW > 0, "runtime must still match after replan");
    });
});
(0, node_test_1.describe)("climate slot consistency — Klima-/Ownership-Block: Hard-Off reicht bis in den Unified Planner", () => {
    (0, node_test_1.it)("hardStopMs (echte Hard-Off-Zeit) verhindert Allocation an/nach der Zwangsabschaltung", () => {
        const input = realCaseInput(NOW_1033);
        // Hard-Off um 09:15Z (11:15 lokal) — mitten im geplanten Horizont (06:00–14:15Z).
        const hardStopIso = "2026-08-11T09:15:00.000Z";
        const withHardOff = {
            ...input,
            climate: {
                ...input.climate,
                units: input.climate.units.map((u) => ({ ...u, hardStopMs: Date.parse(hardStopIso) })),
            },
        };
        const plan = (0, allocate_1.allocateUnifiedDayPlan)(withHardOff);
        const climate = plan.allocations.filter((a) => a.kind === "climate");
        const afterHardOff = climate.find((a) => Date.parse(a.slot.startIso) >= Date.parse(hardStopIso) && (a.allocatedPowerW ?? 0) > 0);
        strict_1.default.equal(afterHardOff, undefined, "keine Allocation an/nach der konfigurierten Hard-Off-Zeit");
        strict_1.default.ok(climate.some((a) => Date.parse(a.slot.startIso) < Date.parse(hardStopIso) && (a.allocatedPowerW ?? 0) > 0), "vor Hard-Off bleibt Allocation weiterhin möglich");
    });
});
(0, node_test_1.describe)("climate slot consistency — E2E system invariant", () => {
    (0, node_test_1.it)("Forecast segment mix → Unified quarters → Dispatch → Runtime match at 10:33", () => {
        const input = realCaseInput(NOW_1033);
        const work = (0, score_allocate_1.buildSlots)(input);
        strict_1.default.ok(work.every((s) => (0, slot_geometry_1.isCanonicalQuarterSlot)(s.startIso, s.endIso)));
        const plan = (0, allocate_1.allocateUnifiedDayPlan)(input);
        const pub = (0, dispatch_bridge_1.buildUnifiedDispatchPublish)(plan);
        strict_1.default.ok(pub.climateEntries.every(slot_geometry_1.isExecutableDailyEntry));
        const now = new Date(NOW_1033);
        const unit = (0, config_1.acUnitConfigFromAdapter)({
            ac_u1_enabled: true,
            ac_u1_estimated_power_w: 850,
            ac_u1_on_temp_c: 24.5,
            ac_u1_off_temp_c: 23,
            ac_u1_active_from: "08:00",
            ac_u1_active_until: "20:00",
            ac_u1_hard_off_at: "20:00",
        }, 1);
        const expected = (0, daily_plan_1.resolveUnitExpectedPower)(unit, undefined, now.getTime());
        const r = (0, daily_plan_1.resolveAcUnitDailyPlanFromData)({
            unitIndex: 1,
            now,
            timezone: TZ,
            meta: {
                status: "ready",
                date: "2026-08-11",
                revision: 1,
                validUntil: null,
                timezone: TZ,
            },
            entries: pub.climateEntries,
            expectedPower: expected,
        });
        strict_1.default.equal(r.slotStartIso, SLOT_1030);
        strict_1.default.equal(r.slotEndIso, SLOT_1045);
        if (pub.climateEntries.some((e) => e.slot.startIso === SLOT_1030)) {
            strict_1.default.ok((r.allocatedPowerW ?? 0) > 0);
            strict_1.default.equal(r.dailyPlanStatus, "daily_plan_valid");
        }
        else {
            strict_1.default.equal(r.allocatedPowerW, 0);
            strict_1.default.equal(r.dailyPlanStatus, "daily_plan_zero_allocation");
        }
    });
});
