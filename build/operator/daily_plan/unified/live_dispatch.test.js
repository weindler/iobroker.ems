"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const device_config_1 = require("../../../addons/immersion_heater/device_config");
const daily_plan_1 = require("../../../addons/immersion_heater/runtime/daily_plan");
const daily_plan_2 = require("../../../addons/air_conditioning/runtime/daily_plan");
const time_1 = require("../../time");
const allocate_1 = require("./allocate");
const dispatch_bridge_1 = require("./dispatch_bridge");
const publish_ih_ac_1 = require("./publish_ih_ac");
const alloc_fixtures_1 = require("./alloc_fixtures");
const contribution_ids_1 = require("../../contribution_ids");
function metaFor(now, timezone) {
    return {
        status: "ready",
        date: (0, time_1.localDateKeyInTimezone)(now, timezone),
        revision: 42,
        validUntil: new Date(now.getTime() + 6 * 3600_000).toISOString(),
        timezone,
    };
}
function alignNowToFirstAllocSlot(plan) {
    const cell = plan.allocations.find((a) => (a.kind === "immersion_heater" || a.kind === "climate") && a.allocatedPowerW >= 50);
    strict_1.default.ok(cell, "expected at least one IH/climate allocation");
    /** Bevorzuge volle Heizstab-Mindeststufe, damit Runtime stage > 0 liefert. */
    const fullIh = plan.allocations.find((a) => a.kind === "immersion_heater" && a.allocatedPowerW >= 1700);
    const pick = fullIh ?? cell;
    return new Date(Date.parse(pick.slot.startIso) + 60_000);
}
(0, node_test_1.describe)("LIVE-IH-001 unified IH dispatch via existing daily-plan path", () => {
    (0, node_test_1.it)("produces immersion allocations that resolve to commanded stage > 0", () => {
        (0, daily_plan_1.resetImmersionDailyPlanCache)();
        const input = (0, alloc_fixtures_1.alloc006Input)();
        const plan = (0, allocate_1.allocateUnifiedDayPlan)(input);
        const pub = (0, dispatch_bridge_1.buildUnifiedIhAcDispatchPublish)(plan);
        strict_1.default.ok(pub.immersionEntries.length > 0);
        const now = alignNowToFirstAllocSlot(plan);
        const tz = input.time.timezone;
        const resolved = (0, daily_plan_1.resolveImmersionDailyPlanFromData)({
            now,
            timezone: tz,
            meta: metaFor(now, tz),
            entries: pub.immersionEntries,
            config: (0, device_config_1.immersionDeviceConfigFromAdapter)({
                ih_stage_count: 1,
                ih_stage_1_set_state: "relay.0.heater",
                ih_stage_1_nominal_power_w: 1700,
                ih_buffer_temp_c_target: "sensor.0.temp",
                ih_buffer_temp_c_enabled: true,
            }),
        });
        strict_1.default.equal(resolved.useDailyPlan, true);
        strict_1.default.equal(resolved.decisionSource, "daily_plan");
        strict_1.default.ok((resolved.commandedStage ?? 0) > 0);
        strict_1.default.ok((resolved.allocatedPowerW ?? 0) >= 50);
    });
});
(0, node_test_1.describe)("LIVE-IH-002 no PV thermal / no battery heat path", () => {
    (0, node_test_1.it)("zero immersion allocation → daily_plan owns OFF (no legacy planner)", () => {
        (0, daily_plan_1.resetImmersionDailyPlanCache)();
        const input = {
            ...(0, alloc_fixtures_1.alloc007Input)(),
            thermal: {
                ...(0, alloc_fixtures_1.alloc007Input)().thermal,
                headroomEnergyKwh: 0,
                bufferTempC: 55,
                dayTargetTempC: 51,
            },
            pv: {
                ...(0, alloc_fixtures_1.alloc007Input)().pv,
                slots: (0, alloc_fixtures_1.alloc007Input)().pv.slots.map((s) => ({
                    ...s,
                    forecastPowerW: 0,
                    energyKwh: 0,
                })),
                expectedDayEnergyKwh: 0,
            },
        };
        const plan = (0, allocate_1.allocateUnifiedDayPlan)(input);
        const pub = (0, dispatch_bridge_1.buildUnifiedIhAcDispatchPublish)(plan);
        const batHeat = plan.allocations.filter((a) => a.kind === "immersion_heater" && (a.energySource === "battery" || a.energySource === "mixed"));
        strict_1.default.equal(batHeat.length, 0);
        const now = new Date(input.time.slots[0].startIso);
        const tz = input.time.timezone;
        const resolved = (0, daily_plan_1.resolveImmersionDailyPlanFromData)({
            now,
            timezone: tz,
            meta: metaFor(now, tz),
            entries: pub.immersionEntries,
            config: (0, device_config_1.immersionDeviceConfigFromAdapter)({
                ih_stage_count: 1,
                ih_stage_1_set_state: "relay.0.heater",
                ih_stage_1_nominal_power_w: 1700,
                ih_buffer_temp_c_target: "sensor.0.temp",
                ih_buffer_temp_c_enabled: true,
            }),
        });
        strict_1.default.equal(resolved.useDailyPlan, true);
        strict_1.default.equal(resolved.commandedStage, 0);
        strict_1.default.ok(resolved.dailyPlanStatus === "daily_plan_zero_allocation" ||
            resolved.dailyPlanStatus === "daily_plan_valid");
    });
});
(0, node_test_1.describe)("LIVE-AC-001 comfort breach uses existing permission path", () => {
    (0, node_test_1.it)("mandatory climate allocation allows start via daily_plan source", () => {
        (0, daily_plan_2.resetAcDailyPlanCache)();
        const base = (0, alloc_fixtures_1.alloc001Input)();
        const slot0 = base.time.slots[0];
        const input = {
            ...base,
            climate: {
                units: [
                    {
                        unitId: contribution_ids_1.CONTRIBUTION_IDS.AC_UNIT(1),
                        label: "Wohnzimmer",
                        roomTempC: 28,
                        comfortMinC: null,
                        comfortMaxC: 24,
                        targetTempC: 26,
                        mandatoryComfort: true,
                        expectedEnergyKwh: 2,
                        typicalPowerW: 900,
                        maxShiftHours: 0,
                        uncertainty: { status: "valid", confidencePct: 80, reasonDe: "t" },
                    },
                ],
                freshness: base.pv.freshness,
            },
        };
        const plan = (0, allocate_1.allocateUnifiedDayPlan)(input);
        const pub = (0, dispatch_bridge_1.buildUnifiedIhAcDispatchPublish)(plan);
        strict_1.default.ok(pub.climateEntries.length > 0);
        const climateSlot = plan.allocations.find((a) => a.kind === "climate")?.slot.startIso ?? slot0.startIso;
        const now = new Date(Date.parse(climateSlot) + 30_000);
        const tz = input.time.timezone;
        const dailyPlan = (0, daily_plan_2.resolveAcUnitDailyPlanFromData)({
            unitIndex: 1,
            now,
            timezone: tz,
            meta: metaFor(now, tz),
            entries: pub.climateEntries,
            expectedPower: {
                valid: true,
                powerW: 900,
                source: "config",
                sampleDays: 1,
                medianRuntimeSecPerDay: null,
            },
        });
        strict_1.default.equal(dailyPlan.useDailyPlan, true);
        strict_1.default.equal(dailyPlan.allocationAllowsStart, true);
        const perm = (0, daily_plan_2.evaluateAcCoolingPermission)({
            unitEnabled: true,
            governanceEnabled: true,
            addonEnabled: true,
            cleaningActive: false,
            startRetryReady: true,
            stopRetryReady: true,
            fsm: {
                state: "idle",
                demandStart: true,
                demandStop: false,
                modePurpose: "cooling",
                reasonDe: "Raum über Komfortgrenze.",
            },
            dailyPlan,
        });
        strict_1.default.equal(perm.decisionSource, "daily_plan");
        strict_1.default.equal(perm.allowStart, true);
        strict_1.default.equal(perm.deviceWritesAllowed, true);
    });
});
(0, node_test_1.describe)("LIVE-AC-002 shiftable cooling prefers PV-rich slots", () => {
    (0, node_test_1.it)("non-mandatory climate allocations land on higher-PV slots when possible", () => {
        const input = (0, alloc_fixtures_1.alloc001Input)();
        input.climate = {
            units: [
                {
                    unitId: contribution_ids_1.CONTRIBUTION_IDS.AC_UNIT(2),
                    label: "Josef",
                    roomTempC: 24.5,
                    comfortMinC: null,
                    comfortMaxC: 26,
                    targetTempC: 25,
                    mandatoryComfort: false,
                    expectedEnergyKwh: 1.5,
                    typicalPowerW: 900,
                    maxShiftHours: 3,
                    uncertainty: { status: "valid", confidencePct: 80, reasonDe: "t" },
                },
            ],
            freshness: input.pv.freshness,
        };
        // Make early slots weak PV, later strong
        input.pv.slots = input.pv.slots.map((s, i) => {
            const power = i < 8 ? 200 : 4000;
            return { ...s, forecastPowerW: power, energyKwh: (power / 1000) * 0.25 };
        });
        const plan = (0, allocate_1.allocateUnifiedDayPlan)(input);
        const climate = plan.allocations.filter((a) => a.kind === "climate");
        strict_1.default.ok(climate.length > 0);
        const firstIdx = input.pv.slots.findIndex((s) => s.slot.startIso === climate[0].slot.startIso);
        strict_1.default.ok(firstIdx >= 8, `expected PV-rich slot, got index ${firstIdx}`);
    });
});
(0, node_test_1.describe)("LIVE-IH ownership vs classic fullPlan", () => {
    (0, node_test_1.it)("idle unified slice blocks classic fullPlan immersion entries", async () => {
        const { resolveImmersionDailyPlanAllocation } = await Promise.resolve().then(() => __importStar(require("../../../addons/immersion_heater/runtime/daily_plan")));
        (0, daily_plan_1.resetImmersionDailyPlanCache)();
        const now = new Date("2026-08-04T12:07:00.000Z");
        const classicEntry = {
            contributionId: contribution_ids_1.CONTRIBUTION_IDS.IMMERSION_FLEXIBLE,
            contributor: { type: "addon", id: "immersion_heater", addonId: "immersion_heater" },
            slot: {
                startIso: "2026-08-04T12:00:00.000Z",
                endIso: "2026-08-04T12:15:00.000Z",
            },
            status: "allocated",
            energySource: "pv_surplus",
            requestedPowerW: 1700,
            allocatedPowerW: 1700,
            requestedEnergyKwh: 0.425,
            allocatedEnergyKwh: 0.425,
            gridPowerW: 0,
            pvPowerW: 1700,
            mandatory: false,
            priorityRank: 1,
            deadlineIso: null,
            estimatedCostCt: null,
            reasonDe: "classic",
        };
        const localDate = (0, time_1.localDateKeyInTimezone)(now, "Europe/Berlin");
        const states = new Map([
            ["planner.intent.daily_plan.status", "ready"],
            ["planner.intent.daily_plan.date", localDate],
            ["planner.intent.daily_plan.revision", 7],
            ["planner.intent.daily_plan.valid_until", "2026-08-05T00:00:00.000Z"],
            ["planner.intent.allocation.immersion_heater.status", "idle"],
            ["planner.intent.allocation.immersion_heater.plan_json", "[]"],
            [
                "planner.intent.daily_plan.plan_json",
                JSON.stringify({
                    date: localDate,
                    allocations: [classicEntry],
                }),
            ],
        ]);
        const host = {
            config: {},
            async getStateAsync(id) {
                return states.has(id) ? { val: states.get(id) } : null;
            },
        };
        const resolved = await resolveImmersionDailyPlanAllocation(host, (0, device_config_1.immersionDeviceConfigFromAdapter)({
            ih_stage_count: 1,
            ih_stage_1_set_state: "relay.0.heater",
            ih_stage_1_nominal_power_w: 1700,
            ih_buffer_temp_c_target: "sensor.0.temp",
            ih_buffer_temp_c_enabled: true,
        }), now);
        strict_1.default.equal(resolved.useDailyPlan, true);
        strict_1.default.equal(resolved.commandedStage, 0);
        strict_1.default.equal(resolved.dailyPlanStatus, "daily_plan_zero_allocation");
    });
});
(0, node_test_1.describe)("publishUnifiedIhAcDispatch safety surface", () => {
    (0, node_test_1.it)("writes only planner.intent.allocation immersion/climate keys — never device states", async () => {
        const written = [];
        const host = {
            async getStateAsync() {
                return null;
            },
            async setStateAsync(id) {
                written.push(id);
            },
        };
        const plan = (0, allocate_1.allocateUnifiedDayPlan)((0, alloc_fixtures_1.alloc001Input)());
        await (0, publish_ih_ac_1.publishUnifiedIhAcDispatch)(host, plan);
        strict_1.default.ok(written.length > 0);
        for (const id of written) {
            strict_1.default.ok(id.startsWith("planner.intent.allocation.immersion_heater.") ||
                id.startsWith("planner.intent.allocation.air_conditioning."), `unexpected write target ${id}`);
            strict_1.default.equal(id.includes("cmd_"), false);
            strict_1.default.equal(id.includes("relay"), false);
        }
    });
});
