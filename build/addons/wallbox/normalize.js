"use strict";
/** EVCC telemetry value normalization — missing stays missing, never invent 0/false. */
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeOptionalPhases = exports.normalizeOptionalSoc = exports.normalizeOptionalNumber = exports.normalizeOptionalBool = exports.missingField = void 0;
const sentinel_1 = require("../../intent/core/sentinel");
const validation_1 = require("../../intent/core/validation");
function missingField() {
    return { value: null, status: "missing", raw: null };
}
exports.missingField = missingField;
function normalizeOptionalBool(raw) {
    if ((0, sentinel_1.isEmptySentinel)(raw))
        return missingField();
    if (typeof raw === "boolean")
        return { value: raw, status: "valid", raw };
    if (typeof raw === "number" && Number.isFinite(raw)) {
        if (raw === 0)
            return { value: false, status: "valid", raw };
        if (raw === 1)
            return { value: true, status: "valid", raw };
        return { value: null, status: "invalid", raw };
    }
    const s = String(raw).trim().toLowerCase();
    if (!s)
        return missingField();
    if (["1", "true", "on", "yes", "ja"].includes(s))
        return { value: true, status: "valid", raw };
    if (["0", "false", "off", "no", "nein"].includes(s))
        return { value: false, status: "valid", raw };
    return { value: null, status: "invalid", raw };
}
exports.normalizeOptionalBool = normalizeOptionalBool;
function normalizeOptionalNumber(raw) {
    if ((0, sentinel_1.isEmptySentinel)(raw))
        return missingField();
    if (typeof raw === "number" && Number.isFinite(raw)) {
        return { value: raw, status: "valid", raw };
    }
    const s = String(raw).trim();
    if (!s)
        return missingField();
    const n = parseFloat(s.replace(",", "."));
    if (!Number.isFinite(n))
        return { value: null, status: "invalid", raw };
    return { value: n, status: "valid", raw };
}
exports.normalizeOptionalNumber = normalizeOptionalNumber;
function normalizeOptionalSoc(raw) {
    if ((0, sentinel_1.isEmptySentinel)(raw))
        return missingField();
    const parsed = (0, validation_1.parseOptionalSoc)(raw);
    return { value: parsed.value, status: parsed.status === "valid" ? "valid" : parsed.status === "missing" ? "missing" : "invalid", raw };
}
exports.normalizeOptionalSoc = normalizeOptionalSoc;
function normalizeOptionalPhases(raw) {
    const n = normalizeOptionalNumber(raw);
    if (n.status !== "valid" || n.value === null)
        return n;
    if (n.value < 0 || n.value > 3)
        return { value: null, status: "invalid", raw };
    return n;
}
exports.normalizeOptionalPhases = normalizeOptionalPhases;
