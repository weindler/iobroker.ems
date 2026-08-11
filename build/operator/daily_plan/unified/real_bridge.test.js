"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const contribution_ids_1 = require("../../contribution_ids");
const quality_1 = require("../../quality");
const types_1 = require("../../contributions/types");
const contributor_1 = require("../../contributor");
const allocate_1 = require("./allocate");
const authority_1 = require("./authority");
const dispatch_bridge_1 = require("./dispatch_bridge");
const from_forecast_context_1 = require("./from_forecast_context");
const reason_codes_1 = require("./reason_codes");
const fixtures_1 = require("./fixtures");
const TZ = "Europe/Berlin";
const NOW = new Date("2026-08-07T10:07:00.000Z");
function contributorFor(id) {
    if (id === contribution_ids_1.CONTRIBUTION_IDS.PV_SUPPLY)
        return (0, types_1.pvContributorRef)();
    if (id === contribution_ids_1.CONTRIBUTION_IDS.HOUSE_LOAD_FIXED)
        return (0, contributor_1.systemContributorRef)("house_load");
    if (id === contribution_ids_1.CONTRIBUTION_IDS.GRID_SUPPLY)
        return (0, contributor_1.systemContributorRef)("grid_supply");
    if (id.startsWith("air_conditioning."))
        return (0, contributor_1.addonContributorRef)("air_conditioning");
    if (id.startsWith("immersion_heater."))
        return (0, contributor_1.addonContributorRef)("immersion_heater");
    if (id.startsWith("wallbox."))
        return (0, contributor_1.addonContributorRef)("wallbox");
    return (0, contributor_1.addonContributorRef)("battery");
}
function contrib(id, opts) {
    const { details = {}, ...rest } = opts;
    return (0, types_1.baseContribution)(id, contributorFor(id), "consume", ["supply"], {
        generatedAt: NOW.toISOString(),
        validUntil: null,
        revision: 1,
        enabled: true,
        flexible: false,
        gridEligible: false,
        quality: (0, quality_1.operatorQuality)("valid", "test", 80),
        reasonDe: "test",
        details,
        slots: [],
        ...rest,
    });
}
function realisticSnapshot(overrides) {
    // 4 Stunden → 16×15-Min-Slots (kompaktes Real-Snapshot-Fixture)
    const slots = (0, fixtures_1.buildSlots)("2026-08-07T08:00:00.000Z", 4);
    const o = overrides ?? {};
    const prices = o.prices ?? slots.map((_, i) => 10 + (i % 5));
    const contributions = [];
    if (!o.omitPv) {
        contributions.push(contrib(contribution_ids_1.CONTRIBUTION_IDS.PV_SUPPLY, {
            quality: (0, quality_1.operatorQuality)(o.pvStatus ?? "valid", "PV", 75),
            details: {
                rawTodayKwh: o.rawToday ?? 20,
                correctedTodayKwh: o.correctedToday ?? 18,
                rawTomorrowKwh: 15,
                correctedTomorrowKwh: 14,
                lastUpdateTs: o.pvLastUpdate ?? "2026-08-07T09:00:00.000Z",
                status: "ready",
                source: "learning.pv_bias",
            },
        }));
    }
    contributions.push(contrib(contribution_ids_1.CONTRIBUTION_IDS.HOUSE_LOAD_FIXED, {
        quality: (0, quality_1.operatorQuality)("valid", "Hauslast", 70),
        details: { lastUpdate: "2026-08-07T06:00:00.000Z" },
    }), contrib(contribution_ids_1.CONTRIBUTION_IDS.GRID_SUPPLY, {
        quality: (0, quality_1.operatorQuality)("valid", "Tibber", 90),
        details: { source: "dynamic_tariff" },
    }));
    if (!o.omitBattery) {
        contributions.push(contrib(contribution_ids_1.CONTRIBUTION_IDS.BATTERY_CHARGE, {
            details: {
                socPct: o.socPct === undefined ? 42 : o.socPct,
                maxChargePowerW: 4600,
                avgNightDischargeKwh: 2.5,
            },
        }), contrib(contribution_ids_1.CONTRIBUTION_IDS.BATTERY_RESERVE, {
            details: {
                minSocPct: 10,
                maxSocPct: 100,
                fault: false,
                lockout: false,
            },
        }));
    }
    contributions.push(contrib(contribution_ids_1.CONTRIBUTION_IDS.IMMERSION_FLEXIBLE, {
        enabled: o.ihEnabled !== false,
        quality: (0, quality_1.operatorQuality)(o.ihQuality ?? "valid", "IH", 80),
        deadlineIso: null,
        details: {
            bufferTempC: o.bufferTempC === undefined ? 48 : o.bufferTempC,
            boilerTempC: o.bufferTempC === undefined ? 48 : o.bufferTempC,
            boilerMinTempC: 48,
            targetTempC: 56,
            planningMinTempC: 48,
            mandatoryMinTempC: 48,
            planningMaxTempC: 60,
            maxPowerW: 1700,
            minPowerW: 1700,
            requiredEnergyKwh: 3,
            boilerEstimatedEmptyAt: "2026-08-07T22:00:00.000Z",
            estimatedEmptyAt: "2026-08-07T22:00:00.000Z",
            emptyAtSource: "learned",
            emptyAtPlanningUsable: true,
            thermalLearningStatus: "valid",
            coolingRateCPerHAvg: 0.4,
            boilerCoolingRateCPerHAvg: 0.4,
            minimumRuntimeSec: 60,
            reheatHysteresisK: 2,
            reheatHysteresisActive: false,
            nightBridgeActive: false,
        },
    }), contrib(contribution_ids_1.CONTRIBUTION_IDS.AC_UNIT(1), {
        details: {
            name: "Wohnzimmer",
            roomTempC: 27,
            onTempC: 25,
            offTempC: 23,
            estimatedPowerW: 900,
            expectedKwhToday: 2.2,
        },
    }), contrib(contribution_ids_1.CONTRIBUTION_IDS.WALLBOX_EV_SESSION, {
        enabled: o.connected === true,
        details: {
            connected: o.connected === true,
            vehicleSocPct: o.vehicleSoc === undefined ? null : o.vehicleSoc,
            requiredEnergyKwh: o.connected ? 12 : null,
            maxChargePowerW: 11000,
            planSocPct: 80,
        },
    }));
    return {
        now: NOW,
        timezone: TZ,
        globalMode: "balanced",
        forecastPlan: {
            slots: slots.map((slot, i) => ({
                slot,
                pvPowerW: o.omitPv ? null : 2000 + i * 50,
                houseLoadPowerW: 800,
                fixedBalancePowerW: 1200,
                gridPriceCtPerKwh: prices[i] ?? null,
                gridImportAllowed: true,
                gridMaxImportPowerW: 11000,
                outdoorTempC: 22,
                quality: (0, quality_1.operatorQuality)("valid", "slot", 80),
                reasonDe: "t",
            })),
            days: [
                {
                    date: "2026-08-07",
                    pvEnergyKwh: o.correctedToday ?? 18,
                    houseLoadEnergyKwh: 12,
                    renewableBalanceKwh: 6,
                    weatherMinTempC: null,
                    weatherMaxTempC: null,
                    quality: (0, quality_1.operatorQuality)("valid", "day", 80),
                    reasonDe: "t",
                },
            ],
            contributions,
        },
        bufferTempC: o.bufferTempC === undefined ? 48 : o.bufferTempC,
        batterySocPct: o.socPct === undefined ? 42 : o.socPct,
        batteryCapacityKwh: o.capacity === undefined ? 18 : o.capacity,
        batteryMaxChargePowerW: 4600,
        batteryMinSocPct: 10,
        batteryMaxSocPct: 100,
        roomTemps: { 1: 27 },
        contributionRevision: 99,
        feedInCtPerKwh: o.feedInCtPerKwh,
    };
}
(0, node_test_1.describe)("REAL-001 Real PV Mapping", () => {
    (0, node_test_1.it)("maps slots, bias once, freshness age", () => {
        const ctx = realisticSnapshot({
            rawToday: 20,
            correctedToday: 18,
            pvLastUpdate: "2026-08-07T09:00:00.000Z",
        });
        const input = (0, from_forecast_context_1.buildUnifiedInputFromForecastContext)(ctx);
        strict_1.default.equal(input.pv.slots.length, ctx.forecastPlan.slots.length);
        strict_1.default.equal(input.pv.slots[0].slot.startIso, ctx.forecastPlan.slots[0].slot.startIso);
        strict_1.default.equal(input.pv.biasCorrected, true);
        strict_1.default.equal(input.pv.biasPct, -10); // (18-20)/20
        strict_1.default.equal(input.pv.expectedDayEnergyKwh, 18);
        strict_1.default.ok(input.pv.freshness.ageSec !== null && input.pv.freshness.ageSec > 0);
        strict_1.default.equal(input.pv.freshness.observedAtIso, "2026-08-07T09:00:00.000Z");
        // Keine zweite Korrektur: Slot-Leistung = ForecastPlan (bereits korrigierte Form)
        strict_1.default.equal(input.pv.slots[0].forecastPowerW, ctx.forecastPlan.slots[0].pvPowerW);
    });
});
(0, node_test_1.describe)("REAL-002 Real Tibber Mapping", () => {
    (0, node_test_1.it)("maps price intervals without night hardcodes; null stays null", () => {
        const prices = [25, 20, null, 8, 12, 30, null, 15, 18, 22, 19, 16, 14, 11, 9, 7];
        const ctx = realisticSnapshot({ prices });
        const input = (0, from_forecast_context_1.buildUnifiedInputFromForecastContext)(ctx);
        strict_1.default.equal(input.prices.slots.length, 16);
        strict_1.default.equal(input.prices.slots[2].importCtPerKwh, null);
        strict_1.default.equal(input.prices.slots[3].importCtPerKwh, 8);
        // Ohne feed_in Config bleibt export null → Scorer-Fallback 6 ct (nicht verdrahtet als 0)
        strict_1.default.ok(input.prices.slots.every((s) => s.exportCtPerKwh === null));
        // Reihenfolge = Slot-Zeit
        for (let i = 1; i < input.prices.slots.length; i++) {
            strict_1.default.ok(input.prices.slots[i].slot.startIso > input.prices.slots[i - 1].slot.startIso);
        }
    });
    (0, node_test_1.it)("A: feed_in 9.3 ct/kWh reaches unified exportCtPerKwh (no silent € conversion)", () => {
        strict_1.default.equal((0, from_forecast_context_1.normalizeFeedInCtPerKwh)(9.3), 9.3);
        const input = (0, from_forecast_context_1.buildUnifiedInputFromForecastContext)(realisticSnapshot({ feedInCtPerKwh: 9.3 }));
        strict_1.default.ok(input.prices.slots.every((s) => s.exportCtPerKwh === 9.3));
        const plan = (0, allocate_1.allocateUnifiedDayPlan)(input);
        strict_1.default.equal(plan.reasonCodes.includes(reason_codes_1.REASON.EXPORT_TARIFF_UNKNOWN), false);
    });
    (0, node_test_1.it)("B: missing feed_in keeps export null and EXPORT_TARIFF_UNKNOWN", () => {
        const input = (0, from_forecast_context_1.buildUnifiedInputFromForecastContext)(realisticSnapshot());
        strict_1.default.ok(input.prices.slots.every((s) => s.exportCtPerKwh === null));
        const plan = (0, allocate_1.allocateUnifiedDayPlan)(input);
        strict_1.default.ok(plan.reasonCodes.includes(reason_codes_1.REASON.EXPORT_TARIFF_UNKNOWN));
    });
    (0, node_test_1.it)("C: invalid feed_in (NaN/negative/non-number) → null, no NaN in context", () => {
        strict_1.default.equal((0, from_forecast_context_1.normalizeFeedInCtPerKwh)(Number.NaN), null);
        strict_1.default.equal((0, from_forecast_context_1.normalizeFeedInCtPerKwh)(-1), null);
        strict_1.default.equal((0, from_forecast_context_1.normalizeFeedInCtPerKwh)("9.3"), null);
        strict_1.default.equal((0, from_forecast_context_1.normalizeFeedInCtPerKwh)(Infinity), null);
        for (const bad of [Number.NaN, -0.1, null]) {
            const input = (0, from_forecast_context_1.buildUnifiedInputFromForecastContext)(realisticSnapshot({ feedInCtPerKwh: bad }));
            strict_1.default.ok(input.prices.slots.every((s) => s.exportCtPerKwh === null));
            strict_1.default.ok(input.prices.slots.every((s) => !Number.isNaN(s.exportCtPerKwh)));
        }
    });
});
(0, node_test_1.describe)("REAL-003 Real Battery Mapping", () => {
    (0, node_test_1.it)("SOC 0 is real zero; unknown stays null; night reserve mapped", () => {
        const zero = (0, from_forecast_context_1.buildUnifiedInputFromForecastContext)(realisticSnapshot({ socPct: 0, capacity: 18 }));
        strict_1.default.equal(zero.battery.socPct, 0);
        strict_1.default.equal(zero.battery.usableCapacityKwh, 18);
        strict_1.default.equal(zero.battery.maxChargePowerW, 4600);
        strict_1.default.equal(zero.battery.minSocPct, 10);
        strict_1.default.equal(zero.battery.nightReserveKwh, 2.5);
        const unknown = (0, from_forecast_context_1.buildUnifiedInputFromForecastContext)(realisticSnapshot({ socPct: null, capacity: null, omitBattery: true }));
        strict_1.default.equal(unknown.battery.socPct, null);
        strict_1.default.equal(unknown.battery.usableCapacityKwh, null);
        strict_1.default.equal(unknown.battery.uncertainty.status, "missing");
    });
});
(0, node_test_1.describe)("REAL-004 Real Thermal Mapping", () => {
    (0, node_test_1.it)("headroom from contribution requiredEnergyKwh; blocked clears flex; deadline mapped", () => {
        const ok = (0, from_forecast_context_1.buildUnifiedInputFromForecastContext)(realisticSnapshot({ bufferTempC: 50 }));
        strict_1.default.ok(ok.thermal);
        strict_1.default.equal(ok.thermal.bufferTempC, 50);
        strict_1.default.equal(ok.thermal.dayTargetTempC, 56);
        // Fixture liefert Contribution-requiredEnergyKwh=3 (keine Bridge-eigene 0.38-Formel)
        strict_1.default.equal(ok.thermal.headroomEnergyKwh, 3);
        strict_1.default.equal(ok.thermal.deadlineIso, "2026-08-07T22:00:00.000Z");
        strict_1.default.equal(ok.thermal.emptyAtSource, "learned");
        const blocked = (0, from_forecast_context_1.buildUnifiedInputFromForecastContext)(realisticSnapshot({ ihQuality: "blocked", bufferTempC: 50 }));
        strict_1.default.equal(blocked.thermal.headroomEnergyKwh, 0);
        strict_1.default.equal(blocked.thermal.uncertainty.status, "blocked");
    });
});
(0, node_test_1.describe)("REAL-005 Real AC Mapping", () => {
    (0, node_test_1.it)("maps unit comfort and power without inventing defaults", () => {
        const input = (0, from_forecast_context_1.buildUnifiedInputFromForecastContext)(realisticSnapshot());
        strict_1.default.ok(input.climate);
        strict_1.default.equal(input.climate.units.length, 1);
        strict_1.default.equal(input.climate.units[0].roomTempC, 27);
        strict_1.default.equal(input.climate.units[0].mandatoryComfort, true);
        strict_1.default.equal(input.climate.units[0].typicalPowerW, 900);
        strict_1.default.equal(input.climate.units[0].expectedEnergyKwh, 2.2);
    });
});
(0, node_test_1.describe)("REAL-006 Vehicle Connected vs Unknown Presence", () => {
    (0, node_test_1.it)("connectedNow does not invent future presence as available", () => {
        const input = (0, from_forecast_context_1.buildUnifiedInputFromForecastContext)(realisticSnapshot({ connected: true, vehicleSoc: 40 }));
        strict_1.default.ok(input.wallbox);
        strict_1.default.equal(input.wallbox.connectedNow, true);
        strict_1.default.equal(input.wallbox.presenceHardConstraint, true);
        strict_1.default.equal(input.wallbox.vehicleSocPct, 40);
        strict_1.default.ok(input.wallbox.presenceWindows.some((w) => w.source === "live_connected"));
        // Zukunft ohne History/Explicit → unknown, nicht still available
        strict_1.default.ok(input.wallbox.presenceWindows.some((w) => (w.status ?? (w.available ? "available" : "unavailable")) === "unknown"));
        strict_1.default.equal(input.wallbox.presenceWindows.some((w) => w.source === "predicted"), false);
        const plan = (0, allocate_1.allocateUnifiedDayPlan)(input);
        strict_1.default.ok(plan.reasonCodes.includes(reason_codes_1.REASON.VEHICLE_PRESENCE_UNKNOWN));
        const disc = (0, from_forecast_context_1.buildUnifiedInputFromForecastContext)(realisticSnapshot({ connected: false }));
        strict_1.default.equal(disc.wallbox.connectedNow, false);
        strict_1.default.ok(disc.wallbox.presenceWindows.some((w) => w.source === "live_disconnected"));
        strict_1.default.equal(disc.wallbox.presenceWindows.some((w) => (w.status ?? (w.available ? "available" : "unavailable")) === "available" &&
            w.source !== "live_connected"), false);
    });
});
(0, node_test_1.describe)("REAL-007 Missing Data degraded plan", () => {
    (0, node_test_1.it)("does not crash; emits degraded confidence and reason codes", () => {
        const input = (0, from_forecast_context_1.buildUnifiedInputFromForecastContext)(realisticSnapshot({
            omitPv: true,
            socPct: null,
            capacity: null,
            omitBattery: true,
            prices: [null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null],
        }));
        strict_1.default.equal(input.pv.uncertainty.status, "missing");
        const plan = (0, allocate_1.allocateUnifiedDayPlan)(input);
        strict_1.default.ok(plan.confidence.status === "degraded" || plan.confidence.status === "missing");
        strict_1.default.ok(plan.reasonCodes.includes(reason_codes_1.REASON.BATTERY_TELEMETRY_MISSING));
        strict_1.default.ok(plan.reasonCodes.includes(reason_codes_1.REASON.EXPORT_TARIFF_UNKNOWN));
        strict_1.default.equal(plan.batteryTrajectory.length, 0);
    });
});
(0, node_test_1.describe)("REAL-008 End-to-End Real Day Plan + IH/AC Authority", () => {
    (0, node_test_1.it)("snapshot → unified input → allocate → authority without second planner world", () => {
        const ctx = realisticSnapshot({ connected: true, vehicleSoc: 55 });
        const input = (0, from_forecast_context_1.buildUnifiedInputFromForecastContext)(ctx);
        const unified = (0, allocate_1.allocateUnifiedDayPlan)(input);
        strict_1.default.ok((unified.expectedPvEnergyTodayKwh ?? 0) > 0 || (unified.expectedPvEnergyHorizonKwh ?? 0) > 0);
        strict_1.default.ok((unified.expectedHouseLoadEnergyTodayKwh ?? 0) > 0 ||
            (unified.expectedHouseLoadEnergyHorizonKwh ?? 0) > 0);
        strict_1.default.equal(unified.inputRevision, 99);
        strict_1.default.ok(unified.allocations.some((a) => a.kind === "immersion_heater" || a.kind === "climate"));
        const pub = (0, dispatch_bridge_1.buildUnifiedIhAcDispatchPublish)(unified);
        const classicLike = {
            generatedAt: NOW.toISOString(),
            validUntil: null,
            revision: 99,
            date: "2026-08-07",
            timezone: TZ,
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
            quality: (0, quality_1.operatorQuality)("valid", "t", 80),
            reasonDe: "classic",
        };
        const merged = (0, authority_1.applyUnifiedIhAcAuthority)(classicLike, pub.immersionEntries, pub.climateEntries, {
            dailyPlanRevision: 99,
            unifiedPlanId: unified.planId,
        });
        strict_1.default.ok(merged.allocations.every((a) => a.reasonDe.includes("unified_day_plan") || a.reasonDe.includes("daily_plan_rev=99")));
        // Battery/Wallbox slices not taken over for live — only IH/AC in authority merge here
        strict_1.default.equal(merged.allocations.filter((a) => a.contributionId.startsWith("battery.")).length, 0);
    });
});
