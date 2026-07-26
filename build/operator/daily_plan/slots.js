"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DAILY_PLAN_SLOT_MS = exports.minPowerForDeadline = exports.slotsUntilDeadline = exports.powerWFromEnergyKwh = exports.energyKwhFromPower = exports.slotDurationHours = exports.slotKey = exports.buildDailyHorizonSlots = exports.DAILY_PLAN_HORIZON_HOURS = exports.endOfLocalDayIso = exports.slotStartIsoFloored = exports.floorMinuteTo15 = void 0;
const time_1 = require("../time");
function floorMinuteTo15(minute) {
    return Math.floor(minute / 15) * 15;
}
exports.floorMinuteTo15 = floorMinuteTo15;
function slotStartIsoFloored(now, timezone) {
    const ms = now.getTime();
    const fmt = new Intl.DateTimeFormat("en-US", {
        timeZone: timezone,
        hour12: false,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
    });
    const parts = fmt.formatToParts(now);
    const pick = (type) => parseInt(parts.find((p) => p.type === type)?.value ?? "0", 10);
    const dateKey = `${pick("year")}-${String(pick("month")).padStart(2, "0")}-${String(pick("day")).padStart(2, "0")}`;
    return (0, time_1.isoAtTimezoneLocal)(dateKey, pick("hour"), floorMinuteTo15(pick("minute")), timezone);
}
exports.slotStartIsoFloored = slotStartIsoFloored;
function endOfLocalDayIso(dateKey, timezone) {
    return (0, time_1.isoAtTimezoneLocal)((0, time_1.addDaysToDateKey)(dateKey, 1), 0, 0, timezone);
}
exports.endOfLocalDayIso = endOfLocalDayIso;
/**
 * Rolling Daily-Plan-Horizont (Roadmap Block 5): mindestens 48 h ab aktuellem 15-Min-Floor.
 * Alle flexiblen Add-ons lesen denselben Plan — kein addon-spezifischer Horizont.
 */
exports.DAILY_PLAN_HORIZON_HOURS = 48;
function buildDailyHorizonSlots(now, timezone, slotMinutes = 15, horizonHours = exports.DAILY_PLAN_HORIZON_HOURS) {
    const startIso = slotStartIsoFloored(now, timezone);
    if (!(0, time_1.isValidIsoTimestamp)(startIso))
        return [];
    const hours = Number.isFinite(horizonHours) && horizonHours > 0 ? horizonHours : exports.DAILY_PLAN_HORIZON_HOURS;
    const slotMs = slotMinutes * 60_000;
    let cursor = Date.parse(startIso);
    const endMs = cursor + hours * 3_600_000;
    const out = [];
    while (cursor < endMs) {
        const next = cursor + slotMs;
        out.push({ startIso: (0, time_1.isoFromMs)(cursor), endIso: (0, time_1.isoFromMs)(next) });
        cursor = next;
    }
    return out;
}
exports.buildDailyHorizonSlots = buildDailyHorizonSlots;
function slotKey(startIso, endIso) {
    return `${startIso}|${endIso}`;
}
exports.slotKey = slotKey;
function slotDurationHours(slotMinutes) {
    return slotMinutes / 60;
}
exports.slotDurationHours = slotDurationHours;
function energyKwhFromPower(powerW, slotMinutes) {
    return Math.round((powerW * slotDurationHours(slotMinutes)) / 1000 * 1000) / 1000;
}
exports.energyKwhFromPower = energyKwhFromPower;
function powerWFromEnergyKwh(energyKwh, slotMinutes) {
    const hours = slotDurationHours(slotMinutes);
    if (hours <= 0)
        return 0;
    return Math.ceil((energyKwh * 1000) / hours);
}
exports.powerWFromEnergyKwh = powerWFromEnergyKwh;
function slotsUntilDeadline(slots, deadlineIso, nowMs) {
    const deadlineMs = Date.parse(deadlineIso);
    if (!Number.isFinite(deadlineMs))
        return slots;
    return slots.filter((s) => {
        const start = Date.parse(s.startIso);
        return Number.isFinite(start) && start >= nowMs && start < deadlineMs;
    });
}
exports.slotsUntilDeadline = slotsUntilDeadline;
function minPowerForDeadline(remainingEnergyKwh, slots, slotMinutes, maxPowerW) {
    if (remainingEnergyKwh <= 0)
        return 0;
    if (slots.length === 0)
        return null;
    const hours = slots.length * slotDurationHours(slotMinutes);
    if (hours <= 0)
        return null;
    const needW = Math.ceil((remainingEnergyKwh * 1000) / hours);
    if (maxPowerW !== null)
        return Math.min(needW, maxPowerW);
    return needW;
}
exports.minPowerForDeadline = minPowerForDeadline;
exports.DAILY_PLAN_SLOT_MS = time_1.OPERATOR_MS_PER_15MIN;
