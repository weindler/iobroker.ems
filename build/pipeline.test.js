"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const pipeline_js_1 = require("./pipeline.js");
function intent(overrides = {}) {
    return {
        addon_id: "immersion_heater",
        command: "set_enabled",
        value: true,
        ...overrides,
    };
}
function mockCtx(states, live = true) {
    const store = new Map(Object.entries(states));
    let foreignWrites = 0;
    return {
        foreignWrites,
        ctx: {
            getState: async (id) => {
                const val = store.get(id);
                return val === undefined ? null : { val };
            },
            setForeignState: async () => {
                foreignWrites++;
            },
            isLiveAllowed: async () => live,
        },
    };
}
(0, node_test_1.describe)("pipeline governance gates", () => {
    (0, node_test_1.it)("blocks disabled governed addon before live write", async () => {
        const { ctx, foreignWrites } = mockCtx({
            "addons.immersion_heater.available": true,
            "addons.immersion_heater.enabled": false,
            "addons.immersion_heater.governance.enabled": false,
            "addons.immersion_heater.mode": "live",
            "addons.immersion_heater.mapping.set_enabled.enabled": true,
            "addons.immersion_heater.mapping.set_enabled.target_state": "mqtt.0.relay",
            "addons.immersion_heater.mapping.set_enabled.allowed_values": "[true,false]",
        });
        const outcome = await (0, pipeline_js_1.runCommandPipeline)(intent(), ctx);
        strict_1.default.equal(outcome.result, "blocked");
        strict_1.default.ok(outcome.checks_failed.includes("addon_disabled"));
        strict_1.default.equal(foreignWrites, 0);
    });
    (0, node_test_1.it)("blocks governance-disabled addon at final live write gate", async () => {
        const { ctx, foreignWrites } = mockCtx({
            "addons.immersion_heater.available": true,
            "addons.immersion_heater.enabled": true,
            "addons.immersion_heater.governance.enabled": false,
            "addons.immersion_heater.mode": "live",
            "addons.immersion_heater.mapping.set_enabled.enabled": true,
            "addons.immersion_heater.mapping.set_enabled.target_state": "mqtt.0.relay",
            "addons.immersion_heater.mapping.set_enabled.allowed_values": "[true,false]",
            "global.execution_mode": "live",
        });
        const outcome = await (0, pipeline_js_1.runCommandPipeline)(intent(), ctx);
        strict_1.default.equal(outcome.result, "blocked");
        strict_1.default.ok(outcome.checks_failed.includes("addon_governance_disabled"));
        strict_1.default.equal(foreignWrites, 0);
    });
});
