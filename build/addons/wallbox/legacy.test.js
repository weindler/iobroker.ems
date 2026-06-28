"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const registry_1 = require("../registry");
const mapping_config_1 = require("../../mapping_config");
(0, node_test_1.describe)("wallbox legacy abgrenzung", () => {
    (0, node_test_1.it)("wallbox addon is read-only in registry", () => {
        strict_1.default.equal((0, registry_1.isReadOnlyAddon)("wallbox"), true);
        strict_1.default.equal((0, registry_1.addonHasCapability)("wallbox", "supports_enable_disable"), false);
    });
    (0, node_test_1.it)("legacy mapping parser still loads old config keys", () => {
        const m = (0, mapping_config_1.legacyWallboxMappingFromConfig)({
            wb_set_enabled_target: "go-e.0.allow_charging",
            wb_set_current_a_target: "go-e.0.amperePV",
        });
        strict_1.default.equal(m.set_enabled?.target_state, "go-e.0.allow_charging");
        strict_1.default.equal(m.set_current_a?.target_state, "go-e.0.amperePV");
    });
});
