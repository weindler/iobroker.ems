"use strict";
/**
 * Zentrale Energie-Delta-/Integrationslogik für Tages-Telemetrie.
 *
 * - Zähler: volle Number-Präzision (kein early round3 wie energyCounterDeltaKwh)
 * - Leistung: powerW × Δt, anteilig über Slotgrenzen
 * - Lange Gaps: kein Erfinden von Konstantleistung
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.applySharesToBucket = exports.addToBucket = exports.decideIntegrationGap = exports.integratePowerAcrossSlots = exports.splitAmountAcrossSlots = exports.roundTelemetryKwh = exports.energyCounterDeltaPreciseKwh = void 0;
const constants_1 = require("./constants");
const slots_1 = require("./slots");
/** Präzises Zähler-Delta — Round erst bei Persistenz, nicht vor Akkumulation. */
function energyCounterDeltaPreciseKwh(previous, current) {
    if (current === null || !Number.isFinite(current)) {
        return { deltaKwh: null, newBaseline: previous, reset: false };
    }
    if (previous === null || !Number.isFinite(previous)) {
        return { deltaKwh: 0, newBaseline: current, reset: false };
    }
    if (current + 0.05 < previous) {
        return { deltaKwh: 0, newBaseline: current, reset: true };
    }
    return { deltaKwh: current - previous, newBaseline: current, reset: false };
}
exports.energyCounterDeltaPreciseKwh = energyCounterDeltaPreciseKwh;
function roundTelemetryKwh(kwh) {
    const f = 10 ** constants_1.DAY_TELEMETRY_KWH_DECIMALS;
    return Math.round(kwh * f) / f;
}
exports.roundTelemetryKwh = roundTelemetryKwh;
/**
 * Verteilt amountKwh proportional zur Zeitüberlappung auf alle betroffenen Slots.
 * Beispiel 14:14:45–14:15:45 → Anteile an beiden 15-Min-Slots.
 */
function splitAmountAcrossSlots(layout, fromMs, toMs, amountKwh) {
    if (!Number.isFinite(amountKwh) || !(toMs > fromMs))
        return [];
    const span = toMs - fromMs;
    const overlaps = (0, slots_1.overlappingSlotIndices)(layout, fromMs, toMs);
    const out = [];
    for (const s of overlaps) {
        const overlapStart = Math.max(s.startMs, fromMs);
        const overlapEnd = Math.min(s.endMs, toMs);
        const overlapMs = overlapEnd - overlapStart;
        if (overlapMs <= 0)
            continue;
        out.push({
            slotIndex: s.index,
            energyKwh: amountKwh * (overlapMs / span),
            overlapMs,
        });
    }
    return out;
}
exports.splitAmountAcrossSlots = splitAmountAcrossSlots;
/** powerW × Δt → kWh, dann split. */
function integratePowerAcrossSlots(layout, fromMs, toMs, powerW) {
    if (!Number.isFinite(powerW) || !(toMs > fromMs))
        return [];
    const hours = (toMs - fromMs) / 3_600_000;
    const kwh = (powerW * hours) / 1000;
    return splitAmountAcrossSlots(layout, fromMs, toMs, kwh);
}
exports.integratePowerAcrossSlots = integratePowerAcrossSlots;
/**
 * Entscheidet, ob ein Messintervall integriert werden darf.
 * Lange Gaps → missing, keine Konstantleistungs-Annahme.
 */
function decideIntegrationGap(prevTs, curTs, maxGapMs = constants_1.DAY_TELEMETRY_MAX_GAP_MS) {
    if (!Number.isFinite(curTs))
        return { kind: "invalid" };
    if (prevTs === null || !Number.isFinite(prevTs))
        return { kind: "first_sample" };
    if (curTs <= prevTs)
        return { kind: "invalid" };
    const gap = curTs - prevTs;
    if (gap > maxGapMs)
        return { kind: "gap_too_long", gapMs: gap };
    return { kind: "ok", fromMs: prevTs, toMs: curTs };
}
exports.decideIntegrationGap = decideIntegrationGap;
/** Addiert energyKwh in ein Bucket-Array (null → Wert, sonst Summe). */
function addToBucket(arr, index, energyKwh) {
    if (index < 0 || index >= arr.length || !Number.isFinite(energyKwh))
        return;
    const prev = arr[index];
    arr[index] = prev === null ? energyKwh : prev + energyKwh;
}
exports.addToBucket = addToBucket;
function applySharesToBucket(arr, shares) {
    for (const s of shares) {
        addToBucket(arr, s.slotIndex, s.energyKwh);
    }
}
exports.applySharesToBucket = applySharesToBucket;
