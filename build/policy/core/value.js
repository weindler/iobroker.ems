"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.clampConfidence = clampConfidence;
exports.isValidConfidence = isValidConfidence;
exports.policyValue = policyValue;
exports.unknownTriState = unknownTriState;
exports.unknownValue = unknownValue;
exports.isUnknownTriState = isUnknownTriState;
exports.isKnownNumber = isKnownNumber;
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
function isValidConfidence(raw) {
    return typeof raw === "number" && Number.isFinite(raw) && raw >= constants_1.CONFIDENCE_MIN && raw <= constants_1.CONFIDENCE_MAX;
}
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
function unknownTriState(source = "default", strength = "advisory") {
    return policyValue("unknown", source, strength, {
        reason: "Wert unbekannt — kein Fallback.",
    });
}
function unknownValue(source = "default", strength = "advisory") {
    return policyValue(null, source, strength, {
        reason: "Wert unbekannt — kein Fallback.",
    });
}
function isUnknownTriState(v) {
    return v.value === "unknown" || v.value === null;
}
function isKnownNumber(v) {
    return typeof v.value === "number" && Number.isFinite(v.value) && v.valid;
}
