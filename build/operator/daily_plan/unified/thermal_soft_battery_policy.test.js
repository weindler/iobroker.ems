"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const quality_1 = require("../../quality");
const allocate_1 = require("./allocate");
const fixtures_1 = require("./fixtures");
const reason_codes_1 = require("./reason_codes");
const Q = (0, quality_1.operatorQuality)("valid", "test", 90);
const NOW_ISO = "2026-08-08T16:00:00.000Z";
const EMPTY_AT_ISO = "2026-08-08T20:00:00.000Z";
function scenario(input) {
    const slots = (0, fixtures_1.buildSlots)(NOW_ISO, 96);
    const out = (0, fixtures_1.golden001Input)();
    out.time = {
        ...out.time,
        nowIso: NOW_ISO,
        timezone: "Europe/Berlin",
        slots,
        horizonStartIso: slots[0].startIso,
        horizonEndIso: slots[slots.length - 1].endIso,
    };
    out.pv = {
        ...out.pv,
        slots: slots.map((slot) => {
            const ms = Date.parse(slot.startIso);
            const tomorrow = ms >= Date.parse("2026-08-09T00:00:00.000Z");
            const hour = new Date(ms).getUTCHours();
            const powerW = tomorrow && hour >= 7 && hour < 15 ? 4_200 : 0;
            return {
                slot,
                forecastPowerW: powerW,
                observedPowerW: null,
                energyKwh: (powerW / 1000) * 0.25,
            };
        }),
        expectedDayEnergyKwh: 0,
        uncertainty: Q,
    };
    out.houseLoad = {
        ...out.houseLoad,
        slots: slots.map((slot) => ({
            slot,
            forecastPowerW: 650,
            observedPowerW: null,
            energyKwh: 0.1625,
        })),
        uncertainty: Q,
    };
    out.prices = {
        ...out.prices,
        slots: slots.map((slot) => ({
            slot,
            importCtPerKwh: 34,
            exportCtPerKwh: 9.3,
            gridImportAllowed: true,
        })),
        uncertainty: Q,
    };
    out.battery = {
        ...out.battery,
        socPct: input.socPct ?? 90,
        usableCapacityKwh: 10,
        minSocPct: 10,
        reserveSocPct: 10,
        nightReserveKwh: 2.5,
        endSocTargetPct: 40,
        requiredChargeEnergyKwh: 0,
        passiveBatteryEnergyAvailable: input.passiveBattery,
        uncertainty: Q,
    };
    out.wallbox = null;
    out.climate = null;
    out.thermal = {
        ...out.thermal,
        bufferTempC: 54,
        boilerTempC: 58,
        minTempC: 50,
        boilerMinTempC: 50,
        maxTempC: 63,
        dayTargetTempC: 58,
        headroomEnergyKwh: 0.85,
        availablePowerW: 1700,
        minPowerW: 1700,
        estimatedEmptyAtIso: input.emptyAtIso ?? EMPTY_AT_ISO,
        deadlineIso: input.emptyAtIso ?? EMPTY_AT_ISO,
        emptyAtSource: "estimated",
        boilerEmptyAtUsable: false,
        nightBridgeActive: false,
        mayUseBatteryForImmersion: input.mayUseBattery,
        uncertainty: Q,
    };
    return out;
}
function softBatteryKwh(plan) {
    return plan.allocations
        .filter((a) => a.consumerId === "immersion_heater_soft" &&
        (a.energySource === "battery" || a.energySource === "mixed"))
        .reduce((sum, a) => sum + a.allocatedEnergyKwh, 0);
}
(0, node_test_1.describe)("Soft-Heizstab aus Batterie — Policy und Gesamtbilanz", () => {
    (0, node_test_1.it)("erlaubt eine passive Batterie-Brücke bei Leerung vor der nächsten PV-Recovery", () => {
        const plan = (0, allocate_1.allocateUnifiedDayPlan)(scenario({ mayUseBattery: true, passiveBattery: true }));
        strict_1.default.ok(softBatteryKwh(plan) >= 0.4, `Batterie-Brücke fehlt: ${softBatteryKwh(plan)} kWh; ${JSON.stringify({ allocations: plan.allocations, goals: plan.goalStatuses, reasons: plan.reasonCodes })}`);
        strict_1.default.ok(plan.allocations.some((a) => a.reasonCodes.includes(reason_codes_1.REASON.THERMAL_BATTERY_BRIDGE)));
        strict_1.default.ok(!plan.allocations.some((a) => a.kind === "battery_discharge"));
        strict_1.default.ok(!plan.allocations.some((a) => a.kind === "immersion_heater" && a.energySource === "grid"));
    });
    (0, node_test_1.it)("bleibt gesperrt, wenn Betreiber-Policy oder passive Batteriequelle fehlen", () => {
        strict_1.default.equal(softBatteryKwh(scenarioPlan({ mayUseBattery: false, passiveBattery: true })), 0);
        strict_1.default.equal(softBatteryKwh(scenarioPlan({ mayUseBattery: true, passiveBattery: false })), 0);
    });
    (0, node_test_1.it)("nutzt keine Batterie, wenn die Wärme bis hinter das nächste PV-Fenster reicht", () => {
        const plan = scenarioPlan({
            mayUseBattery: true,
            passiveBattery: true,
            emptyAtIso: "2026-08-10T12:00:00.000Z",
        });
        strict_1.default.equal(softBatteryKwh(plan), 0);
    });
    (0, node_test_1.it)("schützt den Reserve-Floor auch bei erlaubter Policy", () => {
        const plan = scenarioPlan({ mayUseBattery: true, passiveBattery: true, socPct: 25 });
        strict_1.default.equal(softBatteryKwh(plan), 0);
    });
});
function scenarioPlan(input) {
    return (0, allocate_1.allocateUnifiedDayPlan)(scenario(input));
}
