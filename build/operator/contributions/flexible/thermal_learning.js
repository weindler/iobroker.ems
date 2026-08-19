"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildThermalLearningSignal = void 0;
const time_1 = require("../../../learning/house_load/time");
const constants_1 = require("../../../learning/thermal_runtime/constants");
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
 * `ready`+`ok` → valid nur mit genug Zyklen (`MIN_CYCLES_OK`).
 * Newton-Fit ohne Peak→Floor-Zyklen bleibt status=degraded (kein falsches „cycle-valid“),
 * empty_at kann trotzdem planungswirksam sein (`thermal_empty_at.ts`, A1).
 * `insufficient_data` / wenige Samples → degraded. Alles andere → missing.
 */
function deriveStatus(rawStatus, rawHealth, samples) {
    const n = samples !== null && Number.isFinite(samples) ? samples : 0;
    if (rawStatus === "ready" && rawHealth === "ok") {
        return n >= constants_1.MIN_CYCLES_OK ? "valid" : "degraded";
    }
    if (rawStatus === "ready" && rawHealth === "degraded")
        return "degraded";
    if (rawStatus === "insufficient_data")
        return "degraded";
    return "missing";
}
function reasonDeForStatus(status, samples, estimatedEmptyAt, timezone, vessel, overdueNowMs) {
    const label = vessel === "boiler" ? "Boiler-Learning" : "Puffer-Learning";
    const reach = vessel === "boiler" ? "Boiler" : "Puffer";
    const isOverdue = estimatedEmptyAt !== null &&
        overdueNowMs != null &&
        Date.parse(estimatedEmptyAt) <= overdueNowMs;
    if (status === "valid") {
        const local = estimatedEmptyAt !== null ? (0, time_2.formatLocalDateTimeDe)(estimatedEmptyAt, timezone) : null;
        if (local && isOverdue) {
            return `${label} aktiv (${samples ?? 0} Zyklen) — ${reach} Mindesttemperatur bereits erreicht (seit ${local}).`;
        }
        return local
            ? `${label} aktiv (${samples ?? 0} Zyklen) — ${reach} voraussichtlich leer um ${local}.`
            : `${label} aktiv (${samples ?? 0} Zyklen).`;
    }
    if (status === "degraded") {
        const n = samples ?? 0;
        if (n === 0 && estimatedEmptyAt) {
            const local = (0, time_2.formatLocalDateTimeDe)(estimatedEmptyAt, timezone);
            if (isOverdue) {
                return `${label}: Newton-Schätzung — ${reach} Mindesttemperatur bereits erreicht (seit ${local}), ${n} abgeschlossene Abkühlzyklen — Status degraded (nicht cycle-valid).`;
            }
            return `${label}: Newton-Schätzung nutzbar, ${n} abgeschlossene Abkühlzyklen — Status degraded (nicht cycle-valid).`;
        }
        return `${label} mit wenigen Zyklen (${n}) — eingeschränkt belastbar.`;
    }
    return `${label} ohne belastbares Modell — Fallback auf Physik-Schätzung.`;
}
function buildThermalLearningSignal(input) {
    const status = deriveStatus(input.rawStatus, input.rawHealth, input.samples);
    const timezone = input.timezone?.trim() || "Europe/Berlin";
    const vessel = input.vessel === "boiler" ? "boiler" : "buffer";
    const nowMs = input.now.getTime();
    /*
     * Überfällig ≠ veraltet: Ein frisch gelerntes empty_at, das gerade erreicht wird
     * (Boiler jetzt am Minimum), ist die akute Pflichtinformation, die der Planner
     * braucht — nicht verwerfen. Nur wirklich alte Schätzungen (Learning lief lange
     * nicht neu) gelten als stale und werden verworfen (kein ewiger Fake-Alarm).
     */
    const MAX_OVERDUE_HOURS = 12;
    let estimatedEmptyAt = null;
    if (input.estimatedEmptyAtRaw) {
        const ms = Date.parse(input.estimatedEmptyAtRaw);
        if (Number.isFinite(ms)) {
            const overdueHours = (nowMs - ms) / constants_1.MS_PER_HOUR;
            if (overdueHours <= MAX_OVERDUE_HOURS) {
                estimatedEmptyAt = new Date(ms).toISOString();
            }
        }
    }
    // Reststunden immer live aus empty_at — der State-Snapshot altert zwischen Learning-Läufen.
    const liveRemaining = (0, math_1.liveRemainingHoursFromEmptyAt)(estimatedEmptyAt, input.now);
    const estimatedRemainingHours = liveRemaining !== null
        ? liveRemaining
        : estimatedEmptyAt === null && input.estimatedEmptyAtRaw
            ? 0 // empty_at verworfen (ungültig oder zu lange überfällig/stale)
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
            reasonDe: reasonDeForStatus(status, input.samples, null, timezone, vessel),
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
        reasonDe: reasonDeForStatus(status, input.samples, estimatedEmptyAt, timezone, vessel, nowMs),
    };
}
exports.buildThermalLearningSignal = buildThermalLearningSignal;
