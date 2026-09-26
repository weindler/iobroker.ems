"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const constants_1 = require("../constants");
const ensure_states_1 = require("./ensure_states");
(0, node_test_1.describe)("Klima-State-Anlage", () => {
    (0, node_test_1.it)("legt allocated_power_w auch für nicht konfigurierte Plätze an", async () => {
        const objects = new Map();
        const host = {
            config: { ac_u1_enabled: true, ac_u2_enabled: true },
            async setObjectNotExistsAsync(id, obj) {
                if (!objects.has(id))
                    objects.set(id, obj);
            },
        };
        await (0, ensure_states_1.ensureAcRuntimeStates)(host);
        for (let i = 1; i <= constants_1.AC_UNIT_COUNT; i++) {
            const id = (0, ensure_states_1.acUnitRuntimeStates)(i).allocatedPowerW;
            const obj = objects.get(id);
            strict_1.default.equal(obj?.type, "state", id);
            const common = obj?.common;
            strict_1.default.equal(common?.type, "number", id);
            strict_1.default.equal(common?.unit, "W", id);
        }
        for (let i = 3; i <= constants_1.AC_UNIT_COUNT; i++) {
            strict_1.default.equal(objects.has((0, ensure_states_1.acUnitRuntimeStates)(i).estimatedPowerW), false);
        }
        const before = objects.size;
        await (0, ensure_states_1.ensureAcRuntimeStates)(host);
        strict_1.default.equal(objects.size, before);
    });
});
