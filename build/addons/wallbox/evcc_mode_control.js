"use strict";
/**
 * EVCC mode-control variants (v0.1.275).
 * buttons = current recommended ioBroker/EVCC interface; pv_control and string_mode remain legacy.
 * Diagnosis only — no live writes in this phase.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.collectEvccButtonWriteStateIds = exports.controlContractModelFromVariant = exports.resolveEvccModeControlContract = exports.stringModeContractComplete = exports.pickEvccButtonStateId = exports.resolveEvccModeFeedbackStateId = exports.isEvccModeButtonStateId = exports.isEvccModeFeedbackStateId = exports.parseEvccModeControlRequested = exports.EVCC_FEEDBACK_MODE_VALUES = exports.EVCC_MODE_CONTROL_REQUESTED = exports.EVCC_MODE_FEEDBACK_SUFFIX = exports.WB_EVCC_MODE_CONTROL = exports.WB_EVCC_CONTROL_PV = exports.WB_EVCC_CONTROL_OFF = exports.WB_EVCC_CONTROL_NOW = exports.WB_EVCC_CONTROL_MIN = exports.EVCC_BUTTON_SUFFIXES = void 0;
const constants_1 = require("../../intent/core/constants");
const evcc_config_1 = require("./evcc_config");
const evcc_control_config_1 = require("./evcc_control_config");
Object.defineProperty(exports, "EVCC_BUTTON_SUFFIXES", { enumerable: true, get: function () { return evcc_control_config_1.EVCC_BUTTON_SUFFIXES; } });
Object.defineProperty(exports, "WB_EVCC_CONTROL_MIN", { enumerable: true, get: function () { return evcc_control_config_1.WB_EVCC_CONTROL_MIN; } });
Object.defineProperty(exports, "WB_EVCC_CONTROL_NOW", { enumerable: true, get: function () { return evcc_control_config_1.WB_EVCC_CONTROL_NOW; } });
Object.defineProperty(exports, "WB_EVCC_CONTROL_OFF", { enumerable: true, get: function () { return evcc_control_config_1.WB_EVCC_CONTROL_OFF; } });
Object.defineProperty(exports, "WB_EVCC_CONTROL_PV", { enumerable: true, get: function () { return evcc_control_config_1.WB_EVCC_CONTROL_PV; } });
Object.defineProperty(exports, "WB_EVCC_MODE_CONTROL", { enumerable: true, get: function () { return evcc_control_config_1.WB_EVCC_MODE_CONTROL; } });
exports.EVCC_MODE_FEEDBACK_SUFFIX = "status.mode";
exports.EVCC_MODE_CONTROL_REQUESTED = [
    "auto",
    "buttons",
    "pv_control",
    "string_mode",
];
exports.EVCC_FEEDBACK_MODE_VALUES = ["off", "pv", "min", "now"];
function rejectDirectGoeId(stateId) {
    const id = stateId.trim();
    if (!id)
        return "";
    if (id.toLowerCase().startsWith("go-e."))
        return "";
    return id;
}
function pickMatchingId(c, key, suffix) {
    const dedicated = rejectDirectGoeId((0, evcc_control_config_1.strConfigField)(c, key));
    if (dedicated && (0, evcc_control_config_1.matchesEvccControlSuffix)(dedicated, suffix))
        return dedicated;
    return "";
}
function parseEvccModeControlRequested(raw) {
    const s = String(raw ?? "auto").trim().toLowerCase();
    if (s === "buttons" || s === "pv_control" || s === "string_mode")
        return s;
    return "auto";
}
exports.parseEvccModeControlRequested = parseEvccModeControlRequested;
function isEvccModeFeedbackStateId(stateId) {
    const id = rejectDirectGoeId(stateId);
    if (!id)
        return false;
    return (0, evcc_control_config_1.matchesEvccControlSuffix)(id, exports.EVCC_MODE_FEEDBACK_SUFFIX);
}
exports.isEvccModeFeedbackStateId = isEvccModeFeedbackStateId;
function isEvccModeButtonStateId(stateId, button) {
    const id = rejectDirectGoeId(stateId);
    if (!id)
        return false;
    return (0, evcc_control_config_1.matchesEvccControlSuffix)(id, evcc_control_config_1.EVCC_BUTTON_SUFFIXES[button]);
}
exports.isEvccModeButtonStateId = isEvccModeButtonStateId;
/** status.mode is feedback — never a write target. */
function resolveEvccModeFeedbackStateId(config) {
    const c = config && typeof config === "object" ? config : {};
    const loadpoint = rejectDirectGoeId((0, evcc_control_config_1.strConfigField)(c, evcc_config_1.WB_EVCC_LOADPOINT_MODE));
    if (loadpoint && isEvccModeFeedbackStateId(loadpoint))
        return loadpoint;
    if (loadpoint && loadpoint.toLowerCase().startsWith("evcc.") && loadpoint.toLowerCase().includes("mode")) {
        return loadpoint;
    }
    const intent = rejectDirectGoeId((0, evcc_control_config_1.strConfigField)(c, constants_1.ADMIN_INTENT_EVCC_MODE_STATE));
    if (intent && isEvccModeFeedbackStateId(intent))
        return intent;
    if (intent && intent.toLowerCase().startsWith("evcc.") && intent.toLowerCase().includes("mode")) {
        return intent;
    }
    return "";
}
exports.resolveEvccModeFeedbackStateId = resolveEvccModeFeedbackStateId;
function pickEvccButtonStateId(config, button) {
    const c = config && typeof config === "object" ? config : {};
    const keys = {
        off: evcc_control_config_1.WB_EVCC_CONTROL_OFF,
        pv: evcc_control_config_1.WB_EVCC_CONTROL_PV,
        min: evcc_control_config_1.WB_EVCC_CONTROL_MIN,
        now: evcc_control_config_1.WB_EVCC_CONTROL_NOW,
    };
    return pickMatchingId(c, keys[button], evcc_control_config_1.EVCC_BUTTON_SUFFIXES[button]);
}
exports.pickEvccButtonStateId = pickEvccButtonStateId;
function stringModeContractComplete(config) {
    const c = config && typeof config === "object" ? config : {};
    return ((0, evcc_control_config_1.evccControlTargetForRole)(c, "set_mode").length > 0 &&
        (0, evcc_control_config_1.evccControlTargetForRole)(c, "set_max_current_a").length > 0 &&
        (0, evcc_control_config_1.evccModeChargeValue)(c).length > 0);
}
exports.stringModeContractComplete = stringModeContractComplete;
function compactRecord(input) {
    const out = {};
    for (const [key, value] of Object.entries(input)) {
        if (value === null || value === undefined || value === "" || value === false)
            continue;
        if (typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0) {
            continue;
        }
        out[key] = value;
    }
    return out;
}
function autoDetectVariant(input) {
    if (input.buttonsComplete)
        return "buttons";
    if (input.pvControlMapped)
        return "pv_control";
    if (input.stringModeComplete)
        return "string_mode";
    return "buttons";
}
/**
 * Resolves the active EVCC mode-control variant and structural completeness.
 * Never falls back to go-e. pvControl does not affect the buttons variant.
 */
