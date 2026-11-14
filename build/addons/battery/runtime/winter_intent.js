"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseWinterWindowsJson = parseWinterWindowsJson;
exports.deviceIntentFromWinterPlanner = deviceIntentFromWinterPlanner;
exports.winterNumOrNull = numOrNull;
const battery_winter_windows_1 = require("../../../operator/planning/battery_winter_windows");
function numOrNull(v) {
    if (v === null || v === undefined || v === "" || v === -1)
        return null;
    const n = typeof v === "number" ? v : parseFloat(String(v));
    return Number.isFinite(n) ? n : null;
}
function parseWinterWindowsJson(raw) {
    if (!raw)
        return [];
    try {
        const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
        if (!Array.isArray(parsed))
            return [];
        return parsed.filter((w) => w != null &&
            typeof w === "object" &&
            typeof w.start_iso === "string" &&
            typeof w.end_iso === "string");
    }
    catch {
        return [];
    }
}
function deviceIntentFromWinterPlanner(snap, nowMs) {
    if (!snap.active || snap.maxChargeW <= 0)
        return null;
    const window = (0, battery_winter_windows_1.isNowInWinterChargeWindow)(nowMs, snap.windows);
    if (!window)
        return null;
    return {
        requestId: `winter-planner-${snap.revision}`,
        action: "grid_charge",
        targetSocPct: snap.socTargetPct,
        maxChargeW: snap.maxChargeW,
        maxDischargeW: null,
        energySource: "grid",
        validFrom: window.start_iso,
        validUntil: window.end_iso,
        issuedAt: new Date(nowMs).toISOString(),
        reason: `Winter-Netz ${window.strategy}: ${snap.reasonDe}`,
        source: "winter_planner",
    };
}
