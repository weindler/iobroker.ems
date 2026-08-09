"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const live_thermal_surplus_replan_1 = require("./live_thermal_surplus_replan");
const allocate_1 = require("./allocate");
const fixtures_1 = require("./fixtures");
const fixtures_2 = require("./fixtures");
const NOW_MS = Date.parse("2026-08-09T10:07:00.000Z");
function baseOk(overrides = {}) {
    return (0, live_thermal_surplus_replan_1.evaluateLiveThermalSurplusReplan)({
        nowMs: NOW_MS,
        liveSurplusW: 4000,
        ihMinPowerW: 1700,
        thermalHeadroomKwh: 2.5,
        currentIhAllocatedW: 0,
        batterySocPct: 100,
        batteryMaxSocPct: 100,
        batteryRequiredChargeKwh: 0,
        ihLiveWriteAllowed: true,
        ihGovernanceEnabled: true,
        ihRuntimeWriteBlocked: false,
        higherPriorityLiveDemandW: 0,
        surplusQualifySinceMs: NOW_MS - live_thermal_surplus_replan_1.LIVE_THERMAL_SURPLUS_STABLE_MS - 1_000,
        lastThermalSurplusReplanAtMs: null,
        ...overrides,
    });
}
(0, node_test_1.describe)("B1 live thermal surplus replan gates", () => {
    (0, node_test_1.it)("stable 4 kW surplus, bat 100 %, IH 1.7 kW, headroom, NOW alloc 0 → material replan", () => {
        const r = baseOk();
        strict_1.default.equal(r.shouldReplan, true);
        strict_1.default.equal(r.preferImmersionNow, true);
        strict_1.default.match(r.reasonDe, /Live-Überschuss|NOW/i);
    });
    (0, node_test_1.it)("short surplus spike does not replan (debounce)", () => {
        const r = baseOk({
            surplusQualifySinceMs: null,
            nowMs: NOW_MS,
        });
        strict_1.default.equal(r.shouldReplan, false);
        strict_1.default.equal(r.preferImmersionNow, false);
        strict_1.default.match(r.blockReasonDe ?? "", /nicht stabil/);
        strict_1.default.ok(r.nextSurplusQualifySinceMs === NOW_MS);
    });
    (0, node_test_1.it)("spike then drop resets qualify window", () => {
        const mid = baseOk({
            surplusQualifySinceMs: NOW_MS - 30_000,
            liveSurplusW: 500,
        });
        strict_1.default.equal(mid.shouldReplan, false);
        strict_1.default.equal(mid.nextSurplusQualifySinceMs, null);
    });
    (0, node_test_1.it)("cooldown blocks replan chatter but keeps NOW preference", () => {
        const r = baseOk({
            lastThermalSurplusReplanAtMs: NOW_MS - live_thermal_surplus_replan_1.LIVE_THERMAL_SURPLUS_REPLAN_COOLDOWN_MS / 2,
        });
        strict_1.default.equal(r.shouldReplan, false);
        strict_1.default.equal(r.preferImmersionNow, true);
        strict_1.default.match(r.blockReasonDe ?? "", /Cooldown/);
    });
    (0, node_test_1.it)("higher-priority LIVE wallbox demand blocks IH surplus replan", () => {
        const r = baseOk({ higherPriorityLiveDemandW: 3500 });
        strict_1.default.equal(r.shouldReplan, false);
        strict_1.default.match(r.blockReasonDe ?? "", /Vorrang|reicht nicht/);
    });
    (0, node_test_1.it)("preferImmersionLiveSurplusNow shifts allocation into current slot vs peak-only", () => {
        const slots = (0, fixtures_2.buildSlots)("2026-08-09T09:00:00.000Z", 4);
        const nowIso = "2026-08-09T09:07:00.000Z";
        const input = (0, fixtures_1.golden001Input)();
        input.time = {
            ...input.time,
            nowIso,
            horizonStartIso: slots[0].startIso,
            horizonEndIso: slots[slots.length - 1].endIso,
            slots,
        };
        input.pv.slots = slots.map((s, i) => {
            // NOW-Fenster moderat, späterer Peak höher — ohne Flag oft Peak-lastig.
            const power = i < 2 ? 4200 : 9000;
            return {
                slot: s,
                forecastPowerW: power,
                observedPowerW: i === 0 ? 4200 : null,
                energyKwh: (power / 1000) * 0.25,
            };
        });
        input.houseLoad.slots = slots.map((s) => ({
            slot: s,
            forecastPowerW: 800,
            observedPowerW: null,
            energyKwh: 0.2,
        }));
        input.prices.slots = slots.map((s) => ({
            slot: s,
            importCtPerKwh: 18,
            exportCtPerKwh: 9.3,
            gridImportAllowed: true,
        }));
        input.battery = {
            ...input.battery,
            socPct: 100,
            requiredChargeEnergyKwh: 0,
            endSocTargetPct: 100,
        };
        input.thermal = {
            ...input.thermal,
            bufferTempC: 48,
            headroomEnergyKwh: 2.0,
            minPowerW: 1700,
            availablePowerW: 1700,
            deadlineIso: "2026-08-09T20:00:00.000Z",
        };
        input.climate = null;
        input.wallbox = null;
        const peakOnly = (0, allocate_1.allocateUnifiedDayPlan)({ ...input, preferImmersionLiveSurplusNow: false });
        const withNow = (0, allocate_1.allocateUnifiedDayPlan)({ ...input, preferImmersionLiveSurplusNow: true });
        const nowStart = slots[0].startIso;
        const nowIh = (plan) => plan.allocations
            .filter((a) => a.kind === "immersion_heater" && a.slot.startIso === nowStart)
            .reduce((s, a) => s + a.allocatedPowerW, 0);
        strict_1.default.ok(nowIh(withNow) + 1 >= 1700, `expected NOW IH ≥ 1700 W, got ${nowIh(withNow)}`);
        strict_1.default.ok(nowIh(withNow) >= nowIh(peakOnly), `NOW preference should not reduce NOW IH (${nowIh(withNow)} vs ${nowIh(peakOnly)})`);
    });
});
