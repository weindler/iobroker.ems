"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const mode_policy_1 = require("../../../planner/mode_policy");
const battery_charge_logic_1 = require("./battery_charge_logic");
const NOW = new Date("2026-01-15T18:00:00Z");
function cfg(overrides = {}) {
    return {
        enabled: true,
        horizonDays: 7,
        marginKwh: 0.5,
        pvRecoveryRatio: 1.15,
        reserveLowConfidenceFactor: 0.25,
        maxSocPct: 100,
        minSocPct: 5,
        capacityKwh: 10,
        ...overrides,
    };
}
function days(overrides = []) {
    const base = [
        { dayIndex: 0, dateKey: "2026-01-15", pvKwh: 1, loadKwh: 18, pvConfidencePct: 80 },
        { dayIndex: 1, dateKey: "2026-01-16", pvKwh: 2, loadKwh: 20, pvConfidencePct: 75 },
        { dayIndex: 2, dateKey: "2026-01-17", pvKwh: 3, loadKwh: 19, pvConfidencePct: 60 },
        { dayIndex: 3, dateKey: "2026-01-18", pvKwh: 25, loadKwh: 18, pvConfidencePct: 55 },
        { dayIndex: 4, dateKey: "2026-01-19", pvKwh: 10, loadKwh: 17, pvConfidencePct: 50 },
        { dayIndex: 5, dateKey: "2026-01-20", pvKwh: 12, loadKwh: 16, pvConfidencePct: 45 },
        { dayIndex: 6, dateKey: "2026-01-21", pvKwh: 14, loadKwh: 15, pvConfidencePct: 40 },
    ];
    return base.map((d, i) => ({ ...d, ...(overrides[i] ?? {}) }));
}
(0, node_test_1.describe)("battery charge logic (PV-Defizit, Block 2)", () => {
    (0, node_test_1.it)("requests grid charge when the PV horizon cannot cover the load", () => {
        const r = (0, battery_charge_logic_1.planBatteryChargeLogic)({
            now: NOW,
            socPct: 55,
            snowCoverSuspected: false,
            config: cfg(),
            modePolicy: (0, mode_policy_1.plannerModePolicyFromGlobalMode)("balanced"),
            governanceEnabled: true,
            days: days(),
        });
        strict_1.default.equal(r.forecastActive, true);
        strict_1.default.ok(r.chargeEnergyKwh !== null && r.chargeEnergyKwh > 0);
        strict_1.default.ok(r.socTargetPct !== null && r.socTargetPct > 55);
        strict_1.default.equal(r.pvRecoveryDay, 4);
        strict_1.default.ok(r.bridgeUntilIso !== null);
        strict_1.default.doesNotMatch(r.reasonDe, /Winter/i);
    });
    (0, node_test_1.it)("this can also trigger in summer given several bad-weather days — no season gate", () => {
        const summerNow = new Date("2026-07-10T18:00:00Z");
        const r = (0, battery_charge_logic_1.planBatteryChargeLogic)({
            now: summerNow,
            socPct: 55,
            snowCoverSuspected: false,
            config: cfg(),
            modePolicy: (0, mode_policy_1.plannerModePolicyFromGlobalMode)("balanced"),
            governanceEnabled: true,
            days: days(),
        });
        strict_1.default.equal(r.active, true);
        strict_1.default.ok(r.chargeEnergyKwh !== null && r.chargeEnergyKwh > 0);
    });
    (0, node_test_1.it)("no grid charge when stored energy covers the bridge", () => {
        const sunny = days().map((d) => ({ ...d, pvKwh: 20, loadKwh: 10 }));
        const r = (0, battery_charge_logic_1.planBatteryChargeLogic)({
            now: NOW,
            socPct: 95,
            snowCoverSuspected: false,
            config: cfg(),
            modePolicy: (0, mode_policy_1.plannerModePolicyFromGlobalMode)("balanced"),
            governanceEnabled: true,
            days: sunny,
        });
        strict_1.default.equal(r.active, false);
        strict_1.default.equal(r.chargeEnergyKwh, null);
    });
    (0, node_test_1.it)("comfort adds more reserve than eco", () => {
        const base = {
            now: NOW,
            socPct: 50,
            snowCoverSuspected: false,
            config: cfg(),
            governanceEnabled: true,
            days: days(),
        };
        const eco = (0, battery_charge_logic_1.planBatteryChargeLogic)({ ...base, modePolicy: (0, mode_policy_1.plannerModePolicyFromGlobalMode)("eco") });
        const comfort = (0, battery_charge_logic_1.planBatteryChargeLogic)({ ...base, modePolicy: (0, mode_policy_1.plannerModePolicyFromGlobalMode)("comfort") });
        strict_1.default.ok((comfort.chargeEnergyKwh ?? 0) >= (eco.chargeEnergyKwh ?? 0));
    });
    (0, node_test_1.it)("disabled config pauses the logic", () => {
        const r = (0, battery_charge_logic_1.planBatteryChargeLogic)({
            now: NOW,
            socPct: 50,
            snowCoverSuspected: false,
            config: cfg({ enabled: false }),
            modePolicy: (0, mode_policy_1.plannerModePolicyFromGlobalMode)("balanced"),
            governanceEnabled: true,
            days: days(),
        });
        strict_1.default.equal(r.forecastActive, false);
        strict_1.default.equal(r.active, false);
    });
    (0, node_test_1.it)("governance off pauses the logic", () => {
        const r = (0, battery_charge_logic_1.planBatteryChargeLogic)({
            now: NOW,
            socPct: 50,
            snowCoverSuspected: false,
            config: cfg(),
            modePolicy: (0, mode_policy_1.plannerModePolicyFromGlobalMode)("balanced"),
            governanceEnabled: false,
            days: days(),
        });
        strict_1.default.equal(r.active, false);
    });
    (0, node_test_1.it)("global mode off pauses the logic", () => {
        const r = (0, battery_charge_logic_1.planBatteryChargeLogic)({
            now: NOW,
            socPct: 50,
            snowCoverSuspected: false,
            config: cfg(),
            modePolicy: (0, mode_policy_1.plannerModePolicyFromGlobalMode)("off"),
            governanceEnabled: true,
            days: days(),
        });
        strict_1.default.equal(r.active, false);
    });
    (0, node_test_1.it)("missing capacity pauses the logic", () => {
        const r = (0, battery_charge_logic_1.planBatteryChargeLogic)({
            now: NOW,
            socPct: 50,
            snowCoverSuspected: false,
            config: cfg({ capacityKwh: null }),
            modePolicy: (0, mode_policy_1.plannerModePolicyFromGlobalMode)("balanced"),
            governanceEnabled: true,
            days: days(),
        });
        strict_1.default.equal(r.active, false);
    });
    (0, node_test_1.it)("missing SOC pauses the logic", () => {
        const r = (0, battery_charge_logic_1.planBatteryChargeLogic)({
            now: NOW,
            socPct: null,
            snowCoverSuspected: false,
            config: cfg(),
            modePolicy: (0, mode_policy_1.plannerModePolicyFromGlobalMode)("balanced"),
            governanceEnabled: true,
            days: days(),
        });
        strict_1.default.equal(r.active, false);
    });
    (0, node_test_1.it)("snow cover adds an extra margin on top of an existing deficit, but is not the sole trigger", () => {
        const base = {
            now: NOW,
            socPct: 55,
            config: cfg(),
            modePolicy: (0, mode_policy_1.plannerModePolicyFromGlobalMode)("balanced"),
            governanceEnabled: true,
            days: days(),
        };
        const withoutSnow = (0, battery_charge_logic_1.planBatteryChargeLogic)({ ...base, snowCoverSuspected: false });
        const withSnow = (0, battery_charge_logic_1.planBatteryChargeLogic)({ ...base, snowCoverSuspected: true });
        strict_1.default.ok((withSnow.energyDeficitKwh ?? 0) > (withoutSnow.energyDeficitKwh ?? 0));
        const sunny = days().map((d) => ({ ...d, pvKwh: 20, loadKwh: 10 }));
        const sunnyWithSnow = (0, battery_charge_logic_1.planBatteryChargeLogic)({ ...base, days: sunny, snowCoverSuspected: true });
        strict_1.default.equal(sunnyWithSnow.active, false);
    });
});
