"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildBatteryLearningSignal = void 0;
/**
 * `status` kommt direkt aus `runBatteryRuntimeLearning` (`src/learning/battery_runtime/run.ts`).
 * `ready` → valid. `insufficient_data`/`partial` → degraded (nutzbar, aber wenig Historie).
 * `no_source`/`disabled`/`error`/unbekannt → missing.
 */
function deriveStatus(rawStatus) {
    if (rawStatus === "ready")
        return "valid";
    if (rawStatus === "insufficient_data" || rawStatus === "partial")
        return "degraded";
    return "missing";
}
function reasonDeForStatus(status, sampleDays) {
    if (status === "valid")
        return `Battery-Runtime-Learning aktiv (${sampleDays ?? 0} Tage Historie).`;
    if (status === "degraded")
        return `Battery-Runtime-Learning mit wenig Historie (${sampleDays ?? 0} Tage).`;
    return "Battery-Runtime-Learning ohne belastbares Modell — Fallback auf bestehende Policy/Intent.";
}
function buildBatteryLearningSignal(input) {
    const status = deriveStatus(input.rawStatus);
    if (status === "missing") {
        return {
            status,
            sampleDays: input.sampleDays,
            avgNightDischargeKwh: null,
            avgChargePowerW: null,
            maxChargePowerW: null,
            topoffDue: null,
            topoffDaysRemaining: null,
            estimatedRuntimeDays: null,
            reasonDe: reasonDeForStatus(status, input.sampleDays),
        };
    }
    const topoffDue = input.topoffDueRaw === null || input.topoffDueRaw === undefined ? null : input.topoffDueRaw === 1;
    return {
        status,
        sampleDays: input.sampleDays,
        avgNightDischargeKwh: input.avgNightDischargeKwh,
        avgChargePowerW: input.avgChargePowerW,
        maxChargePowerW: input.maxChargePowerW,
        topoffDue,
        topoffDaysRemaining: input.topoffDaysRemaining,
        estimatedRuntimeDays: input.estimatedRuntimeDays,
        reasonDe: reasonDeForStatus(status, input.sampleDays),
    };
}
exports.buildBatteryLearningSignal = buildBatteryLearningSignal;
