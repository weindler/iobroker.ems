"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isKnownNumber = exports.isUnknownTriState = exports.unknownValue = exports.unknownTriState = exports.policyValue = exports.isValidConfidence = exports.clampConfidence = void 0;
const constants_1 = require("./constants");
function clampConfidence(raw) {
    if (raw === undefined) {
        return undefined;
    }
    if (!Number.isFinite(raw)) {
        return undefined;
    }
    return Math.max(constants_1.CONFIDENCE_MIN, Math.min(constants_1.CONFIDENCE_MAX, raw));
}
exports.clampConfidence = clampConfidence;
function isValidConfidence(raw) {
    return typeof raw === "number" && Number.isFinite(raw) && raw >= constants_1.CONFIDENCE_MIN && raw <= constants_1.CONFIDENCE_MAX;
}
exports.isValidConfidence = isValidConfidence;
function policyValue(value, source, strength, opts) {
    const confidence = clampConfidence(opts?.confidence);
    return {
        value,
        source,
        strength,
        valid: opts?.valid ?? true,
        ...(confidence !== undefined ? { confidence } : {}),
        ...(opts?.reason ? { reason: opts.reason } : {}),
        ...(opts?.sourcePath ? { sourcePath: opts.sourcePath } : {}),
    };
}
exports.policyValue = policyValue;
function unknownTriState(source = "default", strength = "advisory") {
    return policyValue("unknown", source, strength, {
        reason: "Wert unbekannt — kein Fallback.",
    });
}
exports.unknownTriState = unknownTriState;
function unknownValue(source = "default", strength = "advisory") {
    return policyValue(null, source, strength, {
        reason: "Wert unbekannt — kein Fallback.",
    });
}
exports.unknownValue = unknownValue;
function isUnknownTriState(v) {
    return v.value === "unknown" || v.value === null;
}
exports.isUnknownTriState = isUnknownTriState;
function isKnownNumber(v) {
    return typeof v.value === "number" && Number.isFinite(v.value) && v.valid;
}
exports.isKnownNumber = isKnownNumber;
