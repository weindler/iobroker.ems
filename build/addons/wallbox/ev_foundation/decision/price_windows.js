"use strict";
/**
 * Neutral price-window fallback. No vendor parsers here — callers pass already-normalized windows.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.evaluatePriceWindows = exports.priceWindowsFrom15MinSlots = void 0;
const time_1 = require("../../../../operator/time");
const energy_1 = require("./energy");
function priceWindowsFrom15MinSlots(slots) {
    return slots
        .filter((s) => Number.isFinite(s.slotStartMs) && Number.isFinite(s.priceCtPerKwh))
        .map((s) => ({
        startMs: s.slotStartMs,
        endMs: s.slotStartMs + time_1.OPERATOR_MS_PER_15MIN,
        importCtPerKwh: s.priceCtPerKwh,
    }));
}
exports.priceWindowsFrom15MinSlots = priceWindowsFrom15MinSlots;
function median(values) {
    if (values.length === 0)
        return null;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 0) {
        return (sorted[mid - 1] + sorted[mid]) / 2;
    }
    return sorted[mid];
}
function overlapHours(a0, a1, b0, b1) {
    const lo = Math.max(a0, b0);
    const hi = Math.min(a1, b1);
    if (!(hi > lo))
        return 0;
    return (hi - lo) / 3_600_000;
}
function energyInRange(windows, fromMs, toMs, chargePowerKw, cheapMaxCt) {
    let kwh = 0;
    for (const w of windows) {
        if (cheapMaxCt != null && w.importCtPerKwh > cheapMaxCt + 1e-9)
            continue;
        const hours = overlapHours(w.startMs, w.endMs, fromMs, toMs);
        if (hours > 0)
            kwh += chargePowerKw * hours;
    }
    return (0, energy_1.roundKwh)(kwh);
}
function pricesDiffer(prices) {
    if (prices.length === 0)
        return false;
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    return max - min > 0.05;
}
/**
 * Physical remaining energy = power × hours until a real deadline.
 * Cheap energy uses slots at or below the remaining-window median.
 * Without a deadline, feasible/cheap until-deadline figures stay null (not fake 0).
 */
function evaluatePriceWindows(input) {
    const empty = {
        remainingFeasibleEnergyKWh: null,
        remainingCheapEnergyKWh: null,
        cheapWindowEnergyCapacityKWh: null,
        cheapEnergyAfterLatestStartKWh: null,
        lostCheapEnergyKWh: null,
        medianPriceCtPerKwh: null,
        economicWindowLossRisk: false,
    };
    if (input.deadlineMs == null || input.deadlineMs <= input.nowMs) {
        return { ...empty, economicWindowLossRisk: false };
    }
    const deadlineMs = input.deadlineMs;
    if (input.chargePowerKw == null || input.chargePowerKw <= 0) {
        return { ...empty, economicWindowLossRisk: null };
    }
    const hoursLeft = (deadlineMs - input.nowMs) / 3_600_000;
    const remainingFeasibleEnergyKWh = (0, energy_1.roundKwh)(input.chargePowerKw * hoursLeft);
    const remainingWindows = input.windows.filter((w) => w.endMs > input.nowMs && w.startMs < deadlineMs);
    const remainingPrices = remainingWindows.map((w) => w.importCtPerKwh);
    const uniquePrices = [...new Set(remainingPrices.map((p) => Math.round(p * 100) / 100))].sort((a, b) => a - b);
    const medianPriceCtPerKwh = median(uniquePrices);
    const cheapMax = medianPriceCtPerKwh;
    const remainingCheapEnergyKWh = cheapMax == null
        ? null
        : energyInRange(remainingWindows, input.nowMs, deadlineMs, input.chargePowerKw, cheapMax);
    const cheapWindowEnergyCapacityKWh = remainingCheapEnergyKWh;
    let cheapEnergyAfterLatestStartKWh = null;
    let lostCheapEnergyKWh = null;
    if (input.latestRequiredStartMs != null && cheapMax != null) {
        const latest = Math.max(input.latestRequiredStartMs, input.nowMs);
        cheapEnergyAfterLatestStartKWh = energyInRange(remainingWindows, latest, deadlineMs, input.chargePowerKw, cheapMax);
        lostCheapEnergyKWh = energyInRange(remainingWindows, input.nowMs, Math.min(latest, deadlineMs), input.chargePowerKw, cheapMax);
    }
    let economicWindowLossRisk = false;
    const need = input.energyNeededKWh;
    if (need == null) {
        economicWindowLossRisk = false;
    }
    else if (input.deadlineRisk === true) {
        economicWindowLossRisk = false;
    }
    else if (need <= 0) {
        economicWindowLossRisk = false;
    }
    else if (remainingCheapEnergyKWh == null || !pricesDiffer(uniquePrices)) {
        economicWindowLossRisk = false;
    }
    else if (remainingFeasibleEnergyKWh + 0.05 < need) {
        economicWindowLossRisk = false;
    }
    else if (remainingCheapEnergyKWh + 0.05 < need) {
        economicWindowLossRisk = true;
    }
    else if (input.latestRequiredStartMs != null &&
        lostCheapEnergyKWh != null &&
        lostCheapEnergyKWh > 0.05 &&
        cheapEnergyAfterLatestStartKWh != null &&
        cheapEnergyAfterLatestStartKWh + 0.05 < need) {
        economicWindowLossRisk = true;
    }
    return {
        remainingFeasibleEnergyKWh,
        remainingCheapEnergyKWh,
        cheapWindowEnergyCapacityKWh,
        cheapEnergyAfterLatestStartKWh,
        lostCheapEnergyKWh,
        medianPriceCtPerKwh,
        economicWindowLossRisk,
    };
}
exports.evaluatePriceWindows = evaluatePriceWindows;
