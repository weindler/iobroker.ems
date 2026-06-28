"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const config_js_1 = require("../governance/config.js");
(0, node_test_1.describe)("ai optimization governance", () => {
    (0, node_test_1.it)("ai flag does not imply enabled steering", () => {
        const config = {
            wallbox_enabled: false,
            wallbox_ai_optimization_allowed: true,
        };
        strict_1.default.equal((0, config_js_1.isAddonAiOptimizationAllowed)(config, "wallbox"), true);
    });
});
