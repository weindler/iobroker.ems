"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const thermal_target_authority_js_1 = require("./thermal_target_authority.js");
const fsm_js_1 = require("./fsm.js");
const device_config_js_1 = require("../device_config.js");
const persist_js_1 = require("./persist.js");
const flex_demand_js_1 = require("../../../operator/contributions/flexible/flex_demand.js");
const NOW = new Date("2026-07-26T15:45:00Z").getTime();
const CFG = (0, device_config_js_1.immersionDeviceConfigFromAdapter)({
    ih_set_enabled_target: "r",
    ih_buffer_temp_c_target: "t",
    ih_stage_1_nominal_power_w: 1700,
    ih_planning_max_temp_c: 63,
    ih_planning_min_temp_c: 44,
    ih_temperature_hysteresis_k: 2,
});
function authorityBase(over = {}) {
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
(0, node_test_1.describe)("thermal target authority (beta befund 004 split-brain)", () => {
    (0, node_test_1.it)("A: effective 59 °C + allocation — FSM keeps heating at 52 °C (not forecast 51.6)", () => {
        const auth = (0, thermal_target_authority_js_1.resolveAuthoritativeThermalTarget)(authorityBase());
        strict_1.default.equal(auth.source, "daily_plan_effective");
        strict_1.default.equal(auth.authoritativeTargetTempC, 59);
        strict_1.default.equal(auth.forecastTargetTempC, 51.6);
        const r = (0, fsm_js_1.runImmersionFsm)({
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
            persist: (0, persist_js_1.emptyPersist)(),
            config: CFG,
            faultLockout: false,
            faultCode: "none",
        });
        strict_1.default.equal(r.state, "auto_heating");
        strict_1.default.equal(r.commandedStage, 1);
        strict_1.default.notEqual(r.reason, "auto_planning_target_reached");
        // Gegenprobe: mit Forecast-Ceiling würde bei 52 °C schon gestoppt.
        const wrong = (0, fsm_js_1.runImmersionFsm)({
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
            persist: (0, persist_js_1.emptyPersist)(),
            config: CFG,
            faultLockout: false,
            faultCode: "none",
        });
        strict_1.default.equal(wrong.reason, "auto_planning_target_reached");
        strict_1.default.equal(wrong.commandedStage, 0);
    });
    (0, node_test_1.it)("B: at effective target — stop / target reached", () => {
        const auth = (0, thermal_target_authority_js_1.resolveAuthoritativeThermalTarget)(authorityBase({ planEffectiveTargetTempC: 59 }));
        const r = (0, fsm_js_1.runImmersionFsm)({
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
            persist: (0, persist_js_1.emptyPersist)(),
            config: CFG,
            faultLockout: false,
            faultCode: "none",
        });
        strict_1.default.equal(r.reason, "auto_planning_target_reached");
        strict_1.default.equal(r.commandedStage, 0);
        strict_1.default.equal(r.autoTargetReached, true);
    });
    (0, node_test_1.it)("C: replan lowers 59→53 — new revision immediately authoritative", () => {
        const stale = (0, thermal_target_authority_js_1.resolveAuthoritativeThermalTarget)(authorityBase({
            dailyPlanRevision: 13,
            planTargetRevision: 12,
            planEffectiveTargetTempC: 59,
        }));
        strict_1.default.notEqual(stale.source, "daily_plan_effective");
        const next = (0, thermal_target_authority_js_1.resolveAuthoritativeThermalTarget)(authorityBase({
            dailyPlanRevision: 13,
            planTargetRevision: 13,
            planEffectiveTargetTempC: 53,
            planTargetReasonDe: "Replan: Fahrzeugankunft, weniger Vorladung",
        }));
        strict_1.default.equal(next.source, "daily_plan_effective");
        strict_1.default.equal(next.authoritativeTargetTempC, 53);
        strict_1.default.match(next.reasonDe, /Fahrzeugankunft|53/);
    });
    (0, node_test_1.it)("D: replan raises 52→60 — runtime takes higher target", () => {
        const next = (0, thermal_target_authority_js_1.resolveAuthoritativeThermalTarget)(authorityBase({
            dailyPlanRevision: 14,
            planTargetRevision: 14,
            planEffectiveTargetTempC: 60,
            forecastTargetTempC: 52,
        }));
        strict_1.default.equal(next.authoritativeTargetTempC, 60);
        strict_1.default.equal(next.forecastTargetTempC, 52);
        const r = (0, fsm_js_1.runImmersionFsm)({
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
            persist: (0, persist_js_1.emptyPersist)(),
            config: CFG,
            faultLockout: false,
            faultCode: "none",
        });
        strict_1.default.equal(r.state, "auto_heating");
        strict_1.default.equal(r.commandedStage, 1);
    });
    (0, node_test_1.it)("E: no valid unified plan — forecast / safe fallback", () => {
        const noPlan = (0, thermal_target_authority_js_1.resolveAuthoritativeThermalTarget)(authorityBase({
            useDailyPlan: false,
            planEffectiveTargetTempC: 59,
            planTargetRevision: 12,
        }));
        strict_1.default.equal(noPlan.source, "forecast");
        strict_1.default.equal(noPlan.authoritativeTargetTempC, 51.6);
        const staleRev = (0, thermal_target_authority_js_1.resolveAuthoritativeThermalTarget)(authorityBase({
            useDailyPlan: true,
            dailyPlanRevision: 20,
            planTargetRevision: 12,
            planEffectiveTargetTempC: 59,
        }));
        strict_1.default.equal(staleRev.source, "forecast");
        strict_1.default.equal(staleRev.authoritativeTargetTempC, 51.6);
        strict_1.default.equal((0, thermal_target_authority_js_1.planTargetRevisionMatches)(12, 20), false);
    });
    (0, node_test_1.it)("F: effectiveTarget > planningMax — clamp to safety max", () => {
        const auth = (0, thermal_target_authority_js_1.resolveAuthoritativeThermalTarget)(authorityBase({
            planEffectiveTargetTempC: 70,
            planningMaxTempC: 63,
        }));
        strict_1.default.equal(auth.authoritativeTargetTempC, 63);
        strict_1.default.equal(auth.source, "daily_plan_effective");
    });
    (0, node_test_1.it)("G: VIS semantics — primary = effective, basis = forecast, reason = plan", () => {
        const auth = (0, thermal_target_authority_js_1.resolveAuthoritativeThermalTarget)(authorityBase());
        // plan_target_temp_c ownership: authoritative effective
        strict_1.default.equal(auth.authoritativeTargetTempC, 59);
        // optional basis state
        strict_1.default.equal(auth.forecastTargetTempC, 51.6);
        strict_1.default.match(auth.reasonDe, /PV-Vorladung/);
        strict_1.default.notEqual(auth.authoritativeTargetTempC, auth.forecastTargetTempC);
    });
    (0, node_test_1.it)("H: revision mismatch rejects dual-writer stale effective (no plan_target from stale alloc)", () => {
        strict_1.default.equal((0, thermal_target_authority_js_1.planTargetRevisionMatches)(5, 5), true);
        strict_1.default.equal((0, thermal_target_authority_js_1.planTargetRevisionMatches)(5, 6), false);
        strict_1.default.equal((0, thermal_target_authority_js_1.planTargetRevisionMatches)(null, 6), false);
        const rejected = (0, thermal_target_authority_js_1.resolveAuthoritativeThermalTarget)(authorityBase({
            dailyPlanRevision: 6,
            planTargetRevision: 5,
            planEffectiveTargetTempC: 59,
        }));
        strict_1.default.equal(rejected.source, "forecast");
        strict_1.default.equal(rejected.authoritativeTargetTempC, 51.6);
    });
    (0, node_test_1.it)("I: beta case — ~4.7 kWh from 50 °C implies effective ≫ 51.6; FSM continues past forecast", () => {
        const buffer = 50;
        const forecast = 51.6;
        const requiredKwh = 4.7;
        const k = 0.38;
        const impliedDelta = requiredKwh / k; // ~12.37 K
        const effective = Math.min(63, buffer + impliedDelta); // ~62.4
        strict_1.default.ok(effective > forecast + 5);
        strict_1.default.equal((0, thermal_target_authority_js_1.thermalEnergyMatchesTargetTemp)({
            bufferTempC: buffer,
            effectiveTargetTempC: effective,
            requiredEnergyKwh: requiredKwh,
            kwhPerDegreeC: k,
        }), true);
        // Invariant: energy target and temp target same semantics
        const fromTemp = (0, flex_demand_js_1.estimateImmersionRequiredEnergyKwh)(buffer, effective, 1700, {
            status: "missing",
            coolingRateCPerHAvg: null,
            kwhPerDegreeC: k,
        });
        strict_1.default.ok(Math.abs(fromTemp - requiredKwh) < 0.8);
        // Publishing 4.7 kWh with authoritative 51.6 would be inconsistent
        strict_1.default.equal((0, thermal_target_authority_js_1.thermalEnergyMatchesTargetTemp)({
            bufferTempC: buffer,
            effectiveTargetTempC: forecast,
            requiredEnergyKwh: requiredKwh,
            kwhPerDegreeC: k,
        }), false);
        const auth = (0, thermal_target_authority_js_1.resolveAuthoritativeThermalTarget)(authorityBase({
            planEffectiveTargetTempC: Math.round(effective * 10) / 10,
            forecastTargetTempC: forecast,
            planTargetReasonDe: "PV-Vorladung: Wärme für Abend/Nacht speichern",
        }));
        strict_1.default.ok(auth.authoritativeTargetTempC > forecast);
        const r = (0, fsm_js_1.runImmersionFsm)({
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
            persist: (0, persist_js_1.emptyPersist)(),
            config: CFG,
            faultLockout: false,
            faultCode: "none",
        });
        strict_1.default.equal(r.state, "auto_heating");
        strict_1.default.equal(r.commandedStage, 1);
    });
});