function resolveEvccModeControlContract(config) {
    const c = config && typeof config === "object" ? config : {};
    const requestedVariant = parseEvccModeControlRequested(c[evcc_control_config_1.WB_EVCC_MODE_CONTROL]);
    const offStateId = pickEvccButtonStateId(c, "off");
    const pvStateId = pickEvccButtonStateId(c, "pv");
    const minStateId = pickEvccButtonStateId(c, "min");
    const nowStateId = pickEvccButtonStateId(c, "now");
    const buttonReady = {
        off: Boolean(offStateId),
        pv: Boolean(pvStateId),
        min: Boolean(minStateId),
        now: Boolean(nowStateId),
    };
    const modeFeedbackStateId = resolveEvccModeFeedbackStateId(c);
    const v1 = (0, evcc_control_config_1.resolveEvccControlContractV1)(c);
    const stringComplete = stringModeContractComplete(c);
    const buttonsModeReady = buttonReady.off && buttonReady.pv && buttonReady.min && buttonReady.now;
    const buttonsReady = buttonsModeReady && Boolean(modeFeedbackStateId);
    const resolvedVariant = requestedVariant === "auto"
        ? autoDetectVariant({
            buttonsComplete: buttonsReady,
            pvControlMapped: Boolean(v1.pvControlStateId),
            stringModeComplete: stringComplete,
        })
        : requestedVariant;
    const maxCurrentStateId = v1.maxCurrentStateId;
    const phasesConfiguredStateId = v1.phasesConfiguredStateId;
    const missing = [];
    let modeContractReady = false;
    let writeContractReady = false;
    if (resolvedVariant === "buttons") {
        if (!buttonReady.off)
            missing.push(evcc_control_config_1.EVCC_BUTTON_SUFFIXES.off);
        if (!buttonReady.pv)
            missing.push(evcc_control_config_1.EVCC_BUTTON_SUFFIXES.pv);
        if (!buttonReady.min)
            missing.push(evcc_control_config_1.EVCC_BUTTON_SUFFIXES.min);
        if (!buttonReady.now)
            missing.push(evcc_control_config_1.EVCC_BUTTON_SUFFIXES.now);
        if (!modeFeedbackStateId)
            missing.push(exports.EVCC_MODE_FEEDBACK_SUFFIX);
        modeContractReady = buttonsReady;
        if (!maxCurrentStateId)
            missing.push(evcc_control_config_1.EVCC_CONTROL_V1_SUFFIXES.maxCurrent);
        if (!phasesConfiguredStateId)
            missing.push(evcc_control_config_1.EVCC_CONTROL_V1_SUFFIXES.phasesConfigured);
        writeContractReady = modeContractReady && Boolean(maxCurrentStateId) && Boolean(phasesConfiguredStateId);
    }
    else if (resolvedVariant === "pv_control") {
        missing.push(...v1.missing);
        modeContractReady = Boolean(v1.pvControlStateId);
        writeContractReady = v1.ready;
    }
    else if (resolvedVariant === "string_mode") {
        if (!(0, evcc_control_config_1.evccControlTargetForRole)(c, "set_mode"))
            missing.push("set_mode");
        if (!(0, evcc_control_config_1.evccControlTargetForRole)(c, "set_max_current_a"))
            missing.push("set_max_current_a");
        if (!(0, evcc_control_config_1.evccModeChargeValue)(c))
            missing.push("evcc_charge_mode_value");
        modeContractReady = stringComplete;
        writeContractReady = stringComplete;
    }
    const storedSetMode = (0, evcc_control_config_1.evccControlTargetForRole)(c, "set_mode");
    const storedChargeValue = (0, evcc_control_config_1.evccModeChargeValue)(c);
    const storedHoldValue = (0, evcc_control_config_1.evccModeHoldValue)(c);
    const storedButtons = compactRecord({
        off: offStateId,
        pv: pvStateId,
        min: minStateId,
        now: nowStateId,
    });
    let activeInputs = {};
    let ignoredLegacyConfig = {};
    if (resolvedVariant === "buttons") {
        activeInputs = compactRecord({
            off: offStateId,
            pv: pvStateId,
            min: minStateId,
            now: nowStateId,
            feedback: modeFeedbackStateId,
            maxCurrent: maxCurrentStateId,
            phasesConfigured: phasesConfiguredStateId,
        });
        ignoredLegacyConfig = compactRecord({
            pvControl: v1.pvControlStateId,
            setMode: storedSetMode,
            chargeValue: storedChargeValue,
            holdValue: storedHoldValue,
        });
    }
    else if (resolvedVariant === "pv_control") {
        activeInputs = compactRecord({
            pvControl: v1.pvControlStateId,
            maxCurrent: maxCurrentStateId,
            phasesConfigured: phasesConfiguredStateId,
        });
        ignoredLegacyConfig = compactRecord({
            buttons: storedButtons,
            setMode: storedSetMode,
            chargeValue: storedChargeValue,
            holdValue: storedHoldValue,
        });
    }
    else if (resolvedVariant === "string_mode") {
        activeInputs = compactRecord({
            setMode: storedSetMode,
            maxCurrent: (0, evcc_control_config_1.evccControlTargetForRole)(c, "set_max_current_a") || maxCurrentStateId,
            phases: (0, evcc_control_config_1.evccControlTargetForRole)(c, "set_phase"),
            chargeValue: storedChargeValue,
            holdValue: storedHoldValue,
        });
        ignoredLegacyConfig = compactRecord({
            buttons: storedButtons,
            pvControl: v1.pvControlStateId,
        });
    }
    const detail = {
        requestedVariant,
        resolvedVariant,
        modeFeedbackStateId: modeFeedbackStateId || null,
        buttons: {
            off: offStateId || null,
            pv: pvStateId || null,
            min: minStateId || null,
            now: nowStateId || null,
            ready: buttonsReady,
        },
        activeInputs,
        ignoredLegacyConfig,
        pvControlStateId: resolvedVariant === "pv_control" ? v1.pvControlStateId || null : null,
        maxCurrentStateId: maxCurrentStateId || null,
        phasesConfiguredStateId: phasesConfiguredStateId || null,
        modeContractReady,
        writeContractReady,
        missing,
        pvControlIgnoredForButtons: resolvedVariant === "buttons",
        stringModeIgnoredForButtons: resolvedVariant === "buttons",
        requiresChargeModeValue: resolvedVariant === "string_mode",
        requiresPvControl: resolvedVariant === "pv_control",
        usesLegacyGoeFallback: false,
        liveDispatchSupported: false,
    };
    return {
        requestedVariant,
        resolvedVariant,
        modeFeedbackStateId,
        offStateId,
        pvStateId,
        minStateId,
        nowStateId,
        buttonReady,
        buttonsReady,
        pvControlStateId: v1.pvControlStateId,
        maxCurrentStateId,
        phasesConfiguredStateId,
        modeContractReady,
        writeContractReady,
        missing,
        usesLegacyGoeFallback: false,
        detail,
    };
}
exports.resolveEvccModeControlContract = resolveEvccModeControlContract;
function controlContractModelFromVariant(controlModel, variant) {
    if (controlModel === "none")
        return "none";
    if (controlModel === "legacy_direct")
        return "legacy_direct";
    if (variant === "buttons")
        return "evcc_buttons";
    if (variant === "pv_control")
        return "evcc_control_v1";
    if (variant === "string_mode")
        return "evcc_string_mode";
    return "evcc_buttons";
}
exports.controlContractModelFromVariant = controlContractModelFromVariant;
function collectEvccButtonWriteStateIds(contract) {
    return [contract.offStateId, contract.pvStateId, contract.minStateId, contract.nowStateId].filter((id) => id.length > 0);
}
exports.collectEvccButtonWriteStateIds = collectEvccButtonWriteStateIds;
