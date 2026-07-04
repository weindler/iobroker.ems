"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const sequences_1 = require("./sequences");
(0, node_test_1.describe)("ac sequences toggle mirror reset", () => {
    (0, node_test_1.it)("collectToggleMirrorIds gathers mapped toggle roles", () => {
        const table = {
            unit_2_cmd_switch_on: { enabled: true, targetStateId: "st.switch-on" },
            unit_2_cmd_switch_off: { enabled: true, targetStateId: "st.switch-off" },
            unit_2_cmd_refresh: { enabled: false, targetStateId: "st.refresh" },
        };
        strict_1.default.deepEqual((0, sequences_1.collectToggleMirrorIds)(table, 2), ["st.switch-on", "st.switch-off"]);
    });
    (0, node_test_1.it)("resetToggleMirrorsNow writes false with ack true", async () => {
        const writes = [];
        const host = {
            getForeignStateAsync: async () => null,
            setForeignStateAsync: async (id, state) => {
                if (state && typeof state === "object" && "val" in state && "ack" in state) {
                    writes.push({ id, val: state.val, ack: state.ack });
                }
            },
        };
        await (0, sequences_1.resetToggleMirrorsNow)(host, ["a", "a", "b"]);
        strict_1.default.equal(writes.length, 2);
        strict_1.default.equal(writes[0].val, false);
        strict_1.default.equal(writes[0].ack, true);
    });
    (0, node_test_1.it)("scheduleToggleMirrorReset fires after delay", async () => {
        const writes = [];
        const host = {
            getForeignStateAsync: async () => null,
            setForeignStateAsync: async (id, state) => {
                if (state && typeof state === "object" && "val" in state) {
                    writes.push(id);
                }
            },
        };
        (0, sequences_1.scheduleToggleMirrorReset)(host, ["st.on"], 20);
        strict_1.default.equal(writes.length, 0);
        await new Promise((r) => setTimeout(r, 35));
        strict_1.default.deepEqual(writes, ["st.on"]);
    });
});
