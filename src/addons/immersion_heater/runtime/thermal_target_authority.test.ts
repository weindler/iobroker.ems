import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	planTargetRevisionMatches,
	resolveAuthoritativeThermalTarget,
	thermalEnergyMatchesTargetTemp,
} from "./thermal_target_authority.js";
import { runImmersionFsm } from "./fsm.js";
import { immersionDeviceConfigFromAdapter } from "../device_config.js";
import { emptyPersist } from "./persist.js";
import { estimateImmersionRequiredEnergyKwh } from "../../../operator/contributions/flexible/flex_demand.js";

const NOW = new Date("2026-07-26T15:45:00Z").getTime();
const CFG = immersionDeviceConfigFromAdapter({
	ih_set_enabled_target: "r",
	ih_buffer_temp_c_target: "t",
	ih_stage_1_nominal_power_w: 1700,
	ih_planning_max_temp_c: 63,
	ih_planning_min_temp_c: 44,
	ih_temperature_hysteresis_k: 2,
});

function authorityBase(
	over: Partial<Parameters<typeof resolveAuthoritativeThermalTarget>[0]> = {},
): Parameters<typeof resolveAuthoritativeThermalTarget>[0] {
	return {
		useDailyPlan: true,
		dailyPlanRevision: 12,
		planEffectiveTargetTempC: 59,
		planTargetRevision: 12,
		forecastTargetTempC: 51.6,
		forceTargetTempC: null,
		resolvedMode: "auto",
		planningMinTempC: 44,
		planningMaxTempC: 63,
		planTargetReasonDe: "PV-Vorladung: Wärme für Abend/Nacht speichern",
		forecastReasonDe: "Moderates Ziel 51,6 °C.",
		...over,
	};
}

