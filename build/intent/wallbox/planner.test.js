"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const validation_js_1 = require("./validation.js");
const ISO = "2026-06-27T12:00:00.000Z";
function field(value, status) {
    return {
        value,
        status,
        origin: { source: "evcc", owner: "evcc", change_kind: "unknown" },
        observed_at: ISO,
        raw_value: value,
    };
}
(0, node_test_1.describe)("external wallbox planner plan", () => {
    (0, node_test_1.it)("missing plan time -> none", () => {
        const plan = (0, validation_js_1.buildExternalWallboxPlan)(field(null, "missing"), field(80, "valid"), ISO);
        strict_1.default.equal(plan.state, "none");
        strict_1.default.equal(plan.target_soc_pct, 80);
        strict_1.default.equal(plan.ready_at, null);
    });
    (0, node_test_1.it)("null string raw -> none via missing deadline", () => {
        const deadline = field(null, "missing");
        deadline.raw_value = "null";
        const plan = (0, validation_js_1.buildExternalWallboxPlan)(deadline, field(null, "missing"), ISO);
        strict_1.default.equal(plan.state, "none");
    });
    (0, node_test_1.it)("future valid plan -> active", () => {
        const plan = (0, validation_js_1.buildExternalWallboxPlan)(field({ type: "departure", at: "2026-06-27T20:00:00Z", timezone: "Europe/Berlin" }, "valid"), field(90, "valid"), ISO);
        strict_1.default.equal(plan.state, "active");
        strict_1.default.equal(plan.ready_at, "2026-06-27T20:00:00Z");
    });
    (0, node_test_1.it)("expired plan -> expired", () => {
        const plan = (0, validation_js_1.buildExternalWallboxPlan)(field({ type: "departure", at: "2026-06-27T08:00:00Z", timezone: "Europe/Berlin" }, "expired"), field(90, "valid"), ISO);
        strict_1.default.equal(plan.state, "expired");
    });
    (0, node_test_1.it)("invalid plan -> invalid", () => {
        const plan = (0, validation_js_1.buildExternalWallboxPlan)(field(null, "invalid"), field(90, "valid"), ISO);
        strict_1.default.equal(plan.state, "invalid");
    });
});
