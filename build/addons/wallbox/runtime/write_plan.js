"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildWallboxWritePlan = exports.WALLBOX_WRITE_SEQUENCE = void 0;
/**
 * Sichere Write-Reihenfolge für Ladebeginn: Sollwert vor Ladefreigabe.
 * Legacy dryrun_command nutzt historisch enable zuerst — der Write Contract korrigiert das bewusst.
 */
exports.WALLBOX_WRITE_SEQUENCE = {
    set_current_a: 1,
    set_charge_power_w: 1,
    set_enabled: 2,
};
function emptyPlan(action, createdAt, commandRevision, blockReason, contractReady, mapping) {
    return {
        action,
        actionable: false,
        contractReady,
        feedbackContractReady: false,
        controlModel: mapping.controlModel,
        evccControlPathConfirmed: mapping.evccControlPathConfirmed,
        writeScenario: null,
        operations: [],
        missingRoles: [],
        unsupportedReasons: [],
        commandRevision,
        createdAt,
        blocked: blockReason !== null,
        blockReason,
    };
}
function parseAllowedValues(raw) {
    if (!raw || !raw.trim())
        return null;
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : null;
    }
    catch {
        return null;
    }
}
function booleanAllowed(value, allowedRaw) {
    const allowed = parseAllowedValues(allowedRaw);
    if (!allowed)
        return true;
    return allowed.some((v) => v === value || v === (value ? 1 : 0));
}
function validChargeNumber(value) {
    return value !== null && Number.isFinite(value) && value > 0;
}
function operationFromEntry(entry, targetValue, sourceField, expectedReadback) {
    if (entry.targetValueType === "boolean" && typeof targetValue !== "boolean") {
        return null;
    }
    if (entry.targetValueType === "number" && typeof targetValue !== "number") {
        return null;
    }
    if (entry.targetValueType === "number" && !Number.isFinite(targetValue)) {
        return null;
    }
    return {
        role: entry.role,
        targetStateId: entry.targetStateId,
        targetValue,
        targetValueType: entry.targetValueType,
        sequence: exports.WALLBOX_WRITE_SEQUENCE[entry.role],
        required: entry.required,
        readbackStateId: entry.readbackStateId,
        expectedReadbackValue: expectedReadback,
        sourceField,
    };
}
function computeFeedbackReady(operations) {
    if (operations.length === 0)
        return false;
    return operations.every((op) => op.required && op.readbackStateId !== null);
}
/**
 * Reine Übersetzung Command → Write-Plan. Kein IO, kein Host, keine Writes.
 */
function buildWallboxWritePlan(input) {
    const { candidate, mapping, chargingEnabled, now } = input;
    const createdAt = now.toISOString();
    const commandRevision = candidate.dispatchRevision !== null ? String(candidate.dispatchRevision) : null;
    if (!candidate.connected) {
        return emptyPlan("none", createdAt, commandRevision, "vehicle_disconnected", false, mapping);
    }
    if (candidate.action === "none") {
        return emptyPlan("none", createdAt, commandRevision, null, true, mapping);
    }
    if (candidate.action === "hold") {
        return emptyPlan("hold", createdAt, commandRevision, "hold_mapping_undefined", false, mapping);
    }
    if (candidate.blocked || !candidate.technicallyReady) {
        return emptyPlan("charge", createdAt, commandRevision, candidate.blockReason ?? "candidate_blocked", false, mapping);
    }
    const unsupportedReasons = ["evcc_mode_write_not_configured"];
    const missingRoles = [...mapping.missingRoles];
    if (mapping.ambiguousPowerControl) {
        return {
            ...emptyPlan("charge", createdAt, commandRevision, mapping.mappingConflictReason ?? "ambiguous_power_control_mapping", false, mapping),
            missingRoles,
            unsupportedReasons,
        };
    }
    if (!mapping.setEnabled) {
        return {
            ...emptyPlan("charge", createdAt, commandRevision, "mapping_incomplete", false, mapping),
            missingRoles,
            unsupportedReasons,
        };
    }
    if (!mapping.chargeControlRole) {
        return {
            ...emptyPlan("charge", createdAt, commandRevision, "mapping_incomplete", false, mapping),
            missingRoles,
            unsupportedReasons,
        };
    }
    if (!validChargeNumber(candidate.targetCurrentA) && mapping.chargeControlRole === "set_current_a") {
        return emptyPlan("charge", createdAt, commandRevision, "invalid_target_current", false, mapping);
    }
    if (!validChargeNumber(candidate.targetPowerW) && mapping.chargeControlRole === "set_charge_power_w") {
        return emptyPlan("charge", createdAt, commandRevision, "invalid_target_power", false, mapping);
    }
    const chargeEntry = mapping.chargeControlRole === "set_current_a" ? mapping.setCurrentA : mapping.setChargePowerW;
    if (!chargeEntry) {
        return {
            ...emptyPlan("charge", createdAt, commandRevision, "mapping_incomplete", false, mapping),
            missingRoles,
            unsupportedReasons,
        };
    }
    let chargeValue;
    let sourceField;
    let expectedReadback;
    if (mapping.chargeControlRole === "set_current_a") {
        chargeValue = candidate.targetCurrentA;
        sourceField = "targetCurrentA";
        expectedReadback = chargeEntry.readbackStateId ? chargeValue : null;
    }
    else {
        chargeValue = candidate.targetPowerW;
        sourceField = "targetPowerW";
        expectedReadback = chargeEntry.readbackStateId ? chargeValue : null;
    }
    const chargeOp = operationFromEntry(chargeEntry, chargeValue, sourceField, expectedReadback);
    if (!chargeOp) {
        return emptyPlan("charge", createdAt, commandRevision, "invalid_charge_value_type", false, mapping);
    }
    const operations = [chargeOp];
    const enableWriteRequired = chargingEnabled !== true;
    const writeScenario = enableWriteRequired ? "charge_start" : "charge_adjust";
    if (enableWriteRequired) {
        const enableValue = true;
        if (!booleanAllowed(enableValue, mapping.setEnabled.allowedValuesRaw)) {
            return emptyPlan("charge", createdAt, commandRevision, "enable_value_not_allowed", false, mapping);
        }
        const enableOp = operationFromEntry(mapping.setEnabled, enableValue, "enableCharging", enableValue);
        if (!enableOp) {
            return emptyPlan("charge", createdAt, commandRevision, "invalid_enable_value_type", false, mapping);
        }
        operations.push(enableOp);
    }
    operations.sort((a, b) => a.sequence - b.sequence || a.role.localeCompare(b.role));
    const feedbackContractReady = computeFeedbackReady(operations);
    return {
        action: "charge",
        actionable: true,
        contractReady: true,
        feedbackContractReady,
        controlModel: mapping.controlModel,
        evccControlPathConfirmed: mapping.evccControlPathConfirmed,
        writeScenario,
        operations,
        missingRoles: [],
        unsupportedReasons,
        commandRevision,
        createdAt,
        blocked: false,
        blockReason: null,
    };
}
exports.buildWallboxWritePlan = buildWallboxWritePlan;
