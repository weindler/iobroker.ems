"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isValueAllowed = exports.resolvePlannedValue = exports.loadMapping = void 0;
const mapping_resolve_1 = require("./mapping_resolve");
async function loadMapping(ctx, addonId, mappingId) {
    const resolved = (0, mapping_resolve_1.resolveMappingTargetFromConfig)(ctx.config, addonId, mappingId);
    if (!resolved) {
        return null;
    }
    return {
        mappingId,
        enabled: resolved.enabled,
        targetState: resolved.targetState,
        allowedValues: parseAllowedValues(resolved.allowedValues),
    };
}
exports.loadMapping = loadMapping;
function parseAllowedValues(val) {
    if (val === null || val === undefined || val === "")
        return null;
    if (Array.isArray(val))
        return val;
    if (typeof val === "string") {
        const s = val.trim();
        if (!s)
            return null;
        try {
            const parsed = JSON.parse(s);
            if (Array.isArray(parsed))
                return parsed;
        }
        catch {
            // fall through
        }
        return s.split(",").map((x) => x.trim());
    }
    return null;
}
/** Map logical value for dryrun display (e.g. W → A for go-e ampere). */
function resolvePlannedValue(command, value, targetState) {
    if (command === "set_charge_power_w" && typeof value === "number") {
        const amps = Math.round(value / 230);
        return { watts: value, ampere: Math.max(0, amps), target_state: targetState };
    }
    return value;
}
exports.resolvePlannedValue = resolvePlannedValue;
function isValueAllowed(value, allowed) {
    if (!allowed?.length)
        return true;
    return allowed.some((a) => valuesEqual(a, value));
}
exports.isValueAllowed = isValueAllowed;
function valuesEqual(a, b) {
    if (a === b)
        return true;
    if (typeof a === "number" && typeof b === "number")
        return a === b;
    return String(a) === String(b);
}
