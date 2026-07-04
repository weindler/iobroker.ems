"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const sequences_1 = require("./sequences");
(0, node_test_1.describe)("ac sequences write steps", () => {
    (0, node_test_1.it)("toggle step uses force write even when state already true", async () => {
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
        strict_1.default.equal(writes.length, 1);
        strict_1.default.equal(writes[0].val, true);
        strict_1.default.equal(writes[0].ack, false);
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
});
