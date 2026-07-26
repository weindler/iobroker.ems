"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const config_js_1 = require("./config.js");
(0, node_test_1.describe)("ai config", () => {
    (0, node_test_1.it)("defaults to fully off, no token, default model/limit/interval", () => {
        const cfg = (0, config_js_1.aiConfigFromAdapter)({});
        strict_1.default.equal(cfg.enabled, false);
        strict_1.default.equal(cfg.provider, "openai");
        strict_1.default.equal(cfg.model, config_js_1.AI_DEFAULT_MODEL);
        strict_1.default.equal(cfg.apiKey, "");
        strict_1.default.equal(cfg.maxCallsPerDay, config_js_1.AI_DEFAULT_MAX_CALLS_PER_DAY);
        strict_1.default.equal(cfg.minIntervalMinutes, config_js_1.AI_DEFAULT_MIN_INTERVAL_MINUTES);
    });
    (0, node_test_1.it)("reads enabled/model/token/limit/interval from config", () => {
        const cfg = (0, config_js_1.aiConfigFromAdapter)({
            ai_enabled: true,
            ai_model: "gpt-4o-mini",
            ai_openai_api_key: "  sk-test-123  ",
            ai_max_calls_per_day: 5,
            ai_min_interval_minutes: 30,
        });
        strict_1.default.equal(cfg.enabled, true);
        strict_1.default.equal(cfg.model, "gpt-4o-mini");
        strict_1.default.equal(cfg.apiKey, "sk-test-123");
        strict_1.default.equal(cfg.maxCallsPerDay, 5);
        strict_1.default.equal(cfg.minIntervalMinutes, 30);
    });
    (0, node_test_1.it)("accepts 0 as an explicit, valid min interval (disabled)", () => {
        strict_1.default.equal((0, config_js_1.aiConfigFromAdapter)({ ai_min_interval_minutes: 0 }).minIntervalMinutes, 0);
    });
    (0, node_test_1.it)("invalid/negative min interval falls back to default", () => {
        strict_1.default.equal((0, config_js_1.aiConfigFromAdapter)({ ai_min_interval_minutes: -5 }).minIntervalMinutes, config_js_1.AI_DEFAULT_MIN_INTERVAL_MINUTES);
        strict_1.default.equal((0, config_js_1.aiConfigFromAdapter)({ ai_min_interval_minutes: "abc" }).minIntervalMinutes, config_js_1.AI_DEFAULT_MIN_INTERVAL_MINUTES);
    });
    (0, node_test_1.it)("rejects unknown model → falls back to default (no free text)", () => {
        const cfg = (0, config_js_1.aiConfigFromAdapter)({ ai_model: "not-a-real-model" });
        strict_1.default.equal(cfg.model, config_js_1.AI_DEFAULT_MODEL);
    });
    (0, node_test_1.it)("invalid/zero max calls per day falls back to default", () => {
        strict_1.default.equal((0, config_js_1.aiConfigFromAdapter)({ ai_max_calls_per_day: 0 }).maxCallsPerDay, config_js_1.AI_DEFAULT_MAX_CALLS_PER_DAY);
        strict_1.default.equal((0, config_js_1.aiConfigFromAdapter)({ ai_max_calls_per_day: -3 }).maxCallsPerDay, config_js_1.AI_DEFAULT_MAX_CALLS_PER_DAY);
        strict_1.default.equal((0, config_js_1.aiConfigFromAdapter)({ ai_max_calls_per_day: "abc" }).maxCallsPerDay, config_js_1.AI_DEFAULT_MAX_CALLS_PER_DAY);
    });
    (0, node_test_1.it)("non-object config never throws", () => {
        strict_1.default.doesNotThrow(() => (0, config_js_1.aiConfigFromAdapter)(null));
        strict_1.default.doesNotThrow(() => (0, config_js_1.aiConfigFromAdapter)(undefined));
    });
});
