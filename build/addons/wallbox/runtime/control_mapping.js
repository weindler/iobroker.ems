"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildWallboxControlMappingSnapshot = exports.classifyWallboxControlTargetKind = void 0;
const mapping_config_1 = require("../../../mapping_config");
function mappingEnabled(config, prefix) {
    return config[`${prefix}_enabled`] !== false;
}
function flatTarget(config, prefix) {
    const t = config[`${prefix}_target`];
    return typeof t === "string" ? t.trim() : "";
}
/** Heuristik: evcc.* = EVCC-State, go-e.* = direkter go-eCharger-Pfad, sonst frei konfiguriert. */
function classifyWallboxControlTargetKind(stateId) {
    const id = stateId.trim().toLowerCase();
    if (id.startsWith("evcc."))
        return "evcc";
    if (id.startsWith("go-e."))
        return "goe_direct";
    return "user_configured";
}
exports.classifyWallboxControlTargetKind = classifyWallboxControlTargetKind;
function entryFromConfig(role, config, legacy, readbackStateId, required) {
    const prefix = mapping_config_1.WALLBOX_FLAT_PREFIX[role];
    const enabled = mappingEnabled(config, prefix);
    const targetStateId = legacy[role]?.target_state?.trim() || flatTarget(config, prefix);
    if (!enabled || !targetStateId) {
        return null;
    }
    const valueType = role === "set_enabled" ? "boolean" : "number";
    return {
        role,
        configured: true,
        targetStateId,
        targetValueType: valueType,
        targetKind: classifyWallboxControlTargetKind(targetStateId),
        allowedValuesRaw: typeof legacy[role]?.allowed_values === "string" ? legacy[role].allowed_values : null,
        readbackStateId: typeof readbackStateId === "string" && readbackStateId.trim().length > 0
            ? readbackStateId.trim()
            : null,
        required,
    };
}
function resolveChargeControlRole(setCurrentA, setChargePowerW) {
    if (setCurrentA && setChargePowerW) {
        if (setCurrentA.targetStateId === setChargePowerW.targetStateId) {
            return {
                chargeControlRole: null,
                ambiguousPowerControl: true,
                mappingConflictReason: "ambiguous_power_control_mapping",
            };
        }
        return {
            chargeControlRole: "set_current_a",
            ambiguousPowerControl: false,
            mappingConflictReason: null,
        };
    }
    if (setCurrentA) {
        return {
            chargeControlRole: "set_current_a",
            ambiguousPowerControl: false,
            mappingConflictReason: null,
        };
    }
    if (setChargePowerW) {
        return {
            chargeControlRole: "set_charge_power_w",
            ambiguousPowerControl: false,
            mappingConflictReason: null,
        };
    }
    return {
        chargeControlRole: null,
        ambiguousPowerControl: false,
        mappingConflictReason: null,
    };
}
function computeEvccControlPathConfirmed(setEnabled, chargeEntry) {
    if (!setEnabled || !chargeEntry)
        return false;
    return setEnabled.targetKind === "evcc" && chargeEntry.targetKind === "evcc";
}
/**
 * Normalisierter Control-Mapping-Snapshot aus Admin-Config und Telemetrie-IDs (read-only).
 * Keine ioBroker-Objektauflösung — rein aus Konfiguration.
 */
function buildWallboxControlMappingSnapshot(input) {
    const { config, telemetryCfg } = input;
    const legacy = (0, mapping_config_1.legacyWallboxMappingFromConfig)(config);
    const setEnabled = entryFromConfig("set_enabled", config, legacy, telemetryCfg.enabledStateId, true);
    const setCurrentA = entryFromConfig("set_current_a", config, legacy, "", false);
    const setChargePowerW = entryFromConfig("set_charge_power_w", config, legacy, telemetryCfg.chargePowerWStateId, false);
    const missingRoles = [];
    if (!setEnabled)
        missingRoles.push("set_enabled");
    const roleResolution = resolveChargeControlRole(setCurrentA, setChargePowerW);
    if (!roleResolution.chargeControlRole && !roleResolution.ambiguousPowerControl) {
        missingRoles.push("set_current_a|set_charge_power_w");
    }
    const chargeEntry = roleResolution.chargeControlRole === "set_current_a"
        ? setCurrentA
        : roleResolution.chargeControlRole === "set_charge_power_w"
            ? setChargePowerW
            : null;
    return {
        controlModel: "legacy_goe",
        setEnabled,
        setCurrentA,
        setChargePowerW,
        chargeControlRole: roleResolution.chargeControlRole,
        missingRoles,
        ambiguousPowerControl: roleResolution.ambiguousPowerControl,
        mappingConflictReason: roleResolution.mappingConflictReason,
        evccControlPathConfirmed: computeEvccControlPathConfirmed(setEnabled, chargeEntry),
    };
}
exports.buildWallboxControlMappingSnapshot = buildWallboxControlMappingSnapshot;
