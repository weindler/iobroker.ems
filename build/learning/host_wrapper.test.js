"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const data_dir_js_1 = require("./data_dir.js");
const history_bridge_js_1 = require("./history_bridge.js");
class PrototypeHost {
    calls = 0;
    originalMarker = "unchanged";
    async probeMethod() {
        this.calls += 1;
        return "ok";
    }
    async getStateAsync(_id) {
        return null;
    }
    async getHistoryAsync(_id, _options) {
        return { result: [] };
    }
}
class HostWithSendToAsync extends PrototypeHost {
    sendToAsync = async () => ({ from: "original" });
}
(0, node_test_1.describe)("learning host wrappers", () => {
    (0, node_test_1.it)("withLearningDataPath returns a distinct wrapper object", async () => {
        const adapter = {
            namespace: "ems.0",
            getAbsoluteInstanceDataDir: () => "/tmp/ems-test",
        };
        const host = new PrototypeHost();
        const wrapped = (0, data_dir_js_1.withLearningDataPath)(adapter, host);
        strict_1.default.notStrictEqual(wrapped, host);
    });
    (0, node_test_1.it)("withLearningDataPath keeps prototype methods callable", async () => {
        const adapter = {
            namespace: "ems.0",
            getAbsoluteInstanceDataDir: () => "/tmp/ems-test",
        };
        const host = new PrototypeHost();
        const wrapped = (0, data_dir_js_1.withLearningDataPath)(adapter, host);
        strict_1.default.equal(typeof wrapped.probeMethod, "function");
        strict_1.default.equal(await wrapped.probeMethod(), "ok");
        // this ist der Wrapper (Object.create-Host), nicht die Original-Referenz
        strict_1.default.equal(host.calls, 0);
        strict_1.default.equal(wrapped.calls, 1);
    });
    (0, node_test_1.it)("withLearningDataPath does not add getAbsolutePath to the original", async () => {
        const adapter = {
            namespace: "ems.0",
            getAbsoluteInstanceDataDir: () => "/tmp/ems-data",
        };
        const host = new PrototypeHost();
        const wrapped = (0, data_dir_js_1.withLearningDataPath)(adapter, host);
        strict_1.default.equal(typeof wrapped.getAbsolutePath, "function");
        strict_1.default.equal(wrapped.getAbsolutePath(), "/tmp/ems-data");
        strict_1.default.equal(Object.prototype.hasOwnProperty.call(host, "getAbsolutePath"), false);
    });
    (0, node_test_1.it)("withHistoryBridge returns a distinct wrapper and preserves prototype methods", async () => {
        const adapter = {
            sendTo: (_instance, _command, _message, cb) => {
                cb?.({ message: { ok: true } });
            },
        };
        const host = new PrototypeHost();
        const wrapped = (0, history_bridge_js_1.withHistoryBridge)(adapter, host);
        strict_1.default.notStrictEqual(wrapped, host);
        strict_1.default.equal(typeof wrapped.probeMethod, "function");
        strict_1.default.equal(await wrapped.probeMethod(), "ok");
        strict_1.default.equal(typeof wrapped.sendToAsync, "function");
        const res = await wrapped.sendToAsync("history.0", "getHistory", {});
        strict_1.default.ok(res);
    });
    (0, node_test_1.it)("withHistoryBridge does not add sendToAsync to the original", async () => {
        const adapter = { sendTo: () => undefined };
        const host = new PrototypeHost();
        (0, history_bridge_js_1.withHistoryBridge)(adapter, host);
        strict_1.default.equal(Object.prototype.hasOwnProperty.call(host, "sendToAsync"), false);
    });
    (0, node_test_1.it)("withHistoryBridge does not mutate an existing original sendToAsync", async () => {
        const adapter = { sendTo: () => undefined };
        const host = new HostWithSendToAsync();
        const original = host.sendToAsync;
        const wrapped = (0, history_bridge_js_1.withHistoryBridge)(adapter, host);
        strict_1.default.strictEqual(host.sendToAsync, original);
        strict_1.default.notStrictEqual(wrapped.sendToAsync, original);
        strict_1.default.deepEqual(await host.sendToAsync(), await original());
    });
    (0, node_test_1.it)("wrapper uses bridge sendToAsync implementation", async () => {
        const adapter = {
            sendTo: (_instance, _command, _message, cb) => {
                cb?.({ message: { bridged: true } });
            },
        };
        const host = new PrototypeHost();
        const wrapped = (0, history_bridge_js_1.withHistoryBridge)(adapter, host);
        const res = await wrapped.sendToAsync("history.0", "getHistory", {});
        strict_1.default.ok(res);
        strict_1.default.equal(res.message?.bridged, true);
    });
    (0, node_test_1.it)("independent wrappers do not affect each other", async () => {
        const adapterA = {
            namespace: "ems.0",
            getAbsoluteInstanceDataDir: () => "/tmp/a",
        };
        const adapterB = {
            namespace: "ems.0",
            getAbsoluteInstanceDataDir: () => "/tmp/b",
        };
        const hostA = new PrototypeHost();
        const hostB = new PrototypeHost();
        const wrappedA = (0, data_dir_js_1.withLearningDataPath)(adapterA, hostA);
        const wrappedB = (0, data_dir_js_1.withLearningDataPath)(adapterB, hostB);
        strict_1.default.equal(wrappedA.getAbsolutePath(), "/tmp/a");
        strict_1.default.equal(wrappedB.getAbsolutePath(), "/tmp/b");
        strict_1.default.equal(Object.prototype.hasOwnProperty.call(hostA, "getAbsolutePath"), false);
        strict_1.default.equal(Object.prototype.hasOwnProperty.call(hostB, "getAbsolutePath"), false);
    });
});