describe("thermal target authority (beta befund 004 split-brain)", () => {
	it("A: effective 59 °C + allocation — FSM keeps heating at 52 °C (not forecast 51.6)", () => {
		const auth = resolveAuthoritativeThermalTarget(authorityBase());
		assert.equal(auth.source, "daily_plan_effective");
		assert.equal(auth.authoritativeTargetTempC, 59);
		assert.equal(auth.forecastTargetTempC, 51.6);

		const r = runImmersionFsm({
			nowMs: NOW,
			addonEnabled: true,
			addonAvailable: true,
			configValid: true,
			executionLive: true,
			failsafeActive: false,
			resolvedMode: "auto",
			forceTargetTempC: null,
			forceUntilMs: null,
			plannerCommandedStage: 1,
			plannerTargetTempC: auth.authoritativeTargetTempC,
			temperature: { valueC: 52, status: "valid", observedAtMs: NOW },
			measuredPowerW: 0,
			hasPowerMeasurement: false,
			persist: emptyPersist(),
			config: CFG,
			faultLockout: false,
			faultCode: "none",
		});
		assert.equal(r.state, "auto_heating");
		assert.equal(r.commandedStage, 1);
		assert.notEqual(r.reason, "auto_planning_target_reached");

		// Gegenprobe: mit Forecast-Ceiling würde bei 52 °C schon gestoppt.
		const wrong = runImmersionFsm({
			nowMs: NOW,
			addonEnabled: true,
			addonAvailable: true,
			configValid: true,
			executionLive: true,
			failsafeActive: false,
			resolvedMode: "auto",
			forceTargetTempC: null,
			forceUntilMs: null,
			plannerCommandedStage: 1,
			plannerTargetTempC: 51.6,
			temperature: { valueC: 52, status: "valid", observedAtMs: NOW },
			measuredPowerW: 0,
			hasPowerMeasurement: false,
			persist: emptyPersist(),
			config: CFG,
			faultLockout: false,
			faultCode: "none",
		});
		assert.equal(wrong.reason, "auto_planning_target_reached");
		assert.equal(wrong.commandedStage, 0);
	});

	it("B: at effective target — stop / target reached", () => {
		const auth = resolveAuthoritativeThermalTarget(authorityBase({ planEffectiveTargetTempC: 59 }));
		const r = runImmersionFsm({
			nowMs: NOW,
			addonEnabled: true,
			addonAvailable: true,
			configValid: true,
			executionLive: true,
			failsafeActive: false,
			resolvedMode: "auto",
			forceTargetTempC: null,
			forceUntilMs: null,
			plannerCommandedStage: 1,
			plannerTargetTempC: auth.authoritativeTargetTempC,
			temperature: { valueC: 59, status: "valid", observedAtMs: NOW },
			measuredPowerW: 0,
			hasPowerMeasurement: false,
			persist: emptyPersist(),
			config: CFG,
			faultLockout: false,
			faultCode: "none",
		});
		assert.equal(r.reason, "auto_planning_target_reached");
		assert.equal(r.commandedStage, 0);
		assert.equal(r.autoTargetReached, true);
	});

	it("C: replan lowers 59→53 — new revision immediately authoritative", () => {
		const stale = resolveAuthoritativeThermalTarget(
			authorityBase({
				dailyPlanRevision: 13,
				planTargetRevision: 12,
				planEffectiveTargetTempC: 59,
			}),
		);
		assert.notEqual(stale.source, "daily_plan_effective");

		const next = resolveAuthoritativeThermalTarget(
			authorityBase({
				dailyPlanRevision: 13,
				planTargetRevision: 13,
				planEffectiveTargetTempC: 53,
				planTargetReasonDe: "Replan: Fahrzeugankunft, weniger Vorladung",
			}),
		);
		assert.equal(next.source, "daily_plan_effective");
		assert.equal(next.authoritativeTargetTempC, 53);
		assert.match(next.reasonDe, /Fahrzeugankunft|53/);
	});

	it("D: replan raises 52→60 — runtime takes higher target", () => {
		const next = resolveAuthoritativeThermalTarget(
			authorityBase({
				dailyPlanRevision: 14,
				planTargetRevision: 14,
				planEffectiveTargetTempC: 60,
				forecastTargetTempC: 52,
			}),
		);
		assert.equal(next.authoritativeTargetTempC, 60);
		assert.equal(next.forecastTargetTempC, 52);

		const r = runImmersionFsm({
			nowMs: NOW,
			addonEnabled: true,
			addonAvailable: true,
			configValid: true,
			executionLive: true,
			failsafeActive: false,
			resolvedMode: "auto",
			forceTargetTempC: null,
			forceUntilMs: null,
			plannerCommandedStage: 1,
			plannerTargetTempC: next.authoritativeTargetTempC,
			temperature: { valueC: 55, status: "valid", observedAtMs: NOW },
			measuredPowerW: 0,
			hasPowerMeasurement: false,
			persist: emptyPersist(),
			config: CFG,
			faultLockout: false,
			faultCode: "none",
		});
		assert.equal(r.state, "auto_heating");
		assert.equal(r.commandedStage, 1);
	});

	it("E: no valid unified plan — forecast / safe fallback", () => {
		const noPlan = resolveAuthoritativeThermalTarget(
			authorityBase({
				useDailyPlan: false,
				planEffectiveTargetTempC: 59,
				planTargetRevision: 12,
			}),
		);
		assert.equal(noPlan.source, "forecast");
		assert.equal(noPlan.authoritativeTargetTempC, 51.6);

		const staleRev = resolveAuthoritativeThermalTarget(
			authorityBase({
				useDailyPlan: true,
				dailyPlanRevision: 20,
				planTargetRevision: 12,
				planEffectiveTargetTempC: 59,
			}),
		);
		assert.equal(staleRev.source, "forecast");
		assert.equal(staleRev.authoritativeTargetTempC, 51.6);
		assert.equal(planTargetRevisionMatches(12, 20), false);
	});

	it("F: effectiveTarget > planningMax — clamp to safety max", () => {
		const auth = resolveAuthoritativeThermalTarget(
			authorityBase({
				planEffectiveTargetTempC: 70,
				planningMaxTempC: 63,
			}),
		);
		assert.equal(auth.authoritativeTargetTempC, 63);
		assert.equal(auth.source, "daily_plan_effective");
	});

	it("G: VIS semantics — primary = effective, basis = forecast, reason = plan", () => {
		const auth = resolveAuthoritativeThermalTarget(authorityBase());
		// plan_target_temp_c ownership: authoritative effective
		assert.equal(auth.authoritativeTargetTempC, 59);
		// optional basis state
		assert.equal(auth.forecastTargetTempC, 51.6);
		assert.match(auth.reasonDe, /PV-Vorladung/);
		assert.notEqual(auth.authoritativeTargetTempC, auth.forecastTargetTempC);
	});

	it("H: revision mismatch rejects dual-writer stale effective (no plan_target from stale alloc)", () => {
		assert.equal(planTargetRevisionMatches(5, 5), true);
		assert.equal(planTargetRevisionMatches(5, 6), false);
		assert.equal(planTargetRevisionMatches(null, 6), false);
		const rejected = resolveAuthoritativeThermalTarget(
			authorityBase({
				dailyPlanRevision: 6,
				planTargetRevision: 5,
				planEffectiveTargetTempC: 59,
			}),
		);
		assert.equal(rejected.source, "forecast");
		assert.equal(rejected.authoritativeTargetTempC, 51.6);
	});

	it("I: beta case — ~4.7 kWh from 50 °C implies effective ≫ 51.6; FSM continues past forecast", () => {
		const buffer = 50;
		const forecast = 51.6;
		const requiredKwh = 4.7;
		const k = 0.38;
		const impliedDelta = requiredKwh / k; // ~12.37 K
		const effective = Math.min(63, buffer + impliedDelta); // ~62.4
		assert.ok(effective > forecast + 5);

		assert.equal(
			thermalEnergyMatchesTargetTemp({
				bufferTempC: buffer,
				effectiveTargetTempC: effective,
				requiredEnergyKwh: requiredKwh,
				kwhPerDegreeC: k,
			}),
			true,
		);
		// Invariant: energy target and temp target same semantics
		const fromTemp = estimateImmersionRequiredEnergyKwh(buffer, effective, 1700, {
			status: "missing",
			coolingRateCPerHAvg: null,
			kwhPerDegreeC: k,
		});
		assert.ok(Math.abs(fromTemp - requiredKwh) < 0.8);

		// Publishing 4.7 kWh with authoritative 51.6 would be inconsistent
		assert.equal(
			thermalEnergyMatchesTargetTemp({
				bufferTempC: buffer,
				effectiveTargetTempC: forecast,
				requiredEnergyKwh: requiredKwh,
				kwhPerDegreeC: k,
			}),
			false,
		);

		const auth = resolveAuthoritativeThermalTarget(
			authorityBase({
				planEffectiveTargetTempC: Math.round(effective * 10) / 10,
				forecastTargetTempC: forecast,
				planTargetReasonDe: "PV-Vorladung: Wärme für Abend/Nacht speichern",
			}),
		);
		assert.ok((auth.authoritativeTargetTempC as number) > forecast);

		const r = runImmersionFsm({
			nowMs: NOW,
			addonEnabled: true,
			addonAvailable: true,
			configValid: true,
			executionLive: true,
			failsafeActive: false,
			resolvedMode: "auto",
			forceTargetTempC: null,
			forceUntilMs: null,
			plannerCommandedStage: 1,
			plannerTargetTempC: auth.authoritativeTargetTempC,
			temperature: { valueC: 52, status: "valid", observedAtMs: NOW },
			measuredPowerW: 1650,
			hasPowerMeasurement: true,
			persist: emptyPersist(),
			config: CFG,
			faultLockout: false,
			faultCode: "none",
		});
		assert.equal(r.state, "auto_heating");
		assert.equal(r.commandedStage, 1);
	});
});
