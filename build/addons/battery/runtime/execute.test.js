"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const execute_js_1 = require("./execute.js");
function okGate() {
    return {
        globalLive: true,
        governanceEnabled: true,
        profileId: "sonnen_em",
        profileLiveControlAvailable: true,
        profileReady: true,
        intentValid: true,
        telemetryReady: true,
        fault: false,
        lockout: false,
        targetMappingConfigured: true,
        ownershipValid: true,
    };
}
function mockHost() {
    const writes = [];
    const host = {
        getForeignStateAsync: async () => null,
        setForeignStateAsync: async (id, state) => {
            const val = state && typeof state === "object" && "val" in state ? state.val : state;
            writes.push({ id, val: val ?? null });
        },
        log: { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined },
    };
    return { host, writes };
}
(0, node_test_1.describe)("battery final write gate", () => {
    (0, node_test_1.it)("blocks when global not live", () => {
        strict_1.default.equal((0, execute_js_1.evaluateFinalWriteGate)({ ...okGate(), globalLive: false }).rejectCode, "execution_gate_closed");
    });
    (0, node_test_1.it)("blocks generic profile", () => {
        strict_1.default.equal((0, execute_js_1.evaluateFinalWriteGate)({ ...okGate(), profileId: "generic_readonly" }).rejectCode, "profile_not_live_capable");
    });
    (0, node_test_1.it)("passes when all conditions met", () => {
        strict_1.default.equal((0, execute_js_1.evaluateFinalWriteGate)(okGate()).passed, true);
    });
});
(0, node_test_1.describe)("executeBatteryWrite", () => {
    (0, node_test_1.it)("dryrun never writes to device", async () => {
        const { host, writes } = mockHost();
        const r = await (0, execute_js_1.executeBatteryWrite)(host, {
            kind: "charge_power",
            stateId: "x.charge",
            value: 2000,
            requestId: "r",
            reason: "test",
            dryrun: true,
            gate: okGate(),
        });
        strict_1.default.equal(writes.length, 0);
        strict_1.default.equal(r.executed, false);
        strict_1.default.equal(r.simulated, true);
    });
    (0, node_test_1.it)("live writes through when gate passes", async () => {
        const { host, writes } = mockHost();
        const r = await (0, execute_js_1.executeBatteryWrite)(host, {
            kind: "operating_mode",
            stateId: "x.mode",
            value: 1,
            requestId: "r",
            reason: "test",
            dryrun: false,
            gate: okGate(),
        });
        strict_1.default.equal(writes.length, 1);
        strict_1.default.equal(writes[0].id, "x.mode");
        strict_1.default.equal(writes[0].val, 1);
        strict_1.default.equal(r.executed, true);
        strict_1.default.equal(r.written, true);
        strict_1.default.equal(r.skipped, false);
    });
    (0, node_test_1.it)("skips live write when device already at target", async () => {
        const writes = [];
        const host = {
            getForeignStateAsync: async () => ({ val: 2, ack: true }),
            setForeignStateAsync: async (id, state) => {
                const val = state && typeof state === "object" && "val" in state ? state.val : state;
                writes.push({ id, val: val ?? null });
            },
            log: { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined },
        };
        const r = await (0, execute_js_1.executeBatteryWrite)(host, {
            kind: "operating_mode",
            stateId: "x.mode",
            value: 2,
            requestId: "r",
            reason: "restore",
            dryrun: false,
            gate: okGate(),
        });
        strict_1.default.equal(writes.length, 0);
        strict_1.default.equal(r.executed, true);
        strict_1.default.equal(r.skipped, true);
        strict_1.default.equal(r.written, false);
    });
    (0, node_test_1.it)("live blocked when gate fails (battery disabled)", async () => {
        const { host, writes } = mockHost();
        const r = await (0, execute_js_1.executeBatteryWrite)(host, {
            kind: "charge_power",
            stateId: "x.charge",
            value: 2000,
            requestId: "r",
            reason: "test",
            dryrun: false,
            gate: { ...okGate(), governanceEnabled: false },
        });
        strict_1.default.equal(writes.length, 0);
        strict_1.default.equal(r.executed, false);
        strict_1.default.equal(r.rejectCode, "addon_disabled");
    });
    (0, node_test_1.it)("force rewrites discharge even if device already shows the value", async () => {
        const writes = [];
        const host = {
            getForeignStateAsync: async () => ({ val: 48, ack: true }),
            setForeignStateAsync: async (id, state) => {
                const val = state && typeof state === "object" && "val" in state
                    ? state.val
                    : state;
                writes.push({ id, val: val ?? null });
            },
            log: { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined },
        };
        const skipped = await (0, execute_js_1.executeBatteryWrite)(host, {
            kind: "discharge_power",
            stateId: "sonnen.0.control.discharge",
            value: 48,
            requestId: "grid_balance",
            reason: "grid_balance_keepalive",
            dryrun: false,
            gate: okGate(),
        });
        strict_1.default.equal(skipped.skipped, true);
        strict_1.default.equal(writes.length, 0);
        const forced = await (0, execute_js_1.executeBatteryWrite)(host, {
            kind: "discharge_power",
            stateId: "sonnen.0.control.discharge",
            value: 48,
            requestId: "grid_balance",
            reason: "grid_balance_keepalive",
            dryrun: false,
            force: true,
            gate: okGate(),
        });
        strict_1.default.equal(forced.written, true);
        strict_1.default.equal(forced.skipped, false);
        strict_1.default.equal(writes.length, 1);
        strict_1.default.equal(writes[0].id, "sonnen.0.control.discharge");
        strict_1.default.equal(writes[0].val, 48);
    });
});
