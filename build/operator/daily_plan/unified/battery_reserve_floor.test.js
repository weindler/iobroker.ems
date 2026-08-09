"use strict";
/**
 * Zeitabhängiger Battery-Reserve-Floor + usable energy (Befund 004 Ergänzung).
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const battery_reserve_floor_1 = require("./battery_reserve_floor");
const allocate_1 = require("./allocate");
const fixtures_1 = require("./fixtures");
const quality_1 = require("../../quality");
const reason_codes_1 = require("./reason_codes");
const TZ = "Europe/Berlin";
const Q = (0, quality_1.operatorQuality)("valid", "floor", 85);
const FRESH = { observedAtIso: "2026-08-08T14:00:00.000Z", ageSec: 10, quality: Q };
function sumKind(plan, kind, pred) {
    return plan.allocations
        .filter((a) => a.kind === kind && (!pred || pred(a)))
        .reduce((s, a) => s + a.allocatedEnergyKwh, 0);
}
(0, node_test_1.describe)("battery_reserve_floor unit", () => {
    (0, node_test_1.it)("afternoon holds full night reserve; night tapers; morning cushion", () => {
        const recoveryMs = Date.parse("2026-08-09T08:00:00.000Z");
        const afternoon = (0, battery_reserve_floor_1.unavoidableNeedKwh)({
            slotStartIso: "2026-08-08T12:00:00.000Z",
            slotMs: Date.parse("2026-08-08T12:00:00.000Z"),
            recoveryMs,
            nightReserveKwh: 2.5,
            timeZone: TZ,
        });
        strict_1.default.equal(afternoon, 2.5);
        const night = (0, battery_reserve_floor_1.unavoidableNeedKwh)({
            slotStartIso: "2026-08-08T23:00:00.000Z",
            slotMs: Date.parse("2026-08-08T23:00:00.000Z"),
            recoveryMs,
            nightReserveKwh: 2.5,
            timeZone: TZ,
        });
        strict_1.default.ok(night < 2.5 && night > 1.0, `night taper got ${night}`);
        const morning = (0, battery_reserve_floor_1.unavoidableNeedKwh)({
            slotStartIso: "2026-08-09T07:00:00.000Z",
            slotMs: Date.parse("2026-08-09T07:00:00.000Z"),
            recoveryMs,
            nightReserveKwh: 2.5,
            timeZone: TZ,
        });
        strict_1.default.ok(morning <= 0.6, `morning cushion got ${morning}`);
    });
    (0, node_test_1.it)("usable = soc − floor (discharge-eff adjusted)", () => {
        strict_1.default.ok((0, battery_reserve_floor_1.usableBatteryEnergyKwh)(10, 3.5, 0.95) > 5.5);
        strict_1.default.equal((0, battery_reserve_floor_1.usableBatteryEnergyKwh)(3, 3.5, 0.95), 0);
    });
    (0, node_test_1.it)("finds PV recovery when forward surplus accumulates", () => {
        const slots = (0, fixtures_1.buildSlots)("2026-08-08T14:00:00.000Z", 48).map((s) => {
            const h = new Date(s.startIso).getUTCHours();
            const day1 = Date.parse(s.startIso) >= Date.parse("2026-08-09T00:00:00.000Z");
            const power = day1 && h >= 7 && h < 16 ? 4000 : 0;
            return {
                startIso: s.startIso,
                endIso: s.endIso,
                startMs: Date.parse(s.startIso),
                pvKwh: (power / 1000) * 0.25,
                houseKwh: 0.2,
                importCt: 28,
            };
        });
        const idx = (0, battery_reserve_floor_1.findPvRecoverySlotIdx)(slots, 0);
        strict_1.default.ok(idx !== null && idx > 0);
    });
});
(0, node_test_1.describe)("Beta-004 flex — Klima aus Batterie bei späterer PV-Recovery", () => {
    (0, node_test_1.it)("allows climate battery when SOC high, afternoon PV weak, tomorrow strong", () => {
        const nowIso = "2026-08-08T15:00:00.000Z"; // 17:00 CEST — wenig PV
        const slots = (0, fixtures_1.buildSlots)(nowIso, 48);
        const input = (0, fixtures_1.golden001Input)();
        input.globalMode = "comfort";
        input.time = {
            ...input.time,
            nowIso,
            timezone: TZ,
            slots,
            horizonStartIso: slots[0].startIso,
            horizonEndIso: slots[slots.length - 1].endIso,
        };
        input.pv.slots = slots.map((s) => {
            const h = new Date(s.startIso).getUTCHours();
            const day0 = Date.parse(s.startIso) < Date.parse("2026-08-09T00:00:00.000Z");
            let power = 0;
            if (day0 && h >= 15 && h < 17)
                power = 400;
            else if (!day0 && h >= 7 && h < 16)
                power = 4200;
            return {
                slot: s,
                forecastPowerW: power,
                observedPowerW: null,
                energyKwh: (power / 1000) * 0.25,
            };
        });
        input.pv.expectedDayEnergyKwh = 6;
        input.houseLoad.slots = slots.map((s) => ({
            slot: s,
            forecastPowerW: 700,
            observedPowerW: null,
            energyKwh: 0.175,
        }));
        input.battery = {
            ...input.battery,
            socPct: 90,
            usableCapacityKwh: 10,
            minSocPct: 10,
            reserveSocPct: 10,
            nightReserveKwh: 2.5,
            endSocTargetPct: 40,
            requiredChargeEnergyKwh: 0,
            dischargeLiveSupported: true,
            passiveBatteryEnergyAvailable: true,
            uncertainty: Q,
            freshness: FRESH,
        };
        input.wallbox = null;
        input.thermal = { ...input.thermal, headroomEnergyKwh: 0.2, deadlineIso: null };
        input.climate = {
            units: [
                {
                    unitId: "air_conditioning.unit_1",
                    label: "wohn",
                    roomTempC: 28,
                    comfortMinC: null,
                    comfortMaxC: 26,
                    targetTempC: 25.5,
                    mandatoryComfort: true,
                    expectedEnergyKwh: 2.5,
                    typicalPowerW: 900,
                    maxShiftHours: 0,
                    uncertainty: Q,
                },
            ],
            freshness: FRESH,
        };
        const plan = (0, allocate_1.allocateUnifiedDayPlan)(input);
        const climateBat = sumKind(plan, "climate", (a) => a.energySource === "battery");
        strict_1.default.ok(climateBat > 0.3, `expected climate from battery, got ${climateBat}`);
        strict_1.default.ok(plan.reasonCodes.includes(reason_codes_1.REASON.BATTERY_FLEX_USABLE));
        const last = plan.batteryTrajectory[plan.batteryTrajectory.length - 1];
        strict_1.default.ok(last?.socPct == null || last.socPct >= 20);
    });
});
(0, node_test_1.describe)("Beta-004 flex — Wallbox aus Batterie ohne %-Cap", () => {
    (0, node_test_1.it)("may deliver several kWh from battery when reserve+recovery secured", () => {
        const nowIso = "2026-08-08T18:00:00.000Z";
        const slots = (0, fixtures_1.buildSlots)(nowIso, 48);
        const input = (0, fixtures_1.golden001Input)();
        input.globalMode = "balanced";
        input.time = {
            ...input.time,
            nowIso,
            timezone: TZ,
            slots,
            horizonStartIso: slots[0].startIso,
            horizonEndIso: slots[slots.length - 1].endIso,
        };
        input.pv.slots = slots.map((s) => {
            const h = new Date(s.startIso).getUTCHours();
            const day1 = Date.parse(s.startIso) >= Date.parse("2026-08-09T06:00:00.000Z");
            const power = day1 && h >= 7 && h < 16 ? 4500 : 0;
            return {
                slot: s,
                forecastPowerW: power,
                observedPowerW: null,
                energyKwh: (power / 1000) * 0.25,
            };
        });
        input.battery = {
            ...input.battery,
            socPct: 95,
            usableCapacityKwh: 10,
            minSocPct: 10,
            reserveSocPct: 10,
            nightReserveKwh: 2.5,
            endSocTargetPct: 35,
            requiredChargeEnergyKwh: 0,
            dischargeLiveSupported: true,
            passiveBatteryEnergyAvailable: true,
            uncertainty: Q,
            freshness: FRESH,
        };
        input.thermal = { ...input.thermal, headroomEnergyKwh: 0.1 };
        input.climate = null;
        input.wallbox = {
            connectedNow: true,
            presenceWindows: [
                {
                    available: true,
                    status: "available",
                    source: "explicit",
                    hard: true,
                    startIso: nowIso,
                    endIso: "2026-08-09T05:00:00.000Z",
                },
            ],
            presenceHardConstraint: true,
            vehicleProfileId: "car",
            vehicleSocPct: 40,
            socSource: "direct",
            fallbackEnergyNeedKwh: null,
            vehicleCapacityKwh: 60,
            targetSocPct: 80,
            requiredEnergyKwh: 8,
            deadlineIso: "2026-08-09T05:00:00.000Z",
            energyGoalHard: true,
            minChargePowerW: 1400,
            maxChargePowerW: 11000,
            chargeLossFactor: 1.1,
            evccExecutionMaster: true,
            evccChargeMode: "minpv",
            batteryHoldRequested: false,
            uncertainty: Q,
            freshness: FRESH,
        };
        const plan = (0, allocate_1.allocateUnifiedDayPlan)(input);
        const wbBat = sumKind(plan, "wallbox", (a) => a.energySource === "battery");
        const wbTotal = sumKind(plan, "wallbox");
        strict_1.default.ok(wbTotal > 2, `wallbox should get energy, got ${wbTotal}`);
        // Kein festes 50 %-Cap — mehrere kWh aus Batterie erlaubt wenn Floor hält.
        strict_1.default.ok(wbBat > 1.0, `expected >1 kWh battery→wallbox (no 50% cap), got ${wbBat}`);
        strict_1.default.ok(plan.reasonCodes.includes(reason_codes_1.REASON.BATTERY_FROM_RESERVE_FLEX));
    });
});
(0, node_test_1.describe)("Beta-004 flex — Thermal aus Batterie bei kritischer Deadline", () => {
    (0, node_test_1.it)("may heat from battery when PV before emptyAt insufficient and SOC high", () => {
        const nowIso = "2026-08-08T14:30:00.000Z";
        const emptyAt = "2026-08-08T16:00:00.000Z";
        const slots = (0, fixtures_1.buildSlots)(nowIso, 48);
        const input = (0, fixtures_1.golden001Input)();
        input.globalMode = "balanced";
        input.time = {
            ...input.time,
            nowIso,
            timezone: TZ,
            slots,
            horizonStartIso: slots[0].startIso,
            horizonEndIso: slots[slots.length - 1].endIso,
        };
        input.pv.slots = slots.map((s) => {
            const h = new Date(s.startIso).getUTCHours();
            const day1 = Date.parse(s.startIso) >= Date.parse("2026-08-09T06:00:00.000Z");
            const power = day1 && h >= 8 && h < 15 ? 4000 : 50;
            return {
                slot: s,
                forecastPowerW: power,
                observedPowerW: null,
                energyKwh: (power / 1000) * 0.25,
            };
        });
        input.battery = {
            ...input.battery,
            socPct: 88,
            usableCapacityKwh: 10,
            minSocPct: 10,
            reserveSocPct: 10,
            nightReserveKwh: 2.5,
            endSocTargetPct: 40,
            requiredChargeEnergyKwh: 0,
            dischargeLiveSupported: true,
            passiveBatteryEnergyAvailable: true,
            uncertainty: Q,
            freshness: FRESH,
        };
        input.wallbox = null;
        input.climate = null;
        input.thermal = {
            ...input.thermal,
            bufferTempC: 45,
            headroomEnergyKwh: 3.5,
            availablePowerW: 1700,
            minPowerW: 1700,
            deadlineIso: emptyAt,
            estimatedEmptyAtIso: emptyAt,
            emptyAtSource: "estimated",
            nightBridgeActive: true,
        };
        const plan = (0, allocate_1.allocateUnifiedDayPlan)(input);
        const batHeat = sumKind(plan, "immersion_heater", (a) => a.energySource === "battery" || a.energySource === "mixed");
        strict_1.default.ok(batHeat > 0.4, `expected thermal from battery, got ${batHeat}`);
    });
});
(0, node_test_1.describe)("Beta-004 flex — Reserve schützen bei niedrigem SOC", () => {
    (0, node_test_1.it)("does not drain battery for climate when at night reserve floor", () => {
        const nowIso = "2026-08-08T15:00:00.000Z";
        const slots = (0, fixtures_1.buildSlots)(nowIso, 48);
        const input = (0, fixtures_1.golden001Input)();
        input.globalMode = "comfort";
        input.time = {
            ...input.time,
            nowIso,
            timezone: TZ,
            slots,
            horizonStartIso: slots[0].startIso,
            horizonEndIso: slots[slots.length - 1].endIso,
        };
        input.pv.slots = slots.map((s) => ({
            slot: s,
            forecastPowerW: 100,
            observedPowerW: null,
            energyKwh: 0.025,
        }));
        input.battery = {
            ...input.battery,
            socPct: 25, // 2.5 kWh = Nachtreserve-Floor → usable = 0
            usableCapacityKwh: 10,
            minSocPct: 10,
            reserveSocPct: 10,
            nightReserveKwh: 2.5,
            endSocTargetPct: 40,
            requiredChargeEnergyKwh: 0,
            dischargeLiveSupported: true,
            passiveBatteryEnergyAvailable: true,
            uncertainty: Q,
            freshness: FRESH,
        };
        input.wallbox = null;
        input.thermal = { ...input.thermal, headroomEnergyKwh: 0.2 };
        input.climate = {
            units: [
                {
                    unitId: "air_conditioning.unit_1",
                    label: "wohn",
                    roomTempC: 28,
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
        const climateBat = sumKind(plan, "climate", (a) => a.energySource === "battery");
        strict_1.default.equal(climateBat, 0, `must protect reserve floor, got climateBat=${climateBat}`);
    });
});
(0, node_test_1.describe)("battery_reserve_floor build aligns with input", () => {
    (0, node_test_1.it)("builds per-slot floor from night + safety", () => {
        const nowIso = "2026-08-08T12:00:00.000Z";
        const slots = (0, fixtures_1.buildSlots)(nowIso, 32).map((s) => ({
            startIso: s.startIso,
            endIso: s.endIso,
            startMs: Date.parse(s.startIso),
            pvKwh: 0.5,
            houseKwh: 0.2,
            importCt: 25,
        }));
        const input = (0, fixtures_1.golden001Input)();
        input.time.nowIso = nowIso;
        input.time.timezone = TZ;
        input.battery = {
            ...input.battery,
            usableCapacityKwh: 10,
            minSocPct: 10,
            reserveSocPct: 10,
            nightReserveKwh: 2.5,
        };
        const floor = (0, battery_reserve_floor_1.buildBatteryReserveFloor)(input, slots);
        strict_1.default.ok(floor.requiredKwhBySlot.length === slots.length);
        strict_1.default.ok(floor.requiredKwhBySlot[0] >= 2.5);
        strict_1.default.ok(floor.recoverySlotIdx !== null);
    });
});
(0, node_test_1.describe)("Beta-004 thermal flex storage — replan yields PV to vehicle", () => {
    (0, node_test_1.it)("high thermal PV first; after vehicle arrives wallbox takes PV and thermal shrinks", () => {
        const nowIso = "2026-08-08T11:00:00.000Z";
        const emptyAt = "2026-08-08T15:44:00.000Z";
        const slots = (0, fixtures_1.buildSlots)(nowIso, 40);
        const mkBase = () => {
            const input = (0, fixtures_1.golden001Input)();
            input.globalMode = "balanced";
            input.time = {
                ...input.time,
                nowIso,
                timezone: TZ,
                slots,
                horizonStartIso: slots[0].startIso,
                horizonEndIso: slots[slots.length - 1].endIso,
            };
            input.pv.slots = slots.map((s) => {
                const h = new Date(s.startIso).getUTCHours();
                const day0 = Date.parse(s.startIso) < Date.parse("2026-08-09T00:00:00.000Z");
                let power = 0;
                if (day0 && h >= 9 && h < 16)
                    power = 4800;
                else if (!day0 && h >= 8 && h < 15)
                    power = 4000;
                return {
                    slot: s,
                    forecastPowerW: power,
                    observedPowerW: null,
                    energyKwh: (power / 1000) * 0.25,
                };
            });
            input.pv.expectedDayEnergyKwh = 32;
            input.houseLoad.slots = slots.map((s) => ({
                slot: s,
                forecastPowerW: 600,
                observedPowerW: null,
                energyKwh: 0.15,
            }));
            input.battery = {
                ...input.battery,
                socPct: 95,
                usableCapacityKwh: 10,
                minSocPct: 10,
                reserveSocPct: 10,
                nightReserveKwh: 2.5,
                endSocTargetPct: 36,
                requiredChargeEnergyKwh: 0,
                dischargeLiveSupported: true,
                passiveBatteryEnergyAvailable: true,
                uncertainty: Q,
                freshness: FRESH,
            };
            input.climate = {
                units: [
                    {
                        unitId: "air_conditioning.unit_1",
                        label: "wohn",
                        roomTempC: 24,
                        comfortMinC: null,
                        comfortMaxC: 26,
                        targetTempC: 25.5,
                        mandatoryComfort: false,
                        expectedEnergyKwh: 2.5,
                        typicalPowerW: 900,
                        maxShiftHours: 4,
                        uncertainty: Q,
                    },
                ],
                freshness: FRESH,
            };
            return input;
        };
        const noCar = mkBase();
        noCar.wallbox = null;
        noCar.thermal = {
            ...noCar.thermal,
            bufferTempC: 47,
            minTempC: 44,
            maxTempC: 63,
            dayTargetTempC: 58,
            headroomEnergyKwh: 5.5,
            availablePowerW: 1700,
            minPowerW: 1700,
            deadlineIso: emptyAt,
            estimatedEmptyAtIso: emptyAt,
            emptyAtSource: "estimated",
            nightBridgeActive: true,
        };
        const planA = (0, allocate_1.allocateUnifiedDayPlan)(noCar);
        const ihA = sumKind(planA, "immersion_heater");
        strict_1.default.ok(ihA > 2.5, `thermal flex storage should absorb PV, got ${ihA}`);
        // Replan: Fahrzeug kommt mit Ladebedarf; Puffer bereits höher (gespeicherte Wärme).
        const withCar = mkBase();
        withCar.thermal = {
            ...noCar.thermal,
            bufferTempC: 56,
            dayTargetTempC: 53,
            headroomEnergyKwh: 1.2,
            deadlineIso: emptyAt,
            estimatedEmptyAtIso: emptyAt,
        };
        withCar.wallbox = {
            connectedNow: true,
            presenceWindows: [
                {
                    available: true,
                    status: "available",
                    source: "explicit",
                    hard: true,
                    startIso: nowIso,
                    endIso: "2026-08-09T04:00:00.000Z",
                },
            ],
            presenceHardConstraint: true,
            vehicleProfileId: "car",
            vehicleSocPct: 35,
            socSource: "direct",
            fallbackEnergyNeedKwh: null,
            vehicleCapacityKwh: 60,
            targetSocPct: 80,
            requiredEnergyKwh: 14,
            deadlineIso: "2026-08-09T04:00:00.000Z",
            energyGoalHard: true,
            minChargePowerW: 1400,
            maxChargePowerW: 11000,
            chargeLossFactor: 1.05,
            evccExecutionMaster: true,
            evccChargeMode: "minpv",
            batteryHoldRequested: false,
            uncertainty: Q,
            freshness: FRESH,
        };
        const planB = (0, allocate_1.allocateUnifiedDayPlan)(withCar);
        const ihB = sumKind(planB, "immersion_heater");
        const wbPv = sumKind(planB, "wallbox", (a) => a.energySource === "pv_surplus");
        strict_1.default.ok(ihB < ihA - 1.0, `replan must cut thermal vs A: A=${ihA} B=${ihB}`);
        strict_1.default.ok(wbPv > 2.0, `vehicle should get PV after replan, got ${wbPv}`);
    });
});
