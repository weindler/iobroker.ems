import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	evaluateLiveThermalSurplusReplan,
	LIVE_THERMAL_SURPLUS_STABLE_MS,
	LIVE_THERMAL_SURPLUS_REPLAN_COOLDOWN_MS,
} from "./live_thermal_surplus_replan";
import { allocateUnifiedDayPlan } from "./allocate";
import { golden001Input } from "./fixtures";
import { buildSlots } from "./fixtures";

const NOW_MS = Date.parse("2026-08-09T10:07:00.000Z");

function baseOk(overrides: Partial<Parameters<typeof evaluateLiveThermalSurplusReplan>[0]> = {}) {
	return evaluateLiveThermalSurplusReplan({
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
		surplusQualifySinceMs: NOW_MS - LIVE_THERMAL_SURPLUS_STABLE_MS - 1_000,
		lastThermalSurplusReplanAtMs: null,
		...overrides,
	});
}

describe("B1 live thermal surplus replan gates", () => {
	it("stable 4 kW surplus, bat 100 %, IH 1.7 kW, headroom, NOW alloc 0 → material replan", () => {
		const r = baseOk();
		assert.equal(r.shouldReplan, true);
		assert.equal(r.preferImmersionNow, true);
		assert.match(r.reasonDe, /Live-Überschuss|NOW/i);
	});

	it("short surplus spike does not replan (debounce)", () => {
		const r = baseOk({
			surplusQualifySinceMs: null,
			nowMs: NOW_MS,
		});
		assert.equal(r.shouldReplan, false);
		assert.equal(r.preferImmersionNow, false);
		assert.match(r.blockReasonDe ?? "", /nicht stabil/);
		assert.ok(r.nextSurplusQualifySinceMs === NOW_MS);
	});

	it("spike then drop resets qualify window", () => {
		const mid = baseOk({
			surplusQualifySinceMs: NOW_MS - 30_000,
			liveSurplusW: 500,
		});
		assert.equal(mid.shouldReplan, false);
		assert.equal(mid.nextSurplusQualifySinceMs, null);
	});

	it("cooldown blocks replan chatter but keeps NOW preference", () => {
		const r = baseOk({
			lastThermalSurplusReplanAtMs: NOW_MS - LIVE_THERMAL_SURPLUS_REPLAN_COOLDOWN_MS / 2,
		});
		assert.equal(r.shouldReplan, false);
		assert.equal(r.preferImmersionNow, true);
		assert.match(r.blockReasonDe ?? "", /Cooldown/);
	});

	it("higher-priority LIVE wallbox demand blocks IH surplus replan", () => {
		const r = baseOk({ higherPriorityLiveDemandW: 3500 });
		assert.equal(r.shouldReplan, false);
		assert.match(r.blockReasonDe ?? "", /Vorrang|reicht nicht/);
	});

	it("preferImmersionLiveSurplusNow shifts allocation into current slot vs peak-only", () => {
		const slots = buildSlots("2026-08-09T09:00:00.000Z", 4);
		const nowIso = "2026-08-09T09:07:00.000Z";
		const input = golden001Input();
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
			...input.thermal!,
			bufferTempC: 48,
			headroomEnergyKwh: 2.0,
			minPowerW: 1700,
			availablePowerW: 1700,
			deadlineIso: "2026-08-09T20:00:00.000Z",
		};
		input.climate = null;
		input.wallbox = null;

		const peakOnly = allocateUnifiedDayPlan({ ...input, preferImmersionLiveSurplusNow: false });
		const withNow = allocateUnifiedDayPlan({ ...input, preferImmersionLiveSurplusNow: true });

		const nowStart = slots[0].startIso;
		const nowIh = (plan: typeof peakOnly) =>
			plan.allocations
				.filter((a) => a.kind === "immersion_heater" && a.slot.startIso === nowStart)
				.reduce((s, a) => s + a.allocatedPowerW, 0);

		assert.ok(nowIh(withNow) + 1 >= 1700, `expected NOW IH ≥ 1700 W, got ${nowIh(withNow)}`);
		assert.ok(
			nowIh(withNow) >= nowIh(peakOnly),
			`NOW preference should not reduce NOW IH (${nowIh(withNow)} vs ${nowIh(peakOnly)})`,
		);
	});
});

