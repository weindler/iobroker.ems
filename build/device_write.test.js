"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const device_write_js_1 = require("./device_write.js");
(0, node_test_1.describe)("deviceValuesMatch", () => {
    (0, node_test_1.it)("matches equal numbers and bool coercion", () => {
        strict_1.default.equal((0, device_write_js_1.deviceValuesMatch)(2, 2), true);
        strict_1.default.equal((0, device_write_js_1.deviceValuesMatch)(2, 2.0), true);
        strict_1.default.equal((0, device_write_js_1.deviceValuesMatch)(true, 1), true);
        strict_1.default.equal((0, device_write_js_1.deviceValuesMatch)(false, 0), true);
        strict_1.default.equal((0, device_write_js_1.deviceValuesMatch)("2", 2), true);
    });
    (0, node_test_1.it)("respects numeric tolerance", () => {
        strict_1.default.equal((0, device_write_js_1.deviceValuesMatch)(2000, 2050, { numericTolerance: 100 }), true);
        strict_1.default.equal((0, device_write_js_1.deviceValuesMatch)(2000, 2200, { numericTolerance: 100 }), false);
    });
    (0, node_test_1.it)("detects mode change needed", () => {
        strict_1.default.equal((0, device_write_js_1.deviceValuesMatch)(2, 1), false);
    });
});
(0, node_test_1.describe)("writeForeignIfChanged", () => {
    (0, node_test_1.it)("skips write when device already at target", async () => {
        const writes = [];
        const host = {
            getForeignStateAsync: async () => ({ val: 2, ack: true }),
            setForeignStateAsync: async (id, state) => {
                const val = state && typeof state === "object" && "val" in state
                    ? state.val
                    : state;
                writes.push({ id, val: val ?? null });
            },
            log: { debug: () => { }, info: () => { }, warn: () => { }, error: () => { } },
        };
        const r = await (0, device_write_js_1.writeForeignIfChanged)(host, {
            stateId: "sonnen.0.configurations.EM_OperatingMode",
            value: 2,
            reason: "test",
        });
        strict_1.default.equal(r.skipped, true);
        strict_1.default.equal(r.written, false);
        strict_1.default.equal(writes.length, 0);
    });
    (0, node_test_1.it)("writes when value differs", async () => {
        const writes = [];
        const host = {
            getForeignStateAsync: async () => ({ val: 2, ack: true }),
            setForeignStateAsync: async (id, state) => {
                const val = state && typeof state === "object" && "val" in state
                    ? state.val
                    : state;
                writes.push({ id, val: val ?? null });
            },
        };
        const r = await (0, device_write_js_1.writeForeignIfChanged)(host, {
            stateId: "sonnen.0.configurations.EM_OperatingMode",
            value: 1,
            reason: "test",
        });
        strict_1.default.equal(r.skipped, false);
        strict_1.default.equal(r.written, true);
        strict_1.default.equal(writes.length, 1);
        strict_1.default.equal(writes[0].val, 1);
    });
});
