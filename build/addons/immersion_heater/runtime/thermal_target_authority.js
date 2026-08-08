"use strict";
/**
 * Autoritative Thermal-Zieltemperatur für Runtime/FSM (Befund 004 Split-Brain-Fix).
 *
 * Bei gültigem Unified/Daily Plan: effectiveTargetTempC (Forecast → Bridge → Precharge).
 * Sonst: sicherer Forecast-/Force-Fallback. Nie über planningMax.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.thermalEnergyMatchesTargetTemp = exports.resolveAuthoritativeThermalTarget = exports.planTargetRevisionMatches = void 0;
function clampTemp(min, max, t) {
    return Math.min(max, Math.max(min, t));
}
function finiteOrNull(n) {
    return n !== null && n !== undefined && Number.isFinite(n) ? n : null;
}
/**
 * Revision muss zum Daily Plan passen — verhindert stale Precharge-Ziele.
 */
function planTargetRevisionMatches(planTargetRevision, dailyPlanRevision) {
    if (planTargetRevision === null || dailyPlanRevision === null)
        return false;
    return planTargetRevision === dailyPlanRevision;
}
exports.planTargetRevisionMatches = planTargetRevisionMatches;
function resolveAuthoritativeThermalTarget(input) {
    const min = input.planningMinTempC;
    const max = input.planningMaxTempC;
    const forecast = finiteOrNull(input.forecastTargetTempC);
    const forecastClamped = forecast !== null ? clampTemp(min, max, forecast) : null;
    if (input.resolvedMode === "off") {
        return {
            authoritativeTargetTempC: null,
            forecastTargetTempC: forecastClamped,
            reasonDe: "Modus off — kein Heiz-Tagesziel.",
            source: "off",
        };
    }
    if (input.resolvedMode === "force") {
        const force = finiteOrNull(input.forceTargetTempC) ?? max;
        return {
            authoritativeTargetTempC: clampTemp(min, max, force),
            forecastTargetTempC: forecastClamped,
            reasonDe: `Force-Ziel ${clampTemp(min, max, force)} °C.`,
            source: "force",
        };
    }
    const effective = finiteOrNull(input.planEffectiveTargetTempC);
    const revOk = planTargetRevisionMatches(input.planTargetRevision, input.dailyPlanRevision);
    if (input.useDailyPlan && effective !== null && revOk) {
        const t = clampTemp(min, max, effective);
        const reason = (input.planTargetReasonDe && input.planTargetReasonDe.trim()) ||
            `Unified-Plan-Ziel ${t} °C (Revision ${input.dailyPlanRevision}).`;
        return {
            authoritativeTargetTempC: t,
            forecastTargetTempC: forecastClamped,
            reasonDe: reason,
            source: "daily_plan_effective",
        };
    }
    if (forecastClamped !== null) {
        return {
            authoritativeTargetTempC: forecastClamped,
            forecastTargetTempC: forecastClamped,
            reasonDe: input.forecastReasonDe || `Forecast-Ziel ${forecastClamped} °C.`,
            source: "forecast",
        };
    }
    return {
        authoritativeTargetTempC: min,
        forecastTargetTempC: null,
        reasonDe: `Sicherheits-Untergrenze ${min} °C (kein Forecast/Plan-Ziel).`,
        source: "safe_min",
    };
}
exports.resolveAuthoritativeThermalTarget = resolveAuthoritativeThermalTarget;
/**
 * Grobe Konsistenz: Energy-Headroom ↔ ΔT × kWh/°C (Default 0.38).
 * Toleranz für Learning-Marge / Rundung.
 */
function thermalEnergyMatchesTargetTemp(opts) {
    const k = opts.kwhPerDegreeC ?? 0.38;
    const delta = opts.effectiveTargetTempC - opts.bufferTempC;
    if (delta <= 0)
        return opts.requiredEnergyKwh <= (opts.toleranceKwh ?? 0.35);
    const expected = delta * k;
    const tol = opts.toleranceKwh ?? Math.max(0.5, expected * 0.35);
    return Math.abs(opts.requiredEnergyKwh - expected) <= tol;
}
exports.thermalEnergyMatchesTargetTemp = thermalEnergyMatchesTargetTemp;
