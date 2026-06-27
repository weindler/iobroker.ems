"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.immediateFromBool = exports.normalizeDeadline = exports.normalizeTargetSoc = exports.normalizeChargeStrategyFromString = exports.normalizeEvccMode = void 0;
const constants_1 = require("../core/constants");
const validation_1 = require("../core/validation");
function normalizeEvccMode(raw) {
    if (raw === null || raw === undefined || raw === "") {
        return { strategy: "unknown", status: "missing", raw };
    }
    const s = String(raw).trim().toLowerCase();
    if (!s) {
        return { strategy: "unknown", status: "missing", raw };
    }
    const mapped = constants_1.EVCC_MODE_MAP[s];
    if (mapped) {
        return { strategy: mapped, status: "valid", raw };
    }
    return { strategy: "unknown", status: "valid", raw };
}
exports.normalizeEvccMode = normalizeEvccMode;
function normalizeChargeStrategyFromString(raw) {
    return normalizeEvccMode(raw);
}
exports.normalizeChargeStrategyFromString = normalizeChargeStrategyFromString;
function normalizeTargetSoc(raw) {
    const parsed = (0, validation_1.parseOptionalSoc)(raw);
    return { ...parsed, raw };
}
exports.normalizeTargetSoc = normalizeTargetSoc;
function normalizeDeadline(raw, defaultTimezone, now, deadlineType = "departure") {
    if (raw === null || raw === undefined || raw === "") {
        return { value: null, status: "missing", raw };
    }
    let ms = null;
    if (typeof raw === "number" && Number.isFinite(raw)) {
        // Sekunden vs. Millisekunden heuristisch
        ms = raw > 1e12 ? raw : raw * 1000;
    }
    else {
        const s = String(raw).trim();
        if (!s) {
            return { value: null, status: "missing", raw };
        }
        const asNum = parseFloat(s);
        if (/^\d+(\.\d+)?$/.test(s) && Number.isFinite(asNum)) {
            ms = asNum > 1e12 ? asNum : asNum * 1000;
        }
        else {
            const parsed = Date.parse(s);
            if (Number.isFinite(parsed)) {
                ms = parsed;
            }
        }
    }
    if (ms === null || !Number.isFinite(ms)) {
        return { value: null, status: "invalid", raw };
    }
    const at = new Date(ms).toISOString();
    if (ms < now.getTime()) {
        return {
            value: { type: deadlineType, at, timezone: defaultTimezone },
            status: "expired",
            raw,
        };
    }
    return {
        value: { type: deadlineType, at, timezone: defaultTimezone },
        status: "valid",
        raw,
    };
}
exports.normalizeDeadline = normalizeDeadline;
function immediateFromBool(raw) {
    if (raw === null || raw === undefined || raw === "") {
        return null;
    }
    if (typeof raw === "boolean") {
        return raw ? "immediate" : null;
    }
    const s = String(raw).trim().toLowerCase();
    if (["1", "true", "on", "yes", "ja"].includes(s)) {
        return "immediate";
    }
    return null;
}
exports.immediateFromBool = immediateFromBool;
