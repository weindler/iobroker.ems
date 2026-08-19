"use strict";
/**
 * Joint Unified Energy Optimization — Abnahmeszenarien A–G (Beta 08.08.2026).
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const quality_1 = require("../../quality");
const allocate_1 = require("./allocate");
const fixtures_1 = require("./fixtures");
const product_summary_1 = require("../../../beta/product_summary");
const immersion_heater_1 = require("../../contributions/flexible/immersion_heater");
const device_config_1 = require("../../../addons/immersion_heater/device_config");
const mode_policy_1 = require("../../../planner/mode_policy");
const reason_codes_1 = require("./reason_codes");
const TZ = "Europe/Berlin";
const Q = (0, quality_1.operatorQuality)("valid", "joint-fixture", 85);
const FRESH = { observedAtIso: "2026-08-08T08:30:00.000Z", ageSec: 10, quality: Q };
function sumKind(plan, kind, pred) {
    return plan.allocations
        .filter((a) => a.kind === kind && (!pred || pred(a)))
        .reduce((s, a) => a.allocatedEnergyKwh + s, 0);
}
function energyBeforeDeadline(plan, kind, deadlineIso) {
    const dead = Date.parse(deadlineIso);
    return plan.allocations
        .filter((a) => a.kind === kind && Date.parse(a.slot.startIso) < dead)
        .reduce((s, a) => s + a.allocatedEnergyKwh, 0);
}
/** Szenario A — realer Beta-Fall 08.08.2026 ~10:30 lokal. */
function scenarioAInput(overrides = {}) {
    const nowIso = "2026-08-08T08:30:00.000Z"; // 10:30 CEST
    const emptyAt = "2026-08-08T15:25:00.000Z"; // 17:25 CEST
    const slots = (0, fixtures_1.buildSlots)(nowIso, 48); // 2 Tage — reicht für Tomorrow-PV + Nachtreserve; Horizon >24h
    const base = (0, fixtures_1.golden001Input)();
    base.time = {
        ...base.time,
        nowIso,
        timezone: TZ,
        slots,
        horizonStartIso: slots[0].startIso,
        horizonEndIso: slots[slots.length - 1].endIso,
    };
    // PV today strong midday, weaker late afternoon; tomorrow similar
    base.pv.slots = slots.map((s) => {
        const h = new Date(s.startIso).getUTCHours();
        const day0 = Date.parse(s.startIso) < Date.parse("2026-08-09T00:00:00.000Z");
        let power = 0;
        if (day0) {
            if (h >= 8 && h < 14)
                power = 4200;
            else if (h >= 14 && h < 16)
                power = 1800;
            else if (h >= 6 && h < 18)
                power = 900;
        }
        else if (h >= 7 && h < 16) {
            power = 3800;
        }
        return {
            slot: s,
            forecastPowerW: power,
            observedPowerW: null,
            energyKwh: (power / 1000) * 0.25,
        };
    });
    base.pv.expectedDayEnergyKwh = 43.6;
    base.pv.previousExpectedDayEnergyKwh = null;
    base.houseLoad.slots = slots.map((s) => ({
        slot: s,
        forecastPowerW: 900,
        observedPowerW: null,
        energyKwh: 0.225,
    }));
    base.houseLoad.expectedDayEnergyKwh = 22.3;
    base.prices.slots = slots.map((s) => {
        const h = new Date(s.startIso).getUTCHours();
        const night = h >= 22 || h < 5;
        return {
            slot: s,
            importCtPerKwh: night ? 12 : 28,
            exportCtPerKwh: 8,
            gridImportAllowed: true,
        };
    });
    base.battery = {
        ...base.battery,
        socPct: 55,
        usableCapacityKwh: 10,
        minSocPct: 10,
        reserveSocPct: 10,
        nightReserveKwh: 2.5,
        maxChargePowerW: 4600,
        requiredChargeEnergyKwh: null,
        endSocTargetPct: null,
        chargeDeadlineIso: null,
        gridChargeAllowed: true,
        uncertainty: Q,
        freshness: FRESH,
    };
    base.thermal = {
        bufferTempC: 49,
        boilerTempC: 49,
        minTempC: 44,
        boilerMinTempC: 44,
        maxTempC: 63,
        dayTargetTempC: 58,
        availablePowerW: 1700,
        minPowerW: 1700,
        headroomEnergyKwh: 3.8,
        estimatedEmptyAtIso: emptyAt,
        deadlineIso: emptyAt,
        emptyAtSource: "estimated",
        boilerEmptyAtUsable: true,
        nightBridgeActive: true,
        coolingRateCPerH: 0.7,
        minimumRuntimeSec: 300,
        hysteresisK: 5,
        reheatHysteresisActive: true,
        uncertainty: (0, quality_1.operatorQuality)("degraded", "estimated empty_at", 55),
        freshness: FRESH,
    };
    base.climate = {
        units: [
            {
                unitId: "air_conditioning.unit_1",
                label: "wohn",
                roomTempC: 24.5,
                comfortMinC: null,
                comfortMaxC: 26,
                targetTempC: 25.5,
                mandatoryComfort: false,
                expectedEnergyKwh: 3.5,
                typicalPowerW: 900,
                maxShiftHours: 3,
                uncertainty: Q,
            },
        ],
        freshness: FRESH,
    };
    base.wallbox = null;
    base.globalMode = "balanced";
    return { ...base, ...overrides };
}
(0, node_test_1.describe)("JOINT-A beta thermal preload vs climate vs night reserve", () => {
    (0, node_test_1.it)("plans thermal preload before empty_at, keeps night reserve signal, funds flex climate", () => {
        const input = scenarioAInput();
        const plan = (0, allocate_1.allocateUnifiedDayPlan)(input);
        const emptyAt = input.thermal.deadlineIso;
        const ihBefore = energyBeforeDeadline(plan, "immersion_heater", emptyAt);
        const ihTotal = sumKind(plan, "immersion_heater");
        const climate = sumKind(plan, "climate");
        const batHeat = sumKind(plan, "immersion_heater", (a) => a.energySource === "battery" || a.energySource === "mixed");
        strict_1.default.ok(ihTotal > 1.5, `expected thermal plan, got ${ihTotal}`);
        strict_1.default.ok(ihBefore > 1.0, `thermal must preload before empty_at, before=${ihBefore}`);
        strict_1.default.equal(batHeat, 0, "no battery heat for thermal");
        strict_1.default.ok(climate > 0.5, `flex climate should get surplus, got ${climate}`);
        strict_1.default.ok(plan.reasonCodes.includes(reason_codes_1.REASON.BATTERY_NIGHT_RESERVE));
        strict_1.default.ok(plan.reasonCodes.includes(reason_codes_1.REASON.THERMAL_DEADLINE_PV_WINDOW));
        strict_1.default.ok(plan.constraints.some((c) => c.id === "battery.night_reserve"));
        strict_1.default.ok(plan.constraints.some((c) => c.id === "thermal.deadline"));
        const agenda = (0, product_summary_1.buildUnifiedDayAgendaDe)(plan);
        strict_1.default.ok(agenda.some((l) => /Heizstab|thermisch/i.test(l)), agenda.join(" | "));
        strict_1.default.ok(agenda.some((l) => /Nachtreserve|2,?5/i.test(l)), agenda.join(" | "));
        const summary = (0, product_summary_1.buildProductSummaryDe)(plan, { batteryStartSocPct: 55 });
        strict_1.default.match(summary, /Plan:/);
        strict_1.default.match(summary, /43,6/);
        // readable dump for Abschlussbericht
        strict_1.default.ok(summary.length > 40);
    });
});
(0, node_test_1.describe)("JOINT-B tomorrow weak PV → stronger thermal headroom still scheduled", () => {
    (0, node_test_1.it)("still preloads when tomorrow PV is weak (contribution raises target upstream)", () => {
        const input = scenarioAInput();
        input.thermal = {
            ...input.thermal,
            dayTargetTempC: 63,
            headroomEnergyKwh: 5.5,
            emptyAtSource: "learned",
        };
        const plan = (0, allocate_1.allocateUnifiedDayPlan)(input);
        strict_1.default.ok(sumKind(plan, "immersion_heater") > 2.5);
        strict_1.default.ok(energyBeforeDeadline(plan, "immersion_heater", input.thermal.deadlineIso) > 1.5);
    });
});
(0, node_test_1.describe)("JOINT-C vehicle deadline competes with thermal", () => {
    (0, node_test_1.it)("covers vehicle deadline while still allowing thermal PV window", () => {
        const input = scenarioAInput();
        const deadline = "2026-08-09T05:00:00.000Z";
        input.wallbox = {
            connectedNow: true,
            presenceWindows: [
                {
                    available: true,
                    status: "available",
                    source: "explicit",
                    hard: true,
                    startIso: input.time.horizonStartIso,
                    endIso: input.time.horizonEndIso,
                },
            ],
            presenceHardConstraint: true,
            vehicleProfileId: "car",
            vehicleSocPct: 35,
            socSource: "direct",
            fallbackEnergyNeedKwh: null,
            vehicleCapacityKwh: 60,
            targetSocPct: 80,
            requiredEnergyKwh: 12,
            deadlineIso: deadline,
            energyGoalHard: true,
            minChargePowerW: 1380,
            maxChargePowerW: 11000,
            chargeLossFactor: 1,
            evccExecutionMaster: true,
            uncertainty: Q,
            freshness: FRESH,
        };
        const plan = (0, allocate_1.allocateUnifiedDayPlan)(input);
        const wb = sumKind(plan, "wallbox");
        const ih = sumKind(plan, "immersion_heater");
        strict_1.default.ok(wb > 8, `vehicle need largely covered, got ${wb}`);
        strict_1.default.ok(ih > 0.5, `thermal still gets some PV, got ${ih}`);
        const goal = plan.goalStatuses.find((g) => g.consumerId === "wallbox");
        strict_1.default.ok(goal?.met !== false);
    });
});
(0, node_test_1.describe)("JOINT-D weak PV + cheap night grid for battery reserve", () => {
    (0, node_test_1.it)("may grid-charge toward night reserve when allowed and deficit", () => {
        const input = scenarioAInput();
        input.pv.slots = input.pv.slots.map((s) => ({
            ...s,
            forecastPowerW: 200,
            energyKwh: 0.05,
        }));
        input.pv.expectedDayEnergyKwh = 4;
        input.battery = {
            ...input.battery,
            socPct: 12,
            nightReserveKwh: 2.5,
            requiredChargeEnergyKwh: 3,
            chargeDeadlineIso: "2026-08-09T06:00:00.000Z",
            gridChargeAllowed: true,
        };
        input.thermal = { ...input.thermal, headroomEnergyKwh: 0.5 };
        const plan = (0, allocate_1.allocateUnifiedDayPlan)(input);
        const gridBat = sumKind(plan, "battery_charge", (a) => a.energySource === "grid");
        strict_1.default.ok(gridBat > 0.5, `expected grid battery charge, got ${gridBat}`);
        strict_1.default.ok(plan.reasonCodes.includes(reason_codes_1.REASON.BATTERY_NIGHT_RESERVE) ||
            plan.reasonCodes.includes(reason_codes_1.REASON.BATTERY_RESERVE_PROTECTED));
    });
});
(0, node_test_1.describe)("JOINT-E battery nearly empty — no thermal from battery", () => {
    (0, node_test_1.it)("does not allocate immersion from battery when SOC low", () => {
        const input = scenarioAInput();
        input.battery = { ...input.battery, socPct: 8, nightReserveKwh: 2.5 };
        const plan = (0, allocate_1.allocateUnifiedDayPlan)(input);
        const batHeat = sumKind(plan, "immersion_heater", (a) => a.energySource === "battery" || a.energySource === "mixed");
        strict_1.default.equal(batHeat, 0);
        strict_1.default.ok(sumKind(plan, "immersion_heater") > 0.5);
    });
});
(0, node_test_1.describe)("JOINT-F battery full + high PV surplus → thermal absorbs", () => {
    (0, node_test_1.it)("routes surplus to thermal when battery near full", () => {
        const input = scenarioAInput();
        input.battery = { ...input.battery, socPct: 94, nightReserveKwh: 2.5 };
        input.thermal = { ...input.thermal, headroomEnergyKwh: 4 };
        const plan = (0, allocate_1.allocateUnifiedDayPlan)(input);
        const ih = sumKind(plan, "immersion_heater");
        const batCharge = sumKind(plan, "battery_charge");
        strict_1.default.ok(ih > 2, `thermal should absorb surplus, got ${ih}`);
        strict_1.default.ok(ih + 0.5 >= batCharge, `thermal (${ih}) should dominate near-full battery charge (${batCharge})`);
        strict_1.default.ok(energyBeforeDeadline(plan, "immersion_heater", input.thermal.deadlineIso) > 1.5);
    });
});
(0, node_test_1.describe)("JOINT-G mandatory climate comfort now", () => {
    (0, node_test_1.it)("does not postpone mandatory comfort for later PV", () => {
        const input = scenarioAInput();
        input.climate = {
            units: [
                {
                    unitId: "air_conditioning.unit_1",
                    label: "wohn",
                    roomTempC: 27,
                    comfortMinC: null,
                    comfortMaxC: 26,
                    targetTempC: 25.5,
                    mandatoryComfort: true,
                    expectedEnergyKwh: 2,
                    typicalPowerW: 900,
                    maxShiftHours: 0,
                    uncertainty: Q,
                },
            ],
            freshness: FRESH,
        };
        const plan = (0, allocate_1.allocateUnifiedDayPlan)(input);
        const climate = plan.allocations.filter((a) => a.kind === "climate");
        strict_1.default.ok(climate.length > 0);
        const first = climate[0];
        strict_1.default.ok(Date.parse(first.slot.startIso) <= Date.parse(input.time.nowIso) + 2 * 3600_000);
    });
});
(0, node_test_1.describe)("JOINT contribution: hysteresis must not zero planning demand", () => {
    (0, node_test_1.it)("publishes headroom with runtime-only hysteresis flag", () => {
        const [, flex] = (0, immersion_heater_1.buildImmersionHeaterContributions)({
            now: new Date("2026-08-08T08:30:00.000Z"),
            addonEnabled: true,
            governanceEnabled: true,
            globalModeOff: false,
            addonExecutionOff: false,
            modePolicy: (0, mode_policy_1.plannerModePolicyFromGlobalMode)("balanced"),
            config: (0, device_config_1.immersionDeviceConfigFromAdapter)({
                ih_stage_count: 1,
                ih_stage_1_set_state: "relay.0.heater",
                ih_stage_1_nominal_power_w: 1700,
                ih_buffer_temp_c_target: "sensor.0.temp",
                ih_buffer_temp_c_enabled: true,
                ih_temperature_hysteresis_k: 5,
                ih_planning_min_temp_c: 44,
                ih_planning_max_temp_c: 63,
            }),
            bufferTempC: 49,
            boilerTempC: 58,
            thermalMode: "auto",
            fault: false,
            lockout: false,
            relayMapped: true,
            pvTodayKwh: 43.6,
            pvTomorrowKwh: 41.8,
            pvBiasStatus: "ready",
            forecastModeEnabled: true,
            aiOptimizationAllowed: false,
            autoTargetReached: true,
            timezone: TZ,
            thermalLearning: {
                status: "degraded",
                health: "degraded",
                samples: 0,
                coolingRateCPerHAvg: 0.7,
                coolingConstantPerH: null,
                coolingAsymptoteC: null,
                estimatedRemainingHours: 7,
                estimatedEmptyAt: "2026-08-08T15:25:00.000Z",
                currentDayTypeRuntimeHoursMedian: null,
                reasonDe: "estimated",
            },
        });
        strict_1.default.equal(flex.enabled, true);
        strict_1.default.ok(flex.details.requiredEnergyKwh > 0);
        strict_1.default.equal(flex.deadlineIso, null);
        strict_1.default.equal(flex.details.bufferEstimatedEmptyAt, null);
        strict_1.default.equal(flex.details.emptyAtPlanningUsable, false);
        strict_1.default.equal(flex.details.reheatHysteresisRuntimeOnly, true);
    });
});
(0, node_test_1.describe)("JOINT horizon remains multi-day", () => {
    (0, node_test_1.it)("keeps horizon beyond 24h when input has multi-day slots", () => {
        const input = scenarioAInput();
        strict_1.default.ok(input.time.slots.length >= 96); // 24h
        const plan = (0, allocate_1.allocateUnifiedDayPlan)(input);
        const horizonMs = Date.parse(plan.horizonEndIso) - Date.parse(plan.horizonStartIso);
        strict_1.default.ok(horizonMs >= 24 * 3600_000);
    });
});
