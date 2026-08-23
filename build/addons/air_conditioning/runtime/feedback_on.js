"use strict";
/**
 * LocalThings/HASS: climate.state_boolean bleibt oft false, obwohl HVAC-Modus cool/heat/… ist.
 * Dann gilt climate.state (feedback_mode) als On/Off-Wahrheit.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveAcFeedbackModeTarget = exports.resolveAcDevicePowered = exports.deriveHassClimateStateId = void 0;
const registry_1 = require("../profiles/registry");
const sequences_1 = require("./sequences");
const time_1 = require("./time");
function deriveHassClimateStateId(feedbackSwitchId) {
    const id = String(feedbackSwitchId ?? "").trim();
    if (id.endsWith(".state_boolean")) {
        return `${id.slice(0, -".state_boolean".length)}.state`;
    }
    return "";
}
exports.deriveHassClimateStateId = deriveHassClimateStateId;
function resolveAcDevicePowered(input) {
    if ((0, time_1.switchIsOn)(input.switchRaw)) {
        return { on: true, effectiveRaw: input.switchRaw, via: "switch" };
    }
    if (input.useModeFallback && input.modeRaw !== undefined && input.modeRaw !== null) {
        const modeStr = String(input.modeRaw).trim();
        if (modeStr !== "" && (0, time_1.switchIsOn)(input.modeRaw)) {
            return { on: true, effectiveRaw: input.modeRaw, via: "mode" };
        }
        if (modeStr !== "") {
            return { on: false, effectiveRaw: input.modeRaw, via: "mode" };
        }
    }
    return { on: false, effectiveRaw: input.switchRaw, via: "none" };
}
exports.resolveAcDevicePowered = resolveAcDevicePowered;
function resolveAcFeedbackModeTarget(table, unit, feedbackSwitchId) {
    if (!(0, registry_1.isLocalthingsHassProfile)(unit.profileId)) {
        return "";
    }
    const mapped = (0, sequences_1.resolveAcMappingTarget)(table, unit.index, "feedback_mode");
    if (mapped)
        return mapped;
    return deriveHassClimateStateId(feedbackSwitchId);
}
exports.resolveAcFeedbackModeTarget = resolveAcFeedbackModeTarget;
