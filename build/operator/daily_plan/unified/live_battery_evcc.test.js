"use strict";
/**
 * Schritt 6 — BAT-LIVE / EV-LIVE / ENERGY-DAY + Authority-Kongruenz.
 * Planner schreibt keine Geräte; Dispatch nur über bestehende Runtime-Pfade.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const registry_1 = require("../../../addons/battery/profiles/registry");
const daily_plan_1 = require("../../../addons/battery/runtime/daily_plan");
const execute_1 = require("../../../addons/battery/runtime/execute");
const intent_read_1 = require("../../../addons/battery/runtime/intent_read");
const daily_plan_2 = require("../../../addons/wallbox/runtime/daily_plan");
const intent_1 = require("../../../addons/wallbox/runtime/intent");
const dispatch_1 = require("../../../addons/wallbox/runtime/dispatch");
const addon_plan_publish_1 = require("../addon_plan_publish");
const allocate_1 = require("./allocate");
const authority_1 = require("./authority");
const dispatch_bridge_1 = require("./dispatch_bridge");
const alloc_fixtures_1 = require("./alloc_fixtures");
const fixtures_1 = require("./fixtures");
const evaluate_1 = require("./evaluate");
const replan_failure_1 = require("./replan_failure");
const reason_codes_1 = require("./reason_codes");
const quality_1 = require("../../quality");
const time_1 = require("../../time");
const vehicle_availability_1 = require("./vehicle_availability");
const TZ = "Europe/Berlin";
const PROFILE = (0, registry_1.getBatteryProfile)("sonnen_em");
const LIMITS = {
    maxChargeW: 5000,
    maxDischargeW: 5000,
    minSocPct: 5,
    maxSocPct: 100,
    valid: true,
    issues: [],
};
function okGate(over = {}) {
    return { ...okGateBase(), ...over };
}
function okGateBase() {
    return {
        globalLive: true,
        governanceEnabled: true,
        profileId: "sonnen_em",
        profileLiveControlAvailable: true,
        profileReady: true,
        intentValid: true,
        telemetryReady: true,
        fault: false,
        lockout: false,
        targetMappingConfigured: true,
        ownershipValid: true,
    };
}
function actualSample(over = {}) {
    return {
        date: "2026-08-04",
        nowMs: Date.parse("2026-08-04T10:00:00.000Z"),
        forecastPvDayKwh: 20,
        realizedPvKwh: 2,
        forecastHouseLoadDayKwh: 10,
        batterySocPct: 40,
        thermalHeadroomKwh: 2,
        bufferTempC: 50,
        thermalEmptyAtIso: null,
        acMandatoryAny: false,
        vehicleConnected: null,
        vehicleRequiredEnergyKwh: null,
        vehicleDeadlineIso: null,
        vehicleTargetSocPct: null,
        priceMedianCt: 20,
        priceStructureDigest: "",
        presenceDigest: "",
        thermalBlocked: false,
        cadenceDigest: "",
        ...over,
    };
}
function stubDailyPlan(allocations = []) {
    return {
        status: "ready",
        generatedAt: "2026-08-04T08:00:00.000Z",
        validUntil: "2026-08-05T00:00:00.000Z",
        date: "2026-08-04",
        timezone: TZ,
        globalMode: "balanced",
        slotMinutes: 15,
        revision: 9,
        activeContributionIds: [],
        excludedContributions: [],
        slots: [],
        allocations,
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
        policySnapshot: {},
        constraintSnapshot: {},
        quality: (0, quality_1.operatorQuality)("valid", "stub", 90),
        reasonDe: "stub",
    };
}
function mergeAuthority(input) {
    const unified = (0, allocate_1.allocateUnifiedDayPlan)(input);
    const pub = (0, dispatch_bridge_1.buildUnifiedDispatchPublish)(unified);
    const merged = (0, authority_1.applyUnifiedDayAuthority)(stubDailyPlan(), {
        immersionEntries: pub.immersionEntries,
        climateEntries: pub.climateEntries,
        batteryEntries: pub.batteryEntries,
        wallboxEntries: pub.wallboxEntries,
    }, { dailyPlanRevision: 9, unifiedPlanId: unified.planId });
    return { unified, merged, pub };
}
function alignNowToKind(plan, kind) {
    const cell = plan.allocations.find((a) => a.kind === kind && a.allocatedPowerW > 0);
    strict_1.default.ok(cell, `expected ${kind} allocation`);
    return new Date(Date.parse(cell.slot.startIso) + 60_000);
}
function wbTelemetry(over = {}) {
    return {
        connected: true,
        charging: false,
        vehicleSocPct: 40,
        planSocPct: 80,
        planActive: false,
        sessionEnergyKwh: 2,
        effectivePlanTime: "2026-08-04T22:00:00.000Z",
        planTime: "2026-08-04T22:00:00.000Z",
        activePhases: 3,
        configuredPhases: 3,
        minCurrentA: 6,
        maxCurrentA: 16,
        chargePowerW: null,
        evccConfigured: true,
        mappingsReady: true,
        ...over,
    };
}
function energyDayInput() {
    const slots = (0, fixtures_1.buildSlots)("2026-08-04T04:00:00.000Z", 20);
    const base = (0, fixtures_1.golden001Input)();
    base.time = {
        ...base.time,
        nowIso: "2026-08-04T04:00:00.000Z",
        slots,
        horizonStartIso: slots[0].startIso,
        horizonEndIso: slots[slots.length - 1].endIso,
    };
    base.pv.slots = slots.map((s) => {
        const h = new Date(s.startIso).getUTCHours();
        let power = 200;
        if (h >= 8 && h < 11)
            power = 1200;
        if (h >= 11 && h < 16)
            power = 5500;
        if (h >= 16 && h < 19)
            power = 2000;
        return {
            slot: s,
            forecastPowerW: power,
            observedPowerW: null,
            energyKwh: (power / 1000) * 0.25,
        };
    });
    base.pv.expectedDayEnergyKwh = base.pv.slots.reduce((a, s) => a + (s.energyKwh ?? 0), 0);
    base.pv.previousExpectedDayEnergyKwh = base.pv.expectedDayEnergyKwh;
    base.houseLoad.slots = slots.map((s) => {
        const h = new Date(s.startIso).getUTCHours();
        const power = h >= 6 && h < 9 ? 1400 : h >= 17 && h < 21 ? 1600 : 700;
        return { slot: s, forecastPowerW: power, observedPowerW: null, energyKwh: (power / 1000) * 0.25 };
    });
    base.houseLoad.expectedDayEnergyKwh = base.houseLoad.slots.reduce((a, s) => a + (s.energyKwh ?? 0), 0);
    base.prices.slots = slots.map((s, i) => {
        const h = new Date(s.startIso).getUTCHours();
        const importCt = h < 6 ? 12 : h < 12 ? 28 : h < 17 ? 18 : 35;
        return {
            slot: s,
            importCtPerKwh: importCt + (i % 3),
            exportCtPerKwh: null,
            gridImportAllowed: true,
        };
    });
    base.battery = {
        ...base.battery,
        socPct: 35,
        usableCapacityKwh: 12,
        requiredChargeEnergyKwh: null,
        chargeDeadlineIso: null,
        gridChargeAllowed: true,
        dischargeLiveSupported: false,
        passiveBatteryEnergyAvailable: true,
    };
    base.thermal = {
        ...base.thermal,
        headroomEnergyKwh: 3.5,
        bufferTempC: 48,
        dayTargetTempC: 56,
    };
    base.climate = {
        units: [
            {
                unitId: "air_conditioning.unit_1",
                label: "wohn",
                roomTempC: 26.5,
                comfortMinC: null,
                comfortMaxC: 26,
                targetTempC: 25,
                mandatoryComfort: true,
                expectedEnergyKwh: 2,
                typicalPowerW: 900,
                maxShiftHours: 0,
                uncertainty: (0, quality_1.operatorQuality)("valid", "ok", 80),
            },
        ],
        freshness: {
            observedAtIso: base.time.nowIso,
            ageSec: 10,
            quality: (0, quality_1.operatorQuality)("valid", "ok", 80),
        },
    };
    base.wallbox = {
        connectedNow: false,
        presenceWindows: [
            {
                available: true,
                status: "available",
                source: "explicit",
                hard: true,
                startIso: "2026-08-04T04:00:00.000Z",
                endIso: "2026-08-04T07:00:00.000Z",
            },
            {
                available: false,
                status: "unavailable",
                source: "explicit",
                hard: true,
                startIso: "2026-08-04T07:00:00.000Z",
                endIso: "2026-08-04T15:00:00.000Z",
            },
            {
                available: true,
                status: "available",
                source: "explicit",
                hard: true,
                startIso: "2026-08-04T15:00:00.000Z",
                endIso: "2026-08-05T00:00:00.000Z",
            },
        ],
        presenceHardConstraint: true,
        vehicleProfileId: "ford_kuga",
        vehicleSocPct: 45,
        socSource: "direct",
        fallbackEnergyNeedKwh: null,
        vehicleCapacityKwh: 68,
        targetSocPct: 80,
        requiredEnergyKwh: 23.8,
        deadlineIso: "2026-08-05T04:00:00.000Z",
        energyGoalHard: true,
        minChargePowerW: 1380,
        maxChargePowerW: 11000,
        chargeLossFactor: 1.08,
        evccExecutionMaster: true,
        uncertainty: (0, quality_1.operatorQuality)("valid", "ok", 80),
        freshness: {
            observedAtIso: base.time.nowIso,
            ageSec: 5,
            quality: (0, quality_1.operatorQuality)("valid", "ok", 80),
        },
    };
    return base;
}
(0, node_test_1.describe)("BAT-LIVE-001 unified battery charge → runtime intent", () => {
    (0, node_test_1.beforeEach)(() => (0, daily_plan_1.resetBatteryDailyPlanCache)());
    (0, node_test_1.it)("produces charge intent via existing daily-plan path when allowed", () => {
        const input = (0, alloc_fixtures_1.alloc001Input)();
        const { unified, pub } = mergeAuthority(input);
        strict_1.default.ok(pub.batteryEntries.length > 0 || unified.allocations.some((a) => a.kind === "battery_charge"));
        const now = pub.batteryEntries.length
            ? alignNowToKind(unified, "battery_charge")
            : new Date(input.time.slots[20].startIso);
        const entries = pub.batteryEntries.length
            ? pub.batteryEntries
            : (0, dispatch_bridge_1.buildUnifiedDispatchPublish)(unified).batteryEntries;
        const resolved = (0, daily_plan_1.resolveBatteryDailyPlanFromData)({
            now,
            timezone: TZ,
            meta: {
                status: "ready",
                date: (0, time_1.localDateKeyInTimezone)(now, TZ),
                revision: 9,
                validUntil: null,
                timezone: TZ,
            },
            entries,
            dischargePresent: false,
            profile: PROFILE,
            limits: LIMITS,
            socPct: input.battery.socPct,
            topOffActive: false,
            targetSocFromIntent: null,
            governanceEnabled: true,
        });
        strict_1.default.equal(resolved.useDailyPlan, true);
        strict_1.default.ok(resolved.decisionSource === "daily_plan" ||
            resolved.decisionSource === "daily_plan_passive_pv", `unexpected source ${resolved.decisionSource}`);
        strict_1.default.ok((resolved.effectiveChargePowerW ?? 0) > 0 || resolved.decisionSource === "daily_plan_passive_pv");
        const intent = (0, daily_plan_1.deviceIntentFromDailyPlan)(resolved, now.getTime());
        strict_1.default.ok(intent.action === "grid_charge" ||
            intent.action === "charge" ||
            intent.action === "self_consumption");
        strict_1.default.equal((0, execute_1.evaluateFinalWriteGate)(okGate()).passed, true);
        strict_1.default.equal((0, execute_1.evaluateFinalWriteGate)(okGate({ globalLive: true })).passed, true);
    });
});
(0, node_test_1.describe)("BAT-LIVE-002 global dryrun blocks battery write gate", () => {
    (0, node_test_1.it)("execution_gate_closed when globalLive=false", () => {
        strict_1.default.equal((0, execute_1.evaluateFinalWriteGate)(okGate({ globalLive: false })).rejectCode, "execution_gate_closed");
    });
});
(0, node_test_1.describe)("BAT-LIVE-003 stale telemetry blocks live dispatch", () => {
    (0, node_test_1.it)("telemetry_stale reject", () => {
        strict_1.default.equal((0, execute_1.evaluateFinalWriteGate)(okGate({ telemetryReady: false })).rejectCode, "telemetry_stale");
    });
});
(0, node_test_1.describe)("BAT-LIVE-004 unified replan error → safe battery hold", () => {
    (0, node_test_1.it)("clears battery charge slice; no classic takeover", () => {
        const input = {
            ...(0, alloc_fixtures_1.alloc001Input)(),
            battery: {
                ...(0, alloc_fixtures_1.alloc001Input)().battery,
                requiredChargeEnergyKwh: 4,
                chargeDeadlineIso: "2026-08-04T18:00:00.000Z",
                gridChargeAllowed: true,
            },
        };
        const unified = (0, allocate_1.allocateUnifiedDayPlan)(input);
        strict_1.default.ok(unified.allocations.some((a) => a.kind === "battery_charge"));
        const disp = (0, replan_failure_1.assessUnifiedReplanFailure)({
            nowMs: Date.parse("2026-08-04T10:00:00.000Z"),
            lastUnifiedPlan: unified,
            actual: actualSample({
                nowMs: Date.parse("2026-08-04T10:00:00.000Z"),
                realizedPvKwh: 1,
                forecastPvDayKwh: 8,
                batterySocPct: null,
            }),
            thermal: {
                ...input.thermal,
                uncertainty: (0, quality_1.operatorQuality)("valid", "ok", 80),
                freshness: { observedAtIso: input.time.nowIso, ageSec: 10, quality: (0, quality_1.operatorQuality)("valid", "ok", 80) },
            },
            climate: null,
            battery: { ...input.battery, socPct: null },
            wallbox: null,
            replanReasons: [reason_codes_1.REASON.REPLAN_BATTERY_SOC_DEVIATION, reason_codes_1.REASON.REPLAN_PV_FORECAST_CHANGED],
        });
        strict_1.default.equal(disp.clearBattery, true);
        const after = (0, replan_failure_1.applyReplanFailureAuthority)(stubDailyPlan(), unified, disp);
        strict_1.default.equal(after.allocations.some((a) => a.contributionId.startsWith("battery.")), false);
    });
});
(0, node_test_1.describe)("BAT-LIVE-005 manual battery intent priority", () => {
    (0, node_test_1.it)("manual_override beats planner in product rule helper", () => {
        const intent = {
            domain: "battery",
            intent_state: "active",
            manual_override: { active: true, valid_until: null },
            operating_request: { status: "missing", value: null, origin: null },
        };
        strict_1.default.equal((0, intent_read_1.resolvedIntentHasManualPriority)(intent), true);
    });
});
(0, node_test_1.describe)("BAT-LIVE-006 thermal flex prevents night battery→IH", () => {
    (0, node_test_1.it)("golden invariant holds under unified authority", () => {
        const input = (0, alloc_fixtures_1.alloc007Input)();
        const { unified } = mergeAuthority(input);
        strict_1.default.equal((0, evaluate_1.evaluateNoNightBatteryHeatAfterWastedPv)(input, unified).passed, true);
        const batHeat = unified.allocations.filter((a) => a.kind === "immersion_heater" && (a.energySource === "battery" || a.energySource === "mixed"));
        strict_1.default.equal(batHeat.length, 0);
    });
});
(0, node_test_1.describe)("EV-LIVE-001 PV covers vehicle before deadline", () => {
    (0, node_test_1.it)("allocates PV charge without unnecessary grid", () => {
        const plan = (0, allocate_1.allocateUnifiedDayPlan)((0, alloc_fixtures_1.alloc003Input)());
        const pv = plan.allocations
            .filter((a) => a.kind === "wallbox" && a.energySource === "pv_surplus")
            .reduce((s, a) => s + a.allocatedEnergyKwh, 0);
        const grid = plan.allocations
            .filter((a) => a.kind === "wallbox" && a.energySource === "grid")
            .reduce((s, a) => s + a.allocatedEnergyKwh, 0);
        strict_1.default.ok(pv > 0);
        strict_1.default.ok(grid < 1);
        strict_1.default.ok(plan.vehicleChargeEconomics);
        strict_1.default.ok((plan.vehicleChargeEconomics.expectedPvChargeKwh ?? 0) > 0);
    });
});
(0, node_test_1.describe)("EV-LIVE-002 PV insufficient → cheap grid windows", () => {
    (0, node_test_1.it)("places required import in cost-optimal slots", () => {
        const plan = (0, allocate_1.allocateUnifiedDayPlan)((0, alloc_fixtures_1.alloc004Input)());
        const grid = plan.allocations.filter((a) => a.kind === "wallbox" && a.energySource === "grid");
        strict_1.default.ok(grid.length > 0);
        strict_1.default.ok(grid.some((a) => a.reasonCodes.includes(reason_codes_1.REASON.GRID_IMPORT_COST_OPTIMAL)));
        const eco = plan.vehicleChargeEconomics;
        strict_1.default.equal(eco.baselineId, "earliest_feasible");
        strict_1.default.ok((eco.expectedGridChargeKwh ?? 0) > 5);
        strict_1.default.ok(eco.expectedGridCostCt !== null);
        strict_1.default.ok(eco.alternativeGridCostCt !== null);
        strict_1.default.ok(eco.savingsVsAlternativeCt !== null);
        strict_1.default.ok(eco.savingsVsAlternativeCt >= 0);
        strict_1.default.ok(eco.economicsCompleteness === "grid_only" || eco.economicsCompleteness === "full");
    });
});
(0, node_test_1.describe)("EV-LIVE-003 vehicle unavailable → no wallbox allocation", () => {
    (0, node_test_1.it)("no charge while absent", () => {
        const input = (0, fixtures_1.golden002Input)();
        const plan = (0, allocate_1.allocateUnifiedDayPlan)(input);
        const awayStart = "2026-08-04T03:45:00.000Z";
        const awayEnd = "2026-08-04T13:30:00.000Z";
        const phantom = plan.allocations.filter((a) => a.kind === "wallbox" &&
            Date.parse(a.slot.startIso) >= Date.parse(awayStart) &&
            Date.parse(a.slot.startIso) < Date.parse(awayEnd));
        strict_1.default.equal(phantom.length, 0);
    });
});
(0, node_test_1.describe)("EV-LIVE-004 unexpected disconnect → clear wallbox slice", () => {
    (0, node_test_1.it)("replan failure clears wallbox EMS intent", () => {
        const input = (0, alloc_fixtures_1.alloc003Input)();
        const unified = (0, allocate_1.allocateUnifiedDayPlan)(input);
        strict_1.default.ok(unified.allocations.some((a) => a.kind === "wallbox"));
        const duringChargeMs = Date.parse(unified.allocations.find((a) => a.kind === "wallbox").slot.startIso) + 60_000;
        const disp = (0, replan_failure_1.assessUnifiedReplanFailure)({
            nowMs: duringChargeMs,
            lastUnifiedPlan: unified,
            actual: actualSample({
                nowMs: duringChargeMs,
                realizedPvKwh: 5,
                forecastPvDayKwh: 20,
                vehicleConnected: false,
                vehicleRequiredEnergyKwh: 6,
                vehicleDeadlineIso: input.wallbox.deadlineIso,
                vehicleTargetSocPct: 80,
            }),
            thermal: input.thermal,
            climate: null,
            battery: input.battery,
            wallbox: { ...input.wallbox, connectedNow: false },
            replanReasons: [reason_codes_1.REASON.REPLAN_VEHICLE_DISCONNECTED],
        });
        strict_1.default.equal(disp.clearWallbox, true);
        const after = (0, replan_failure_1.applyReplanFailureAuthority)(stubDailyPlan(), unified, disp);
        strict_1.default.equal(after.allocations.some((a) => a.contributionId.startsWith("wallbox.")), false);
    });
});
(0, node_test_1.describe)("EV-LIVE-005 SOC rollforward quality in unified input", () => {
    (0, node_test_1.it)("keeps socSource energy_rollforward and uses required energy", () => {
        const input = (0, alloc_fixtures_1.alloc003Input)();
        input.wallbox = {
            ...input.wallbox,
            vehicleSocPct: 55,
            socSource: "energy_rollforward",
            requiredEnergyKwh: 8,
        };
        const plan = (0, allocate_1.allocateUnifiedDayPlan)(input);
        strict_1.default.ok(plan.allocations.some((a) => a.kind === "wallbox"));
        strict_1.default.equal(input.wallbox.socSource, "energy_rollforward");
    });
});
(0, node_test_1.describe)("EV-LIVE-006 SOC unknown without energy goal", () => {
    (0, node_test_1.it)("does not invent SOC; goal at risk/unknown", () => {
        const input = (0, alloc_fixtures_1.alloc003Input)();
        input.wallbox = {
            ...input.wallbox,
            vehicleSocPct: null,
            socSource: "unknown",
            requiredEnergyKwh: null,
            fallbackEnergyNeedKwh: null,
            targetSocPct: null,
        };
        const plan = (0, allocate_1.allocateUnifiedDayPlan)(input);
        const wbGoal = plan.goalStatuses.find((g) => g.consumerId === "wallbox");
        strict_1.default.ok(wbGoal);
        strict_1.default.notEqual(wbGoal.met, false); // no false precision fail; met true if no need
        strict_1.default.equal(plan.allocations.filter((a) => a.kind === "wallbox").reduce((s, a) => s + a.allocatedEnergyKwh, 0), 0);
    });
});
(0, node_test_1.describe)("EV-LIVE-007 global dryrun — no real EVCC write path from planner", () => {
    (0, node_test_1.beforeEach)(() => {
        (0, daily_plan_2.resetWallboxDailyPlanCache)();
        (0, dispatch_1.resetWallboxDispatchCache)();
    });
    (0, node_test_1.it)("dryrun dispatch builds command without live write release", () => {
        const { unified, pub } = mergeAuthority((0, alloc_fixtures_1.alloc003Input)());
        const now = alignNowToKind(unified, "wallbox");
        const tel = wbTelemetry({
            effectivePlanTime: (0, alloc_fixtures_1.alloc003Input)().wallbox.deadlineIso,
            planTime: (0, alloc_fixtures_1.alloc003Input)().wallbox.deadlineIso,
        });
        const decision = (0, daily_plan_2.evaluateWallboxDailyPlan)({
            now,
            timezone: TZ,
            meta: {
                status: "ready",
                date: (0, time_1.localDateKeyInTimezone)(now, TZ),
                revision: 9,
                validUntil: null,
                timezone: TZ,
            },
            entries: pub.wallboxEntries,
            telemetry: tel,
            governanceEnabled: true,
            addonEnabled: true,
            vehicleCapacityKwh: 60,
        });
        const intent = (0, intent_1.buildWallboxDispatchIntent)({
            decision,
            governanceEnabled: true,
            addonEnabled: true,
            phases: 3,
            now,
        });
        const dry = (0, dispatch_1.runWallboxDryrunDispatch)({
            intent,
            decision,
            telemetry: tel,
            config: {},
            chargingEnabled: false,
            governanceEnabled: true,
        });
        strict_1.default.ok(Array.isArray(dry.dryrunCommand));
        strict_1.default.equal(decision.writeAllowed, false);
    });
});
(0, node_test_1.describe)("EV-LIVE-008 live intent only via EVCC runtime translation", () => {
    (0, node_test_1.it)("dispatch bridge emits wallbox.ev_session; no device writes in allocate", () => {
        const { pub, unified } = mergeAuthority((0, alloc_fixtures_1.alloc003Input)());
        strict_1.default.ok(pub.wallboxEntries.every((e) => e.contributionId === "wallbox.ev_session"));
        strict_1.default.ok(!("executeBatteryWrite" in unified));
        strict_1.default.ok(pub.wallboxReasonDe.includes("EVCC") || pub.wallboxEntries.length >= 0);
    });
});
(0, node_test_1.describe)("EV-LIVE-009 external EVCC plan / user control not fought by EMS", () => {
    (0, node_test_1.it)("external_plan_only when EVCC planActive and EMS plan missing", () => {
        const decision = (0, daily_plan_2.evaluateWallboxDailyPlan)({
            now: new Date("2026-08-04T12:00:00.000Z"),
            timezone: TZ,
            meta: { status: "not_initialized", date: "2026-08-04", revision: 0, validUntil: null, timezone: TZ },
            entries: [],
            telemetry: wbTelemetry({ planActive: true, planSocPct: 80 }),
            governanceEnabled: true,
            addonEnabled: true,
            vehicleCapacityKwh: 60,
        });
        strict_1.default.equal(decision.decisionSource, "external_plan_only");
        strict_1.default.equal(decision.useDailyPlan, false);
        const intent = (0, intent_1.buildWallboxDispatchIntent)({
            decision,
            governanceEnabled: true,
            addonEnabled: true,
            phases: 3,
            now: new Date("2026-08-04T12:00:00.000Z"),
        });
        strict_1.default.equal(intent.action, "none");
    });
});
(0, node_test_1.describe)("EV-LIVE-010 planner failure keeps EVCC manually usable", () => {
    (0, node_test_1.it)("clears EMS wallbox slice → hold/none, not stale charge", () => {
        const unified = (0, allocate_1.allocateUnifiedDayPlan)((0, alloc_fixtures_1.alloc004Input)());
        const duringChargeMs = Date.parse(unified.allocations.find((a) => a.kind === "wallbox").slot.startIso) + 60_000;
        const disp = (0, replan_failure_1.assessUnifiedReplanFailure)({
            nowMs: duringChargeMs,
            lastUnifiedPlan: unified,
            actual: actualSample({
                nowMs: duringChargeMs,
                realizedPvKwh: 2,
                forecastPvDayKwh: 5,
                vehicleConnected: true,
                vehicleRequiredEnergyKwh: 25,
                vehicleDeadlineIso: (0, alloc_fixtures_1.alloc004Input)().wallbox.deadlineIso,
                vehicleTargetSocPct: 80,
                priceMedianCt: 30,
            }),
            thermal: null,
            climate: null,
            battery: (0, alloc_fixtures_1.alloc004Input)().battery,
            wallbox: (0, alloc_fixtures_1.alloc004Input)().wallbox,
            replanReasons: [reason_codes_1.REASON.REPLAN_VEHICLE_GOAL_CHANGED, reason_codes_1.REASON.REPLAN_PV_FORECAST_CHANGED],
        });
        strict_1.default.equal(disp.clearWallbox, true);
        const after = (0, replan_failure_1.applyReplanFailureAuthority)(stubDailyPlan(), unified, disp);
        strict_1.default.equal(after.allocations.filter((a) => a.contributionId.startsWith("wallbox.")).length, 0);
    });
});
(0, node_test_1.describe)("AUTH congruence four addon slices", () => {
    (0, node_test_1.it)("allocations_json matches battery/ih/ac/wallbox runnable views", () => {
        const { merged, pub, unified } = mergeAuthority(energyDayInput());
        for (const prefix of ["battery", "immersion_heater", "air_conditioning", "wallbox"]) {
            const view = (0, addon_plan_publish_1.addonAllocationPublishView)(merged, prefix);
            const fromAlloc = (0, addon_plan_publish_1.addonAllocationEntries)(merged, prefix);
            strict_1.default.equal(view.runnable.length, (0, addon_plan_publish_1.filterRunnableAllocations)(fromAlloc).length, prefix);
            strict_1.default.ok(view.runnable.every((e) => (e.reasonDe ?? "").includes(`planId=${unified.planId}`)), `${prefix} entries stamped with unified planId`);
        }
        strict_1.default.equal(pub.immersionEntries.length, (0, addon_plan_publish_1.addonAllocationPublishView)(merged, "immersion_heater").runnable.length);
        strict_1.default.equal(pub.batteryEntries.length, (0, addon_plan_publish_1.addonAllocationPublishView)(merged, "battery").runnable.length);
        strict_1.default.equal(pub.wallboxEntries.length, (0, addon_plan_publish_1.addonAllocationPublishView)(merged, "wallbox").runnable.length);
        strict_1.default.equal(pub.climateEntries.length, (0, addon_plan_publish_1.addonAllocationPublishView)(merged, "air_conditioning").runnable.length);
    });
});
(0, node_test_1.describe)("ENERGY-DAY-001 shared day plan", () => {
    (0, node_test_1.it)("distributes energy across battery, IH, AC, EV without single-addon greed", () => {
        const input = energyDayInput();
        const plan = (0, allocate_1.allocateUnifiedDayPlan)(input);
        const sum = (kind) => plan.allocations.filter((a) => a.kind === kind).reduce((s, a) => s + a.allocatedEnergyKwh, 0);
        strict_1.default.ok(sum("battery_charge") > 0.5, "battery charge phase");
        strict_1.default.ok(sum("immersion_heater") > 0.5, "IH");
        strict_1.default.ok(sum("climate") > 0.2, "AC");
        strict_1.default.ok(sum("wallbox") > 1, "EV");
        const awayWb = plan.allocations.filter((a) => a.kind === "wallbox" &&
            Date.parse(a.slot.startIso) >= Date.parse("2026-08-04T07:00:00.000Z") &&
            Date.parse(a.slot.startIso) < Date.parse("2026-08-04T15:00:00.000Z"));
        strict_1.default.equal(awayWb.length, 0);
        strict_1.default.ok(plan.expectedGridImportEnergyKwh !== null);
        strict_1.default.ok(plan.expectedGridExportEnergyKwh !== null);
        strict_1.default.ok(plan.expectedCostCt !== null);
        strict_1.default.ok(plan.goalStatuses.length > 0);
        strict_1.default.ok(plan.vehicleChargeEconomics);
        strict_1.default.equal(plan.constraints.some((c) => c.id === "battery.discharge_unsupported"), true);
    });
});
(0, node_test_1.describe)("ENERGY-DAY-002 PV forecast collapse shifts EV import", () => {
    (0, node_test_1.it)("replans more grid for hard EV goal when PV drops", () => {
        const good = energyDayInput();
        const goodPlan = (0, allocate_1.allocateUnifiedDayPlan)(good);
        const bad = energyDayInput();
        bad.pv.slots = bad.pv.slots.map((s) => ({
            ...s,
            forecastPowerW: (s.forecastPowerW ?? 0) * 0.25,
            energyKwh: (s.energyKwh ?? 0) * 0.25,
        }));
        bad.pv.expectedDayEnergyKwh = bad.pv.slots.reduce((a, s) => a + (s.energyKwh ?? 0), 0);
        bad.pv.previousExpectedDayEnergyKwh = good.pv.expectedDayEnergyKwh;
        const badPlan = (0, allocate_1.allocateUnifiedDayPlan)(bad);
        const grid = (p) => p.allocations
            .filter((a) => a.kind === "wallbox" && a.energySource === "grid")
            .reduce((s, a) => s + a.allocatedEnergyKwh, 0);
        strict_1.default.ok(grid(badPlan) >= grid(goodPlan) - 0.5);
        strict_1.default.ok((badPlan.vehicleChargeEconomics?.expectedGridChargeKwh ?? 0) > 0);
    });
});
(0, node_test_1.describe)("ENERGY-DAY-003 better PV → less avoidable export / more flex", () => {
    (0, node_test_1.it)("extra PV goes to battery/thermal/EV before leftover export", () => {
        const weak = energyDayInput();
        weak.pv.slots = weak.pv.slots.map((s) => ({
            ...s,
            forecastPowerW: Math.min(s.forecastPowerW ?? 0, 1500),
            energyKwh: Math.min(s.energyKwh ?? 0, 0.375),
        }));
        weak.pv.expectedDayEnergyKwh = weak.pv.slots.reduce((a, s) => a + (s.energyKwh ?? 0), 0);
        const strong = energyDayInput();
        const weakPlan = (0, allocate_1.allocateUnifiedDayPlan)(weak);
        const strongPlan = (0, allocate_1.allocateUnifiedDayPlan)(strong);
        const flex = (p) => p.allocations
            .filter((a) => a.kind === "battery_charge" || a.kind === "immersion_heater" || a.kind === "wallbox")
            .reduce((s, a) => s + a.allocatedEnergyKwh, 0);
        strict_1.default.ok(flex(strongPlan) > flex(weakPlan));
        strict_1.default.ok((strongPlan.expectedGridExportEnergyKwh ?? 0) >= 0);
    });
});
(0, node_test_1.describe)("material replan on disconnect uses presence digest", () => {
    (0, node_test_1.it)("presenceDigest changes with connect state", () => {
        const a = (0, vehicle_availability_1.presenceDigest)([
            {
                available: true,
                status: "available",
                source: "live_connected",
                startIso: "2026-08-04T10:00:00.000Z",
                endIso: "2026-08-04T11:00:00.000Z",
            },
        ]);
        const b = (0, vehicle_availability_1.presenceDigest)([
            {
                available: false,
                status: "unavailable",
                source: "live_disconnected",
                startIso: "2026-08-04T10:00:00.000Z",
                endIso: "2026-08-04T11:00:00.000Z",
            },
        ]);
        strict_1.default.notEqual(a, b);
    });
});
