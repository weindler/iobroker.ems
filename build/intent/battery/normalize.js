"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeBooleanIntent = exports.normalizeBatteryTargetSoc = exports.normalizeGridChargeRequest = exports.normalizeBatteryOperatingRequest = void 0;
const sentinel_1 = require("../core/sentinel");
const validation_1 = require("../core/validation");
const OP_MAP = {
    auto: "auto",
    protect: "protect",
    hold: "hold",
    charge: "charge",
    discharge: "discharge",
    off: "off",
};
const GRID_MAP = {
    auto: "auto",
    allow: "allow",
    deny: "deny",
};
function normalizeBatteryOperatingRequest(raw) {
    if ((0, sentinel_1.isEmptySentinel)(raw))
        return { value: "unknown", status: "missing", raw };
    const s = String(raw).trim().toLowerCase();
    const mapped = OP_MAP[s];
    if (mapped)
        return { value: mapped, status: "valid", raw };
    return { value: "unknown", status: "valid", raw };
}
exports.normalizeBatteryOperatingRequest = normalizeBatteryOperatingRequest;
function normalizeGridChargeRequest(raw) {
    if ((0, sentinel_1.isEmptySentinel)(raw))
        return { value: "unknown", status: "missing", raw };
    const s = String(raw).trim().toLowerCase();
    const mapped = GRID_MAP[s];
    if (mapped)
        return { value: mapped, status: "valid", raw };
    return { value: "unknown", status: "valid", raw };
}
exports.normalizeGridChargeRequest = normalizeGridChargeRequest;
function normalizeBatteryTargetSoc(raw) {
    const parsed = (0, validation_1.parseOptionalSoc)(raw);
    return { ...parsed, raw };
}
exports.normalizeBatteryTargetSoc = normalizeBatteryTargetSoc;
function normalizeBooleanIntent(raw) {
    if ((0, sentinel_1.isEmptySentinel)(raw))
        return { value: null, status: "missing", raw };
    if (typeof raw === "boolean")
        return { value: raw, status: "valid", raw };
    const s = String(raw).trim().toLowerCase();
    if (s === "true" || s === "1" || s === "yes" || s === "on")
        return { value: true, status: "valid", raw };
    if (s === "false" || s === "0" || s === "no" || s === "off")
        return { value: false, status: "valid", raw };
    return { value: null, status: "invalid", raw };
}
exports.normalizeBooleanIntent = normalizeBooleanIntent;
