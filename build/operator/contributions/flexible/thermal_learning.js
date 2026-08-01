"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildThermalLearningSignal = void 0;
const time_1 = require("../../../learning/house_load/time");
const math_1 = require("../../../learning/thermal_runtime/math");
const time_2 = require("../../time");
function parseByDayTypeJson(raw) {
    if (!raw)
        return null;
    try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object")
            return parsed;
    }
    catch {
        // ignore
    }
    return null;
}
/**
 * `status`/`health` kommen direkt aus `runThermalRuntimeLearning` (`src/learning/thermal_runtime/run.ts`).
 * `ready`+`ok` → valid. `insufficient_data` oder `health === "degraded"` → degraded (noch genutzbar,
 * aber wenige Zyklen). Alles andere (kein Source, deaktiviert, ungültige Config, Fehler) → missing.
 */
function deriveStatus(rawStatus, rawHealth) {
    if (rawStatus === "ready" && rawHealth === "ok")
        return "valid";
    if (rawStatus === "ready" && rawHealth === "degraded")
        return "degraded";
    if (rawStatus === "insufficient_data")
        return "degraded";
    return "missing";
}
function reasonDeForStatus(status, samples, estimatedEmptyAt, timezone) {
    if (status === "valid") {
        const local = estimatedEmptyAt !== null ? (0, time_2.formatLocalDateTimeDe)(estimatedEmptyAt, timezone) : null;
        return local
            ? `Thermal-Runtime-Learning aktiv (${samples ?? 0} Zyklen) — Puffer voraussichtlich leer um ${local}.`
            : `Thermal-Runtime-Learning aktiv (${samples ?? 0} Zyklen).`;
    }
    if (status === "degraded") {
        return `Thermal-Runtime-Learning mit wenigen Zyklen (${samples ?? 0}) — eingeschränkt belastbar.`;
    }
    return "Thermal-Runtime-Learning ohne belastbares Modell — Fallback auf Physik-Schätzung.";
}
function buildThermalLearningSignal(input) {
    const status = deriveStatus(input.rawStatus, input.rawHealth);
    const timezone = input.timezone?.trim() || "Europe/Berlin";
    let estimatedEmptyAt = null;
    if (input.estimatedEmptyAtRaw) {
        const ms = Date.parse(input.estimatedEmptyAtRaw);
        if (Number.isFinite(ms) && ms > input.now.getTime()) {
            estimatedEmptyAt = new Date(ms).toISOString();
        }
    }
    // Reststunden immer live aus empty_at — der State-Snapshot altert zwischen Learning-Läufen.
    const liveRemaining = (0, math_1.liveRemainingHoursFromEmptyAt)(estimatedEmptyAt, input.now);
    const estimatedRemainingHours = liveRemaining !== null
        ? liveRemaining
        : estimatedEmptyAt === null && input.estimatedEmptyAtRaw
            ? 0 // empty_at in der Vergangenheit / verworfen
            : input.estimatedRemainingHours;
    const byDayType = parseByDayTypeJson(input.byDayTypeJsonRaw);
    const currentDayType = (0, time_1.dayTypeFromWeekday)((0, time_1.weekdayFromDate)(input.now));
    const currentGroup = byDayType?.[currentDayType];
    const currentDayTypeRuntimeHoursMedian = typeof currentGroup?.runtime_hours_median === "number" && Number.isFinite(currentGroup.runtime_hours_median)
        ? currentGroup.runtime_hours_median
        : null;
    if (status === "missing") {
        return {
            status,
            health: input.rawHealth,
            samples: input.samples,
            coolingRateCPerHAvg: null,
            coolingConstantPerH: null,
            coolingAsymptoteC: null,
            estimatedRemainingHours: null,
            estimatedEmptyAt: null,
            currentDayTypeRuntimeHoursMedian: null,
            reasonDe: reasonDeForStatus(status, input.samples, null, timezone),
        };
    }
    return {
        status,
        health: input.rawHealth,
        samples: input.samples,
        coolingRateCPerHAvg: input.coolingRateCPerHAvg,
        coolingConstantPerH: input.coolingConstantPerH,
        coolingAsymptoteC: input.coolingAsymptoteC,
        estimatedRemainingHours,
        estimatedEmptyAt,
        currentDayTypeRuntimeHoursMedian,
        reasonDe: reasonDeForStatus(status, input.samples, estimatedEmptyAt, timezone),
    };
}
exports.buildThermalLearningSignal = buildThermalLearningSignal;
