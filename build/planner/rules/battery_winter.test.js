"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const mode_policy_js_1 = require("../mode_policy.js");
const battery_winter_js_1 = require("./battery_winter.js");
const tibber_parse_js_1 = require("../../learning/price_forecast/tibber_parse.js");
const NOW = new Date("2026-01-15T18:00:00Z");
function cfg(overrides = {}) {
    return {
        enabled: true,
        horizonDays: 7,
        marginKwh: 0.5,
        chargeEfficiencyPct: 92,
        pvRecoveryRatio: 1.15,
        reserveLowConfidenceFactor: 0.25,
        maxChargeW: 4200,
        maxSocPct: 100,
        minSocPct: 5,
        capacityKwh: 10,
        ...overrides,
    };
}
function winterDays(overrides = []) {
    const base = [
        { dayIndex: 1, dateKey: "2026-01-15", pvKwh: 1, loadKwh: 18, pvConfidencePct: 80 },
        { dayIndex: 2, dateKey: "2026-01-16", pvKwh: 2, loadKwh: 20, pvConfidencePct: 75 },
        { dayIndex: 3, dateKey: "2026-01-17", pvKwh: 3, loadKwh: 19, pvConfidencePct: 60 },
        { dayIndex: 4, dateKey: "2026-01-18", pvKwh: 25, loadKwh: 18, pvConfidencePct: 55 },
        { dayIndex: 5, dateKey: "2026-01-19", pvKwh: 10, loadKwh: 17, pvConfidencePct: 50 },
        { dayIndex: 6, dateKey: "2026-01-20", pvKwh: 12, loadKwh: 16, pvConfidencePct: 45 },
        { dayIndex: 7, dateKey: "2026-01-21", pvKwh: 14, loadKwh: 15, pvConfidencePct: 40 },
    ];
    return base.map((d, i) => ({ ...d, ...(overrides[i] ?? {}) }));
}
(0, node_test_1.describe)("battery winter plan", () => {
    (0, node_test_1.it)("requests grid charge when PV horizon cannot cover load", () => {
        const r = (0, battery_winter_js_1.planBatteryWinter)({
            now: NOW,
            socPct: 55,
            snowCoverSuspected: false,
            config: cfg(),
            modePolicy: (0, mode_policy_js_1.plannerModePolicyFromGlobalMode)("balanced"),
            batteryGovernanceEnabled: true,
            batteryAiAllowed: false,
            days: winterDays(),
            priceSlots: [],
        });
        strict_1.default.equal(r.forecast_active, true);
        strict_1.default.ok(r.charge_energy_kwh !== null && r.charge_energy_kwh > 0);
        strict_1.default.ok(r.soc_target_pct !== null && r.soc_target_pct > 55);
        strict_1.default.ok(r.charge_slots_15m !== null && r.charge_slots_15m > 0);
        strict_1.default.equal(r.pv_recovery_day, 4);
    });
    (0, node_test_1.it)("no grid charge when stored energy covers bridge", () => {
        const sunny = winterDays().map((d) => ({ ...d, pvKwh: 20, loadKwh: 10 }));
        const r = (0, battery_winter_js_1.planBatteryWinter)({
            now: NOW,
            socPct: 95,
            snowCoverSuspected: false,
            config: cfg(),
            modePolicy: (0, mode_policy_js_1.plannerModePolicyFromGlobalMode)("balanced"),
            batteryGovernanceEnabled: true,
            batteryAiAllowed: false,
            days: sunny,
            priceSlots: [],
        });
        strict_1.default.equal(r.active, false);
        strict_1.default.equal(r.charge_energy_kwh, null);
    });
    (0, node_test_1.it)("comfort adds more reserve than eco", () => {
        const base = {
            now: NOW,
            socPct: 50,
            snowCoverSuspected: false,
            config: cfg(),
            batteryGovernanceEnabled: true,
            batteryAiAllowed: false,
            days: winterDays(),
            priceSlots: [],
        };
        const eco = (0, battery_winter_js_1.planBatteryWinter)({ ...base, modePolicy: (0, mode_policy_js_1.plannerModePolicyFromGlobalMode)("eco") });
        const comfort = (0, battery_winter_js_1.planBatteryWinter)({ ...base, modePolicy: (0, mode_policy_js_1.plannerModePolicyFromGlobalMode)("comfort") });
        strict_1.default.ok((comfort.charge_energy_kwh ?? 0) >= (eco.charge_energy_kwh ?? 0));
    });
    (0, node_test_1.it)("defers when battery AI is enabled", () => {
        const r = (0, battery_winter_js_1.planBatteryWinter)({
            now: NOW,
            socPct: 50,
            snowCoverSuspected: false,
            config: cfg(),
            modePolicy: (0, mode_policy_js_1.plannerModePolicyFromGlobalMode)("balanced"),
            batteryGovernanceEnabled: true,
            batteryAiAllowed: true,
            days: winterDays(),
            priceSlots: [],
        });
        strict_1.default.equal(r.forecast_active, false);
        strict_1.default.match(r.reason_de, /KI-Optimierung/);
    });
    (0, node_test_1.it)("sums house load segments to daily kWh", () => {
        const kwh = (0, battery_winter_js_1.dailyKwhFromHouseLoadForecast)({
            date: "2026-01-15",
            season: "winter",
            weekday: "thursday",
            day_type: "weekday",
            segments: {
                night: { avg_w: 500, source: "t", fallback_level: "season_weekday_segment", confidence: 0.8 },
                morning: { avg_w: 1000, source: "t", fallback_level: "season_weekday_segment", confidence: 0.8 },
                midday: { avg_w: 800, source: "t", fallback_level: "season_weekday_segment", confidence: 0.8 },
                afternoon: { avg_w: 900, source: "t", fallback_level: "season_weekday_segment", confidence: 0.8 },
                evening: { avg_w: 1200, source: "t", fallback_level: "season_weekday_segment", confidence: 0.8 },
            },
        });
        strict_1.default.equal(kwh, 21);
    });
    (0, node_test_1.it)("selects Tibber windows when price slots are available", () => {
        const baseMs = NOW.getTime();
        const priceSlots = Array.from({ length: 8 }, (_, i) => ({
            slotStartMs: baseMs + i * tibber_parse_js_1.MS_PER_15MIN,
            priceCtPerKwh: i === 2 || i === 3 ? 10 : 40 - i,
        }));
        const r = (0, battery_winter_js_1.planBatteryWinter)({
            now: NOW,
            socPct: 55,
            snowCoverSuspected: false,
            config: cfg(),
            modePolicy: (0, mode_policy_js_1.plannerModePolicyFromGlobalMode)("balanced"),
            batteryGovernanceEnabled: true,
            batteryAiAllowed: false,
            days: winterDays(),
            priceSlots,
        });
        strict_1.default.ok(r.windows.length > 0);
        strict_1.default.match(r.reason_de, /Preisfenster/);
    });
});
