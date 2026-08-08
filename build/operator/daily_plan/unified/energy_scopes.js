"use strict";
/**
 * Zeitliche Energie-Scopes für Unified Planning.
 *
 * Day     = lokaler Kalendertag (EMS-Zeitzone), nicht now+24h
 * Goal    = bis konkreter Deadline (darf Mitternacht überschreiten)
 * Horizon = vollständiger belastbarer Unified-Planungshorizont (~bis 7 Tage)
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.localDateKeyFromIso = exports.sumEnergyHorizon = exports.sumEnergyToDeadline = exports.sumEnergyForLocalDay = exports.localDayBoundsMs = exports.energyOverlapKwh = void 0;
const slots_1 = require("../slots");
const time_1 = require("../../time");
/** Anteil der Slot-Energie, der im Intervall [rangeStartMs, rangeEndMs) liegt. */
function energyOverlapKwh(startIso, endIso, energyKwh, rangeStartMs, rangeEndMs) {
    if (!Number.isFinite(energyKwh) || energyKwh === 0)
        return 0;
    const s = Date.parse(startIso);
    const e = Date.parse(endIso);
    if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s)
        return 0;
    // ±Infinity erlaubt (offene Intervalle); NaN nicht.
    if (Number.isNaN(rangeStartMs) || Number.isNaN(rangeEndMs) || rangeEndMs <= rangeStartMs) {
        return 0;
    }
    const overlapStart = Math.max(s, rangeStartMs);
    const overlapEnd = Math.min(e, rangeEndMs);
    if (overlapEnd <= overlapStart)
        return 0;
    return energyKwh * ((overlapEnd - overlapStart) / (e - s));
}
exports.energyOverlapKwh = energyOverlapKwh;
function localDayBoundsMs(dateKey, timezone) {
    const startMs = Date.parse((0, time_1.isoAtTimezoneLocal)(dateKey, 0, 0, timezone));
    const endMs = Date.parse((0, slots_1.endOfLocalDayIso)(dateKey, timezone));
    return { startMs, endMs };
}
exports.localDayBoundsMs = localDayBoundsMs;
/** Day Scope: Summe der Slot-Energie im lokalen Kalendertag (anteilig an Grenzen). */
function sumEnergyForLocalDay(slots, dateKey, timezone) {
    const { startMs, endMs } = localDayBoundsMs(dateKey, timezone);
    let sum = 0;
    for (const s of slots) {
        const e = s.energyKwh;
        if (e === null || e === undefined || !Number.isFinite(e))
            continue;
        sum += energyOverlapKwh(s.slot.startIso, s.slot.endIso, e, startMs, endMs);
    }
    return Math.round(sum * 1000) / 1000;
}
exports.sumEnergyForLocalDay = sumEnergyForLocalDay;
/** Goal Scope: Summe bis Deadline (Slot-Start < deadline; anteilig wenn Slot über Deadline geht). */
function sumEnergyToDeadline(slots, deadlineIso) {
    if (!deadlineIso)
        return null;
    const deadlineMs = Date.parse(deadlineIso);
    if (!Number.isFinite(deadlineMs))
        return null;
    let sum = 0;
    for (const s of slots) {
        const e = s.energyKwh;
        if (e === null || e === undefined || !Number.isFinite(e))
            continue;
        const slotStart = Date.parse(s.slot.startIso);
        if (!Number.isFinite(slotStart) || slotStart >= deadlineMs)
            continue;
        sum += energyOverlapKwh(s.slot.startIso, s.slot.endIso, e, Number.NEGATIVE_INFINITY, deadlineMs);
    }
    return Math.round(sum * 1000) / 1000;
}
exports.sumEnergyToDeadline = sumEnergyToDeadline;
/** Horizon Scope: Summe aller gegebenen Slots (z. B. Rest-Horizon nach Trim). */
function sumEnergyHorizon(slots) {
    let sum = 0;
    for (const s of slots) {
        const e = s.energyKwh;
        if (e === null || e === undefined || !Number.isFinite(e))
            continue;
        sum += e;
    }
    return Math.round(sum * 1000) / 1000;
}
exports.sumEnergyHorizon = sumEnergyHorizon;
function localDateKeyFromIso(iso, timezone) {
    const ms = Date.parse(iso);
    if (!Number.isFinite(ms))
        return iso.slice(0, 10);
    return (0, time_1.localDateKeyInTimezone)(new Date(ms), timezone);
}
exports.localDateKeyFromIso = localDateKeyFromIso;
