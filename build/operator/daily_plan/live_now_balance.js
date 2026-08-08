"use strict";
/**
 * Konsistente NOW-Slot-Bilanz: Live-PV und Live-Hauslast aus derselben Realwelt.
 * Zukunftsslots bleiben Forecast-only — kein Live-Floor mehr.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.applyLiveSurplusFloorToCurrentSlot = exports.slotBalanceIsConsistent = exports.applyLiveNowBalanceToCurrentSlot = exports.computeLiveNowBalanceW = exports.isLiveNowTelemetryUsable = exports.isPlausibleLivePowerW = exports.LIVE_NOW_MAX_AGE_SEC = void 0;
const surplus_1 = require("../planning/surplus");
const quality_1 = require("../quality");
/** Max. Alter Live-Telemetrie für NOW-Bilanz (Sekunden). */
exports.LIVE_NOW_MAX_AGE_SEC = 120;
function isPlausibleLivePowerW(powerW) {
    return powerW != null && Number.isFinite(powerW) && powerW >= 0 && powerW <= 100_000;
}
exports.isPlausibleLivePowerW = isPlausibleLivePowerW;
/** Live nur nutzbar wenn PV+HL gültig, plausibel und (falls bekannt) frisch. */
function isLiveNowTelemetryUsable(input) {
    if (!isPlausibleLivePowerW(input.pvPowerW) || !isPlausibleLivePowerW(input.houseLoadW)) {
        return false;
    }
    const maxAge = input.maxAgeSec ?? exports.LIVE_NOW_MAX_AGE_SEC;
    if (input.pvAgeSec != null && Number.isFinite(input.pvAgeSec) && input.pvAgeSec > maxAge) {
        return false;
    }
    if (input.houseAgeSec != null && Number.isFinite(input.houseAgeSec) && input.houseAgeSec > maxAge) {
        return false;
    }
    return true;
}
exports.isLiveNowTelemetryUsable = isLiveNowTelemetryUsable;
function computeLiveNowBalanceW(pvPowerW, houseLoadW) {
    const pv = Math.round(pvPowerW);
    const house = Math.round(houseLoadW);
    const balance = pv - house;
    const surplus = (0, surplus_1.computePvSurplusW)(pv, house) ?? 0;
    return {
        pvPowerW: pv,
        houseLoadPowerW: house,
        fixedBalancePowerW: balance,
        availablePvSurplusPowerW: surplus,
    };
}
exports.computeLiveNowBalanceW = computeLiveNowBalanceW;
/**
 * Schreibt die konsistente Live-Bilanz in den aktuellen Slot.
 * Mutiert `slots` in-place. Zukunftsslots bleiben unverändert.
 * @returns true wenn NOW auf Live gesetzt wurde.
 */
function applyLiveNowBalanceToCurrentSlot(slots, nowMs, live) {
    if (!isLiveNowTelemetryUsable(live))
        return false;
    const bal = computeLiveNowBalanceW(live.pvPowerW, live.houseLoadW);
    for (const slot of slots) {
        const start = Date.parse(slot.slot.startIso);
        const end = Date.parse(slot.slot.endIso);
        if (!Number.isFinite(start) || !Number.isFinite(end))
            continue;
        if (nowMs < start || nowMs >= end)
            continue;
        slot.pvForecastPowerW = bal.pvPowerW;
        slot.fixedHouseLoadPowerW = bal.houseLoadPowerW;
        slot.fixedBalancePowerW = bal.fixedBalancePowerW;
        slot.availablePvSurplusPowerW = bal.availablePvSurplusPowerW;
        slot.remainingPvSurplusPowerW = bal.availablePvSurplusPowerW;
        slot.quality = (0, quality_1.operatorQuality)("valid", "NOW-Slot: Live-PV und Live-Hauslast (konsistent).");
        slot.reasonDe = "NOW live-live Bilanz.";
        return true;
    }
    return false;
}
exports.applyLiveNowBalanceToCurrentSlot = applyLiveNowBalanceToCurrentSlot;
/**
 * Invariant: Slot ist entweder live-live oder forecast-forecast — nie gemischt.
 * Prüft: availablePvSurplus ≈ max(0, pv − house) wenn beide Komponenten gesetzt.
 */
function slotBalanceIsConsistent(slot) {
    const pv = slot.pvForecastPowerW;
    const house = slot.fixedHouseLoadPowerW;
    const bal = slot.fixedBalancePowerW;
    const avail = slot.availablePvSurplusPowerW;
    if (pv === null || house === null) {
        return bal === null && avail === null;
    }
    const expectBal = pv - house;
    const expectAvail = Math.max(0, expectBal);
    if (bal === null || avail === null)
        return false;
    return Math.abs(bal - expectBal) <= 1 && Math.abs(avail - expectAvail) <= 1;
}
exports.slotBalanceIsConsistent = slotBalanceIsConsistent;
/**
 * @deprecated Beta-Befund 002: ersetzt durch applyLiveNowBalanceToCurrentSlot.
 * Behält Signatur für Übergangs-Imports — wendet keinen Forecast/Live-Mix mehr an.
 */
function applyLiveSurplusFloorToCurrentSlot(slots, nowMs, liveSurplusW) {
    void liveSurplusW;
    void slots;
    void nowMs;
    // no-op: Mix-Floor entfernt — Aufrufer müssen applyLiveNowBalanceToCurrentSlot nutzen.
}
exports.applyLiveSurplusFloorToCurrentSlot = applyLiveSurplusFloorToCurrentSlot;
