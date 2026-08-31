"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const config_1 = require("./config");
(0, node_test_1.describe)("aiAnalystConfigFromAdapter", () => {
    (0, node_test_1.it)("Admin deaktiviert → mode disabled, Overrides bleiben aus", () => {
        const cfg = (0, config_1.aiAnalystConfigFromAdapter)({
            ai_analyst_mode: "disabled",
            ai_openai_api_key: "sk-test",
            ai_override_enabled: true,
        });
        strict_1.default.equal(cfg.mode, "disabled");
        strict_1.default.equal(cfg.overrideEnabled, true);
        strict_1.default.equal(cfg.apiKey, "sk-test");
    });
    (0, node_test_1.it)("Admin Nur manuell → mode manual", () => {
        const cfg = (0, config_1.aiAnalystConfigFromAdapter)({ ai_analyst_mode: "manual" });
        strict_1.default.equal(cfg.mode, "manual");
        strict_1.default.equal(cfg.overrideEnabled, false);
        strict_1.default.equal(cfg.model, config_1.AI_ANALYST_DEFAULT_MODEL);
    });
    (0, node_test_1.it)("Admin Automatisch täglich → mode daily_auto", () => {
        const cfg = (0, config_1.aiAnalystConfigFromAdapter)({ ai_analyst_mode: " daily_auto " });
        strict_1.default.equal(cfg.mode, "daily_auto");
    });
    (0, node_test_1.it)("fehlender/ungültiger Modus fällt auf disabled, Token nicht erfunden", () => {
        strict_1.default.equal((0, config_1.aiAnalystConfigFromAdapter)({}).mode, "disabled");
        strict_1.default.equal((0, config_1.aiAnalystConfigFromAdapter)({ ai_analyst_mode: "on" }).mode, "disabled");
        strict_1.default.equal((0, config_1.aiAnalystConfigFromAdapter)({ ai_analyst_mode: "manual" }).apiKey, "");
        strict_1.default.equal((0, config_1.aiAnalystConfigFromAdapter)(null).mode, "disabled");
    });
});
