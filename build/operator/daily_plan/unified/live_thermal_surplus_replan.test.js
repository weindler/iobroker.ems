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
const tick_1 = require("../tick");
const daily_plan_1 = require("../../../addons/immersion_heater/runtime/daily_plan");
const device_config_1 = require("../../../addons/immersion_heater/device_config");
const contribution_ids_1 = require("../../contribution_ids");
const contributor_1 = require("../../contributor");
const slots_1 = require("../slots");
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
(0, node_test_1.describe)("B1 startup mid-slot: adapter starts during active planned slot", () => {
    const runtimeNowMs = Date.parse("2026-08-09T07:27:00.000Z"); // 09:27 Europe/Berlin
    (0, node_test_1.it)("first hard-replan after process start may bypass 90s stability once", () => {
        const blocked = baseOk({
            nowMs: runtimeNowMs,
            surplusQualifySinceMs: null,
            liveSurplusW: 4205,
            bypassStabilityMs: false,
        });
        strict_1.default.equal(blocked.preferImmersionNow, false);
        strict_1.default.match(blocked.blockReasonDe ?? "", /nicht stabil/);
        strict_1.default.equal(blocked.startupStabilityBypassApplied, false);
        const startup = baseOk({
            nowMs: runtimeNowMs,
            surplusQualifySinceMs: null,
            liveSurplusW: 4205,
            bypassStabilityMs: true,
        });
        strict_1.default.equal(startup.shouldReplan, true);
        strict_1.default.equal(startup.preferImmersionNow, true);
        strict_1.default.equal(startup.startupStabilityBypassApplied, true);
        strict_1.default.match(startup.reasonDe, /Startup-Hard-Replan/);
    });
    (0, node_test_1.it)("startup bypass still requires all other B1 gates (not bat-full-only)", () => {
        const r = baseOk({
            nowMs: runtimeNowMs,
            surplusQualifySinceMs: null,
            bypassStabilityMs: true,
            batterySocPct: 40,
            batteryRequiredChargeKwh: 4,
            batteryMaxSocPct: 100,
        });
        strict_1.default.equal(r.preferImmersionNow, false);
        strict_1.default.equal(r.startupStabilityBypassApplied, false);
        strict_1.default.match(r.blockReasonDe ?? "", /Batterie/);
    });
    (0, node_test_1.it)("startup bypass does not weaken governance / write gates", () => {
        for (const [label, overrides] of [
            ["governance off", { ihGovernanceEnabled: false }],
            ["live write denied", { ihLiveWriteAllowed: false }],
            ["runtime write blocked", { ihRuntimeWriteBlocked: true }],
        ]) {
            const r = baseOk({
                nowMs: runtimeNowMs,
                surplusQualifySinceMs: null,
                bypassStabilityMs: true,
                ...overrides,
            });
            strict_1.default.equal(r.preferImmersionNow, false, label);
            strict_1.default.equal(r.startupStabilityBypassApplied, false, label);
        }
    });
    (0, node_test_1.it)("normal short spike after startup remains debounced (no bypass)", () => {
        const r = baseOk({
            nowMs: runtimeNowMs + 5_000,
            surplusQualifySinceMs: null,
            liveSurplusW: 4205,
            bypassStabilityMs: false,
        });
        strict_1.default.equal(r.shouldReplan, false);
        strict_1.default.equal(r.preferImmersionNow, false);
        strict_1.default.equal(r.startupStabilityBypassApplied, false);
        strict_1.default.match(r.blockReasonDe ?? "", /nicht stabil/);
    });
    (0, node_test_1.it)("startup prefer allocates IH into NOW; without prefer NOW stays empty", () => {
        const slots = (0, fixtures_2.buildSlots)("2026-08-09T07:15:00.000Z", 6);
        const nowIso = "2026-08-09T07:27:00.000Z";
        const nowStart = slots[0].startIso;
        const input = (0, fixtures_1.golden001Input)();
        input.time = {
            ...input.time,
            nowIso,
            horizonStartIso: slots[0].startIso,
            horizonEndIso: slots[slots.length - 1].endIso,
            slots,
        };
        // Flaches PV-Profil: ohne Prefer gewinnt späterer Peak-Score; mit Prefer → NOW.
        input.pv.slots = slots.map((s) => ({
            slot: s,
            forecastPowerW: 4500,
            observedPowerW: s.startIso === nowStart ? 4509 : null,
            energyKwh: 1.125,
        }));
        input.houseLoad.slots = slots.map((s) => ({
            slot: s,
            forecastPowerW: 300,
            observedPowerW: s.startIso === nowStart ? 304 : null,
            energyKwh: 0.075,
        }));
        input.prices.slots = slots.map((s) => ({
            slot: s,
            importCtPerKwh: 18.95,
            exportCtPerKwh: 8,
            gridImportAllowed: true,
        }));
        input.battery = {
            ...input.battery,
            socPct: 100,
            requiredChargeEnergyKwh: 0,
            endSocTargetPct: 100,
            maxChargePowerW: 0,
        };
        input.thermal = {
            ...input.thermal,
            bufferTempC: 51,
            headroomEnergyKwh: 3.5,
            minPowerW: 1700,
            availablePowerW: 1700,
            deadlineIso: "2026-08-09T16:44:00.000Z",
        };
        input.climate = null;
        input.wallbox = null;
        const without = (0, allocate_1.allocateUnifiedDayPlan)({ ...input, preferImmersionLiveSurplusNow: false });
        const withStartupPrefer = (0, allocate_1.allocateUnifiedDayPlan)({
            ...input,
            preferImmersionLiveSurplusNow: true,
        });
        const nowIh = (plan) => plan.allocations
            .filter((a) => a.kind === "immersion_heater" && a.slot.startIso === nowStart)
            .reduce((s, a) => s + a.allocatedPowerW, 0);
        strict_1.default.equal(nowIh(without), 0, "without prefer NOW must stay empty (mid-slot restart bug)");
        strict_1.default.ok(nowIh(withStartupPrefer) + 1 >= 1700, `startup prefer NOW ≥ 1700, got ${nowIh(withStartupPrefer)}`);
    });
    (0, node_test_1.it)("incomplete first startup replan does not consume one-shot; next ready tick bypasses once", () => {
        (0, tick_1.resetDailyPlanRevisionForTest)();
        strict_1.default.equal((0, tick_1.startupLiveSurplusPreferAvailableForTest)(), true);
        const incomplete = baseOk({
            nowMs: runtimeNowMs,
            surplusQualifySinceMs: null,
            bypassStabilityMs: true,
            batterySocPct: null, // Gates unvollständig
            liveSurplusW: null,
            thermalHeadroomKwh: null,
        });
        strict_1.default.equal(incomplete.preferImmersionNow, false);
        strict_1.default.equal(incomplete.startupStabilityBypassApplied, false);
        (0, tick_1.noteStartupLiveSurplusPreferResultForTest)(incomplete.startupStabilityBypassApplied);
        strict_1.default.equal((0, tick_1.startupLiveSurplusPreferAvailableForTest)(), true, "one-shot must remain available");
        const ready = baseOk({
            nowMs: runtimeNowMs + 60_000,
            surplusQualifySinceMs: null,
            liveSurplusW: 4205,
            bypassStabilityMs: (0, tick_1.startupLiveSurplusPreferAvailableForTest)(),
        });
        strict_1.default.equal(ready.startupStabilityBypassApplied, true);
        strict_1.default.equal(ready.preferImmersionNow, true);
        (0, tick_1.noteStartupLiveSurplusPreferResultForTest)(ready.startupStabilityBypassApplied);
        strict_1.default.equal((0, tick_1.startupLiveSurplusPreferAvailableForTest)(), false, "one-shot consumed after success");
        const third = baseOk({
            nowMs: runtimeNowMs + 120_000,
            surplusQualifySinceMs: null,
            liveSurplusW: 4205,
            bypassStabilityMs: (0, tick_1.startupLiveSurplusPreferAvailableForTest)(),
        });
        strict_1.default.equal(third.startupStabilityBypassApplied, false);
        strict_1.default.equal(third.preferImmersionNow, false);
        strict_1.default.match(third.blockReasonDe ?? "", /nicht stabil/);
    });
    (0, node_test_1.it)("NOW plan 1700 W → runtime daily_plan_valid and commandedStage ≥ 1", () => {
        const now = new Date("2026-08-09T07:27:00.000Z");
        const tz = "Europe/Berlin";
        const start = (0, slots_1.slotStartIsoFloored)(now, tz);
        const end = new Date(Date.parse(start) + slots_1.DAILY_PLAN_SLOT_MS).toISOString();
        const entry = {
            contributionId: contribution_ids_1.CONTRIBUTION_IDS.IMMERSION_FLEXIBLE,
            contributor: (0, contributor_1.addonContributorRef)("immersion_heater"),
            slot: { startIso: start, endIso: end },
            status: "allocated",
            energySource: "pv_surplus",
            requestedPowerW: 1700,
            allocatedPowerW: 1700,
            requestedEnergyKwh: 0.425,
            allocatedEnergyKwh: 0.425,
            gridPowerW: 0,
            pvPowerW: 1700,
            batteryPowerW: 0,
            mandatory: false,
            priorityRank: null,
            deadlineIso: null,
            estimatedCostCt: null,
            reasonDe: "test",
        };
        const cfg = (0, device_config_1.immersionDeviceConfigFromAdapter)({
            ih_stage_count: 1,
            ih_stage_1_set_state: "relay.0.heater",
            ih_stage_1_nominal_power_w: 1700,
            ih_buffer_temp_c_target: "sensor.0.temp",
            ih_buffer_temp_c_enabled: true,
        });
        const r = (0, daily_plan_1.resolveImmersionDailyPlanFromData)({
            now,
            timezone: tz,
            meta: { status: "degraded", date: "2026-08-09", revision: 1, validUntil: null, timezone: tz },
            entries: [entry],
            config: cfg,
        });
        strict_1.default.equal(r.dailyPlanStatus, "daily_plan_valid");
        strict_1.default.equal(r.decisionSource, "daily_plan");
        strict_1.default.equal(r.allocatedPowerW, 1700);
        strict_1.default.ok(r.commandedStage >= 1);
    });
});
