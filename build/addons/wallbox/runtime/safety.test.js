"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const ownership_js_1 = require("./ownership.js");
const fault_js_1 = require("./fault.js");
const restore_js_1 = require("./restore.js");
const NOW_ISO = "2026-07-20T10:00:00.000Z";
function baseMapping(over = {}) {
    return {
        controlModel: "evcc",
        legacyMappingsPresent: false,
        evccMappingsPresent: true,
        setEnabled: null,
        setCurrentA: null,
        setChargePowerW: null,
        setMode: {
            role: "set_mode",
            configured: true,
            targetStateId: "evcc.0.loadpoint.1.mode",
            targetValueType: "string",
            targetKind: "evcc",
            semanticRole: "evcc_mode",
            allowedValuesRaw: null,
            readbackStateId: "evcc.0.loadpoint.1.mode",
            required: true,
            objectPresent: true,
            writable: true,
            commonType: "string",
            contractValid: true,
            validationReason: null,
        },
        setMaxCurrentA: null,
        setPhase: null,
        evccChargeModeValue: "pv",
        evccHoldModeValue: "off",
        chargeModeValueConfirmed: true,
        holdModeValueConfirmed: true,
        chargeControlRole: null,
        missingRoles: [],
        ambiguousPowerControl: false,
        mappingConflictReason: null,
        evccControlPathConfirmed: true,
        liveEligible: true,
        controlPathReason: "evcc_control_path_confirmed",
        validationIssues: [],
        controlContractModel: "evcc_string_mode",
        evccControlContractReady: false,
        legacyDirectControlPresent: false,
        evccModeControlVariant: "string_mode",
        evccModeFeedbackStateId: "evcc.0.loadpoint.1.status.mode",
        evccModeButtonsReady: false,
        evccModeButtonReady: { off: false, pv: false, min: false, now: false },
        activeContractInputs: {},
        ignoredLegacyConfig: {},
        ...over,
    };
}
(0, node_test_1.describe)("wallbox ownership", () => {
    (0, node_test_1.it)("starts empty/inactive", () => {
        const o = (0, ownership_js_1.emptyWallboxOwnership)();
        strict_1.default.equal(o.active, false);
        strict_1.default.equal((0, ownership_js_1.canSafeRestoreWallbox)(o), false);
    });
    (0, node_test_1.it)("grant marks ownership active with control model and timestamp", () => {
        const o = (0, ownership_js_1.grantWallboxOwnership)("evcc", "charge_start", NOW_ISO);
        strict_1.default.equal(o.active, true);
        strict_1.default.equal(o.controlModel, "evcc");
        strict_1.default.equal(o.writeScenario, "charge_start");
        strict_1.default.equal(o.startedAt, NOW_ISO);
        strict_1.default.equal((0, ownership_js_1.canSafeRestoreWallbox)(o), true);
    });
    (0, node_test_1.it)("none control model cannot safe-restore", () => {
        const o = (0, ownership_js_1.grantWallboxOwnership)("none", null, NOW_ISO);
        strict_1.default.equal((0, ownership_js_1.canSafeRestoreWallbox)(o), false);
    });
});
(0, node_test_1.describe)("wallbox fault/lockout", () => {
    (0, node_test_1.it)("starts empty/inactive", () => {
        const f = (0, fault_js_1.emptyWallboxFault)();
        strict_1.default.equal(f.active, false);
        strict_1.default.equal(f.code, null);
    });
    (0, node_test_1.it)("raise sets active fault with code/message/timestamp", () => {
        const f = (0, fault_js_1.raiseWallboxFault)("feedback_mismatch", "value mismatch", NOW_ISO);
        strict_1.default.equal(f.active, true);
        strict_1.default.equal(f.code, "feedback_mismatch");
        strict_1.default.equal(f.message, "value mismatch");
        strict_1.default.equal(f.since, NOW_ISO);
    });
    (0, node_test_1.it)("clear resets to empty", () => {
        const f = (0, fault_js_1.clearWallboxFault)();
        strict_1.default.equal(f.active, false);
        strict_1.default.equal(f.code, null);
    });
    (0, node_test_1.it)("maps feedback statuses to fault codes, ignores non-terminal statuses", () => {
        strict_1.default.equal((0, fault_js_1.faultCodeForFeedbackStatus)("mismatch"), "feedback_mismatch");
        strict_1.default.equal((0, fault_js_1.faultCodeForFeedbackStatus)("timeout"), "feedback_timeout");
        strict_1.default.equal((0, fault_js_1.faultCodeForFeedbackStatus)("invalid"), "feedback_invalid");
        strict_1.default.equal((0, fault_js_1.faultCodeForFeedbackStatus)("matched"), null);
        strict_1.default.equal((0, fault_js_1.faultCodeForFeedbackStatus)("pending"), null);
        strict_1.default.equal((0, fault_js_1.faultCodeForFeedbackStatus)("not_required"), null);
    });
});
(0, node_test_1.describe)("wallbox safe restore plan", () => {
    (0, node_test_1.it)("no ownership → not required", () => {
        const plan = (0, restore_js_1.planWallboxSafeRestore)((0, ownership_js_1.emptyWallboxOwnership)(), baseMapping());
        strict_1.default.equal(plan.required, false);
        strict_1.default.equal(plan.reason, "no_ownership");
    });
    (0, node_test_1.it)("legacy_direct ownership is never restorable (never live-eligible in the first place)", () => {
        const ownership = (0, ownership_js_1.grantWallboxOwnership)("legacy_direct", "charge_start", NOW_ISO);
        const plan = (0, restore_js_1.planWallboxSafeRestore)(ownership, baseMapping({ controlModel: "legacy_direct" }));
        strict_1.default.equal(plan.required, false);
        strict_1.default.equal(plan.reason, "control_model_not_restorable");
    });
    (0, node_test_1.it)("evcc ownership with confirmed hold mapping produces a restore write to the hold value", () => {
        const ownership = (0, ownership_js_1.grantWallboxOwnership)("evcc", "charge_start", NOW_ISO);
        const plan = (0, restore_js_1.planWallboxSafeRestore)(ownership, baseMapping());
        strict_1.default.equal(plan.required, true);
        strict_1.default.equal(plan.possible, true);
        strict_1.default.equal(plan.operation?.targetStateId, "evcc.0.loadpoint.1.mode");
        strict_1.default.equal(plan.operation?.targetValue, "off");
    });
    (0, node_test_1.it)("evcc ownership without confirmed hold mapping cannot restore", () => {
        const ownership = (0, ownership_js_1.grantWallboxOwnership)("evcc", "charge_start", NOW_ISO);
        const plan = (0, restore_js_1.planWallboxSafeRestore)(ownership, baseMapping({ holdModeValueConfirmed: false, evccHoldModeValue: null }));
        strict_1.default.equal(plan.required, true);
        strict_1.default.equal(plan.possible, false);
        strict_1.default.equal(plan.operation, null);
        strict_1.default.equal(plan.reason, "hold_mapping_undefined");
    });
});
