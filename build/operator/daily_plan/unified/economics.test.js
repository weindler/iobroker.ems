"use strict";
/**
 * ECON-001…005 — Vehicle Charge Economics Baseline (earliest_feasible).
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const allocate_1 = require("./allocate");
const fixtures_1 = require("./fixtures");
const alloc_fixtures_1 = require("./alloc_fixtures");
const quality_1 = require("../../quality");
const Q = (0, quality_1.operatorQuality)("valid", "econ", 90);
const FRESH = { observedAtIso: "2026-08-04T00:00:00.000Z", ageSec: 0, quality: Q };
function econBase(hours = 8) {
    const slots = (0, fixtures_1.buildSlots)("2026-08-04T00:00:00.000Z", hours);
    return {
        schemaVersion: 1,
        planIntent: "unified_day",
        time: {
            nowIso: "2026-08-04T00:05:00.000Z",
            timezone: "Europe/Berlin",
            horizonStartIso: slots[0].startIso,
            horizonEndIso: slots[slots.length - 1].endIso,
            slotMinutes: 15,
            slots,
            freshness: FRESH,
        },
        pv: {
            slots: slots.map((s) => ({
                slot: s,
                forecastPowerW: 200,
                observedPowerW: null,
                energyKwh: 0.05,
            })),
            expectedDayEnergyKwh: slots.length * 0.05,
            previousExpectedDayEnergyKwh: null,
            biasCorrected: true,
            biasPct: 0,
            uncertainty: Q,
            freshness: FRESH,
        },
        prices: {
            slots: slots.map((s, i) => ({
                slot: s,
                importCtPerKwh: 10 + i, // rising — earliest expensive relative to later cheap? wait rising means earliest cheaper
                exportCtPerKwh: null,
                gridImportAllowed: true,
            })),
            uncertainty: Q,
            freshness: FRESH,
        },
        houseLoad: {
            slots: slots.map((s) => ({
                slot: s,
                forecastPowerW: 400,
                observedPowerW: null,
                energyKwh: 0.1,
            })),
            expectedDayEnergyKwh: slots.length * 0.1,
            uncertainty: Q,
            freshness: FRESH,
        },
        battery: {
            socPct: 80,
            usableCapacityKwh: 10,
            minSocPct: 10,
            maxSocPct: 100,
            maxChargePowerW: 5000,
            maxDischargePowerW: 5000,
            chargeEfficiency: 0.95,
            dischargeEfficiency: 0.95,
            allowedModes: ["charge", "idle"],
            reserveSocPct: 20,
            profileId: "sonnen_em",
            dischargeLiveSupported: false,
            requiredChargeEnergyKwh: null,
            chargeDeadlineIso: null,
            gridChargeAllowed: true,
            uncertainty: Q,
            freshness: FRESH,
        },
        wallbox: {
            connectedNow: true,
            presenceWindows: [
                {
                    available: true,
                    status: "available",
                    source: "explicit",
                    hard: true,
                    startIso: slots[0].startIso,
                    endIso: slots[slots.length - 1].endIso,
                },
            ],
            presenceHardConstraint: true,
            vehicleProfileId: "econ_vehicle",
            vehicleSocPct: 40,
            socSource: "direct",
            fallbackEnergyNeedKwh: null,
            vehicleCapacityKwh: 60,
            targetSocPct: 80,
            requiredEnergyKwh: 12,
            deadlineIso: slots[slots.length - 1].endIso,
            energyGoalHard: true,
            minChargePowerW: 1380,
            maxChargePowerW: 11000,
            chargeLossFactor: 1,
            evccExecutionMaster: true,
            uncertainty: Q,
            freshness: FRESH,
        },
        thermal: null,
        climate: null,
        otherFlex: [],
        contributionRevision: 1,
        globalMode: "balanced",
    };
}
/** Frühe Slots teuer, späte billig — Optimizer wählt spät, earliest früh. */
function pricesExpensiveThenCheap(input) {
    const n = input.time.slots.length;
    input.prices.slots = input.time.slots.map((s, i) => ({
        slot: s,
        importCtPerKwh: i < n / 2 ? 40 : 10,
        exportCtPerKwh: null,
        gridImportAllowed: true,
    }));
    return input;
}
(0, node_test_1.describe)("ECON-001 optimized vs earliest_feasible", () => {
    (0, node_test_1.it)("savings = earliest cost − optimized cost for same grid energy", () => {
        const input = pricesExpensiveThenCheap(econBase(6));
        const plan = (0, allocate_1.allocateUnifiedDayPlan)(input);
        const eco = plan.vehicleChargeEconomics;
        strict_1.default.equal(eco.baselineId, "earliest_feasible");
        strict_1.default.ok((eco.expectedGridChargeKwh ?? 0) > 5);
        strict_1.default.ok(eco.expectedGridCostCt !== null);
        strict_1.default.ok(eco.alternativeGridCostCt !== null);
        strict_1.default.ok(eco.savingsVsAlternativeCt !== null);
        strict_1.default.equal(eco.savingsVsAlternativeCt, Math.round((eco.alternativeGridCostCt - eco.expectedGridCostCt) * 1000) / 1000);
        strict_1.default.ok(eco.savingsVsAlternativeCt > 0, "optimized should beat earliest when prices fall later");
        strict_1.default.equal(eco.economicsCompleteness, "grid_only");
        strict_1.default.equal(eco.exportTariffKnown, false);
    });
});
(0, node_test_1.describe)("ECON-002 most expensive unused slot does not inflate savings", () => {
    (0, node_test_1.it)("ignores a spike slot that earliest_feasible never needs", () => {
        const input = pricesExpensiveThenCheap(econBase(8));
        // Spike at the very end — neither optimized (cheap mid) nor earliest (front) needs it for typical grid fill
        const last = input.prices.slots.length - 1;
        input.prices.slots[last] = {
            ...input.prices.slots[last],
            importCtPerKwh: 999,
        };
        const plan = (0, allocate_1.allocateUnifiedDayPlan)(input);
        const eco = plan.vehicleChargeEconomics;
        strict_1.default.ok(eco.savingsVsAlternativeCt !== null);
        const grid = eco.expectedGridChargeKwh;
        const fakeMaxBased = grid * 999 - (eco.expectedGridCostCt ?? 0);
        strict_1.default.ok(eco.savingsVsAlternativeCt < fakeMaxBased * 0.5, `savings ${eco.savingsVsAlternativeCt} must not be driven by unused 999ct slot (fake ${fakeMaxBased})`);
    });
});
(0, node_test_1.describe)("ECON-003 vehicle arrives later — earliest starts at first available", () => {
    (0, node_test_1.it)("baseline does not assume charge while absent", () => {
        const input = pricesExpensiveThenCheap(econBase(8));
        const slots = input.time.slots;
        const awayEnd = slots[16].startIso; // 4h away
        input.wallbox.connectedNow = false;
        input.wallbox.presenceWindows = [
            {
                available: false,
                status: "unavailable",
                source: "explicit",
                hard: true,
                startIso: slots[0].startIso,
                endIso: awayEnd,
            },
            {
                available: true,
                status: "available",
                source: "explicit",
                hard: true,
                startIso: awayEnd,
                endIso: slots[slots.length - 1].endIso,
            },
        ];
        // Make early half (while away) cheap and late half expensive — if baseline wrongly used absence, it would look cheap
        input.prices.slots = slots.map((s, i) => ({
            slot: s,
            importCtPerKwh: i < 16 ? 5 : 35,
            exportCtPerKwh: null,
            gridImportAllowed: true,
        }));
        const plan = (0, allocate_1.allocateUnifiedDayPlan)(input);
        const eco = plan.vehicleChargeEconomics;
        strict_1.default.ok((eco.expectedGridChargeKwh ?? 0) > 0);
        strict_1.default.ok(eco.alternativeGridCostCt !== null);
        // Earliest feasible must price from first available (≥35ct region) → high baseline
        strict_1.default.ok(eco.alternativeGridCostCt >= (eco.expectedGridChargeKwh * 30) * 0.9, `earliest ${eco.alternativeGridCostCt} should reflect first available (expensive) window`);
        const phantomWhileAway = plan.allocations.filter((a) => a.kind === "wallbox" && Date.parse(a.slot.startIso) < Date.parse(awayEnd));
        strict_1.default.equal(phantomWhileAway.length, 0);
    });
});
(0, node_test_1.describe)("ECON-004 incomplete prices → savings null", () => {
    (0, node_test_1.it)("does not invent savings without enough price values", () => {
        const input = econBase(6);
        input.prices.slots = input.time.slots.map((s) => ({
            slot: s,
            importCtPerKwh: null,
            exportCtPerKwh: null,
            gridImportAllowed: true,
        }));
        const plan = (0, allocate_1.allocateUnifiedDayPlan)(input);
        const eco = plan.vehicleChargeEconomics;
        strict_1.default.equal(eco.savingsVsAlternativeCt, null);
        strict_1.default.equal(eco.economicsCompleteness, "unknown");
        // Without prices allocator may still place grid energy, but costs/baseline incomplete
        strict_1.default.ok(eco.expectedGridCostCt === null || eco.alternativeGridCostCt === null);
    });
});
(0, node_test_1.describe)("ECON-005 identical costs → savings 0", () => {
    (0, node_test_1.it)("flat prices yield zero savings, not a fake positive", () => {
        const input = econBase(6);
        input.prices.slots = input.time.slots.map((s) => ({
            slot: s,
            importCtPerKwh: 22,
            exportCtPerKwh: null,
            gridImportAllowed: true,
        }));
        const plan = (0, allocate_1.allocateUnifiedDayPlan)(input);
        const eco = plan.vehicleChargeEconomics;
        strict_1.default.ok((eco.expectedGridChargeKwh ?? 0) > 0);
        strict_1.default.equal(eco.expectedGridCostCt, eco.alternativeGridCostCt);
        strict_1.default.equal(eco.savingsVsAlternativeCt, 0);
    });
});
(0, node_test_1.describe)("ECON regression smoke with ALLOC-004", () => {
    (0, node_test_1.it)("exposes earliest_feasible fields on production-like fixture", () => {
        const eco = (0, allocate_1.allocateUnifiedDayPlan)((0, alloc_fixtures_1.alloc004Input)()).vehicleChargeEconomics;
        strict_1.default.equal(eco.baselineId, "earliest_feasible");
        strict_1.default.ok(eco.expectedPvChargeKwh !== null);
        strict_1.default.ok(["full", "grid_only", "unknown"].includes(eco.economicsCompleteness));
    });
});
