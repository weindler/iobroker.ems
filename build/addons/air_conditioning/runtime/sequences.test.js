"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const sequences_1 = require("./sequences");
(0, node_test_1.describe)("ac sequences write steps", () => {
    (0, node_test_1.it)("toggle step resets mirror ack:true then force pulse ack:false", async () => {
        const writes = [];
        const host = {
            getForeignStateAsync: async () => ({ val: true, ack: true, ts: 0, lc: 0, from: "test" }),
            setForeignStateAsync: async (id, state) => {
                if (state && typeof state === "object" && "val" in state && "ack" in state) {
                    writes.push({ id, val: state.val, ack: state.ack });
                }
            },
        };
        const table = {
            unit_2_cmd_switch_on: { enabled: true, targetStateId: "st.on" },
        };
        await (0, sequences_1.executeAcWriteSteps)(host, 2, table, [{ kind: "toggle", role: "cmd_switch_on" }], true);
        strict_1.default.equal(writes.length, 2);
        strict_1.default.deepEqual(writes[0], { id: "st.on", val: false, ack: true });
        strict_1.default.deepEqual(writes[1], { id: "st.on", val: true, ack: false });
    });
    (0, node_test_1.it)("dryrun does not write", async () => {
        let wrote = false;
        const host = {
            getForeignStateAsync: async () => null,
            setForeignStateAsync: async () => {
                wrote = true;
            },
        };
        const table = {
            unit_2_cmd_switch_on: { enabled: true, targetStateId: "st.on" },
        };
        await (0, sequences_1.executeAcWriteSteps)(host, 2, table, [{ kind: "toggle", role: "cmd_switch_on" }], false);
        strict_1.default.equal(wrote, false);
    });
    (0, node_test_1.it)("switch_off writes off/false to all mapped switch targets", async () => {
        const writes = [];
        const host = {
            getForeignStateAsync: async () => ({ val: "on", ack: true, ts: 0, lc: 0, from: "test" }),
            setForeignStateAsync: async (id, state) => {
                const val = state && typeof state === "object" && "val" in state ? state.val : state;
                writes.push({ id, val });
            },
        };
        const table = {
            unit_2_cmd_switch_on: { enabled: true, targetStateId: "st.switch" },
            unit_2_cmd_switch_off: { enabled: true, targetStateId: "st.switch" },
            unit_2_feedback_switch: { enabled: true, targetStateId: "st.switch" },
        };
        await (0, sequences_1.executeAcWriteSteps)(host, 2, table, [{ kind: "switch_off" }], true);
        strict_1.default.ok(writes.some((w) => w.id === "st.switch" && w.val === "off"));
        strict_1.default.ok(writes.some((w) => w.id === "st.switch" && w.val === false));
    });
    (0, node_test_1.it)("switch_off on dedicated off also pulses after set", async () => {
        const writes = [];
        const host = {
            getForeignStateAsync: async () => ({ val: false, ack: true, ts: 0, lc: 0, from: "test" }),
            setForeignStateAsync: async (id, state) => {
                const val = state && typeof state === "object" && "val" in state ? state.val : state;
                writes.push({ id, val });
            },
        };
        const table = {
            unit_2_cmd_switch_on: { enabled: true, targetStateId: "st.on" },
            unit_2_cmd_switch_off: { enabled: true, targetStateId: "st.off" },
            unit_2_feedback_switch: { enabled: true, targetStateId: "st.switch" },
        };
        await (0, sequences_1.executeAcWriteSteps)(host, 2, table, [{ kind: "switch_off" }], true);
        strict_1.default.ok(writes.some((w) => w.id === "st.off" && w.val === "off"));
        strict_1.default.ok(writes.some((w) => w.id === "st.switch" && w.val === "off"));
        strict_1.default.ok(writes.some((w) => w.id === "st.off" && w.val === true));
    });
});
