"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Beta-Befund 002: konsistente NOW-Bilanz + House-Load-Dekomposition + Remaining.
 */
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const quality_1 = require("../quality");
const live_now_balance_1 = require("./live_now_balance");
const recompute_remainings_1 = require("./recompute_remainings");
const score_allocate_1 = require("./unified/score_allocate");
const decompose_1 = require("../../learning/house_load/decompose");
const from_forecast_context_1 = require("./unified/from_forecast_context");
const allocate_1 = require("./unified/allocate");
const fixtures_1 = require("./unified/fixtures");
const Q = (0, quality_1.operatorQuality)("valid", "test");
const FRESH = { observedAtIso: "2026-08-08T10:07:00.000Z", ageSec: 5, quality: Q };
function slotStub(startIso, endIso, pv, house) {
    const bal = pv - house;
    const avail = Math.max(0, bal);
    return {
        slot: { startIso, endIso },
        pvForecastPowerW: pv,
        fixedHouseLoadPowerW: house,
        fixedBalancePowerW: bal,
        gridPriceCtPerKwh: 20,
        gridImportAllowed: true,
        configuredGridImportLimitW: 11000,
        remainingGridImportPowerW: 11000,
        availablePvSurplusPowerW: avail,
        allocatedFlexiblePowerW: 0,
        allocatedPvPowerW: 0,
        allocatedGridPowerW: 0,
        allocatedBatteryPowerW: 0,
        remainingPvSurplusPowerW: avail,
        remainingGridImportPowerWAfterAlloc: 11000,
        remainingBatteryDischargePowerW: 0,
        allocations: [],
        quality: Q,
        reasonDe: "forecast",
    };
}
(0, node_test_1.describe)("Beta-Befund 002 A — NOW konsistent live", () => {
    (0, node_test_1.it)("Observed PV 5005 / House 1154 → surplus 3851, Felder live-live", () => {
        const bal = (0, live_now_balance_1.computeLiveNowBalanceW)(5005, 1154);
        strict_1.default.equal(bal.pvPowerW, 5005);
        strict_1.default.equal(bal.houseLoadPowerW, 1154);
        strict_1.default.equal(bal.fixedBalancePowerW, 3851);
        strict_1.default.equal(bal.availablePvSurplusPowerW, 3851);
        const slots = [
            slotStub("2026-08-08T10:00:00.000Z", "2026-08-08T10:15:00.000Z", 4232, 2136),
            slotStub("2026-08-08T10:15:00.000Z", "2026-08-08T10:30:00.000Z", 4232, 2136),
        ];
        const nowMs = Date.parse("2026-08-08T10:07:00.000Z");
        const ok = (0, live_now_balance_1.applyLiveNowBalanceToCurrentSlot)(slots, nowMs, {
            pvPowerW: 5005,
            houseLoadW: 1154,
            pvAgeSec: 10,
            houseAgeSec: 10,
        });
        strict_1.default.equal(ok, true);
        strict_1.default.equal(slots[0].pvForecastPowerW, 5005);
        strict_1.default.equal(slots[0].fixedHouseLoadPowerW, 1154);
        strict_1.default.equal(slots[0].fixedBalancePowerW, 3851);
        strict_1.default.equal(slots[0].availablePvSurplusPowerW, 3851);
        strict_1.default.equal((0, live_now_balance_1.slotBalanceIsConsistent)(slots[0]), true);
    });
});
(0, node_test_1.describe)("Beta-Befund 002 B — Zukunft Forecast-only", () => {
    (0, node_test_1.it)("Folgeslot bleibt 4232−2136=2096, kein Live-Floor", () => {
        const slots = [
            slotStub("2026-08-08T10:00:00.000Z", "2026-08-08T10:15:00.000Z", 4232, 2136),
            slotStub("2026-08-08T10:15:00.000Z", "2026-08-08T10:30:00.000Z", 4232, 2136),
        ];
        (0, live_now_balance_1.applyLiveNowBalanceToCurrentSlot)(slots, Date.parse("2026-08-08T10:07:00.000Z"), {
            pvPowerW: 5005,
            houseLoadW: 1154,
            pvAgeSec: 5,
            houseAgeSec: 5,
        });
        strict_1.default.equal(slots[1].pvForecastPowerW, 4232);
        strict_1.default.equal(slots[1].fixedHouseLoadPowerW, 2136);
        strict_1.default.equal(slots[1].availablePvSurplusPowerW, 2096);
        strict_1.default.equal((0, live_now_balance_1.slotBalanceIsConsistent)(slots[1]), true);
    });
});
(0, node_test_1.describe)("Beta-Befund 002 C — No-mix invariant", () => {
    (0, node_test_1.it)("reject forecast components + live balance", () => {
        strict_1.default.equal((0, live_now_balance_1.slotBalanceIsConsistent)({
            pvForecastPowerW: 4232,
            fixedHouseLoadPowerW: 2136,
            fixedBalancePowerW: 3851,
            availablePvSurplusPowerW: 3851,
        }), false);
    });
    (0, node_test_1.it)("stale live → Forecast-Fallback (keine Live-Felder)", () => {
        strict_1.default.equal((0, live_now_balance_1.isLiveNowTelemetryUsable)({
            pvPowerW: 5005,
            houseLoadW: 1154,
            pvAgeSec: 500,
            houseAgeSec: 5,
        }), false);
        const slots = [slotStub("2026-08-08T10:00:00.000Z", "2026-08-08T10:15:00.000Z", 4232, 2136)];
        const ok = (0, live_now_balance_1.applyLiveNowBalanceToCurrentSlot)(slots, Date.parse("2026-08-08T10:07:00.000Z"), {
            pvPowerW: 5005,
            houseLoadW: 1154,
            pvAgeSec: 500,
            houseAgeSec: 5,
        });
        strict_1.default.equal(ok, false);
        strict_1.default.equal(slots[0].availablePvSurplusPowerW, 2096);
    });
});
(0, node_test_1.describe)("Beta-Befund 002 D/E/G — AC-Dekomposition", () => {
    (0, node_test_1.it)("D: Measured 1800, AC 700 → baseline 1100", () => {
        const r = (0, decompose_1.decomposeHouseLoadBaselineW)(1800, { climateW: 700 });
        strict_1.default.equal(r.baselineW, 1100);
        strict_1.default.equal(r.subtractedW, 700);
        strict_1.default.equal(r.quality, "full");
    });
    (0, node_test_1.it)("E: U1+U2 nur einmal bilanziert", () => {
        const r = (0, decompose_1.decomposeHouseLoadBaselineW)(2500, {
            climateUnitsW: [700, 715],
            climateW: 1415, // ignoriert wenn Units gesetzt
        });
        strict_1.default.equal(r.subtractedW, 1415);
        strict_1.default.equal(r.baselineW, 1085);
        strict_1.default.equal(r.subtractedParts.filter((p) => p.id.startsWith("climate")).length, 2);
    });
    (0, node_test_1.it)("G: Missing AC power → keine negative Baseline, quality markiert", () => {
        const r = (0, decompose_1.decomposeHouseLoadBaselineW)(1800, {
            climateUnitsW: [null, 700],
            immersionHeaterW: null,
        });
        strict_1.default.ok((r.baselineW ?? -1) >= 0);
        strict_1.default.equal(r.baselineW, 1100);
        strict_1.default.equal(r.quality, "partial");
        strict_1.default.ok(r.missingParts.includes("climate.unit_1"));
        strict_1.default.ok(r.missingParts.includes("immersion_heater"));
    });
    (0, node_test_1.it)("applyFlexDecompositionToSamples only where flex known", () => {
        const map = new Map([[1000, { climateW: 700 }]]);
        const { samples, decomposedCount } = (0, decompose_1.applyFlexDecompositionToSamples)([
            { hourStartMs: 1000, powerW: 1800 },
            { hourStartMs: 2000, powerW: 1800 },
        ], map);
        strict_1.default.equal(samples[0].powerW, 1100);
        strict_1.default.equal(samples[1].powerW, 1800);
        strict_1.default.equal(decomposedCount, 1);
    });
});
(0, node_test_1.describe)("Beta-Befund 002 Score-Allocator NOW observed", () => {
    (0, node_test_1.it)("NOW uses observed surplus 3851, future forecast 2096", () => {
        const nowIso = "2026-08-08T10:07:00.000Z";
        const slots = [
            { startIso: "2026-08-08T10:00:00.000Z", endIso: "2026-08-08T10:15:00.000Z" },
            { startIso: "2026-08-08T10:15:00.000Z", endIso: "2026-08-08T10:30:00.000Z" },
        ];
        const input = {
            schemaVersion: 1,
            planIntent: "unified_day",
            time: {
                nowIso,
                timezone: "Europe/Berlin",
                horizonStartIso: slots[0].startIso,
                horizonEndIso: slots[1].endIso,
                slotMinutes: 15,
                slots,
                freshness: FRESH,
            },
            globalMode: "balanced",
            pv: {
                expectedDayEnergyKwh: 40,
                uncertainty: Q,
                freshness: FRESH,
                biasCorrected: true,
                biasPct: null,
                previousExpectedDayEnergyKwh: null,
                slots: [
                    {
                        slot: slots[0],
                        forecastPowerW: 4232,
                        observedPowerW: 5005,
                        energyKwh: (0, score_allocate_1.energyFromPowerW)(5005),
                    },
                    {
                        slot: slots[1],
                        forecastPowerW: 4232,
                        observedPowerW: null,
                        energyKwh: (0, score_allocate_1.energyFromPowerW)(4232),
                    },
                ],
            },
            houseLoad: {
                expectedDayEnergyKwh: 22,
                uncertainty: Q,
                freshness: FRESH,
                slots: [
                    {
                        slot: slots[0],
                        forecastPowerW: 2136,
                        observedPowerW: 1154,
                        energyKwh: (0, score_allocate_1.energyFromPowerW)(1154),
                    },
                    {
                        slot: slots[1],
                        forecastPowerW: 2136,
                        observedPowerW: null,
                        energyKwh: (0, score_allocate_1.energyFromPowerW)(2136),
                    },
                ],
            },
            prices: {
                uncertainty: Q,
                freshness: FRESH,
                slots: slots.map((s) => ({
                    slot: s,
                    importCtPerKwh: 20,
                    exportCtPerKwh: null,
                    gridImportAllowed: true,
                })),
            },
            battery: {
                socPct: 50,
                usableCapacityKwh: 10,
                maxChargePowerW: 5000,
                maxDischargePowerW: null,
                minSocPct: 10,
                maxSocPct: 100,
                reserveSocPct: 20,
                nightReserveKwh: null,
                chargeEfficiency: 0.95,
                dischargeEfficiency: 0.95,
                allowedModes: ["idle", "charge"],
                requiredChargeEnergyKwh: null,
                chargeDeadlineIso: null,
                gridChargeAllowed: true,
                profileId: "sonnen_em",
                dischargeLiveSupported: false,
                uncertainty: Q,
                freshness: FRESH,
            },
            thermal: null,
            climate: null,
            wallbox: null,
            otherFlex: [],
            contributionRevision: 1,
        };
        const work = (0, score_allocate_1.buildSlots)(input);
        strict_1.default.ok(Math.abs(work[0].surplusKwh - (0, score_allocate_1.energyFromPowerW)(3851)) < 1e-9);
        strict_1.default.ok(Math.abs(work[1].surplusKwh - (0, score_allocate_1.energyFromPowerW)(2096)) < 1e-9);
    });
});
(0, node_test_1.describe)("Beta-Befund 002 F — AC Runtime-Hold", () => {
    (0, node_test_1.it)("Hold: NOW keine Flex-Allocation, Forecast-NOW reserviert Hold-Last", () => {
        const base = (0, fixtures_1.golden001Input)();
        const nowIso = "2026-08-04T10:07:00.000Z";
        const slot0 = { startIso: "2026-08-04T10:00:00.000Z", endIso: "2026-08-04T10:15:00.000Z" };
        const keep = base.time.slots.filter((s) => s.startIso >= slot0.startIso).slice(0, 4);
        base.time = {
            ...base.time,
            nowIso,
            slots: keep,
            horizonStartIso: keep[0].startIso,
            horizonEndIso: keep[keep.length - 1].endIso,
        };
        base.pv.slots = keep.map((s) => ({
            slot: s,
            forecastPowerW: 4000,
            observedPowerW: null,
            energyKwh: (0, score_allocate_1.energyFromPowerW)(4000),
        }));
        base.houseLoad.slots = keep.map((s) => ({
            slot: s,
            forecastPowerW: 1000,
            observedPowerW: null,
            energyKwh: (0, score_allocate_1.energyFromPowerW)(1000),
        }));
        base.prices.slots = keep.map((s) => ({
            slot: s,
            importCtPerKwh: 15,
            exportCtPerKwh: null,
            gridImportAllowed: true,
        }));
        base.thermal = null;
        base.climate = {
            freshness: FRESH,
            units: [
                {
                    unitId: "air_conditioning.unit_2",
                    label: "Josef",
                    roomTempC: 23,
                    comfortMinC: null,
                    comfortMaxC: 25,
                    targetTempC: 25,
                    mandatoryComfort: false,
                    expectedEnergyKwh: 2,
                    typicalPowerW: 700,
                    maxShiftHours: 3,
                    uncertainty: Q,
                    hardwareRunning: true,
                    runtimeHold: true,
                    holdPowerW: 700,
                },
            ],
        };
        const work = (0, score_allocate_1.buildSlots)(base);
        const nowWork = work.find((w) => w.startIso === slot0.startIso);
        // 4000−1000=3000 surplus forecast, minus 700 hold → 2300
        strict_1.default.ok(Math.abs(nowWork.surplusKwh - (0, score_allocate_1.energyFromPowerW)(2300)) < 1e-6);
        const plan = (0, allocate_1.allocateUnifiedDayPlan)(base, { generation: 1 });
        const nowAc = plan.allocations.filter((a) => a.kind === "climate" &&
            a.consumerId.includes("unit_2") &&
            a.slot.startIso === slot0.startIso);
        strict_1.default.equal(nowAc.length, 0, "Runtime-Hold darf keine NOW-Flex-Allocation erzeugen");
    });
});
(0, node_test_1.describe)("Beta-Befund 002 H — Remaining nach Unified", () => {
    (0, node_test_1.it)("remainingPv = available − allocatedPv", () => {
        const slot = slotStub("2026-08-08T10:00:00.000Z", "2026-08-08T10:15:00.000Z", 5005, 1154);
        slot.availablePvSurplusPowerW = 3851;
        slot.allocations = [
            {
                contributionId: "immersion_heater.flexible",
                contributor: { type: "addon", id: "immersion_heater", addonId: "immersion_heater" },
                slot: slot.slot,
                status: "allocated",
                energySource: "pv_surplus",
                requestedPowerW: 1700,
                allocatedPowerW: 1700,
                requestedEnergyKwh: 0.425,
                allocatedEnergyKwh: 0.425,
                gridPowerW: 0,
                pvPowerW: 1700,
                batteryPowerW: 0,
                mandatory: false,
                priorityRank: null,
                deadlineIso: null,
                estimatedCostCt: null,
                reasonDe: "test",
            },
        ];
        const plan = {
            generatedAt: new Date().toISOString(),
            validUntil: null,
            revision: 1,
            date: "2026-08-08",
            timezone: "Europe/Berlin",
            slotMinutes: 15,
            globalMode: "balanced",
            status: "ready",
            activeContributionIds: [],
            excludedContributions: [],
            slots: [slot],
            allocations: slot.allocations,
            unallocated: [],
            totals: {
                pvForecastEnergyKwh: null,
                fixedHouseLoadEnergyKwh: null,
                fixedRenewableBalanceKwh: null,
                flexibleRequestedEnergyKwh: null,
                flexibleAllocatedEnergyKwh: 0.425,
                flexibleUnallocatedEnergyKwh: null,
                pvAllocatedEnergyKwh: 0.425,
                gridAllocatedEnergyKwh: 0,
                batteryChargeEnergyKwh: 0,
                wallboxEnergyKwh: 0,
                immersionHeaterEnergyKwh: 0.425,
                airConditioningEnergyKwh: 0,
                estimatedGridCostCt: null,
                mandatoryRequestedEnergyKwh: null,
                mandatoryAllocatedEnergyKwh: 0,
                mandatoryUnallocatedEnergyKwh: null,
            },
            quality: Q,
            reasonDe: "test",
            policySnapshot: {},
            constraintSnapshot: {},
        };
        const out = (0, recompute_remainings_1.recomputeDailyPlanSlotRemainings)(plan);
        strict_1.default.equal(out.slots[0].allocatedPvPowerW, 1700);
        strict_1.default.equal(out.slots[0].remainingPvSurplusPowerW, 2151);
        strict_1.default.equal(out.slots[0].allocatedFlexiblePowerW, 1700);
    });
});
(0, node_test_1.describe)("Beta-Befund 002 bridge live usable gate", () => {
    (0, node_test_1.it)("stale observed not copied into Unified slots", () => {
        const fp = {
            slots: [
                {
                    slot: { startIso: "2026-08-08T10:00:00.000Z", endIso: "2026-08-08T10:15:00.000Z" },
                    pvPowerW: 4232,
                    houseLoadPowerW: 2136,
                    fixedBalancePowerW: 2096,
                    gridPriceCtPerKwh: 20,
                    gridImportAllowed: true,
                    gridMaxImportPowerW: null,
                    outdoorTempC: null,
                    quality: Q,
                    reasonDe: "fixture",
                },
            ],
            days: [],
            contributions: [],
        };
        const input = (0, from_forecast_context_1.buildUnifiedInputFromForecastContext)({
            now: new Date("2026-08-08T10:07:00.000Z"),
            timezone: "Europe/Berlin",
            globalMode: "balanced",
            forecastPlan: fp,
            observedPvPowerW: 5005,
            observedHouseLoadPowerW: 1154,
            observedPvAgeSec: 400,
            observedHouseAgeSec: 5,
        });
        strict_1.default.equal(input.pv.slots[0].observedPowerW, null);
        strict_1.default.equal(input.houseLoad.slots[0].observedPowerW, null);
    });
});
