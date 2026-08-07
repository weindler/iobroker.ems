"use strict";
/**
 * REPLAN-001…010 — Material Replanning + Plan-vs-Actual.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const allocate_1 = require("./allocate");
const alloc_fixtures_1 = require("./alloc_fixtures");
const materiality_1 = require("./materiality");
const reason_codes_1 = require("./reason_codes");
const day_evaluation_1 = require("./day_evaluation");
const replan_failure_1 = require("./replan_failure");
const dispatch_bridge_1 = require("./dispatch_bridge");
const authority_1 = require("./authority");
const trigger_digest_1 = require("../../../ai/trigger_digest");
const cadence_1 = require("./cadence");
const quality_1 = require("../../quality");
function baseline(overrides = {}) {
    return {
        date: "2026-08-07",
        planId: "p1",
        generation: 1,
        createdAtMs: Date.parse("2026-08-07T08:00:00.000Z"),
        expectedPvDayKwh: 30,
        realizedPvKwhAtPlan: 2,
        expectedHouseLoadDayKwh: 12,
        batterySocPct: 40,
        thermalHeadroomKwh: 4,
        bufferTempC: 48,
        acMandatoryAny: false,
        vehicleConnected: false,
        vehicleRequiredEnergyKwh: null,
        vehicleDeadlineIso: null,
        vehicleTargetSocPct: null,
        priceMedianCt: 22,
        priceStructureDigest: "price-struct-v1",
        cadenceDigest: "digest-v1",
        ...overrides,
    };
}
function actual(overrides = {}) {
    return {
        date: "2026-08-07",
        nowMs: Date.parse("2026-08-07T10:00:00.000Z"),
        forecastPvDayKwh: 30,
        realizedPvKwh: 2.1,
        forecastHouseLoadDayKwh: 12,
        batterySocPct: 40.5,
        thermalHeadroomKwh: 3.9,
        bufferTempC: 48.2,
        acMandatoryAny: false,
        vehicleConnected: false,
        vehicleRequiredEnergyKwh: null,
        vehicleDeadlineIso: null,
        vehicleTargetSocPct: null,
        priceMedianCt: 22,
        priceStructureDigest: "price-struct-v1",
        thermalBlocked: false,
        cadenceDigest: "digest-v1",
        ...overrides,
    };
}
(0, node_test_1.describe)("REPLAN-001 no material change", () => {
    (0, node_test_1.it)("many small ticks → no replan", () => {
        const b = baseline();
        for (let i = 0; i < 12; i++) {
            const d = (0, materiality_1.evaluateMaterialReplan)(b, actual({
                nowMs: Date.parse("2026-08-07T10:00:00.000Z") + i * 60_000,
                realizedPvKwh: 2 + i * 0.02,
                batterySocPct: 40 + (i % 3) * 0.3,
                bufferTempC: 48 + (i % 2) * 0.2,
                thermalHeadroomKwh: 4 - i * 0.01,
            }), { lastReplanAtMs: b.createdAtMs });
            strict_1.default.equal(d.shouldReplan, false, `tick ${i}: ${d.reasons.join(",")}`);
        }
    });
});
(0, node_test_1.describe)("REPLAN-002 PV forecast collapse", () => {
    (0, node_test_1.it)("material PV forecast drop → replan + remaining goals reallocated", () => {
        const b = baseline({ expectedPvDayKwh: 30 });
        const d = (0, materiality_1.evaluateMaterialReplan)(b, actual({
            forecastPvDayKwh: 12,
            cadenceDigest: "digest-pv-down",
        }));
        strict_1.default.equal(d.shouldReplan, true);
        strict_1.default.ok(d.reasons.includes(reason_codes_1.REASON.REPLAN_PV_FORECAST_CHANGED));
        const input = (0, alloc_fixtures_1.alloc004Input)();
        input.pv.expectedDayEnergyKwh = 12;
        input.pv.previousExpectedDayEnergyKwh = 30;
        input.pv.slots = input.pv.slots.map((s) => ({
            ...s,
            forecastPowerW: (s.forecastPowerW ?? 0) * 0.4,
            energyKwh: (s.energyKwh ?? 0) * 0.4,
        }));
        const plan = (0, allocate_1.allocateUnifiedDayPlan)(input, {
            generation: 2,
            extraReasonCodes: d.reasons,
        });
        strict_1.default.equal(plan.generation, 2);
        strict_1.default.ok(plan.reasonCodes.includes(reason_codes_1.REASON.REPLAN_PV_FORECAST_CHANGED));
        const gridWb = plan.allocations
            .filter((a) => a.kind === "wallbox" && a.energySource === "grid")
            .reduce((s, a) => s + a.allocatedEnergyKwh, 0);
        strict_1.default.ok(gridWb > 1, `expected grid import for hard deadline after PV collapse, got ${gridWb}`);
    });
});
(0, node_test_1.describe)("REPLAN-003 PV clearly better", () => {
    (0, node_test_1.it)("material PV up → replan can use extra flex", () => {
        const b = baseline({ expectedPvDayKwh: 18, thermalHeadroomKwh: 5 });
        const d = (0, materiality_1.evaluateMaterialReplan)(b, actual({
            forecastPvDayKwh: 28,
            cadenceDigest: "digest-pv-up",
            thermalHeadroomKwh: 5,
        }));
        strict_1.default.equal(d.shouldReplan, true);
        strict_1.default.ok(d.reasons.includes(reason_codes_1.REASON.REPLAN_PV_FORECAST_CHANGED));
        const low = (0, alloc_fixtures_1.alloc001Input)();
        low.pv.expectedDayEnergyKwh = 18;
        const lowPlan = (0, allocate_1.allocateUnifiedDayPlan)(low);
        const high = (0, alloc_fixtures_1.alloc001Input)();
        high.pv.slots = high.pv.slots.map((s) => ({
            ...s,
            forecastPowerW: (s.forecastPowerW ?? 0) * 1.6,
            energyKwh: (s.energyKwh ?? 0) * 1.6,
        }));
        high.pv.expectedDayEnergyKwh = high.pv.slots.reduce((a, s) => a + (s.energyKwh ?? 0), 0);
        high.pv.previousExpectedDayEnergyKwh = 18;
        const highPlan = (0, allocate_1.allocateUnifiedDayPlan)(high, {
            generation: 2,
            extraReasonCodes: [reason_codes_1.REASON.REPLAN_PV_FORECAST_CHANGED],
        });
        const ihLow = lowPlan.allocations
            .filter((a) => a.kind === "immersion_heater")
            .reduce((s, a) => s + a.allocatedEnergyKwh, 0);
        const ihHigh = highPlan.allocations
            .filter((a) => a.kind === "immersion_heater")
            .reduce((s, a) => s + a.allocatedEnergyKwh, 0);
        const batHigh = highPlan.allocations
            .filter((a) => a.kind === "battery_charge")
            .reduce((s, a) => s + a.allocatedEnergyKwh, 0);
        strict_1.default.ok(ihHigh + batHigh >= ihLow, `extra PV should enable flex: ih ${ihLow}→${ihHigh}, bat=${batHigh}`);
    });
});
(0, node_test_1.describe)("REPLAN-004 battery SOC deviation", () => {
    (0, node_test_1.it)("relevant SOC delta → replan", () => {
        const d = (0, materiality_1.evaluateMaterialReplan)(baseline({ batterySocPct: 40 }), actual({ batterySocPct: 28 }));
        strict_1.default.equal(d.shouldReplan, true);
        strict_1.default.ok(d.reasons.includes(reason_codes_1.REASON.REPLAN_BATTERY_SOC_DEVIATION));
    });
});
(0, node_test_1.describe)("REPLAN-005 thermal target reached early", () => {
    (0, node_test_1.it)("headroom collapses → replan; IH allocations shrink", () => {
        const d = (0, materiality_1.evaluateMaterialReplan)(baseline({ thermalHeadroomKwh: 4 }), actual({ thermalHeadroomKwh: 0, bufferTempC: 56 }));
        strict_1.default.equal(d.shouldReplan, true);
        strict_1.default.ok(d.reasons.includes(reason_codes_1.REASON.REPLAN_THERMAL_DEVIATION));
        const need = (0, alloc_fixtures_1.alloc001Input)();
        need.thermal = { ...need.thermal, headroomEnergyKwh: 5 };
        const withNeed = (0, allocate_1.allocateUnifiedDayPlan)(need);
        const done = (0, alloc_fixtures_1.alloc001Input)();
        done.thermal = { ...done.thermal, headroomEnergyKwh: 0, dayTargetTempC: 56 };
        done.time = { ...done.time, nowIso: "2026-08-04T14:00:00.000Z" };
        const after = (0, allocate_1.allocateUnifiedDayPlan)(done, {
            generation: 2,
            extraReasonCodes: [reason_codes_1.REASON.REPLAN_THERMAL_DEVIATION],
            previousPlan: withNeed,
        });
        const futureIh = after.allocations
            .filter((a) => a.kind === "immersion_heater" &&
            Date.parse(a.slot.startIso) >= Date.parse("2026-08-04T14:00:00.000Z"))
            .reduce((s, a) => s + a.allocatedEnergyKwh, 0);
        strict_1.default.ok(futureIh < 0.2, `future IH should be cleared, got ${futureIh}`);
    });
});
(0, node_test_1.describe)("REPLAN-006 vehicle disconnect", () => {
    (0, node_test_1.it)("disconnect → replan; future wallbox allocation gone", () => {
        const d = (0, materiality_1.evaluateMaterialReplan)(baseline({ vehicleConnected: true, vehicleRequiredEnergyKwh: 18 }), actual({ vehicleConnected: false, vehicleRequiredEnergyKwh: 18 }));
        strict_1.default.equal(d.shouldReplan, true);
        strict_1.default.ok(d.reasons.includes(reason_codes_1.REASON.REPLAN_VEHICLE_DISCONNECTED));
        strict_1.default.equal(d.hard, true);
        const input = (0, alloc_fixtures_1.alloc002Input)();
        input.wallbox = {
            ...input.wallbox,
            connectedNow: true,
            presenceWindows: [
                {
                    available: true,
                    startIso: "2026-08-04T00:00:00.000Z",
                    endIso: "2026-08-05T00:00:00.000Z",
                },
            ],
        };
        const first = (0, allocate_1.allocateUnifiedDayPlan)(input);
        strict_1.default.ok(first.allocations.some((a) => a.kind === "wallbox"));
        const disc = {
            ...input,
            wallbox: {
                ...input.wallbox,
                connectedNow: false,
                // Live-Disconnect: keine zukünftige Presence (kein Future-Presence-Engine-Hardcode).
                presenceWindows: [],
            },
            time: { ...input.time, nowIso: "2026-08-04T14:00:00.000Z" },
        };
        const second = (0, allocate_1.allocateUnifiedDayPlan)(disc, {
            generation: 2,
            extraReasonCodes: [reason_codes_1.REASON.REPLAN_VEHICLE_DISCONNECTED],
            previousPlan: first,
        });
        const futureWb = second.allocations.filter((a) => a.kind === "wallbox" &&
            Date.parse(a.slot.endIso) > Date.parse("2026-08-04T14:00:00.000Z"));
        strict_1.default.equal(futureWb.length, 0);
    });
});
(0, node_test_1.describe)("REPLAN-007 vehicle reconnect", () => {
    (0, node_test_1.it)("reconnect → replan; rest need reconsidered", () => {
        const d = (0, materiality_1.evaluateMaterialReplan)(baseline({ vehicleConnected: false, vehicleRequiredEnergyKwh: 10 }), actual({
            vehicleConnected: true,
            vehicleRequiredEnergyKwh: 10,
            vehicleDeadlineIso: "2026-08-07T20:00:00.000Z",
        }));
        strict_1.default.equal(d.shouldReplan, true);
        strict_1.default.ok(d.reasons.includes(reason_codes_1.REASON.REPLAN_VEHICLE_CONNECTED));
        const input = (0, alloc_fixtures_1.alloc002Input)();
        input.wallbox = {
            ...input.wallbox,
            connectedNow: true,
            presenceWindows: [
                {
                    available: true,
                    startIso: "2026-08-04T14:00:00.000Z",
                    endIso: "2026-08-05T00:00:00.000Z",
                },
            ],
            requiredEnergyKwh: 8,
            deadlineIso: "2026-08-04T22:00:00.000Z",
        };
        input.time = { ...input.time, nowIso: "2026-08-04T14:05:00.000Z" };
        const plan = (0, allocate_1.allocateUnifiedDayPlan)(input, {
            generation: 3,
            extraReasonCodes: [reason_codes_1.REASON.REPLAN_VEHICLE_CONNECTED],
        });
        const wb = plan.allocations
            .filter((a) => a.kind === "wallbox")
            .reduce((s, a) => s + a.allocatedEnergyKwh, 0);
        strict_1.default.ok(wb > 0.5, `expected wallbox rest allocation, got ${wb}`);
    });
});
(0, node_test_1.describe)("REPLAN-008 price revision", () => {
    (0, node_test_1.it)("material price median change → replan", () => {
        const d = (0, materiality_1.evaluateMaterialReplan)(baseline({ priceMedianCt: 20 }), actual({ priceMedianCt: 28, cadenceDigest: "digest-price" }));
        strict_1.default.equal(d.shouldReplan, true);
        strict_1.default.ok(d.reasons.includes(reason_codes_1.REASON.REPLAN_PRICE_REVISION));
    });
});
(0, node_test_1.describe)("REPLAN-009 anti-chatter", () => {
    (0, node_test_1.it)("after replan, soft wobble within cooldown does not replan", () => {
        const last = Date.parse("2026-08-07T10:00:00.000Z");
        const d = (0, materiality_1.evaluateMaterialReplan)(baseline({ batterySocPct: 40, createdAtMs: last }), actual({
            nowMs: last + 60_000,
            batterySocPct: 46, // material, but soft + cooldown
        }), { lastReplanAtMs: last });
        strict_1.default.equal(d.shouldReplan, false);
        strict_1.default.ok(d.reasons.includes(reason_codes_1.REASON.REPLAN_BATTERY_SOC_DEVIATION));
        strict_1.default.ok(materiality_1.REPLAN_COOLDOWN_MS >= 60_000);
        const afterCooldown = (0, materiality_1.evaluateMaterialReplan)(baseline({ batterySocPct: 40 }), actual({
            nowMs: last + materiality_1.REPLAN_COOLDOWN_MS + 1,
            batterySocPct: 46,
        }), { lastReplanAtMs: last });
        strict_1.default.equal(afterCooldown.shouldReplan, true);
    });
    (0, node_test_1.it)("hard vehicle event bypasses cooldown", () => {
        const last = Date.parse("2026-08-07T10:00:00.000Z");
        const d = (0, materiality_1.evaluateMaterialReplan)(baseline({ vehicleConnected: true }), actual({ nowMs: last + 30_000, vehicleConnected: false }), { lastReplanAtMs: last });
        strict_1.default.equal(d.shouldReplan, true);
        strict_1.default.equal(d.hard, true);
    });
});
(0, node_test_1.describe)("REPLAN-010 past stays past", () => {
    (0, node_test_1.it)("replan at 14:00 only reallocates remaining horizon", () => {
        const input = (0, alloc_fixtures_1.alloc001Input)();
        const morning = (0, allocate_1.allocateUnifiedDayPlan)(input);
        const pastSlot = morning.allocations.find((a) => Date.parse(a.slot.endIso) <= Date.parse("2026-08-04T14:00:00.000Z"));
        strict_1.default.ok(pastSlot, "fixture should have morning allocations");
        const noon = {
            ...input,
            time: { ...input.time, nowIso: "2026-08-04T14:00:00.000Z" },
            thermal: { ...input.thermal, headroomEnergyKwh: 1 },
            pv: {
                ...input.pv,
                previousExpectedDayEnergyKwh: input.pv.expectedDayEnergyKwh,
            },
        };
        const replanned = (0, allocate_1.allocateUnifiedDayPlan)(noon, {
            generation: 2,
            previousPlan: morning,
            extraReasonCodes: [reason_codes_1.REASON.REPLAN_THERMAL_DEVIATION],
        });
        strict_1.default.ok(Date.parse(replanned.horizonStartIso) >= Date.parse("2026-08-04T13:45:00.000Z"));
        const preserved = replanned.allocations.filter((a) => Date.parse(a.slot.endIso) <= Date.parse("2026-08-04T14:00:00.000Z"));
        strict_1.default.ok(preserved.length > 0);
        strict_1.default.ok(preserved.some((a) => a.slot.startIso === pastSlot.slot.startIso &&
            a.consumerId === pastSlot.consumerId &&
            a.allocatedEnergyKwh === pastSlot.allocatedEnergyKwh), "past allocation cell must be preserved verbatim");
    });
});
function thermalOk(headroom = 4) {
    return {
        bufferTempC: 48,
        minTempC: 40,
        maxTempC: 65,
        dayTargetTempC: 56,
        availablePowerW: 1700,
        minPowerW: 400,
        headroomEnergyKwh: headroom,
        estimatedEmptyAtIso: null,
        coolingRateCPerH: null,
        minimumRuntimeSec: null,
        hysteresisK: null,
        uncertainty: (0, quality_1.operatorQuality)("valid", "ok", 80),
        freshness: {
            observedAtIso: "2026-08-07T10:00:00.000Z",
            ageSec: 30,
            quality: (0, quality_1.operatorQuality)("valid", "ok", 80),
        },
    };
}
function stubDailyPlan() {
    return {
        generatedAt: "2026-08-07T10:00:00.000Z",
        validUntil: null,
        revision: 3,
        date: "2026-08-07",
        timezone: "Europe/Berlin",
        slotMinutes: 15,
        globalMode: "balanced",
        status: "ready",
        policySnapshot: {},
        constraintSnapshot: {},
        activeContributionIds: ["immersion_heater.flexible", "air_conditioning.unit_1"],
        excludedContributions: [],
        slots: [],
        allocations: [],
        unallocated: [],
        totals: {
            pvForecastEnergyKwh: 20,
            fixedHouseLoadEnergyKwh: 10,
            fixedRenewableBalanceKwh: 10,
            flexibleRequestedEnergyKwh: 5,
            flexibleAllocatedEnergyKwh: 3,
            flexibleUnallocatedEnergyKwh: 2,
            pvAllocatedEnergyKwh: 3,
            gridAllocatedEnergyKwh: 0,
            batteryChargeEnergyKwh: 0,
            wallboxEnergyKwh: 0,
            immersionHeaterEnergyKwh: 2,
            airConditioningEnergyKwh: 1,
            estimatedGridCostCt: null,
            mandatoryRequestedEnergyKwh: null,
            mandatoryAllocatedEnergyKwh: 0,
            mandatoryUnallocatedEnergyKwh: null,
        },
        quality: (0, quality_1.operatorQuality)("valid", "t", 80),
        reasonDe: "t",
    };
}
(0, node_test_1.describe)("REPLAN-FAIL-001 stale IH after failed replan", () => {
    (0, node_test_1.it)("clears IH authority when PV/thermal material change invalidates rest slice", () => {
        const input = (0, alloc_fixtures_1.alloc001Input)();
        const unified = (0, allocate_1.allocateUnifiedDayPlan)(input);
        strict_1.default.ok(unified.allocations.some((a) => a.kind === "immersion_heater"));
        strict_1.default.ok(unified.allocations.some((a) => a.kind === "immersion_heater" &&
            Date.parse(a.slot.endIso) > Date.parse("2026-08-04T10:00:00.000Z")), "fixture needs future IH slice at assessment time");
        const disp = (0, replan_failure_1.assessUnifiedReplanFailure)({
            nowMs: Date.parse("2026-08-04T10:00:00.000Z"),
            lastUnifiedPlan: unified,
            actual: actual({
                nowMs: Date.parse("2026-08-04T10:00:00.000Z"),
                thermalHeadroomKwh: 0,
                bufferTempC: 56,
                forecastPvDayKwh: 8,
            }),
            thermal: {
                ...thermalOk(0),
                bufferTempC: 56,
                headroomEnergyKwh: 0,
            },
            climate: null,
            replanReasons: [reason_codes_1.REASON.REPLAN_PV_FORECAST_CHANGED, reason_codes_1.REASON.REPLAN_THERMAL_DEVIATION],
        });
        strict_1.default.equal(disp.clearImmersion, true);
        const classic = stubDailyPlan();
        const pub = (0, dispatch_bridge_1.buildUnifiedIhAcDispatchPublish)(unified);
        const withIh = (0, authority_1.applyUnifiedIhAcAuthority)(classic, pub.immersionEntries, pub.climateEntries, {
            dailyPlanRevision: 3,
            unifiedPlanId: unified.planId,
        });
        strict_1.default.ok(withIh.allocations.some((a) => a.contributionId.startsWith("immersion_heater")));
        const after = (0, replan_failure_1.applyReplanFailureAuthority)(classic, unified, disp);
        strict_1.default.equal(after.allocations.some((a) => a.contributionId.startsWith("immersion_heater")), false, "no stale IH live dispatch after failed replan");
    });
});
(0, node_test_1.describe)("REPLAN-FAIL-002 AC comfort on failed replan", () => {
    (0, node_test_1.it)("clears plan climate dispatch so local comfort path can run; no blind plan cling", () => {
        const unified = {
            ...(0, allocate_1.allocateUnifiedDayPlan)((0, alloc_fixtures_1.alloc001Input)()),
            allocations: [
                {
                    slot: {
                        startIso: "2026-08-07T12:00:00.000Z",
                        endIso: "2026-08-07T12:15:00.000Z",
                    },
                    consumerId: "air_conditioning.unit_1",
                    kind: "climate",
                    allocatedPowerW: 900,
                    allocatedEnergyKwh: 0.225,
                    energySource: "pv_surplus",
                    constraintIds: ["climate.comfort"],
                    reasonCodes: ["climate_flex"],
                },
            ],
        };
        const disp = (0, replan_failure_1.assessUnifiedReplanFailure)({
            nowMs: Date.parse("2026-08-07T12:05:00.000Z"),
            lastUnifiedPlan: unified,
            actual: actual({ acMandatoryAny: true }),
            thermal: thermalOk(2),
            climate: {
                units: [
                    {
                        unitId: "air_conditioning.unit_1",
                        label: "u1",
                        roomTempC: 28,
                        comfortMinC: null,
                        comfortMaxC: 26,
                        targetTempC: 25,
                        mandatoryComfort: true,
                        expectedEnergyKwh: 1,
                        typicalPowerW: 900,
                        maxShiftHours: 0,
                        uncertainty: (0, quality_1.operatorQuality)("valid", "ok", 80),
                    },
                ],
                freshness: {
                    observedAtIso: "2026-08-07T12:00:00.000Z",
                    ageSec: 20,
                    quality: (0, quality_1.operatorQuality)("valid", "ok", 80),
                },
            },
            replanReasons: [reason_codes_1.REASON.REPLAN_AC_COMFORT_CHANGE],
        });
        strict_1.default.equal(disp.clearClimate, true);
        strict_1.default.equal(disp.clearImmersion, false);
        const after = (0, replan_failure_1.applyReplanFailureAuthority)(stubDailyPlan(), unified, disp);
        strict_1.default.equal(after.allocations.some((a) => a.contributionId.startsWith("air_conditioning")), false, "plan climate cleared → runtime Climate-Fallback / local comfort");
    });
});
(0, node_test_1.describe)("REPLAN-FAIL-003 rest plan still safe", () => {
    (0, node_test_1.it)("keeps IH/AC authority; no new generation publish signal (mustPublish=false path)", () => {
        const unified = (0, allocate_1.allocateUnifiedDayPlan)((0, alloc_fixtures_1.alloc001Input)());
        const disp = (0, replan_failure_1.assessUnifiedReplanFailure)({
            nowMs: Date.parse("2026-08-04T08:00:00.000Z"),
            lastUnifiedPlan: unified,
            actual: actual({
                thermalHeadroomKwh: 4,
                forecastPvDayKwh: 30,
            }),
            thermal: thermalOk(4),
            climate: null,
            replanReasons: [reason_codes_1.REASON.REPLAN_BATTERY_SOC_DEVIATION],
        });
        strict_1.default.equal(disp.clearImmersion, false);
        strict_1.default.equal(disp.clearClimate, false);
        const classic = stubDailyPlan();
        const after = (0, replan_failure_1.applyReplanFailureAuthority)(classic, unified, disp);
        const pub = (0, dispatch_bridge_1.buildUnifiedIhAcDispatchPublish)(unified);
        const kept = (0, authority_1.applyUnifiedIhAcAuthority)(classic, pub.immersionEntries, pub.climateEntries, {
            dailyPlanRevision: classic.revision,
            unifiedPlanId: `${unified.planId}:replan-fail-safe`,
        });
        // Disposition says keep — tick returns without publish; authority helper still can rebuild same slices
        strict_1.default.ok(kept.allocations.some((a) => a.contributionId.startsWith("immersion_heater")));
        strict_1.default.equal(disp.clearImmersion || disp.clearClimate, false);
        void after;
    });
});
function priceSlot(startIso, endIso, price) {
    return {
        slot: { startIso, endIso },
        pvForecastPowerW: null,
        fixedHouseLoadPowerW: null,
        fixedBalancePowerW: null,
        gridPriceCtPerKwh: price,
        gridImportAllowed: true,
        configuredGridImportLimitW: null,
        remainingGridImportPowerW: null,
        availablePvSurplusPowerW: null,
        allocatedFlexiblePowerW: 0,
        allocatedPvPowerW: 0,
        allocatedGridPowerW: 0,
        allocatedBatteryPowerW: 0,
        remainingPvSurplusPowerW: null,
        remainingGridImportPowerWAfterAlloc: null,
        remainingBatteryDischargePowerW: null,
        allocations: [],
        quality: (0, quality_1.operatorQuality)("valid", "p", 90),
        reasonDe: "p",
    };
}
function dayPricePlan(pricesByHourUtc) {
    const slots = pricesByHourUtc.flatMap(({ hour, price }) => {
        const start = `2026-08-07T${String(hour).padStart(2, "0")}:00:00.000Z`;
        const end = `2026-08-07T${String(hour).padStart(2, "0")}:15:00.000Z`;
        return [priceSlot(start, end, price)];
    });
    return {
        ...stubDailyPlan(),
        slots,
        totals: { ...stubDailyPlan().totals, pvForecastEnergyKwh: 18 },
    };
}
(0, node_test_1.describe)("PRICE-REPLAN-001 cheap window shifts, median similar", () => {
    (0, node_test_1.it)("triggers replan when cheapest region moves", () => {
        // Median alike (~22), cheap block morning vs afternoon
        const a = dayPricePlan([
            { hour: 8, price: 12 },
            { hour: 9, price: 12 },
            { hour: 10, price: 12 },
            { hour: 14, price: 28 },
            { hour: 15, price: 28 },
            { hour: 16, price: 28 },
            { hour: 12, price: 22 },
        ]);
        const b = dayPricePlan([
            { hour: 8, price: 28 },
            { hour: 9, price: 28 },
            { hour: 10, price: 28 },
            { hour: 14, price: 12 },
            { hour: 15, price: 12 },
            { hour: 16, price: 12 },
            { hour: 12, price: 22 },
        ]);
        const sa = (0, trigger_digest_1.priceStructureDigestFromPlan)(a);
        const sb = (0, trigger_digest_1.priceStructureDigestFromPlan)(b);
        strict_1.default.notEqual(sa, sb);
        const d = (0, materiality_1.evaluateMaterialReplan)(baseline({
            priceMedianCt: 22,
            priceStructureDigest: sa,
            cadenceDigest: (0, cadence_1.unifiedPlanCadenceDigest)(a),
        }), actual({
            priceMedianCt: 22,
            priceStructureDigest: sb,
            cadenceDigest: (0, cadence_1.unifiedPlanCadenceDigest)(b),
        }));
        strict_1.default.equal(d.shouldReplan, true);
        strict_1.default.ok(d.reasons.includes(reason_codes_1.REASON.REPLAN_PRICE_REVISION));
    });
});
(0, node_test_1.describe)("PRICE-REPLAN-002 micro price noise", () => {
    (0, node_test_1.it)("no replan for tiny moves without structure change", () => {
        const a = dayPricePlan([
            { hour: 10, price: 20 },
            { hour: 11, price: 21 },
            { hour: 12, price: 22 },
            { hour: 13, price: 23 },
        ]);
        const b = dayPricePlan([
            { hour: 10, price: 20.4 },
            { hour: 11, price: 21.3 },
            { hour: 12, price: 22.2 },
            { hour: 13, price: 23.1 },
        ]);
        strict_1.default.equal((0, trigger_digest_1.priceStructureDigestFromPlan)(a), (0, trigger_digest_1.priceStructureDigestFromPlan)(b));
        strict_1.default.equal((0, cadence_1.unifiedPlanCadenceDigest)(a), (0, cadence_1.unifiedPlanCadenceDigest)(b));
        const d = (0, materiality_1.evaluateMaterialReplan)(baseline({
            priceStructureDigest: (0, trigger_digest_1.priceStructureDigestFromPlan)(a),
            cadenceDigest: (0, cadence_1.unifiedPlanCadenceDigest)(a),
        }), actual({
            priceMedianCt: 22,
            priceStructureDigest: (0, trigger_digest_1.priceStructureDigestFromPlan)(b),
            cadenceDigest: (0, cadence_1.unifiedPlanCadenceDigest)(b),
            batterySocPct: 40.2,
        }));
        strict_1.default.equal(d.shouldReplan, false);
    });
});
(0, node_test_1.describe)("PRICE-REPLAN-003 cheap slot timing shifts", () => {
    (0, node_test_1.it)("replan when cheap hours move at similar day median", () => {
        const a = dayPricePlan([
            { hour: 6, price: 10 },
            { hour: 7, price: 24 },
            { hour: 8, price: 24 },
            { hour: 9, price: 24 },
            { hour: 18, price: 24 },
        ]);
        const b = dayPricePlan([
            { hour: 6, price: 24 },
            { hour: 7, price: 24 },
            { hour: 8, price: 24 },
            { hour: 9, price: 24 },
            { hour: 18, price: 10 },
        ]);
        strict_1.default.notEqual((0, trigger_digest_1.priceStructureDigestFromPlan)(a), (0, trigger_digest_1.priceStructureDigestFromPlan)(b));
        const d = (0, materiality_1.evaluateMaterialReplan)(baseline({
            priceMedianCt: 24,
            priceStructureDigest: (0, trigger_digest_1.priceStructureDigestFromPlan)(a),
            cadenceDigest: "x",
        }), actual({
            priceMedianCt: 24,
            priceStructureDigest: (0, trigger_digest_1.priceStructureDigestFromPlan)(b),
            cadenceDigest: "x", // structure alone must suffice
        }));
        strict_1.default.equal(d.shouldReplan, true);
        strict_1.default.ok(d.reasons.includes(reason_codes_1.REASON.REPLAN_PRICE_REVISION));
    });
});
(0, node_test_1.describe)("PV revision context + day evaluation structure", () => {
    (0, node_test_1.it)("previous/new/realized/remaining without double-counting", () => {
        const ctx = (0, materiality_1.pvRevisionContext)(baseline({ expectedPvDayKwh: 30, realizedPvKwhAtPlan: 8 }), actual({ forecastPvDayKwh: 17, realizedPvKwh: 8 }));
        strict_1.default.equal(ctx.previousExpectedDayKwh, 30);
        strict_1.default.equal(ctx.newExpectedDayKwh, 17);
        strict_1.default.equal(ctx.realizedKwh, 8);
        strict_1.default.equal(ctx.remainingExpectedKwh, 9);
    });
    (0, node_test_1.it)("day evaluation draft is serializable for later learning", () => {
        const draft = (0, day_evaluation_1.buildDayEvaluationDraft)({
            date: "2026-08-07",
            timezone: "Europe/Berlin",
            now: new Date("2026-08-07T22:00:00.000Z"),
            expectedPvKwh: 30,
            actualPvKwh: 22,
            expectedHouseLoadKwh: 12,
            actualHouseLoadKwh: 13,
            expectedGridImportKwh: 4,
            actualGridImportKwh: 5,
            expectedGridExportKwh: 8,
            actualGridExportKwh: 3,
            expectedImmersionKwh: 5,
            actualImmersionKwh: 4,
            expectedClimateKwh: 1,
            actualClimateKwh: 1.2,
            replanCount: 3,
            replanReasons: [reason_codes_1.REASON.REPLAN_PV_FORECAST_CHANGED],
            goalsMet: [{ consumerId: "immersion_heater", goalId: "thermal", met: true }],
        });
        strict_1.default.equal(draft.replanCount, 3);
        strict_1.default.ok(JSON.parse(JSON.stringify(draft)));
    });
});
