"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const passive_battery_energy_js_1 = require("./passive_battery_energy.js");
const allocate_js_1 = require("./allocate.js");
const fixtures_js_1 = require("./fixtures.js");
const reason_codes_js_1 = require("./reason_codes.js");
const quality_js_1 = require("../../quality.js");
const TZ = "Europe/Berlin";
const Q = (0, quality_js_1.operatorQuality)("valid", "ok", 80);
const FRESH = { observedAtIso: "2026-08-08T15:00:00.000Z", ageSec: 10, quality: Q };
function climateBatteryScenario(passiveAvailable) {
    const nowIso = "2026-08-08T15:00:00.000Z";
    const slots = (0, fixtures_js_1.buildSlots)(nowIso, 48);
    const input = (0, fixtures_js_1.golden001Input)();
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
        dischargeLiveSupported: false,
        passiveBatteryEnergyAvailable: passiveAvailable,
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
    return input;
}
function sumClimateBattery(plan) {
    return plan.allocations
        .filter((a) => a.kind === "climate" && (a.energySource === "battery" || a.energySource === "mixed"))
        .reduce((s, a) => s + a.allocatedEnergyKwh, 0);
}
(0, node_test_1.describe)("passive battery energy availability", () => {
    (0, node_test_1.it)("self-consumption → available", () => {
        const d = (0, passive_battery_energy_js_1.resolvePassiveBatteryEnergyAvailable)({
            operatingMode: 2,
            selfConsumptionModeValue: 2,
            manualModeValue: 1,
            ownershipActive: false,
        });
        strict_1.default.equal(d.available, true);
        strict_1.default.equal(d.reasonCode, "passive_battery_self_consumption");
    });
    (0, node_test_1.it)("manual/hold → unavailable", () => {
        const d = (0, passive_battery_energy_js_1.resolvePassiveBatteryEnergyAvailable)({
            operatingMode: 1,
            selfConsumptionModeValue: 2,
            manualModeValue: 1,
            ownershipActive: false,
        });
        strict_1.default.equal(d.available, false);
        strict_1.default.equal(d.reasonCode, "passive_battery_manual");
    });
    (0, node_test_1.it)("unknown mode → conservative unavailable", () => {
        const d = (0, passive_battery_energy_js_1.resolvePassiveBatteryEnergyAvailable)({
            operatingMode: null,
            selfConsumptionModeValue: 2,
            manualModeValue: 1,
            ownershipActive: false,
        });
        strict_1.default.equal(d.available, false);
        strict_1.default.equal(d.reasonCode, "passive_battery_mode_unknown");
    });
    (0, node_test_1.it)("ownership active → unavailable", () => {
        const d = (0, passive_battery_energy_js_1.resolvePassiveBatteryEnergyAvailable)({
            operatingMode: 2,
            selfConsumptionModeValue: 2,
            manualModeValue: 1,
            ownershipActive: true,
        });
        strict_1.default.equal(d.available, false);
        strict_1.default.equal(d.reasonCode, "passive_battery_ownership");
    });
    (0, node_test_1.it)("battery hold → unavailable", () => {
        const d = (0, passive_battery_energy_js_1.resolvePassiveBatteryEnergyAvailable)({
            operatingMode: 2,
            selfConsumptionModeValue: 2,
            manualModeValue: 1,
            ownershipActive: false,
            batteryHoldActive: true,
        });
        strict_1.default.equal(d.available, false);
        strict_1.default.equal(d.reasonCode, "passive_battery_hold");
    });
});
(0, node_test_1.describe)("passive battery energy — unified allocate gate", () => {
    (0, node_test_1.it)("Fall A: self-consumption allows battery energySource for climate", () => {
        const plan = (0, allocate_js_1.allocateUnifiedDayPlan)(climateBatteryScenario(true));
        strict_1.default.ok(plan.reasonCodes.includes(reason_codes_js_1.REASON.BATTERY_DISCHARGE_LIVE_UNSUPPORTED));
        strict_1.default.ok(!plan.reasonCodes.includes(reason_codes_js_1.REASON.BATTERY_PASSIVE_ENERGY_UNAVAILABLE));
        strict_1.default.ok(sumClimateBattery(plan) > 0.3, `expected climate from battery, got ${sumClimateBattery(plan)}`);
        strict_1.default.ok(!plan.allocations.some((a) => a.kind === "battery_discharge"));
    });
    (0, node_test_1.it)("Fall B: manual blocks battery energySource for live loads", () => {
        const plan = (0, allocate_js_1.allocateUnifiedDayPlan)(climateBatteryScenario(false));
        strict_1.default.ok(plan.reasonCodes.includes(reason_codes_js_1.REASON.BATTERY_PASSIVE_ENERGY_UNAVAILABLE));
        strict_1.default.equal(sumClimateBattery(plan), 0, "must not fund climate from unavailable passive battery");
        strict_1.default.ok(!plan.allocations.some((a) => a.kind === "battery_discharge"));
    });
});
