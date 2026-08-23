"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const feedback_on_js_1 = require("./feedback_on.js");
(0, node_test_1.describe)("AC LocalThings feedback_on", () => {
    (0, node_test_1.it)("state_boolean false + climate.state cool → on via mode", () => {
        const r = (0, feedback_on_js_1.resolveAcDevicePowered)({
            switchRaw: false,
            modeRaw: "cool",
            useModeFallback: true,
        });
        strict_1.default.equal(r.on, true);
        strict_1.default.equal(r.via, "mode");
        strict_1.default.equal(r.effectiveRaw, "cool");
    });
    (0, node_test_1.it)("state_boolean false + climate.state off → off", () => {
        const r = (0, feedback_on_js_1.resolveAcDevicePowered)({
            switchRaw: false,
            modeRaw: "off",
            useModeFallback: true,
        });
        strict_1.default.equal(r.on, false);
        strict_1.default.equal(r.via, "mode");
    });
    (0, node_test_1.it)("without mode fallback only switch counts", () => {
        const r = (0, feedback_on_js_1.resolveAcDevicePowered)({
            switchRaw: false,
            modeRaw: "cool",
            useModeFallback: false,
        });
        strict_1.default.equal(r.on, false);
        strict_1.default.equal(r.via, "none");
    });
    (0, node_test_1.it)("derives .state from .state_boolean mapping", () => {
        strict_1.default.equal((0, feedback_on_js_1.deriveHassClimateStateId)("hass.0.entities.climate.x.state_boolean"), "hass.0.entities.climate.x.state");
    });
    (0, node_test_1.it)("LocalThings uses feedback_mode or derived state id", () => {
        const unit = {
            index: 2,
            profileId: "samsung_localthings_hass",
        };
        const table = {
            unit_2_feedback_switch: {
                enabled: true,
                targetStateId: "hass.0.entities.climate.josef.state_boolean",
            },
        };
        strict_1.default.equal((0, feedback_on_js_1.resolveAcFeedbackModeTarget)(table, unit, "hass.0.entities.climate.josef.state_boolean"), "hass.0.entities.climate.josef.state");
        const withMode = {
            ...table,
            unit_2_feedback_mode: {
                enabled: true,
                targetStateId: "hass.0.entities.climate.josef.state",
            },
        };
        strict_1.default.equal((0, feedback_on_js_1.resolveAcFeedbackModeTarget)(withMode, unit, "hass.0.entities.climate.josef.state_boolean"), "hass.0.entities.climate.josef.state");
    });
});
