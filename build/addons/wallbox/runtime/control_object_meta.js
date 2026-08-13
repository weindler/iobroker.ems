"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.expectedTypeForEvccRole = exports.validateEnumValueAgainstMeta = exports.validateEvccControlTargetMeta = exports.validateEvccModeFeedbackMeta = exports.validateEvccButtonTargetMeta = exports.validateControlObjectMeta = exports.isEvccNamespaceStateId = exports.isDirectGoeStateId = exports.resolveWallboxControlObjectMetas = exports.resolveWallboxControlObjectMeta = exports.metaFromObject = exports.validateEvccSemanticRole = exports.requiredSemanticForEvccRole = exports.inferEvccSemanticRole = exports.classifyWallboxControlTargetKind = void 0;
const evcc_mode_control_1 = require("../evcc_mode_control");
function classifyWallboxControlTargetKind(stateId) {
    const id = stateId.trim().toLowerCase();
    if (id.startsWith("evcc."))
        return "evcc";
    if (id.startsWith("go-e."))
        return "goe_direct";
    return "user_configured";
}
exports.classifyWallboxControlTargetKind = classifyWallboxControlTargetKind;
/** Heuristische EVCC-Semantik aus State-ID — nicht allein aus common.write oder evcc.*-Präfix. */
function inferEvccSemanticRole(stateId) {
    const id = stateId.trim().toLowerCase();
    if ((0, evcc_mode_control_1.isEvccModeFeedbackStateId)(stateId))
        return "evcc_mode_feedback";
    if ((0, evcc_mode_control_1.isEvccModeButtonStateId)(stateId, "off"))
        return "evcc_mode_button_off";
    if ((0, evcc_mode_control_1.isEvccModeButtonStateId)(stateId, "pv"))
        return "evcc_mode_button_pv";
    if ((0, evcc_mode_control_1.isEvccModeButtonStateId)(stateId, "now"))
        return "evcc_mode_button_now";
    if ((0, evcc_mode_control_1.isEvccModeButtonStateId)(stateId, "min"))
        return "evcc_mode_button_min";
    if (id.includes("mincurrent"))
        return "evcc_min_current";
    if (id.includes("maxcurrent"))
        return "evcc_max_current";
    if (id.includes(".enabled") || id.endsWith("enabled"))
        return "evcc_enabled_status";
    if (id.includes("mode"))
        return "evcc_mode";
    if (id.includes("phase"))
        return "evcc_phases";
    return "unknown";
}
exports.inferEvccSemanticRole = inferEvccSemanticRole;
function requiredSemanticForEvccRole(role) {
    switch (role) {
        case "set_mode":
            return "evcc_mode";
        case "set_max_current_a":
            return "evcc_max_current";
        case "set_phase":
            return "evcc_phases";
        default:
            return "unknown";
    }
}
exports.requiredSemanticForEvccRole = requiredSemanticForEvccRole;
function validateEvccSemanticRole(role, stateId) {
    const semanticRole = inferEvccSemanticRole(stateId);
    const required = requiredSemanticForEvccRole(role);
    if (semanticRole === "evcc_min_current") {
        return { valid: false, reason: "min_current_not_max_current", semanticRole };
    }
    if (role === "set_mode" && semanticRole === "evcc_enabled_status") {
        return { valid: false, reason: "enabled_not_evcc_mode", semanticRole };
    }
    if (semanticRole !== required) {
        return { valid: false, reason: `${required}_semantics_unconfirmed`, semanticRole };
    }
    return { valid: true, reason: null, semanticRole };
}
exports.validateEvccSemanticRole = validateEvccSemanticRole;
function metaFromObject(stateId, obj) {
    if (!obj || !obj.common) {
        return {
            stateId,
            objectPresent: false,
            writable: false,
            readable: false,
            commonType: null,
            allowedStateKeys: null,
        };
    }
    const common = obj.common;
    const states = common.states;
    let allowedStateKeys = null;
    if (states && typeof states === "object") {
        allowedStateKeys = Object.keys(states);
    }
    return {
        stateId,
        objectPresent: true,
        writable: common.write === true,
        readable: common.read !== false,
        commonType: typeof common.type === "string" ? common.type : null,
        allowedStateKeys,
    };
}
exports.metaFromObject = metaFromObject;
async function resolveWallboxControlObjectMeta(getObjectAsync, stateId) {
    const id = stateId.trim();
    if (!id || !getObjectAsync) {
        return {
            stateId: id,
            objectPresent: false,
            writable: false,
            readable: false,
            commonType: null,
            allowedStateKeys: null,
        };
    }
    try {
        const obj = await getObjectAsync(id);
        return metaFromObject(id, obj);
    }
    catch {
        return metaFromObject(id, null);
    }
}
exports.resolveWallboxControlObjectMeta = resolveWallboxControlObjectMeta;
async function resolveWallboxControlObjectMetas(getObjectAsync, stateIds) {
    const unique = [...new Set(stateIds.map((s) => s.trim()).filter(Boolean))];
    const out = {};
    await Promise.all(unique.map(async (id) => {
        out[id] = await resolveWallboxControlObjectMeta(getObjectAsync, id);
    }));
    return out;
}
exports.resolveWallboxControlObjectMetas = resolveWallboxControlObjectMetas;
function isDirectGoeStateId(stateId) {
    return stateId.trim().toLowerCase().startsWith("go-e.");
}
exports.isDirectGoeStateId = isDirectGoeStateId;
function isEvccNamespaceStateId(stateId) {
    return stateId.trim().toLowerCase().startsWith("evcc.");
}
exports.isEvccNamespaceStateId = isEvccNamespaceStateId;
function validateControlObjectMeta(meta, expectedType) {
    if (!meta || !meta.objectPresent) {
        return { valid: false, reason: "target_object_missing" };
    }
    if (!meta.writable) {
        return { valid: false, reason: "target_not_writable" };
    }
    if (meta.commonType &&
        meta.commonType !== expectedType &&
        meta.commonType !== "mixed") {
        return { valid: false, reason: "target_type_mismatch" };
    }
    return { valid: true, reason: null };
}
exports.validateControlObjectMeta = validateControlObjectMeta;
/** Button-States: write=true / read=false are valid write targets. */
function validateEvccButtonTargetMeta(stateId, button, meta) {
    const semanticRole = inferEvccSemanticRole(stateId);
    if (isDirectGoeStateId(stateId)) {
        return { valid: false, reason: "goe_target_not_evcc_compatible", semanticRole };
    }
    if (!isEvccNamespaceStateId(stateId)) {
        return { valid: false, reason: "evcc_namespace_not_confirmed", semanticRole };
    }
    if ((0, evcc_mode_control_1.isEvccModeFeedbackStateId)(stateId)) {
        return { valid: false, reason: "mode_feedback_not_a_write_target", semanticRole };
    }
    if (!(0, evcc_mode_control_1.isEvccModeButtonStateId)(stateId, button)) {
        return { valid: false, reason: `${evcc_mode_control_1.EVCC_BUTTON_SUFFIXES[button]}_semantics_unconfirmed`, semanticRole };
    }
    const base = validateControlObjectMeta(meta, "boolean");
    if (!base.valid) {
        return { ...base, semanticRole };
    }
    return { valid: true, reason: null, semanticRole };
}
exports.validateEvccButtonTargetMeta = validateEvccButtonTargetMeta;
function validateEvccModeFeedbackMeta(stateId, meta) {
    if (isDirectGoeStateId(stateId)) {
        return { valid: false, reason: "goe_target_not_evcc_compatible" };
    }
    if (!stateId.trim()) {
        return { valid: false, reason: "mode_feedback_unmapped" };
    }
    if (!meta || !meta.objectPresent) {
        return { valid: false, reason: "mode_feedback_object_missing" };
    }
    if (meta.writable && !meta.readable) {
        return { valid: false, reason: "mode_feedback_not_readable" };
    }
    return { valid: true, reason: null };
}
exports.validateEvccModeFeedbackMeta = validateEvccModeFeedbackMeta;
function validateEvccControlTargetMeta(stateId, expectedType, meta, role) {
    if (isDirectGoeStateId(stateId)) {
        return { valid: false, reason: "goe_target_not_evcc_compatible", semanticRole: inferEvccSemanticRole(stateId) };
    }
    if (!isEvccNamespaceStateId(stateId)) {
        return { valid: false, reason: "evcc_namespace_not_confirmed", semanticRole: inferEvccSemanticRole(stateId) };
    }
    if ((0, evcc_mode_control_1.isEvccModeFeedbackStateId)(stateId)) {
        return {
            valid: false,
            reason: "mode_feedback_not_a_write_target",
            semanticRole: inferEvccSemanticRole(stateId),
        };
    }
    const semantic = validateEvccSemanticRole(role, stateId);
    if (!semantic.valid) {
        return { valid: false, reason: semantic.reason, semanticRole: semantic.semanticRole };
    }
    const base = validateControlObjectMeta(meta, expectedType);
    if (!base.valid) {
        return { ...base, semanticRole: semantic.semanticRole };
    }
    return { valid: true, reason: null, semanticRole: semantic.semanticRole };
}
exports.validateEvccControlTargetMeta = validateEvccControlTargetMeta;
function validateEnumValueAgainstMeta(value, meta) {
    if (!meta?.allowedStateKeys || meta.allowedStateKeys.length === 0) {
        return { valid: false, reason: "enum_values_unconfirmed" };
    }
    if (!meta.allowedStateKeys.includes(value)) {
        return { valid: false, reason: "enum_value_not_allowed" };
    }
    return { valid: true, reason: null };
}
exports.validateEnumValueAgainstMeta = validateEnumValueAgainstMeta;
function expectedTypeForEvccRole(role) {
    switch (role) {
        case "set_max_current_a":
        case "set_phase":
            return "number";
        case "set_mode":
            return "string";
        default:
            return "string";
    }
}
exports.expectedTypeForEvccRole = expectedTypeForEvccRole;