describe("B1 startup mid-slot: adapter starts during active planned slot", () => {
	const runtimeNowMs = Date.parse("2026-08-09T07:27:00.000Z"); // 09:27 Europe/Berlin

	it("first hard-replan after process start may bypass 90s stability once", () => {
		const blocked = baseOk({
			nowMs: runtimeNowMs,
			surplusQualifySinceMs: null,
			liveSurplusW: 4205,
			bypassStabilityMs: false,
		});
		assert.equal(blocked.preferImmersionNow, false);
		assert.match(blocked.blockReasonDe ?? "", /nicht stabil/);
		assert.equal(blocked.startupStabilityBypassApplied, false);

		const startup = baseOk({
			nowMs: runtimeNowMs,
			surplusQualifySinceMs: null,
			liveSurplusW: 4205,
			bypassStabilityMs: true,
		});
		assert.equal(startup.shouldReplan, true);
		assert.equal(startup.preferImmersionNow, true);
		assert.equal(startup.startupStabilityBypassApplied, true);
		assert.match(startup.reasonDe, /Startup-Hard-Replan/);
	});

	it("startup bypass still requires all other B1 gates (not bat-full-only)", () => {
		const r = baseOk({
			nowMs: runtimeNowMs,
			surplusQualifySinceMs: null,
			bypassStabilityMs: true,
			batterySocPct: 40,
			batteryRequiredChargeKwh: 4,
			batteryMaxSocPct: 100,
		});
		assert.equal(r.preferImmersionNow, false);
		assert.equal(r.startupStabilityBypassApplied, false);
		assert.match(r.blockReasonDe ?? "", /Batterie/);
	});

	it("normal short spike after startup remains debounced (no bypass)", () => {
		const r = baseOk({
			nowMs: runtimeNowMs + 5_000,
			surplusQualifySinceMs: null,
			liveSurplusW: 4205,
			bypassStabilityMs: false,
		});
		assert.equal(r.shouldReplan, false);
		assert.equal(r.preferImmersionNow, false);
		assert.equal(r.startupStabilityBypassApplied, false);
		assert.match(r.blockReasonDe ?? "", /nicht stabil/);
	});

	it("startup prefer allocates IH into NOW; without prefer NOW stays empty", () => {
		const slots = buildSlots("2026-08-09T07:15:00.000Z", 6);
		const nowIso = "2026-08-09T07:27:00.000Z";
		const nowStart = slots[0]!.startIso;
		const input = golden001Input();
		input.time = {
			...input.time,
			nowIso,
			horizonStartIso: slots[0]!.startIso,
			horizonEndIso: slots[slots.length - 1]!.endIso,
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
			...input.thermal!,
			bufferTempC: 51,
			headroomEnergyKwh: 3.5,
			minPowerW: 1700,
			availablePowerW: 1700,
			deadlineIso: "2026-08-09T16:44:00.000Z",
		};
		input.climate = null;
		input.wallbox = null;

		const without = allocateUnifiedDayPlan({ ...input, preferImmersionLiveSurplusNow: false });
		const withStartupPrefer = allocateUnifiedDayPlan({
			...input,
			preferImmersionLiveSurplusNow: true,
		});
		const nowIh = (plan: typeof without) =>
			plan.allocations
				.filter((a) => a.kind === "immersion_heater" && a.slot.startIso === nowStart)
				.reduce((s, a) => s + a.allocatedPowerW, 0);

		assert.equal(nowIh(without), 0, "without prefer NOW must stay empty (mid-slot restart bug)");
		assert.ok(nowIh(withStartupPrefer) + 1 >= 1700, `startup prefer NOW ≥ 1700, got ${nowIh(withStartupPrefer)}`);
	});
});
