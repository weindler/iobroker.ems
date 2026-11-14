"use strict";
/** PV-Überschuss-Schätzung für Planner MVP. */
Object.defineProperty(exports, "__esModule", { value: true });
exports.computePvSurplusW = computePvSurplusW;
exports.surplusAfterLoadW = surplusAfterLoadW;
function computePvSurplusW(pvPowerW, houseLoadW) {
    if (pvPowerW === null || houseLoadW === null)
        return null;
    if (!Number.isFinite(pvPowerW) || !Number.isFinite(houseLoadW))
        return null;
    return Math.max(0, Math.round(pvPowerW - houseLoadW));
}
function surplusAfterLoadW(surplusW, allocatedW) {
    return Math.max(0, Math.round(surplusW - allocatedW));
}
