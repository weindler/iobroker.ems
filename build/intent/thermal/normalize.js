"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeThermalReadyAt = exports.normalizeTargetTemperature = exports.normalizeThermalPriority = exports.normalizeOperatingRequest = void 0;
const sentinel_1 = require("../core/sentinel");
const normalize_1 = require("../wallbox/normalize");
Object.defineProperty(exports, "normalizeThermalReadyAt", { enumerable: true, get: function () { return normalize_1.normalizeDeadline; } });
const OP_MAP = {
    off: "off",
    auto: "auto",
    force_on: "force_on",
    forceon: "force_on",
    force_off: "force_off",
    forceoff: "force_off",
};
const PRIO_MAP = {
    normal: "normal",
    before_ev: "before_ev",
    after_ev: "after_ev",
};
function normalizeOperatingRequest(raw) {
    if ((0, sentinel_1.isEmptySentinel)(raw))
        return { value: "unknown", status: "missing", raw };
    const s = String(raw).trim().toLowerCase();
    const mapped = OP_MAP[s];
    if (mapped)
        return { value: mapped, status: "valid", raw };
    return { value: "unknown", status: "valid", raw };
}
exports.normalizeOperatingRequest = normalizeOperatingRequest;
function normalizeThermalPriority(raw) {
    if ((0, sentinel_1.isEmptySentinel)(raw))
        return { value: "unknown", status: "missing", raw };
    const s = String(raw).trim().toLowerCase();
    const mapped = PRIO_MAP[s];
    if (mapped)
        return { value: mapped, status: "valid", raw };
    return { value: "unknown", status: "valid", raw };
}
exports.normalizeThermalPriority = normalizeThermalPriority;
function normalizeTargetTemperature(raw) {
    if ((0, sentinel_1.isEmptySentinel)(raw))
        return { value: null, status: "missing", raw };
    const n = typeof raw === "number" ? raw : parseFloat(String(raw).replace(",", ".").trim());
    if (!Number.isFinite(n))
        return { value: null, status: "invalid", raw };
    if (n < 0 || n > 120)
        return { value: null, status: "invalid", raw };
    return { value: n, status: "valid", raw };
}
exports.normalizeTargetTemperature = normalizeTargetTemperature;
