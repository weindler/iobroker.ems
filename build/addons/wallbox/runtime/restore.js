"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.planWallboxSafeRestore = void 0;
const ownership_1 = require("./ownership");
/**
 * Safe Restore: EMS gibt die EVCC-Modus-Steuerung an den konfigurierten Hold-Wert zurück,
 * sobald es die Kontrolle verlässt (Live→Dryrun/Observe, Fault/Lockout, Addon/Governance aus).
 * Nur für den EVCC-Steuerpfad relevant — legacy_direct ist strukturell nie live-eligible.
 */
function planWallboxSafeRestore(ownership, mapping) {
    if (!(0, ownership_1.canSafeRestoreWallbox)(ownership)) {
        return { required: false, possible: false, operation: null, reason: "no_ownership" };
    }
    if (ownership.controlModel !== "evcc") {
        return { required: false, possible: false, operation: null, reason: "control_model_not_restorable" };
    }
    if (!mapping.setMode || !mapping.holdModeValueConfirmed || !mapping.evccHoldModeValue) {
        return { required: true, possible: false, operation: null, reason: "hold_mapping_undefined" };
    }
    return {
        required: true,
        possible: true,
        operation: { targetStateId: mapping.setMode.targetStateId, targetValue: mapping.evccHoldModeValue },
        reason: "ems_ownership",
    };
}
exports.planWallboxSafeRestore = planWallboxSafeRestore;
