"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveThermalForecastTarget = void 0;
/**
 * Soft-Pufferziel zwischen aktuellem Puffer und Puffer-Max.
 * planningMinTempC ist kein Warmwasser-Hard und kein tägliches Boiler-Hochheizen.
 */
function softFloorC(config, bufferTempC) {
    if (bufferTempC !== null && Number.isFinite(bufferTempC)) {
        return Math.min(config.planningMaxTempC, Math.max(0, bufferTempC));
    }
    /** Ohne Sensor: legacy Soft-Floor nur als Span-Basis, nie Hard. */
    return config.planningMinTempC;
}
function targetFromFraction(config, fraction, bufferTempC) {
    const floor = softFloorC(config, bufferTempC);
    const span = config.planningMaxTempC - floor;
    if (span <= 0)
        return config.planningMaxTempC;
    return Math.round((floor + span * fraction) * 10) / 10;
}
function clampSoftTarget(config, bufferTempC, targetC) {
    const floor = softFloorC(config, bufferTempC);
    return Math.min(config.planningMaxTempC, Math.max(floor, targetC));
}
/**
 * Regelbasiertes Soft-Tagesziel für den Puffer (Phase B).
 * Boiler wird hier nicht künstlich hochgeheizt — nur Puffer Soft zwischen Ist und Max.
 */
function resolveThermalForecastTarget(input) {
    const { config } = input;
    const max = config.planningMaxTempC;
    const buffer = input.bufferTempC;
    if (!input.forecastModeEnabled) {
        return {
            targetTempC: max,
            targetReasonDe: "Forecast-Modus aus — Soft-Ziel = Puffer-Max.",
            forecastActive: false,
        };
    }
    const today = input.pvTodayKwh;
    const tomorrow = input.pvTomorrowKwh;
    const hasPvForecast = today !== null &&
        today > 0 &&
        tomorrow !== null &&
        tomorrow >= 0 &&
        input.pvBiasStatus !== "disabled" &&
        input.pvBiasStatus !== "no_config";
    if (!hasPvForecast) {
        const target = clampSoftTarget(config, buffer, max - config.forecastNoDataOffsetC);
        return {
            targetTempC: target,
            targetReasonDe: `Keine PV-Prognose — konservatives Soft-Pufferziel ${target} °C.`,
            forecastActive: true,
        };
    }
    if (tomorrow < today * config.forecastLowTomorrowRatio) {
        return {
            targetTempC: max,
            targetReasonDe: `PV morgen (${tomorrow.toFixed(1)} kWh) deutlich unter heute (${today.toFixed(1)} kWh) — Soft-Puffer voll (${max} °C).`,
            forecastActive: true,
        };
    }
    if (tomorrow >= today * config.forecastHighTomorrowRatio) {
        const target = targetFromFraction(config, config.forecastTargetFractionModerate, buffer);
        return {
            targetTempC: target,
            targetReasonDe: `PV morgen (${tomorrow.toFixed(1)} kWh) ähnlich/höher wie heute (${today.toFixed(1)} kWh) — moderates Soft-Ziel ${target} °C.`,
            forecastActive: true,
        };
    }
    const target = targetFromFraction(config, config.forecastTargetFractionDefault, buffer);
    return {
        targetTempC: target,
        targetReasonDe: `Standard Soft-Pufferziel ${target} °C (PV heute ${today.toFixed(1)}, morgen ${tomorrow.toFixed(1)} kWh).`,
        forecastActive: true,
    };
}
exports.resolveThermalForecastTarget = resolveThermalForecastTarget;
