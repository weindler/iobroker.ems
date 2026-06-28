"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const ensure_states_js_1 = require("./ensure_states.js");
const registry_js_1 = require("./registry.js");
function mockHost(initial = {}) {
    const objects = new Set();
    const states = new Map(Object.entries(initial));
    return {
        objects,
        states,
        host: {
            setObjectNotExistsAsync: async (id) => {
                objects.add(id);
            },
            getStateAsync: async (id) => states.get(id) ?? null,
            setStateAsync: async (id, st) => {
                states.set(id, { val: st.val, ack: st.ack === true });
            },
        },
    };
}
(0, node_test_1.describe)("addon governance runtime states", () => {
    (0, node_test_1.it)("creates governance states for all addons", async () => {
        const mock = mockHost();
        await (0, ensure_states_js_1.ensureAddonGovernanceStates)(mock.host);
        for (const id of (0, registry_js_1.governedAddonIds)()) {
            strict_1.default.ok(mock.objects.has((0, ensure_states_js_1.addonGovernanceEnabledState)(id)));
            strict_1.default.ok(mock.objects.has((0, ensure_states_js_1.addonGovernanceAiAllowedState)(id)));
        }
    });
    (0, node_test_1.it)("mirrors config with ack=true and only writes on change", async () => {
        const initial = {};
        for (const id of (0, registry_js_1.governedAddonIds)()) {
            initial[(0, ensure_states_js_1.addonGovernanceEnabledState)(id)] = { val: true, ack: true };
            initial[(0, ensure_states_js_1.addonGovernanceAiAllowedState)(id)] = { val: false, ack: true };
        }
        initial["addons.wallbox.enabled"] = { val: true, ack: true };
        initial["addons.immersion_heater.enabled"] = { val: true, ack: true };
        initial["addons.battery.enabled"] = { val: true, ack: true };
        initial["addons.air_conditioning.enabled"] = { val: true, ack: true };
        const mock = mockHost(initial);
        const { states } = mock;
        let writes = 0;
        const countingHost = {
            ...mock.host,
            setStateAsync: async (id, st) => {
                writes++;
                return mock.host.setStateAsync(id, st);
            },
        };
        await (0, ensure_states_js_1.syncAddonGovernanceFromConfig)(countingHost, {
            wallbox_enabled: true,
            wallbox_ai_optimization_allowed: false,
        });
        strict_1.default.equal(writes, 0);
        await (0, ensure_states_js_1.syncAddonGovernanceFromConfig)(countingHost, {
            wallbox_enabled: false,
            wallbox_ai_optimization_allowed: true,
        });
        strict_1.default.equal(states.get("addons.wallbox.governance.enabled")?.val, false);
        strict_1.default.equal(states.get("addons.wallbox.governance.enabled")?.ack, true);
        strict_1.default.equal(states.get("addons.wallbox.governance.ai_optimization_allowed")?.val, true);
        strict_1.default.equal(states.get("addons.wallbox.enabled")?.val, false);
    });
});
