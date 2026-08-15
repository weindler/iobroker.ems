"use strict";
/**
 * Only EVCC button pulses (control.off/pv/min/now).
 * Never pvControl, go-e, Ford, Tibber, Sonnen, or HA charge writes.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.executeEvccButtonWrite = exports.isAllowedEvccButtonWriteTarget = exports.buttonStateId = exports.buttonForMode = void 0;
const device_write_1 = require("../../../../device_write");
const evcc_mode_control_1 = require("../../evcc_mode_control");
const write_allowlist_1 = require("../write_allowlist");
const FORBIDDEN_PREFIXES = ["go-e.", "fordpass.", "ford.", "tibber.", "sonnen.", "homeassistant."];
function buttonForMode(mode) {
    return mode;
}
exports.buttonForMode = buttonForMode;
function buttonStateId(contract, button) {
    switch (button) {
        case "off":
            return contract.offStateId;
        case "pv":
            return contract.pvStateId;
        case "min":
            return contract.minStateId;
        case "now":
            return contract.nowStateId;
    }
}
exports.buttonStateId = buttonStateId;
function isAllowedEvccButtonWriteTarget(stateId, button) {
    const id = stateId.trim();
    if (!id)
        return false;
    const lower = id.toLowerCase();
    if (FORBIDDEN_PREFIXES.some((p) => lower.startsWith(p)))
        return false;
    if (lower.includes("control.pvcontrol"))
        return false;
    if (!(0, evcc_mode_control_1.isEvccModeButtonStateId)(id, button))
        return false;
    return (0, write_allowlist_1.classifyEvccPlannerWriteTarget)(id) === "allowed";
}
exports.isAllowedEvccButtonWriteTarget = isAllowedEvccButtonWriteTarget;
async function executeEvccButtonWrite(host, input) {
    const released = write_allowlist_1.EV_EXECUTION_PHASE5_ENABLED || input.liveTestPermit === true;
    if (!released || !input.writeAllowed) {
        return {
            attempted: false,
            written: false,
            skipped: false,
            blocked: true,
            reason: released ? "write_not_allowed" : "feature_gate",
            targetStateId: "",
        };
    }
    if (input.contract.resolvedVariant !== "buttons") {
        return {
            attempted: false,
            written: false,
            skipped: false,
            blocked: true,
            reason: "legacy_variant_blocked",
            targetStateId: input.contract.pvControlStateId,
        };
    }
    const button = buttonForMode(input.mode);
    const targetStateId = buttonStateId(input.contract, button);
    if (!isAllowedEvccButtonWriteTarget(targetStateId, button)) {
        return {
            attempted: false,
            written: false,
            skipped: false,
            blocked: true,
            reason: "button_target_rejected",
            targetStateId,
        };
    }
    const r = await (0, device_write_1.writeForeignIfChanged)(host, {
        stateId: targetStateId,
        value: true,
        reason: `ev_execution button ${button}`,
        force: true,
    });
    return {
        attempted: !r.blocked,
        written: r.written,
        skipped: r.skipped,
        blocked: r.blocked === true,
        reason: r.blocked ? (r.blockReason ?? "write_blocked") : r.written ? "written" : "skipped",
        targetStateId,
    };
}
exports.executeEvccButtonWrite = executeEvccButtonWrite;
