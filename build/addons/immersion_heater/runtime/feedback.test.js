"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const feedback_js_1 = require("./feedback.js");
const engine_js_1 = require("./engine.js");
const device_config_js_1 = require("../device_config.js");
(0, node_test_1.describe)("immersion feedback normalization", () => {
    (0, node_test_1.it)("normalizes boolean feedback", () => {
        strict_1.default.equal((0, feedback_js_1.normalizeFeedbackActive)(true), true);
        strict_1.default.equal((0, feedback_js_1.normalizeFeedbackActive)(false), false);
    });
    (0, node_test_1.it)("normalizes numeric feedback", () => {
        strict_1.default.equal((0, feedback_js_1.normalizeFeedbackActive)(1), true);
        strict_1.default.equal((0, feedback_js_1.normalizeFeedbackActive)(0), false);
        strict_1.default.equal((0, feedback_js_1.normalizeFeedbackActive)(2300), true);
    });
    (0, node_test_1.it)("normalizes common string feedback", () => {
        for (const v of ["1", "true", "on", "On", "YES", "ein"]) {
            strict_1.default.equal((0, feedback_js_1.normalizeFeedbackActive)(v), true, `expected ${v} active`);
        }
        for (const v of ["0", "false", "off", "OFF", "no", "aus"]) {
            strict_1.default.equal((0, feedback_js_1.normalizeFeedbackActive)(v), false, `expected ${v} inactive`);
        }
    });
    (0, node_test_1.it)("treats unknown/empty as null (not silently inactive)", () => {
        strict_1.default.equal((0, feedback_js_1.normalizeFeedbackActive)(null), null);
        strict_1.default.equal((0, feedback_js_1.normalizeFeedbackActive)(undefined), null);
        strict_1.default.equal((0, feedback_js_1.normalizeFeedbackActive)(""), null);
        strict_1.default.equal((0, feedback_js_1.normalizeFeedbackActive)("garbage"), null);
    });
});
(0, node_test_1.describe)("immersion feedback stage", () => {
    (0, node_test_1.it)("returns 0 when nothing active", () => {
        strict_1.default.equal((0, feedback_js_1.feedbackStageFromReadings)([{ index: 1, active: false }]), 0);
        strict_1.default.equal((0, feedback_js_1.feedbackStageFromReadings)([{ index: 1, active: null }]), 0);
    });
    (0, node_test_1.it)("returns the active stage index", () => {
        strict_1.default.equal((0, feedback_js_1.feedbackStageFromReadings)([{ index: 1, active: true }]), 1);
    });
    (0, node_test_1.it)("highest active index wins", () => {
        strict_1.default.equal((0, feedback_js_1.feedbackStageFromReadings)([
            { index: 1, active: true },
            { index: 2, active: true },
            { index: 3, active: false },
        ]), 2);
    });
});
(0, node_test_1.describe)("immersion external-on classification", () => {
    (0, node_test_1.it)("feedback active while commanded off → external_on", () => {
        strict_1.default.equal((0, feedback_js_1.externalOnStatus)({ commandedStage: 0, feedbackActive: true, powerActive: false }), "external_on");
    });
    (0, node_test_1.it)("only power active while commanded off → unexpected_external_on", () => {
        strict_1.default.equal((0, feedback_js_1.externalOnStatus)({ commandedStage: 0, feedbackActive: false, powerActive: true }), "unexpected_external_on");
    });
    (0, node_test_1.it)("commanded on → no external status", () => {
        strict_1.default.equal((0, feedback_js_1.externalOnStatus)({ commandedStage: 1, feedbackActive: true, powerActive: true }), null);
    });
    (0, node_test_1.it)("commanded off and nothing active → no external status", () => {
        strict_1.default.equal((0, feedback_js_1.externalOnStatus)({ commandedStage: 0, feedbackActive: false, powerActive: false }), null);
    });
});
(0, node_test_1.describe)("immersion watched foreign ids", () => {
    (0, node_test_1.it)("deduplicates identical set/feedback states (subscribe once)", () => {
        const config = (0, device_config_js_1.immersionDeviceConfigFromAdapter)({
            ih_stage_1_set_state: "alias.0.relay",
            ih_stage_1_feedback_state: "alias.0.relay",
            ih_stage_1_nominal_power_w: 3000,
            ih_buffer_temp_c_target: "alias.0.temp",
            ih_actual_power_state: "alias.0.power",
        });
        const ids = (0, engine_js_1.immersionRuntimeWatchedForeignIds)(config);
        const occurrences = ids.filter((id) => id === "alias.0.relay").length;
        strict_1.default.equal(occurrences, 1);
        strict_1.default.ok(ids.includes("alias.0.temp"));
        strict_1.default.ok(ids.includes("alias.0.power"));
    });
    (0, node_test_1.it)("includes the configured feedback state", () => {
        const config = (0, device_config_js_1.immersionDeviceConfigFromAdapter)({
            ih_stage_1_set_state: "alias.0.set",
            ih_stage_1_feedback_state: "alias.0.fb",
            ih_stage_1_nominal_power_w: 3000,
        });
        strict_1.default.ok((0, engine_js_1.immersionRuntimeWatchedForeignIds)(config).includes("alias.0.fb"));
    });
});
