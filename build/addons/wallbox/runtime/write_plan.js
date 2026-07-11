"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildWallboxWritePlan = exports.WALLBOX_WRITE_SEQUENCE = exports.WALLBOX_EVCC_WRITE_SEQUENCE = exports.WALLBOX_LEGACY_WRITE_SEQUENCE = void 0;
/** Sichere Write-Reihenfolge Legacy: Sollwert vor Ladefreigabe. */
exports.WALLBOX_LEGACY_WRITE_SEQUENCE = {
    set_current_a: 1,
    set_charge_power_w: 1,
    set_enabled: 2,
};
/** EVCC: maxCurrent vor Mode — EMS setzt Stromobergrenze, EVCC regelt den Ladestrom. */
exports.WALLBOX_EVCC_WRITE_SEQUENCE = {
    set_max_current_a: 1,
    set_mode: 2,
    set_phase: 3,
};
/** @deprecated Alias für Legacy-Tests */
exports.WALLBOX_WRITE_SEQUENCE = exports.WALLBOX_LEGACY_WRITE_SEQUENCE;
function planBase(mapping) {
    return {
        controlModel: mapping.controlModel,
        evccControlPathConfirmed: mapping.evccControlPathConfirmed,
        liveEligible: false,
        controlPathReason: mapping.controlPathReason,
    };
}
function emptyPlan(action, createdAt, commandRevision, blockReason, contractReady, mapping, liveEligible = false) {
    return {
        action,
        actionable: false,
        contractReady,
        feedbackContractReady: false,
        ...planBase(mapping),
        liveEligible,
        controlPathReason: blockReason ?? mapping.controlPathReason,
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
function sequenceForRole(role, controlModel) {
    if (controlModel === "evcc") {
        if (role === "set_max_current_a")
            return exports.WALLBOX_EVCC_WRITE_SEQUENCE.set_max_current_a;
        if (role === "set_mode")
            return exports.WALLBOX_EVCC_WRITE_SEQUENCE.set_mode;
        if (role === "set_phase")
            return exports.WALLBOX_EVCC_WRITE_SEQUENCE.set_phase;
        return 99;
    }
    if (role === "set_current_a")
        return exports.WALLBOX_LEGACY_WRITE_SEQUENCE.set_current_a;
    if (role === "set_charge_power_w")
        return exports.WALLBOX_LEGACY_WRITE_SEQUENCE.set_charge_power_w;
    if (role === "set_enabled")
        return exports.WALLBOX_LEGACY_WRITE_SEQUENCE.set_enabled;
    return 99;
}
function operationFromEntry(entry, targetValue, sourceField, expectedReadback, controlModel) {
    if (entry.targetValueType === "boolean" && typeof targetValue !== "boolean") {
        return null;
    }
    if (entry.targetValueType === "number" && typeof targetValue !== "number") {
        return null;
    }
    if (entry.targetValueType === "string" && typeof targetValue !== "string") {
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
        sequence: sequenceForRole(entry.role, controlModel),
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
function legacyMappingStructurallyReady(mapping) {
    if (mapping.ambiguousPowerControl)
        return false;
    if (mapping.missingRoles.length > 0)
        return false;
    if (mapping.validationIssues.length > 0)
        return false;
    if (!mapping.setEnabled?.contractValid)
        return false;
    const chargeEntry = mapping.chargeControlRole === "set_current_a"
        ? mapping.setCurrentA
        : mapping.chargeControlRole === "set_charge_power_w"
            ? mapping.setChargePowerW
            : null;
    return Boolean(chargeEntry?.contractValid);
}
function evccMappingStructurallyReady(mapping) {
    if (mapping.missingRoles.length > 0)
        return false;
    if (mapping.validationIssues.length > 0)
        return false;
    if (!mapping.setMaxCurrentA?.contractValid)
        return false;
    if (!mapping.setMode?.contractValid)
        return false;
    if (!mapping.chargeModeValueConfirmed)
        return false;
    return mapping.evccControlPathConfirmed;
}
function buildEvccHoldPlan(candidate, mapping, createdAt, commandRevision) {
    if (!mapping.setMode || !mapping.holdModeValueConfirmed || !mapping.evccHoldModeValue) {
        return emptyPlan("hold", createdAt, commandRevision, "hold_mapping_undefined", false, mapping);
    }
    const modeOp = operationFromEntry(mapping.setMode, mapping.evccHoldModeValue, "evccHoldModeValue", mapping.evccHoldModeValue, "evcc");
    if (!modeOp) {
        return emptyPlan("hold", createdAt, commandRevision, "invalid_hold_mode_value", false, mapping);
    }
    const contractReady = mapping.setMode.contractValid && mapping.holdModeValueConfirmed;
    return {
        action: "hold",
        actionable: contractReady,
        contractReady,
        feedbackContractReady: computeFeedbackReady([modeOp]),
        controlModel: mapping.controlModel,
        evccControlPathConfirmed: mapping.evccControlPathConfirmed,
        liveEligible: false,
        controlPathReason: mapping.controlPathReason,
        writeScenario: null,
        operations: [modeOp],
        missingRoles: [],
        unsupportedReasons: [],
        commandRevision,
        createdAt,
        blocked: !contractReady,
        blockReason: contractReady ? null : "hold_mapping_undefined",
    };
}
function buildEvccChargePlan(candidate, mapping, chargeModeActive, createdAt, commandRevision) {
    const unsupportedReasons = [];
    const missingRoles = [...mapping.missingRoles];
    if (mapping.controlModel === "none") {
        return {
            ...emptyPlan("charge", createdAt, commandRevision, "control_model_not_selected", false, mapping),
            missingRoles,
            unsupportedReasons,
        };
    }
    if (!mapping.setMaxCurrentA) {
        return {
            ...emptyPlan("charge", createdAt, commandRevision, "mapping_incomplete", false, mapping),
            missingRoles,
            unsupportedReasons,
        };
    }
    if (!validChargeNumber(candidate.targetCurrentA)) {
        return emptyPlan("charge", createdAt, commandRevision, "invalid_target_current", false, mapping);
    }
    if (!mapping.chargeModeValueConfirmed || !mapping.evccChargeModeValue) {
        return {
            ...emptyPlan("charge", createdAt, commandRevision, "evcc_charge_mode_mapping_missing", false, mapping),
            missingRoles,
            unsupportedReasons,
        };
    }
    if (!mapping.setMode) {
        return {
            ...emptyPlan("charge", createdAt, commandRevision, "mapping_incomplete", false, mapping),
            missingRoles,
            unsupportedReasons,
        };
    }
    if (mapping.validationIssues.length > 0) {
        const reason = mapping.validationIssues[0] ?? "mapping_validation_failed";
        return {
            ...emptyPlan("charge", createdAt, commandRevision, reason, false, mapping),
            missingRoles,
            unsupportedReasons,
        };
    }
    const maxCurrentValue = candidate.targetCurrentA;
    const maxCurrentOp = operationFromEntry(mapping.setMaxCurrentA, maxCurrentValue, "targetCurrentA", mapping.setMaxCurrentA.readbackStateId ? maxCurrentValue : null, "evcc");
    if (!maxCurrentOp) {
        return emptyPlan("charge", createdAt, commandRevision, "invalid_max_current_value_type", false, mapping);
    }
    const modeStartRequired = chargeModeActive !== true;
    const writeScenario = modeStartRequired ? "charge_start" : "charge_adjust";
    const operations = [maxCurrentOp];
    if (modeStartRequired) {
        const chargeModeValue = mapping.evccChargeModeValue;
        const modeOp = operationFromEntry(mapping.setMode, chargeModeValue, "evccChargeModeValue", chargeModeValue, "evcc");
        if (!modeOp) {
            return emptyPlan("charge", createdAt, commandRevision, "invalid_charge_mode_value_type", false, mapping);
        }
        operations.push(modeOp);
    }
    operations.sort((a, b) => a.sequence - b.sequence || a.role.localeCompare(b.role));
    const structurallyReady = evccMappingStructurallyReady(mapping);
    const contractReady = structurallyReady;
    const feedbackContractReady = computeFeedbackReady(operations);
    const liveEligible = mapping.liveEligible &&
        contractReady &&
        (writeScenario !== "charge_start" || mapping.chargeModeValueConfirmed);
    return {
        action: "charge",
        actionable: contractReady,
        contractReady,
        feedbackContractReady,
        controlModel: mapping.controlModel,
        evccControlPathConfirmed: mapping.evccControlPathConfirmed,
        liveEligible,
        controlPathReason: mapping.controlPathReason,
        writeScenario,
        operations,
        missingRoles: [],
        unsupportedReasons,
        commandRevision,
        createdAt,
        blocked: !contractReady,
        blockReason: contractReady ? null : (mapping.controlPathReason ?? "mapping_incomplete"),
    };
}
function buildLegacyChargePlan(candidate, mapping, chargingEnabled, createdAt, commandRevision) {
    const unsupportedReasons = [];
    const missingRoles = [...mapping.missingRoles];
    if (mapping.ambiguousPowerControl) {
        return {
            ...emptyPlan("charge", createdAt, commandRevision, mapping.mappingConflictReason ?? "ambiguous_power_control_mapping", false, mapping),
            missingRoles,
            unsupportedReasons,
        };
    }
    if (mapping.validationIssues.length > 0) {
        const reason = mapping.validationIssues[0] ?? "mapping_validation_failed";
        return {
            ...emptyPlan("charge", createdAt, commandRevision, reason, false, mapping),
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
    const chargeOp = operationFromEntry(chargeEntry, chargeValue, sourceField, expectedReadback, "legacy_direct");
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
        const enableOp = operationFromEntry(mapping.setEnabled, enableValue, "enableCharging", enableValue, "legacy_direct");
        if (!enableOp) {
            return emptyPlan("charge", createdAt, commandRevision, "invalid_enable_value_type", false, mapping);
        }
        operations.push(enableOp);
    }
    operations.sort((a, b) => a.sequence - b.sequence || a.role.localeCompare(b.role));
    const structurallyReady = legacyMappingStructurallyReady(mapping);
    const contractReady = structurallyReady;
    const feedbackContractReady = computeFeedbackReady(operations);
    return {
        action: "charge",
        actionable: contractReady,
        contractReady,
        feedbackContractReady,
        controlModel: mapping.controlModel,
        evccControlPathConfirmed: mapping.evccControlPathConfirmed,
        liveEligible: false,
        controlPathReason: mapping.controlPathReason,
        writeScenario,
        operations,
        missingRoles: [],
        unsupportedReasons,
        commandRevision,
        createdAt,
        blocked: !contractReady,
        blockReason: contractReady ? null : (mapping.controlPathReason ?? "mapping_incomplete"),
    };
}
/**
 * Reine Übersetzung Command → Write-Plan. Kein IO, kein Host, keine Writes.
 * EVCC: targetCurrentA wird als maxCurrent (Stromobergrenze) an EVCC übergeben.
 */
function buildWallboxWritePlan(input) {
    const { candidate, mapping, chargingEnabled, chargeModeActive, now } = input;
    const createdAt = now.toISOString();
    const commandRevision = candidate.dispatchRevision !== null ? String(candidate.dispatchRevision) : null;
    if (!candidate.connected) {
        return emptyPlan("none", createdAt, commandRevision, "vehicle_disconnected", false, mapping);
    }
    if (candidate.action === "none") {
        return emptyPlan("none", createdAt, commandRevision, null, true, mapping);
    }
    if (candidate.action === "hold") {
        if (mapping.controlModel === "evcc") {
            return buildEvccHoldPlan(candidate, mapping, createdAt, commandRevision);
        }
        return emptyPlan("hold", createdAt, commandRevision, "hold_mapping_undefined", false, mapping);
    }
    if (candidate.blocked || !candidate.technicallyReady) {
        return emptyPlan("charge", createdAt, commandRevision, candidate.blockReason ?? "candidate_blocked", false, mapping);
    }
    if (mapping.controlModel === "evcc") {
        return buildEvccChargePlan(candidate, mapping, chargeModeActive, createdAt, commandRevision);
    }
    return buildLegacyChargePlan(candidate, mapping, chargingEnabled, createdAt, commandRevision);
}
exports.buildWallboxWritePlan = buildWallboxWritePlan;
