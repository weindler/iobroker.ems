"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mergePolicySections = exports.mergePolicyValues = void 0;
const constants_1 = require("./constants");
const value_1 = require("./value");
function pickSource(a, b) {
    if (a === "protection" || b === "protection") {
        return "protection";
    }
    if (a === "global_mode" || b === "global_mode") {
        return "global_mode";
    }
    if (a === "learning" || b === "learning") {
        return "learning";
    }
    if (a === "admin" || b === "admin") {
        return "admin";
    }
    return a;
}
function mergeConfidence(a, b) {
    if (a === undefined && b === undefined) {
        return undefined;
    }
    if (a === undefined) {
        return b;
    }
    if (b === undefined) {
        return a;
    }
    return Math.min(a, b);
}
function learningMayApplyHard(overlay) {
    if (overlay.source !== "learning") {
        return true;
    }
    const c = overlay.confidence;
    return c !== undefined && c >= constants_1.LEARNING_HARD_LIMIT_MIN_CONFIDENCE;
}
function effectiveStrength(overlay, kind) {
    if (overlay.source === "learning" && overlay.strength === "hard" && !learningMayApplyHard(overlay)) {
        return "advisory";
    }
    if (kind === "protection") {
        return "hard";
    }
    return overlay.strength;
}
function mergePolicyValues(base, overlay, ctx) {
    if (!base && !overlay) {
        return (0, value_1.policyValue)(null, "default", "advisory", { valid: true });
    }
    if (!base) {
        return { ...overlay };
    }
    if (!overlay || !overlay.valid) {
        return { ...base };
    }
    const kind = ctx.kind;
    const overlayStrength = effectiveStrength(overlay, kind);
    if (kind === "preference" || kind === "soft") {
        if (overlay.source === "global_mode" && overlay.valid) {
            return { ...overlay };
        }
        if (overlayStrength === "soft" || overlayStrength === "advisory") {
            return overlay.value !== null && overlay.value !== undefined ? { ...overlay } : { ...base };
        }
    }
    if (kind === "minimum" && typeof base.value === "number" && typeof overlay.value === "number") {
        if (!learningMayApplyHard(overlay) && overlay.source === "learning") {
            return { ...base };
        }
        const value = Math.max(base.value, overlay.value);
        return {
            value,
            source: pickSource(base.source, overlay.source),
            strength: "hard",
            valid: base.valid && overlay.valid,
            confidence: mergeConfidence(base.confidence, overlay.confidence),
            reason: value === overlay.value ? overlay.reason : base.reason,
        };
    }
    if (kind === "maximum" && typeof base.value === "number" && typeof overlay.value === "number") {
        if (!learningMayApplyHard(overlay) && overlay.source === "learning") {
            return { ...base };
        }
        const value = Math.min(base.value, overlay.value);
        return {
            value,
            source: pickSource(base.source, overlay.source),
            strength: "hard",
            valid: base.valid && overlay.valid,
            confidence: mergeConfidence(base.confidence, overlay.confidence),
            reason: value === overlay.value ? overlay.reason : base.reason,
        };
    }
    if (kind === "hard_boolean" || kind === "protection") {
        const bVal = base.value;
        const oVal = overlay.value;
        if (bVal === false || oVal === false) {
            return (0, value_1.policyValue)(false, pickSource(base.source, overlay.source), "hard", {
                reason: "Restriktivere harte Regel dominiert.",
                confidence: mergeConfidence(base.confidence, overlay.confidence),
            });
        }
        if (bVal === true && oVal === true) {
            return (0, value_1.policyValue)(true, pickSource(base.source, overlay.source), "hard", {
                confidence: mergeConfidence(base.confidence, overlay.confidence),
            });
        }
        if (bVal === true || oVal === true) {
            const known = bVal === true ? base : overlay;
            return { ...known };
        }
        return { ...base };
    }
    if (overlayStrength === "hard" && overlay.value !== null && overlay.value !== undefined) {
        if (!learningMayApplyHard(overlay)) {
            return { ...base };
        }
        return { ...overlay };
    }
    return overlay.value !== null && overlay.value !== undefined ? { ...overlay } : { ...base };
}
exports.mergePolicyValues = mergePolicyValues;
function mergePolicySections(base, overlay, section, fieldKinds) {
    const keys = [...new Set([...Object.keys(base), ...Object.keys(overlay)])].sort();
    const out = {};
    for (const field of keys) {
        const kind = fieldKinds[field] ?? (section === "protection" ? "protection" : "soft");
        const merged = mergePolicyValues(base[field], overlay[field], { section, field, kind });
        out[field] = merged;
    }
    return out;
}
exports.mergePolicySections = mergePolicySections;
