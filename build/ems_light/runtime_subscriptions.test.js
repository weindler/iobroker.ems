"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const runtime_subscriptions_js_1 = require("./runtime_subscriptions.js");
(0, node_test_1.describe)("EMS_LIGHT_OWN_STATE_SUBSCRIPTIONS", () => {
    (0, node_test_1.it)("deckt alle manuellen Runtime-Trigger mit bestehendem onStateChange-Handler ab", () => {
        const set = new Set(runtime_subscriptions_js_1.EMS_LIGHT_OWN_STATE_SUBSCRIPTIONS);
        strict_1.default.equal(set.size, runtime_subscriptions_js_1.EMS_LIGHT_OWN_STATE_SUBSCRIPTIONS.length, "keine Duplikate");
        for (const id of [
            "ai.optimize_now_request",
            "ai.user_enabled",
            "ai.daily_analyst.run_now_request",
            "statistics.public_charge.submit_request",
            "statistics.adjust_request",
            "statistics.period_id",
            "backup.export_request",
            "backup.support_export_request",
            "support.diagnostic_request",
            "backup.restore.validate_request",
            "backup.restore.apply_request",
            "global_modes.requested",
            "user_intent.inputs.iobroker.wallbox.request_json",
        ]) {
            strict_1.default.ok(set.has(id), `fehlt in Subscribe-Liste: ${id}`);
        }
    });
});
