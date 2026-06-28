"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const index_js_1 = require("./index.js");
(0, node_test_1.describe)("addon governance config", () => {
    (0, node_test_1.it)("registers all four governed addons in order", () => {
        strict_1.default.deepEqual((0, index_js_1.governedAddonIds)(), ["wallbox", "immersion_heater", "battery", "climate"]);
        strict_1.default.equal(index_js_1.GOVERNED_ADDON_REGISTRY.length, 4);
    });
    (0, node_test_1.it)("defaults enabled to true when config key missing", () => {
        for (const id of (0, index_js_1.governedAddonIds)()) {
            strict_1.default.equal((0, index_js_1.isAddonEnabled)({}, id), true, id);
        }
    });
    (0, node_test_1.it)("reads explicit enabled values from config", () => {
        strict_1.default.equal((0, index_js_1.isAddonEnabled)({ wallbox_enabled: false }, "wallbox"), false);
        strict_1.default.equal((0, index_js_1.isAddonEnabled)({ immersion_heater_enabled: true }, "immersion_heater"), true);
        strict_1.default.equal((0, index_js_1.isAddonEnabled)({ battery_enabled: 0 }, "battery"), false);
        strict_1.default.equal((0, index_js_1.isAddonEnabled)({ climate_enabled: "false" }, "climate"), false);
    });
    (0, node_test_1.it)("defaults ai optimization to false", () => {
        for (const id of (0, index_js_1.governedAddonIds)()) {
            strict_1.default.equal((0, index_js_1.isAddonAiOptimizationAllowed)({}, id), false, id);
        }
    });
    (0, node_test_1.it)("reads explicit ai optimization values", () => {
        strict_1.default.equal((0, index_js_1.getAddonGovernance)({ wallbox_ai_optimization_allowed: true }, "wallbox").aiOptimizationAllowed, true);
        strict_1.default.equal((0, index_js_1.getAddonGovernance)({ battery_ai_optimization_allowed: false }, "battery").aiOptimizationAllowed, false);
    });
    (0, node_test_1.it)("keeps enabled and ai flags independent", () => {
        const gov = (0, index_js_1.getAddonGovernance)({
            wallbox_enabled: false,
            wallbox_ai_optimization_allowed: true,
        }, "wallbox");
        strict_1.default.equal(gov.enabled, false);
        strict_1.default.equal(gov.aiOptimizationAllowed, true);
    });
});
