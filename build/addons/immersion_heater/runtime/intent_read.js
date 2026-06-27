"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.controlModeToOperatingRequest = exports.parseResolvedIntentJson = exports.forceUntilFromIntent = exports.forceTargetFromIntent = exports.resolvedModeFromIntent = void 0;
const fsm_1 = require("./fsm");
Object.defineProperty(exports, "controlModeToOperatingRequest", { enumerable: true, get: function () { return fsm_1.controlModeToOperatingRequest; } });
function resolvedModeFromIntent(intent) {
    if (!intent || intent.intent_state === "disabled")
        return "auto";
    const op = intent.operating_request.value;
    if (intent.operating_request.status === "valid" && op) {
        return (0, fsm_1.operatingRequestToControlMode)(op);
    }
    return "auto";
}
exports.resolvedModeFromIntent = resolvedModeFromIntent;
function forceTargetFromIntent(intent) {
    if (!intent || intent.target_temperature_c.status !== "valid")
        return null;
    return intent.target_temperature_c.value;
}
exports.forceTargetFromIntent = forceTargetFromIntent;
function forceUntilFromIntent(intent) {
    if (!intent || intent.ready_at.status !== "valid" || !intent.ready_at.value)
        return null;
    return intent.ready_at.value.at;
}
exports.forceUntilFromIntent = forceUntilFromIntent;
function parseResolvedIntentJson(raw) {
    if (!raw)
        return null;
    try {
        const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
        if (parsed && typeof parsed === "object" && parsed.domain === "thermal") {
            return parsed;
        }
    }
    catch {
        return null;
    }
    return null;
}
exports.parseResolvedIntentJson = parseResolvedIntentJson;
