"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.collectConfiguredControlTargetStateIds = exports.buildWallboxControlMappingSnapshot = exports.classifyWallboxControlTargetKind = void 0;
const mapping_config_1 = require("../../../mapping_config");
const evcc_control_config_1 = require("../evcc_control_config");
Object.defineProperty(exports, "collectConfiguredControlTargetStateIds", { enumerable: true, get: function () { return evcc_control_config_1.collectConfiguredControlTargetStateIds; } });
const evcc_config_1 = require("../evcc_config");
const control_object_meta_1 = require("./control_object_meta");
var control_object_meta_2 = require("./control_object_meta");
Object.defineProperty(exports, "classifyWallboxControlTargetKind", { enumerable: true, get: function () { return control_object_meta_2.classifyWallboxControlTargetKind; } });
function mappingEnabled(config, prefix) {
    return config[`${prefix}_enabled`] !== false;
}
function flatTarget(config, prefix) {
    const t = config[`${prefix}_target`];
    return typeof t === "string" ? t.trim() : "";
}
function legacySemanticRole(role) {
    if (role === "set_enabled")
        return "legacy_enabled";
    if (role === "set_current_a")
        return "legacy_current";
    return "legacy_power";
}
function applyMetaValidation(entry, meta, evccPath, evccRole) {
    let contractValid = true;
    let validationReason = null;
    let semanticRole = (0, control_object_meta_1.inferEvccSemanticRole)(entry.targetStateId);
    if (evccPath && evccRole) {
        const v = (0, control_object_meta_1.validateEvccControlTargetMeta)(entry.targetStateId, entry.targetValueType, meta, evccRole);
        contractValid = v.valid;
        validationReason = v.reason;
        semanticRole = v.semanticRole;
    }
    else if (meta) {
        const v = (0, control_object_meta_1.validateControlObjectMeta)(meta, entry.targetValueType);
        contractValid = v.valid;
        validationReason = v.reason;
    }
    else {
        contractValid = false;
        validationReason = "object_metadata_unverified";
    }
    return {
        ...entry,
        semanticRole,
        objectPresent: meta?.objectPresent ?? false,
        writable: meta?.writable ?? false,
        commonType: meta?.commonType ?? null,
        contractValid,
        validationReason,
    };
}
function legacyEntryFromConfig(role, config, legacy, readbackStateId, required, meta) {
    const prefix = mapping_config_1.WALLBOX_FLAT_PREFIX[role];
    const enabled = mappingEnabled(config, prefix);
    const targetStateId = legacy[role]?.target_state?.trim() || flatTarget(config, prefix);
    if (!enabled || !targetStateId)
        return null;
    const valueType = role === "set_enabled" ? "boolean" : "number";
    const entry = applyMetaValidation({
        role,
        configured: true,
        targetStateId,
        targetValueType: valueType,
        targetKind: (0, control_object_meta_1.classifyWallboxControlTargetKind)(targetStateId),
        allowedValuesRaw: typeof legacy[role]?.allowed_values === "string" ? legacy[role].allowed_values : null,
        readbackStateId: readbackStateId?.trim() || null,
        required,
    }, meta, false);
    return { ...entry, semanticRole: legacySemanticRole(role) };
}
function evccEntryFromConfig(role, config, readbackStateId, required, meta) {
    const targetStateId = (0, evcc_control_config_1.evccControlTargetForRole)(config, role);
    if (!targetStateId)
        return null;
    return applyMetaValidation({
        role,
        configured: true,
        targetStateId,
        targetValueType: role === "set_mode" ? "string" : "number",
        targetKind: (0, control_object_meta_1.classifyWallboxControlTargetKind)(targetStateId),
        allowedValuesRaw: null,
        readbackStateId: readbackStateId?.trim() || null,
        required,
    }, meta, true, role);
}
function resolveChargeControlRole(setCurrentA, setChargePowerW) {
    if (setCurrentA && setChargePowerW && setCurrentA.targetStateId === setChargePowerW.targetStateId) {
        return { chargeControlRole: null, ambiguousPowerControl: true, mappingConflictReason: "ambiguous_power_control_mapping" };
    }
    if (setCurrentA && setChargePowerW)
        return { chargeControlRole: "set_current_a", ambiguousPowerControl: false, mappingConflictReason: null };
    if (setCurrentA)
        return { chargeControlRole: "set_current_a", ambiguousPowerControl: false, mappingConflictReason: null };
    if (setChargePowerW)
        return { chargeControlRole: "set_charge_power_w", ambiguousPowerControl: false, mappingConflictReason: null };
    return { chargeControlRole: null, ambiguousPowerControl: false, mappingConflictReason: null };
}
function collectValidationIssues(entries) {
    const issues = [];
    for (const e of entries) {
        if (e?.required && !e.contractValid && e.validationReason)
            issues.push(`${e.role}:${e.validationReason}`);
    }
    return issues;
}
function contractDiagnosis(config, controlModel) {
    const contract = (0, evcc_control_config_1.resolveEvccControlContractV1)(config);
    const stringModeComplete = (0, evcc_control_config_1.evccControlTargetForRole)(config, "set_mode").length > 0 &&
        (0, evcc_control_config_1.evccControlTargetForRole)(config, "set_max_current_a").length > 0 &&
        (0, evcc_control_config_1.evccModeChargeValue)(config).length > 0;
    return {
        controlContractModel: (0, evcc_control_config_1.resolveControlContractModel)(controlModel, contract.ready, stringModeComplete),
        evccControlContractReady: controlModel === "evcc" && contract.ready,
        legacyDirectControlPresent: (0, evcc_config_1.hasLegacyWallboxWriteMapping)(config),
    };
}
function emptyEvccFields() {
    return {
        setMode: null,
        setMaxCurrentA: null,
        setPhase: null,
        evccChargeModeValue: null,
        evccHoldModeValue: null,
        chargeModeValueConfirmed: false,
        holdModeValueConfirmed: false,
    };
}
function buildNoneSnapshot(config) {
    return {
        controlModel: "none",
        legacyMappingsPresent: (0, evcc_config_1.hasLegacyWallboxWriteMapping)(config),
        evccMappingsPresent: (0, evcc_control_config_1.hasEvccControlWriteMapping)(config),
        setEnabled: null,
        setCurrentA: null,
        setChargePowerW: null,
        ...emptyEvccFields(),
        chargeControlRole: null,
        missingRoles: ["control_model_not_selected"],
        ambiguousPowerControl: false,
        mappingConflictReason: null,
        evccControlPathConfirmed: false,
        liveEligible: false,
        controlPathReason: "control_model_not_selected",
        validationIssues: [],
        ...contractDiagnosis(config, "none"),
    };
}
function buildEvccSnapshot(config, telemetryCfg, objectMetas) {
    const meta = (id) => objectMetas[id];
    const setMode = evccEntryFromConfig("set_mode", config, telemetryCfg.modeReadbackStateId, true, meta((0, evcc_control_config_1.evccControlTargetForRole)(config, "set_mode")));
    const setMaxCurrentA = evccEntryFromConfig("set_max_current_a", config, telemetryCfg.maxCurrentAStateId, true, meta((0, evcc_control_config_1.evccControlTargetForRole)(config, "set_max_current_a")));
    const setPhase = evccEntryFromConfig("set_phase", config, "", false, meta((0, evcc_control_config_1.evccControlTargetForRole)(config, "set_phase")));
    const chargeModeValue = (0, evcc_control_config_1.evccModeChargeValue)(config) || null;
    const holdModeValue = (0, evcc_control_config_1.evccModeHoldValue)(config) || null;
    const modeMeta = setMode ? meta(setMode.targetStateId) : undefined;
    const modeValueIssues = [];
    let chargeModeValueConfirmed = false;
    let holdModeValueConfirmed = false;
    if (chargeModeValue && setMode) {
        const v = (0, control_object_meta_1.validateEnumValueAgainstMeta)(chargeModeValue, modeMeta);
        chargeModeValueConfirmed = v.valid;
        if (!v.valid)
            modeValueIssues.push(`charge_mode:${v.reason}`);
    }
    else if (!chargeModeValue) {
        modeValueIssues.push("charge_mode:evcc_charge_mode_mapping_missing");
    }
    if (holdModeValue && setMode) {
        const v = (0, control_object_meta_1.validateEnumValueAgainstMeta)(holdModeValue, modeMeta);
        holdModeValueConfirmed = v.valid;
        if (!v.valid)
            modeValueIssues.push(`hold_mode:${v.reason}`);
    }
    const missingRoles = [];
    if (!setMode)
        missingRoles.push("set_mode");
    if (!setMaxCurrentA)
        missingRoles.push("set_max_current_a");
    const validationIssues = [...collectValidationIssues([setMode, setMaxCurrentA]), ...modeValueIssues];
    const contractStructurallyComplete = missingRoles.length === 0 && validationIssues.length === 0 && chargeModeValueConfirmed;
    const evccControlPathConfirmed = Boolean(setMode?.contractValid && setMaxCurrentA?.contractValid && chargeModeValueConfirmed) &&
        setMode?.semanticRole === "evcc_mode" &&
        setMaxCurrentA?.semanticRole === "evcc_max_current";
    const liveEligible = evccControlPathConfirmed && contractStructurallyComplete;
    return {
        controlModel: "evcc",
        legacyMappingsPresent: (0, evcc_config_1.hasLegacyWallboxWriteMapping)(config),
        evccMappingsPresent: (0, evcc_control_config_1.hasEvccControlWriteMapping)(config),
        setEnabled: null,
        setCurrentA: null,
        setChargePowerW: null,
        setMode,
        setMaxCurrentA,
        setPhase,
        evccChargeModeValue: chargeModeValue,
        evccHoldModeValue: holdModeValue,
        chargeModeValueConfirmed,
        holdModeValueConfirmed,
        chargeControlRole: null,
        missingRoles,
        ambiguousPowerControl: false,
        mappingConflictReason: null,
        evccControlPathConfirmed,
        liveEligible,
        controlPathReason: contractStructurallyComplete && evccControlPathConfirmed
            ? "evcc_control_path_confirmed"
            : validationIssues[0] ?? (missingRoles.length > 0 ? "mapping_incomplete" : "evcc_control_path_unconfirmed"),
        validationIssues,
        ...contractDiagnosis(config, "evcc"),
    };
}
function buildLegacyDirectSnapshot(config, telemetryCfg, objectMetas) {
    const legacy = (0, mapping_config_1.legacyWallboxMappingFromConfig)(config);
    const meta = (id) => objectMetas[id];
    const setEnabled = legacyEntryFromConfig("set_enabled", config, legacy, telemetryCfg.enabledStateId, true, meta(legacy.set_enabled?.target_state?.trim() || flatTarget(config, mapping_config_1.WALLBOX_FLAT_PREFIX.set_enabled)));
    const setCurrentA = legacyEntryFromConfig("set_current_a", config, legacy, "", false, meta(legacy.set_current_a?.target_state?.trim() || flatTarget(config, mapping_config_1.WALLBOX_FLAT_PREFIX.set_current_a)));
    const setChargePowerW = legacyEntryFromConfig("set_charge_power_w", config, legacy, "", false, meta(legacy.set_charge_power_w?.target_state?.trim() || flatTarget(config, mapping_config_1.WALLBOX_FLAT_PREFIX.set_charge_power_w)));
    const missingRoles = [];
    if (!setEnabled)
        missingRoles.push("set_enabled");
    const roleResolution = resolveChargeControlRole(setCurrentA, setChargePowerW);
    if (!roleResolution.chargeControlRole && !roleResolution.ambiguousPowerControl)
        missingRoles.push("set_current_a|set_charge_power_w");
    const chargeEntry = roleResolution.chargeControlRole === "set_current_a" ? setCurrentA : roleResolution.chargeControlRole === "set_charge_power_w" ? setChargePowerW : null;
    const validationIssues = collectValidationIssues([setEnabled, chargeEntry]);
    const contractStructurallyComplete = missingRoles.length === 0 && !roleResolution.ambiguousPowerControl && validationIssues.length === 0;
    return {
        controlModel: "legacy_direct",
        legacyMappingsPresent: (0, evcc_config_1.hasLegacyWallboxWriteMapping)(config),
        evccMappingsPresent: (0, evcc_control_config_1.hasEvccControlWriteMapping)(config),
        setEnabled,
        setCurrentA,
        setChargePowerW,
        ...emptyEvccFields(),
        chargeControlRole: roleResolution.chargeControlRole,
        missingRoles,
        ambiguousPowerControl: roleResolution.ambiguousPowerControl,
        mappingConflictReason: roleResolution.mappingConflictReason,
        evccControlPathConfirmed: false,
        liveEligible: false,
        controlPathReason: "legacy_direct_not_live_eligible",
        validationIssues,
        ...contractDiagnosis(config, "legacy_direct"),
    };
}
function buildWallboxControlMappingSnapshot(input) {
    const controlModel = (0, evcc_control_config_1.resolveWallboxControlModel)(input.config);
    const objectMetas = input.objectMetas ?? {};
    if (controlModel === "none")
        return buildNoneSnapshot(input.config);
    if (controlModel === "evcc")
        return buildEvccSnapshot(input.config, input.telemetryCfg, objectMetas);
    return buildLegacyDirectSnapshot(input.config, input.telemetryCfg, objectMetas);
}
exports.buildWallboxControlMappingSnapshot = buildWallboxControlMappingSnapshot;
