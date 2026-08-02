"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.applyLiveSurplusFloorToCurrentSlot = exports.buildOperatorLiveSurplus = void 0;
const battery_1 = require("../planning/battery");
const surplus_1 = require("../planning/surplus");
const slots_1 = require("./slots");
function buildOperatorLiveSurplus(input) {
    const { pvPowerW, houseLoadW, now, timezone } = input;
    const slotStartIso = (0, slots_1.slotStartIsoFloored)(now, timezone);
    return {
        pvPowerW,
        houseLoadW,
        surplusW: (0, surplus_1.computePvSurplusW)(pvPowerW, houseLoadW),
        deficitW: (0, battery_1.computeDeficitW)(pvPowerW, houseLoadW),
        slotStartIso: slotStartIso || null,
        status: pvPowerW !== null && houseLoadW !== null ? "valid" : "missing",
    };
}
exports.buildOperatorLiveSurplus = buildOperatorLiveSurplus;
/**
 * Hebt den aktuellen Horizont-Slot auf den Live-PV-Überschuss an, wenn der Forecast zu niedrig
 * liegt (morgens oft). Nur Floor nach oben — nie Forecast absenken. Mutiert `slots` in-place.
 */
function applyLiveSurplusFloorToCurrentSlot(slots, nowMs, liveSurplusW) {
    if (liveSurplusW === null || !Number.isFinite(liveSurplusW) || liveSurplusW <= 0)
        return;
    const floor = Math.round(liveSurplusW);
    for (const slot of slots) {
        const start = Date.parse(slot.slot.startIso);
        const end = Date.parse(slot.slot.endIso);
        if (!Number.isFinite(start) || !Number.isFinite(end))
            continue;
        if (nowMs < start || nowMs >= end)
            continue;
        const forecast = slot.availablePvSurplusPowerW;
        const next = forecast === null ? floor : Math.max(forecast, floor);
        slot.availablePvSurplusPowerW = next;
        slot.remainingPvSurplusPowerW = next;
        if (slot.fixedBalancePowerW !== null) {
            slot.fixedBalancePowerW = Math.max(slot.fixedBalancePowerW, floor);
        }
        return;
    }
}
exports.applyLiveSurplusFloorToCurrentSlot = applyLiveSurplusFloorToCurrentSlot;
